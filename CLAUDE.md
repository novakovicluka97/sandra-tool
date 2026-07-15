# CLAUDE.md — sandra-tool

Swiss Zeugnis (employment reference) draft generator for Polymed Medical Center AG. A Next.js web app plus a CLI eval harness sharing one prompt stack. See `README.md` for layout and run commands.

## North Star

Deliver a tool the Polymed HR contact can confidently demonstrate to management: it should remove the repetitive work of drafting Swiss employment references while keeping HR in control, making the privacy boundary visible, and never overstating what the cloud workflow protects.

## Commands

```
npm run dev          # dev server, http://localhost:3000
npm run build        # production build (also the type-check; there is no separate lint/test script)
npm run test:privacy # local PDF protection, leakage, and fail-closed tests (no API calls)
npm run eval         # 12-case eval matrix -> eval/outputs/  (COSTS REAL API TOKENS — only when asked)
npm run generate     # single harness generation (see README for flags)
```

## Architecture in one paragraph

The browser reads the known fillable GRP_DK_1054 form locally through `lib/privacy.ts`, replaces direct identifiers with random per-session placeholders, and shows the exact outbound transcript. The original PDF, filename, signature, and replacement key are never accepted by `app/api/generate/route.ts`; that route accepts protected JSON only, sends the pseudonymised transcript to `claude-opus-4-8`, and streams placeholder-bearing text back for local restoration in `app/page.tsx`. Flattened scans and unknown form versions fail closed. The CLI eval harness remains a separate developer workflow that sends its configured inputs directly to the API.

## Hard rules

- **Keep the two prompt builders in sync.** `buildSystemPrompt` exists twice: `app/api/generate/route.ts` and `scripts/generate.mjs`. Any change to prompt-file names, ordering, or the examples format must be made in both, or the eval no longer measures the shipped behavior.
- **Never weaken the leakage guard.** The harness throws if a case's own letters appear in its few-shot examples (leave-one-out discipline). Do not alter the example assignments in `scripts/run-all.mjs` — they are deliberate (see README "Design decisions").
- **Calibration is legally motivated, not style.** The prompt's sehr gut/gut/genügend phrase matrix and tense rules exist because of Art. 330a OR risk. Do not "improve" the wording of `prompts/*.md` casually; prompt changes belong in the README's prompt-change log and need an eval re-run.
- **Runtime file reads must be traced.** The API route reads `prompts/` and `examples/` from disk at runtime; `next.config.mjs` (`outputFileTracingIncludes`) lists them for the Vercel bundle. New runtime-read paths go there too.
- **`claude-sonnet-5` rejects non-default sampling params** (e.g. `temperature`) with a 400 — don't add them to harness calls.
- **`training-data/` filenames are load-bearing.** `scripts/run-all.mjs` references the PDFs by exact name; don't rename or move them. The folder contains (fake but realistic) personal data — don't copy its contents elsewhere.
- **Secrets:** `ANTHROPIC_API_KEY` lives in `.env.local` / `.env` (both gitignored). Never hardcode or log it.
- **Never weaken the privacy boundary.** The web route must not accept multipart data, files, filenames, replacement maps, extra JSON keys, or PDF document blocks. Unknown/flattened/modified schemas stay blocked; never add a raw-upload fallback. Provider prompt examples and signatories must remain pseudonymised. Any new outbound field must appear in the local transmission preview and pass the privacy tests.

## Language and style of generated output

The interface is bilingual German/English; generated letters always remain German. German UI and letter copy use Swiss orthography («ss», never «ß»; guillemets «…»). Generated letters must obey `prompts/style-rules.md` — notably: no em/en dashes anywhere in output, signature block as name + function on separate lines, natural HR register. Output is always a draft; the UI must keep the mandatory-human-review framing and the model's `## Hinweise für HR` section. Never market pseudonymisation as complete anonymisation or claim that no personal data is externally processed.

## Evaluation workflow

Prompt changed → run `npm run eval` (all 12 cases), grade against `eval/rubric.md`, log the change in README's prompt-change log. For an unbiased second opinion, follow `eval/VALIDATION-PROTOCOL.md` in a fresh session (it restricts which files may be read before grading — respect the allowlist). `eval/outputs-v1/` is a historical snapshot; don't overwrite it.
