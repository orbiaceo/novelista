/* eslint-disable @typescript-eslint/no-explicit-any */
// Exportiert das Manuskript als sauberes .docx – Kapitel als „Überschrift 1",
// Fett/Kursiv erhalten. Ideales Format, damit Claude als Verlag daraus den
// BoD-Buchsatz erzeugen kann (die Satz-Pipeline liest DOCX).

export async function manuskriptAlsDocx(html: string, title: string, author = "Sonja Paredes Pernía") {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } =
    await import("docx");

  const dom = new DOMParser().parseFromString(html || "", "text/html");
  const bloecke = Array.from(dom.body.children) as HTMLElement[];

  const runsSammeln = (
    node: Node,
    bold: boolean,
    italic: boolean,
    out: any[]
  ) => {
    node.childNodes.forEach((ch) => {
      if (ch.nodeType === 3) {
        const t = ch.textContent ?? "";
        if (t) out.push(new TextRun({ text: t, bold, italics: italic }));
      } else if (ch.nodeType === 1) {
        const el = ch as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (tag === "br") out.push(new TextRun({ break: 1 }));
        else
          runsSammeln(
            el,
            bold || tag === "strong" || tag === "b",
            italic || tag === "em" || tag === "i",
            out
          );
      }
    });
  };

  const children: any[] = [];

  // Titelei: Autor, Titel, „Roman" (zentriert)
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2400, after: 240 },
      children: [new TextRun({ text: author, italics: true })],
    })
  );
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: title || "Mein Roman", bold: true, size: 40 })],
    })
  );
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: "Roman", italics: true })],
    })
  );

  bloecke.forEach((el, idx) => {
    const tag = el.tagName.toLowerCase();
    const runs: any[] = [];
    runsSammeln(el, false, false, runs);
    const istErster = idx === 0;

    if (/^h[1-6]$/.test(tag)) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: true, // jedes Kapitel beginnt auf neuer Seite
          spacing: { before: 240, after: 120 },
          children: runs.length ? runs : [new TextRun(el.textContent || "")],
        })
      );
    } else if (runs.length === 0) {
      children.push(new Paragraph({ children: [], pageBreakBefore: istErster || undefined }));
    } else {
      const zentriert =
        (el.style.textAlign || "").toLowerCase() === "center";
      children.push(
        new Paragraph({
          alignment: zentriert ? AlignmentType.CENTER : undefined,
          pageBreakBefore: istErster || undefined,
          children: runs,
        })
      );
    }
  });

  const dokument = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(dokument);

  const name =
    (title || "roman").toLowerCase().replace(/[^a-z0-9äöüß]+/gi, "-") + ".docx";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
