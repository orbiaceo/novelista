"use client";

import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { createClient } from "@/lib/supabase/client";
import {
  type Eintrag,
  leseEintraege,
  notizheftExtensions,
  startInhalt,
  statusText,
  useNotizheftSpeichern,
} from "@/lib/notizheft";

// ============================================================
// Notizheft als Seitenfenster neben dem Manuskript.
// Wird beim ersten Öffnen einmal geladen und bleibt danach im
// Hintergrund bestehen (nur ein-/ausgeblendet) – so kann beim
// Wieder-Öffnen kein älterer Stand über einen neueren schreiben.
// ============================================================

interface Props {
  manuscriptId: string;
  userId: string;
  art: string;
  sichtbar: boolean;
  onSchliessen: () => void;
  onGrossOeffnen: () => void;
  // Damit das Manuskript vor einem Seitenwechsel alles sichern kann
  speichernRef: MutableRefObject<(() => Promise<boolean>) | null>;
}

export default function NotizheftPanel(props: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [zustand, setZustand] = useState<"laedt" | "fehlt" | "bereit">("laedt");
  const [inhalt, setInhalt] = useState<string | null>(null);

  useEffect(() => {
    let aktiv = true;
    supabase
      .from("notizhefte")
      .select("content")
      .eq("manuscript_id", props.manuscriptId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!aktiv) return;
        if (error) {
          setZustand("fehlt");
          return;
        }
        setInhalt(data?.content ?? null);
        setZustand("bereit");
      });
    return () => {
      aktiv = false;
    };
  }, [supabase, props.manuscriptId]);

  return (
    <>
      {/* Handy: abdunkeln, Tippen daneben schließt */}
      {props.sichtbar && (
        <div
          className="fixed inset-0 z-30 bg-ink/30 lg:hidden"
          onClick={props.onSchliessen}
        />
      )}
      <aside
        className={`${props.sichtbar ? "flex" : "hidden"} fixed inset-y-0 right-0 z-40 w-[22rem] shrink-0 max-w-[90%] flex-col border-l border-line bg-paper shadow-2xl lg:sticky lg:z-10 lg:max-w-none lg:shadow-none`}
        style={{ top: "var(--kopf-hoehe, 0px)", height: "calc(100vh - var(--kopf-hoehe, 0px))" }}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="font-serif text-lg text-oxblood">Notizheft</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={props.onGrossOeffnen}
              title="Groß öffnen"
              aria-label="Groß öffnen"
              className="rounded-lg p-1.5 text-ink-soft transition hover:bg-paper-dim hover:text-ink"
            >
              <Icon name="gross" />
            </button>
            <button
              onClick={props.onSchliessen}
              title="Schließen"
              aria-label="Schließen"
              className="rounded-lg p-1.5 text-ink-soft transition hover:bg-paper-dim hover:text-ink"
            >
              <Icon name="close" />
            </button>
          </div>
        </div>

        {zustand === "laedt" && (
          <p className="p-5 text-sm text-ink-faint">Wird geladen …</p>
        )}
        {zustand === "fehlt" && (
          <p className="p-5 text-sm leading-relaxed text-ink-soft">
            Das Notizheft konnte gerade nicht geladen werden. Bitte später noch
            einmal versuchen – dein Text ist davon nicht betroffen.
          </p>
        )}
        {zustand === "bereit" && <PanelEditor {...props} inhalt={inhalt} />}
      </aside>
    </>
  );
}

function PanelEditor({
  manuscriptId,
  userId,
  art,
  speichernRef,
  inhalt,
}: Props & { inhalt: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const { status, planen, speichern } = useNotizheftSpeichern(
    supabase,
    userId,
    manuscriptId
  );
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);

  useEffect(() => {
    speichernRef.current = speichern;
    return () => {
      speichernRef.current = null;
    };
  }, [speichern, speichernRef]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: notizheftExtensions(),
    content: startInhalt(inhalt, art),
    editorProps: {
      attributes: {
        class: "notizheft-area notizheft-klein min-h-[50vh] focus:outline-none",
      },
    },
    onCreate: ({ editor }) => setEintraege(leseEintraege(editor)),
    onUpdate: ({ editor }) => {
      setEintraege(leseEintraege(editor));
      planen(editor.getHTML());
    },
  });

  // Zum Abschnitt springen, ohne die Tastatur aufzuklappen
  function springe(pos: number) {
    if (!editor) return;
    const el = editor.view.nodeDOM(pos) as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function ueberschrift(level: 1 | 2) {
    if (!editor) return;
    if (editor.isActive("heading", { level })) {
      editor.chain().focus().setParagraph().run();
    } else {
      editor.chain().focus().setHeading({ level }).run();
    }
  }

  if (!editor) return null;
  const abschnitte = eintraege.filter((e) => e.ebene === 1);

  return (
    <>
      {/* Abschnitte zum Springen */}
      {abschnitte.length > 0 && (
        <div
          className="flex gap-1.5 overflow-x-auto border-b border-line px-4 py-2"
          style={{ scrollbarWidth: "none" }}
        >
          {abschnitte.map((a, i) => (
            <button
              key={i}
              onClick={() => springe(a.pos)}
              className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-ink-soft transition hover:border-oxblood hover:text-oxblood"
            >
              {a.titel}
            </button>
          ))}
        </div>
      )}

      {/* kleine Formatierungsleiste */}
      <div
        className="flex items-center gap-1 overflow-x-auto border-b border-line px-3 py-1"
        style={{ scrollbarWidth: "none" }}
      >
        <Knopf onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} label="Fett">
          <span className="font-bold">F</span>
        </Knopf>
        <Knopf onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} label="Kursiv">
          <span className="font-serif italic">K</span>
        </Knopf>
        <Knopf onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} label="Liste">
          <span>•</span>
        </Knopf>
        <div className="mx-1 h-4 w-px shrink-0 bg-line" />
        <Knopf onClick={() => ueberschrift(1)} active={editor.isActive("heading", { level: 1 })} label="Als Abschnitt markieren">
          <span className="text-xs font-semibold">Abschnitt</span>
        </Knopf>
        <Knopf onClick={() => ueberschrift(2)} active={editor.isActive("heading", { level: 2 })} label="Als Unterpunkt markieren">
          <span className="text-xs">Unterpunkt</span>
        </Knopf>
        <span
          className={`ml-auto shrink-0 pl-2 text-[11px] ${
            status === "ungespeichert" ? "text-oxblood" : "text-ink-faint"
          }`}
        >
          {statusText(status)}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <EditorContent editor={editor} />
      </div>
    </>
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
      className={`flex h-7 min-w-7 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-1.5 text-sm transition ${
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
    case "close": return (<svg {...c}><path d="M6 6l12 12M18 6L6 18" /></svg>);
    case "gross": return (<svg {...c}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>);
    default: return null;
  }
}
