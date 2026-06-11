"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [status, setStatus] = useState<"idle" | "laedt">("idle");
  const [fehler, setFehler] = useState<string | null>(null);

  async function anmelden(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !passwort) return;
    setStatus("laedt");
    setFehler(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: passwort,
    });

    if (error) {
      setFehler(uebersetze(error.message));
      setStatus("idle");
      return;
    }
    router.push("/editor");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rise">
        <div className="mb-12 text-center">
          <h1 className="font-serif text-5xl tracking-tight text-ink">Novelista</h1>
          <p className="mt-3 font-serif text-lg italic text-ink-soft">
            Du schreibst. Den Rest übernehmen wir.
          </p>
        </div>

        <form onSubmit={anmelden} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-ink-soft">
              E-Mail-Adresse
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@beispiel.de"
              className="w-full rounded-xl border border-line bg-surface px-4 py-3.5 text-ink outline-none transition focus:border-oxblood focus:ring-2 focus:ring-oxblood/15"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-ink-soft">
              Passwort
            </span>
            <input
              type="password"
              required
              value={passwort}
              onChange={(e) => setPasswort(e.target.value)}
              placeholder="Dein Passwort"
              className="w-full rounded-xl border border-line bg-surface px-4 py-3.5 text-ink outline-none transition focus:border-oxblood focus:ring-2 focus:ring-oxblood/15"
            />
          </label>

          <button
            type="submit"
            disabled={status === "laedt"}
            className="w-full rounded-xl bg-ink px-4 py-3.5 font-medium text-paper transition hover:bg-oxblood disabled:opacity-60"
          >
            {status === "laedt" ? "Einen Moment …" : "Anmelden"}
          </button>

          {fehler && <p className="text-center text-sm text-oxblood">{fehler}</p>}

          <p className="pt-2 text-center text-xs leading-relaxed text-ink-faint">
            Zugang nur mit eingerichtetem Konto. Wende dich an den Inhaber, wenn du
            noch keine Zugangsdaten hast.
          </p>
        </form>
      </div>
    </main>
  );
}

function uebersetze(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "E-Mail oder Passwort stimmt nicht.";
  if (m.includes("email") && m.includes("confirm"))
    return "Dieses Konto ist noch nicht bestätigt. Bitte wende dich an den Inhaber.";
  return "Das hat nicht geklappt. Bitte versuche es erneut.";
}
