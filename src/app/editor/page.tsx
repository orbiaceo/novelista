import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EditorClient from "@/components/EditorClient";

export const dynamic = "force-dynamic";

export default async function EditorPage({
  searchParams,
}: {
  searchParams: { p?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Alle Projekte dieser Person laden (ohne den großen Inhalt – nur Übersicht)
  let { data: projekte } = await supabase
    .from("manuscripts")
    .select("id,title,status,word_count,updated_at,art")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  // Beim allerersten Mal ein leeres Projekt anlegen
  if (!projekte || projekte.length === 0) {
    const { data: created } = await supabase
      .from("manuscripts")
      .insert({ user_id: user.id })
      .select("id,title,status,word_count,updated_at,art")
      .single();
    projekte = created ? [created] : [];
  }

  // Gewähltes Projekt bestimmen: aus der URL (?p=…), sonst das zuletzt bearbeitete
  const gewuenscht = searchParams?.p;
  const aktiv =
    projekte.find((p) => p.id === gewuenscht) ??
    projekte.find((p) => p.status === "aktiv") ??
    projekte[0];

  // Inhalt des gewählten Projekts laden
  const { data: dok } = await supabase
    .from("manuscripts")
    .select("content,title,status,art")
    .eq("id", aktiv.id)
    .single();

  return (
    <EditorClient
      key={aktiv.id}
      initialContent={dok?.content ?? ""}
      initialTitle={dok?.title ?? "Mein Roman"}
      manuscriptId={aktiv.id}
      userId={user.id}
      projektStatus={dok?.status ?? "aktiv"}
      projektArt={dok?.art ?? "roman"}
      projekte={projekte}
    />
  );
}
