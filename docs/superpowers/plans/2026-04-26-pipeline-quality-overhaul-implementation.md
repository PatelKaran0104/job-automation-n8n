# Pipeline Quality Overhaul (v7-lite) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement v7-lite pipeline (deterministic-validator + Planner/Tailor split) on top of v6, gated by a v6 hotfix soak in Stage 0.

**Architecture:** Node.js/Express server provides `/validate` + extended `/generate-coverletter` empty-body guard. n8n adds Planner → Tailor → Retry Controller → Review Queue stages around the existing match filter. New deterministic validator replaces the v7-original LLM Critic.

**Tech Stack:** Node 18+ ESM, Express 4, Playwright, n8n (orchestration), OpenRouter (Sonnet 4.6), Google Sheets (review queue).

**Source spec:** [docs/superpowers/specs/2026-04-19-pipeline-quality-overhaul-design.md](../specs/2026-04-19-pipeline-quality-overhaul-design.md)
**Source incident:** [docs/superpowers/evaluations/2026-04-18-run-quality-review.md](../evaluations/2026-04-18-run-quality-review.md)

---

## How to use this plan across sessions

Each task below is **self-contained for one Claude session**:

1. **Bootstrap prompt** — copy-paste into a fresh Claude Code session in `d:\KARAN`. It tells Claude exactly which spec sections + files to load, and nothing more. This keeps per-session token cost low.
2. **Files** — exact create/modify paths.
3. **Steps** — bite-sized TDD or content-drafting steps with full code/content shown inline.
4. **Verify** — exact commands and expected output.
5. **Commit** — exact `git commit` message.

**Multi-session discipline:**
- Always start a new session at a task boundary, not mid-task.
- Mark tasks complete in this file (`- [x]`) so the next session knows where to resume.
- After Phase A (Stage 0 hotfix), **stop and soak for 14–30 days** before starting Phase B. Stage 0 may obviate Phases B–E entirely (see spec §10.5).

---

## Phase / Session Map

| Phase | Sessions | Stage(s) in spec | Gate to next phase |
|---|---|---|---|
| **A — Hotfix** | 1 | Stage 0 | Soak 14–30 days; if ≥1 Recruiter Reply, **STOP** |
| **B — Foundations** | 2, 3, 4, 5 | Stage 1, 2 | Validator unit tests green; user approval on exemplars |
| **C — Pipeline** | 6, 7, 8, 9 | Stage 4–7 | Golden set passes (9/9) |
| **D — Review Queue** | 10 | Stage 8 | Concurrent-edit race test passes |
| **E — Validation** | 11, 12, 13 | Stage 10.5–12 | Live 25-job batch ship-rate ≥70% |
| **F — Outcome** | 14 | Stage 13 | 60-day callback review decision |

---

## File Structure (target end-state)

```
d:\KARAN\
├── src/
│   ├── server.js                    ← MODIFY: empty-body guard + /validate route
│   ├── validatePatch.js             ← MODIFY: add 8 §3.5.2 checks; export runValidator()
│   └── ...                          (others unchanged)
├── data/
│   ├── resume.json                  ← MODIFY: apply audit edits
│   ├── banned-phrases.json          ← NEW
│   ├── styleguide/
│   │   ├── de.md                    ← NEW
│   │   └── en.md                    ← NEW
│   └── exemplars/
│       ├── de/{formal,semi_formal}.md   ← NEW (2 files)
│       └── en/{formal,semi_formal}.md   ← NEW (2 files)
├── tests/
│   ├── validatePatch.test.js        ← MODIFY: add tests for 8 checks
│   ├── bannedPhrases.test.js        ← NEW
│   ├── planSchema.test.js           ← NEW
│   └── retryController.test.js      ← NEW
├── docs/superpowers/
│   ├── plans/
│   │   └── 2026-04-26-pipeline-quality-overhaul-implementation.md  ← THIS FILE
│   ├── evaluations/
│   │   ├── 2026-04-XX-base-resume-audit.md          ← NEW (Session 2)
│   │   ├── 2026-04-XX-v7lite-shadow-eval.md         ← NEW (Session 12)
│   │   └── weekly-kpis.md                           ← NEW (Session 13+)
│   └── golden-set/
│       └── jobs/G{1..9}.json                        ← NEW (Session 11)
└── data/
    ├── Job_Application_Automator_v6.json            ← MODIFY in Session 1 (hotfix)
    └── Job_Application_Automator_v7lite_stage{N}.json ← NEW snapshots (Sessions 6–10)
```

---

# PHASE A — Stage 0 Hotfix

## - [ ] Session 1 — Empty-body guard + v6 Tailor language rule

**Spec sections:** §10.1 row "Stage 0", §8 item 1, §3.4 "TRANSLATION CONSISTENCY"
**Outcome:** v6 ships; soak begins.

### Bootstrap prompt for fresh session

```
I'm continuing the pipeline-quality-overhaul implementation plan at:
docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md

Please open that file, find "Session 1 — Empty-body guard + v6 Tailor language rule",
and execute every step in order. Read only:
  - docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md (this session only)
  - src/server.js
  - src/mergeCoverLetter.js
  - tests/validatePatch.test.js (for test style)

Do NOT read the full spec or other plan sessions. Stop at the commit step and ask me
to confirm the n8n prompt edit before marking the task complete.
```

### Files

- Modify: `src/server.js` (add empty-body guard inside `POST /generate-coverletter` handler, around line 174)
- Create: `tests/coverletterEmptyBody.test.js`
- Modify: `data/Job_Application_Automator_v6.json` — node `13a. Build Tailor Prompt` (add language-consistency rule to system prompt). Manual edit in n8n UI also acceptable; capture the change here for traceability.

### Steps

- [ ] **Step 1.1: Write failing test for empty-body guard**

Create `tests/coverletterEmptyBody.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

// Helper that mirrors src/server.js stripHtml
function stripHtml(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function isEmptyBody({ paragraph1 = "", paragraph2 = "", paragraph3 = "" }) {
  return stripHtml(paragraph1 + paragraph2 + paragraph3).length === 0;
}

test("all three paragraphs empty → empty body", () => {
  assert.equal(isEmptyBody({}), true);
  assert.equal(isEmptyBody({ paragraph1: "", paragraph2: "", paragraph3: "" }), true);
});

test("only HTML tags, no text → empty body", () => {
  assert.equal(isEmptyBody({ paragraph1: "<p></p>", paragraph2: "<p>   </p>", paragraph3: "<br/>" }), true);
});

test("any non-empty paragraph → not empty body", () => {
  assert.equal(isEmptyBody({ paragraph1: "Hello" }), false);
  assert.equal(isEmptyBody({ paragraph2: "<p>Hi</p>" }), false);
});
```

- [ ] **Step 1.2: Run the test to confirm it passes (sanity check on the helper)**

Run: `node --test tests/coverletterEmptyBody.test.js`
Expected: 3 tests pass. (This is a pure-function sanity check; we wire it into the server next.)

- [ ] **Step 1.3: Add the empty-body guard to `src/server.js`**

Find the handler `app.post("/generate-coverletter", ...)` near line 174. Insert immediately after the destructuring `const { company, role, jobId } = req.body;`:

```js
const { paragraph1 = "", paragraph2 = "", paragraph3 = "" } = req.body;
const bodyText = stripHtml(paragraph1 + paragraph2 + paragraph3);
if (bodyText.length === 0) {
  console.error("[/generate-coverletter] Empty body rejected for", company, role);
  return res.status(422).json({
    success: false,
    error: "Empty cover letter body",
    reason_code: "EMPTY_BODY",
  });
}
```

- [ ] **Step 1.4: Add a server-level integration test using a real HTTP call (smoke)**

Append to `tests/coverletterEmptyBody.test.js`:

```js
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

test("POST /generate-coverletter with empty paragraphs returns 422 EMPTY_BODY", async () => {
  const server = spawn("node", ["src/server.js"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    // wait for "Server running on port 3000"
    let started = false;
    server.stdout.on("data", (d) => { if (String(d).includes("Server running")) started = true; });
    for (let i = 0; i < 30 && !started; i++) await sleep(250);
    assert.ok(started, "server failed to start");

    const res = await fetch("http://localhost:3000/generate-coverletter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        company: "Test Co",
        role: "Test Role",
        paragraph1: "<p></p>",
        paragraph2: "",
        paragraph3: "<br/>",
      }),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.reason_code, "EMPTY_BODY");
  } finally {
    server.kill();
  }
});
```

- [ ] **Step 1.5: Run the integration test**

Run: `node --test tests/coverletterEmptyBody.test.js`
Expected: 4 tests pass (including the HTTP one). If port 3000 is in use, kill the existing server first.

- [ ] **Step 1.6: Add the test to `package.json`**

In `package.json` change `test:unit` to:

```json
"test:unit": "node --test tests/validatePatch.test.js tests/coverletterEmptyBody.test.js"
```

Run: `npm run test:unit` — expected: all tests pass.

- [ ] **Step 1.7: Patch v6 Tailor prompt with language-consistency rule**

In `data/Job_Application_Automator_v6.json` find node `13a. Build Tailor Prompt`. Add the following block to the system prompt **above** the schema description (or paste at end of style guide section — exact placement preserves existing rules):

```
TRANSLATION CONSISTENCY (HARD RULE — overrides any other rule):
- The cover letter language is detected from the JD. Treat that language as authoritative.
- Every work bullet, every project description, the profile paragraph, and ALL THREE
  cover-letter paragraphs MUST be in that language.
- "Preserve the evidence" means keep the FACT, NUMBERS, and IMPACT — translate the
  English wording into the target language. Do NOT leave English sentences in a German
  resume or vice versa.
- If you are uncertain, default to German.
```

If you prefer to edit in n8n UI: open the workflow, edit node `13a. Build Tailor Prompt`, paste the block, save, then **export** the workflow JSON and overwrite `data/Job_Application_Automator_v6.json` so source control reflects truth.

- [ ] **Step 1.8: Manual smoke run on one job**

Run one job through the v6 pipeline against a German JD. Confirm:
- Generated PDF body is non-empty
- Work/project bullets are in German (no English residue)

If either fails, debug before committing.

- [ ] **Step 1.9: Commit**

```bash
git add src/server.js tests/coverletterEmptyBody.test.js package.json data/Job_Application_Automator_v6.json
git commit -m "feat(hotfix): empty-body guard + DE language rule (Stage 0)

- POST /generate-coverletter rejects requests with no body text (HTTP 422,
  reason_code: EMPTY_BODY) — closes 2026-04-18 C2 (CLARK Holding, apaleo)
- v6 Tailor system prompt: TRANSLATION CONSISTENCY hard rule — closes
  2026-04-18 C1 (50% German resumes had English bullets)
- Stage 0 of the v7-lite plan; soak 14-30 days before deciding on full rebuild"
```

- [ ] **Step 1.10: SOAK CHECKPOINT — DO NOT proceed to Phase B yet.**

Update `MEMORY.md` (project_state.md) noting Stage 0 is shipped and the soak window started today. Do not start Session 2 until either:
- 14–30 days elapse with **0 Recruiter Replies** → proceed to Phase B
- ≥1 Recruiter Reply → **STOP**; v7-lite is descoped per spec §G5/§10.5

---

# PHASE B — Foundations

## - [ ] Session 2 — Base resume audit

**Spec section:** §5 (entire). Outcome: audit doc + a list of approved edits to apply in Session 3.

### Bootstrap prompt for fresh session

```
I'm continuing the pipeline-quality-overhaul plan. Please run Session 2 — Base
resume audit — from:
docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md

Read only:
  - That session in the plan
  - data/resume.json
  - docs/superpowers/specs/2026-04-19-pipeline-quality-overhaul-design.md §5

Produce the audit document. Then STOP and wait for me to mark each item
Approve/Edit/Reject before any data/resume.json changes.
```

### Files

- Create: `docs/superpowers/evaluations/YYYY-MM-DD-base-resume-audit.md` (use today's date)

### Steps

- [ ] **Step 2.1: Read `data/resume.json` end-to-end.** Hold every entry in mind: profile paragraph, both work entries, all 8 projects, education, certificates, all 6 skill groups, languages.

- [ ] **Step 2.2: Draft the audit doc with all 10 sections from spec §5.3:**

  1. Health score (1–10) + summary rationale
  2. Profile paragraph — opener strength, metric presence, specificity. **Plus DE-recruiter skim fields:** Aufenthaltstitel/visa status, Deutschkenntnisse level, immediate availability
  3. Work entries — per-bullet: metric presence, verb-led, passive-voice flags, impact-first
  4. Projects — per-description: impact-first, tech stack concise, URLs present
  5. Skills — ordering recommendation (proposed default: Salesforce → Backend → Frontend → Cloud → Automation → Languages); keyword density per group
  6. Education — date format, stale coursework
  7. Certificates — currency, deprecated certs
  8. Missing content opportunities — metric injections suggested
  9. **Crown-jewel bullets** — ranked top 3–5 across all sections (these get pinned in Tailor system prompt later)
  10. **Positioning coherence check** — does "Salesforce Developer + 2 yrs paid + Werkstudent/internship" read coherent to a DE recruiter? Flag if not

  Use checkbox per item: `- [ ] Approve` `- [ ] Edit:` `- [ ] Reject`. Make each item independently actionable.

- [ ] **Step 2.3: Write a "Summary of recommended edits" section** at the end of the doc. List, in order of importance, the edits Karan needs to decide on. Each entry: file path + JSON path + before/after.

- [ ] **Step 2.4: STOP.** Do not edit `data/resume.json`. Output the audit doc path and ask Karan to mark Approve/Edit/Reject per item.

- [ ] **Step 2.5: Commit (audit only, no resume edits)**

```bash
git add docs/superpowers/evaluations/*-base-resume-audit.md
git commit -m "docs(audit): base resume audit for v7-lite Stage 1"
```

---

## - [ ] Session 3 — Apply approved audit edits to resume.json

**Depends on:** Session 2 reviewed by Karan; approved edits list ready.

### Bootstrap prompt for fresh session

```
Run Session 3 of:
docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md

The audit doc with my Approve/Edit/Reject markings is at:
  docs/superpowers/evaluations/<DATE>-base-resume-audit.md

Read only:
  - The audit doc
  - data/resume.json
  - That plan session

Apply ONLY items I marked Approve or where I wrote an Edit. Skip Rejects.
Show me the diff before committing.
```

### Files

- Modify: `data/resume.json`

### Steps

- [ ] **Step 3.1: Re-read the audit doc.** Build a list of approved + edited items with their JSON paths.

- [ ] **Step 3.2: For each approved item, apply the edit using the Edit tool.** Preserve every entry id verbatim (see CLAUDE.md "Entry ID Quick Reference"). Update `meta.updatedAt` if present.

- [ ] **Step 3.3: Validate JSON shape**

```bash
node -e "JSON.parse(require('fs').readFileSync('data/resume.json','utf8')); console.log('ok')"
```

Expected output: `ok`

- [ ] **Step 3.4: Run the existing context endpoint smoke**

```bash
node src/server.js &  # background; wait 2s
sleep 2
curl -s http://localhost:3000/context | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{const j=JSON.parse(s); console.log('skills:', j.currentSkills.length, 'work:', j.currentWork.length, 'projects:', j.currentProjects.length)})"
```

Expected: `skills: 6 work: 2 projects: 8`. Then `kill %1`.

- [ ] **Step 3.5: Run npm run test:unit** — must still pass (no schema regressions).

- [ ] **Step 3.6: Show diff and ask for confirmation**

```bash
git diff data/resume.json
```

- [ ] **Step 3.7: Commit**

```bash
git add data/resume.json
git commit -m "chore(resume): apply audit edits from Stage 1"
```

---

## - [ ] Session 4 — Banned-phrases + style guides + exemplars

**Spec sections:** §6.1, §6.2, §6.3
**Outcome:** All 7 content files (1 JSON + 2 style guides + 4 exemplars) drafted and approved by Karan.

### Bootstrap prompt for fresh session

```
Run Session 4 of:
docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md

Read only:
  - That session in the plan
  - docs/superpowers/specs/2026-04-19-pipeline-quality-overhaul-design.md §6
  - data/resume.json (so exemplars match my actual experience)

Draft all 7 files in one batch. After writing, present each file as a diff and
ask me to approve/edit before committing. Do NOT commit until I confirm all 7.
```

### Files

- Create: `data/banned-phrases.json`
- Create: `data/styleguide/de.md`
- Create: `data/styleguide/en.md`
- Create: `data/exemplars/de/formal.md`
- Create: `data/exemplars/de/semi_formal.md`
- Create: `data/exemplars/en/formal.md`
- Create: `data/exemplars/en/semi_formal.md`

### Steps

- [ ] **Step 4.1: Create directory tree**

```bash
mkdir -p data/styleguide data/exemplars/de data/exemplars/en
```

- [ ] **Step 4.2: Write `data/banned-phrases.json`** (literal content from spec §6.3):

```json
{
  "de": {
    "exact": ["Hochmotiviert", "Mit großem Interesse", "bewerbe mich hiermit", "leidenschaftlich", "Leidenschaft"],
    "regex": ["\\bbringe ich\\b.*Erfahrung"]
  },
  "en": {
    "exact": ["I am writing to apply", "passionate", "I would like to apply", "excited to contribute"],
    "regex": ["\\bresults-?driven\\b", "\\bself-?starter\\b"]
  },
  "universal": {
    "exact": ["—", "–", "−"]
  }
}
```

- [ ] **Step 4.3: Draft `data/styleguide/de.md`** — ~600 words covering:
  - Tone/register by company type (DAX/Mittelstand/Startup)
  - Anschreiben paragraph structure: P1 hook → P2 evidence → P3 CTA
  - Target word counts: P1 60–80, P2 100–140, P3 50–70
  - Sentence structures to prefer (Verb-second, active voice, present-perfect for past achievements)
  - Things to avoid (`Hochmotiviert`-style filler, em-dashes, English idioms)
  - Cultural norms: Du/Sie usage, formality of greeting

- [ ] **Step 4.4: Draft `data/styleguide/en.md`** — ~600 words mirror of DE guide for UK/US registers.

- [ ] **Step 4.5: Draft 4 exemplars** — each ~400 words, complete 3-paragraph cover letter for a hypothetical Salesforce Developer role at a representative German employer:
  - `data/exemplars/de/formal.md` — DAX/enterprise tone (e.g., "SAP SE")
  - `data/exemplars/de/semi_formal.md` — Mittelstand/scaleup tone (e.g., "Personio")
  - `data/exemplars/en/formal.md` — UK/US enterprise tone
  - `data/exemplars/en/semi_formal.md` — startup tone

  Each exemplar must:
  - Use Karan's actual experience (MV Clouds, AppExchange package, aerospace consulting) — pull from `data/resume.json`
  - Show varied openings (NOT "Die [Noun]" pattern in DE — that was the C3 model tic)
  - Avoid every banned phrase from §6.3
  - Use no em-dashes

- [ ] **Step 4.6: Self-check pass** — for each file, grep against the banned-phrases JSON. None of the exact-list strings should appear in any exemplar.

```bash
node -e "
const b = JSON.parse(require('fs').readFileSync('data/banned-phrases.json','utf8'));
const fs = require('fs');
const files = ['data/exemplars/de/formal.md','data/exemplars/de/semi_formal.md','data/exemplars/en/formal.md','data/exemplars/en/semi_formal.md'];
for (const f of files) {
  const txt = fs.readFileSync(f,'utf8');
  for (const lang of ['de','en','universal']) {
    for (const phrase of (b[lang].exact || [])) {
      if (txt.toLowerCase().includes(phrase.toLowerCase())) console.log('HIT', f, '->', phrase);
    }
  }
}
console.log('check done');
"
```

Expected: only `check done` (no `HIT` lines).

- [ ] **Step 4.7: Present each file to Karan for approval.** Iterate per file as feedback comes back.

- [ ] **Step 4.8: Commit** (single commit, after all 7 approved)

```bash
git add data/banned-phrases.json data/styleguide data/exemplars
git commit -m "feat(content): banned phrases + style guides + 4 exemplars (Stage 2)"
```

---

## - [ ] Session 5 — `POST /validate` endpoint + 8 deterministic checks

**Spec sections:** §3.5.2 (the 8 checks), §8 item 2
**Outcome:** Express server gains `/validate`; `validatePatch.js` extended; 2 new test files green.

### Bootstrap prompt for fresh session

```
Run Session 5 of:
docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md

Read only:
  - That session in the plan
  - docs/superpowers/specs/2026-04-19-pipeline-quality-overhaul-design.md §3.5
  - src/validatePatch.js  (current shape)
  - src/server.js
  - tests/validatePatch.test.js  (style reference)
  - data/banned-phrases.json

Implement strict TDD: failing test → implementation → passing test, one check at a time.
Commit after each check that passes (so 8 commits + 1 endpoint commit + 1 wiring commit).
```

### Files

- Modify: `src/validatePatch.js` — add `runValidator(tailor_output, plan)` exported function
- Modify: `src/server.js` — add `app.post("/validate", ...)`
- Create: `tests/bannedPhrases.test.js`
- Modify: `tests/validatePatch.test.js` — add tests for `runValidator()`
- Modify: `package.json` — extend `test:unit`

### Steps

- [ ] **Step 5.1: Sketch `runValidator(tailor_output, plan)` signature.** Returns `{ validator_ok, validator_fails: [{reason_code, detail}], verdict }`. `verdict` is `"ship"` if no fails, else `"revise"` (the retry controller upgrades to `"review"` on pass 2 failure).

- [ ] **Step 5.2: TDD Check #1 — SCHEMA_INVALID**

Add to `tests/validatePatch.test.js`:

```js
import { runValidator } from "../src/validatePatch.js";

const validPlan = { language_decision: { value: "de" }, ranked_requirements: [], must_use_keywords: [], company_hooks: [], requirement_coverage_target: 80 };
const validTailor = { jobTitle: "Dev", language: "de", patch: { skills: makeAll6Skills() }, paragraph1: "<p>"+("a".repeat(120))+"</p>", paragraph2: "<p>"+("b".repeat(120))+"</p>", paragraph3: "<p>"+("c".repeat(120))+"</p>" };

test("SCHEMA_INVALID when patch missing", () => {
  const r = runValidator({}, validPlan);
  assert.ok(r.validator_fails.some(f => f.reason_code === "SCHEMA_INVALID"));
});
```

(Helper `makeAll6Skills()`: returns array of 6 objects with the 6 IDs from CLAUDE.md.)

Run, confirm fail, implement Check #1 in `runValidator`, run, confirm pass.

- [ ] **Step 5.3: Commit Check #1** — `git commit -m "feat(validator): add SCHEMA_INVALID check"`

- [ ] **Step 5.4: TDD Check #2 — EMPTY_BODY**

Test: paragraph with `<p></p>` only → `EMPTY_BODY`. Threshold: stripped-trimmed length < 120.

Implement using `stripHtml` (copy from `src/server.js` or import). Commit.

- [ ] **Step 5.5: TDD Check #3 — SKILLS_MALFORMED**

The 6 valid IDs from CLAUDE.md:

```js
const VALID_SKILL_IDS = new Set([
  "7e0af879-e5a3-457e-ab86-634363abf266",
  "4e5c9b0d-2b32-48a6-9b61-0c320df13632",
  "b38fcbc7-ae5a-41f8-87c3-8e1fd55a8445",
  "c7231132-d4b1-47eb-9bee-a66c7756ce1d",
  "9a905d12-825c-4090-a90c-3ff010a9d8b4",
  "07d4ce0e-0dcf-4193-8425-06a3e01fe20c",
]);
```

Fail if `patch.skills.length !== 6` or any id missing/extra. Test both cases. Commit.

- [ ] **Step 5.6: TDD Check #4 — UNKNOWN_ID**

Reuse `VALID_WORK_IDS` and `VALID_PROJECT_IDS` from existing `validatePatch.js`. Fail if any `patch.work[].id` or `patch.projects[].id` not in those sets. Test + commit.

- [ ] **Step 5.7: TDD Check #5 — LANGUAGE_TOKEN_MISMATCH**

Fail if `tailor_output.language` ∉ `{"de","en"}` or doesn't equal `plan.language_decision.value`. Test + commit.

- [ ] **Step 5.8: TDD Check #6 — BANNED_PHRASE (the regex-bypass surface)**

Create `tests/bannedPhrases.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { findBannedPhrases } from "../src/validatePatch.js";

test("exact match: Hochmotiviert in DE letter", () => {
  const hits = findBannedPhrases("Ich bin hochmotiviert für diese Stelle.", "de");
  assert.ok(hits.length > 0);
});

test("case-insensitive: HOCHMOTIVIERT matches", () => {
  const hits = findBannedPhrases("HOCHMOTIVIERT", "de");
  assert.ok(hits.length > 0);
});

test("NFKC normalization: full-width chars match", () => {
  // Full-width Latin "passionate" → ASCII "passionate"
  const hits = findBannedPhrases("Ｉ ａｍ passionate", "en");
  assert.ok(hits.length > 0);
});

test("word boundary: 'Salesforce-Leidenschaft' should NOT match 'Leidenschaft' as bare word", () => {
  // Per spec §3.5.2 banned-phrase rules: word-boundary aware
  const hits = findBannedPhrases("Salesforce-Leidenschaft", "de");
  assert.equal(hits.length, 0, "compound with hyphen does not trigger bare-word banned phrase");
});

test("em-dash universal hit", () => {
  const hits = findBannedPhrases("Some — text", "de");
  assert.ok(hits.some(h => h.phrase === "—"));
});

test("regex match: 'results-driven' and 'results driven' both hit", () => {
  assert.ok(findBannedPhrases("I am results-driven", "en").length > 0);
  assert.ok(findBannedPhrases("I am results driven", "en").length > 0);
});
```

Implement `findBannedPhrases(text, language)` in `validatePatch.js`:

```js
import bannedConfig from "../data/banned-phrases.json" with { type: "json" };

function nfkc(s) { return s.normalize("NFKC"); }

function escapeForRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function findBannedPhrases(text, language) {
  const norm = nfkc(text);
  const hits = [];
  const sources = [bannedConfig[language] || {}, bannedConfig.universal || {}];
  for (const src of sources) {
    for (const phrase of (src.exact || [])) {
      // Word-boundary aware for alphanumeric phrases; raw substring for symbols (em-dash etc.)
      const isAlphanumeric = /^[\p{L}\p{N} ]+$/u.test(phrase);
      const re = isAlphanumeric
        ? new RegExp(`\\b${escapeForRegex(phrase)}\\b`, "iu")
        : new RegExp(escapeForRegex(phrase), "u");
      if (re.test(norm)) hits.push({ phrase, kind: "exact" });
    }
    for (const pattern of (src.regex || [])) {
      if (new RegExp(pattern, "iu").test(norm)) hits.push({ phrase: pattern, kind: "regex" });
    }
  }
  return hits;
}
```

Wire into Check #6: scan `paragraph1+2+3` and all `patch.work[].description` and `patch.projects[].description`. Run all banned-phrase tests + the validator test. Commit.

- [ ] **Step 5.9: TDD Check #7 — LANGUAGE_SNIFF**

For DE letters only, fail if the body (paragraphs only, NOT company name) contains any of: `"I am "`, `"Dear Hiring"`, `"Kind regards"` (case-insensitive). Test that English company names embedded in DE letters do NOT false-trigger. Commit.

- [ ] **Step 5.10: TDD Check #8 — LOW_REQUIREMENT_COVERAGE**

Iterate `plan.ranked_requirements[]` filtered by `weight >= 0.7`. For each, search the union of work/project descriptions + P1+P2+P3 (case-insensitive) for the `keyword` or any `keyword_synonyms[]`. Coverage = covered/total. Fail if `< plan.requirement_coverage_target`.

Test cases:
- All requirements covered → no fail
- 1 of 3 missing, target 80% → fail (33% < 80%)
- Synonym present but not main keyword → no fail

Commit.

- [ ] **Step 5.11: Wire `POST /validate` endpoint into `src/server.js`**

```js
app.post("/validate", (req, res) => {
  const { tailor_output, plan } = req.body || {};
  if (!tailor_output || !plan) {
    return res.status(400).json({ error: "tailor_output and plan are required" });
  }
  const result = runValidator(tailor_output, plan);
  res.json(result);
});
```

Add HTTP smoke test to `tests/coverletterEmptyBody.test.js` style: spin up the server, POST a known-bad tailor_output, expect `validator_ok: false`. Commit.

- [ ] **Step 5.12: Update `package.json` `test:unit`**

```json
"test:unit": "node --test tests/validatePatch.test.js tests/coverletterEmptyBody.test.js tests/bannedPhrases.test.js"
```

Run `npm run test:unit` — expect all green.

- [ ] **Step 5.13: Final commit (wiring)**

```bash
git add src/server.js src/validatePatch.js tests/ package.json
git commit -m "feat(server): POST /validate endpoint wires runValidator() (Stage 1)"
```

---

# PHASE C — Pipeline (n8n + LLM stages)

## - [ ] Session 6 — Node 4 upgrade: companyData preservation

**Spec section:** §1.1
**Outcome:** Each downstream item carries a `companyData` object; nothing else changes yet.

### Bootstrap prompt for fresh session

```
Run Session 6 of:
docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md

Read only:
  - That session in the plan
  - docs/superpowers/specs/2026-04-19-pipeline-quality-overhaul-design.md §1.1
  - data/Job_Application_Automator_v6.json — node "4. Normalize & Merge Jobs"

Output the new BOARD_CONFIG mapping as JS code I can paste into the n8n Code node.
Then snapshot the workflow as data/Job_Application_Automator_v7lite_stage6.json.
```

### Files

- Modify: `data/Job_Application_Automator_v6.json` (in n8n UI, then export)
- Create: `data/Job_Application_Automator_v7lite_stage6.json` (snapshot)
- Create: `tests/companyData.test.js`

### Steps

- [ ] **Step 6.1: Read existing `BOARD_CONFIG`** from node 4 in v6 workflow JSON. Identify the field-mapping object per board.

- [ ] **Step 6.2: Extend each board's mapping** to populate the unified `companyData` object per spec §1.1 table. For each board, add a `companyData: { name, domain, website, address, hq_location, size_category, employee_count, year_founded, revenue_bracket, industry, rating, tech_attributes, company_profile_urls, keywords, _sources_present }` builder. Missing fields → `null`.

- [ ] **Step 6.3: Write a pure-JS extraction test** (the n8n Code node logic, mirrored as a node module for testability):

Create `tests/companyData.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCompanyData } from "./fixtures/buildCompanyData.js";

test("StepStone payload maps name + website + address", () => {
  const sample = { _source: "stepstone", company_details: { company_name: "SAP SE", company_website: "https://sap.com", company_address: "Walldorf" } };
  const cd = buildCompanyData(sample);
  assert.equal(cd.name, "SAP SE");
  assert.equal(cd.website, "https://sap.com");
  assert.equal(cd.hq_location, "Walldorf");
});

test("Glassdoor payload maps tech_attributes", () => {
  const sample = { _source: "glassdoor", company: { companyName: "Personio", companySizeCategory: "MEDIUM" }, attributes: ["Java", "AWS"] };
  const cd = buildCompanyData(sample);
  assert.deepEqual(cd.tech_attributes, ["Java", "AWS"]);
  assert.equal(cd.size_category, "MEDIUM");
});

test("missing fields become null, not undefined", () => {
  const cd = buildCompanyData({ _source: "indeed", employer: { name: "X" } });
  assert.equal(cd.industry, null);
  assert.equal(cd.address, null);
});
```

Create `tests/fixtures/buildCompanyData.js` extracting just the `buildCompanyData(itemFromOneScraper)` function so it can be unit-tested without n8n. Mirror the same code into the n8n Code node body.

- [ ] **Step 6.4: Iterate test/code until all pass.**

- [ ] **Step 6.5: Update node 4 in n8n UI**, paste the new logic, run the workflow once with one job to confirm `companyData` flows downstream (inspect node 9 input).

- [ ] **Step 6.6: Snapshot the workflow** — in n8n, export workflow JSON to `data/Job_Application_Automator_v7lite_stage6.json`. Also update `data/Job_Application_Automator_v6.json` if you want the upgraded baseline tracked.

- [ ] **Step 6.7: Commit**

```bash
git add tests/companyData.test.js tests/fixtures/buildCompanyData.js data/Job_Application_Automator_v7lite_stage6.json
git commit -m "feat(node4): companyData unified from 5 scrapers (Stage 4)"
```

---

## - [ ] Session 7 — Planner node (Sonnet 4.6)

**Spec section:** §2 (entire), §11.2 retry policy
**Outcome:** New n8n HTTP node calls Sonnet 4.6 with `companyData + JD + base_resume` → returns the full `plan` JSON; downstream nodes can consume it.

### Bootstrap prompt for fresh session

```
Run Session 7 of:
docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md

Read only:
  - That session in the plan
  - docs/superpowers/specs/2026-04-19-pipeline-quality-overhaul-design.md §2
  - The Planner output schema (in §2.3 of the spec) — copy exactly

Produce:
  1. Full Planner system prompt (markdown text I paste into n8n)
  2. Full HTTP node config for OpenRouter Sonnet 4.6
  3. tests/planSchema.test.js validating Planner output shape

Reference Anthropic SDK docs for tool-use JSON output.
```

### Files

- Modify: `data/Job_Application_Automator_v7lite_stage6.json` → save as `_stage7.json` after edits
- Create: `tests/planSchema.test.js`
- Create: `data/prompts/planner-system.md` (source-of-truth for the Planner prompt; pasted into n8n)

### Steps

- [ ] **Step 7.1: Draft `data/prompts/planner-system.md`** — the full system prompt. Include:
  - Role: "You are a planning agent for a job-application pipeline."
  - The full output schema from spec §2.3 as a JSON example
  - Instruction: "company_hooks must be drawn ONLY from string fields in companyData. Quote them verbatim."
  - Instruction: "language_decision is authoritative — choose 'de' or 'en' based on JD vocabulary share"
  - Instruction: "If base-resume evidence is sparse for a high-weight requirement, lower requirement_coverage_target to 75 and set plan_confidence=medium"
  - Instruction: "Set plan_confidence=low to skip the Tailor and route directly to review"
  - Strict JSON output via tool definition

- [ ] **Step 7.2: TDD `tests/planSchema.test.js`** — schema assertions:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlan } from "../src/validatePlan.js";

test("valid plan passes", () => {
  const plan = {
    language_decision: { value: "de", reason: "..." },
    role_classification: { type: "salesforce", justification: "..." },
    ranked_requirements: [{ rank: 1, requirement: "...", keyword: "Apex", keyword_synonyms: [], weight: 0.9, kind: "hard" }],
    evidence_mapping: [],
    story_angles: [],
    must_use_keywords: ["Apex"],
    company_hooks: [],
    tone_profile: { register: "formal", rationale: "..." },
    show_certificates: true,
    show_projects: true,
    risks_to_avoid: [],
    requirement_coverage_target: 80,
    plan_confidence: "high",
  };
  const r = validatePlan(plan);
  assert.equal(r.valid, true);
});

test("missing language_decision → invalid", () => { /* ... */ });
test("language_decision.value not in {de,en} → invalid", () => { /* ... */ });
test("requirement_coverage_target outside 0..100 → invalid", () => { /* ... */ });
test("plan_confidence='low' is allowed and signals skip-tailor", () => { /* ... */ });
```

Create `src/validatePlan.js` with `export function validatePlan(plan)` returning `{ valid, errors }`.

- [ ] **Step 7.3: Configure n8n nodes**

In n8n, after node 9 (Loop Over Items) and before the existing Tailor node:
1. Add HTTP node `13a-pre. Build Plan` — POSTs to OpenRouter `/api/v1/chat/completions`, model `anthropic/claude-sonnet-4.5` (or current Sonnet 4.6 ID per OpenRouter — verify before paste), system = contents of `data/prompts/planner-system.md`, user = JD + companyData + base_resume context, tool definition for strict JSON.
2. Add Code node `13a-pre.1. Parse Plan` — runs `validatePlan()` logic; on parse failure, retry once; on second failure, set `_planFailed: true`.
3. Add IF node `13a-pre.2. Plan OK?` — routes `_planFailed` items to a new "Skip with PLAN_FAILED" branch that logs to review queue (Session 10).

- [ ] **Step 7.4: Test against one JD end-to-end** (don't ship a PDF yet — the Tailor still uses the old prompt). Inspect the plan JSON.

- [ ] **Step 7.5: Snapshot workflow as `_stage7.json`. Commit.**

```bash
git add data/prompts/planner-system.md data/Job_Application_Automator_v7lite_stage7.json src/validatePlan.js tests/planSchema.test.js package.json
git commit -m "feat(planner): Planner node + schema validator (Stage 5)"
```

---

## - [ ] Session 8 — Tailor prompt rewrite + Sonnet 4.6 + cache_control

**Spec section:** §3 (all subsections)
**Outcome:** Existing `13b. OpenAI API Call` is replaced by an OpenRouter Sonnet 4.6 call. Tailor consumes the plan from Session 7 + base resume. Output schema unchanged from CLAUDE.md (still `paragraph1/2/3 + patch + language`).

### Bootstrap prompt for fresh session

```
Run Session 8 of:
docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md

Read only:
  - That session in the plan
  - docs/superpowers/specs/2026-04-19-pipeline-quality-overhaul-design.md §3
  - data/exemplars/  (all 4 files — these go in the system block)
  - data/styleguide/  (both)
  - data/banned-phrases.json
  - The Crown-Jewel Bullets section of docs/superpowers/evaluations/<DATE>-base-resume-audit.md
  - data/prompts/planner-system.md  (for output-schema continuity)

Produce data/prompts/tailor-system.md following spec §3.2 prompt architecture
exactly. Use OpenRouter cache_control breakpoint between system and user blocks.
Use Anthropic SDK conventions (see superpowers:claude-api skill if unsure).
```

### Files

- Create: `data/prompts/tailor-system.md`
- Modify: `data/Job_Application_Automator_v7lite_stage7.json` → save as `_stage8.json`

### Steps

- [ ] **Step 8.1: Use the claude-api skill** if you have any doubts about OpenRouter cache_control / tool-use shape.

- [ ] **Step 8.2: Draft `data/prompts/tailor-system.md`** with these sections in order (per spec §3.2):
  1. Role + meta-instruction
  2. Style guide — pasted in DE and EN both, with branching note at top: "Use the section matching plan.language_decision.value"
  3. Two exemplars in each language (4 total — pasted from `data/exemplars/`)
  4. Banned-phrase list (pasted from `data/banned-phrases.json`)
  5. Crown-jewel bullets (top 5 from audit)
  6. Negative exemplars (2-3 short bullets showing model tics — derived from C3 patterns: `"Die [Noun]"`-style P1 openers; identical P3 closers)
  7. Hard rules (literal copy from spec §3.4: TRANSLATION CONSISTENCY, SKILL RULES, EVIDENCE DISCIPLINE, KEYWORD COVERAGE, BANNED CONTENT)
  8. Output schema — JSON example matching spec §3.6

- [ ] **Step 8.3: Configure n8n HTTP node** to call OpenRouter:
  - Model: `anthropic/claude-sonnet-4.5` (verify exact OpenRouter ID before paste)
  - Temperature: 0.3
  - System block: contents of `data/prompts/tailor-system.md` with `cache_control: { type: "ephemeral" }` on the last system message
  - User block: `<plan>{{ $json.plan }}</plan><companyData>{{ $json.companyData }}</companyData><jd>{{ $json.jd }}</jd><base_resume>{{ $json.base_resume }}</base_resume>`
  - Tool definition for strict JSON output (Anthropic tool-use)

- [ ] **Step 8.4: Add a Code node `14. Parse Tailor Output`** that:
  - Parses the model's tool_use response into `{ jobTitle, language, patch, paragraph1, paragraph2, paragraph3, requirement_to_evidence_map, self_check }`
  - On parse failure, sets `_tailorFailed: true` for the Retry Controller (Session 9) to handle
  - This Code node REPLACES the existing `14. Parse AI Patch` for the new pipeline path

- [ ] **Step 8.5: Smoke test ONE German job end-to-end through Planner+Tailor (no PDF yet — just inspect the JSON output).** Confirm: language matches plan, all 6 skill IDs returned, 3 paragraphs all populated, no obvious tic patterns.

- [ ] **Step 8.6: Snapshot + commit**

```bash
git add data/prompts/tailor-system.md data/Job_Application_Automator_v7lite_stage8.json
git commit -m "feat(tailor): Sonnet 4.6 + cached system block + plan-driven prompt (Stage 6)"
```

---

## - [ ] Session 9 — Retry Controller (single Code node) + tests

**Spec sections:** §3.5.4, §11.3
**Outcome:** Tailor → /validate → revise (1 surgical retry) → ship/review state machine; budget caps enforced.

### Bootstrap prompt for fresh session

```
Run Session 9 of:
docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md

Read only:
  - That session in the plan
  - docs/superpowers/specs/2026-04-19-pipeline-quality-overhaul-design.md §3.5.4 and §11
  - src/validatePatch.js (specifically the runValidator export from Session 5)
  - data/prompts/tailor-system.md (so retry feedback wording matches the system prompt's vocabulary)

Implement the Retry Controller as a node-friendly module first
(src/retryController.js) so it's unit-testable, then port it verbatim into the
n8n Code node. Strict TDD per scenario in spec §3.5.4 pseudocode.
```

### Files

- Create: `src/retryController.js` — pure, testable state machine. Takes injected `tailor()` and `validate()` callbacks; returns `{ verdict, tailor_output, fails, passes_used, llm_calls_used }`.
- Create: `tests/retryController.test.js`
- Modify: n8n workflow → add Code node `13b.5 Retry Controller`. Snapshot as `_stage9.json`.

### Steps

- [ ] **Step 9.1: TDD scenario 1 — Pass-1 ship**

```js
test("validator OK on pass 1 → ship", async () => {
  const tailor = async () => ({ ok: true, output: "X" });
  const validate = async () => ({ validator_ok: true, validator_fails: [], verdict: "ship" });
  const r = await runRetry({ tailor, validate, plan: {}, jd: "" });
  assert.equal(r.verdict, "ship");
  assert.equal(r.passes_used, 1);
});
```

- [ ] **Step 9.2: TDD scenario 2 — Pass-1 fail, surgical retry succeeds**

```js
test("validator fails pass 1, succeeds pass 2 → ship", async () => {
  let calls = 0;
  const tailor = async (args) => {
    calls++;
    if (calls === 1) return { ok: true, output: "BAD" };
    // pass 2 must receive prior_draft + prior_validator_fails
    assert.equal(args.prior_draft, "BAD");
    assert.ok(args.prior_validator_fails.length > 0);
    return { ok: true, output: "GOOD" };
  };
  let vCalls = 0;
  const validate = async () => {
    vCalls++;
    return vCalls === 1
      ? { validator_ok: false, validator_fails: [{ reason_code: "EMPTY_BODY", detail: "..." }], verdict: "revise" }
      : { validator_ok: true, validator_fails: [], verdict: "ship" };
  };
  const r = await runRetry({ tailor, validate, plan: {}, jd: "" });
  assert.equal(r.verdict, "ship");
  assert.equal(r.passes_used, 2);
});
```

- [ ] **Step 9.3: TDD scenario 3 — Both passes fail → review**

```js
test("validator fails both passes → review with last reason_codes", () => { /* ... */ });
```

- [ ] **Step 9.4: TDD scenario 4 — LLM call budget exhausted**

Per spec §11.3: 10 LLM calls max per job. Test that injecting a tailor that spends 4 retries (network-layer) on pass 1 then 4 on pass 2 trips `REQUEST_BUDGET_EXHAUSTED`.

- [ ] **Step 9.5: TDD scenario 5 — Wall-clock budget**

10 minutes. Inject a clock function so tests can fast-forward.

- [ ] **Step 9.6: Implement `src/retryController.js`** following spec §3.5.4 pseudocode literally. Export `runRetry({ tailor, validate, plan, jd, base_resume, options })`.

- [ ] **Step 9.7: Run all tests** — `node --test tests/retryController.test.js`. All green.

- [ ] **Step 9.8: Port into n8n** — create Code node `13b.5 Retry Controller` whose body imports nothing (n8n's vm doesn't have npm) — copy the pure-JS implementation directly. Wire it after `14. Parse Tailor Output` from Session 8. Output items get `verdict` + `reason_codes` for downstream branching.

- [ ] **Step 9.9: Add IF node `15a-pre. Ship or Review?`** — `verdict === "ship"` → existing PDF nodes; else → new "Log to Review Queue" branch (created in Session 10).

- [ ] **Step 9.10: Snapshot + commit**

```bash
git add src/retryController.js tests/retryController.test.js data/Job_Application_Automator_v7lite_stage9.json package.json
git commit -m "feat(retry): retry controller state machine + budgets (Stage 7)"
```

---

# PHASE D — Review Queue

## - [ ] Session 10 — Review Queue tab + Approve sub-workflow with row lock

**Spec section:** §7 (entire), §10.1 Stage 8
**Outcome:** New Sheet tab; cron sub-workflow renders PDFs for approved rows; concurrent-edit race test passes.

### Bootstrap prompt for fresh session

```
Run Session 10 of:
docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md

Read only:
  - That session in the plan
  - docs/superpowers/specs/2026-04-19-pipeline-quality-overhaul-design.md §7

Produce:
  1. A markdown sheet schema doc I can copy into Google Sheets
  2. The full n8n sub-workflow JSON for "Approve Review Queue"
  3. A concurrent-edit race test plan (manual procedure)
```

### Files

- Create: `docs/superpowers/runbooks/review-queue-schema.md`
- Modify: workflow → add the Review Queue branch; create separate sub-workflow
- Create: `data/Job_Application_Automator_v7lite_ApproveQueue.json` — the new sub-workflow
- Modify main workflow → snapshot as `_stage10.json`

### Steps

- [ ] **Step 10.1: Create Sheet tab "Review Queue"** with the columns from spec §7.2 (12 columns; Status enum: `Pending / Rendering / Approved / Sent / Rejected / PDF Failed`). Document column types and validation in `review-queue-schema.md`.

- [ ] **Step 10.2: Add reason-code taxonomy reference card** to `review-queue-schema.md` from spec §7.3.

- [ ] **Step 10.3: In main workflow** — when Retry Controller verdict = `"review"`, route to a new "Log to Review Queue" Google Sheets append node. Map `reason_codes` (comma-separated), all 3 paragraphs, the resume_patch JSON, Status=`Pending`, Approve?=unchecked.

- [ ] **Step 10.4: Create new n8n workflow "Approve Review Queue"**:
  1. Trigger: cron every 5 minutes
  2. Node: Read Sheet, filter `Status === "Pending" && Approve === true`
  3. Loop over items
  4. **Atomic row-lock node:** Google Sheets `update` with conditional — only if current Status cell value === `"Pending"`, set to `"Rendering"`. If pre-condition fails, the loop iteration short-circuits (skip; another cron run handles it).
  5. POST `/generate-resume` with the (possibly user-edited) patch
  6. POST `/generate-coverletter` with the 3 paragraphs
  7. On both success: update row Status=`Sent`, write file paths; append to main tracker with Status `Reviewed & Sent`
  8. On any failure: update row Status=`PDF Failed`, log error in Notes

- [ ] **Step 10.5: Document concurrent-edit race test** in `review-queue-schema.md`:
  - Manually start two cron runs back-to-back (60s apart) on a single Pending row
  - Expected: the second run sees `Status="Rendering"` and skips
  - Expected: only one PDF pair generated
  - Run the test, record outcome

- [ ] **Step 10.6: Run end-to-end with one manually-flagged review row** to confirm the user can edit P2 in the sheet, check Approve, and within 5 minutes get a PDF pair.

- [ ] **Step 10.7: Snapshot both workflows + commit**

```bash
git add docs/superpowers/runbooks/review-queue-schema.md data/Job_Application_Automator_v7lite_stage10.json data/Job_Application_Automator_v7lite_ApproveQueue.json
git commit -m "feat(review-queue): Pending→Rendering atomic lock + cron sub-workflow (Stage 8)"
```

---

# PHASE E — Validation

## - [ ] Session 11 — Golden set (9 jobs) + iteration

**Spec section:** §10.3
**Outcome:** All 9 golden jobs produce user-signable output through the full pipeline.

### Bootstrap prompt for fresh session

```
Run Session 11 of:
docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md

Read only:
  - That session in the plan
  - docs/superpowers/specs/2026-04-19-pipeline-quality-overhaul-design.md §10.3

The 4 regression cases (G6-G9) are sourced from the 2026-04-18 batch — pull
the JDs from output/2026-04-18/ if available, else stub from
docs/superpowers/evaluations/2026-04-18-run-quality-review.md.

Process: run → inspect → tune (prompt files in data/prompts/) → re-run.
Loop until all 9 pass; commit per iteration so we can bisect tuning regressions.
```

### Files

- Create: `docs/superpowers/golden-set/jobs/G1.json` … `G9.json` (the 9 JD payloads matching spec §10.3 table)
- Create: `docs/superpowers/golden-set/run.md` — manual run procedure + checklist
- Create: `docs/superpowers/golden-set/results-YYYY-MM-DD.md` — per-iteration results

### Steps

- [ ] **Step 11.1: Build the 9 golden JD fixtures.**
- [ ] **Step 11.2: For each, run end-to-end (use the n8n manual trigger with one item).** Inspect output PDF + plan JSON + validator output.
- [ ] **Step 11.3: Per-job checklist:** language matches plan? skills all 6 in correct order? P1/P2/P3 non-empty? banned-phrase clean? requirement-coverage ≥80%?
- [ ] **Step 11.4: For G6–G9 specifically — confirm the regressions don't recur** (DE bullets in DE resume; non-empty letter; varied P1 opener).
- [ ] **Step 11.5: When a job fails, tune the relevant `data/prompts/*.md` file, commit the prompt change, re-run only that job.**
- [ ] **Step 11.6: When all 9 pass, commit the final results doc.**

```bash
git add docs/superpowers/golden-set
git commit -m "test(golden-set): 9/9 golden jobs pass v7-lite (Stage 10)"
```

---

## - [ ] Session 12 — Shadow evaluation (20 historical jobs)

**Spec section:** §10.4
**Outcome:** v7-lite wins on ≥80% of 20 shadow jobs vs v6+hotfix; otherwise iterate.

### Bootstrap prompt for fresh session

```
Run Session 12 of:
docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md

Read only:
  - That session in the plan
  - docs/superpowers/specs/2026-04-19-pipeline-quality-overhaul-design.md §10.4

I'll provide 20 matched jobs from a recent Get_an_execution.json export.
Run them through v7-lite WITHOUT writing PDFs or sheet rows. Compare per job
on the 3 axes in §10.4 against v6+hotfix output. Bar: v7-lite wins on ≥80%.
```

### Files

- Create: `docs/superpowers/evaluations/YYYY-MM-DD-v7lite-shadow-eval.md`
- Create: `scripts/run-shadow-eval.js` — driver that calls Planner+Tailor+/validate without rendering or sheet writes

### Steps

- [ ] **Step 12.1: Write `scripts/run-shadow-eval.js`** — takes a JSON file of 20 jobs, runs each through Planner → Tailor → /validate, writes JSONL to `output/shadow-eval-YYYY-MM-DD.jsonl`. Skips PDF rendering and Sheet writes.

- [ ] **Step 12.2: Pull 20 jobs from a recent execution** into `docs/superpowers/golden-set/shadow-input.json`.

- [ ] **Step 12.3: Run the shadow eval.** Cost budget: ~$0.88 per run (per spec §10.4).

- [ ] **Step 12.4: Score each job 3-axis** (language consistency, requirement coverage, banned-phrase hits) vs the v6+hotfix output for the same JD if you have it; otherwise score absolute thresholds.

- [ ] **Step 12.5: Write the eval doc** with per-job table + summary.

- [ ] **Step 12.6: If <80% wins, iterate prompts** (use spend-iteration budget of 5 runs per spec §10.4). Otherwise proceed.

- [ ] **Step 12.7: Commit**

```bash
git add docs/superpowers/evaluations/*-v7lite-shadow-eval.md scripts/run-shadow-eval.js docs/superpowers/golden-set/shadow-input.json
git commit -m "test(shadow): v7-lite shadow eval on 20 jobs (Stage 10.5)"
```

---

## - [ ] Session 13 — Live 5-job → 25-job batch + observability bring-up

**Spec sections:** §10.1 Stages 11/12, §12 entire
**Outcome:** Live batches green; pipeline.jsonl logging in place; weekly KPI digest started.

### Bootstrap prompt for fresh session

```
Run Session 13 of:
docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md

Read only:
  - That session in the plan
  - docs/superpowers/specs/2026-04-19-pipeline-quality-overhaul-design.md §12

Tasks: instrument JSONL logging in Express (server-side stages) and in the n8n
Code nodes (LLM stages); run a live 5-job batch; gate on ship-rate ≥50%; if green
run a 25-job batch; gate on ship-rate ≥70% and 0 hard-fails in shipped output.
Halt and rollback on any breach.
```

### Files

- Modify: `src/server.js` — append JSONL log per request to `output/YYYY-MM-DD/Logs/pipeline.jsonl`
- Modify: n8n Planner / Tailor / Retry Controller code nodes — append JSONL via the same file path (use `host.docker.internal`-mounted path or via a new `POST /log` endpoint to keep filesystem in Express)
- Create: `docs/superpowers/evaluations/weekly-kpis.md` — first weekly snapshot row

### Steps

- [ ] **Step 13.1: Add JSONL logging helper to `src/server.js`** with the schema from spec §12.2.

- [ ] **Step 13.2: Add a tiny `POST /log` passthrough endpoint** so n8n nodes can log without filesystem permissions:

```js
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";

app.post("/log", (req, res) => {
  const ts = new Date();
  const dateFolder = `${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,"0")}-${String(ts.getDate()).padStart(2,"0")}`;
  const dir = resolve(OUTPUT_DIR, dateFolder, "Logs");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "pipeline.jsonl"), JSON.stringify({ ts: ts.toISOString(), ...req.body }) + "\n");
  res.json({ ok: true });
});
```

- [ ] **Step 13.3: In n8n Planner / Tailor / Retry Controller nodes**, add a final HTTP call to `POST /log` with the per-stage JSON (latency, model, tokens, cost, verdict, reason_codes).

- [ ] **Step 13.4: Run a 5-job live batch.** Gate: ship-rate ≥ 50%, review queue behaves correctly, 0 hard-fails in shipped output. **Halt and debug if any gate fails.**

- [ ] **Step 13.5: Run a 25-job live batch.** Gate: ship-rate ≥ 70%, ≤10 in review queue, 0 hard-fails in shipped output.

- [ ] **Step 13.6: Add the first weekly KPI row** to `docs/superpowers/evaluations/weekly-kpis.md`:
  - p95 latency
  - error rate
  - avg passes
  - ship rate
  - weekly spend
  - validator pass-1 fail rate

- [ ] **Step 13.7: Commit**

```bash
git add src/server.js data/Job_Application_Automator_v7lite_stage12.json docs/superpowers/evaluations/weekly-kpis.md
git commit -m "feat(observability): JSONL pipeline log + first 25-job batch (Stage 12)"
```

- [ ] **Step 13.8: Update `MEMORY.md` project_state** noting v7-lite is live + the 60-day callback-window clock starts today. Set a calendar reminder for Session 14.

---

# PHASE F — Outcome

## - [ ] Session 14 — 60-day callback review (Stage 13 decision gate)

**Spec sections:** §10.5, §G5, §12 success criteria
**Outcome:** Continue / Revisit / Extend decision per the matrix.

### Bootstrap prompt for fresh session

```
Run Session 14 of:
docs/superpowers/plans/2026-04-26-pipeline-quality-overhaul-implementation.md

Read only:
  - That session in the plan
  - docs/superpowers/specs/2026-04-19-pipeline-quality-overhaul-design.md §10.5
  - The Outcome column of the main tracker (export the column to CSV first
    and put it at /tmp/outcomes.csv before starting)

Apply the decision matrix in §10.5. If volume <80, treat throughput as the
bottleneck before any Continue/Revisit decision.
```

### Files

- Create: `docs/superpowers/evaluations/YYYY-MM-DD-stage13-callback-review.md`

### Steps

- [ ] **Step 14.1: Aggregate Outcome column** from main tracker. Tally by enum (`No Response / Auto-Rejected / Recruiter Reply / Interview Invite / Offer`).

- [ ] **Step 14.2: Apply matrix** from spec §10.5:
  - ≥1 Interview Invite AND ≥3 Recruiter Replies → **Continue**
  - 0 Interview Invites AND ≤1 Recruiter Reply → **Revisit non-pipeline factors** (positioning, targeting, channel)
  - Mixed / sub-threshold → **Extend** 30 days
  - Volume <80 → **Throughput-first**: investigate review-queue volume + pre-filter aggressiveness before any Continue/Revisit decision

- [ ] **Step 14.3: Write the decision doc** with the tally, the matrix outcome, and a concrete next action.

- [ ] **Step 14.4: Commit**

```bash
git add docs/superpowers/evaluations/*-stage13-callback-review.md
git commit -m "docs(stage13): 60-day callback review decision"
```

---

# Cross-cutting Reminders

- **Per-task budget realism:** Sessions 1, 5, 9, 13 are dev-heavy (45-90 min). Sessions 2, 4 are user-review-bottlenecked (40-60 min user time). Sessions 6-8, 10 involve n8n UI clicking (45-60 min). Sessions 11-12 cost real OpenRouter $ (~$1-7).
- **Always commit at task boundaries.** Mid-task interruption = re-do work in next session.
- **Progress tracking:** keep this file in `git log` view to see which session boundaries have committed; use `- [x]` checkbox to mark done.
- **If a session reveals the spec is wrong:** STOP, fix the spec first (separate commit, separate session), then resume.
- **Stage 0 soak gate is binding.** Do not start Session 2 within 14 days of Session 1's commit unless explicitly overriding.
- **Rollback safety:** before Session 6 begins, `git branch pipeline-v6-backup` so v6 state is preserved verbatim.

---

# Self-Review checklist (run before starting Session 1)

- [x] Every spec stage 0–13 maps to at least one session above
- [x] Every session has a copy-pasteable bootstrap prompt
- [x] Every session lists the minimum file set to read (token-efficient)
- [x] Every TDD step shows actual code, not "write tests"
- [x] Every commit step has the exact `git commit -m` message
- [x] No "TBD" / "implement later" / "fill in details"
- [x] Function names consistent across sessions (`runValidator`, `runRetry`, `validatePlan`, `findBannedPhrases`, `buildCompanyData`)
- [x] Stage 0 hotfix is shippable independently of Phases B–E (per spec §10.1)
- [x] Phase D row-lock test (Session 10.5) is explicit (closes spec §7.4 race)
