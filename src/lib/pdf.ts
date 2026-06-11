import { jsPDF } from "jspdf";
import { hyphenateSync } from "hyphen/de-1996";

export type PdfFont = "Serif" | "Sans" | "Schreibmaschine";
export type SatzArt = "flatter" | "buch";

export interface PdfOptions {
  title: string;
  widthCm: number;
  heightCm: number;
  marginCm: number;
  fontSizePt: number;
  font: PdfFont;
  satz: SatzArt; // "flatter" = linksbündig (Einreichung), "buch" = Blocksatz + Silbentrennung
}

const FONT_MAP: Record<PdfFont, string> = {
  Serif: "times",
  Sans: "helvetica",
  Schreibmaschine: "courier",
};

const CM_TO_PT = 28.3465;

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
 * Erzeugt ein druckfertiges Buch-PDF aus dem formatierten Manuskript (HTML).
 * Unterstützt Fett, Kursiv, Zentriert, Blockzitate, Kapitel (Überschriften)
 * sowie zwei Satzarten: Flattersatz (linksbündig) und Buchsatz (Blocksatz
 * mit deutscher Silbentrennung).
 */
export function manuskriptAlsPdf(html: string, opts: PdfOptions) {
  const w = opts.widthCm * CM_TO_PT;
  const h = opts.heightCm * CM_TO_PT;
  const margin = opts.marginCm * CM_TO_PT;
  const fontName = FONT_MAP[opts.font];
  const baseSize = opts.fontSizePt;
  const lineHeight = baseSize * 1.6;
  const bottom = h - margin;
  const quoteIndent = 0.9 * CM_TO_PT;
  const buch = opts.satz === "buch";

  const doc = new jsPDF({ unit: "pt", format: [w, h] });

  let y = margin;
  let pageNumber = 1;

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

  const seitenzahl = () => {
    doc.setFont(fontName, "normal");
    doc.setFontSize(baseSize - 2);
    doc.setTextColor(120);
    doc.text(String(pageNumber), w / 2, h - margin / 2, { align: "center" });
    doc.setTextColor(20);
  };

  const neueSeite = () => {
    seitenzahl();
    doc.addPage([w, h], w > h ? "landscape" : "portrait");
    pageNumber += 1;
    y = margin;
  };

  // ---- Titelseite ----
  doc.setFont(fontName, "normal");
  doc.setFontSize(baseSize + 14);
  doc.setTextColor(20);
  doc.text(opts.title || "Mein Roman", w / 2, h / 2 - 10, { align: "center" });
  neueSeite();

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

  const absatzRendern = (
    tokens: Token[],
    align: Ausrichtung,
    leftX: number,
    rightX: number,
    size: number,
    silbentrennung: boolean
  ) => {
    const maxW = rightX - leftX;
    const spaceW =
      wordWidth(" ", { bold: false, italic: false }, size) || size * 0.3;

    let line: { text: string; style: Style; width: number }[] = [];
    let lineW = 0;

    const flush = (isLast: boolean) => {
      if (line.length === 0) {
        y += lineHeight;
        return;
      }
      if (y > bottom) neueSeite();
      const n = line.length;
      const wordsW = line.reduce((a, b) => a + b.width, 0);
      let gap = spaceW;
      let x = leftX;
      if (align === "center") {
        x = leftX + (maxW - (wordsW + (n - 1) * spaceW)) / 2;
      } else if (align === "justify" && !isLast && n > 1) {
        // Blocksatz: Restbreite gleichmäßig auf die Wortzwischenräume verteilen
        gap = spaceW + (maxW - wordsW - (n - 1) * spaceW) / (n - 1);
      }
      for (const word of line) {
        applyFont(word.style, size);
        doc.text(word.text, x, y);
        x += word.width + gap;
      }
      y += lineHeight;
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

      // Passt nicht -> ggf. Silbentrennung versuchen
      if (silbentrennung && tok.text.length >= 6) {
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
            const restText = tok.text.slice(best.length - 1); // "-" abziehen
            tokens.splice(i + 1, 0, { text: restText, style: tok.style });
            flush(false);
            i++;
            continue;
          }
        }
      }

      // Keine Trennung -> Zeilenumbruch; Wort auf neuer Zeile erneut versuchen
      if (line.length > 0) {
        flush(false);
        continue;
      }

      // Zeile leer und Wort breiter als die Zeile: trotzdem setzen (Endlosschleife vermeiden)
      line.push({ text: tok.text, style: tok.style, width: ww });
      lineW += ww;
      i++;
    }
    flush(true);
  };

  for (const el of bloecke) {
    const tag = el.tagName.toLowerCase();
    const zentriert = (el.style.textAlign || "").toLowerCase() === "center";

    // ---- Kapitel (Überschrift): neue Seite, zentriert, größer ----
    if (/^h[1-6]$/.test(tag)) {
      if (y > margin) neueSeite();
      doc.setTextColor(20);
      const tokens: Token[] = [];
      tokensSammeln(el, true, false, tokens);
      y += lineHeight;
      absatzRendern(tokens, "center", margin, w - margin, baseSize + 6, false);
      y += lineHeight;
      continue;
    }

    // ---- Blockzitat: eingerückt ----
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
          margin + quoteIndent,
          w - margin - quoteIndent,
          baseSize,
          buch
        );
        y += lineHeight * 0.3;
      }
      y += lineHeight * 0.4;
      continue;
    }

    // ---- Normaler Absatz ----
    doc.setTextColor(20);
    const tokens: Token[] = [];
    tokensSammeln(el, false, false, tokens);
    if (tokens.length === 0) {
      y += lineHeight * 0.6;
      continue;
    }
    const align: Ausrichtung = zentriert ? "center" : buch ? "justify" : "left";
    absatzRendern(tokens, align, margin, w - margin, baseSize, buch);
    y += lineHeight * 0.35;
  }

  seitenzahl();

  const safeName =
    (opts.title || "roman").toLowerCase().replace(/[^a-z0-9äöüß]+/gi, "-") + ".pdf";
  doc.save(safeName);
}
