// ============================================================
// Notizheft – gemeinsame Bausteine für die ganze Seite
// (/notizheft) und das Seitenfenster neben dem Manuskript.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SaveStatus = "gespeichert" | "speichert" | "ungespeichert";

export interface Eintrag {
  titel: string;
  pos: number;
  ebene: 1 | 2;
}

// ---- Vorlage beim ersten Öffnen ----
// Leere Absätze unter den Überschriften zeigen die grauen Leitfragen.
const VORLAGE_ROMAN = [
  "<h1>Kern</h1><p></p>",
  "<h1>Figuren</h1><h2></h2><p></p>",
  "<h1>Orte &amp; Zeit</h1><h2></h2><p></p>",
  "<h1>Aufbau</h1><p></p>",
  "<h1>Notizen</h1><p></p>",
].join("");

const VORLAGE_KURZ = [
  "<h1>Idee</h1><p></p>",
  "<h1>Figuren</h1><h2></h2><p></p>",
  "<h1>Notizen</h1><p></p>",
].join("");

export function startInhalt(content: string | null | undefined, art: string) {
  if (content && content.trim()) return content;
  return art === "roman" ? VORLAGE_ROMAN : VORLAGE_KURZ;
}

// ---- Leitfragen (verschwinden, sobald man tippt) ----
const LEITFRAGEN: Record<string, string> = {
  kern: "Worum geht es – in zwei, drei Sätzen? Welche Frage stellt der Roman?",
  idee: "Worum geht es? Was hat dich auf die Idee gebracht?",
  figuren: "Wer kommt vor? Für jede Figur eine Unterüberschrift mit ihrem Namen.",
  "orte & zeit": "Wo und wann spielt die Geschichte? Wie fühlt sich dieser Ort an?",
  aufbau: "Kapitel für Kapitel: Was passiert? Eine Zeile pro Kapitel genügt.",
  notizen: "Alles, was sonst nirgends hinpasst.",
};
const FIGUR_FRAGEN =
  "Wie sieht sie/er aus? Was will sie? Was fürchtet sie? Wie spricht sie?";
const ORT_FRAGEN = "Wie sieht es dort aus? Wie riecht es, wie klingt es?";

// Name des nächsten Abschnitts (h1) oberhalb einer Position
function abschnittVor(doc: any, pos: number): string {
  let name = "";
  doc.forEach((n: any, p: number) => {
    if (p < pos && n.type.name === "heading" && n.attrs.level === 1) {
      name = n.textContent.trim().toLowerCase();
    }
  });
  return name;
}

function leitfrage(ed: Editor, node: any, pos: number): string {
  const doc = ed.state.doc;
  if (node.type.name === "heading") {
    if (node.attrs.level === 1) return "Name des Abschnitts";
    const abschnitt = abschnittVor(doc, pos);
    if (abschnitt === "figuren") return "Name einer Figur";
    if (abschnitt === "orte & zeit") return "Name eines Ortes";
    return "Unterpunkt";
  }
  const $pos = doc.resolve(pos);
  if ($pos.depth !== 0) return "";
  const index = $pos.index(0);
  if (index === 0) return "Hier beginnt dein Notizheft …";
  const davor = doc.child(index - 1);
  if (davor.type.name !== "heading") return "";
  const name = davor.textContent.trim().toLowerCase();
  if (davor.attrs.level === 1) return LEITFRAGEN[name] ?? "Hier schreiben …";
  const abschnitt = abschnittVor(doc, pos);
  if (abschnitt === "figuren") return FIGUR_FRAGEN;
  if (abschnitt === "orte & zeit") return ORT_FRAGEN;
  return "Hier schreiben …";
}

export function notizheftExtensions() {
  return [
    StarterKit.configure({ heading: { levels: [1, 2] } }),
    Placeholder.configure({
      showOnlyCurrent: false,
      includeChildren: false,
      placeholder: ({ editor, node, pos }) => leitfrage(editor, node, pos),
    }),
  ];
}

export function leseEintraege(ed: Editor): Eintrag[] {
  const liste: Eintrag[] = [];
  ed.state.doc.forEach((node, pos) => {
    if (node.type.name === "heading") {
      liste.push({
        titel: node.textContent.trim() || "…",
        pos,
        ebene: node.attrs.level === 2 ? 2 : 1,
      });
    }
  });
  return liste;
}

// ---- Speichern: entprellt, mit Wiederholung bei Fehlern und
//      sofortigem Sichern beim Verlassen / Schließen ----
export function useNotizheftSpeichern(
  supabase: SupabaseClient,
  userId: string,
  manuscriptId: string
) {
  const [status, setStatus] = useState<SaveStatus>("gespeichert");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offen = useRef<string | null>(null); // noch nicht gespeicherter Stand

  const speichern = useCallback(async (): Promise<boolean> => {
    const html = offen.current;
    if (html === null) return true;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setStatus("speichert");
    const { error } = await supabase
      .from("notizhefte")
      .upsert(
        { user_id: userId, manuscript_id: manuscriptId, content: html },
        { onConflict: "manuscript_id" }
      );
    if (error) {
      setStatus("ungespeichert");
      // in 5 Sekunden noch einmal versuchen – nichts geht verloren
      timer.current = setTimeout(() => speichern(), 5000);
      return false;
    }
    if (offen.current === html) offen.current = null;
    setStatus(offen.current === null ? "gespeichert" : "ungespeichert");
    return true;
  }, [supabase, userId, manuscriptId]);

  const planen = useCallback(
    (html: string) => {
      offen.current = html;
      setStatus("ungespeichert");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => speichern(), 1200);
    },
    [speichern]
  );

  useEffect(() => {
    const sofort = () => {
      if (document.visibilityState === "hidden" && offen.current !== null) {
        speichern();
      }
    };
    const warnen = (e: BeforeUnloadEvent) => {
      if (offen.current !== null) {
        speichern();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", sofort);
    window.addEventListener("beforeunload", warnen);
    return () => {
      document.removeEventListener("visibilitychange", sofort);
      window.removeEventListener("beforeunload", warnen);
      // Beim Schließen des Fensters / Seitenwechsel: Rest sofort sichern
      if (offen.current !== null) speichern();
      else if (timer.current) clearTimeout(timer.current);
    };
  }, [speichern]);

  return { status, planen, speichern };
}

export function statusText(s: SaveStatus) {
  if (s === "speichert") return "speichert …";
  if (s === "ungespeichert") return "nicht gespeichert";
  return "gespeichert";
}
