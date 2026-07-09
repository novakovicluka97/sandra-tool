import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");

const DEFAULT_MODEL = "claude-sonnet-5";

function loadApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  for (const name of [".env.local", ".env"]) {
    const envPath = path.join(ROOT, name);
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, "utf8");
    const match = content.match(/^\s*ANTHROPIC_API_KEY\s*=\s*"?([^"\r\n]+)"?\s*$/m);
    if (match) return match[1].trim();
  }
  throw new Error(`ANTHROPIC_API_KEY not found (env var, .env.local, or .env in ${ROOT})`);
}

function read(p) {
  return fs.readFileSync(p, "utf8");
}

// exampleSpecs: [{ name: "biafora", type: "zwischenzeugnis" }, ...]
// Mirrors buildSystemPrompt in app/api/generate/route.ts so the harness
// exercises the same prompt stack the web app ships with.
function buildSystemPrompt(exampleSpecs) {
  const base = read(path.join(ROOT, "prompts", "system-zeugnis.md"));
  const style = read(path.join(ROOT, "prompts", "style-rules.md"));
  const company = read(path.join(ROOT, "prompts", "company-config.md"));
  let examples = "\n\n# Beispiele (echte, durch HR erstellte Zeugnisse dieses Unternehmens)\n";
  examples +=
    "\nDie folgenden Beispiele zeigen den Hausstil. Übernimm Struktur, Ton und Register — nicht den Inhalt.\n";
  exampleSpecs.forEach((spec, i) => {
    const form = read(path.join(ROOT, "examples", `${spec.name}-form.md`));
    const letter = read(path.join(ROOT, "examples", `${spec.name}-${spec.type}.md`));
    examples += `\n## Beispiel ${i + 1} — Eingabe (Zeugnisantrag)\n\n${form}\n`;
    examples += `\n## Beispiel ${i + 1} — Ausgabe (${spec.type === "arbeitszeugnis" ? "Arbeitszeugnis" : "Zwischenzeugnis"})\n\n${letter}\n`;
  });
  return `${base}\n\n${style}\n\n${company}\n${examples}`;
}

function buildUserContent(inputPath, type) {
  const typeLabel = type === "arbeitszeugnis" ? "Arbeitszeugnis (Schlusszeugnis)" : "Zwischenzeugnis";
  const instruction = `Im Anhang findest du einen ausgefüllten Zeugnisantrag. Erstelle daraus den Entwurf eines **${typeLabel}** gemäss deinen Anweisungen.`;

  if (inputPath.toLowerCase().endsWith(".pdf")) {
    const data = fs.readFileSync(inputPath).toString("base64");
    return [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
      { type: "text", text: instruction },
    ];
  }
  // Text transcript input (synthetic cases)
  const transcript = read(inputPath);
  return [
    { type: "text", text: `${instruction}\n\n---\n\n${transcript}` },
  ];
}

export async function generateLetter({ caseName, inputPath, type, exampleSpecs, model = DEFAULT_MODEL }) {
  // Leakage guard: the case under test must never appear in its own few-shot examples.
  for (const spec of exampleSpecs) {
    if (caseName.toLowerCase().includes(spec.name.toLowerCase())) {
      throw new Error(`LEAKAGE: case "${caseName}" has its own letters in the few-shot examples (${spec.name}).`);
    }
  }

  const client = new Anthropic({ apiKey: loadApiKey() });
  const system = buildSystemPrompt(exampleSpecs);
  const content = buildUserContent(inputPath, type);

  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Refusal on case ${caseName}: ${JSON.stringify(response.stop_details)}`);
  }
  if (response.stop_reason === "max_tokens") {
    console.warn(`WARNING [${caseName}/${type}]: output truncated at max_tokens.`);
  }

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const outDir = path.join(ROOT, "eval", "outputs", caseName);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${type}.md`);
  fs.writeFileSync(outPath, text, "utf8");

  const u = response.usage;
  console.log(
    `OK  [${caseName}/${type}] model=${response.model} in=${u.input_tokens} out=${u.output_tokens} -> ${path.relative(ROOT, outPath)}`
  );
  return { outPath, text, usage: u };
}

// CLI: node generate.mjs --input <path> --type zwischenzeugnis|arbeitszeugnis --case <name> --examples name:type,name:type [--model id]
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
  if (!args.input || !args.type || !args.case || !args.examples) {
    console.error("Usage: node generate.mjs --input <path> --type zwischenzeugnis|arbeitszeugnis --case <name> --examples name:type,name:type [--model id]");
    process.exit(1);
  }
  const exampleSpecs = args.examples.split(",").map((s) => {
    const [name, type] = s.split(":");
    return { name, type };
  });
  generateLetter({
    caseName: args.case,
    inputPath: path.isAbsolute(args.input) ? args.input : path.resolve(process.cwd(), args.input),
    type: args.type,
    exampleSpecs,
    model: args.model || DEFAULT_MODEL,
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
