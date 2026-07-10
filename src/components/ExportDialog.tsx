"use client";

import { useState } from "react";
import type { PdfFont, SatzArt } from "@/lib/pdf";

interface Props {
  title: string;
  html: string;
  onClose: () => void;
}

// Exakte Werte der finalen BoD-Maquette von „Der Sog ins Nichts"
// (aus dem Satz-Skript build_half.py).
const BOD = {
  widthCm: 12,
  heightCm: 19,
  marginInnerCm: 1.7, // Bundsteg
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

export default function ExportDialog({ title, html, onClose }: Props) {
  const [font, setFont] = useState<PdfFont>("Serif");
  const [satz, setSatz] = useState<SatzArt>("buch");
  const [busy, setBusy] = useState(false);

  async function exportieren() {
    setBusy(true);
    try {
      const { manuskriptAlsPdf } = await import("@/lib/pdf");
      manuskriptAlsPdf(html, { title, font, satz, ...BOD });
      onClose();
    } finally {
      setBusy(false);
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
        <h2 className="font-serif text-2xl text-ink">Als Buch-PDF exportieren</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Gesetzt im finalen Druckformat – so, wie die gedruckte Fassung bei BoD
          aussehen wird.
        </p>

        <div className="mt-6 space-y-5">
          <Feld label="Druckformat (fest, wie BoD)">
            <div className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink">
              12 × 19 cm · Spiegelränder 17/13/14/15 mm
              <br />
              9,5 pt · Zeilenabstand 13,5 pt · Seitenzahlen außen
            </div>
          </Feld>

          <Feld label="Satz">
            <div className="flex gap-2">
              <button
                onClick={() => setSatz("buch")}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                  satz === "buch"
                    ? "border-oxblood bg-oxblood text-paper"
                    : "border-line bg-surface text-ink-soft hover:border-ink-faint"
                }`}
              >
                Buchsatz
              </button>
              <button
                onClick={() => setSatz("flatter")}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                  satz === "flatter"
                    ? "border-oxblood bg-oxblood text-paper"
                    : "border-line bg-surface text-ink-soft hover:border-ink-faint"
                }`}
              >
                Flattersatz
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-faint">
              {satz === "buch"
                ? "Blocksatz mit deutscher Silbentrennung – genau wie die Druckfassung."
                : "Linksbündig, ohne Silbentrennung – zum Einreichen bei Agenturen und Verlagen."}
            </p>
          </Feld>

          <Feld label="Schriftart">
            <div className="flex gap-2">
              {(["Serif", "Sans", "Schreibmaschine"] as PdfFont[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFont(f)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                    font === f
                      ? "border-oxblood bg-oxblood text-paper"
                      : "border-line bg-surface text-ink-soft hover:border-ink-faint"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-faint">
              Die Druckfassung nutzt Caladea (≈ Cambria). „Serif" kommt dem am
              nächsten und ist für die Vorschau empfohlen.
            </p>
          </Feld>
        </div>

        <div className="mt-8 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-line px-4 py-3 text-ink-soft transition hover:bg-paper-dim"
          >
            Abbrechen
          </button>
          <button
            onClick={exportieren}
            disabled={busy}
            className="flex-1 rounded-xl bg-ink px-4 py-3 font-medium text-paper transition hover:bg-oxblood disabled:opacity-60"
          >
            {busy ? "Erstelle PDF …" : "PDF erstellen"}
          </button>
        </div>
      </div>
    </div>
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
      <span className="mb-2 block text-sm font-medium text-ink-soft">
        {label}
      </span>
      {children}
    </label>
  );
}
