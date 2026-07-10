import { jsPDF } from "jspdf";
import { hyphenateSync } from "hyphen/de-1996";

export type PdfFont = "Serif" | "Sans" | "Schreibmaschine";
export type SatzArt = "flatter" | "buch";

export interface PdfOptions {
  title: string;
  author?: string;
  widthCm: number;
  heightCm: number;
  // Spiegelränder (mirrored margins) – einzeln
  marginInnerCm: number; // Bundsteg
  marginOuterCm: number;
  marginTopCm: number;
  marginBottomCm: number;
  // Grundschrift
  fontSizePt: number;
  leadingPt: number;
  paragraphSpaceAfterPt: number;
  hyphenMinChars: number;
  font: PdfFont;
  satz: SatzArt; // "buch" = Blocksatz + Silbentrennung (Druckfassung), "flatter" = linksbündig
  // Kapitel
  chapterFontSizePt: number;
  chapterLeadingPt: number;
  chapterSpaceBeforePt: number;
  chapterSpaceAfterPt: number;
  condChapterBreakCm: number; // Mindesthöhe, sonst neue Seite
  forceBreakTitles: string[]; // diese Kapitel beginnen zwingend auf neuer Seite
  // Seitenzahlen
  folioStart: number; // Anzeige-Seitenzahl der ersten Textseite
  pageNumberSizePt: number;
}

const FONT_MAP: Record<PdfFont, string> = {
  Serif: "times",
  Sans: "helvetica",
  Schreibmaschine: "courier",
};

const CM_TO_PT = 28.3465;
const MM = CM_TO_PT / 10;

interface Style {
  bold: boolean;
  italic: boolean;
}
type Token = { text: string; style: Style } | { br: true };
type Ausrichtung = "left" | "center" | "justify";

// ---- Deutsche Silbentrennung (zwischengespeichert) ----
const trennCache = new Map<string, string[]>();
function trenne(word: string): string[] {
  const c = trennCache.get(word);
  if (c) return c;
  let res: string[];
  try {
    res = hyphenateSync(word).split("\u00AD");
  } catch {
    res = [word];
  }
  trennCache.set(word, res);
  return res;
}

/**
 * Erzeugt ein druckfertiges Buch-PDF, das der finalen BoD-Maquette von
 * „Der Sog ins Nichts" nachempfunden ist: 120x190 mm, Spiegelränder,
 * festes Leading, Kapitel mit CondPageBreak sowie Seitenzahlen außen unten.
 */
export function manuskriptAlsPdf(html: string, opts: PdfOptions) {
  const w = opts.widthCm * CM_TO_PT;
  const h = opts.heightCm * CM_TO_PT;
  const mInner = opts.marginInnerCm * CM_TO_PT;
  const mOuter = opts.marginOuterCm * CM_TO_PT;
  const mTop = opts.marginTopCm * CM_TO_PT;
  const mBottom = opts.marginBottomCm * CM_TO_PT;

  const fontName = FONT_MAP[opts.font];
  const baseSize = opts.fontSizePt;
  const lineHeight = opts.leadingPt;
  const bodyTop = mTop;
  const bodyBottom = h - mBottom;
  const bodyWidth = w - mInner - mOuter; // konstante Satzspiegelbreite (90 mm)
  const quoteIndent = 0.9 * CM_TO_PT;
  const condBreak = opts.condChapterBreakCm * CM_TO_PT;
  const buch = opts.satz === "buch";
  const forceSet = new Set(
    opts.forceBreakTitles.map((t) => t.trim().toLowerCase())
  );

  const doc = new jsPDF({ unit: "pt", format: [w, h] });

  let folio = opts.folioStart; // Anzeige-Seitenzahl der aktuellen Textseite
  let y = bodyTop;

  const istRecto = () => folio % 2 === 1; // ungerade = rechte Seite, Bundsteg links
  const leftMargin = () => (istRecto() ? mInner : mOuter);

  const applyFont = (style: Style, size: number) => {
    const s =
      style.bold && style.italic
        ? "bolditalic"
        : style.bold
          ? "bold"
          : style.italic
            ? "italic"
            : "normal";
    doc.setFont(fontName, s);
    doc.setFontSize(size);
  };

  const wordWidth = (text: string, style: Style, size: number) => {
    applyFont(style, size);
    return doc.getTextWidth(text);
  };

  // Seitenzahl außen unten, 7,5 mm über der Papierunterkante
  const seitenzahl = () => {
    doc.setFont(fontName, "normal");
    doc.setFontSize(opts.pageNumberSizePt);
    doc.setTextColor(102); // #666
    const yNum = h - 7.5 * MM;
    if (istRecto()) {
      doc.text(String(folio), w - mOuter, yNum, { align: "right" });
    } else {
      doc.text(String(folio), mOuter, yNum, { align: "left" });
    }
    doc.setTextColor(20);
  };

  const neueSeite = () => {
    seitenzahl();
    doc.addPage([w, h], "portrait");
    folio += 1;
    y = bodyTop;
  };

  // ---- Titelseite (ohne Seitenzahl, alles zentriert) ----
  doc.setTextColor(20);
  const cx = w / 2;
  // Autor (oben)
  doc.setFont(fontName, "italic");
  doc.setFontSize(12);
  doc.text(opts.author || "Sonja Paredes Pernía", cx, h * 0.42, {
    align: "center",
  });
  // Titel (bricht bei langen Titeln um, damit nichts über den Rand läuft)
  doc.setFont(fontName, "bold");
  doc.setFontSize(20);
  const titelZeilen = doc.splitTextToSize(
    opts.title || "Mein Roman",
    bodyWidth
  ) as string[];
  let ty = h * 0.5;
  for (const zeile of titelZeilen) {
    doc.text(zeile, cx, ty, { align: "center" });
    ty += 26;
  }
  // „Roman" (unter dem Titel)
  doc.setFont(fontName, "italic");
  doc.setFontSize(11);
  doc.text("Roman", cx, ty + 6, { align: "center" });
  // Wechsel zur ersten Textseite (Titel bleibt ungezählt)
  doc.addPage([w, h], "portrait");
  y = bodyTop;

  // ---- HTML zerlegen ----
  const dom = new DOMParser().parseFromString(html || "", "text/html");
  const bloecke = Array.from(dom.body.children) as HTMLElement[];

  const tokensSammeln = (
    node: Node,
    bold: boolean,
    italic: boolean,
    out: Token[]
  ) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const txt = child.textContent ?? "";
        txt
          .split(/\s+/)
          .filter((x) => x.length > 0)
          .forEach((word) => out.push({ text: word, style: { bold, italic } }));
      } else if (child.nodeType === 1) {
        const el = child as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (tag === "br") {
          out.push({ br: true });
        } else {
          const b = bold || tag === "strong" || tag === "b";
          const it = italic || tag === "em" || tag === "i";
          tokensSammeln(el, b, it, out);
        }
      }
    });
  };

  // indent = zusätzlicher Einzug links UND rechts (für Blockzitate)
  const absatzRendern = (
    tokens: Token[],
    align: Ausrichtung,
    indent: number,
    size: number,
    silbentrennung: boolean,
    lh: number
  ) => {
    const maxW = bodyWidth - 2 * indent;
    const spaceW =
      wordWidth(" ", { bold: false, italic: false }, size) || size * 0.3;

    let line: { text: string; style: Style; width: number }[] = [];
    let lineW = 0;

    const flush = (isLast: boolean) => {
      if (line.length === 0) {
        y += lh;
        return;
      }
      if (y > bodyBottom) neueSeite();
      const lx = leftMargin() + indent;
      const n = line.length;
      const wordsW = line.reduce((a, b) => a + b.width, 0);
      let gap = spaceW;
      let x = lx;
      if (align === "center") {
        x = lx + (maxW - (wordsW + (n - 1) * spaceW)) / 2;
      } else if (align === "justify" && !isLast && n > 1) {
        gap = spaceW + (maxW - wordsW - (n - 1) * spaceW) / (n - 1);
      }
      for (const word of line) {
        applyFont(word.style, size);
        doc.text(word.text, x, y);
        x += word.width + gap;
      }
      y += lh;
      line = [];
      lineW = 0;
    };

    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];
      if ("br" in tok) {
        flush(true);
        i++;
        continue;
      }
      const ww = wordWidth(tok.text, tok.style, size);
      const sp = line.length ? spaceW : 0;

      if (lineW + sp + ww <= maxW) {
        line.push({ text: tok.text, style: tok.style, width: ww });
        lineW += sp + ww;
        i++;
        continue;
      }

      if (silbentrennung && tok.text.length >= opts.hyphenMinChars) {
        const parts = trenne(tok.text);
        if (parts.length > 1) {
          const avail = maxW - lineW - sp;
          let best = "";
          let acc = "";
          for (let s = 0; s < parts.length - 1; s++) {
            acc += parts[s];
            const rest = parts.slice(s + 1).join("");
            if (acc.length < 2 || rest.length < 2) continue;
            const cand = acc + "-";
            if (wordWidth(cand, tok.style, size) <= avail) best = cand;
            else break;
          }
          if (best) {
            const bw = wordWidth(best, tok.style, size);
            line.push({ text: best, style: tok.style, width: bw });
            lineW += sp + bw;
            const restText = tok.text.slice(best.length - 1);
            tokens.splice(i + 1, 0, { text: restText, style: tok.style });
            flush(false);
            i++;
            continue;
          }
        }
      }

      if (line.length > 0) {
        flush(false);
        continue;
      }

      line.push({ text: tok.text, style: tok.style, width: ww });
      lineW += ww;
      i++;
    }
    flush(true);
  };

  for (const el of bloecke) {
    const tag = el.tagName.toLowerCase();
    const zentriert = (el.style.textAlign || "").toLowerCase() === "center";

    // ---- Kapitel (Überschrift) ----
    if (/^h[1-6]$/.test(tag)) {
      const raw = (el.textContent || "").trim();
      const erzwingen = forceSet.has(raw.toLowerCase());
      if (erzwingen && y > bodyTop) {
        neueSeite();
      } else if (bodyBottom - y < condBreak && y > bodyTop) {
        neueSeite();
      }
      doc.setTextColor(20);
      y += opts.chapterSpaceBeforePt;
      const tokens: Token[] = [];
      tokensSammeln(el, false, true, tokens); // Kapiteltitel kursiv
      absatzRendern(
        tokens,
        "center",
        0,
        opts.chapterFontSizePt,
        false,
        opts.chapterLeadingPt
      );
      y += opts.chapterSpaceAfterPt;
      continue;
    }

    // ---- Blockzitat ----
    if (tag === "blockquote") {
      doc.setTextColor(20);
      const innerP = Array.from(el.children).filter(
        (c) => c.tagName.toLowerCase() === "p"
      ) as HTMLElement[];
      const ziele = innerP.length ? innerP : [el];
      for (const p of ziele) {
        const tokens: Token[] = [];
        tokensSammeln(p, false, true, tokens);
        absatzRendern(
          tokens,
          buch ? "justify" : "left",
          quoteIndent,
          baseSize,
          buch,
          lineHeight
        );
        y += opts.paragraphSpaceAfterPt * 0.5;
      }
      y += opts.paragraphSpaceAfterPt * 0.5;
      continue;
    }

    // ---- Normaler Absatz ----
    doc.setTextColor(20);
    const tokens: Token[] = [];
    tokensSammeln(el, false, false, tokens);
    if (tokens.length === 0) {
      y += lineHeight * 0.5;
      continue;
    }
    const align: Ausrichtung = zentriert ? "center" : buch ? "justify" : "left";
    absatzRendern(tokens, align, 0, baseSize, buch, lineHeight);
    y += opts.paragraphSpaceAfterPt;
  }

  seitenzahl();

  const safeName =
    (opts.title || "roman").toLowerCase().replace(/[^a-z0-9äöüß]+/gi, "-") +
    ".pdf";
  doc.save(safeName);
}
