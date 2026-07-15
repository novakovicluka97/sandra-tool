import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
} from "pdf-lib";

export const PRIVACY_PROTOCOL = "local-acroform-v1" as const;

export type PrivacyErrorCode =
  | "invalid_pdf"
  | "scan_not_supported"
  | "unknown_form"
  | "file_too_large";

export class PrivacyProtectionError extends Error {
  constructor(public readonly code: PrivacyErrorCode) {
    super(code);
    this.name = "PrivacyProtectionError";
  }
}

export type ProtectedForm = {
  protocol: typeof PRIVACY_PROTOCOL;
  transcript: string;
  replacements: Record<string, string>;
  protectedValueCount: number;
  sourceFieldCount: number;
  suggestedGrammaticalForm: "feminine" | "masculine" | "";
};

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const EXPECTED_FIELD_COUNT = 149;
const EXPECTED_SCHEMA_SHA256 =
  "89f816b762edab2b68faa81884c6915bb5fca3ba95c78485b4a0175426927e40";

const PROTECTED_FIELDS: Record<string, string> = {
  Name: "NACHNAME",
  Vorname: "VORNAME",
  Geburtsdatum: "GEBURTSDATUM",
  Heimatort: "HEIMATORT",
  "Vorgesetzte*r": "VORGESETZTE_PERSON",
  Eintritt: "EINTRITTSDATUM",
  "Übertritt": "UEBERTRITTSDATUM",
  Austritt: "AUSTRITTSDATUM",
  "Stellenbeschreibung vom": "DATUM_STELLENBESCHREIBUNG",
  "Datum Vorgwesetzte": "DATUM_VORGESETZTE_PERSON",
  "Datum Zeugniswunsch": "AUSSTELLUNGSDATUM",
};

const ALLOWED_TEXT_FIELDS = [
  "Hauptaufgaben",
  "Spezialaufgaben",
  "Weiteres Allgemein",
  "Weiteres Erscheinung",
  "Weiteres Einstellung",
  "Weiteres Mental",
  "Weiteres Führungsrolle",
  "Bemerkungen",
  "Begründung",
] as const;

const SUPERVISORS: Record<string, { canonical: string; role: string }> = {
  es: { canonical: "Elias Schwarz", role: "Leiter Laborsupport" },
  "elias schwarz": { canonical: "Elias Schwarz", role: "Leiter Laborsupport" },
  "schwarz elias": { canonical: "Elias Schwarz", role: "Leiter Laborsupport" },
  "claudia müller": {
    canonical: "Claudia Müller",
    role: "Leiterin Customer Service",
  },
  "müller claudia": {
    canonical: "Claudia Müller",
    role: "Leiterin Customer Service",
  },
  "ralph friedlos": {
    canonical: "Ralph Friedlos",
    role: "Leiter Serviceabteilung",
  },
  "friedlos ralph": {
    canonical: "Ralph Friedlos",
    role: "Leiter Serviceabteilung",
  },
  "markus cueni": { canonical: "Markus Cueni", role: "CFO" },
  "cueni markus": { canonical: "Markus Cueni", role: "CFO" },
};

const DATE_FIELDS = new Set([
  "Geburtsdatum",
  "Eintritt",
  "Übertritt",
  "Austritt",
  "Stellenbeschreibung vom",
  "Datum Vorgwesetzte",
  "Datum Zeugniswunsch",
]);

const GERMAN_MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

type FieldData = {
  text: Map<string, string>;
  choices: Map<string, string>;
  checked: string[];
  names: Set<string>;
  schema: string;
};

function clean(value: string | undefined): string {
  return (value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .trim();
}

function randomHex(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceLiteral(
  text: string,
  value: string,
  token: string,
  caseSensitive = false,
): string {
  if (!value) return text;
  const escaped = escapeRegExp(value);
  const flags = caseSensitive ? "gu" : "giu";
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
    flags,
  );
  return text.replace(pattern, (_match, prefix: string) => `${prefix}${token}`);
}

function formatGermanDate(value: string): string {
  const match = value.match(
    /^(?:(\d{1,2})[./-](\d{1,2})[./-](\d{4})|(\d{4})-(\d{1,2})-(\d{1,2}))$/u,
  );
  if (!match) return value;
  const day = Number(match[1] ?? match[6]);
  const month = Number(match[2] ?? match[5]);
  const year = Number(match[3] ?? match[4]);
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12
  ) {
    return value;
  }
  return `${day}. ${GERMAN_MONTHS[month - 1]} ${year}`;
}

function suggestGrammaticalForm(jobTitle: string): "feminine" | "masculine" | "" {
  if (
    /\b(?:mitarbeiterin|sachbearbeiterin|technikerin|leiterin|assistentin|beraterin|spezialistin|fachfrau)\b/iu.test(
      jobTitle,
    )
  ) {
    return "feminine";
  }
  if (
    /\b(?:mitarbeiter|sachbearbeiter|techniker|leiter|assistent|berater|spezialist|fachmann)\b/iu.test(
      jobTitle,
    )
  ) {
    return "masculine";
  }
  return "";
}

function readFields(document: PDFDocument): FieldData {
  const text = new Map<string, string>();
  const choices = new Map<string, string>();
  const checked: string[] = [];
  const fields = document.getForm().getFields();
  const names = new Set(fields.map((field) => field.getName()));
  const schemaEntries: string[] = [];

  for (const field of fields) {
    const name = field.getName();
    if (field instanceof PDFTextField) {
      schemaEntries.push(`${name}:text`);
      text.set(name, clean(field.getText()));
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      schemaEntries.push(`${name}:${field instanceof PDFDropdown ? "dropdown" : "options"}`);
      choices.set(name, clean(field.getSelected().join(", ")));
    } else if (field instanceof PDFRadioGroup) {
      schemaEntries.push(`${name}:radio`);
      choices.set(name, clean(field.getSelected()));
    } else if (field instanceof PDFCheckBox && field.isChecked()) {
      schemaEntries.push(`${name}:checkbox`);
      checked.push(name);
    } else if (field instanceof PDFCheckBox) {
      schemaEntries.push(`${name}:checkbox`);
    } else if (field instanceof PDFSignature) {
      schemaEntries.push(`${name}:signature`);
      // Signatures are deliberately never read or transferred.
    } else {
      schemaEntries.push(`${name}:unknown`);
    }
  }

  return {
    text,
    choices,
    checked,
    names,
    schema: schemaEntries.sort().join("\n"),
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function emptyLabel(value: string): string {
  return value || "(leer)";
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

/**
 * Reads the known GRP_DK_1054 AcroForm entirely in the browser and returns a
 * pseudonymised text transcript. The original File and the replacement map
 * remain in browser memory and are never part of the network payload.
 */
export async function protectPdfLocally(file: File): Promise<ProtectedForm> {
  if (file.size > MAX_PDF_BYTES) {
    throw new PrivacyProtectionError("file_too_large");
  }

  let document: PDFDocument;
  try {
    document = await PDFDocument.load(await file.arrayBuffer(), {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch {
    throw new PrivacyProtectionError("invalid_pdf");
  }

  const data = readFields(document);
  if (data.names.size === 0) {
    throw new PrivacyProtectionError("scan_not_supported");
  }
  if (
    data.names.size !== EXPECTED_FIELD_COUNT ||
    (await sha256(data.schema)) !== EXPECTED_SCHEMA_SHA256
  ) {
    throw new PrivacyProtectionError("unknown_form");
  }

  const replacements = new Map<string, string>();
  const valueTokens = new Map<string, string>();
  const literalAliases: Array<{
    value: string;
    token: string;
    caseSensitive: boolean;
  }> = [];

  const registerAlias = (
    value: string,
    token: string,
    caseSensitive = false,
  ) => {
    if (!value) return;
    const normalized = value.trim().toLocaleLowerCase("de-CH");
    valueTokens.set(normalized, token);
    literalAliases.push({ value: value.trim(), token, caseSensitive });
  };

  const addReplacement = (
    value: string,
    label: string,
    restoredValue = value,
    reuseExisting = true,
  ): string => {
    const normalized = value.trim().toLocaleLowerCase("de-CH");
    const existing = reuseExisting ? valueTokens.get(normalized) : undefined;
    if (existing) return existing;
    const token = `[[LOCAL_${label}_${randomHex()}]]`;
    replacements.set(token, restoredValue);
    registerAlias(
      value,
      token,
      label === "VORGESETZTE_PERSON" && /^[A-Z]{1,3}$/u.test(value),
    );
    return token;
  };

  const protectedDisplay = new Map<string, string>();
  for (const [field, label] of Object.entries(PROTECTED_FIELDS)) {
    const value = clean(data.text.get(field));
    const supervisor =
      field === "Vorgesetzte*r"
        ? SUPERVISORS[value.toLocaleLowerCase("de-CH")]
        : undefined;
    const restoredValue = supervisor?.canonical ?? (DATE_FIELDS.has(field) ? formatGermanDate(value) : value);
    protectedDisplay.set(
      field,
      value ? addReplacement(value, label, restoredValue, false) : "(leer)",
    );
  }

  const supervisorRaw = clean(data.text.get("Vorgesetzte*r"));
  const supervisorToken = protectedDisplay.get("Vorgesetzte*r");
  const supervisorParts = supervisorRaw.split(/\s+/u).filter(Boolean);
  if (supervisorToken?.startsWith("[[LOCAL_") && supervisorParts.length >= 2) {
    registerAlias([...supervisorParts].reverse().join(" "), supervisorToken);
  }

  const directValues = literalAliases.sort((a, b) => b.value.length - a.value.length);

  const scrubPatterns = (input: string): string => {
    let output = clean(input);
    for (const { value, token, caseSensitive } of directValues) {
      output = replaceLiteral(output, value, token, caseSensitive);
    }

    const patternGroups: Array<{ label: string; pattern: RegExp }> = [
      {
        label: "EMAIL",
        pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
      },
      {
        label: "AHV",
        pattern: /\b756[.\s-]?\d{4}[.\s-]?\d{4}[.\s-]?\d{2}\b/gu,
      },
      {
        label: "IBAN",
        pattern: /\bCH\d{2}(?:[\s]?\d){17}\b/giu,
      },
      {
        label: "TELEFON",
        pattern: /(?<!\d)(?:\+41|0041|0)(?:[\s./-]?\d){9}(?!\d)/gu,
      },
      {
        label: "DATUM",
        pattern:
          /\b(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:19|20)\d{2}\b/gu,
      },
    ];

    for (const { label, pattern } of patternGroups) {
      output = output.replace(pattern, (match) => addReplacement(match, label));
    }
    return output;
  };

  const personLines = [
    ["Name", protectedDisplay.get("Name")],
    ["Vorname", protectedDisplay.get("Vorname")],
    ["Geburtsdatum", protectedDisplay.get("Geburtsdatum")],
    ["Heimatort / Kanton", protectedDisplay.get("Heimatort")],
    ["Funktion", scrubPatterns(data.text.get("Funktion") ?? "") || "(leer)"],
    ["Vorgesetzte*r", protectedDisplay.get("Vorgesetzte*r")],
    ["Eintritt", protectedDisplay.get("Eintritt")],
    ["Übertritt", protectedDisplay.get("Übertritt")],
    ["Austritt", protectedDisplay.get("Austritt")],
  ];

  const supervisor = SUPERVISORS[supervisorRaw.toLocaleLowerCase("de-CH")];
  if (supervisor) {
    personLines.push(["Funktion vorgesetzte Person", supervisor.role]);
  }

  const checkedSet = new Set(data.checked);
  const companionCheckbox: Partial<Record<(typeof ALLOWED_TEXT_FIELDS)[number], string>> = {
    "Weiteres Allgemein": "weiteres Allgemein",
    "Weiteres Erscheinung": "weiteres Erscheinung",
    "Weiteres Einstellung": "weiteres Einstellung",
    "Weiteres Mental": "weiteres Mental",
    "Weiteres Führungsrolle": "weiteres Führungsrolle",
  };
  const freeTextLines = ALLOWED_TEXT_FIELDS.filter((field) => {
    const companion = companionCheckbox[field];
    return !companion || checkedSet.has(companion);
  }).map(
    (field) =>
      [field, scrubPatterns(data.text.get(field) ?? "") || "(leer)"] as const,
  );

  const choiceLines = Array.from(data.choices.entries())
    .filter(
      ([field, value]) =>
        value &&
        value !== "Bitte auswählen" &&
        !/^(?:zwischenzeugnis Dropdown[123]|schlusszeugnis Dropdown)$/u.test(field),
    )
    .map(([field, value]) => [field, scrubPatterns(value)] as const);

  const closingLines: string[] = [];
  const choice = (field: string) => scrubPatterns(data.choices.get(field) ?? "");
  if (checkedSet.has("zwischenzeugnis Dank1")) {
    closingLines.push(
      `- Zwischenzeugnis: Dank für ${choice("zwischenzeugnis Dropdown1") || "[Adjektiv]"} Engagement`,
    );
  }
  if (checkedSet.has("zwischenzeugnis Dank2")) {
    closingLines.push(
      `- Zwischenzeugnis: Dank für ${choice("zwischenzeugnis Dropdown2") || "[Adjektiv]"} Zusammenarbeit`,
    );
  }
  if (checkedSet.has("zwischenzeugnis Dank3")) {
    closingLines.push("- Zwischenzeugnis: Dank für die wertvolle Mitarbeit");
  }
  if (checkedSet.has("zwischenzeugnis Dank4")) {
    closingLines.push(
      `- Zwischenzeugnis: Dank für die ${choice("zwischenzeugnis Dropdown3") || "[Adjektiv]"} bisherige Zusammenarbeit`,
    );
  }
  if (checkedSet.has("zwischenzeugnis Dank5")) {
    closingLines.push("- Zwischenzeugnis: Dank für den Einsatz");
  }
  if (checkedSet.has("zwischenzeugnis Dank6")) {
    closingLines.push("- Zwischenzeugnis: Gute Wünsche für die neue Aufgabe");
  }
  if (checkedSet.has("schlusszeugnis Dank1")) {
    closingLines.push(
      `- Arbeitszeugnis: Starkes Bedauern, Dank für die ${choice("schlusszeugnis Dropdown") || "[Adjektiv]"} Mitarbeit sowie gute Wünsche`,
    );
  }
  if (checkedSet.has("schlusszeugnis Dank3")) {
    closingLines.push("- Arbeitszeugnis: Bedauern, Dank und gute Wünsche");
  }
  if (checkedSet.has("schlusszeugnis Dank4")) {
    closingLines.push("- Arbeitszeugnis: Dank und gute Wünsche");
  }

  const selectedFields = data.checked
    .filter((field) => !/^(?:zwischenzeugnis|schlusszeugnis) Dank\d$/u.test(field))
    .map((field) =>
      field === "genügendKreativität" ? "genügend Kreativität" : field,
    );

  const transcript = [
    "# Zeugnisantrag (Formular GRP_DK_1054 v1.1), lokal pseudonymisiertes Transkript",
    "",
    "## Angaben zur Person",
    ...personLines.map(([field, value]) => `- ${field}: ${emptyLabel(value ?? "")}`),
    `- Stellenbeschreibung vom: ${protectedDisplay.get("Stellenbeschreibung vom")}`,
    `- Gewünschtes Ausstellungsdatum: ${protectedDisplay.get("Datum Zeugniswunsch")}`,
    "",
    "## Arbeitsbezogene Freitextfelder",
    ...freeTextLines.flatMap(([field, value]) => [
      `### ${field}`,
      indent(emptyLabel(value)),
      "",
    ]),
    "## Ausgewählte Dropdown-Felder",
    ...(choiceLines.length
      ? choiceLines.map(([field, value]) => `- ${field}: ${value}`)
      : ["- (keine)"]),
    "",
    "## Ausgewählte Schlussformeln",
    ...(closingLines.length ? closingLines : ["- (keine)"]),
    "",
    "## Angekreuzte Felder",
    ...(selectedFields.length
      ? selectedFields
          .sort((a, b) => a.localeCompare(b, "de-CH"))
          .map((field) => `- ${field}`)
      : ["- (keine)"]),
    "",
    "## Nicht übertragene Angaben",
    "- Original-PDF, Dateiname, PDF-Metadaten und Signatur",
    "- Zuordnungsschlüssel der lokalen Platzhalter",
    "- Datum der vorgesetzten Person",
  ].join("\n");

  replacements.set("[[LOCAL_HR_SIGNATORY]]", "Sandra Zanfirovic");

  return {
    protocol: PRIVACY_PROTOCOL,
    transcript,
    replacements: Object.fromEntries(replacements),
    protectedValueCount: replacements.size - 1,
    sourceFieldCount: data.names.size,
    suggestedGrammaticalForm: suggestGrammaticalForm(data.text.get("Funktion") ?? ""),
  };
}

export function restoreProtectedValues(
  text: string,
  replacements: Record<string, string>,
): string {
  return Object.entries(replacements).reduce(
    (result, [token, value]) => result.split(token).join(value),
    text,
  );
}
