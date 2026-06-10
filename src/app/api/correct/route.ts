import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lektoriereHtml } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  let html: string;
  try {
    const body = await request.json();
    html = typeof body?.html === "string" ? body.html : "";
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  if (!html.trim()) {
    return NextResponse.json({ corrected: html });
  }

  try {
    const corrected = await lektoriereHtml(html);
    return NextResponse.json({ corrected });
  } catch (err) {
    console.error("Korrektur fehlgeschlagen:", err);
    return NextResponse.json(
      { error: "Die Korrektur konnte gerade nicht durchgeführt werden." },
      { status: 502 }
    );
  }
}
