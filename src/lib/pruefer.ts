// Verbindet das Regelwerk (pruefung.ts) mit dem Editor: die gefundenen
// Stellen werden wellig unterstrichen, ohne den Text anzufassen. Getippt
// wird ganz normal weiter – gerechnet wird erst, wenn eine halbe Sekunde
// Ruhe ist, damit das Schreiben auf dem Handy flüssig bleibt.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { pruefe } from "./pruefung";

export interface Stelle {
  von: number; // Position im Dokument
  bis: number;
  meldung: string;
  ersatz?: string;
}

interface PruefStand {
  deko: DecorationSet;
  stellen: Stelle[];
}

export const pruefKey = new PluginKey<PruefStand>("pruefer");

interface Optionen {
  aktiv: () => boolean;
  melde: (stelle: Stelle | null) => void;
}

export function erzeugePruefer({ aktiv, melde }: Optionen) {
  return Extension.create({
    name: "pruefer",

    addProseMirrorPlugins() {
      return [
        new Plugin<PruefStand>({
          key: pruefKey,

          state: {
            init: () => ({ deko: DecorationSet.empty, stellen: [] }),
            apply(tr, alt) {
              const neu = tr.getMeta(pruefKey) as PruefStand | undefined;
              if (neu) return neu;
              if (!tr.docChanged) return alt;
              // Positionen mitwandern lassen, bis neu gerechnet wird
              return {
                deko: alt.deko.map(tr.mapping, tr.doc),
                stellen: alt.stellen.map((s) => ({
                  ...s,
                  von: tr.mapping.map(s.von),
                  bis: tr.mapping.map(s.bis),
                })),
              };
            },
          },

          props: {
            decorations(state) {
              return pruefKey.getState(state)?.deko;
            },
            // Tippen auf eine unterstrichene Stelle → Meldung anzeigen
            handleClick(view, pos) {
              const stand = pruefKey.getState(view.state);
              const treffer = stand?.stellen.find(
                (s) => pos >= s.von && pos <= s.bis
              );
              melde(treffer ?? null);
              return false; // Cursor darf trotzdem gesetzt werden
            },
          },

          view(view) {
            let timer: ReturnType<typeof setTimeout> | null = null;
            let letzterDoc: unknown = null;
            let letztAktiv: boolean | null = null;

            const rechne = () => {
              const doc = view.state.doc;
              const an = aktiv();
              letzterDoc = doc;
              letztAktiv = an;

              const stellen: Stelle[] = [];
              if (an) {
                doc.descendants((node, pos) => {
                  if (!node.isTextblock) return true;
                  const text = node.textBetween(
                    0,
                    node.content.size,
                    "\n",
                    "\n"
                  );
                  if (!text.trim()) return false;
                  for (const f of pruefe(text)) {
                    stellen.push({
                      von: pos + 1 + f.von,
                      bis: pos + 1 + f.bis,
                      meldung: f.meldung,
                      ersatz: f.ersatz,
                    });
                  }
                  return false; // Textblöcke haben keine weiteren Blöcke
                });
              }

              const deko = DecorationSet.create(
                doc,
                stellen.map((s) =>
                  Decoration.inline(s.von, s.bis, {
                    class: "pruef-stelle",
                    title: s.meldung,
                  })
                )
              );
              view.dispatch(
                view.state.tr.setMeta(pruefKey, { deko, stellen })
              );
            };

            const planen = () => {
              if (timer) clearTimeout(timer);
              timer = setTimeout(rechne, 500);
            };

            planen(); // erste Prüfung nach dem Laden

            return {
              update(v) {
                if (v.state.doc === letzterDoc && aktiv() === letztAktiv) return;
                planen();
              },
              destroy() {
                if (timer) clearTimeout(timer);
              },
            };
          },
        }),
      ];
    },
  });
}
