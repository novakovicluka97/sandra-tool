import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
// Opus with adaptive thinking can take a few minutes on a scanned form.
export const maxDuration = 300;

const MODEL = "claude-opus-4-8";
const MAX_PDF_BYTES = 10 * 1024 * 1024;

type LetterType = "zwischenzeugnis" | "arbeitszeugnis";

// Few-shot pools mirror the configuration validated by the eval harness
// (ZZ_POOL_A and AZ_POOL in scripts/run-all.mjs).
const EXAMPLE_POOLS: Record<LetterType, { name: string; type: LetterType }[]> = {
  zwischenzeugnis: [
    { name: "biafora", type: "zwischenzeugnis" },
    { name: "mettler", type: "zwischenzeugnis" },
  ],
  arbeitszeugnis: [
    { name: "biafora", type: "arbeitszeugnis" },
    { name: "mettler", type: "zwischenzeugnis" },
  ],
};

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

const systemCache = new Map<LetterType, string>();

function buildSystemPrompt(type: LetterType): string {
  const cached = systemCache.get(type);
  if (cached) return cached;

  const base = read("prompts/system-zeugnis.md");
  const style = read("prompts/style-rules.md");
  const company = read("prompts/company-config.md");

  let examples =
    "\n\n# Beispiele (echte, durch HR erstellte Zeugnisse dieses Unternehmens)\n" +
    "\nDie folgenden Beispiele zeigen den Hausstil. Übernimm Struktur, Ton und Register, nicht den Inhalt.\n";
  EXAMPLE_POOLS[type].forEach((spec, i) => {
    const form = read(`examples/${spec.name}-form.md`);
    const letter = read(`examples/${spec.name}-${spec.type}.md`);
    const label = spec.type === "arbeitszeugnis" ? "Arbeitszeugnis" : "Zwischenzeugnis";
    examples += `\n## Beispiel ${i + 1} — Eingabe (Zeugnisantrag)\n\n${form}\n`;
    examples += `\n## Beispiel ${i + 1} — Ausgabe (${label})\n\n${letter}\n`;
  });

  const prompt = `${base}\n\n${style}\n\n${company}\n${examples}`;
  systemCache.set(type, prompt);
  return prompt;
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonError("ANTHROPIC_API_KEY ist nicht konfiguriert.", 500);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Ungültige Anfrage (multipart/form-data erwartet).", 400);
  }

  const type = form.get("type");
  if (type !== "zwischenzeugnis" && type !== "arbeitszeugnis") {
    return jsonError("Ungültige Zeugnisart.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return jsonError("Kein Zeugnisantrag (PDF) hochgeladen.", 400);
  }
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    return jsonError("Bitte ein PDF hochladen.", 400);
  }
  if (file.size > MAX_PDF_BYTES) {
    return jsonError("PDF ist zu gross (max. 10 MB).", 413);
  }

  const pdfBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const typeLabel =
    type === "arbeitszeugnis" ? "Arbeitszeugnis (Schlusszeugnis)" : "Zwischenzeugnis";

  const client = new Anthropic();

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: buildSystemPrompt(type),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
          },
          {
            type: "text",
            text: `Im Anhang findest du einen ausgefüllten Zeugnisantrag. Erstelle daraus den Entwurf eines **${typeLabel}** gemäss deinen Anweisungen.`,
          },
        ],
      },
    ],
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(
            encoder.encode("\n\n[FEHLER: Die Anfrage wurde vom Modell abgelehnt.]"),
          );
        } else if (final.stop_reason === "max_tokens") {
          controller.enqueue(
            encoder.encode("\n\n[WARNUNG: Ausgabe wurde am Token-Limit abgeschnitten.]"),
          );
        }
      } catch (err) {
        console.error("Generation failed:", err);
        const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
        controller.enqueue(encoder.encode(`\n\n[FEHLER: ${msg}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
