"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "senden" | "gesendet" | "fehler">(
    "idle"
  );

  async function anmelden(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("senden");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setStatus(error ? "fehler" : "gesendet");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rise">
        {/* Markenzeichen */}
        <div className="mb-12 text-center">
          <h1 className="font-serif text-5xl tracking-tight text-ink">
            Novelista
          </h1>
          <p className="mt-3 font-serif text-lg italic text-ink-soft">
            Du schreibst. Den Rest übernehmen wir.
          </p>
        </div>

        {status === "gesendet" ? (
          <div className="rounded-2xl border border-line bg-paper-dim/60 p-8 text-center">
            <p className="font-serif text-xl text-ink">Schau in dein Postfach.</p>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              Wir haben dir einen Anmelde-Link an{" "}
              <span className="font-medium text-ink">{email}</span> geschickt.
              Tippe ihn an und du bist drin – kein Passwort nötig.
            </p>
          </div>
        ) : (
          <form onSubmit={anmelden} className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-ink-soft">
                Deine E-Mail-Adresse
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@beispiel.de"
                className="w-full rounded-xl border border-line bg-white/70 px-4 py-3.5 text-ink outline-none transition focus:border-oxblood focus:ring-2 focus:ring-oxblood/15"
              />
            </label>

            <button
              type="submit"
              disabled={status === "senden"}
              className="w-full rounded-xl bg-ink px-4 py-3.5 font-medium text-paper transition hover:bg-oxblood disabled:opacity-60"
            >
              {status === "senden" ? "Wird gesendet …" : "Anmelden"}
            </button>

            {status === "fehler" && (
              <p className="text-center text-sm text-oxblood">
                Das hat nicht geklappt. Bitte versuche es erneut.
              </p>
            )}

            <p className="pt-2 text-center text-xs leading-relaxed text-ink-faint">
              Du bekommst einen Link per E-Mail. Beim ersten Mal wird dein Konto
              automatisch angelegt.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
