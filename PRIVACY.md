# Privacy architecture and production gate

This document describes the web workflow as implemented. It is a technical and product assessment, not legal advice.

## Defensible claim

The web app can demonstrate this narrower claim:

> The original PDF and the listed direct identifiers never leave the browser. Only the exact pseudonymised transcript shown in the transmission preview is sent to the application server and Anthropic for drafting. The returned placeholders are restored in the browser.

It must not claim that no personal data leaves the device, that nothing reaches a data centre, that data is never stored, or that the workflow is completely safe/compliant. Employment facts and evaluations can remain personal data even after names are replaced.

## Enforced data flow

1. `lib/privacy.ts` opens the selected PDF in browser memory and validates a SHA-256 fingerprint of the exact 149-field GRP_DK_1054 v1.1 schema.
2. It replaces surname, given name, birth date, place of origin, supervisor, employment dates, requested issue date, and recognised contact/identifier patterns with random session tokens. Dates and known supervisor display names are normalised locally for correct reinsertion.
3. The same replacements are applied across every transmitted free-text field. The replacement map is kept only in the browser.
4. HR can inspect the complete outbound transcript and must confirm that it contains no patient or health information.
5. `/api/generate` accepts an exact four-key JSON schema only. Multipart data, extra fields, files, raw PDF markers, malformed protected lines, the wrong privacy protocol, common identifiers, and cross-origin requests are rejected.
6. Anthropic receives the pseudonymised work transcript. The web prompt pseudonymises its few-shot examples and replaces named signatory configuration with local tokens before the API call. Anthropic never receives the current original PDF, filename, signature, or replacement map.
7. The streamed draft is re-personalised in the browser; Word generation is also browser-side.

A flattened scan or unknown form version fails closed. It is never uploaded as a fallback. Regex and known-value replacement are additional guards, not universal entity detection; this is why the exact payload preview and HR confirmation are mandatory.

## Repository exposure check

As of 15 July 2026 the configured GitHub repository is public and its history contains `training-data/` and the source `examples/`. `CLAUDE.md` describes the fixtures as fake but realistic. If that statement is not strictly true for every record and signature, treat this as an existing exposure: make the repository private, preserve evidence, assess notification duties, remove the files from current and historical Git objects, and rotate any affected secrets/identifiers as advised. A new `.gitignore` entry alone cannot remove published history. No remote visibility or history was changed as part of this implementation.

## Swiss-law basis for the design

- The revised Swiss FADP requires proportional, purpose-limited processing, privacy by design/default, and appropriate security measures. The controller remains responsible when using processors. [FDPIC: cloud processing](https://www.edoeb.admin.ch/en/data-processing-in-the-cloud)
- Employers may process employee data only insofar as it concerns suitability for employment or is necessary to perform the employment contract. Consent is rarely freely given in an employment relationship. [FDPIC: employer processing](https://www.edoeb.admin.ch/en/data-processing-by-the-employer)
- Foreign disclosure and subprocessors require documented countries, safeguards, instructions, security, and contracts. Pseudonymisation reduces risk but does not remove that analysis. [FDPIC: outsourcing](https://www.edoeb.admin.ch/en/outsourcing-of-data-processing) and [cross-border transfers](https://www.edoeb.admin.ch/en/cross-border-transfer-of-personal-data)
- A DPIA screening is required; a full DPIA is mandatory when the planned processing is likely to create a high risk. [FDPIC: DPIA](https://www.edoeb.admin.ch/en/data-protection-impact-assessment)

## Anthropic facts reflected in the UI

- Commercial API data is not used to train models by default. [Anthropic commercial training policy](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training)
- Standard API inputs and outputs are deleted within 30 days, subject to product, safety, and legal exceptions. Zero-data-retention terms require a separate approved agreement and still have exceptions. [Anthropic retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- Anthropic says data is stored in the US and traffic may be processed in multiple regions. [Anthropic processing locations](https://privacy.claude.com/en/articles/7996890-where-are-your-servers-located-do-you-host-your-models-on-eu-servers)
- Anthropic's commercial DPA includes processor terms and a Swiss SCC addendum. The concrete agreement, subprocessors, retention controls, and permitted data categories must be reviewed for this deployment. [Anthropic DPA](https://www.anthropic.com/legal/data-processing-addendum)

## Required before production

- Add authenticated, role-based Polymed access and rate limiting; the current prototype is single-user and unauthenticated.
- Complete a documented DPIA screening, data-flow inventory, privacy notice, retention schedule, and breach procedure.
- Approve the Anthropic DPA, subprocessor list, processing countries, Swiss transfer safeguards, and any zero-data-retention terms.
- Confirm contractually whether health/special-category data is prohibited; the UI already requires HR to exclude patient and health information.
- Disable request-body logging, session replay, prompt capture, and sensitive crash payloads across hosting and observability.
- Replace or formally approve the source few-shot examples and named company configuration stored in the repository. The web runtime now pseudonymises them before provider use, but Git/build access remains a separate data-at-rest question.
- Capture browser/server network traces and logs with seeded identifiers and prove that originals, names, filenames, and replacement maps do not appear.
- Keep mandatory HR review. The model drafts selected facts; it must not infer performance, health, misconduct, or employment decisions.

Run `npm run test:privacy` after every privacy-path change. These tests use local fixtures only and make no API calls.
