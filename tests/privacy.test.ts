import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { File } from "node:buffer";
import { PDFDocument } from "pdf-lib";
import {
  PrivacyProtectionError,
  protectPdfLocally,
  restoreProtectedValues,
} from "../lib/privacy";

async function fixture(name: string): Promise<globalThis.File> {
  const bytes = await readFile(new URL(`../training-data/${name}`, import.meta.url));
  return new File([bytes], name, { type: "application/pdf" }) as unknown as globalThis.File;
}

test("creates a pseudonymised transcript without the source identifiers", async () => {
  const input = await fixture("BiaforaMorena_ZeugnisantragArbeitszeugnis_20260326.pdf");
  const result = await protectPdfLocally(input);

  assert.equal(result.sourceFieldCount, 149);
  assert.ok(result.protectedValueCount >= 8);
  assert.match(result.transcript, /\[\[LOCAL_NACHNAME_[a-f0-9]{8}\]\]/u);
  assert.match(result.transcript, /\[\[LOCAL_VORNAME_[a-f0-9]{8}\]\]/u);

  for (const forbidden of [
    "Biafora",
    "Morena",
    "13.12.2002",
    "Otelfingen",
    "Müller Claudia",
    "01.07.2025",
    "30.06.2026",
  ]) {
    assert.equal(
      result.transcript.toLocaleLowerCase("de-CH").includes(forbidden.toLocaleLowerCase("de-CH")),
      false,
      `${forbidden} leaked into the outbound transcript`,
    );
  }

  // The first name also occurs in the free-text "Begründung" field.
  assert.doesNotMatch(result.transcript, /Morena ist eine sehr wertvolle/iu);
  assert.ok(Object.values(result.replacements).includes("13. Dezember 2002"));
  assert.ok(Object.values(result.replacements).includes("Claudia Müller"));
  assert.equal(result.replacements["[[LOCAL_HR_SIGNATORY]]"], "Sandra Zanfirovic");
  assert.equal(result.suggestedGrammaticalForm, "feminine");

  const [token, value] = Object.entries(result.replacements)[0];
  assert.equal(restoreProtectedValues(`Person: ${token}`, result.replacements), `Person: ${value}`);
});

test("accepts the known empty form without inventing identifiers", async () => {
  const input = await fixture("Zeugnisantrag Leer.pdf");
  const result = await protectPdfLocally(input);

  assert.equal(result.sourceFieldCount, 149);
  assert.equal(result.protectedValueCount, 0);
  assert.match(result.transcript, /- Name: \(leer\)/u);
});

for (const [name, forbidden] of [
  ["BergomiSeraina_Zeugnisantrag_20260605.pdf", ["Bergomi", "Seraina"]],
  ["MettlerMichael_Zeugnisantrag20260601.pdf", ["Mettler", "Michael"]],
  ["MoserDominique_Zeugnisantrag_20260605.pdf", ["Moser", "Dominique"]],
] as const) {
  test(`protects all direct names in ${name}`, async () => {
    const result = await protectPdfLocally(await fixture(name));
    assert.equal(result.sourceFieldCount, 149);
    forbidden.forEach((value) => assert.doesNotMatch(result.transcript, new RegExp(value, "iu")));
  });
}

test("fails closed for a flattened scan", async () => {
  const input = await fixture("SantamariaDianaSofia_ZeugnisantragZwischenzeugnis.pdf");

  await assert.rejects(
    () => protectPdfLocally(input),
    (error: unknown) =>
      error instanceof PrivacyProtectionError && error.code === "scan_not_supported",
  );
});

test("fails closed for an unknown PDF form", async () => {
  const unknown = await PDFDocument.create();
  unknown.addPage();
  const bytes = await unknown.save();
  const input = new File([bytes], "unknown.pdf", {
    type: "application/pdf",
  }) as unknown as globalThis.File;

  await assert.rejects(
    () => protectPdfLocally(input),
    (error: unknown) =>
      error instanceof PrivacyProtectionError && error.code === "scan_not_supported",
  );
});

test("rejects a modified field schema even when the field count is unchanged", async () => {
  const source = await fixture("Zeugnisantrag Leer.pdf");
  const document = await PDFDocument.load(await source.arrayBuffer());
  const field = document.getForm().getCheckBox("weiteres Allgemein");
  (field.acroField as unknown as { setPartialName(name: string): void }).setPartialName(
    "Patient Max Mustermann",
  );
  const bytes = await document.save();
  const changed = new File([bytes], "changed.pdf", {
    type: "application/pdf",
  }) as unknown as globalThis.File;

  await assert.rejects(
    () => protectPdfLocally(changed),
    (error: unknown) =>
      error instanceof PrivacyProtectionError && error.code === "unknown_form",
  );
});
