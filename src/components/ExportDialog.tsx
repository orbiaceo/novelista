"use client";

import { useState } from "react";
import type { PdfFont } from "@/lib/pdf";

interface Props {
  title: string;
  html: string;
  onClose: () => void;
}

// Gängige Buchformate (Breite × Höhe in cm)
const FORMATE: Record<string, { w: number; h: number }> = {
  "Taschenbuch (12,5 × 20,6)": { w: 12.5, h: 20.6 },
  "Roman (13,5 × 21,5)": { w: 13.5, h: 21.5 },
  "Hardcover (15,5 × 23,5)": { w: 15.5, h: 23.5 },
  "A5 (14,8 × 21,0)": { w: 14.8, h: 21.0 },
};

export default function ExportDialog({ title, html, onClose }: Props) {
  const [format, setFormat] = useState(Object.keys(FORMATE)[0]);
  const [margin, setMargin] = useState(2.0);
  const [fontSize, setFontSize] = useState(11);
  const [font, setFont] = useState<PdfFont>("Serif");
  const [busy, setBusy] = useState(false);

  async function exportieren() {
    setBusy(true);
    try {
      const { manuskriptAlsPdf } = await import("@/lib/pdf");
      const f = FORMATE[format];
      manuskriptAlsPdf(html, {
        title,
        widthCm: f.w,
        heightCm: f.h,
        marginCm: margin,
        fontSizePt: fontSize,
        font,
      });
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
          Dein Manuskript wird druckfertig gesetzt – mit Kapitelanfängen und
          Seitenzahlen.
        </p>

        <div className="mt-6 space-y-5">
          <Feld label="Buchformat">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="w-full rounded-lg border border-line bg-white/70 px-3 py-2.5 text-ink outline-none focus:border-oxblood"
            >
              {Object.keys(FORMATE).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
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
                      : "border-line bg-white/70 text-ink-soft hover:border-ink-faint"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </Feld>

          <div className="grid grid-cols-2 gap-4">
            <Feld label={`Seitenrand: ${margin.toFixed(1)} cm`}>
              <input
                type="range"
                min={1}
                max={3.5}
                step={0.1}
                value={margin}
                onChange={(e) => setMargin(parseFloat(e.target.value))}
                className="w-full accent-oxblood"
              />
            </Feld>
            <Feld label={`Schriftgröße: ${fontSize} pt`}>
              <input
                type="range"
                min={9}
                max={14}
                step={0.5}
                value={fontSize}
                onChange={(e) => setFontSize(parseFloat(e.target.value))}
                className="w-full accent-oxblood"
              />
            </Feld>
          </div>
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
