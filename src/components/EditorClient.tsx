"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent, BubbleMenu, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { DOMSerializer } from "@tiptap/pm/model";
import { createClient } from "@/lib/supabase/client";
import ExportDialog from "@/components/ExportDialog";

type SaveStatus = "gespeichert" | "speichert" | "ungespeichert";

interface Props {
  initialContent: string;
  initialTitle: string;
  manuscriptId: string;
}

interface Kapitel {
  titel: string;
  pos: number;
  woerter: number;
}

// Alten reinen Text (ohne HTML) in Absätze umwandeln, damit nichts verloren geht.
function vorbereiten(content: string): string {
  if (!content) return "";
  if (content.includes("<")) return content; // ist bereits HTML
  return content
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function zaehleWoerter(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function leseKapitel(ed: Editor): Kapitel[] {
  const result: Kapitel[] = [];
  let current: Kapitel | null = null;
  ed.state.doc.forEach((node, pos) => {
    if (node.type.name === "heading") {
      if (current) result.push(current);
      current = { titel: node.textContent || "Ohne Titel", pos, woerter: 0 };
    } else if (current) {
      current.woerter += zaehleWoerter(node.textContent);
    }
  });
  if (current) result.push(current);
  return result;
}

export default function EditorClient({
  initialContent,
  initialTitle,
  manuscriptId,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [title, setTitle] = useState(initialTitle);
  const [status, setStatus] = useState<SaveStatus>("gespeichert");
  const [korrigiere, setKorrigiere] = useState(false);
  const [diktiere, setDiktiere] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [exportOffen, setExportOffen] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [kapitel, setKapitel] = useState<Kapitel[]>([]);
  const [woerter, setWoerter] = useState(0);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRef = useRef<any>(null);
  const titleRef = useRef(initialTitle);
  const sidebarOpenedAt = useRef(0);
  const headerRef = useRef<HTMLElement>(null);
  const [headerH, setHeaderH] = useState(104);

  useEffect(() => {
    const messen = () => {
      if (headerRef.current) setHeaderH(headerRef.current.offsetHeight);
    };
    messen();
    window.addEventListener("resize", messen);
    return () => window.removeEventListener("resize", messen);
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1] } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: "Es war einmal …" }),
    ],
    content: vorbereiten(initialContent),
    editorProps: {
      attributes: {
        class: "manuscript-area min-h-[60vh] focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      aktualisiere(editor);
      planeSpeichern(editor.getHTML(), titleRef.current);
    },
    onCreate: ({ editor }) => aktualisiere(editor),
  });

  function aktualisiere(ed: Editor) {
    setKapitel(leseKapitel(ed));
    setWoerter(zaehleWoerter(ed.getText()));
  }

  // ---- Automatisches Speichern (entprellt) ----
  const speichern = useCallback(
    async (html: string, neuerTitel: string) => {
      setStatus("speichert");
      const { error } = await supabase
        .from("manuscripts")
        .update({
          content: html,
          title: neuerTitel,
          word_count: zaehleWoerter(
            html.replace(/<[^>]+>/g, " ")
          ),
        })
        .eq("id", manuscriptId);
      setStatus(error ? "ungespeichert" : "gespeichert");
    },
    [supabase, manuscriptId]
  );

  const planeSpeichern = useCallback(
    (html: string, neuerTitel: string) => {
      setStatus("ungespeichert");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => speichern(html, neuerTitel), 1200);
    },
    [speichern]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function aktualisiereTitel(value: string) {
    setTitle(value);
    titleRef.current = value;
    planeSpeichern(editor?.getHTML() ?? "", value);
  }

  // ---- Lektorat per Knopfdruck (erhält die Formatierung) ----
  async function korrigierenLassen() {
    if (korrigiere || !editor) return;

    const { state } = editor;
    const { from, to, empty } = state.selection;

    // Nichts markiert -> freundlich auffordern (kein Timeout bei langen Texten)
    if (empty || from === to) {
      setHinweis("Markiere zuerst den Text, den du korrigieren möchtest.");
      setTimeout(() => setHinweis(null), 3500);
      return;
    }

    // Markierten Bereich als HTML herauslösen (mit Formatierung)
    const slice = state.doc.slice(from, to);
    const serializer = DOMSerializer.fromSchema(state.schema);
    const container = document.createElement("div");
    container.appendChild(serializer.serializeFragment(slice.content));
    const html = container.innerHTML;

    if (!container.textContent?.trim()) return;

    setKorrigiere(true);
    setHinweis("Markierung wird lektoriert …");
    try {
      const res = await fetch("/api/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Fehler");

      editor
        .chain()
        .focus()
        .deleteSelection()
        .insertContent(data.corrected)
        .run();
      aktualisiere(editor);
      planeSpeichern(editor.getHTML(), titleRef.current);
      setHinweis("Lektorat abgeschlossen.");
    } catch {
      setHinweis("Die Korrektur ist gerade nicht verfügbar.");
    } finally {
      setKorrigiere(false);
      setTimeout(() => setHinweis(null), 2500);
    }
  }

  // ---- Diktat (Spracheingabe) ----
  function diktatUmschalten() {
    if (diktiere) {
      recognitionRef.current?.stop();
      return;
    }
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) {
      setHinweis("Dein Browser unterstützt das Diktieren leider nicht.");
      setTimeout(() => setHinweis(null), 3000);
      return;
    }
    const rec = new SR();
    rec.lang = "de-DE";
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (event: any) => {
      let neuerText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) neuerText += event.results[i][0].transcript;
      }
      if (neuerText && editor) {
        editor.commands.insertContent(neuerText.trim() + " ");
      }
    };
    rec.onend = () => setDiktiere(false);
    rec.onerror = () => setDiktiere(false);

    recognitionRef.current = rec;
    rec.start();
    setDiktiere(true);
  }

  async function abmelden() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  function zuKapitel(pos: number) {
    if (!editor) return;
    editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebar(false);
    }
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
      <header ref={headerRef} className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => {
              setSidebar(true);
              sidebarOpenedAt.current = Date.now();
            }}
            aria-label="Kapitelübersicht"
            className="rounded-lg p-2 text-ink-soft transition hover:bg-paper-dim md:hidden"
          >
            <Icon name="list" />
          </button>
          <span className="font-serif text-lg tracking-tight text-ink">
            Novelista
          </span>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-ink-faint sm:inline">
              {woerter.toLocaleString("de-DE")} Wörter · {statusText(status)}
            </span>
            <ToolButton onClick={diktatUmschalten} active={diktiere} label={diktiere ? "Diktat beenden" : "Diktieren"}>
              <Icon name={diktiere ? "stop" : "mic"} />
            </ToolButton>
            <ToolButton onClick={korrigierenLassen} active={korrigiere} label="Korrigieren" disabled={korrigiere}>
              <Icon name="check" />
              <span className="hidden sm:inline">{korrigiere ? "Lektoriere …" : "Korrigieren"}</span>
            </ToolButton>
            <ToolButton onClick={() => setExportOffen(true)} label="Als PDF">
              <Icon name="download" />
              <span className="hidden sm:inline">PDF</span>
            </ToolButton>
            <button onClick={abmelden} className="rounded-lg p-2 text-ink-faint transition hover:bg-paper-dim hover:text-ink" aria-label="Abmelden">
              <Icon name="exit" />
            </button>
          </div>
        </div>

        {/* ---- Formatierungsleiste ---- */}
        <div className="flex items-center gap-1 border-t border-line px-4 py-1.5 sm:px-6">
          <FmtButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} label="Fett">
            <span className="font-bold">F</span>
          </FmtButton>
          <FmtButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} label="Kursiv">
            <span className="italic font-serif">K</span>
          </FmtButton>
          <FmtButton
            onClick={() =>
              editor.chain().focus().setTextAlign(editor.isActive({ textAlign: "center" }) ? "left" : "center").run()
            }
            active={editor.isActive({ textAlign: "center" })}
            label="Zentriert"
          >
            <Icon name="center" />
          </FmtButton>
          <FmtButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} label="Zitat">
            <Icon name="quote" />
          </FmtButton>
          <div className="mx-1 h-5 w-px bg-line" />
          <FmtButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} label="Als Kapitel markieren">
            <span className="text-sm font-medium">Kapitel</span>
          </FmtButton>
        </div>
      </header>

      {/* ---- Schwebende Knöpfe bei Markierung ---- */}
      <BubbleMenu editor={editor} tippyOptions={{ duration: 120 }} className="flex items-center gap-1 rounded-xl border border-line bg-paper p-1 shadow-lg">
        <FmtButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} label="Fett">
          <span className="font-bold">F</span>
        </FmtButton>
        <FmtButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} label="Kursiv">
          <span className="italic font-serif">K</span>
        </FmtButton>
        <FmtButton
          onClick={() => editor.chain().focus().setTextAlign(editor.isActive({ textAlign: "center" }) ? "left" : "center").run()}
          active={editor.isActive({ textAlign: "center" })}
          label="Zentriert"
        >
          <Icon name="center" />
        </FmtButton>
        <FmtButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} label="Zitat">
          <Icon name="quote" />
        </FmtButton>
        <div className="mx-0.5 h-5 w-px bg-line" />
        <FmtButton onClick={korrigierenLassen} label="Markierung korrigieren">
          <Icon name="check" />
        </FmtButton>
      </BubbleMenu>

      <div className="flex flex-1">
        {/* ---- Kapitelübersicht: Desktop (feste Spalte) ---- */}
        <aside
          style={{ top: headerH, height: `calc(100vh - ${headerH}px)` }}
          className="sticky hidden w-64 shrink-0 overflow-y-auto border-r border-line bg-paper-dim/40 p-5 md:block"
        >
          <KapitelListe kapitel={kapitel} onWaehle={zuKapitel} />
        </aside>

        {/* ---- Kapitelübersicht: Handy (ausklappbares Panel) ---- */}
        {sidebar && (
          <>
            <div
              className="fixed inset-0 z-30 bg-ink/30 md:hidden"
              onClick={() => {
                if (Date.now() - sidebarOpenedAt.current > 350) setSidebar(false);
              }}
            />
            <aside className="fixed inset-y-0 left-0 z-40 w-72 max-w-[80%] overflow-y-auto border-r border-line bg-paper p-5 shadow-2xl md:hidden">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-faint">Kapitel</h2>
                <button onClick={() => setSidebar(false)} aria-label="Schließen" className="rounded-lg p-1.5 text-ink-soft hover:bg-paper-dim">
                  <Icon name="close" />
                </button>
              </div>
              <KapitelListe kapitel={kapitel} onWaehle={zuKapitel} ohneUeberschrift />
            </aside>
          </>
        )}

        {/* ---- Schreibfläche ---- */}
        <main className="flex-1">
          <div className="mx-auto max-w-2xl px-6 py-10 sm:py-16">
            <input
              value={title}
              onChange={(e) => aktualisiereTitel(e.target.value)}
              placeholder="Titel des Romans"
              className="mb-8 w-full border-none bg-transparent font-serif text-3xl tracking-tight text-ink outline-none placeholder:text-ink-faint sm:text-4xl"
            />
            <EditorContent editor={editor} />
          </div>
        </main>
      </div>

      {hinweis && (
        <div className="rise fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full border border-line bg-ink px-5 py-2.5 text-sm text-paper shadow-lg">
          {hinweis}
        </div>
      )}

      {exportOffen && (
        <ExportDialog title={title} html={editor.getHTML()} onClose={() => setExportOffen(false)} />
      )}
    </div>
  );
}

function statusText(s: SaveStatus) {
  if (s === "speichert") return "speichert …";
  if (s === "ungespeichert") return "nicht gespeichert";
  return "gespeichert";
}

function ToolButton({ children, onClick, active, disabled, label }: { children: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; label: string; }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${active ? "bg-oxblood text-paper" : "text-ink-soft hover:bg-paper-dim hover:text-ink"}`}>
      {children}
    </button>
  );
}

function FmtButton({ children, onClick, active, label }: { children: React.ReactNode; onClick: () => void; active?: boolean; label: string; }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm transition ${active ? "bg-oxblood text-paper" : "text-ink-soft hover:bg-paper-dim hover:text-ink"}`}>
      {children}
    </button>
  );
}

function KapitelListe({
  kapitel,
  onWaehle,
  ohneUeberschrift,
}: {
  kapitel: Kapitel[];
  onWaehle: (pos: number) => void;
  ohneUeberschrift?: boolean;
}) {
  return (
    <>
      {!ohneUeberschrift && (
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-ink-faint">
          Kapitel
        </h2>
      )}
      {kapitel.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-faint">
          Schreibe den Kapitelnamen in eine eigene Zeile, setze den Cursor hinein
          und drücke den Knopf „Kapitel". Die Übersicht entsteht dann von selbst.
        </p>
      ) : (
        <ul className="space-y-1">
          {kapitel.map((k, i) => (
            <li key={i}>
              <button
                onClick={() => onWaehle(k.pos)}
                className="group w-full rounded-lg px-3 py-2 text-left transition hover:bg-paper-dim"
              >
                <span className="block truncate font-serif text-ink group-hover:text-oxblood">
                  {k.titel}
                </span>
                <span className="text-xs text-ink-faint">
                  {k.woerter.toLocaleString("de-DE")} Wörter
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Icon({ name }: { name: string }) {
  const c = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "list": return (<svg {...c}><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="14" y2="17" /></svg>);
    case "mic": return (<svg {...c}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>);
    case "stop": return (<svg {...c}><rect x="6" y="6" width="12" height="12" rx="2" /></svg>);
    case "check": return (<svg {...c}><path d="M20 6 9 17l-5-5" /></svg>);
    case "download": return (<svg {...c}><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>);
    case "exit": return (<svg {...c}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>);
    case "center": return (<svg {...c}><line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="5" y1="18" x2="19" y2="18" /></svg>);
    case "quote": return (<svg {...c}><path d="M7 7h4v4c0 2-1 3-3 4M13 7h4v4c0 2-1 3-3 4" /></svg>);
    case "close": return (<svg {...c}><path d="M6 6l12 12M18 6L6 18" /></svg>);
    default: return null;
  }
}
