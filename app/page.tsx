"use client";

import { useRef, useState, type ReactNode } from "react";

type LetterType = "zwischenzeugnis" | "arbeitszeugnis";
type JobPhase = "queued" | "uploading" | "streaming" | "done" | "error";

type Job = {
  id: number;
  fileName: string;
  type: LetterType;
  phase: JobPhase;
  output: string;
  error: string;
};

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
    const t = line.trim();
    if (t.startsWith("- ")) {
      bullets.push(t.slice(2));
      return;
    }
    flush(`ul-${i}`);
    if (t === "") return;
    if (t === "---") {
      blocks.push(<hr key={i} />);
    } else if (t.startsWith("## ")) {
      blocks.push(<h2 key={i}>{t.slice(3)}</h2>);
    } else if (t.startsWith("# ")) {
      blocks.push(<h1 key={i}>{t.slice(2)}</h1>);
    } else {
      blocks.push(<p key={i}>{inline(t)}</p>);
    }
  });
  flush("ul-end");
  return blocks;
}

function shortName(name: string): string {
  const base = name.replace(/\.pdf$/i, "");
  return base.length > 22 ? `${base.slice(0, 20)}…` : base;
}

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [type, setType] = useState<LetterType>("zwischenzeugnis");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeId, setActiveId] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState("");
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  const activeJob = jobs.find((j) => j.id === activeId) ?? jobs[0] ?? null;

  function acceptFiles(list: FileList | File[] | null | undefined) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    const pdfs = incoming.filter(
      (f) => f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf",
    );
    setPickError(
      pdfs.length < incoming.length ? "Nur PDF-Dateien werden übernommen." : "",
    );
    if (pdfs.length === 0) return;
    setFiles((prev) => {
      const known = new Set(prev.map((f) => `${f.name}|${f.size}`));
      return [...prev, ...pdfs.filter((f) => !known.has(`${f.name}|${f.size}`))];
    });
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function patchJob(id: number, patch: Partial<Job>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  async function runJob(job: Job, file: File, controller: AbortController) {
    patchJob(job.id, { phase: "uploading" });

    const form = new FormData();
    form.append("file", file);
    form.append("type", job.type);

    const res = await fetch("/api/generate", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      let message = `Fehler ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error) message = data.error;
      } catch {}
      throw new Error(message);
    }
    if (!res.body) throw new Error("Keine Antwort vom Server.");

    patchJob(job.id, { phase: "streaming" });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      patchJob(job.id, { output: text });
    }
    text += decoder.decode();
    patchJob(job.id, { output: text, phase: "done" });
  }

  async function generate() {
    if (files.length === 0 || busy) return;
    setBusy(true);
    cancelledRef.current = false;

    const newJobs: Job[] = files.map((f, i) => ({
      id: Date.now() + i,
      fileName: f.name,
      type,
      phase: "queued",
      output: "",
      error: "",
    }));
    setJobs(newJobs);
    setActiveId(newJobs[0].id);

    for (let i = 0; i < newJobs.length; i++) {
      if (cancelledRef.current) {
        patchJob(newJobs[i].id, { phase: "error", error: "Abgebrochen." });
        continue;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setActiveId(newJobs[i].id);
      try {
        await runJob(newJobs[i], files[i], controller);
      } catch (err) {
        patchJob(newJobs[i].id, {
          phase: "error",
          error: controller.signal.aborted
            ? "Abgebrochen."
            : err instanceof Error
              ? err.message
              : "Unbekannter Fehler",
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
    const blob = await letterToDocxBlob(job.output);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = letterFilename(job.output, job.type, job.fileName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadAll() {
    for (const job of jobs) {
      if (job.phase === "done" && job.output) {
        await downloadJob(job);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  const doneCount = jobs.filter((j) => j.phase === "done").length;
  const runningIndex = jobs.findIndex(
    (j) => j.phase === "uploading" || j.phase === "streaming",
  );

  const statusText = busy
    ? jobs.length > 1
      ? `Datei ${runningIndex + 1} von ${jobs.length} wird verarbeitet …`
      : runningIndex >= 0 && jobs[runningIndex].phase === "uploading"
        ? "Formular wird gelesen …"
        : "Entwurf wird geschrieben …"
    : jobs.length > 0
      ? doneCount === jobs.length
        ? "Entwürfe fertig. Bitte prüfen."
        : doneCount > 0
          ? `${doneCount} von ${jobs.length} Entwürfen fertig.`
          : jobs.some((j) => j.phase === "error")
            ? (jobs.find((j) => j.phase === "error")?.error ?? "Fehler")
            : ""
      : pickError;

  const statusIsError =
    !busy && (pickError !== "" || (jobs.length > 0 && doneCount === 0 && jobs.some((j) => j.phase === "error")));

  return (
    <div className="frame">
      <header className="masthead">
        <div className="masthead-left">
          <div className="mark">Z</div>
          <div>
            <h1>
              Zeugnis-<em>Generator</em>
            </h1>
            <div className="masthead-sub">
              Polymed Medical Center AG · Entwurfswerkzeug für HR
            </div>
          </div>
        </div>
        <div className="masthead-right">
          <span>Prototyp</span>
        </div>
      </header>

      <main className="workbench">
        <section className="controls">
          <div className="step">
            <div className="step-label">
              <span className="step-num">01</span>
              <span className="step-title">Zeugnisanträge hochladen</span>
            </div>
            <label
              className={`dropzone${dragging ? " dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                acceptFiles(e.dataTransfer.files);
              }}
            >
              <input
                type="file"
                accept=".pdf,application/pdf"
                multiple
                onChange={(e) => {
                  acceptFiles(e.target.files);
                  e.target.value = "";
                }}
                disabled={busy}
              />
              <div className="dropzone-icon">⇪</div>
              <div className="dropzone-main">
                PDFs hierher ziehen oder klicken
              </div>
              <div className="dropzone-hint">
                Formular GRP_DK_1054 · mehrere Dateien möglich · max. 10 MB
              </div>
            </label>
            {files.map((f, i) => (
              <div className="file-chip" key={`${f.name}-${f.size}-${i}`}>
                <span className="name">{f.name}</span>
                <span className="size">{formatSize(f.size)}</span>
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => removeFile(i)}
                  disabled={busy}
                  aria-label={`${f.name} entfernen`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="step">
            <div className="step-label">
              <span className="step-num">02</span>
              <span className="step-title">Zeugnisart wählen</span>
            </div>
            <div className="type-toggle" role="radiogroup" aria-label="Zeugnisart">
              <button
                type="button"
                className={type === "zwischenzeugnis" ? "active" : ""}
                onClick={() => setType("zwischenzeugnis")}
                disabled={busy}
              >
                Zwischen&shy;zeugnis
              </button>
              <button
                type="button"
                className={type === "arbeitszeugnis" ? "active" : ""}
                onClick={() => setType("arbeitszeugnis")}
                disabled={busy}
              >
                Arbeits&shy;zeugnis
              </button>
            </div>
            <p className="type-desc">
              {type === "zwischenzeugnis"
                ? "Während des laufenden Arbeitsverhältnisses, durchgehend im Präsens."
                : "Schlusszeugnis beim Austritt, durchgehend im Präteritum, mit Austrittsabsatz."}
            </p>
          </div>

          <div className="step">
            <div className="step-label">
              <span className="step-num">03</span>
              <span className="step-title">Entwürfe erstellen</span>
            </div>
            {busy ? (
              <button type="button" className="generate" onClick={cancel}>
                Abbrechen
              </button>
            ) : (
              <button
                type="button"
                className="generate"
                onClick={generate}
                disabled={files.length === 0}
              >
                {files.length > 1
                  ? `${files.length} Entwürfe erstellen`
                  : "Entwurf erstellen"}{" "}
                <span className="arrow">→</span>
              </button>
            )}
            <div className={`status-line${statusIsError ? " error" : ""}`}>
              {busy && <span className="pulse" />}
              {statusText}
            </div>
          </div>
        </section>

        <section className="docpane">
          {jobs.length > 1 && (
            <div className="job-tabs" role="tablist" aria-label="Entwürfe">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  role="tab"
                  aria-selected={activeJob?.id === job.id}
                  className={`job-tab${activeJob?.id === job.id ? " active" : ""}`}
                  onClick={() => setActiveId(job.id)}
                >
                  <span className={`job-dot ${job.phase}`} />
                  {shortName(job.fileName)}
                </button>
              ))}
            </div>
          )}
          <div className="doc-toolbar">
            <span>
              Entwurf ·{" "}
              {(activeJob?.type ?? type) === "zwischenzeugnis"
                ? "Zwischenzeugnis"
                : "Arbeitszeugnis"}
              {activeJob && jobs.length > 1 ? ` · ${shortName(activeJob.fileName)}` : ""}
            </span>
            <div className="actions">
              {doneCount > 1 && (
                <button
                  type="button"
                  className="toolbtn"
                  onClick={downloadAll}
                  disabled={busy}
                >
                  Alle herunterladen ({doneCount})
                </button>
              )}
              <button
                type="button"
                className="toolbtn primary"
                onClick={() => activeJob && downloadJob(activeJob)}
                disabled={!activeJob || activeJob.phase !== "done" || !activeJob.output}
              >
                Word herunterladen (.docx)
              </button>
            </div>
          </div>
          <div className="doc-scroll">
            {activeJob && (activeJob.output || activeJob.phase === "error") ? (
              activeJob.phase === "error" && !activeJob.output ? (
                <div className="doc-empty">
                  <div className="glyph">!</div>
                  <p>{activeJob.error}</p>
                </div>
              ) : (
                <article className="letter">
                  {renderLetter(activeJob.output)}
                  {activeJob.phase === "streaming" && <span className="caret" />}
                </article>
              )
            ) : (
              <div className="doc-empty">
                <div className="glyph">Z</div>
                <p>
                  Hier erscheint der Zeugnisentwurf, sobald ein Zeugnisantrag
                  hochgeladen und die Erstellung gestartet wurde.
                </p>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="colophon">
        <span>Ausgabe ist ein Entwurf · Prüfung durch HR zwingend</span>
        <span>Art. 330a OR · Kalibrierte Zeugnissprache</span>
      </footer>
    </div>
  );
}
