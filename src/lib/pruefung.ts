// Regelwerk für Zeichensetzung und Tippfehler – ohne KI, rein nach Regeln.
// Absichtlich KEINE Wortschatz- oder Rechtschreibprüfung: nur Dinge, die
// sich mit hoher Sicherheit als Fehler erkennen lassen. Lieber eine
// Regel weniger als ständige Fehlalarme.

export interface Fund {
  von: number; // Zeichen-Index im Text des Absatzes
  bis: number;
  meldung: string;
  ersatz?: string; // ersetzt den Bereich von..bis, wenn „Beheben" gedrückt wird
  vorschlaege?: string[]; // mehrere Möglichkeiten (Rechtschreibung)
  wort?: string; // das beanstandete Wort, für „Wort merken"
}

/** Sortiert Funde und wirft Überschneidungen weg (der frühere gewinnt). */
export function entwirre(funde: Fund[]): Fund[] {
  const sortiert = [...funde].sort((a, b) => a.von - b.von || a.bis - b.bis);
  const sauber: Fund[] = [];
  let bisher = -1;
  for (const f of sortiert) {
    if (f.von < bisher) continue;
    sauber.push(f);
    bisher = f.bis;
  }
  return sauber;
}

const SATZZEICHEN = ".,;:!?";

const NAMEN: Record<string, string> = {
  ".": "Punkt",
  ",": "Komma",
  ";": "Semikolon",
  ":": "Doppelpunkt",
  "!": "Ausrufezeichen",
  "?": "Fragezeichen",
};

// Wörter, die sich im Deutschen durchaus verdoppeln dürfen
// („das Haus, das das Dach trägt")
const DOPPELT_ERLAUBT = new Set([
  "das", "die", "der", "dem", "den", "des", "und", "sie", "ja", "nein",
  "nie", "nur", "sehr", "ganz", "immer", "weit",
]);

// Nach diesen Wörtern steht vor „dass/weil …" kein zusätzliches Komma
const KEIN_KOMMA_DAVOR = new Set([
  "und", "oder", "aber", "sowie", "denn", "sondern",
]);

const KONJUNKTIONEN = ["dass", "weil", "obwohl", "sondern", "falls", "sobald", "nachdem"];

// Kleingeschriebene Abkürzungen dürfen einen Satz beginnen
const ABKUERZUNGEN = new Set([
  "ca", "bzw", "usw", "evtl", "ggf", "sog", "vgl", "ebd", "bspw", "inkl",
]);

function istBuchstabe(z: string | undefined): boolean {
  return !!z && /[A-Za-zÄÖÜäöüß]/.test(z);
}

export function pruefe(text: string): Fund[] {
  const funde: Fund[] = [];
  const add = (von: number, bis: number, meldung: string, ersatz?: string) =>
    funde.push({ von, bis, meldung, ersatz });

  // ---- 1. Fehlendes Leerzeichen nach einem Satzzeichen ----
  for (let i = 0; i < text.length; i++) {
    const z = text[i];
    if (!SATZZEICHEN.includes(z)) continue;
    const next = text[i + 1];
    const prev = text[i - 1];
    if (!next || /\s/.test(next)) continue;
    // direkt folgende Satz-/Schlusszeichen sind in Ordnung: ?!, .“, …), –
    if (SATZZEICHEN.includes(next)) continue;
    if ("\u201C\u2019\u00BB)]\u2026-\u2013\u2014".includes(next)) continue;
    // Zahlen: 1.000 · 12:30 · 3,5 · 12.5.2026
    if (/\d/.test(next)) continue;
    // Abkürzungen: z.B., d.h., u.a. – einzelner Buchstabe vor dem Punkt
    if (z === "." && istBuchstabe(prev) && !istBuchstabe(text[i - 2])) continue;
    add(
      i,
      i + 1,
      `Nach dem ${NAMEN[z]} fehlt ein Leerzeichen.`,
      z + " "
    );
  }

  // ---- 2. Leerzeichen VOR einem Satzzeichen ----
  const vorher = /[ \t]+([.,;:!?])/g;
  let m: RegExpExecArray | null;
  while ((m = vorher.exec(text))) {
    // Auslassungspunkte dürfen mit Abstand stehen: „er zögerte … dann"
    if (m[1] === "." && text[m.index + m[0].length] === ".") continue;
    add(
      m.index,
      m.index + m[0].length,
      `Vor dem ${NAMEN[m[1]]} steht ein Leerzeichen zu viel.`,
      m[1]
    );
  }

  // ---- 3. Mehrere Leerzeichen hintereinander ----
  const doppelLeer = /[ ]{2,}/g;
  while ((m = doppelLeer.exec(text))) {
    add(m.index, m.index + m[0].length, "Hier stehen mehrere Leerzeichen.", " ");
  }

  // ---- 4. Doppelte Satzzeichen ----
  const doppelZeichen = /([,;:])\1+/g;
  while ((m = doppelZeichen.exec(text))) {
    add(
      m.index,
      m.index + m[0].length,
      `Das ${NAMEN[m[1]]} steht doppelt.`,
      m[1]
    );
  }
  const vielePunkte = /\.{4,}/g;
  while ((m = vielePunkte.exec(text))) {
    add(
      m.index,
      m.index + m[0].length,
      "Auslassungspunkte sind genau drei Punkte.",
      "..."
    );
  }

  // ---- 5. Gerade Anführungszeichen ----
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    const prev = text[i - 1];
    const oeffnend = prev === undefined || /[\s(\[\u2013\u2014]/.test(prev);
    add(
      i,
      i + 1,
      "Gerades Anführungszeichen – im Deutschen \u201E \u2026 \u201C.",
      oeffnend ? "\u201E" : "\u201C"
    );
  }

  // ---- 6. Gänsefüßchen, die nicht schließen (oder umgekehrt) ----
  let offen = -1;
  for (let i = 0; i < text.length; i++) {
    const z = text[i];
    if (z === "\u201E") {
      if (offen >= 0) {
        add(offen, offen + 1, "Hier fehlt das schließende Gänsefüßchen \u201C.");
      }
      offen = i;
    } else if (z === "\u201C") {
      if (offen < 0) {
        add(
          i,
          i + 1,
          "Dieses Gänsefüßchen schließt eine Rede, die nicht geöffnet wurde."
        );
      } else {
        offen = -1;
      }
    }
  }
  if (offen >= 0) {
    add(offen, offen + 1, "Hier fehlt das schließende Gänsefüßchen \u201C.");
  }

  // ---- 7. Wort doppelt getippt ----
  const doppelWort = /([A-Za-zÄÖÜäöüß]{3,})([ ]+)\1(?![A-Za-zÄÖÜäöüß])/g;
  while ((m = doppelWort.exec(text))) {
    if (DOPPELT_ERLAUBT.has(m[1].toLowerCase())) continue;
    if (istBuchstabe(text[m.index - 1])) continue;
    add(
      m.index,
      m.index + m[0].length,
      `\u201E${m[1]}\u201C steht zweimal hintereinander.`,
      m[1]
    );
  }

  // ---- 8. Nach dem Satzende: Großschreibung bzw. Komma nach der Rede ----
  const kleinDanach = /([.!?])([\u201C"\u00BB]?)([ ]+)([a-zäöüß])/g;
  while ((m = kleinDanach.exec(text))) {
    const i = m.index;
    const prev = text[i - 1];
    if (prev === ".") continue; // Auslassungspunkte
    if (/\d/.test(prev ?? "")) continue; // Ordnungszahl: „am 3. tag" ist erlaubt
    if (m[1] === "." && istBuchstabe(prev) && !istBuchstabe(text[i - 2])) continue;
    // Abkürzung VOR dem Punkt: „Es ist ca. drei Kilo schwer."
    const wortDavor = /([A-Za-zÄÖÜäöüß]+)$/.exec(text.slice(0, i))?.[1] ?? "";
    if (m[1] === "." && ABKUERZUNGEN.has(wortDavor.toLowerCase())) continue;
    // Der nächste Satz beginnt mit einer Abkürzung: „… geht. z. B. das Haus"
    const danach = text.slice(i + m[0].length - 1);
    const wort = /^[A-Za-zÄÖÜäöüß]+\.?/.exec(danach)?.[0] ?? "";
    if (/^[a-zäöü]\.$/.test(wort)) continue;
    if (ABKUERZUNGEN.has(wort.replace(".", "").toLowerCase())) continue;

    if (m[2]) {
      // Wörtliche Rede, danach der Redebegleitsatz: „…“ sagte sie
      if (m[1] === ".") {
        add(
          i,
          i + m[0].length,
          "Vor dem Redebegleitsatz steht ein Komma statt des Punktes.",
          m[2] + "," + m[3] + m[4]
        );
      } else {
        add(
          i,
          i + m[0].length,
          "Nach der wörtlichen Rede fehlt ein Komma.",
          m[1] + m[2] + "," + m[3] + m[4]
        );
      }
      continue;
    }

    add(
      i,
      i + m[0].length,
      "Nach dem Satzende wird großgeschrieben.",
      m[1] + m[3] + m[4].toUpperCase()
    );
  }

  // ---- 9. Komma vor Bindewörtern (nur die eindeutigen) ----
  const konj = new RegExp(
    `([^\\s])[ ]+(${KONJUNKTIONEN.join("|")})(?![A-Za-zÄÖÜäöüß])`,
    "g"
  );
  while ((m = konj.exec(text))) {
    const davor = m[1];
    if (",;:!?\u201E\u201C(-\u2013\u2014".includes(davor)) continue;
    const konjDavor = /([A-Za-zÄÖÜäöüß]+)$/.exec(text.slice(0, m.index + 1));
    if (konjDavor && KEIN_KOMMA_DAVOR.has(konjDavor[1].toLowerCase())) continue;
    add(
      m.index,
      m.index + 1,
      `Vor \u201E${m[2]}\u201C fehlt vermutlich ein Komma.`,
      davor + ","
    );
  }

  // ---- Überschneidungen entfernen (die frühere Regel gewinnt) ----
  return entwirre(funde);
}
