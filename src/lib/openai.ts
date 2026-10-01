import OpenAI from "openai";

// Der Client wird erst beim ersten Aufruf erzeugt, nicht schon beim Laden
// der Datei. So braucht der Build (next build) keinen API-Schlüssel.
let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

/**
 * Systemanweisung für „Korrigieren“ – bewusst eng gefasst: nur Rechtschreibung
 * und Zeichensetzung. Anführungszeichen werden weder ergänzt noch verändert,
 * weil die KI sie früher an falsche Stellen gesetzt hat. Inhalt, Wortwahl,
 * Grammatik, Stil und Formatierung bleiben unangetastet.
 */
const LEKTOR_SYSTEM_PROMPT = `Du bist ein deutscher Korrektor für Romanmanuskripte.

Der Text wird dir als HTML übergeben (Tags wie <p>, <em>, <strong>, <blockquote>, <h1>, <br> sowie style="text-align:center").

DEINE EINZIGE AUFGABE: Rechtschreibung und Zeichensetzung korrigieren. Sonst nichts.

DU KORRIGIERST ausschließlich:
- Rechtschreibung und offensichtliche Tippfehler (z. B. „uuf“ → „auf“, „kan“ → „kann“)
- Groß- und Kleinschreibung
- Zeichensetzung: fehlende oder falsche Kommas, Punkte, Frage- und Ausrufezeichen
- Leerzeichen: fehlende Leerzeichen nach einem Satzzeichen; doppelte Leerzeichen werden zu einem

ANFÜHRUNGSZEICHEN RÜHRST DU NICHT AN – DIESE REGEL IST UNANTASTBAR:
- Füge NIEMALS Anführungszeichen oder Gänsefüßchen hinzu. Auch nicht bei wörtlicher Rede. Auch nicht, wenn ein Redebegleitsatz wie „sagte er“, „fragte sie“ oder „rief Mara“ danebensteht. Auch nicht nach einem Doppelpunkt.
- Entferne, verschiebe oder ersetze KEINE vorhandenen Anführungszeichen. Jedes Anführungszeichen bleibt genau so und genau dort, wie es im Text steht – auch gerade Anführungszeichen (") bleiben unverändert stehen.
- Das gilt auch dann, wenn die Zeichensetzung dadurch unvollständig oder unsauber wirkt. Die Autorin setzt ihre Gänsefüßchen selbst. Das ist so gewollt.

DU VERÄNDERST NIEMALS:
- einzelne Wörter, auch wenn dir ein anderes treffender oder richtiger erscheint
- den Satzbau, die Wortstellung, die Zeitformen, die Grammatik
- den Inhalt, die Bedeutung, die Aussage, den Stil
- die Absatzaufteilung
Ein Wort, das richtig geschrieben ist, bleibt stehen – auch wenn es inhaltlich oder grammatisch fragwürdig wirkt. Du schreibst keinen Satz um, kürzt nichts, ergänzt keinen Inhalt, interpretierst nichts.

ZU DEN LEERZEICHEN ZWISCHEN DEN SÄTZEN:
Nach einem Satzende (Punkt, Fragezeichen, Ausrufezeichen – auch nach einem schließenden Anführungszeichen) MUSS genau EIN Leerzeichen vor dem nächsten Satz stehen. Entferne dieses Leerzeichen NIEMALS und klebe zwei Sätze nie zusammen. Falsch wäre: >…keine Zeit.“Sie…<

ABSOLUT WICHTIG ZUR FORMATIERUNG:
- Behalte ALLE HTML-Tags exakt an derselben Stelle bei (öffnend und schließend).
- Ändere keine Tags, keine Attribute, keine Reihenfolge, keine Struktur.
- Füge keine neuen Tags hinzu und entferne keine.
- Korrigiere ausschließlich den Text ZWISCHEN den Tags.

UNKLARE STELLEN behältst du unverändert bei.

AUSGABE: Gib AUSSCHLIESSLICH das korrigierte HTML zurück – ohne Markdown-Codeblöcke,
ohne Erklärungen, ohne Kommentare. Nur das HTML.`;

const VERS_HINWEIS = `

ACHTUNG – DIES IST EIN GEDICHT, KEINE PROSA:
- Der Text besteht aus Versen. Jeder Zeilenumbruch <br> markiert ein Vers-Ende und MUSS exakt erhalten bleiben.
- Entferne KEINE <br> und füge KEINE hinzu. Fasse Verse NIEMALS zu einem Fließtext-Absatz zusammen. Ändere die Zeilenaufteilung nicht.
- Korrigiere nur INNERHALB der Verse (Rechtschreibung, klare Tippfehler).
- In Gedichten ist Zeichensetzung oft bewusst reduziert oder fehlt – ergänze KEINE Satzzeichen und KEINE Anführungszeichen, außer es ist ein eindeutiger Fehler.`;

// Sicherheitsnetz: Falls die KI trotz Anweisung das Leerzeichen zwischen zwei
// Sätzen entfernt (z. B. >Zeit.“Sie<), wird es hier wiederhergestellt.
function satzabstandReparieren(text: string): string {
  return text.replace(
    /([.!?][)»"'“”\u00BB\u201C\u201D]?)([A-ZÄÖÜ])/g,
    "$1 $2"
  );
}

// Wandelt gerade DOPPELTE Anführungszeichen ("…") in die deutschen („…") um –
// nur im sichtbaren Text, niemals in HTML-Tags. Einfache gerade Zeichen bleiben
// unangetastet, weil sie im Deutschen meist Apostrophe sind (z. B. „geht's").
function textAnfuehrung(t: string): string {
  let offen = false;
  let out = "";
  for (const ch of t) {
    if (ch === "\u201E") {
      offen = true; // schon vorhandenes „ (öffnend)
      out += ch;
    } else if (ch === "\u201C") {
      offen = false; // schon vorhandenes “ (schließend)
      out += ch;
    } else if (ch === '"') {
      out += offen ? "\u201C" : "\u201E";
      offen = !offen;
    } else {
      out += ch;
    }
  }
  return out;
}

function deutscheAnfuehrung(html: string): string {
  // Tags bleiben unangetastet (ungerade Indizes), nur Text wird gewandelt.
  return html
    .split(/(<[^>]+>)/)
    .map((teil, i) => (i % 2 === 0 ? textAnfuehrung(teil) : teil))
    .join("");
}

export async function lektoriereHtml(
  html: string,
  gedicht = false
): Promise<string> {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const completion = await getClient().chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: gedicht ? LEKTOR_SYSTEM_PROMPT + VERS_HINWEIS : LEKTOR_SYSTEM_PROMPT,
      },
      { role: "user", content: html },
    ],
  });

  let out = completion.choices[0]?.message?.content?.trim() ?? html;
  // Falls das Modell doch einen Codeblock drumherum setzt, entfernen.
  out = out.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // Anführungszeichen bleiben beim Korrigieren unangetastet – auch gerade.
  out = satzabstandReparieren(out);
  return out || html;
}

/**
 * Systemanweisung für „Schöner schreiben" – formuliert eleganter,
 * ohne Sinn oder Formatierung zu verändern.
 */
const STIL_SYSTEM_PROMPT = `Du bist ein erfahrener deutscher Literaturlektor.

Der Text wird dir als HTML übergeben (Tags wie <p>, <em>, <strong>, <blockquote>, <h1>, <br>).

DEINE AUFGABE: Formuliere den Text sprachlich schöner und eleganter – flüssigere Sätze, treffendere Wörter, besserer Rhythmus – OHNE die Bedeutung, die Aussage oder die Handlung zu verändern. Behalte die Stimme und den Ton der Autorin bei; mache den Text nicht künstlicher oder geschwollener, sondern natürlicher und klarer.

REGELN:
- Verändere niemals den Inhalt oder die Bedeutung.
- Behalte ALLE HTML-Tags exakt bei (öffnend und schließend, gleiche Stellen). Korrigiere/verbessere nur den Text ZWISCHEN den Tags.
- Verwende deutsche Anführungszeichen („…").
- Erfinde nichts dazu, kürze keine Inhalte weg.

AUSGABE: Gib AUSSCHLIESSLICH das überarbeitete HTML zurück – ohne Markdown, ohne Erklärungen.`;

export async function stilVerbessernHtml(
  html: string,
  gedicht = false
): Promise<string> {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const completion = await getClient().chat.completions.create({
    model,
    temperature: 0.6,
    messages: [
      {
        role: "system",
        content: gedicht ? STIL_SYSTEM_PROMPT + VERS_HINWEIS : STIL_SYSTEM_PROMPT,
      },
      { role: "user", content: html },
    ],
  });

  let out = completion.choices[0]?.message?.content?.trim() ?? html;
  out = out.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
  out = deutscheAnfuehrung(out);
  out = satzabstandReparieren(out);
  return out || html;
}
