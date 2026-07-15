import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import JSZip from "jszip";
import { letterToDocxBlob, type LetterheadSettings } from "../lib/docx";

const markdown = `# Zwischenzeugnis

Frau Test arbeitet seit dem 1. Januar 2024 in unserem Unternehmen.

Glattbrugg, 16. Juli 2026

**Polymed Medical Center AG**
Sandra Zanfirovic
HR Generalistin`;

function dataUrl(path: string, mime: string): string {
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

const settings: LetterheadSettings = {
  enabled: true,
  header: {
    source: dataUrl("public/header-image.png", "image/png"),
    name: "Polymed Briefkopf",
    type: "png",
    width: 2193,
    height: 395,
  },
  footer: {
    source: dataUrl("public/footer-image.jpg", "image/jpeg"),
    name: "Polymed Fusszeile",
    type: "jpg",
    width: 1994,
    height: 35,
  },
  headerFromTopInches: 0.22,
  footerFromBottomInches: 0.18,
};

test("adds the default letterhead using the original Word template geometry", async () => {
  const blob = await letterToDocxBlob(markdown, settings);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const documentXml = await zip.file("word/document.xml")!.async("text");
  const headerXml = await zip.file("word/header1.xml")!.async("text");
  const footerXml = await zip.file("word/footer1.xml")!.async("text");

  assert.match(documentXml, /<w:headerReference\b/u);
  assert.match(documentXml, /<w:footerReference\b/u);
  assert.match(documentXml, /w:top="2127"/u);
  assert.match(documentXml, /w:bottom="482"/u);
  assert.match(documentXml, /w:header="310"/u);
  assert.match(documentXml, /w:footer="263"/u);
  assert.match(headerXml, /<w:drawing>/u);
  assert.match(footerXml, /<w:drawing>/u);
  assert.ok(Object.keys(zip.files).some((name) => /word\/media\/.*\.png$/u.test(name)));
  assert.ok(Object.keys(zip.files).some((name) => /word\/media\/.*\.jpg$/u.test(name)));
});

test("omits header and footer parts when letterhead is disabled", async () => {
  const blob = await letterToDocxBlob(markdown, { ...settings, enabled: false });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const documentXml = await zip.file("word/document.xml")!.async("text");

  assert.doesNotMatch(documentXml, /<w:headerReference\b/u);
  assert.doesNotMatch(documentXml, /<w:footerReference\b/u);
  assert.equal(zip.file("word/header1.xml"), null);
  assert.equal(zip.file("word/footer1.xml"), null);
});
