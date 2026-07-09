"use client";

import { useRef, useState, type ReactNode } from "react";

type LetterType = "zwischenzeugnis" | "arbeitszeugnis";
type Phase = "idle" | "uploading" | "streaming" | "done" | "error";

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

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<LetterType>("zwischenzeugnis");
  const [phase, setPhase] = useState<Phase>("idle");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const busy = phase === "uploading" || phase === "streaming";

  function acceptFile(candidate: File | undefined | null) {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".pdf")) {
      setError("Bitte ein PDF auswählen.");
      setPhase("error");
      return;
    }
    setFile(candidate);
    setError("");
    if (phase === "error") setPhase("idle");
  }

  async function generate() {
    if (!file || busy) return;
    setPhase("uploading");
    setOutput("");
    setError("");
    setCopied(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("type", type);

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

      setPhase("streaming");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setOutput(text);
      }
      text += decoder.decode();
      setOutput(text);
      setPhase("done");
    } catch (err) {
      if (controller.signal.aborted) {
        setPhase("idle");
        return;
      }
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      setPhase("error");
    } finally {
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  async function copyOutput() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const statusText =
    phase === "uploading"
      ? "Formular wird gelesen …"
      : phase === "streaming"
        ? "Entwurf wird geschrieben …"
        : phase === "done"
          ? "Entwurf fertig. Bitte prüfen."
          : phase === "error"
            ? error
            : "";

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
          <span className="badge">Claude Opus 4.8</span>
          <span>Prototyp</span>
        </div>
      </header>

      <main className="workbench">
        <section className="controls">
          <div className="step">
            <div className="step-label">
              <span className="step-num">01</span>
              <span className="step-title">Zeugnisantrag hochladen</span>
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
                acceptFile(e.dataTransfer.files?.[0]);
              }}
            >
              <input
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => acceptFile(e.target.files?.[0])}
                disabled={busy}
              />
              <div className="dropzone-icon">⇪</div>
              <div className="dropzone-main">
                PDF hierher ziehen oder klicken
              </div>
              <div className="dropzone-hint">
                Formular GRP_DK_1054 · max. 10 MB
              </div>
            </label>
            {file && (
              <div className="file-chip">
                <span className="name">{file.name}</span>
                <span className="size">{formatSize(file.size)}</span>
              </div>
            )}
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
              <span className="step-title">Entwurf erstellen</span>
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
                disabled={!file}
              >
                Entwurf erstellen <span className="arrow">→</span>
              </button>
            )}
            <div className={`status-line${phase === "error" ? " error" : ""}`}>
              {busy && <span className="pulse" />}
              {statusText}
            </div>
          </div>
        </section>

        <section className="docpane">
          <div className="doc-toolbar">
            <span>
              Entwurf ·{" "}
              {type === "zwischenzeugnis" ? "Zwischenzeugnis" : "Arbeitszeugnis"}
            </span>
            <div className="actions">
              <button
                type="button"
                className="toolbtn"
                onClick={copyOutput}
                disabled={!output || busy}
              >
                {copied ? "Kopiert ✓" : "Markdown kopieren"}
              </button>
            </div>
          </div>
          <div className="doc-scroll">
            {output ? (
              <article className="letter">
                {renderLetter(output)}
                {phase === "streaming" && <span className="caret" />}
              </article>
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
