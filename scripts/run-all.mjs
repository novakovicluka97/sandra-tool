import path from "path";
import { fileURLToPath } from "url";
import { generateLetter } from "./generate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const TRAINING = path.join(ROOT, "training-data");
const SYNTH = path.join(ROOT, "eval", "inputs", "synthetic");

// Leave-one-out few-shot: a case's own real letters never appear in its examples.
const ZZ_POOL_A = [{ name: "biafora", type: "zwischenzeugnis" }, { name: "mettler", type: "zwischenzeugnis" }];
const AZ_POOL = [{ name: "biafora", type: "arbeitszeugnis" }, { name: "mettler", type: "zwischenzeugnis" }];

const MATRIX = [
  // --- Real cases (compared against real letters) ---
  {
    caseName: "biafora", type: "arbeitszeugnis",
    inputPath: path.join(TRAINING, "BiaforaMorena_ZeugnisantragArbeitszeugnis_20260326.pdf"),
    exampleSpecs: [{ name: "mettler", type: "zwischenzeugnis" }, { name: "bergomi", type: "zwischenzeugnis" }],
  },
  {
    caseName: "biafora", type: "zwischenzeugnis",
    inputPath: path.join(TRAINING, "BiaforaMorena_ZeugnisantragArbeitszeugnis_20260326.pdf"),
    exampleSpecs: [{ name: "mettler", type: "zwischenzeugnis" }, { name: "bergomi", type: "zwischenzeugnis" }],
  },
  {
    caseName: "bergomi", type: "zwischenzeugnis",
    inputPath: path.join(TRAINING, "BergomiSeraina_Zeugnisantrag_20260605.pdf"),
    exampleSpecs: ZZ_POOL_A,
  },
  {
    caseName: "mettler", type: "zwischenzeugnis",
    inputPath: path.join(TRAINING, "MettlerMichael_Zeugnisantrag20260601.pdf"),
    exampleSpecs: [{ name: "biafora", type: "zwischenzeugnis" }, { name: "bergomi", type: "zwischenzeugnis" }],
  },
  {
    caseName: "moser", type: "zwischenzeugnis",
    inputPath: path.join(TRAINING, "MoserDominique_Zeugnisantrag_20260605.pdf"),
    // deliberately excludes Bergomi (same department, near-identical letter) to test generalization
    exampleSpecs: ZZ_POOL_A,
  },
  {
    caseName: "santamaria", type: "zwischenzeugnis",
    inputPath: path.join(TRAINING, "SantamariaDianaSofia_ZeugnisantragZwischenzeugnis.pdf"),
    exampleSpecs: ZZ_POOL_A,
  },
  // --- Rubric-only cases (no ground-truth letter) ---
  {
    caseName: "santamaria", type: "arbeitszeugnis", // what her form actually requests
    inputPath: path.join(TRAINING, "SantamariaDianaSofia_ZeugnisantragZwischenzeugnis.pdf"),
    exampleSpecs: AZ_POOL,
  },
  { caseName: "synthetic-weak-termination", type: "arbeitszeugnis", inputPath: path.join(SYNTH, "synthetic-weak-termination-form.md"), exampleSpecs: AZ_POOL },
  { caseName: "synthetic-leader-retirement", type: "arbeitszeugnis", inputPath: path.join(SYNTH, "synthetic-leader-retirement-form.md"), exampleSpecs: AZ_POOL },
  { caseName: "synthetic-minimal", type: "zwischenzeugnis", inputPath: path.join(SYNTH, "synthetic-minimal-form.md"), exampleSpecs: ZZ_POOL_A },
  { caseName: "synthetic-mangelhaft", type: "arbeitszeugnis", inputPath: path.join(SYNTH, "synthetic-mangelhaft-form.md"), exampleSpecs: AZ_POOL },
  { caseName: "synthetic-parttime-transfer", type: "zwischenzeugnis", inputPath: path.join(SYNTH, "synthetic-parttime-transfer-form.md"), exampleSpecs: ZZ_POOL_A },
];

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const model = process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : undefined;

const runs = only
  ? MATRIX.filter((m) => `${m.caseName}/${m.type}`.includes(only))
  : MATRIX;

let failed = 0;
for (const run of runs) {
  try {
    await generateLetter({ ...run, ...(model ? { model } : {}) });
  } catch (err) {
    failed++;
    console.error(`FAIL [${run.caseName}/${run.type}]: ${err.message}`);
  }
}
console.log(`\nDone: ${runs.length - failed}/${runs.length} succeeded.`);
if (failed > 0) process.exit(1);
