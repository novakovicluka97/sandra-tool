import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { File } from "node:buffer";
import { POST } from "../app/api/generate/route";
import { protectPdfLocally } from "../lib/privacy";

async function validPayload() {
  const bytes = await readFile(
    new URL("../training-data/BiaforaMorena_ZeugnisantragArbeitszeugnis_20260326.pdf", import.meta.url),
  );
  const file = new File([bytes], "local-only.pdf", {
    type: "application/pdf",
  }) as unknown as globalThis.File;
  const protectedForm = await protectPdfLocally(file);
  return {
    type: "arbeitszeugnis",
    locale: "de",
    protocol: protectedForm.protocol,
    transcript: `${protectedForm.transcript}\n\n## Grammatische Form (von HR lokal bestätigt)\n- feminin (Frau, sie/ihr)`,
  };
}

async function post(body: unknown, contentType = "application/json") {
  return POST(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

test("accepts only a protected payload and builds a PII-scrubbed static prompt", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "";
  try {
    const response = await post(await validPayload());
    const body = await response.json();
    assert.equal(response.status, 500, JSON.stringify(body));
    assert.equal(body.code, "missing_key");
  } finally {
    process.env.ANTHROPIC_API_KEY = previousKey;
  }
});

test("rejects extra request fields before provider processing", async () => {
  const payload = await validPayload();
  const response = await post({
    ...payload,
    filename: "employee.pdf",
    replacements: { secret: "value" },
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid_request");
});

test("rejects a literal name in a protected identity line", async () => {
  const payload = await validPayload();
  payload.transcript = payload.transcript.replace(
    /^- Name: .+$/mu,
    "- Name: Alice Example",
  );
  const response = await post(payload);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "protection_required");
});

test("rejects multipart input", async () => {
  const response = await post("--boundary--", "multipart/form-data; boundary=boundary");
  assert.equal(response.status, 415);
  assert.equal((await response.json()).code, "invalid_content_type");
});
