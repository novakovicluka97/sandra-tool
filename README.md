# Sandra-Tool — Swiss Zeugnis Generator

Generates drafts of Swiss employment references (**Zwischenzeugnis** / **Arbeitszeugnis**) from the fillable *Zeugnisantrag* form (GRP_DK_1054) via the Anthropic API. The web workflow protects direct identifiers in the browser before any network request. One repo, two entry points:

- **Web app** (Next.js): select a form PDF, inspect the locally pseudonymised payload, pick the letter type, and get a streamed draft for HR review.
- **Eval harness** (CLI): runs a 12-case test matrix against real HR letters and Swiss legal principles (Art. 330a OR).

## Layout

```
app/                         Next.js App Router UI + POST /api/generate (streams the draft)
lib/privacy.ts               Browser-only form extraction, placeholder vault, and reinsertion
lib/docx.ts                  Browser-only Word rendering with optional header/footer artwork
public/header-image.png      Default Polymed Word header artwork
public/footer-image.jpg      Default Polymed Word footer artwork
prompts/system-zeugnis.md    German system prompt: legal rules, calibration table, structure, output contract
prompts/style-rules.md       Binding style rules (no em-dashes, natural HR register, signature block format)
prompts/company-config.md    Polymed boilerplate: company paragraph, signatory rules, abbreviations
examples/                    Few-shot pool: form transcripts + real letters (Biafora, Bergomi, Mettler)
scripts/generate.mjs         One generation: form (PDF sent natively, or .md transcript) -> letter draft
scripts/run-all.mjs          The 12-case test matrix with leave-one-out few-shot selection
eval/inputs/synthetic/       5 synthetic forms covering cases the sample batch doesn't (weak ratings,
                             termination, retirement+leadership, near-empty form, part-time transfer)
eval/outputs/<case>/         Generated drafts from the last harness run (letter + "Hinweise für HR")
eval/outputs-v1/             Prompt-v1 outputs, kept for comparison
eval/rubric.md               Law-anchored grading rubric (7 weighted dimensions, hard-fail overrides)
eval/comparison.md           Developer session's honest evaluation
eval/VALIDATION-PROTOCOL.md  How to run an unbiased second evaluation in a fresh AI session
training-data/               Original fillable/flattened forms and HR letters (PDF/DOCX)
tests/privacy.test.ts        No-API leakage and fail-closed privacy tests
PRIVACY.md                   Architecture, claim boundary, and production compliance checklist
```

## Run the web app

Requires Node 22+ and `ANTHROPIC_API_KEY` in `.env.local` (or `.env`).

```
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run test:privacy
```

The app reads the known 149-field AcroForm locally and validates its exact schema fingerprint. It sends only a reviewed text transcript containing random placeholders plus the work-related fields required for drafting. The API route rejects multipart/file requests, extra JSON fields, malformed protected lines, raw PDF signatures, unknown privacy-protocol versions, and common direct identifiers. The original PDF, filename, signature, and replacement map stay in browser memory. Named examples and signatory configuration are pseudonymised at runtime before the provider prompt is built. Prompt and example `.md` files are read from disk at runtime (`next.config.mjs` includes them in the serverless bundle for Vercel).

Finished drafts are converted to `.docx` locally in the browser. The gear button opens Word-output settings where HR can enable or disable the letterhead, replace the default header and footer with local PNG/JPG files, and adjust their Word distances. These assets and settings never enter the generation API payload.

Flattened scans and unknown form versions are deliberately blocked because deterministic protection cannot be verified. There is no raw-PDF fallback. See [`PRIVACY.md`](PRIVACY.md) for the exact boundary and the checks still required before production use.

## Run the eval harness

```
npm run eval                                     # all 12 cases -> eval/outputs/
npm run eval -- --only mettler                   # substring filter on case/type
npm run eval -- --model claude-opus-4-8          # model comparison run
npm run generate -- --input <pdf|md> --type zwischenzeugnis --case foo --examples biafora:zwischenzeugnis,mettler:zwischenzeugnis
```

Harness default model: `claude-sonnet-5`. Real form PDFs are sent to the API natively (no OCR step) — the model reads checkboxes and handwriting visually. Note: on `claude-sonnet-5` do not add `temperature` (non-default sampling params are rejected with a 400); determinism is approximated by the prompt's hard calibration rules.

## Design decisions (why it is built this way)

- **Leave-one-out few-shot:** a case's own real letters never appear in its prompt; `generate.mjs` throws on leakage. Moser additionally excludes same-department Bergomi to test generalization.
- **Checked level = hard constraint:** the form's sehr gut/gut/genügend phrase matrix is embedded verbatim; the prompt forbids intensity changes in either direction (the main legal risk).
- **No invention:** missing data → bracketed placeholders; empty task list → placeholder block. Real HR letters enrich from HR systems the AI cannot see — the eval categorizes those gaps as "unknowable enrichment", not errors.
- **Conservative ambiguity handling:** double-checked boxes resolve to the lower level; everything is reported in the mandatory `## Hinweise für HR` section. Output is always a draft for human review.
- **Anti-overfitting:** grading is anchored in Art. 330a principles, house-style similarity is only 5% of the rubric, and half the matrix is synthetic cases outside the sample batch's distribution.
- **Same prompt stack everywhere:** the harness (`scripts/generate.mjs`) and the app (`app/api/generate/route.ts`) build the system prompt from the same `prompts/` + `examples/` files, so eval results describe the shipped behavior.

## Prompt-change log

- v1: initial prompt. Smoke test (Mettler): all 20 rated dimensions at correct calibration register from the scanned PDF; no changes made. No tuning toward sample texts beyond the structure template.
- Harness fix (not a prompt change): `max_tokens` 8192 → 16000 — adaptive thinking shares the output budget and the first full-matrix run truncated on biafora/arbeitszeugnis.
- v2: added rule «3a. Tempus-Disziplin». The v1 full matrix showed a systematic defect: past-tense slips in Zwischenzeugnisse («Wir lernten X kennen» in 4 of 8 ZZ letters; «erbrachte» in biafora/zwischenzeugnis), caused by the calibration table quoting the form's past-tense phrases. Legally motivated fix (rubric dim. 4), not style tuning. Full matrix re-run on v2.
- style-rules.md added for the web app (no em-dashes, natural register, signature block format) and now included by the harness as well.

## Known limitations

- Word output includes configurable local header/footer artwork; PDF export and signature-image management are not implemented yet.
- Company config is hardcoded to Polymed.
- Only one real Arbeitszeugnis exists in the training data; AZ generation for non-Biafora cases relies on the prompt rules plus one example.
- Web protection currently supports only the exact fillable GRP_DK_1054 v1.1 schema. Flattened scans require a future fully local OCR plus human-review workflow, or manual structured entry.
- Pseudonymisation is not anonymisation: work duties, ratings and context can remain personal data. Production requires the legal, contractual and organisational checks in `PRIVACY.md`.
- Single-user, no auth (Supabase keys in `.env` are provisioned for a planned multi-user login, not wired up yet).
