import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NotizheftClient from "@/components/NotizheftClient";

export const dynamic = "force-dynamic";

export default async function NotizheftPage({
  searchParams,
}: {
  searchParams: { p?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const projektId = searchParams?.p;
  if (!projektId) redirect("/editor");

  // Gehört das Projekt dieser Person? (Nur Titel und Art – kein Manuskripttext)
  const { data: projekt } = await supabase
    .from("manuscripts")
    .select("id,title,art")
    .eq("id", projektId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!projekt) redirect("/editor");

  // Vorhandenes Notizheft laden (falls schon angelegt)
  const { data: heft, error } = await supabase
    .from("notizhefte")
    .select("content")
    .eq("manuscript_id", projekt.id)
    .maybeSingle();

  return (
    <NotizheftClient
      manuscriptId={projekt.id}
      userId={user.id}
      projektTitel={projekt.title ?? "Mein Roman"}
      projektArt={projekt.art ?? "roman"}
      initialContent={heft?.content ?? null}
      tabelleFehlt={!!error}
    />
  );
}
