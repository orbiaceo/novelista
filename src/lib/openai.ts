import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
- offensichtliche Tippfehler
- formale Roman-Konventionen (Gedankenstriche, Auslassungspunkte …)

DU VERÄNDERST NIEMALS:
- den Schreibstil, die Wortwahl, den Satzbau (sofern grammatisch korrekt)
- den Inhalt, die Bedeutung, die Aussage
Du schreibst nichts um, kürzt nichts, ergänzt nichts, interpretierst nichts.

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

  const completion = await openai.chat.completions.create({
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
