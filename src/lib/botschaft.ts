import { Node, mergeAttributes } from "@tiptap/core";

// „Botschaft“: eine Nachricht, die die Figuren vorfinden – weder Dialog
// noch Erzähler. Gespeichert als <p class="botschaft">…</p>.
// Absichtlich ein <p>: PDF- und Word-Export, die (noch) nichts von der
// Botschaft wissen, behandeln sie dann wie einen normalen Absatz –
// es geht also nie Text verloren.

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    botschaft: {
      /** Absatz ↔ Botschaft umschalten */
      toggleBotschaft: () => ReturnType;
    };
  }
}

export const Botschaft = Node.create({
  name: "botschaft",
  group: "block",
  content: "inline*",
  defining: true,

  parseHTML() {
    // höhere Priorität als der normale Absatz, damit <p class="botschaft">
    // beim Laden wieder als Botschaft erkannt wird
    return [{ tag: "p.botschaft", priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes(HTMLAttributes, { class: "botschaft" }), 0];
  },

  addCommands() {
    return {
      toggleBotschaft:
        () =>
        ({ commands }) =>
          commands.toggleNode(this.name, "paragraph"),
    };
  },
  // Enter am Ende → normaler Absatz geht weiter (ProseMirror-Standard).
  // Umschalt+Enter → Zeilenumbruch innerhalb der Botschaft.
});
