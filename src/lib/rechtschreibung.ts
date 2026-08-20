// Rechtschreibprüfung ohne KI und ohne Internet: ein deutsches Wörterbuch
// (Hunspell/igerman98) liegt unter /woerterbuch im Projekt und wird beim
// ersten Bedarf nachgeladen. Danach läuft alles im Browser.
//
// Zwei Vorkehrungen gegen Fehlalarme:
//  1. Zusammensetzungen („Küchentisch") kennt das Wörterbuch nicht – die
//     zerlegen wir selbst in bekannte Teile.
//  2. Gemeldet wird nur, wenn es ein ähnliches richtiges Wort gibt. Ein
//     erfundenes Wort bleibt so unbehelligt, ein Vertipper nicht.

import type { Fund } from "./pruefung";

/* eslint-disable @typescript-eslint/no-explicit-any */
let woerterbuch: any = null;
let laden: Promise<void> | null = null;
let stand = 0; // zählt hoch, wenn sich das Ergebnis ändern kann

const EIGENE = "novelista_eigene_woerter";
let eigene: Set<string> | null = null;

function eigeneWoerter(): Set<string> {
  if (eigene) return eigene;
  eigene = new Set<string>();
  try {
    const roh = localStorage.getItem(EIGENE);
    if (roh) for (const w of JSON.parse(roh) as string[]) eigene.add(w);
  } catch {}
  return eigene;
}

/** Erhöht sich, sobald das Wörterbuch bereit ist oder ein Wort dazukam. */
export function standDerPruefung(): number {
  return stand;
}

export function woerterbuchBereit(): boolean {
  return woerterbuch !== null;
}

/** Lädt das Wörterbuch einmalig nach (etwa 1 MB, danach im Browser-Cache). */
export function woerterbuchLaden(): Promise<void> {
  if (woerterbuch) return Promise.resolve();
  if (laden) return laden;
  laden = (async () => {
    const [aff, dic] = await Promise.all([
      fetch("/woerterbuch/de.aff").then((r) => r.text()),
      fetch("/woerterbuch/de.dic").then((r) => r.text()),
    ]);
    const mod: any = await import("nspell");
    const nspell = mod.default ?? mod;
    woerterbuch = nspell(aff, dic);
    cache.clear();
    stand += 1;
  })().catch(() => {
    laden = null; // beim nächsten Versuch noch einmal probieren
  }) as Promise<void>;
  return laden;
}

/** Nimmt ein Wort dauerhaft ins eigene Wörterbuch auf (Namen, Orte …). */
export function wortMerken(wort: string): void {
  const menge = eigeneWoerter();
  menge.add(wort);
  cache.clear();
  stand += 1;
  const liste: string[] = [];
  menge.forEach((x) => liste.push(x));
  try {
    localStorage.setItem(EIGENE, JSON.stringify(liste));
  } catch {}
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyzäöüß";
const NUR_DEUTSCH = /^[A-Za-zÄÖÜäöüß]+$/;
const FUGEN = ["s", "es", "n", "en", "e"];

// merkt sich pro Wort: null = in Ordnung, sonst die Vorschläge
const cache = new Map<string, string[] | null>();

const gross = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const klein = (w: string) => w.charAt(0).toLowerCase() + w.slice(1);

function imWoerterbuch(w: string): boolean {
  if (!woerterbuch) return true;
  const menge = eigeneWoerter();
  if (menge.has(w) || menge.has(klein(w))) return true;
  return (
    woerterbuch.correct(w) ||
    woerterbuch.correct(gross(w)) ||
    woerterbuch.correct(klein(w))
  );
}

/** „Küchentisch" = „Küchen" + „Tisch": beide Teile bekannt → in Ordnung. */
function istZusammensetzung(w: string): boolean {
  for (let i = 3; i <= w.length - 3; i++) {
    const rechts = w.slice(i);
    if (!imWoerterbuch(rechts)) continue;
    const links = w.slice(0, i);
    if (imWoerterbuch(links) || imWoerterbuch(links + "e")) return true;
    for (const f of FUGEN) {
      if (links.length > f.length + 2 && links.endsWith(f)) {
        if (imWoerterbuch(links.slice(0, -f.length))) return true;
      }
    }
  }
  return false;
}

/** Richtige Wörter, die sich nur um einen Buchstaben unterscheiden. */
function vorschlaege(w: string): string[] {
  const kl = w.toLowerCase();
  const istGross = w.charAt(0) !== klein(w).charAt(0);
  const kandidaten = new Set<string>();
  for (let i = 0; i < kl.length; i++) {
    kandidaten.add(kl.slice(0, i) + kl.slice(i + 1)); // Buchstabe zu viel
    if (i + 1 < kl.length) {
      // zwei Buchstaben vertauscht
      kandidaten.add(kl.slice(0, i) + kl[i + 1] + kl[i] + kl.slice(i + 2));
    }
    for (const c of ALPHABET) {
      kandidaten.add(kl.slice(0, i) + c + kl.slice(i + 1)); // falscher Buchstabe
      kandidaten.add(kl.slice(0, i) + c + kl.slice(i)); // Buchstabe fehlt
    }
  }
  for (const c of ALPHABET) kandidaten.add(kl + c);

  const treffer: string[] = [];
  kandidaten.forEach((k) => {
    if (k === kl || k.length < 3) return;
    const form = istGross ? gross(k) : k;
    if (woerterbuch.correct(form)) treffer.push(form);
  });

  // Wörter, die vorne am längsten übereinstimmen, sind die wahrscheinlichsten
  const gleicherAnfang = (a: string) => {
    const b = a.toLowerCase();
    let n = 0;
    while (n < b.length && n < kl.length && b[n] === kl[n]) n++;
    return n;
  };
  treffer.sort((a, b) => gleicherAnfang(b) - gleicherAnfang(a));
  return treffer.slice(0, 3);
}

/** Sucht Wörter, die so nicht im Wörterbuch stehen. */
export function pruefeRechtschreibung(text: string): Fund[] {
  if (!woerterbuch) return [];
  const funde: Fund[] = [];
  const woerter = /[A-Za-zÄÖÜäöüß]{3,}/g;
  let m: RegExpExecArray | null;
  while ((m = woerter.exec(text))) {
    const wort = m[0];
    if (!NUR_DEUTSCH.test(wort)) continue;
    if (wort === wort.toUpperCase() && wort.length > 3) continue; // ABKÜRZUNGEN

    let vor = cache.get(wort);
    if (vor === undefined) {
      if (imWoerterbuch(wort) || istZusammensetzung(wort)) {
        vor = null;
      } else {
        const v = vorschlaege(wort);
        vor = v.length ? v : null; // ohne ähnliches Wort lieber schweigen
      }
      cache.set(wort, vor);
    }
    if (!vor) continue;

    funde.push({
      von: m.index,
      bis: m.index + wort.length,
      meldung: `\u201E${wort}\u201C steht so nicht im Wörterbuch.`,
      ersatz: vor[0],
      vorschlaege: vor,
      wort,
    });
  }
  return funde;
}
