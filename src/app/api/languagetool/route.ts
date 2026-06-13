import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Korrektur über den kostenlosen öffentlichen LanguageTool-Dienst.
// Rechtschreibung, Grammatik und Zeichensetzung für Deutsch.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  let text: string;
  try {
    const body = await request.json();
    text = typeof body?.text === "string" ? body.text : "";
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  if (!text.trim()) {
    return NextResponse.json({ matches: [] });
  }

  try {
    const params = new URLSearchParams();
    params.set("text", text);
    params.set("language", "de-DE");

    const res = await fetch("https://api.languagetool.org/v2/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Prüfdienst nicht erreichbar." },
        { status: 502 }
      );
    }

    const data = await res.json();
    // Nur Treffer mit einem konkreten Korrekturvorschlag weitergeben
    const matches = (data?.matches ?? [])
      .map((m: {
        offset: number;
        length: number;
        replacements?: { value: string }[];
      }) => ({
        offset: m.offset,
        length: m.length,
        replacement: m.replacements?.[0]?.value ?? null,
      }))
      .filter((m: { replacement: string | null }) => m.replacement !== null);

    return NextResponse.json({ matches });
  } catch (err) {
    console.error("LanguageTool fehlgeschlagen:", err);
    return NextResponse.json(
      { error: "Die Prüfung ist gerade nicht verfügbar." },
      { status: 502 }
    );
  }
}
