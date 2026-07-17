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
  untertitel?: string; // Wort unter dem Titel: "Roman" | "Erzählung" | "Gedicht"
  gedichtZentriert?: boolean; // Gedicht: Verse zentriert statt linksbündig
  titelLinks?: boolean; // Überschriften standardmäßig links (Gedichte)
  // Kapitel
  chapterFontSizePt: number;
  chapterLeadingPt: number;
  chapterSpaceBeforePt: number;
  chapterSpaceAfterPt: number;
  condChapterBreakCm: number; // Mindesthöhe, sonst neue Seite
  chapterAlwaysNewPage?: boolean; // jeder Titel beginnt auf einer neuen Seite (Gedichte)
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

// Fremde Zeichen, die wie lateinische Buchstaben aussehen („Homoglyphen").
// Sie stammen oft aus importierten Word-Dateien und lassen sich in der
// Standardschrift nicht drucken – die Zeile bricht dann auseinander.
const HOMOGLYPHEN: Record<string, string> = {
  // Kyrillisch (russisch)
  "\u0430": "a", "\u0435": "e", "\u043E": "o", "\u0440": "p", "\u0441": "c",
  "\u0443": "y", "\u0445": "x", "\u043C": "m", "\u043A": "k", "\u0432": "b",
  "\u043D": "h", "\u0442": "t", "\u0456": "i", "\u0458": "j", "\u04BB": "h",
  "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041A": "K", "\u041C": "M",
  "\u041D": "H", "\u041E": "O", "\u0420": "P", "\u0421": "C", "\u0422": "T",
  "\u0423": "Y", "\u0425": "X", "\u0406": "I", "\u0408": "J",
  // Griechisch
  "\u03BF": "o", "\u03B1": "a", "\u03B5": "e", "\u03C1": "p", "\u03BD": "v",
  "\u03C5": "u", "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0397": "H",
  "\u0399": "I", "\u039A": "K", "\u039C": "M", "\u039D": "N", "\u039F": "O",
  "\u03A1": "P", "\u03A4": "T", "\u03A5": "Y", "\u03A7": "X",
  // Arabisches Heh = h-Laut (alle Formen)
  "\u0647": "h", "\uFEE9": "h", "\uFEEA": "h", "\uFEEB": "h", "\uFEEC": "h",
};

// Zeichen über 0xFF, die die Standardschrift trotzdem kann
const ERLAUBT_HOCH = new Set(
  "\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D" +
    "\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178"
);

/** Macht Text druckbar: Homoglyphen werden zu echten Buchstaben. */
function sauber(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x100 || ERLAUBT_HOCH.has(ch)) {
      out += ch;
      continue;
    }
    const ersatz = HOMOGLYPHEN[ch];
    if (ersatz) {
      out += ersatz;
      continue;
    }
    // Unbekanntes Sonderzeichen: vereinfachen, sonst weglassen
    const einfach = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    out += /^[\u0020-\u00FF]*$/.test(einfach) ? einfach : "";
  }
  return out;
}

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

  // ---- Titelseite (ohne Seitenzahl) ----
  // Titel exakt in die Blattmitte, Autor darüber, „Roman" darunter.
  // WICHTIG: Im Browser misst jsPDF die Breite von FETTEM Text falsch (zu
  // schmal) → der Titel würde nach rechts rutschen. Darum messen wir die
  // Breite über den zuverlässigen Kursiv-Stil und rechnen sie auf Fett hoch.
  doc.setTextColor(20);
  const cx = w / 2;
  const mitte = h / 2;
  const BOLD_FAKTOR = 1.04; // Times Bold ist ~4 % breiter als Kursiv

  const zentriert = (text: string, size: number, style: string, y: number) => {
    doc.setFont(fontName, style);
    doc.setFontSize(size);
    const tw = doc.getTextWidth(text);
    doc.text(text, cx - tw / 2, y);
  };

  // Titelgröße bestimmen (über Kursiv-Breite × Bold-Faktor)
  const titelText = sauber(opts.title || "Mein Roman");
  let titelSize = 20;
  doc.setFont(fontName, "italic");
  doc.setFontSize(titelSize);
  while (
    titelSize > 13 &&
    doc.getTextWidth(titelText) * BOLD_FAKTOR > bodyWidth
  ) {
    titelSize -= 0.5;
    doc.setFontSize(titelSize);
  }
  const twTitel = doc.getTextWidth(titelText) * BOLD_FAKTOR;

  // Autor (oben, kursiv)
  zentriert(sauber(opts.author || "Sonja Paredes Pernía"), 12, "italic", mitte - 42);
  // Titel (fett gezeichnet, aber über Kursiv-Breite zentriert)
  doc.setFont(fontName, "bold");
  doc.setFontSize(titelSize);
  doc.text(titelText, cx - twTitel / 2, mitte + titelSize * 0.35);
  // Untertitel (unten, kursiv): Roman | Erzählung | Gedicht
  zentriert(opts.untertitel || "Roman", 11, "italic", mitte + 46);
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
        const txt = sauber(child.textContent ?? "");
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
      const erzwingen =
        opts.chapterAlwaysNewPage === true || forceSet.has(raw.toLowerCase());
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
        zentriert ? "center" : opts.titelLinks ? "left" : "center",
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
    const align: Ausrichtung = zentriert
      ? "center"
      : opts.gedichtZentriert
        ? "center"
        : buch
          ? "justify"
          : "left";
    absatzRendern(tokens, align, 0, baseSize, buch, lineHeight);
    y += opts.paragraphSpaceAfterPt;
  }

  seitenzahl();

  const safeName =
    (opts.title || "roman").toLowerCase().replace(/[^a-z0-9äöüß]+/gi, "-") +
    ".pdf";
  doc.save(safeName);
}
