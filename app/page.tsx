"use client";

import Script from "next/script";
import {
  type ChangeEvent,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { LetterheadImage, LetterheadSettings } from "@/lib/docx";
import type {
  PrivacyErrorCode,
  ProtectedForm,
} from "@/lib/privacy";

type Locale = "de" | "en";
type LetterType = "zwischenzeugnis" | "arbeitszeugnis";
type GrammaticalForm = "feminine" | "masculine" | "unknown" | "";
type FilePhase = "checking" | "ready" | "blocked";
type JobPhase = "queued" | "sending" | "streaming" | "done" | "error";

type UploadItem = {
  id: string;
  file: File;
  phase: FilePhase;
  protected?: ProtectedForm;
  error?: PrivacyErrorCode;
  grammaticalForm: GrammaticalForm;
};

type Job = {
  id: string;
  fileName: string;
  type: LetterType;
  phase: JobPhase;
  output: string;
  error: string;
};

type StoredLetterheadImage = LetterheadImage & {
  isDefault: boolean;
};

type DocumentSettings = Omit<LetterheadSettings, "header" | "footer"> & {
  header: StoredLetterheadImage;
  footer: StoredLetterheadImage;
};

const DOCUMENT_SETTINGS_KEY = "sandra-document-settings-v1";
const MAX_LETTERHEAD_IMAGE_BYTES = 1_500_000;

const DEFAULT_HEADER: StoredLetterheadImage = {
  source: "/header-image.png",
  name: "Polymed Briefkopf",
  type: "png",
  width: 2193,
  height: 395,
  isDefault: true,
};

const DEFAULT_FOOTER: StoredLetterheadImage = {
  source: "/footer-image.jpg",
  name: "Polymed Fusszeile",
  type: "jpg",
  width: 1994,
  height: 35,
  isDefault: true,
};

function defaultDocumentSettings(): DocumentSettings {
  return {
    enabled: true,
    header: { ...DEFAULT_HEADER },
    footer: { ...DEFAULT_FOOTER },
    headerFromTopInches: 0.22,
    footerFromBottomInches: 0.18,
  };
}

function readImageFile(file: File): Promise<{
  source: string;
  width: number;
  height: number;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read_failed"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("read_failed"));
        return;
      }
      const source = reader.result;
      const image = new Image();
      image.onerror = () => reject(new Error("invalid_image"));
      image.onload = () =>
        resolve({ source, width: image.naturalWidth, height: image.naturalHeight });
      image.src = source;
    };
    reader.readAsDataURL(file);
  });
}

const COPY = {
  de: {
    titleLead: "Zeugnis-",
    titleAccent: "Generator",
    language: "Sprache",
    how: "So funktioniert es",
    trustTitle: "Identität bleibt lokal",
    trustBody:
      "Original-PDF, Namen, aufgeführte Identitätsfelder und Zuordnungsschlüssel werden nicht an Anthropic übermittelt.",
    uploadTitle: "Zeugnisanträge auswählen",
    dropMain: "PDFs hierher ziehen oder auswählen",
    dropHint: "Originalformular GRP_DK_1054 · mehrere Dateien · max. 10 MB",
    onlyPdfs: "Nur PDF-Dateien werden übernommen.",
    checking: "Wird lokal geprüft …",
    ready: (count: number) =>
      `${count} ${count === 1 ? "Angabe" : "Angaben"} lokal geschützt`,
    staysLocal: "PDF bleibt lokal",
    payloadPreview: "Übertragungsvorschau",
    addressLabel: "Anrede im Zeugnis",
    addressChoose: "Bitte wählen",
    addressFeminine: "Frau · sie / ihr",
    addressMasculine: "Herr · er / sein",
    addressUnknown: "Unklar · HR-Platzhalter",
    remove: (name: string) => `${name} entfernen`,
    privacyErrors: {
      invalid_pdf: "Diese Datei ist kein lesbares PDF.",
      scan_not_supported:
        "Scan gestoppt: Ohne auslesbare Formularfelder kann die App den Datenschutz nicht garantieren. Bitte das originale ausfüllbare PDF verwenden.",
      unknown_form:
        "Unbekannte Formularversion gestoppt. Bitte das originale Formular GRP_DK_1054 v1.1 verwenden.",
      file_too_large: "Das PDF ist grösser als 10 MB.",
    },
    typeTitle: "Zeugnisart wählen",
    typeGroup: "Zeugnisart",
    interim: "Zwischenzeugnis",
    final: "Arbeitszeugnis",
    interimDesc:
      "Während des laufenden Arbeitsverhältnisses, durchgehend im Präsens.",
    finalDesc:
      "Schlusszeugnis beim Austritt, im Präteritum mit Austrittsabsatz.",
    createTitle: "Entwürfe erstellen",
    confirmation:
      "Ich habe die Übertragungsvorschau geprüft. Das Formular enthält keine Patienten- oder Gesundheitsdaten.",
    confirmHint:
      "Arbeitsbezogene Angaben und Bewertungen werden pseudonymisiert verarbeitet.",
    cancel: "Abbrechen",
    createOne: "Entwurf erstellen",
    createMany: (count: number) => `${count} Entwürfe erstellen`,
    cancelled: "Abgebrochen.",
    unknownError: "Unbekannter Fehler",
    noResponse: "Keine Antwort vom Server.",
    generationFailed: "Der Entwurf konnte nicht vollständig erstellt werden.",
    placeholderFailed:
      "Sicherheitsstopp: Der Entwurf hat einen lokalen Platzhalter verändert oder ausgelassen. Es wurden keine unvollständigen Personalien freigegeben.",
    fileProgress: (current: number, total: number) =>
      `Datei ${current} von ${total} wird verarbeitet …`,
    sending: "Geschützte Angaben werden übermittelt …",
    writing: "Entwurf wird geschrieben …",
    draftsReady: "Entwürfe fertig. Bitte durch HR prüfen.",
    partialReady: (done: number, total: number) =>
      `${done} von ${total} Entwürfen fertig.`,
    docLoadingTitle: "Dokument wird erstellt",
    docLoadingBody:
      "Voraussichtliche Dauer pro Dokument: unter 50 Sekunden.",
    docReadyTitle: "Dokument bereit",
    docReadyBody:
      "Der Entwurf steht als Word-Datei bereit. Bitte herunterladen und durch HR prüfen lassen.",
    localCheck: "Lokale Datenschutzprüfung läuft …",
    removeBlocked: "Blockierte Dateien entfernen, um fortzufahren.",
    drafts: "Entwürfe",
    downloadAll: (count: number) => `Alle herunterladen (${count})`,
    downloadWord: "Word herunterladen (.docx)",
    settings: "Word-Einstellungen",
    settingsEyebrow: "Dokumentausgabe",
    settingsTitle: "Briefkopf und Fusszeile",
    settingsIntro:
      "Diese Einstellungen gelten nur für lokal erstellte Word-Dateien. Bilder und Einstellungen werden nicht an Anthropic übermittelt.",
    letterheadToggle: "Briefkopf und Fusszeile einfügen",
    letterheadOn: "Standardmässig aktiviert",
    headerLabel: "Briefkopf",
    footerLabel: "Fusszeile",
    defaultArtwork: "Polymed Standard",
    customArtwork: "Eigenes Bild",
    replaceImage: "Bild ersetzen",
    restoreDefault: "Standard wiederherstellen",
    headerDistance: "Abstand von oben",
    footerDistance: "Abstand von unten",
    inches: "Zoll",
    distanceHint: "Entspricht den Einstellungen der Word-Vorlage.",
    headerImageHint: "PNG oder JPG, empfohlenes Format ca. 5.5:1",
    footerImageHint: "PNG oder JPG, empfohlenes sehr breites Format",
    resetSettings: "Alles zurücksetzen",
    doneSettings: "Fertig",
    imageTooLarge: "Das Bild darf höchstens 1.5 MB gross sein.",
    imageTypeError: "Bitte eine PNG- oder JPG-Datei auswählen.",
    imageReadError: "Das Bild konnte nicht gelesen werden.",
    settingsStorageError:
      "Die Auswahl funktioniert für diese Sitzung, konnte aber nicht dauerhaft gespeichert werden.",
    phase: {
      queued: "wartet",
      sending: "wird gesendet",
      streaming: "wird erstellt",
      done: "fertig",
      error: "Fehler",
    },
    modalEyebrow: "Datenschutz durch Technikgestaltung",
    modalTitle: "Identitätsdaten bleiben auf diesem Gerät.",
    modalIntro:
      "Ihr Browser schützt die Personendaten vor der Übermittlung und setzt sie erst nach dem Entwurf wieder ein.",
    close: "Schliessen",
    diagram: [
      {
        step: "01",
        title: "Lokal geschützt",
        body: "Das PDF wird im Browser gelesen. Namen und aufgeführte Identitätsfelder werden durch zufällige Platzhalter ersetzt.",
        tag: "Ihr Gerät",
      },
      {
        step: "02",
        title: "Sicher entworfen",
        body: "Anthropic erhält nur das von HR geprüfte Arbeitstranskript mit neutralen Platzhaltern.",
        tag: "Pseudonymisiert",
      },
      {
        step: "03",
        title: "Lokal fertiggestellt",
        body: "Der Browser setzt die Identitätsdaten wieder ein und erstellt die Word-Datei.",
        tag: "Ihr Gerät",
      },
    ],
    staysTitle: "Nie übermittelt",
    staysItems: "Original-PDF · Name · Identitätsfelder · Zuordnungsschlüssel · Signatur",
    sentTitle: "Für den Entwurf",
    sentItems: "Von HR geprüftes Arbeitstranskript · neutrale Platzhalter",
    legalDetails: "Details zu Recht und Technik",
    legalBody:
      "Die App setzt Datenschutz durch Technikgestaltung und Datenminimierung um. Anthropic verarbeitet ausschliesslich das freigegebene pseudonymisierte Transkript. Für den Produktivbetrieb bleiben Anbietervereinbarung, Zugriffe, Aufbewahrung und Auslandsbearbeitung durch Polymed zu genehmigen.",
    fdpicSource: "EDÖB: Cloud-Computing",
    anthropicSource: "Anthropic: API-Aufbewahrung",
    understood: "Verstanden",
  },
  en: {
    titleLead: "Reference ",
    titleAccent: "Generator",
    language: "Language",
    how: "How it works",
    trustTitle: "Identity stays local",
    trustBody:
      "The original PDF, names, listed identity fields, and replacement key are not sent to Anthropic.",
    uploadTitle: "Select reference request forms",
    dropMain: "Drop PDFs here or select files",
    dropHint: "Original GRP_DK_1054 form · multiple files · max. 10 MB",
    onlyPdfs: "Only PDF files are accepted.",
    checking: "Checking locally …",
    ready: (count: number) =>
      `${count} ${count === 1 ? "value" : "values"} protected locally`,
    staysLocal: "PDF stays local",
    payloadPreview: "Transmission preview",
    addressLabel: "Form of address in the letter",
    addressChoose: "Please select",
    addressFeminine: "Ms · she / her",
    addressMasculine: "Mr · he / his",
    addressUnknown: "Unclear · HR placeholder",
    remove: (name: string) => `Remove ${name}`,
    privacyErrors: {
      invalid_pdf: "This file is not a readable PDF.",
      scan_not_supported:
        "Scan blocked: without readable form fields, the app cannot verify privacy protection. Please use the original fillable PDF.",
      unknown_form:
        "Unknown form version blocked. Please use the original GRP_DK_1054 v1.1 form.",
      file_too_large: "The PDF is larger than 10 MB.",
    },
    typeTitle: "Choose reference type",
    typeGroup: "Reference type",
    interim: "Interim reference",
    final: "Final reference",
    interimDesc:
      "For an ongoing employment relationship, written consistently in the present tense.",
    finalDesc:
      "For an employee leaving the company, written in the past tense with a departure paragraph.",
    createTitle: "Create drafts",
    confirmation:
      "I reviewed the transmission preview. The form contains no patient or health information.",
    confirmHint:
      "Work-related details and ratings are processed in pseudonymized form.",
    cancel: "Cancel",
    createOne: "Create draft",
    createMany: (count: number) => `Create ${count} drafts`,
    cancelled: "Cancelled.",
    unknownError: "Unknown error",
    noResponse: "No response from the server.",
    generationFailed: "The draft could not be completed.",
    placeholderFailed:
      "Safety stop: the draft changed or omitted a local placeholder. Incomplete personal details were not released.",
    fileProgress: (current: number, total: number) =>
      `Processing file ${current} of ${total} …`,
    sending: "Sending protected details …",
    writing: "Writing the draft …",
    draftsReady: "Drafts ready. HR review is required.",
    partialReady: (done: number, total: number) =>
      `${done} of ${total} drafts ready.`,
    docLoadingTitle: "Creating document",
    docLoadingBody:
      "Expected time per document: under 50 seconds.",
    docReadyTitle: "Document ready",
    docReadyBody:
      "The draft is available as a Word file. Please download it and have HR review it.",
    localCheck: "Running local privacy check …",
    removeBlocked: "Remove blocked files to continue.",
    drafts: "Drafts",
    downloadAll: (count: number) => `Download all (${count})`,
    downloadWord: "Download Word (.docx)",
    settings: "Word settings",
    settingsEyebrow: "Document output",
    settingsTitle: "Header and footer",
    settingsIntro:
      "These settings apply only to Word files created locally. Images and settings are never sent to Anthropic.",
    letterheadToggle: "Include header and footer",
    letterheadOn: "Enabled by default",
    headerLabel: "Header",
    footerLabel: "Footer",
    defaultArtwork: "Polymed default",
    customArtwork: "Custom image",
    replaceImage: "Replace image",
    restoreDefault: "Restore default",
    headerDistance: "Distance from top",
    footerDistance: "Distance from bottom",
    inches: "inches",
    distanceHint: "Matches the original Word template settings.",
    headerImageHint: "PNG or JPG, recommended ratio approx. 5.5:1",
    footerImageHint: "PNG or JPG, a very wide image works best",
    resetSettings: "Reset all",
    doneSettings: "Done",
    imageTooLarge: "The image must be 1.5 MB or smaller.",
    imageTypeError: "Please choose a PNG or JPG file.",
    imageReadError: "The image could not be read.",
    settingsStorageError:
      "The selection works for this session but could not be saved permanently.",
    phase: {
      queued: "waiting",
      sending: "sending",
      streaming: "creating",
      done: "ready",
      error: "error",
    },
    modalEyebrow: "Privacy by design",
    modalTitle: "Employee identity stays on this device.",
    modalIntro:
      "Your browser protects personal details before transmission and restores them only after the draft returns.",
    close: "Close",
    diagram: [
      {
        step: "01",
        title: "Protected locally",
        body: "The PDF is read in the browser. Names and listed identity fields are replaced with random placeholders.",
        tag: "Your device",
      },
      {
        step: "02",
        title: "Drafted securely",
        body: "Anthropic receives only the HR-reviewed work transcript with neutral placeholders.",
        tag: "Pseudonymized",
      },
      {
        step: "03",
        title: "Finished locally",
        body: "The browser restores the identity details and creates the Word file.",
        tag: "Your device",
      },
    ],
    staysTitle: "Never transmitted",
    staysItems: "Original PDF · name · identity fields · replacement key · signature",
    sentTitle: "For drafting",
    sentItems: "HR-reviewed work transcript · neutral placeholders",
    legalDetails: "Legal and technical details",
    legalBody:
      "The app implements privacy by design and data minimization. Anthropic processes only the approved pseudonymized transcript. For production, Polymed must still approve the provider agreement, access controls, retention, and foreign-country processing.",
    fdpicSource: "FDPIC: Cloud processing",
    anthropicSource: "Anthropic: API retention",
    understood: "Got it",
  },
} as const;

function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
}

function renderLetter(md: string): ReactNode[] {
  const lines = md.split("\n");
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flush = (key: string) => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={key}>
        {bullets.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((line, i) => {
    const text = line.trim();
    if (text.startsWith("- ")) {
      bullets.push(text.slice(2));
      return;
    }
    flush(`ul-${i}`);
    if (!text) return;
    if (text === "---") blocks.push(<hr key={i} />);
    else if (text.startsWith("## ")) blocks.push(<h2 key={i}>{text.slice(3)}</h2>);
    else if (text.startsWith("# ")) blocks.push(<h1 key={i}>{text.slice(2)}</h1>);
    else blocks.push(<p key={i}>{inline(text)}</p>);
  });
  flush("ul-end");
  return blocks;
}

function shortName(name: string): string {
  const base = name.replace(/\.pdf$/i, "");
  return base.length > 22 ? `${base.slice(0, 20)}…` : base;
}

function restoreLocally(text: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (result, [token, value]) => result.split(token).join(value),
    text,
  );
}

function outboundTranscript(item: UploadItem): string {
  if (!item.protected) return "";
  const grammatical =
    item.grammaticalForm === "feminine"
      ? "feminin (Frau, sie/ihr)"
      : item.grammaticalForm === "masculine"
        ? "maskulin (Herr, er/sein)"
        : "unklar (geschlechtsneutrale Formulierung oder HR-Platzhalter verwenden)";
  return `${item.protected.transcript}\n\n## Grammatische Form (von HR lokal bestätigt)\n- ${grammatical}`;
}

function modelTokensAreValid(
  rawText: string,
  replacements: Record<string, string>,
  type: LetterType,
): boolean {
  if (rawText.includes("[[BEISPIEL_")) return false;
  const knownTokens = new Set(Object.keys(replacements));
  const returnedTokens = rawText.match(/\[\[LOCAL_[A-Z0-9_]+\]\]/gu) ?? [];
  if (returnedTokens.some((token) => !knownTokens.has(token))) return false;

  const requiredLabels = [
    "VORNAME",
    "NACHNAME",
    "GEBURTSDATUM",
    "HEIMATORT",
    "VORGESETZTE_PERSON",
    "EINTRITTSDATUM",
    "UEBERTRITTSDATUM",
    "AUSSTELLUNGSDATUM",
    "HR_SIGNATORY",
  ];
  if (type === "arbeitszeugnis") requiredLabels.push("AUSTRITTSDATUM");

  for (const label of requiredLabels) {
    const token = Array.from(knownTokens).find((candidate) =>
      candidate.includes(`_${label}`),
    );
    if (token && !rawText.includes(token)) return false;
  }

  const restored = restoreLocally(rawText, replacements);
  return !/\[\[?\s*LOCAL_|LOCAL_[A-Z0-9_]+/iu.test(restored);
}

function PrivacyFlowIcon({ step }: { step: number }) {
  if (step === 0) {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <rect x="5" y="8" width="38" height="27" rx="2" />
        <path d="M5 15h38M17 41h14M24 35v6" />
        <path className="accent" d="m19 24 4 4 8-9" />
      </svg>
    );
  }
  if (step === 1) {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M12 7h18l7 7v27H12zM30 7v8h7" />
        <path d="M18 24h13M18 30h13M18 36h8" />
        <path className="accent" d="m39 19 1.4 3.6L44 24l-3.6 1.4L39 29l-1.4-3.6L34 24l3.6-1.4z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M10 7h19l8 8v26H10zM29 7v9h8" />
      <path d="M17 25h13M17 31h9" />
      <path className="accent" d="m28 35 4 4 9-11" />
    </svg>
  );
}

export default function Home() {
  const [locale, setLocale] = useState<Locale>("de");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [type, setType] = useState<LetterType>("zwischenzeugnis");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeId, setActiveId] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [documentSettings, setDocumentSettings] = useState<DocumentSettings>(
    defaultDocumentSettings,
  );
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const privacyDialogRef = useRef<HTMLDialogElement | null>(null);
  const settingsDialogRef = useRef<HTMLDialogElement | null>(null);

  const c = COPY[locale];
  const activeJob = jobs.find((job) => job.id === activeId) ?? jobs[0] ?? null;

  useEffect(() => {
    const saved = window.localStorage.getItem("sandra-ui-locale");
    if (saved === "de" || saved === "en") setLocale(saved);

    const savedDocumentSettings = window.localStorage.getItem(DOCUMENT_SETTINGS_KEY);
    if (savedDocumentSettings) {
      try {
        const parsed = JSON.parse(savedDocumentSettings) as Partial<DocumentSettings>;
        const defaults = defaultDocumentSettings();
        setDocumentSettings({
          enabled:
            typeof parsed.enabled === "boolean" ? parsed.enabled : defaults.enabled,
          header: { ...defaults.header, ...(parsed.header ?? {}) },
          footer: { ...defaults.footer, ...(parsed.footer ?? {}) },
          headerFromTopInches:
            typeof parsed.headerFromTopInches === "number"
              ? parsed.headerFromTopInches
              : defaults.headerFromTopInches,
          footerFromBottomInches:
            typeof parsed.footerFromBottomInches === "number"
              ? parsed.footerFromBottomInches
              : defaults.footerFromBottomInches,
        });
      } catch {
        window.localStorage.removeItem(DOCUMENT_SETTINGS_KEY);
      }
    }
    setSettingsHydrated(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "de" ? "de-CH" : "en";
    document.title =
      locale === "de"
        ? "Zeugnis-Generator · Polymed"
        : "Reference Generator · Polymed";
    window.localStorage.setItem("sandra-ui-locale", locale);
  }, [locale]);

  useEffect(() => {
    if (!settingsHydrated) return;
    try {
      window.localStorage.setItem(
        DOCUMENT_SETTINGS_KEY,
        JSON.stringify(documentSettings),
      );
      setSettingsError((current) =>
        current === COPY.de.settingsStorageError ||
        current === COPY.en.settingsStorageError
          ? ""
          : current,
      );
    } catch {
      setSettingsError(COPY[locale].settingsStorageError);
    }
  }, [documentSettings, locale, settingsHydrated]);

  async function replaceLetterheadImage(
    slot: "header" | "footer",
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setSettingsError(c.imageTypeError);
      return;
    }
    if (file.size > MAX_LETTERHEAD_IMAGE_BYTES) {
      setSettingsError(c.imageTooLarge);
      return;
    }

    try {
      const image = await readImageFile(file);
      setDocumentSettings((current) => ({
        ...current,
        [slot]: {
          ...image,
          name: file.name,
          type: file.type === "image/png" ? "png" : "jpg",
          isDefault: false,
        },
      }));
      setSettingsError("");
    } catch {
      setSettingsError(c.imageReadError);
    }
  }

  function restoreLetterheadImage(slot: "header" | "footer") {
    setDocumentSettings((current) => ({
      ...current,
      [slot]: { ...(slot === "header" ? DEFAULT_HEADER : DEFAULT_FOOTER) },
    }));
    setSettingsError("");
  }

  function setLetterheadDistance(
    field: "headerFromTopInches" | "footerFromBottomInches",
    value: number,
  ) {
    if (!Number.isFinite(value)) return;
    setDocumentSettings((current) => ({
      ...current,
      [field]: Math.min(2, Math.max(0, value)),
    }));
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
      return `${new Intl.NumberFormat(locale === "de" ? "de-CH" : "en", {
        maximumFractionDigits: 0,
      }).format(bytes / 1024)} KB`;
    }
    return `${new Intl.NumberFormat(locale === "de" ? "de-CH" : "en", {
      maximumFractionDigits: 1,
    }).format(bytes / (1024 * 1024))} MB`;
  }

  async function inspectItem(item: UploadItem) {
    try {
      const { protectPdfLocally } = await import("@/lib/privacy");
      const protectedForm = await protectPdfLocally(item.file);
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                phase: "ready",
                protected: protectedForm,
                grammaticalForm: protectedForm.suggestedGrammaticalForm,
                error: undefined,
              }
            : candidate,
        ),
      );
    } catch (error) {
      const code: PrivacyErrorCode =
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
          ? (error.code as PrivacyErrorCode)
          : "invalid_pdf";
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, phase: "blocked", error: code, protected: undefined }
            : candidate,
        ),
      );
    }
  }

  function acceptFiles(list: FileList | File[] | null | undefined) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    const pdfs = incoming.filter(
      (file) =>
        file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf",
    );
    setPickError(pdfs.length < incoming.length ? c.onlyPdfs : "");
    if (pdfs.length === 0) return;

    const known = new Set(items.map((item) => `${item.file.name}|${item.file.size}`));
    const nextItems = pdfs
      .filter((file) => !known.has(`${file.name}|${file.size}`))
      .map<UploadItem>((file) => ({
        id: crypto.randomUUID(),
        file,
        phase: "checking",
        grammaticalForm: "",
      }));
    if (nextItems.length === 0) return;
    setConfirmed(false);
    setItems((current) => [...current, ...nextItems]);
    nextItems.forEach((item) => void inspectItem(item));
  }

  function removeItem(id: string) {
    setConfirmed(false);
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function patchJob(id: string, patch: Partial<Job>) {
    setJobs((current) =>
      current.map((job) => (job.id === id ? { ...job, ...patch } : job)),
    );
  }

  async function runJob(
    job: Job,
    item: UploadItem & { protected: ProtectedForm },
    controller: AbortController,
  ) {
    const protectedForm = item.protected;
    patchJob(job.id, { phase: "sending" });
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: job.type,
        locale,
        protocol: protectedForm.protocol,
        transcript: outboundTranscript(item),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let message = `${locale === "de" ? "Fehler" : "Error"} ${response.status}`;
      try {
        const data = await response.json();
        if (data?.error) message = data.error;
      } catch {}
      throw new Error(message);
    }
    if (!response.body) throw new Error(c.noResponse);

    patchJob(job.id, { phase: "streaming" });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let rawText = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      rawText += decoder.decode(value, { stream: true });
      patchJob(job.id, {
        output: restoreLocally(rawText, protectedForm.replacements),
      });
    }
    rawText += decoder.decode();

    const failed = /\[(?:FEHLER|ERROR):[^\]]+\]/u.test(rawText);
    const cleanText = rawText.replace(
      /\n*\[(?:FEHLER|ERROR):[^\]]+\]\s*$/u,
      "",
    );
    const tokensValid = modelTokensAreValid(
      cleanText,
      protectedForm.replacements,
      job.type,
    );
    patchJob(job.id, {
      output: restoreLocally(cleanText, protectedForm.replacements),
      phase: failed || !tokensValid ? "error" : "done",
      error: failed ? c.generationFailed : !tokensValid ? c.placeholderFailed : "",
    });
  }

  async function generate() {
    const readyItems = items.filter(
      (item): item is UploadItem & { protected: ProtectedForm } =>
        item.phase === "ready" && Boolean(item.protected) && item.grammaticalForm !== "",
    );
    if (
      readyItems.length === 0 ||
      readyItems.length !== items.length ||
      !confirmed ||
      busy
    ) {
      return;
    }

    setBusy(true);
    cancelledRef.current = false;
    const newJobs: Job[] = readyItems.map((item) => ({
      id: item.id,
      fileName: item.file.name,
      type,
      phase: "queued",
      output: "",
      error: "",
    }));
    setJobs(newJobs);
    setActiveId(newJobs[0].id);

    for (let index = 0; index < newJobs.length; index += 1) {
      if (cancelledRef.current) {
        patchJob(newJobs[index].id, { phase: "error", error: c.cancelled });
        continue;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setActiveId(newJobs[index].id);
      try {
        await runJob(newJobs[index], readyItems[index], controller);
      } catch (error) {
        patchJob(newJobs[index].id, {
          phase: "error",
          error: controller.signal.aborted
            ? c.cancelled
            : error instanceof Error
              ? error.message
              : c.unknownError,
        });
      }
    }
    abortRef.current = null;
    setBusy(false);
  }

  function cancel() {
    cancelledRef.current = true;
    abortRef.current?.abort();
  }

  async function downloadJob(job: Job) {
    if (!job.output) return;
    const { letterToDocxBlob, letterFilename } = await import("@/lib/docx");
    const blob = await letterToDocxBlob(job.output, documentSettings);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = letterFilename(job.output, job.type, job.fileName);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadAll() {
    for (const job of jobs) {
      if (job.phase === "done" && job.output) {
        await downloadJob(job);
        await new Promise((resolve) => window.setTimeout(resolve, 400));
      }
    }
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = (index + direction + jobs.length) % jobs.length;
    setActiveId(jobs[next].id);
    document.getElementById(`job-tab-${jobs[next].id}`)?.focus();
  }

  const doneCount = jobs.filter((job) => job.phase === "done").length;
  const runningIndex = jobs.findIndex(
    (job) => job.phase === "sending" || job.phase === "streaming",
  );
  const hasChecking = items.some((item) => item.phase === "checking");
  const hasBlocked = items.some((item) => item.phase === "blocked");
  const allReady =
    items.length > 0 &&
    items.every((item) => item.phase === "ready" && item.grammaticalForm !== "");

  const statusText = busy
    ? jobs.length > 1
      ? c.fileProgress(runningIndex + 1, jobs.length)
      : runningIndex >= 0 && jobs[runningIndex].phase === "sending"
        ? c.sending
        : c.writing
    : hasChecking
      ? c.localCheck
      : hasBlocked
        ? c.removeBlocked
        : jobs.length > 0
          ? doneCount === jobs.length
            ? c.draftsReady
            : doneCount > 0
              ? c.partialReady(doneCount, jobs.length)
              : jobs.find((job) => job.phase === "error")?.error ?? ""
          : pickError;

  const statusIsError =
    !busy &&
    (Boolean(pickError) ||
      hasBlocked ||
      (jobs.length > 0 && jobs.some((job) => job.phase === "error")));

  return (
    <div className="frame">
      <header className="masthead">
        <div className="masthead-left">
          <div className="mark" aria-hidden="true">Z</div>
          <h1>
            {c.titleLead}<em>{c.titleAccent}</em>
          </h1>
        </div>
        <div className="masthead-actions">
          <button
            type="button"
            className="settings-button"
            aria-label={c.settings}
            title={c.settings}
            onClick={() => settingsDialogRef.current?.showModal()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9.8 2h4.4l.6 2.4a8 8 0 0 1 1.4.8l2.4-.7 2.2 3.8-1.8 1.7a8 8 0 0 1 0 1.8l1.8 1.7-2.2 3.8-2.4-.7a8 8 0 0 1-1.4.8l-.6 2.4H9.8l-.6-2.4a8 8 0 0 1-1.4-.8l-2.4.7-2.2-3.8L5 11.8a8 8 0 0 1 0-1.8L3.2 8.3l2.2-3.8 2.4.7a8 8 0 0 1 1.4-.8L9.8 2Z" />
              <circle cx="12" cy="11" r="3" />
            </svg>
          </button>
          <button
            type="button"
            className="how-button"
            onClick={() => privacyDialogRef.current?.showModal()}
          >
            <span className="shield-mini" aria-hidden="true">◆</span>
            {c.how}
          </button>
          <div className="language-toggle" role="group" aria-label={c.language}>
            <button
              type="button"
              className={locale === "de" ? "active" : ""}
              aria-pressed={locale === "de"}
              onClick={() => setLocale("de")}
              disabled={busy}
            >
              DE
            </button>
            <button
              type="button"
              className={locale === "en" ? "active" : ""}
              aria-pressed={locale === "en"}
              onClick={() => setLocale("en")}
              disabled={busy}
            >
              EN
            </button>
          </div>
        </div>
      </header>

      <section className="trustbar" aria-label={c.trustTitle}>
        <div className="trust-icon" aria-hidden="true">
          <span>✓</span>
        </div>
        <div>
          <strong>{c.trustTitle}</strong>
          <p>{c.trustBody}</p>
        </div>
        <button
          type="button"
          className="trust-link"
          onClick={() => privacyDialogRef.current?.showModal()}
        >
          {c.how} <span aria-hidden="true">→</span>
        </button>
      </section>

      <main
        className={`workbench${jobs.length === 0 ? " no-draft" : ""}`}
        aria-busy={busy || hasChecking}
      >
        <section className="controls" aria-label={c.createTitle}>
          <div className="step">
            <div className="step-label">
              <span className="step-num">01</span>
              <h2 className="step-title">{c.uploadTitle}</h2>
            </div>
            <label
              className={`dropzone${dragging ? " dragging" : ""}${busy ? " disabled" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                acceptFiles(event.dataTransfer.files);
              }}
            >
              <input
                type="file"
                accept=".pdf,application/pdf"
                multiple
                onChange={(event) => {
                  acceptFiles(event.target.files);
                  event.target.value = "";
                }}
                disabled={busy}
              />
              <div className="dropzone-icon" aria-hidden="true">⇪</div>
              <div className="dropzone-main">{c.dropMain}</div>
              <div className="dropzone-hint">{c.dropHint}</div>
            </label>

            <div className="file-list">
              {items.map((item) => (
                <div className={`file-card ${item.phase}`} key={item.id}>
                  <div className="file-chip">
                    <div className="file-copy">
                      <span className="name">{item.file.name}</span>
                      <span className="size">{formatSize(item.file.size)}</span>
                    </div>
                    <button
                      type="button"
                      className="chip-remove"
                      onClick={() => removeItem(item.id)}
                      disabled={busy}
                      aria-label={c.remove(item.file.name)}
                    >
                      ×
                    </button>
                  </div>
                  <div
                    className="file-privacy"
                    role={item.phase === "blocked" ? "alert" : "status"}
                  >
                    <span className={`privacy-dot ${item.phase}`} aria-hidden="true" />
                    {item.phase === "checking" && c.checking}
                    {item.phase === "ready" && item.protected && (
                      <>
                        <strong>{c.ready(item.protected.protectedValueCount)}</strong>
                        <span>· {c.staysLocal}</span>
                      </>
                    )}
                    {item.phase === "blocked" && item.error && c.privacyErrors[item.error]}
                  </div>
                  {item.phase === "ready" && item.protected && (
                    <>
                      <label className="address-field">
                        <span>{c.addressLabel}</span>
                        <select
                          value={item.grammaticalForm}
                          onChange={(event) => {
                            setConfirmed(false);
                            setItems((current) =>
                              current.map((candidate) =>
                                candidate.id === item.id
                                  ? {
                                      ...candidate,
                                      grammaticalForm: event.target.value as GrammaticalForm,
                                    }
                                  : candidate,
                              ),
                            );
                          }}
                          disabled={busy}
                        >
                          <option value="">{c.addressChoose}</option>
                          <option value="feminine">{c.addressFeminine}</option>
                          <option value="masculine">{c.addressMasculine}</option>
                          <option value="unknown">{c.addressUnknown}</option>
                        </select>
                      </label>
                      <details className="payload-details">
                        <summary>{c.payloadPreview}</summary>
                        <div className="payload-note">{c.confirmHint}</div>
                        <pre>{outboundTranscript(item)}</pre>
                      </details>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="step">
            <div className="step-label">
              <span className="step-num">02</span>
              <h2 className="step-title">{c.typeTitle}</h2>
            </div>
            <div className="type-toggle" role="radiogroup" aria-label={c.typeGroup}>
              <label className={type === "zwischenzeugnis" ? "active" : ""}>
                <input
                  type="radio"
                  name="letter-type"
                  value="zwischenzeugnis"
                  checked={type === "zwischenzeugnis"}
                  onChange={() => setType("zwischenzeugnis")}
                  disabled={busy}
                />
                <span>{c.interim}</span>
              </label>
              <label className={type === "arbeitszeugnis" ? "active" : ""}>
                <input
                  type="radio"
                  name="letter-type"
                  value="arbeitszeugnis"
                  checked={type === "arbeitszeugnis"}
                  onChange={() => setType("arbeitszeugnis")}
                  disabled={busy}
                />
                <span>{c.final}</span>
              </label>
            </div>
            <p className="type-desc">
              {type === "zwischenzeugnis" ? c.interimDesc : c.finalDesc}
            </p>
          </div>

          <div className="step generate-step">
            <div className="step-label">
              <span className="step-num">03</span>
              <h2 className="step-title">{c.createTitle}</h2>
            </div>
            <label
              className={`privacy-confirm${allReady && !busy ? " available" : ""}`}
            >
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                disabled={!allReady || busy}
              />
              <span>
                {c.confirmation}
                <small>{c.confirmHint}</small>
              </span>
            </label>
            {busy ? (
              <button type="button" className="generate" onClick={cancel}>
                {c.cancel}
              </button>
            ) : (
              <button
                type="button"
                className="generate"
                onClick={generate}
                disabled={!allReady || !confirmed}
              >
                {items.length > 1 ? c.createMany(items.length) : c.createOne}
                <span className="arrow" aria-hidden="true">→</span>
              </button>
            )}
            <div
              className={`status-line${statusIsError ? " error" : ""}`}
              aria-live="polite"
              role={statusIsError ? "alert" : "status"}
            >
              {(busy || hasChecking) && <span className="pulse" aria-hidden="true" />}
              {statusText}
            </div>
          </div>
        </section>

        {jobs.length > 0 && (
          <section className="docpane" aria-label={c.drafts}>
            {jobs.length > 1 && (
              <div className="job-tabs" role="tablist" aria-label={c.drafts}>
                {jobs.map((job, index) => (
                  <button
                    id={`job-tab-${job.id}`}
                    key={job.id}
                    type="button"
                    role="tab"
                    tabIndex={activeJob?.id === job.id ? 0 : -1}
                    aria-selected={activeJob?.id === job.id}
                    aria-controls="draft-panel"
                    aria-label={`${job.fileName}, ${c.phase[job.phase]}`}
                    title={job.fileName}
                    className={`job-tab${activeJob?.id === job.id ? " active" : ""}`}
                    onClick={() => setActiveId(job.id)}
                    onKeyDown={(event) => handleTabKey(event, index)}
                  >
                    <span className={`job-dot ${job.phase}`} aria-hidden="true" />
                    <span>{shortName(job.fileName)}</span>
                    <span className="sr-only">, {c.phase[job.phase]}</span>
                  </button>
                ))}
              </div>
            )}
            {(doneCount > 1 ||
              (activeJob?.phase === "done" && Boolean(activeJob.output))) && (
              <div className="doc-toolbar">
                <div className="actions">
                  {doneCount > 1 && (
                    <button
                      type="button"
                      className="toolbtn"
                      onClick={downloadAll}
                      disabled={busy}
                    >
                      {c.downloadAll(doneCount)}
                    </button>
                  )}
                  {activeJob?.phase === "done" && activeJob.output && (
                    <button
                      type="button"
                      className="toolbtn primary"
                      onClick={() => downloadJob(activeJob)}
                      disabled={busy}
                    >
                      {c.downloadWord}
                    </button>
                  )}
                </div>
              </div>
            )}
            <div
              id="draft-panel"
              className="doc-scroll"
              role={jobs.length > 1 ? "tabpanel" : undefined}
              aria-labelledby={
                jobs.length > 1 && activeJob ? `job-tab-${activeJob.id}` : undefined
              }
            >
              {/*
                The on-screen letter preview is intentionally hidden. The
                rendered markdown did NOT match the downloaded Word file
                (letterhead, footer, formatting), which misled users into
                thinking the preview was the file they were downloading. We now
                show a neutral loading/ready widget instead; the real document is
                still generated and available via the download button above.
                Restore the block below only if a true, faithful preview exists.
              */}
              {activeJob && activeJob.phase === "error" ? (
                <div className="doc-empty error-state">
                  <div className="glyph" aria-hidden="true">!</div>
                  <p>{activeJob.error || c.generationFailed}</p>
                </div>
              ) : activeJob && activeJob.phase === "done" ? (
                <div className="doc-status ready" role="status">
                  <div className="doc-status-icon" aria-hidden="true">✓</div>
                  <strong>{c.docReadyTitle}</strong>
                  <p>{c.docReadyBody}</p>
                </div>
              ) : activeJob ? (
                <div
                  className="doc-status loading"
                  role="status"
                  aria-live="polite"
                >
                  <div className="doc-loader-ring" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <strong>{c.docLoadingTitle}</strong>
                  <p>{c.docLoadingBody}</p>
                </div>
              ) : null}

              {/* Original preview rendering, disabled per the note above:
              {activeJob && (activeJob.output || activeJob.phase === "error") ? (
                activeJob.phase === "error" && !activeJob.output ? (
                  <div className="doc-empty error-state">
                    <div className="glyph" aria-hidden="true">!</div>
                    <p>{activeJob.error}</p>
                  </div>
                ) : (
                  <article className="letter" lang="de-CH">
                    {renderLetter(activeJob.output)}
                    {activeJob.phase === "streaming" && (
                      <span className="caret" aria-hidden="true" />
                    )}
                    {activeJob.phase === "error" && activeJob.error && (
                      <p className="letter-error">{activeJob.error}</p>
                    )}
                  </article>
                )
              ) : activeJob ? (
                <div className="draft-skeleton" aria-hidden="true">
                  <span className="skeleton-title" />
                  <span />
                  <span />
                  <span className="short" />
                  <span />
                  <span className="medium" />
                </div>
              ) : null}
              */}
            </div>
          </section>
        )}
      </main>

      <footer className="contact-footer">
        <section className="calendar-panel" aria-labelledby="contact-heading">
          <h2 id="contact-heading">Contact me</h2>
          <div
            className="calendly-inline-widget"
            data-url="https://calendly.com/novakovicluka97/30min?utm_source=sandra_tool&utm_medium=website&utm_campaign=polymed_demo"
          />
          <Script
            src="https://assets.calendly.com/assets/external/widget.js"
            strategy="lazyOnload"
          />
        </section>

        <address className="contact-details">
          <div className="made-by">
            <span>Made by:</span>
            <strong>Luka Novakovic</strong>
            <span>(Magnum Opus LLC)</span>
          </div>
          <dl>
            <div>
              <dt>Email</dt>
              <dd>
                <a href="mailto:novakovicluka97@gmail.com">
                  novakovicluka97@gmail.com
                </a>
              </dd>
            </div>
            <div>
              <dt>Portfolio</dt>
              <dd>
                <a href="https://novakovicluka.com" target="_blank" rel="noreferrer">
                  novakovicluka.com
                </a>
              </dd>
            </div>
            <div>
              <dt>Whatsapp</dt>
              <dd>
                <a href="https://wa.me/381652054445" target="_blank" rel="noreferrer">
                  +381 65 205 4445
                </a>
              </dd>
            </div>
            <div>
              <dt>US-number</dt>
              <dd>
                <a href="tel:+12163501112">(216) 350-1112</a>
              </dd>
            </div>
          </dl>
        </address>
      </footer>

      <dialog
        ref={settingsDialogRef}
        className="settings-dialog"
        aria-labelledby="settings-title"
        aria-describedby="settings-intro"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="settings-shell">
          <button
            type="button"
            className="dialog-close"
            aria-label={c.close}
            onClick={() => settingsDialogRef.current?.close()}
          >
            ×
          </button>

          <div className="settings-heading">
            <span className="dialog-eyebrow">{c.settingsEyebrow}</span>
            <h2 id="settings-title">{c.settingsTitle}</h2>
            <p id="settings-intro">{c.settingsIntro}</p>
          </div>

          <label className="letterhead-switch">
            <input
              type="checkbox"
              checked={documentSettings.enabled}
              onChange={(event) =>
                setDocumentSettings((current) => ({
                  ...current,
                  enabled: event.target.checked,
                }))
              }
            />
            <span className="switch-track" aria-hidden="true">
              <span />
            </span>
            <span className="switch-copy">
              <strong>{c.letterheadToggle}</strong>
              <small>{c.letterheadOn}</small>
            </span>
          </label>

          <fieldset
            className="settings-fields"
            disabled={!documentSettings.enabled}
          >
            <div className="artwork-grid">
              {(["header", "footer"] as const).map((slot) => {
                const artwork = documentSettings[slot];
                const label = slot === "header" ? c.headerLabel : c.footerLabel;
                return (
                  <section className="artwork-card" key={slot}>
                    <div className="artwork-card-heading">
                      <div>
                        <span>{label}</span>
                        <strong>
                          {artwork.isDefault ? c.defaultArtwork : c.customArtwork}
                        </strong>
                      </div>
                      <span className="artwork-dimensions">
                        {artwork.width} × {artwork.height}px
                      </span>
                    </div>
                    <div className={`artwork-preview ${slot}`}>
                      <img src={artwork.source} alt={`${label}: ${artwork.name}`} />
                    </div>
                    <p className="artwork-name" title={artwork.name}>
                      {artwork.name}
                    </p>
                    <div className="artwork-actions">
                      <label className="replace-artwork">
                        {c.replaceImage}
                        <input
                          type="file"
                          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                          onChange={(event) =>
                            void replaceLetterheadImage(slot, event)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => restoreLetterheadImage(slot)}
                        disabled={artwork.isDefault}
                      >
                        {c.restoreDefault}
                      </button>
                    </div>
                    <small className="artwork-hint">
                      {slot === "header" ? c.headerImageHint : c.footerImageHint}
                    </small>
                  </section>
                );
              })}
            </div>

            <div className="distance-panel">
              <label>
                <span>{c.headerDistance}</span>
                <span className="number-field">
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.01"
                    value={documentSettings.headerFromTopInches}
                    onChange={(event) =>
                      setLetterheadDistance(
                        "headerFromTopInches",
                        event.target.valueAsNumber,
                      )
                    }
                  />
                  <small>{c.inches}</small>
                </span>
              </label>
              <label>
                <span>{c.footerDistance}</span>
                <span className="number-field">
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.01"
                    value={documentSettings.footerFromBottomInches}
                    onChange={(event) =>
                      setLetterheadDistance(
                        "footerFromBottomInches",
                        event.target.valueAsNumber,
                      )
                    }
                  />
                  <small>{c.inches}</small>
                </span>
              </label>
              <p>{c.distanceHint}</p>
            </div>
          </fieldset>

          {settingsError && (
            <p className="settings-error" role="alert">
              {settingsError}
            </p>
          )}

          <div className="settings-footer-actions">
            <button
              type="button"
              className="reset-settings"
              onClick={() => {
                setDocumentSettings(defaultDocumentSettings());
                setSettingsError("");
              }}
            >
              {c.resetSettings}
            </button>
            <button
              type="button"
              className="understood"
              onClick={() => settingsDialogRef.current?.close()}
            >
              {c.doneSettings}
            </button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={privacyDialogRef}
        className="privacy-dialog"
        aria-labelledby="privacy-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="dialog-shell">
          <button
            type="button"
            className="dialog-close"
            aria-label={c.close}
            onClick={() => privacyDialogRef.current?.close()}
          >
            ×
          </button>
          <div className="dialog-heading">
            <span className="dialog-eyebrow">{c.modalEyebrow}</span>
            <h2 id="privacy-title">{c.modalTitle}</h2>
            <p>{c.modalIntro}</p>
          </div>

          <ol className="privacy-flow">
            {c.diagram.map((node, index) => (
              <li className={index === 1 ? "external" : "local"} key={node.step}>
                <div className="flow-topline">
                  <span className="flow-step">{node.step}</span>
                  <span className="flow-tag">{node.tag}</span>
                </div>
                <div className="flow-icon">
                  <PrivacyFlowIcon step={index} />
                </div>
                <h3>{node.title}</h3>
                <p>{node.body}</p>
                {index < c.diagram.length - 1 && (
                  <span className="flow-arrow" aria-hidden="true">→</span>
                )}
              </li>
            ))}
          </ol>

          <div className="data-boundary">
            <div>
              <span className="boundary-label local">{c.staysTitle}</span>
              <p>{c.staysItems}</p>
            </div>
            <div>
              <span className="boundary-label external">{c.sentTitle}</span>
              <p>{c.sentItems}</p>
            </div>
          </div>

          <details className="legal-details">
            <summary>
              <span aria-hidden="true">✓</span>
              {c.legalDetails}
            </summary>
            <p>{c.legalBody}</p>
            <div className="source-links">
              <a
                href="https://www.edoeb.admin.ch/en/data-processing-in-the-cloud"
                target="_blank"
                rel="noreferrer"
              >
                {c.fdpicSource}
              </a>
              <a
                href="https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data"
                target="_blank"
                rel="noreferrer"
              >
                {c.anthropicSource}
              </a>
            </div>
          </details>

          <button
            type="button"
            className="understood"
            onClick={() => privacyDialogRef.current?.close()}
          >
            {c.understood}
          </button>
        </div>
      </dialog>
    </div>
  );
}
