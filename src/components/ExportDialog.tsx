"use client";

import { useState } from "react";
import type { PdfFont, SatzArt } from "@/lib/pdf";

interface Props {
  title: string;
  html: string;
  art: string; // "roman" | "erzaehlung" | "gedicht"
  onClose: () => void;
}

// Exakte Werte der finalen BoD-Maquette von „Der Sog ins Nichts".
const BOD = {
  widthCm: 12,
  heightCm: 19,
  marginInnerCm: 1.7,
  marginOuterCm: 1.3,
  marginTopCm: 1.4,
  marginBottomCm: 1.5,
  fontSizePt: 9.5,
  leadingPt: 13.5,
  paragraphSpaceAfterPt: 6,
  hyphenMinChars: 7,
  chapterFontSizePt: 12,
  chapterLeadingPt: 16,
  chapterSpaceBeforePt: 14,
  chapterSpaceAfterPt: 10,
  condChapterBreakCm: 3.0,
  forceBreakTitles: ["Das Erdbeben"],
  folioStart: 5,
  pageNumberSizePt: 8,
};

// Formate für Erzählung/Gedicht (symmetrische Ränder)
const FORMATE: Record<string, { widthCm: number; heightCm: number; rand: number; unten: number }> = {
  "12x19": { widthCm: 12, heightCm: 19, rand: 1.5, unten: 1.7 },
  a5: { widthCm: 14.8, heightCm: 21.0, rand: 2.0, unten: 2.2 },
};

export default function ExportDialog({ title, html, art, onClose }: Props) {
  const istRoman = art === "roman";
  const istGedicht = art === "gedicht";
  const untertitel =
    art === "gedicht" ? "Gedicht" : art === "erzaehlung" ? "Erzählung" : "Roman";

  const [font, setFont] = useState<PdfFont>("Serif");
  const [satz, setSatz] = useState<SatzArt>("buch");
  const [format, setFormat] = useState<"12x19" | "a5">("12x19");
  const [ausrichtung, setAusrichtung] = useState<"links" | "zentriert">("links");
  const [busy, setBusy] = useState(false);
  const [busyDocx, setBusyDocx] = useState(false);

  async function exportieren() {
    setBusy(true);
    try {
      const { manuskriptAlsPdf } = await import("@/lib/pdf");
      if (istRoman) {
        manuskriptAlsPdf(html, { title, font, satz, untertitel: "Roman", ...BOD });
      } else {
        const f = FORMATE[format];
        manuskriptAlsPdf(html, {
          title,
          author: "Sonja Paredes Pernía",
          widthCm: f.widthCm,
          heightCm: f.heightCm,
          marginInnerCm: f.rand,
          marginOuterCm: f.rand,
          marginTopCm: f.rand,
          marginBottomCm: f.unten,
          fontSizePt: 11,
          leadingPt: 16,
          paragraphSpaceAfterPt: 8,
          hyphenMinChars: 7,
          font,
          satz: istGedicht ? "flatter" : satz,
          untertitel,
          gedichtZentriert: istGedicht && ausrichtung === "zentriert",
          titelLinks: istGedicht,
          chapterFontSizePt: 13,
          chapterLeadingPt: 17,
          chapterSpaceBeforePt: 14,
          chapterSpaceAfterPt: 10,
          condChapterBreakCm: 3.0,
          forceBreakTitles: [],
          folioStart: 1,
          pageNumberSizePt: 8,
        });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function exportierenDocx() {
    setBusyDocx(true);
    try {
      const { manuskriptAlsDocx } = await import("@/lib/docx");
      await manuskriptAlsDocx(html, title, "Sonja Paredes Pernía", untertitel);
      onClose();
    } finally {
      setBusyDocx(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/30 px-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="rise w-full max-w-md rounded-2xl border border-line bg-paper p-7 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-serif text-2xl text-ink">
          {istRoman ? "Als Buch-PDF exportieren" : "Als PDF exportieren"}
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          {istRoman
            ? "Gesetzt im finalen Druckformat – so, wie die gedruckte Fassung bei BoD aussehen wird."
            : "Mit Titelseite; der Text beginnt auf Seite 2."}
        </p>

        <div className="mt-6 space-y-5">
          {istRoman ? (
            <Feld label="Druckformat (fest, wie BoD)">
              <div className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink">
                12 × 19 cm · Spiegelränder 17/13/14/15 mm
                <br />
                9,5 pt · Zeilenabstand 13,5 pt · Seitenzahlen außen
              </div>
            </Feld>
          ) : (
            <Feld label="Format">
              <div className="flex gap-2">
                <Wahl aktiv={format === "12x19"} onClick={() => setFormat("12x19")}>
                  12 × 19 cm
                </Wahl>
                <Wahl aktiv={format === "a5"} onClick={() => setFormat("a5")}>
                  A5
                </Wahl>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                12 × 19 cm ist das Buchformat; A5 ist die halbe Blattgröße – gut
                zum Lesen und Ausdrucken zu Hause.
              </p>
            </Feld>
          )}

          {istGedicht ? (
            <Feld label="Ausrichtung der Verse">
              <div className="flex gap-2">
                <Wahl aktiv={ausrichtung === "links"} onClick={() => setAusrichtung("links")}>
                  Links
                </Wahl>
                <Wahl aktiv={ausrichtung === "zentriert"} onClick={() => setAusrichtung("zentriert")}>
                  Zentriert
                </Wahl>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                Verse werden nie getrennt oder gestreckt – jede Zeile bleibt genau
                so, wie du sie geschrieben hast.
              </p>
            </Feld>
          ) : (
            <Feld label="Satz">
              <div className="flex gap-2">
                <Wahl aktiv={satz === "buch"} onClick={() => setSatz("buch")}>
                  Buchsatz
                </Wahl>
                <Wahl aktiv={satz === "flatter"} onClick={() => setSatz("flatter")}>
                  Flattersatz
                </Wahl>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                {satz === "buch"
                  ? "Blocksatz mit deutscher Silbentrennung."
                  : "Linksbündig, ohne Silbentrennung – zum Einreichen bei Agenturen."}
              </p>
            </Feld>
          )}

          <Feld label="Schriftart">
            <div className="flex gap-2">
              {(["Serif", "Sans", "Schreibmaschine"] as PdfFont[]).map((f) => (
                <Wahl key={f} aktiv={font === f} onClick={() => setFont(f)}>
                  {f}
                </Wahl>
              ))}
            </div>
          </Feld>
        </div>

        <div className="mt-8 space-y-2">
          <button
            onClick={exportieren}
            disabled={busy || busyDocx}
            className="w-full rounded-xl bg-ink px-4 py-3 font-medium text-paper transition hover:bg-oxblood disabled:opacity-60"
          >
            {busy ? "Erstelle PDF …" : "PDF erstellen (Vorschau)"}
          </button>
          <button
            onClick={exportierenDocx}
            disabled={busy || busyDocx}
            className="w-full rounded-xl border border-line px-4 py-3 font-medium text-ink-soft transition hover:border-oxblood hover:text-oxblood disabled:opacity-60"
          >
            {busyDocx ? "Erstelle .docx …" : "Für den Satz exportieren (.docx)"}
          </button>
          <p className="px-1 pt-1 text-xs leading-relaxed text-ink-faint">
            Die <strong>PDF</strong> zeigt, wie es gedruckt aussieht. Die{" "}
            <strong>.docx</strong> ist die Vorlage für Claude als Verlag.
          </p>
          <button
            onClick={onClose}
            className="mt-1 w-full rounded-xl px-4 py-2.5 text-sm text-ink-soft transition hover:bg-paper-dim"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

function Wahl({
  aktiv,
  onClick,
  children,
}: {
  aktiv: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
        aktiv
          ? "border-oxblood bg-oxblood text-paper"
          : "border-line bg-surface text-ink-soft hover:border-ink-faint"
      }`}
    >
      {children}
    </button>
  );
}

function Feld({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
