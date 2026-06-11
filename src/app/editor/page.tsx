import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EditorClient from "@/components/EditorClient";

export const dynamic = "force-dynamic";

export default async function EditorPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Zentrales Manuskript laden – oder beim ersten Mal anlegen.
  let { data: manuscript } = await supabase
    .from("manuscripts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!manuscript) {
    const { data: created } = await supabase
      .from("manuscripts")
      .insert({ user_id: user.id })
      .select("*")
      .single();
    manuscript = created;
  }

  return (
    <EditorClient
      initialContent={manuscript?.content ?? ""}
      initialTitle={manuscript?.title ?? "Mein Roman"}
      manuscriptId={manuscript?.id ?? ""}
      userId={user.id}
    />
  );
}
