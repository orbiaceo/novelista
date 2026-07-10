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

interface ProjektInfo {
  id: string;
  title: string;
  status: string;
  word_count: number;
  updated_at: string;
}

interface Props {
  initialContent: string;
  initialTitle: string;
  manuscriptId: string;
  userId: string;
  projektStatus: string;
  projekte: ProjektInfo[];
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
  projektStatus,
  projekte,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [title, setTitle] = useState(initialTitle);
  const [status, setStatus] = useState<SaveStatus>("gespeichert");
  const [korrigiere, setKorrigiere] = useState(false);
  const [verbessere, setVerbessere] = useState(false);
  const [diktiere, setDiktiere] = useState(false);
  const [sidebar, setSidebar] = useState(false);

  // Projektverwaltung (Bibliothek)
  const [bibliothek, setBibliothek] = useState(false);
  const [projektListe, setProjektListe] = useState<ProjektInfo[]>(projekte);
  const [projektMenue, setProjektMenue] = useState<string | null>(null);
  const [importiere, setImportiere] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
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
        .eq("manuscript_id", manuscriptId)
        .gte("created_at", heuteStart.toISOString())
        .limit(1);
      if (heutige && heutige.length > 0) {
        letzteSicherung.current = jetzt;
        return;
      }
      await supabase
        .from("manuscript_backups")
        .insert({ user_id: userId, manuscript_id: manuscriptId, title: neuerTitel, content: html });
      letzteSicherung.current = jetzt;
      // alte Stände über 10 hinaus entfernen (pro Projekt)
      const { data: alle } = await supabase
        .from("manuscript_backups")
        .select("id")
        .eq("manuscript_id", manuscriptId)
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
  // Zielbereich: markierte Auswahl, sonst der zuletzt geschriebene Absatz
  function zielBereich(): { from: number; to: number } | null {
    if (!editor) return null;
    const { state } = editor;
    const { from, to, empty } = state.selection;
    if (!empty && from !== to) return { from, to };
    // letzter nicht-leerer Textblock
    let ziel: { from: number; to: number } | null = null;
    state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent.trim()) {
        ziel = { from: pos + 1, to: pos + node.nodeSize - 1 };
      }
      return true;
    });
    return ziel;
  }

  // Wandelt (evtl. in <p>/Blöcke verpacktes) Korrektur-HTML in reines Inline-HTML
  // um, damit beim Wiedereinsetzen KEIN zusätzlicher Absatz / kein Enter entsteht.
  function alsInline(html: string): string {
    const div = document.createElement("div");
    div.innerHTML = html;
    const bloecke = div.querySelectorAll(
      "p, div, h1, h2, h3, h4, h5, h6, blockquote, li"
    );
    if (bloecke.length > 0) {
      return Array.from(bloecke)
        .map((b) => (b as HTMLElement).innerHTML.trim())
        .filter(Boolean)
        .join(" ");
    }
    return div.innerHTML;
  }

  // Plain-Text eines Bereichs samt Positions-Zuordnung (für LanguageTool)
  // ---- Knopf 1: Korrigieren (KI – Fehler, ohne den Stil zu verändern) ----
  async function korrigierenLassen() {
    if (korrigiere || verbessere || !editor) return;
    const bereich = zielBereich();
    if (!bereich) {
      setHinweis("Schreibe zuerst etwas, das ich korrigieren kann.");
      setTimeout(() => setHinweis(null), 3000);
      return;
    }
    const { from, to } = bereich;
    const slice = editor.state.doc.slice(from, to);
    const serializer = DOMSerializer.fromSchema(editor.state.schema);
    const container = document.createElement("div");
    container.appendChild(serializer.serializeFragment(slice.content));
    const html = container.innerHTML;
    if (!container.textContent?.trim()) return;

    setKorrigiere(true);
    setHinweis("Wird korrigiert …");
    try {
      const res = await fetch("/api/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, modus: "lektorat" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Fehler");

      editor.chain().focus().insertContentAt({ from, to }, alsInline(data.corrected)).run();
      aktualisiere(editor);
      planeSpeichern(editor.getHTML(), titleRef.current);
      setHinweis("Korrigiert ✓");
    } catch {
      setHinweis("Die Korrektur ist gerade nicht verfügbar.");
    } finally {
      setKorrigiere(false);
      setTimeout(() => setHinweis(null), 2500);
    }
  }

  // ---- Knopf 2: Schöner schreiben (OpenAI) ----
  async function schoenerSchreiben() {
    if (korrigiere || verbessere || !editor) return;
    const bereich = zielBereich();
    if (!bereich) {
      setHinweis("Schreibe zuerst etwas, das ich überarbeiten kann.");
      setTimeout(() => setHinweis(null), 3000);
      return;
    }
    const { from, to } = bereich;
    const slice = editor.state.doc.slice(from, to);
    const serializer = DOMSerializer.fromSchema(editor.state.schema);
    const container = document.createElement("div");
    container.appendChild(serializer.serializeFragment(slice.content));
    const html = container.innerHTML;
    if (!container.textContent?.trim()) return;

    setVerbessere(true);
    setHinweis("Wird überarbeitet …");
    try {
      const res = await fetch("/api/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, modus: "stil" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Fehler");

      editor
        .chain()
        .focus()
        .insertContentAt({ from, to }, alsInline(data.corrected))
        .run();
      aktualisiere(editor);
      planeSpeichern(editor.getHTML(), titleRef.current);
      setHinweis("Überarbeitet ✨");
    } catch {
      setHinweis("Das Überarbeiten ist gerade nicht verfügbar.");
    } finally {
      setVerbessere(false);
      setTimeout(() => setHinweis(null), 2500);
    }
  }

  // Deutsche Anführungszeichen „…" um die Auswahl (für Dialoge)
  function deutscheAnfuehrung() {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (!empty && from !== to) {
      editor
        .chain()
        .focus()
        .insertContentAt(to, "\u201C")
        .insertContentAt(from, "\u201E")
        .run();
    } else {
      editor.chain().focus().insertContent("\u201E\u201C").run();
      editor.commands.setTextSelection(editor.state.selection.from - 1);
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

  // ---- Projektverwaltung ----
  function projektWaehlen(id: string) {
    if (id === manuscriptId) {
      setBibliothek(false);
      return;
    }
    router.push("/editor?p=" + id);
  }

  async function projektNeu() {
    const name = prompt("Titel des neuen Romans:");
    if (!name || !name.trim()) return;
    const { data } = await supabase
      .from("manuscripts")
      .insert({ user_id: userId, title: name.trim() })
      .select("id")
      .single();
    if (data?.id) router.push("/editor?p=" + data.id);
  }

  // Word-Dokument (.docx) als neues Projekt importieren – inkl. Kapitel
  async function dateiImportieren(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // erlaubt, dieselbe Datei erneut zu wählen
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setHinweis(
        "Bitte eine Word-Datei (.docx) wählen. Google Docs und OpenOffice können als .docx speichern."
      );
      setTimeout(() => setHinweis(null), 6000);
      return;
    }
    setImportiere(true);
    setHinweis("Dokument wird importiert …");
    try {
      const arrayBuffer = await file.arrayBuffer();
      const mod = await import("mammoth/mammoth.browser");
      const mammoth = mod.default ?? mod;
      const styleMap = [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Überschrift 1'] => h1:fresh",
        "p[style-name='heading 1'] => h1:fresh",
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Titel'] => h1:fresh",
      ];
      const result = await mammoth.convertToHtml({ arrayBuffer }, { styleMap });
      const html = result.value || "";
      if (!html.trim()) {
        setHinweis("Das Dokument scheint leer zu sein.");
        setTimeout(() => setHinweis(null), 5000);
        return;
      }
      const titel =
        file.name.replace(/\.docx$/i, "").trim() || "Importiertes Dokument";
      const { data, error } = await supabase
        .from("manuscripts")
        .insert({ user_id: userId, title: titel, content: html })
        .select("id")
        .single();
      if (error || !data?.id) throw new Error("Speichern fehlgeschlagen");
      router.push("/editor?p=" + data.id);
    } catch {
      setHinweis("Der Import hat nicht geklappt. Ist es eine gültige .docx-Datei?");
      setTimeout(() => setHinweis(null), 6000);
    } finally {
      setImportiere(false);
    }
  }

  async function projektUmbenennen(p: ProjektInfo) {
    const name = prompt("Neuer Titel:", p.title);
    if (!name || !name.trim()) return;
    await supabase
      .from("manuscripts")
      .update({ title: name.trim() })
      .eq("id", p.id);
    setProjektListe((liste) =>
      liste.map((x) => (x.id === p.id ? { ...x, title: name.trim() } : x))
    );
    if (p.id === manuscriptId) {
      setTitle(name.trim());
      titleRef.current = name.trim();
    }
    setProjektMenue(null);
  }

  async function projektStatusSetzen(p: ProjektInfo, neu: string) {
    await supabase.from("manuscripts").update({ status: neu }).eq("id", p.id);
    setProjektListe((liste) =>
      liste.map((x) => (x.id === p.id ? { ...x, status: neu } : x))
    );
    setProjektMenue(null);
    setHinweis(
      neu === "fertig" ? `„${p.title}" abgeschlossen` : `„${p.title}" wieder aktiv`
    );
    setTimeout(() => setHinweis(null), 2200);
  }

  async function projektLoeschen(p: ProjektInfo) {
    if (
      !confirm(
        `„${p.title}" wirklich unwiderruflich löschen? Das kann nicht rückgängig gemacht werden.`
      )
    )
      return;
    await supabase.from("manuscripts").delete().eq("id", p.id);
    const rest = projektListe.filter((x) => x.id !== p.id);
    setProjektListe(rest);
    setProjektMenue(null);
    if (p.id === manuscriptId) {
      const ziel = rest.find((x) => x.status === "aktiv") ?? rest[0];
      if (ziel) router.push("/editor?p=" + ziel.id);
      else router.push("/editor");
    }
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
      .eq("manuscript_id", manuscriptId)
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
            onClick={() => setBibliothek(true)}
            aria-label="Meine Romane"
            className="rounded-lg p-2 text-ink-soft transition hover:bg-paper-dim"
          >
            <Icon name="home" />
          </button>
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
          <span className="hidden font-serif text-lg tracking-tight text-ink sm:inline">
            Novelista
          </span>
          <span className="truncate font-serif text-ink-soft sm:border-l sm:border-line sm:pl-3" style={{ maxWidth: "40vw" }}>
            {title}
          </span>
          {projektStatus === "fertig" && (
            <span className="hidden rounded-full bg-paper-dim px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft sm:inline">
              Abgeschlossen
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-ink-faint sm:inline">
              {woerter.toLocaleString("de-DE")} Wörter
              {woerter > 0
                ? ` · ≈\u00A0${seitenSchaetzung(woerter).toLocaleString("de-DE")}\u00A0Seiten`
                : ""}
              {" · "}
              {statusText(status)}
            </span>
            <ToolButton onClick={diktatUmschalten} active={diktiere} label={diktiere ? "Diktat beenden" : "Diktieren"}>
              <Icon name={diktiere ? "stop" : "mic"} />
            </ToolButton>
            <ToolButton onClick={korrigierenLassen} active={korrigiere} label="Korrigieren (Rechtschreibung & Grammatik, gratis)" disabled={korrigiere || verbessere}>
              <Icon name="check" />
              <span className="hidden sm:inline">{korrigiere ? "Prüfe …" : "Korrigieren"}</span>
            </ToolButton>
            <ToolButton onClick={schoenerSchreiben} active={verbessere} label="Schöner schreiben (mit KI)" disabled={korrigiere || verbessere}>
              <Icon name="sparkle" />
              <span className="hidden sm:inline">{verbessere ? "Überarbeite …" : "Schöner"}</span>
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
          <FmtButton onClick={deutscheAnfuehrung} label="Deutsche Anführungszeichen „…“ (für Dialoge)">
            <span className="font-serif text-base leading-none">„“</span>
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
        <FmtButton onClick={deutscheAnfuehrung} label="Deutsche Anführungszeichen">
          <span className="font-serif text-base leading-none">„“</span>
        </FmtButton>
        <div className="mx-0.5 h-5 w-px bg-line" />
        <FmtButton onClick={korrigierenLassen} label="Auswahl korrigieren">
          <Icon name="check" />
        </FmtButton>
        <FmtButton onClick={schoenerSchreiben} label="Auswahl schöner schreiben">
          <Icon name="sparkle" />
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

      {/* ---- Bibliothek (Projektverwaltung) ---- */}
      {bibliothek && (
        <div
          className="fixed inset-0 z-50 bg-ink/35 backdrop-blur-sm"
          onClick={() => {
            setBibliothek(false);
            setProjektMenue(null);
          }}
        >
          <aside
            className="absolute left-0 top-0 flex h-full w-80 max-w-[85%] flex-col border-r border-line bg-paper shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pb-3 pt-6">
              <h2 className="font-serif text-2xl text-ink">Meine Romane</h2>
              <p className="mt-1 text-sm text-ink-faint">
                Wähle ein Projekt oder beginne ein neues.
              </p>
            </div>
            <button
              onClick={projektNeu}
              className="mx-5 mb-2 flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 font-medium text-paper transition hover:bg-oxblood"
            >
              <Icon name="plus" /> Neues Projekt
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".docx"
              onChange={dateiImportieren}
              className="hidden"
            />
            <button
              onClick={() => importRef.current?.click()}
              disabled={importiere}
              className="mx-5 mb-1 flex items-center justify-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:border-oxblood hover:text-oxblood disabled:opacity-50"
            >
              <Icon name="upload" /> {importiere ? "Importiere …" : "Dokument importieren (.docx)"}
            </button>
            <div className="flex-1 overflow-y-auto px-3 pb-6">
              <ProjektAbschnitt
                titel="Aktuelle Projekte"
                projekte={projektListe.filter((p) => p.status !== "fertig")}
                leer="Keine aktiven Projekte."
                aktivId={manuscriptId}
                menueId={projektMenue}
                onWaehlen={projektWaehlen}
                onMenue={(id) => setProjektMenue((m) => (m === id ? null : id))}
                onUmbenennen={projektUmbenennen}
                onStatus={(p) => projektStatusSetzen(p, "fertig")}
                onLoeschen={projektLoeschen}
              />
              <ProjektAbschnitt
                titel="Abgeschlossene Projekte"
                projekte={projektListe.filter((p) => p.status === "fertig")}
                leer="Noch nichts abgeschlossen."
                aktivId={manuscriptId}
                menueId={projektMenue}
                onWaehlen={projektWaehlen}
                onMenue={(id) => setProjektMenue((m) => (m === id ? null : id))}
                onUmbenennen={projektUmbenennen}
                onStatus={(p) => projektStatusSetzen(p, "aktiv")}
                onLoeschen={projektLoeschen}
              />
            </div>
          </aside>
        </div>
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

// Geschätzte Seitenzahl im Taschenformat 12×19 cm (wie „Der Sog ins Nichts").
// Kalibriert auf ~278 Wörter pro Seite (50.000 Wörter ≈ 180 Seiten).
const WOERTER_PRO_TASCHENBUCHSEITE = 278;
function seitenSchaetzung(woerter: number): number {
  if (woerter <= 0) return 0;
  return Math.max(1, Math.round(woerter / WOERTER_PRO_TASCHENBUCHSEITE));
}

function statusText(s: SaveStatus) {
  if (s === "speichert") return "speichert …";
  if (s === "ungespeichert") return "nicht gespeichert";
  return "gespeichert";
}

function ProjektAbschnitt({
  titel,
  projekte,
  leer,
  aktivId,
  menueId,
  onWaehlen,
  onMenue,
  onUmbenennen,
  onStatus,
  onLoeschen,
}: {
  titel: string;
  projekte: ProjektInfo[];
  leer: string;
  aktivId: string;
  menueId: string | null;
  onWaehlen: (id: string) => void;
  onMenue: (id: string) => void;
  onUmbenennen: (p: ProjektInfo) => void;
  onStatus: (p: ProjektInfo) => void;
  onLoeschen: (p: ProjektInfo) => void;
}) {
  const fertig = titel.startsWith("Abge");
  return (
    <div className="mb-3">
      <h3 className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {titel}
      </h3>
      {projekte.length === 0 ? (
        <p className="px-3 py-1 text-sm text-ink-faint">{leer}</p>
      ) : (
        projekte.map((p) => (
          <div key={p.id} className="relative">
            <button
              onClick={() => onWaehlen(p.id)}
              className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                p.id === aktivId
                  ? "border-line bg-paper-dim"
                  : "border-transparent hover:bg-paper-dim"
              }`}
            >
              <span
                className={`block truncate pr-7 font-serif text-base ${
                  p.id === aktivId
                    ? "text-oxblood"
                    : fertig
                      ? "text-ink-faint"
                      : "text-ink"
                }`}
              >
                {p.title}
              </span>
              <span className="mt-0.5 block text-xs text-ink-faint">
                {(p.word_count ?? 0).toLocaleString("de-DE")} Wörter
              </span>
            </button>
            <button
              onClick={() => onMenue(p.id)}
              aria-label="Optionen"
              className="absolute right-1.5 top-2 rounded-md p-1.5 text-ink-faint transition hover:bg-paper hover:text-ink"
            >
              <Icon name="dots" />
            </button>
            {menueId === p.id && (
              <div className="absolute right-2 top-11 z-10 min-w-[190px] rounded-xl border border-line bg-paper p-1.5 shadow-xl">
                <button onClick={() => onStatus(p)} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-ink-soft transition hover:bg-paper-dim hover:text-ink">
                  {fertig ? "↺ Wieder aufnehmen" : "✓ Als abgeschlossen markieren"}
                </button>
                <button onClick={() => onUmbenennen(p)} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-ink-soft transition hover:bg-paper-dim hover:text-ink">
                  ✎ Umbenennen
                </button>
                <button onClick={() => onLoeschen(p)} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-ink-soft transition hover:bg-paper-dim hover:text-oxblood">
                  🗑 Löschen
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
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
    case "home": return (<svg {...c}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /><path d="M9.5 20v-6h5v6" /></svg>);
    case "mic": return (<svg {...c}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>);
    case "stop": return (<svg {...c}><rect x="6" y="6" width="12" height="12" rx="2" /></svg>);
    case "check": return (<svg {...c}><path d="M20 6 9 17l-5-5" /></svg>);
    case "download": return (<svg {...c}><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>);
    case "exit": return (<svg {...c}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>);
    case "center": return (<svg {...c}><line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="5" y1="18" x2="19" y2="18" /></svg>);
    case "quote": return (<svg {...c}><path d="M7 7h4v4c0 2-1 3-3 4M13 7h4v4c0 2-1 3-3 4" /></svg>);
    case "close": return (<svg {...c}><path d="M6 6l12 12M18 6L6 18" /></svg>);
    case "plus": return (<svg {...c}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>);
    case "dots": return (<svg {...c}><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>);
    case "sparkle": return (<svg {...c}><path d="m12 3 2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" /></svg>);
    case "upload": return (<svg {...c}><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>);
    case "undo": return (<svg {...c}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-4" /></svg>);
    case "redo": return (<svg {...c}><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0-5 5 5 5 0 0 0 5 5h4" /></svg>);
    case "search": return (<svg {...c}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>);
    case "gear": return (<svg {...c}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>);
    case "history": return (<svg {...c}><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg>);
    default: return null;
  }
}
