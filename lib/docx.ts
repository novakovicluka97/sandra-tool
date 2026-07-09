// Markdown-Zeugnis -> Word (.docx), formatted like the real Polymed letters
// in training-data/ (Calibri, 14pt bold title, 10pt body, two-column
// signature block). The internal "## Hinweise für HR" section stays in the
// on-screen preview and is deliberately NOT part of the Word document.

import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
} from "docx";

export type LetterType = "zwischenzeugnis" | "arbeitszeugnis";

const BODY_SIZE = 20; // half-points -> 10pt, as in training-data docx
const TITLE_SIZE = 28; // 14pt
const PARA_SPACING = 200; // twips ~= one blank 10pt line
const SIGNER_TAB = 4536; // 8cm: second signer column, as in training-data

const MONTHS: Record<string, string> = {
  januar: "01",
  februar: "02",
  märz: "03",
  april: "04",
  mai: "05",
  juni: "06",
  juli: "07",
  august: "08",
  september: "09",
  oktober: "10",
  november: "11",
  dezember: "12",
};

/** Letter body only: everything before the internal HR notes section. */
function letterBody(markdown: string): string {
  let text = markdown;
  const notes = text.search(/^##\s+Hinweise/m);
  if (notes !== -1) text = text.slice(0, notes);
  // drop a trailing separator left over before the notes
  text = text.replace(/\n-{3,}\s*$/g, "");
  // strip streaming error/warning markers appended by the API route
  text = text.replace(/\n\[(FEHLER|WARNUNG):[^\]]*\]\s*/g, "\n");
  return text.trim();
}

function inlineRuns(text: string, opts: { bold?: boolean } = {}): TextRun[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**")
        ? new TextRun({ text: part.slice(2, -2), bold: true, size: BODY_SIZE })
        : new TextRun({ text: part, bold: opts.bold ?? false, size: BODY_SIZE }),
    );
}

/**
 * Signature lines of the form "Name — Funktion" (also – or -). The real
 * letters place the two signers side by side: one line with both names,
 * one line with both functions.
 */
function signerPair(line: string): [string, string] | null {
  const m = line.match(/^(.{2,60}?)\s+[—–-]\s+(.{2,60})$/);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

function tabbedLine(cells: string[]): Paragraph {
  const children: TextRun[] = [];
  cells.forEach((cell, i) => {
    if (i > 0) children.push(new TextRun({ children: [new Tab()], size: BODY_SIZE }));
    children.push(new TextRun({ text: cell, size: BODY_SIZE }));
  });
  return new Paragraph({
    children,
    tabStops: [{ type: TabStopType.LEFT, position: SIGNER_TAB }],
    spacing: { after: 0 },
  });
}

export function letterToParagraphs(markdown: string): Paragraph[] {
  const lines = letterBody(markdown).split("\n");
  const paragraphs: Paragraph[] = [];
  let bullets: string[] = [];
  let signatureLines: string[] | null = null;

  const flushBullets = () => {
    bullets.forEach((item, i) => {
      paragraphs.push(
        new Paragraph({
          children: inlineRuns(item),
          bullet: { level: 0 },
          spacing: { after: i === bullets.length - 1 ? PARA_SPACING : 0 },
        }),
      );
    });
    bullets = [];
  };

  const flushSignature = () => {
    if (!signatureLines) return;
    const lines = signatureLines;
    signatureLines = null;
    // "Name — Funktion" per line, or name and function on separate lines
    let pairs: [string, string][] = [];
    const dashPairs = lines.map(signerPair);
    if (lines.length > 0 && dashPairs.every(Boolean)) {
      pairs = dashPairs as [string, string][];
    } else if (lines.length === 4) {
      pairs = [
        [lines[0], lines[1]],
        [lines[2], lines[3]],
      ];
    }
    if (pairs.length >= 2) {
      // side by side, as in the real letters
      paragraphs.push(tabbedLine(pairs.map((s) => s[0])));
      paragraphs.push(tabbedLine(pairs.map((s) => s[1])));
    } else if (pairs.length === 1) {
      paragraphs.push(
        new Paragraph({ children: inlineRuns(pairs[0][0]), spacing: { after: 0 } }),
        new Paragraph({ children: inlineRuns(pairs[0][1]), spacing: { after: 0 } }),
      );
    } else {
      lines.forEach((l) =>
        paragraphs.push(
          new Paragraph({ children: inlineRuns(l), spacing: { after: 0 } }),
        ),
      );
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line === "---") continue;

    if (signatureLines) {
      signatureLines.push(line);
      continue;
    }

    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      continue;
    }
    flushBullets();

    if (line.startsWith("# ")) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: line.slice(2), bold: true, size: TITLE_SIZE }),
          ],
          spacing: { after: 400 },
        }),
      );
      continue;
    }

    // bold standalone company line opens the signature block
    if (/^\*\*[^*]+\*\*$/.test(line)) {
      paragraphs.push(
        new Paragraph({
          children: inlineRuns(line),
          // room for handwritten signatures, as in the real letters
          spacing: { before: 200, after: 600 },
        }),
      );
      signatureLines = [];
      continue;
    }

    paragraphs.push(
      new Paragraph({
        children: inlineRuns(line.startsWith("## ") ? line.slice(3) : line),
        spacing: { after: PARA_SPACING },
      }),
    );
  }
  flushBullets();
  flushSignature();
  return paragraphs;
}

export async function letterToDocxBlob(markdown: string): Promise<Blob> {
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: BODY_SIZE },
          paragraph: {
            spacing: { line: 240, after: PARA_SPACING },
            alignment: AlignmentType.LEFT,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            // A4 with the margins of the original Polymed letters
            size: { width: 11906, height: 16838 },
            margin: { top: 2127, right: 1133, bottom: 851, left: 1276 },
          },
        },
        children: letterToParagraphs(markdown),
      },
    ],
  });
  return Packer.toBlob(doc);
}

/**
 * Filename following the training-data convention,
 * e.g. "BiaforaMorena_Arbeitszeugnis_20260630.docx".
 */
export function letterFilename(
  markdown: string,
  type: LetterType,
  fallbackBase: string,
): string {
  const body = letterBody(markdown);
  const typeLabel = type === "arbeitszeugnis" ? "Arbeitszeugnis" : "Zwischenzeugnis";

  let namePart = "";
  const boldName = body.match(/\*\*([A-Za-zÀ-ÿ' .-]{4,60})\*\*/);
  if (boldName) {
    const words = boldName[1].trim().split(/\s+/);
    if (words.length >= 2) {
      namePart = words[words.length - 1] + words.slice(0, -1).join("");
    } else {
      namePart = words[0];
    }
    namePart = namePart.replace(/[^A-Za-zÀ-ÿ]/g, "");
  }

  let datePart = "";
  const date = body.match(/,\s*(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\s+(\d{4})/g);
  if (date) {
    // last date in the letter is the issue date line ("Glattbrugg, …")
    const m = date[date.length - 1].match(
      /(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\s+(\d{4})/,
    );
    if (m) {
      const month = MONTHS[m[2].toLowerCase()];
      if (month) datePart = `${m[3]}${month}${m[1].padStart(2, "0")}`;
    }
  }

  const base = namePart || fallbackBase.replace(/\.pdf$/i, "").replace(/[^\w-]/g, "");
  return [base, typeLabel, datePart].filter(Boolean).join("_") + ".docx";
}
