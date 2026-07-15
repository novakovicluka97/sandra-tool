import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = "claude-opus-4-8";
const MAX_REQUEST_CHARS = 120_000;
const PRIVACY_PROTOCOL = "local-acroform-v1";

type LetterType = "zwischenzeugnis" | "arbeitszeugnis";
type UiLocale = "de" | "en";

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function privacySafeCompanyConfig(company: string): string {
  const signatories = `## Unterzeichnende (immer zwei)
1. Die im pseudonymisierten Transkript genannte vorgesetzte Person. Verwende ihren exakten [[LOCAL_...]]-Platzhalter als Namen und die separat gelieferte Funktion als Funktionszeile. Ist keine Funktion geliefert, setze [Funktion].
2. [[LOCAL_HR_SIGNATORY]]
HR Generalistin`;
  return company.replace(/## Unterzeichnende[\s\S]*$/u, signatories);
}

function privacySafeStyleRules(style: string): string {
  return style
    .replaceAll("Ralph Friedlos", "[[LOCAL_VORGESETZTE_PERSON]]")
    .replaceAll("Sandra Zanfirovic", "[[LOCAL_HR_SIGNATORY]]");
}

function privacySafeExample(form: string, letter: string, index: number) {
  const token = (label: string) => `[[BEISPIEL_${index}_${label}]]`;
  const replacements: Array<[string, string]> = [
    ["Sandra Zanfirovic", "[[LOCAL_HR_SIGNATORY]]"],
    ["Claudia Müller", token("VORGESETZTE_PERSON")],
    ["Müller Claudia", token("VORGESETZTE_PERSON")],
    ["Ralph Friedlos", token("VORGESETZTE_PERSON")],
    ["Friedlos Ralph", token("VORGESETZTE_PERSON")],
    ["Elias Schwarz", token("VORGESETZTE_PERSON")],
    ["Markus Cueni", token("VORGESETZTE_PERSON")],
    ["Cueni Markus", token("VORGESETZTE_PERSON")],
  ];

  const fields: Array<[string, string]> = [
    ["Name", "NACHNAME"],
    ["Vorname", "VORNAME"],
    ["Geburtsdatum", "GEBURTSDATUM"],
    ["Heimatort / Kanton", "HEIMATORT"],
    ["Vorgesetzte*r", "VORGESETZTE_PERSON"],
    ["Eintritt", "EINTRITTSDATUM"],
    ["Übertritt", "UEBERTRITTSDATUM"],
    ["Austritt", "AUSTRITTSDATUM"],
  ];

  const values = new Map<string, string>();
  for (const [field, label] of fields) {
    const match = form.match(new RegExp(`^- ${escapeRegExp(field)}: (.+)$`, "mu"));
    const value = match?.[1]?.trim();
    if (value && !value.startsWith("(leer)")) {
      values.set(field, value);
      replacements.push([value, token(label)]);
    }
  }

  const firstName = values.get("Vorname");
  const surname = values.get("Name");
  if (firstName && surname) {
    replacements.unshift(
      [`${firstName} ${surname}`, `${token("VORNAME")} ${token("NACHNAME")}`],
      [`${surname} ${firstName}`, `${token("NACHNAME")} ${token("VORNAME")}`],
    );
  }

  const supervisor = values.get("Vorgesetzte*r");
  if (supervisor?.includes(" ")) {
    replacements.push([
      supervisor.split(/\s+/u).reverse().join(" "),
      token("VORGESETZTE_PERSON"),
    ]);
  }

  const apply = (input: string) => {
    let output = input;
    for (const [value, replacement] of replacements.sort(
      (a, b) => b[0].length - a[0].length,
    )) {
      output = output.replace(new RegExp(escapeRegExp(value), "giu"), replacement);
    }
    output = output
      .replace(
        /\b(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:19|20)\d{2}\b/gu,
        token("DATUM"),
      )
      .replace(
        /\b(?:0?[1-9]|[12]\d|3[01])\.\s+(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(?:19|20)\d{2}\b/giu,
        token("DATUM"),
      );
    return output;
  };

  return { form: apply(form), letter: apply(letter) };
}

const systemCache = new Map<LetterType, string>();

function buildSystemPrompt(type: LetterType): string {
  const cached = systemCache.get(type);
  if (cached) return cached;

  const base = read("prompts/system-zeugnis.md");
  const style = privacySafeStyleRules(read("prompts/style-rules.md"));
  const company = privacySafeCompanyConfig(read("prompts/company-config.md"));

  let examples =
    "\n\n# Pseudonymisierte Stilbeispiele\n" +
    "\nDie folgenden Beispiele zeigen den Hausstil. Ihre Personendaten wurden durch Beispielplatzhalter ersetzt. Übernimm Struktur, Ton und Register, nicht den Inhalt.\n";
  EXAMPLE_POOLS[type].forEach((spec, i) => {
    const safe = privacySafeExample(
      read(`examples/${spec.name}-form.md`),
      read(`examples/${spec.name}-${spec.type}.md`),
      i + 1,
    );
    const label = spec.type === "arbeitszeugnis" ? "Arbeitszeugnis" : "Zwischenzeugnis";
    examples += `\n## Beispiel ${i + 1} — Eingabe (Zeugnisantrag)\n\n${safe.form}\n`;
    examples += `\n## Beispiel ${i + 1} — Ausgabe (${label})\n\n${safe.letter}\n`;
  });

  const prompt = `${base}\n\n${style}\n\n${company}\n${examples}`;
  const promptIdentifierTripwire = [
    "Biafora",
    "Morena",
    "Mettler",
    "Michael",
    "Bergomi",
    "Seraina",
    "Sandra Zanfirovic",
    "Claudia Müller",
    "Ralph Friedlos",
    "Elias Schwarz",
    "Markus Cueni",
  ];
  if (promptIdentifierTripwire.some((value) => prompt.includes(value))) {
    throw new Error("Static prompt privacy tripwire failed");
  }
  systemCache.set(type, prompt);
  return prompt;
}

const API_ERRORS: Record<string, Record<UiLocale, string>> = {
  missing_key: {
    de: "Der KI-Dienst ist noch nicht konfiguriert.",
    en: "The AI service is not configured yet.",
  },
  invalid_content_type: {
    de: "Nur lokal geschützte JSON-Anfragen werden akzeptiert.",
    en: "Only locally protected JSON requests are accepted.",
  },
  request_too_large: {
    de: "Die geschützte Anfrage ist zu gross.",
    en: "The protected request is too large.",
  },
  invalid_request: {
    de: "Die geschützte Anfrage ist ungültig.",
    en: "The protected request is invalid.",
  },
  invalid_type: {
    de: "Ungültige Zeugnisart.",
    en: "Invalid reference type.",
  },
  protection_required: {
    de: "Die lokale Datenschutzprüfung fehlt oder ist ungültig.",
    en: "The local privacy check is missing or invalid.",
  },
  unsafe_payload: {
    de: "Die Übertragung wurde gestoppt, weil ein direkter Identifikator erkannt wurde.",
    en: "Transmission was stopped because a direct identifier was detected.",
  },
  cross_origin: {
    de: "Diese Anfrage ist nicht erlaubt.",
    en: "This request is not allowed.",
  },
};

function jsonError(
  code: keyof typeof API_ERRORS,
  status: number,
  locale: UiLocale = "de",
) {
  return new Response(JSON.stringify({ code, error: API_ERRORS[code][locale] }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return jsonError("cross_origin", 403);
    } catch {
      return jsonError("cross_origin", 403);
    }
  }

  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return jsonError("invalid_content_type", 415);
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_REQUEST_CHARS * 2) {
    return jsonError("request_too_large", 413);
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return jsonError("invalid_request", 400);
  }
  if (rawBody.length > MAX_REQUEST_CHARS) return jsonError("request_too_large", 413);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonError("invalid_request", 400);
  }

  if (!payload || typeof payload !== "object") return jsonError("invalid_request", 400);
  const body = payload as Record<string, unknown>;
  const allowedKeys = new Set(["type", "locale", "protocol", "transcript"]);
  const keys = Object.keys(body);
  if (
    keys.length !== allowedKeys.size ||
    keys.some((key) => !allowedKeys.has(key)) ||
    Array.from(allowedKeys).some((key) => !(key in body))
  ) {
    return jsonError("invalid_request", 400);
  }
  if (body.locale !== "de" && body.locale !== "en") {
    return jsonError("invalid_request", 400);
  }
  const locale: UiLocale = body.locale;
  const type = body.type;

  if (type !== "zwischenzeugnis" && type !== "arbeitszeugnis") {
    return jsonError("invalid_type", 400, locale);
  }

  const transcript = body.transcript;
  if (
    body.protocol !== PRIVACY_PROTOCOL ||
    typeof transcript !== "string" ||
    transcript.length < 100 ||
    !transcript.startsWith("# Zeugnisantrag (Formular GRP_DK_1054 v1.1)")
  ) {
    return jsonError("protection_required", 400, locale);
  }

  const protectedLines: Array<[string, string]> = [
    ["Name", "NACHNAME"],
    ["Vorname", "VORNAME"],
    ["Geburtsdatum", "GEBURTSDATUM"],
    ["Heimatort / Kanton", "HEIMATORT"],
    ["Vorgesetzte\\*r", "VORGESETZTE_PERSON"],
    ["Eintritt", "EINTRITTSDATUM"],
    ["Übertritt", "UEBERTRITTSDATUM"],
    ["Austritt", "AUSTRITTSDATUM"],
    ["Stellenbeschreibung vom", "DATUM_STELLENBESCHREIBUNG"],
    ["Gewünschtes Ausstellungsdatum", "AUSSTELLUNGSDATUM"],
  ];
  const protectedLinesValid = protectedLines.every(([label, tokenLabel]) =>
    new RegExp(
      `^- ${label}: (?:\\[\\[LOCAL_${tokenLabel}_[a-f0-9]{8}\\]\\]|\\(leer\\))$`,
      "mu",
    ).test(transcript),
  );
  const grammaticalFormValid =
    /^## Grammatische Form \(von HR lokal bestätigt\)\n- (?:feminin \(Frau, sie\/ihr\)|maskulin \(Herr, er\/sein\)|unklar \(geschlechtsneutrale Formulierung oder HR-Platzhalter verwenden\))$/mu.test(
      transcript,
    );
  const localTokens = transcript.match(/\[\[LOCAL_[A-Z0-9_]+\]\]/gu) ?? [];
  const localTokenSyntaxValid = localTokens.every((token) =>
    /^\[\[LOCAL_(?:NACHNAME|VORNAME|GEBURTSDATUM|HEIMATORT|VORGESETZTE_PERSON|EINTRITTSDATUM|UEBERTRITTSDATUM|AUSTRITTSDATUM|DATUM_STELLENBESCHREIBUNG|DATUM_VORGESETZTE_PERSON|AUSSTELLUNGSDATUM|EMAIL|AHV|IBAN|TELEFON|DATUM)_[a-f0-9]{8}\]\]$/u.test(
      token,
    ),
  );
  if (!protectedLinesValid || !grammaticalFormValid || !localTokenSyntaxValid) {
    return jsonError("protection_required", 400, locale);
  }

  // Final tripwire only. The browser performs the field-level replacement and
  // lets HR inspect the exact outbound text before this route can be called.
  const forbiddenPatterns = [
    /%PDF-/u,
    /data:application\/pdf/iu,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
    /\b756[.\s-]?\d{4}[.\s-]?\d{4}[.\s-]?\d{2}\b/u,
    /\bCH\d{2}(?:[\s]?\d){17}\b/iu,
    /(?<!\d)(?:\+41|0041|0)(?:[\s./-]?\d){9}(?!\d)/u,
    /\b(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:19|20)\d{2}\b/u,
  ];
  if (forbiddenPatterns.some((pattern) => pattern.test(transcript))) {
    return jsonError("unsafe_payload", 400, locale);
  }

  const systemPrompt = buildSystemPrompt(type);
  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonError("missing_key", 500, locale);
  }

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
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Der folgende Zeugnisantrag wurde vor der Übermittlung im Browser pseudonymisiert. Erstelle daraus den Entwurf eines **${typeLabel}** gemäss deinen Anweisungen.

WICHTIG:
- Alle Platzhalter im Format [[LOCAL_...]] müssen in der Ausgabe exakt und unverändert erhalten bleiben.
- Ein [[LOCAL_...]]-Platzhalter steht für eine vorhandene Angabe, nicht für eine fehlende Angabe. Setze ihn an jeder im Zeugnis vorgesehenen Stelle ein, insbesondere Name, Personalien, Daten und Unterschriftenblock.
- Verwende für die vorgesetzte Person deren Platzhalter als Namen und die separat gelieferte Funktion als Funktionszeile.
- Versuche niemals, die Identität hinter einem Platzhalter zu erraten.
- Das Original-PDF und die Signatur wurden absichtlich nicht übermittelt. Nenne die nicht geprüfte Originalunterschrift als Prüfpunkt unter "Hinweise für HR".
- Nutze nur die unten übertragenen arbeitsbezogenen Angaben.

${transcript}`,
      },
    ],
  });

  const encoder = new TextEncoder();
  const responseBody = new ReadableStream<Uint8Array>({
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
          controller.enqueue(encoder.encode("\n\n[FEHLER: MODELL_ABLEHNUNG]"));
        } else if (final.stop_reason === "max_tokens") {
          controller.enqueue(encoder.encode("\n\n[WARNUNG: TOKEN_LIMIT]"));
        }
      } catch (err) {
        // Provider messages can contain request fragments, so log only a type.
        console.error("Generation failed", err instanceof Error ? err.name : "UnknownError");
        const marker =
          locale === "en"
            ? "[ERROR: GENERATION_FAILED]"
            : "[FEHLER: GENERIERUNG_FEHLGESCHLAGEN]";
        controller.enqueue(encoder.encode(`\n\n${marker}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(responseBody, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
