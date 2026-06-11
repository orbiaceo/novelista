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
  userId: string;
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
  userId,
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

  // Suchen & Ersetzen
  const [suchenOffen, setSuchenOffen] = useState(false);
  const [suchen, setSuchen] = useState("");
  const [ersetzen, setErsetzen] = useState("");
  const [treffer, setTreffer] = useState(0);

  // Einstellungen (Dunkelmodus, Schriftgröße)
  const [einstellungenOffen, setEinstellungenOffen] = useState(false);
  const [dunkel, setDunkel] = useState(false);
  const [schrift, setSchrift] = useState(1.15);

  // Sicherungen
  const [sicherungenOffen, setSicherungenOffen] = useState(false);
  const [sicherungen, setSicherungen] = useState<
    { id: string; created_at: string; title: string }[]
  >([]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRef = useRef<any>(null);
  const titleRef = useRef(initialTitle);
  const sidebarOpenedAt = useRef(0);
  const headerRef = useRef<HTMLElement>(null);
  const letzteSicherung = useRef(0);
  const [headerH, setHeaderH] = useState(104);

  // Einstellungen laden und anwenden
  useEffect(() => {
    try {
      const d = localStorage.getItem("novelista_dunkel") === "1";
      const s = parseFloat(localStorage.getItem("novelista_schrift") || "1.15");
      setDunkel(d);
      setSchrift(isNaN(s) ? 1.15 : s);
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dunkel);
    try {
      localStorage.setItem("novelista_dunkel", dunkel ? "1" : "0");
    } catch {}
  }, [dunkel]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--manuscript-size",
      `${schrift}rem`
    );
    try {
      localStorage.setItem("novelista_schrift", String(schrift));
    } catch {}
  }, [schrift]);

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

  // ---- Automatische Sicherung (höchstens 1× pro Tag, max. 10 Stände) ----
  const sicherungVielleicht = useCallback(
    async (html: string, neuerTitel: string) => {
      if (!html.trim()) return;
      const jetzt = Date.now();
      // im Speicher: nicht öfter als alle 24 h
      if (letzteSicherung.current && jetzt - letzteSicherung.current < 86400000) {
        return;
      }
      // prüfen, ob heute schon eine Sicherung existiert
      const heuteStart = new Date();
      heuteStart.setHours(0, 0, 0, 0);
      const { data: heutige } = await supabase
        .from("manuscript_backups")
        .select("id")
        .eq("user_id", userId)
        .gte("created_at", heuteStart.toISOString())
        .limit(1);
      if (heutige && heutige.length > 0) {
        letzteSicherung.current = jetzt;
        return;
      }
      await supabase
        .from("manuscript_backups")
        .insert({ user_id: userId, title: neuerTitel, content: html });
      letzteSicherung.current = jetzt;
      // alte Stände über 10 hinaus entfernen
      const { data: alle } = await supabase
        .from("manuscript_backups")
        .select("id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (alle && alle.length > 10) {
        const zuLoeschen = alle.slice(10).map((b: { id: string }) => b.id);
        await supabase.from("manuscript_backups").delete().in("id", zuLoeschen);
      }
    },
    [supabase, userId]
  );

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
      sicherungVielleicht(html, neuerTitel);
    },
    [supabase, manuscriptId, sicherungVielleicht]
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

  // ---- Suchen & Ersetzen ----
  useEffect(() => {
    if (!editor || !suchen) {
      setTreffer(0);
      return;
    }
    const t = editor.getText();
    let n = 0;
    let i = 0;
    while ((i = t.indexOf(suchen, i)) !== -1) {
      n++;
      i += suchen.length;
    }
    setTreffer(n);
  }, [suchen, editor, woerter]);

  function alleErsetzen() {
    if (!editor || !suchen) return;
    const { state } = editor;
    const matches: { from: number; to: number }[] = [];
    state.doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        const t = node.text;
        let idx = 0;
        while ((idx = t.indexOf(suchen, idx)) !== -1) {
          const from = pos + idx;
          matches.push({ from, to: from + suchen.length });
          idx += suchen.length;
        }
      }
      return true;
    });
    if (matches.length === 0) {
      setHinweis("Nichts gefunden.");
      setTimeout(() => setHinweis(null), 2000);
      return;
    }
    let tr = state.tr;
    for (let i = matches.length - 1; i >= 0; i--) {
      tr = tr.insertText(ersetzen, matches[i].from, matches[i].to);
    }
    editor.view.dispatch(tr);
    const anzahl = matches.length;
    aktualisiere(editor);
    planeSpeichern(editor.getHTML(), titleRef.current);
    setHinweis(`${anzahl} ${anzahl === 1 ? "Stelle" : "Stellen"} ersetzt.`);
    setTimeout(() => setHinweis(null), 2500);
  }

  // ---- Sicherungen ----
  async function sicherungenOeffnen() {
    setSicherungenOffen(true);
    const { data } = await supabase
      .from("manuscript_backups")
      .select("id,created_at,title")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    setSicherungen(data || []);
  }

  async function sicherungWiederherstellen(id: string) {
    const { data } = await supabase
      .from("manuscript_backups")
      .select("content,title")
      .eq("id", id)
      .single();
    if (data && editor) {
      editor.commands.setContent(data.content, false);
      setTitle(data.title);
      titleRef.current = data.title;
      aktualisiere(editor);
      planeSpeichern(editor.getHTML(), data.title);
      setSicherungenOffen(false);
      setHinweis("Frühere Fassung wiederhergestellt.");
      setTimeout(() => setHinweis(null), 2500);
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
            <ToolButton onClick={() => setSuchenOffen((s) => !s)} active={suchenOffen} label="Suchen & Ersetzen">
              <Icon name="search" />
            </ToolButton>
            <ToolButton onClick={() => setExportOffen(true)} label="Als PDF">
              <Icon name="download" />
              <span className="hidden sm:inline">PDF</span>
            </ToolButton>
            <ToolButton onClick={sicherungenOeffnen} label="Frühere Fassungen">
              <Icon name="history" />
            </ToolButton>
            <ToolButton onClick={() => setEinstellungenOffen(true)} label="Einstellungen">
              <Icon name="gear" />
            </ToolButton>
            <button onClick={abmelden} className="rounded-lg p-2 text-ink-faint transition hover:bg-paper-dim hover:text-ink" aria-label="Abmelden">
              <Icon name="exit" />
            </button>
          </div>
        </div>

        {/* ---- Formatierungsleiste ---- */}
        <div className="flex items-center gap-1 border-t border-line px-4 py-1.5 sm:px-6">
          <FmtButton
            onClick={() => editor.chain().focus().undo().run()}
            label="Rückgängig"
          >
            <Icon name="undo" />
          </FmtButton>
          <FmtButton
            onClick={() => editor.chain().focus().redo().run()}
            label="Wiederherstellen"
          >
            <Icon name="redo" />
          </FmtButton>
          <div className="mx-1 h-5 w-px bg-line" />
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

        {/* ---- Suchen & Ersetzen ---- */}
        {suchenOffen && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2 sm:px-6">
            <input
              value={suchen}
              onChange={(e) => setSuchen(e.target.value)}
              placeholder="Suchen …"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-oxblood"
            />
            <input
              value={ersetzen}
              onChange={(e) => setErsetzen(e.target.value)}
              placeholder="Ersetzen durch …"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-oxblood"
            />
            <span className="text-xs text-ink-faint">
              {suchen ? `${treffer} gefunden` : ""}
            </span>
            <button
              onClick={alleErsetzen}
              disabled={!suchen || treffer === 0}
              className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-paper transition hover:bg-oxblood disabled:opacity-50"
            >
              Alle ersetzen
            </button>
            <button onClick={() => setSuchenOffen(false)} aria-label="Schließen" className="rounded-lg p-2 text-ink-faint hover:bg-paper-dim">
              <Icon name="close" />
            </button>
          </div>
        )}
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

      {/* ---- Einstellungen ---- */}
      {einstellungenOffen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/30 px-6 backdrop-blur-sm" onClick={() => setEinstellungenOffen(false)}>
          <div className="rise w-full max-w-sm rounded-2xl border border-line bg-paper p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-2xl text-ink">Einstellungen</h2>
            <div className="mt-6 space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink-soft">Dunkelmodus</span>
                <button
                  onClick={() => setDunkel((d) => !d)}
                  className={`relative h-7 w-12 rounded-full transition ${dunkel ? "bg-oxblood" : "bg-line"}`}
                  aria-label="Dunkelmodus umschalten"
                >
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-paper transition-all ${dunkel ? "left-6" : "left-1"}`} />
                </button>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-ink-soft">Schriftgröße</span>
                  <span className="text-xs text-ink-faint">{Math.round(schrift * 100)} %</span>
                </div>
                <input
                  type="range"
                  min={0.9}
                  max={1.6}
                  step={0.05}
                  value={schrift}
                  onChange={(e) => setSchrift(parseFloat(e.target.value))}
                  className="w-full accent-oxblood"
                />
                <p className="mt-2 font-serif text-ink" style={{ fontSize: `${schrift}rem` }}>
                  So sieht dein Text aus.
                </p>
              </div>
            </div>
            <button onClick={() => setEinstellungenOffen(false)} className="mt-8 w-full rounded-xl bg-ink px-4 py-3 font-medium text-paper transition hover:bg-oxblood">
              Fertig
            </button>
          </div>
        </div>
      )}

      {/* ---- Frühere Fassungen ---- */}
      {sicherungenOffen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/30 px-6 backdrop-blur-sm" onClick={() => setSicherungenOffen(false)}>
          <div className="rise w-full max-w-md rounded-2xl border border-line bg-paper p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-2xl text-ink">Frühere Fassungen</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Automatisch gespeicherte Stände der letzten Tage. Beim Wiederherstellen
              wird dein aktueller Text ersetzt.
            </p>
            <div className="mt-5 max-h-80 space-y-2 overflow-y-auto">
              {sicherungen.length === 0 ? (
                <p className="text-sm text-ink-faint">Noch keine Sicherungen vorhanden. Sie entstehen automatisch, während du schreibst.</p>
              ) : (
                sicherungen.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5">
                    <span className="text-sm text-ink">
                      {new Date(s.created_at).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" })}
                    </span>
                    <button
                      onClick={() => sicherungWiederherstellen(s.id)}
                      className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-soft transition hover:border-oxblood hover:text-oxblood"
                    >
                      Wiederherstellen
                    </button>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => setSicherungenOffen(false)} className="mt-6 w-full rounded-xl border border-line px-4 py-3 text-ink-soft transition hover:bg-paper-dim">
              Schließen
            </button>
          </div>
        </div>
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
    case "undo": return (<svg {...c}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-4" /></svg>);
    case "redo": return (<svg {...c}><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0-5 5 5 5 0 0 0 5 5h4" /></svg>);
    case "search": return (<svg {...c}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>);
    case "gear": return (<svg {...c}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>);
    case "history": return (<svg {...c}><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg>);
    default: return null;
  }
}
