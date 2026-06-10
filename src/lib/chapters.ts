export interface Kapitel {
  titel: string;
  zeileIndex: number; // Position im Textfeld (Zeichen-Offset)
  woerter: number;
}

export function zaehleWoerter(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/**
 * Erkennt eine Kapitelüberschrift.
 *
 * So einfach wie möglich: Eine Zeile gilt als Kapitelname, wenn sie
 * KURZ ist und ALLEIN steht – also eine Leerzeile darüber und darunter hat.
 * Du schreibst einfach den Titel in eine eigene Zeile (Leerzeile davor und
 * danach) und danach normal weiter. Es wird KEIN Wort "Kapitel" benötigt.
 *
 * Zusätzlich werden die klassischen Marker "# Titel", "Kapitel …", "Prolog"
 * usw. weiterhin akzeptiert.
 */
export function istKapitelzeile(
  line: string,
  vorher?: string,
  nachher?: string
): boolean {
  const t = line.trim();
  if (!t) return false;

  // Klassische Marker (optional, für Rückwärtskompatibilität)
  if (/^#{1,3}\s+/.test(t)) return true;
  if (/^(kapitel|prolog|epilog|teil)\b/i.test(t)) return true;

  // Automatische Erkennung: kurze, allein stehende Zeile
  const vorherLeer = vorher === undefined || vorher.trim() === "";
  const nachherLeer = nachher === undefined || nachher.trim() === "";
  const kurz = t.length <= 60 && zaehleWoerter(t) <= 8;
  // endet die Zeile wie ein Satz, ist es vermutlich kein Titel
  const endetWieSatz = /[.!?,;:"„""»«]$/.test(t);

  return vorherLeer && nachherLeer && kurz && !endetWieSatz;
}

/**
 * Bereinigt den angezeigten Titel: entfernt nur das optionale "# "-Zeichen.
 * Der reine Name bleibt unverändert – so steht links UND im PDF nur der Name.
 */
export function titelBereinigen(line: string): string {
  return line.replace(/^#{1,3}\s+/, "").trim();
}

/**
 * Liest das Manuskript und leitet automatisch die Kapitelübersicht ab.
 * Kein manuelles Anlegen nötig – die Struktur folgt dem Text.
 */
export function ermittleKapitel(content: string): Kapitel[] {
  const lines = content.split("\n");
  const kapitel: Kapitel[] = [];
  let offset = 0;
  let aktuell: { titel: string; index: number; text: string } | null = null;

  const abschliessen = () => {
    if (aktuell) {
      kapitel.push({
        titel: aktuell.titel,
        zeileIndex: aktuell.index,
        woerter: zaehleWoerter(aktuell.text),
      });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (istKapitelzeile(line, lines[i - 1], lines[i + 1])) {
      abschliessen();
      aktuell = { titel: titelBereinigen(line), index: offset, text: "" };
    } else if (aktuell) {
      aktuell.text += " " + line;
    }
    offset += line.length + 1; // +1 für das Zeilenumbruchzeichen
  }
  abschliessen();

  return kapitel;
}
