"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// Notizheft – die Vorarbeit zu einem Roman.
// Ein einziges, durchgehendes Dokument pro Projekt, wie eine
// Word-Datei. Abschnitte (h1) und Unterpunkte (h2) ergeben links
// automatisch ein Inhaltsverzeichnis. Das Manuskript selbst wird
// hier NIE angefasst – das Notizheft liegt in einer eigenen Tabelle.
// ============================================================

type SaveStatus = "gespeichert" | "speichert" | "ungespeichert";

interface Props {
  manuscriptId: string;
  userId: string;
  projektTitel: string;
  projektArt: string;
  initialContent: string | null;
  tabelleFehlt: boolean;
}

interface Eintrag {
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

function leitfrage(ed: Editor, node: any, pos: number): string {
  const doc = ed.state.doc;
  // Leere Unterüberschrift
  if (node.type.name === "heading") {
    if (node.attrs.level === 1) return "Name des Abschnitts";
    const abschnitt = abschnittVor(doc, pos);
    if (abschnitt === "figuren") return "Name einer Figur";
    if (abschnitt === "orte & zeit") return "Name eines Ortes";
    return "Unterpunkt";
  }
  // Leerer Absatz direkt unter einer Überschrift
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

function leseEintraege(ed: Editor): Eintrag[] {
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

export default function NotizheftClient({
  manuscriptId,
  userId,
  projektTitel,
  projektArt,
  initialContent,
  tabelleFehlt,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [status, setStatus] = useState<SaveStatus>("gespeichert");
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
  const [panel, setPanel] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [importiere, setImportiere] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [headerH, setHeaderH] = useState(104);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offen = useRef<string | null>(null); // noch nicht gespeicherter Stand

  // Dunkelmodus & Schriftgröße wie im Manuskript übernehmen
  useEffect(() => {
    try {
      const d = localStorage.getItem("novelista_dunkel") === "1";
      document.documentElement.classList.toggle("dark", d);
      const s = parseFloat(localStorage.getItem("novelista_schrift") || "1.15");
      document.documentElement.style.setProperty(
        "--manuscript-size",
        `${isNaN(s) ? 1.15 : s}rem`
      );
    } catch {}
  }, []);

  useEffect(() => {
    const messen = () => {
      if (headerRef.current) setHeaderH(headerRef.current.offsetHeight);
    };
    messen();
    window.addEventListener("resize", messen);
    return () => window.removeEventListener("resize", messen);
  }, []);

  function zeige(text: string, ms = 2500) {
    setHinweis(text);
    setTimeout(() => setHinweis(null), ms);
  }

  // ---- Speichern ----
  const speichern = useCallback(async () => {
    const html = offen.current;
    if (html === null) return true;
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
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => speichern(), 5000);
      return false;
    }
    // Nur zurücksetzen, wenn inzwischen nichts Neues getippt wurde
    if (offen.current === html) offen.current = null;
    setStatus(offen.current === null ? "gespeichert" : "ungespeichert");
    return true;
  }, [supabase, userId, manuscriptId]);

  const planeSpeichern = useCallback(
    (html: string) => {
      offen.current = html;
      setStatus("ungespeichert");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => speichern(), 1200);
    },
    [speichern]
  );

  // Sofort speichern, wenn das Fenster verlassen / das Handy gesperrt wird
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
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [speichern]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2] } }),
      Placeholder.configure({
        showOnlyCurrent: false,
        includeChildren: false,
        placeholder: ({ editor: ed, node, pos }) => leitfrage(ed, node, pos),
      }),
    ],
    content:
      initialContent && initialContent.trim()
        ? initialContent
        : projektArt === "roman"
          ? VORLAGE_ROMAN
          : VORLAGE_KURZ,
    editorProps: {
      attributes: { class: "notizheft-area min-h-[60vh] focus:outline-none" },
    },
    onCreate: ({ editor }) => setEintraege(leseEintraege(editor)),
    onUpdate: ({ editor }) => {
      setEintraege(leseEintraege(editor));
      planeSpeichern(editor.getHTML());
    },
  });

  // ---- Zurück zum Manuskript (vorher alles speichern) ----
  async function zurueck() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (offen.current !== null) {
      const ok = await speichern();
      if (!ok) {
        zeige("Speichern hat nicht geklappt – bitte kurz warten und erneut versuchen.", 5000);
        return;
      }
    }
    router.push("/editor?p=" + manuscriptId);
  }

  function zuEintrag(pos: number) {
    if (!editor) return;
    editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
    setPanel(false);
  }

  function ueberschrift(level: 1 | 2) {
    if (!editor) return;
    if (editor.isActive("heading", { level })) {
      editor.chain().focus().setParagraph().run();
    } else {
      editor.chain().focus().setHeading({ level }).run();
    }
  }

  // ---- Word-Datei ANS ENDE des Notizhefts anhängen (ersetzt nichts) ----
  async function wordEinfuegen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editor) return;
    if (!file.name.toLowerCase().endsWith(".docx")) {
      zeige("Bitte eine Word-Datei (.docx) wählen.", 5000);
      return;
    }
    setImportiere(true);
    setHinweis("Word-Datei wird eingefügt …");
    try {
      const mod = await import("mammoth/mammoth.browser");
      const mammoth = mod.default ?? mod;
      const result = await mammoth.convertToHtml(
        { arrayBuffer: await file.arrayBuffer() },
        {
          styleMap: [
            "p[style-name='Heading 1'] => h2:fresh",
            "p[style-name='Überschrift 1'] => h2:fresh",
            "p[style-name='heading 1'] => h2:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Überschrift 2'] => h2:fresh",
            "p[style-name='heading 2'] => h2:fresh",
            "p[style-name='Title'] => h2:fresh",
            "p[style-name='Titel'] => h2:fresh",
          ],
        }
      );
      const html = (result.value || "").trim();
      if (!html) {
        zeige("Die Word-Datei scheint leer zu sein.", 4000);
        return;
      }
      const name = file.name.replace(/\.docx$/i, "").trim() || "Word-Datei";
      const sicher = name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const ende = editor.state.doc.content.size;
      editor
        .chain()
        .insertContentAt(ende, `<h1>Aus Word: ${sicher}</h1>${html}`)
        .run();
      // zum eingefügten Teil springen
      const liste = leseEintraege(editor);
      const ziel = [...liste].reverse().find((x) => x.titel.startsWith("Aus Word"));
      if (ziel) zuEintrag(ziel.pos);
      zeige("Eingefügt ✓ – ganz unten im Notizheft.");
    } catch {
      zeige("Das Einfügen hat nicht geklappt. Ist es eine gültige .docx-Datei?", 5000);
    } finally {
      setImportiere(false);
    }
  }

  // ---- Tabelle noch nicht eingerichtet: nichts eintippen lassen ----
  if (tabelleFehlt) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md rounded-2xl border border-line bg-paper p-7 text-center shadow-xl">
          <h1 className="font-serif text-2xl text-ink">Notizheft noch nicht bereit</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Das Notizheft muss einmalig eingerichtet werden. Dein Roman ist davon
            nicht betroffen.
          </p>
          <button
            onClick={() => router.push("/editor?p=" + manuscriptId)}
            className="mt-6 w-full rounded-xl bg-ink px-4 py-3 font-medium text-paper transition hover:bg-oxblood"
          >
            Zurück zum Text
          </button>
        </div>
      </div>
    );
  }

  if (!editor) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ink-faint">
        Wird geladen …
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* ---- Kopfzeile ---- */}
      <header
        ref={headerRef}
        className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur"
      >
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <button
            onClick={zurueck}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-ink-soft transition hover:bg-paper-dim hover:text-ink"
          >
            <Icon name="back" />
            <span>Zum Text</span>
          </button>
          <button
            onClick={() => setPanel(true)}
            aria-label="Inhalt"
            className="rounded-lg p-2 text-ink-soft transition hover:bg-paper-dim md:hidden"
          >
            <Icon name="list" />
          </button>
          <span className="truncate font-serif text-ink-soft sm:border-l sm:border-line sm:pl-3">
            <span className="text-oxblood">Notizheft</span>
            <span className="hidden sm:inline"> · {projektTitel}</span>
          </span>
          <span
            className={`ml-auto shrink-0 text-xs ${
              status === "ungespeichert" ? "text-oxblood" : "text-ink-faint"
            }`}
          >
            {status === "speichert"
              ? "speichert …"
              : status === "ungespeichert"
                ? "nicht gespeichert"
                : "gespeichert"}
          </span>
        </div>

        {/* ---- Formatierungsleiste ---- */}
        <div
          className="flex items-center gap-1 overflow-x-auto border-t border-line px-4 py-1.5 sm:px-6"
          style={{ scrollbarWidth: "none" }}
        >
          <Knopf onClick={() => editor.chain().focus().undo().run()} label="Rückgängig">
            <Icon name="undo" />
          </Knopf>
          <Knopf onClick={() => editor.chain().focus().redo().run()} label="Wiederherstellen">
            <Icon name="redo" />
          </Knopf>
          <div className="mx-1 h-5 w-px shrink-0 bg-line" />
          <Knopf
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            label="Fett"
          >
            <span className="font-bold">F</span>
          </Knopf>
          <Knopf
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            label="Kursiv"
          >
            <span className="font-serif italic">K</span>
          </Knopf>
          <Knopf
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            label="Liste mit Punkten"
          >
            <span className="text-sm">• Liste</span>
          </Knopf>
          <div className="mx-1 h-5 w-px shrink-0 bg-line" />
          <Knopf
            onClick={() => ueberschrift(1)}
            active={editor.isActive("heading", { level: 1 })}
            label="Als Abschnitt markieren (z. B. Figuren)"
          >
            <span className="text-sm font-semibold">Abschnitt</span>
          </Knopf>
          <Knopf
            onClick={() => ueberschrift(2)}
            active={editor.isActive("heading", { level: 2 })}
            label="Als Unterpunkt markieren (z. B. Name einer Figur)"
          >
            <span className="text-sm font-medium">Unterpunkt</span>
          </Knopf>
          <div className="mx-1 h-5 w-px shrink-0 bg-line" />
          <input
            ref={importRef}
            type="file"
            accept=".docx"
            onChange={wordEinfuegen}
            className="hidden"
          />
          <Knopf
            onClick={() => importRef.current?.click()}
            label="Word-Datei unten anfügen"
          >
            <span className="flex items-center gap-1.5 text-sm">
              <Icon name="upload" />
              {importiere ? "Füge ein …" : "Word einfügen"}
            </span>
          </Knopf>
        </div>
      </header>

      <div className="flex flex-1">
        {/* ---- Inhalt: Desktop ---- */}
        <aside
          style={{ top: headerH, height: `calc(100vh - ${headerH}px)` }}
          className="sticky hidden w-64 shrink-0 overflow-y-auto border-r border-line bg-paper-dim/40 p-5 md:block"
        >
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-ink-faint">
            Inhalt
          </h2>
          <Inhalt eintraege={eintraege} onWaehle={zuEintrag} />
        </aside>

        {/* ---- Inhalt: Handy ---- */}
        {panel && (
          <>
            <div className="fixed inset-0 z-30 bg-ink/30 md:hidden" onClick={() => setPanel(false)} />
            <aside className="fixed inset-y-0 left-0 z-40 w-72 max-w-[80%] overflow-y-auto border-r border-line bg-paper p-5 shadow-2xl md:hidden">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-faint">
                  Inhalt
                </h2>
                <button
                  onClick={() => setPanel(false)}
                  aria-label="Schließen"
                  className="rounded-lg p-1.5 text-ink-soft hover:bg-paper-dim"
                >
                  <Icon name="close" />
                </button>
              </div>
              <Inhalt eintraege={eintraege} onWaehle={zuEintrag} />
            </aside>
          </>
        )}

        {/* ---- Schreibfläche ---- */}
        <main className="flex-1">
          <div className="mx-auto max-w-2xl px-6 py-10 sm:py-14">
            <p className="mb-8 font-serif text-sm italic text-ink-faint">
              Vorarbeit zu „{projektTitel}“ – nur für dich, erscheint nicht im Buch.
            </p>
            <EditorContent editor={editor} />
          </div>
        </main>
      </div>

      {hinweis && (
        <div className="rise fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full border border-line bg-ink px-5 py-2.5 text-sm text-paper shadow-lg">
          {hinweis}
        </div>
      )}
    </div>
  );
}

function Inhalt({
  eintraege,
  onWaehle,
}: {
  eintraege: Eintrag[];
  onWaehle: (pos: number) => void;
}) {
  if (eintraege.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-ink-faint">
        Setze den Cursor in eine Zeile und drücke „Abschnitt“ oder „Unterpunkt“.
        Das Inhaltsverzeichnis entsteht dann von selbst.
      </p>
    );
  }
  return (
    <ul className="space-y-0.5">
      {eintraege.map((e, i) => (
        <li key={i} className={e.ebene === 1 && i > 0 ? "pt-2" : undefined}>
          <button
            onClick={() => onWaehle(e.pos)}
            className={`group w-full truncate rounded-lg py-1.5 text-left transition hover:bg-paper-dim ${
              e.ebene === 1 ? "px-3" : "pl-6 pr-3"
            }`}
          >
            <span
              className={`block truncate font-serif group-hover:text-oxblood ${
                e.ebene === 1 ? "font-semibold text-ink" : "text-ink-soft"
              }`}
            >
              {e.titel}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Knopf({
  children,
  onClick,
  active,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-8 min-w-8 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-2 text-sm transition ${
        active ? "bg-oxblood text-paper" : "text-ink-soft hover:bg-paper-dim hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Icon({ name }: { name: string }) {
  const c = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "back": return (<svg {...c}><path d="M15 18l-6-6 6-6" /></svg>);
    case "list": return (<svg {...c}><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="14" y2="17" /></svg>);
    case "close": return (<svg {...c}><path d="M6 6l12 12M18 6L6 18" /></svg>);
    case "upload": return (<svg {...c}><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>);
    case "undo": return (<svg {...c}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-4" /></svg>);
    case "redo": return (<svg {...c}><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0-5 5 5 5 0 0 0 5 5h4" /></svg>);
    default: return null;
  }
}
