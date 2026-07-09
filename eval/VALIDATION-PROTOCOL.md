# Independent Validation Protocol (for a fresh AI session)

Purpose: verify the AI core's results without contamination. The generating step must never see the real HR letters or the developer session's outputs; the grading step happens afterwards, against the real letters, using the law-anchored rubric.

## Why this exists

The developer session read the real letters while building the prompt. Its self-evaluation is therefore informed but not independent. This protocol produces an unbiased second measurement.

## Step 1 — Generation (fresh session, restricted context)

Start a new AI session. Instruct it to perform ONLY the following, with an explicit file allowlist:

**MAY read:**
- `prompts/system-zeugnis.md`, `prompts/style-rules.md`, `prompts/company-config.md`
- `examples/*.md` (few-shot pool — these are training data by design)
- `eval/inputs/synthetic/*.md`
- `scripts/*.mjs`, `package.json`
- The Zeugnisantrag FORM PDFs in `training-data/`:
  `BiaforaMorena_ZeugnisantragArbeitszeugnis_20260326.pdf`, `BergomiSeraina_Zeugnisantrag_20260605.pdf`, `MettlerMichael_Zeugnisantrag20260601.pdf`, `MoserDominique_Zeugnisantrag_20260605.pdf`, `SantamariaDianaSofia_ZeugnisantragZwischenzeugnis.pdf`, `Zeugnisantrag Leer.pdf`

**MUST NOT read (until Step 2):**
- Any `*Zwischenzeugnis*.pdf` or `*Arbeitszeugnis*.pdf` output letter in `training-data/` (i.e. `BergomiSeraina_Zwischenzeugnis_20260615.pdf`, `BiaforaMorena_Arbeitszeugnis_20260630.pdf`, `BiaforaMorena_Zwischenzeugnis_20260511.pdf`, `MettlerMichael_Zwischenzeugnis_20260629.pdf`, `MoserDominique_Zwischenzeugnis_20260615.pdf`, `SantamariaDianaSofia_Zwischenzeugnis20260217.pdf`)
- `training-data/Arbeitszeugnis_Anonym.docx`, `training-data/Zwischenzeugnis_Anonym.docx`
- `eval/outputs/` (the developer session's generations)
- `eval/comparison.md` (the developer session's self-evaluation)

**Caveat on the examples folder:** `examples/` contains transcripts of Biafora/Bergomi/Mettler letters — they are the few-shot pool and unavoidable. The leave-one-out discipline is enforced by the script (`generate.mjs` throws on leakage), so the validation session must NOT alter the example assignments in `run-all.mjs`.

**Action:** run (from the repo root)
```
node scripts/run-all.mjs            # writes to eval/outputs/
```
To keep the developer outputs intact for comparison, first rename `eval/outputs` to `eval/outputs-dev`, so the fresh run writes cleanly.

## Step 2 — Grading (same session, AFTER generation is complete)

Only now read the real letters in `training-data/` and `eval/rubric.md`. For each of the 12 cases:

1. **Real cases (6):** compare the generated letter side-by-side with the corresponding real letter. Categorize every difference as A (agent error) / B (unknowable enrichment) / C (real letter's own deviation from the form) per the rubric. Score all 7 rubric dimensions, apply hard-fail overrides, compute the weighted total.
2. **Rubric-only cases (6):** score all 7 dimensions directly from form-transcript vs. generated letter, quoting evidence for each score. Pay special attention to: grade drift on the weak/mangelhaft cases, invented content on the minimal case, coded language anywhere, exit-paragraph legality on the termination cases.
3. **Anti-overfitting check (explicit):** for the synthetic cases, verify the letters do NOT parrot content from the Polymed sample batch that isn't justified by the input form (e.g. medical-device vocabulary leaking into the finance/logistics cases, Laborsupport sentences appearing for non-Laborsupport employees, task lists echoing sample letters).
4. Produce `eval/independent-evaluation.md` with per-case scores, quoted evidence, the deviation categorization for real cases, and an overall verdict: pass / pass-with-conditions / fail, with the conditions named.

## Grading calibration instructions (important)

- Grade against **Art. 330a OR principles** (rubric dimensions), not against "how close is this to the sample letters". The sample batch is 5 strong-employee letters from one company — it does NOT define the space of valid Zeugnisse.
- Do not reward the generator for reproducing the real letters' own liberties (category C) and do not punish it for lacking data no form contains (category B).
- Be brutally honest. The purpose of this exercise is to find failures before an HR professional does.
