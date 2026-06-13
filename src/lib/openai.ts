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
 * Systemanweisung – die App verhält sich wie ein professioneller Lektor.
 * Der Text kommt als HTML (mit Formatierung). Inhalt, Stil UND Formatierung
 * bleiben unangetastet; es wird ausschließlich korrigiert.
 */
const LEKTOR_SYSTEM_PROMPT = `Du bist ein professioneller deutscher Lektor und Korrektor für Romanmanuskripte.

Der Text wird dir als HTML übergeben (Tags wie <p>, <em>, <strong>, <blockquote>, <h1>, <br> sowie style="text-align:center").

DEINE EINZIGE AUFGABE: Den Textinhalt korrigieren – ohne Inhalt, Stil oder Formatierung zu verändern.

DU KORRIGIERST nur den sichtbaren Text:
- Rechtschreibung, Grammatik, Zeichensetzung
- deutsche Anführungszeichen („…") und verschachtelte (‚…')
- offensichtliche Tippfehler (z. B. „uuf" → „auf")
- sinngemäß bzw. im Kontext falsch gewählte Wörter, die eindeutig ein Fehler sind und die gemeinte Aussage verfehlen (z. B. „Das Buch stand auf dem Tisch" → „Das Buch lag auf dem Tisch"; „Sie nahm den Hörer ab und legte auf" nur, wenn eindeutig falsch). Ändere ein Wort NUR, wenn es klar ein Fehler ist – niemals aus reinem Stilgeschmack.
- formale Roman-Konventionen (Gedankenstriche, Auslassungspunkte …)

DU VERÄNDERST NIEMALS:
- den Schreibstil, den Satzbau (sofern grammatisch korrekt)
- den Inhalt, die Bedeutung, die Aussage
Du schreibst keine korrekten Sätze um, kürzt nichts, ergänzt nichts, interpretierst nichts. Wortänderungen nur bei echten Fehlern (siehe oben), nicht zur Stilverbesserung.

ABSOLUT WICHTIG ZUR FORMATIERUNG:
- Behalte ALLE HTML-Tags exakt an derselben Stelle bei (öffnend und schließend).
- Ändere keine Tags, keine Attribute, keine Reihenfolge, keine Struktur.
- Füge keine neuen Tags hinzu und entferne keine.
- Korrigiere ausschließlich den Text ZWISCHEN den Tags.

UNKLARE STELLEN behältst du unverändert bei.

AUSGABE: Gib AUSSCHLIESSLICH das korrigierte HTML zurück – ohne Markdown-Codeblöcke,
ohne Erklärungen, ohne Kommentare. Nur das HTML.`;

export async function lektoriereHtml(html: string): Promise<string> {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const completion = await getClient().chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: LEKTOR_SYSTEM_PROMPT },
      { role: "user", content: html },
    ],
  });

  let out = completion.choices[0]?.message?.content?.trim() ?? html;
  // Falls das Modell doch einen Codeblock drumherum setzt, entfernen.
  out = out.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
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

export async function stilVerbessernHtml(html: string): Promise<string> {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const completion = await getClient().chat.completions.create({
    model,
    temperature: 0.6,
    messages: [
      { role: "system", content: STIL_SYSTEM_PROMPT },
      { role: "user", content: html },
    ],
  });

  let out = completion.choices[0]?.message?.content?.trim() ?? html;
  out = out.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return out || html;
}
