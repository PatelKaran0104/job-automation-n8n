# Run Quality Review — 2026-04-18

**Scope:** 20 jobs processed (18 successful, 2 OpenAI failures), Gemini 3.1 Flash-Lite (match) + gpt-4o-mini (tailor), post–2026-04-18 second-pass prompt fixes.

**TL;DR:** The run exposes **three show-stopping quality bugs** the prompt-only pipeline cannot self-correct, plus the previously-known cover-letter length problem. Option A (programmatic validator) is insufficient — you need **Option A + one server/workflow hardening + one prompt fix** to keep sending these. Do not mail anything from this batch as-is.

---

## Scoreboard (what actually worked)

| Check | Result | Verdict |
|---|---|---|
| MSc / Hochschule Fulda in profile | 18/18 (100%) | ✅ |
| `jobTitle` tailored per JD | 18/18 (100%) | ✅ |
| P2 contains ≥1 metric | 18/18 (100%) | ✅ |
| Work section contains ≥1 metric | 18/18 (100%) | ✅ |
| Projects patched (JD-relevant reorder) | 17/18 (94%) | ✅ |
| Availability mentioned in P3 | 18/18 (100%) | ✅ |
| Sheet pairing integrity (jobId match) | 20/20 (100%) | ✅ (fix from 2026-04-16 held) |
| Language detection (DE vs EN) | 18/18 by profile | ✅ at the PROFILE level |
| Patch structure valid | 18/20 (2 API failures) | ✅ |
| P1 word count in 50–70 target | 16/18 (89%) | ✅ mostly |

---

## Critical issues (ranked by likelihood of hurting a callback)

### C1. **English work & project bullets inside German resumes** — 50% of DE jobs
Nine of 18 German resumes have work descriptions written in English; ten of 17 have English project descriptions. The tailor is emitting the verbatim English base bullets under the crown-jewel pinning rule (Task 10 of the prompt plan) and failing to translate them. Example — adesso SE Salesforce Commerce (`#7`, language="de"):

> `AppExchange managed package: Built and published a production package through Salesforce's full security review cycle...`

sits inside a fully German resume with a German profile, German skills section headings, and a German cover letter. A DE recruiter opening [resume-adesso-se--developer-salesforce-b2c-commerce-all-genders-181744.pdf](../../../output/2026-04-18/Resume/resume-adesso-se--developer-salesforce-b2c-commerce-all-genders-181744.pdf) will see this as careless or AI-generated.

**Per-job breakdown (⚠ = English bullet in DE resume):**
```
⚠ #0  FACT-Finder (GTM Engineer)          ⚠ #11 FinMent (PHP)
⚠ #6  FERCHAU (Salesforce Inhouse)         ⚠ #15 Jobriver (SF B2C)
⚠ #7  adesso (SF B2C Commerce)             ⚠ #17 Stolzberger (SF Sales Cloud)
⚠ #8  adesso (SF B2C Commerce)             ⚠ #18 MHP (SF Developer)
⚠ #19 adesso (Lead SF CRM)
```
`✓` #3 Diamant, #9 adesso (one instance), #13 Bertrandt, #16 Stolzberger Marketing show the AI CAN do it when not anchored to pin-verbatim bullets.

**Root cause:** The pinning rule says "substance and metrics must remain" — gpt-4o-mini interprets this as "do not modify" and copies the base-resume English verbatim.

**Fix:** tighten the pinning rule to "translate to the output language while preserving metrics and substance." Add language consistency to the SELF-CHECK and to Option A's validator.

---

### C2. **Empty-body cover letter PDFs saved to disk under real company names** — 2/20 jobs (CLARK Holding, apaleo)
The OpenAI API returned empty responses for two jobs. Node 14 set `patch._error` AND `_coverLetterWarning: "AI returned empty cover letter"` AND emitted `paragraph1/2/3` as empty strings — but node 15b still called `/generate-coverletter` with `paragraph1: "", paragraph2: "", paragraph3: ""`. The server has no empty-body guard, so it rendered a blank-body cover letter and returned `success: true`.

Result: `D:\KARAN\output\2026-04-18\Coverletter\coverletter-clark-holding-se--salesforce-developer-m-f-d-181327.pdf` is a real-looking cover letter with NO body text under a real job. If you auto-attach PDFs from the output folder, you could submit this.

**Fixes (pick one):**
- **Server-side (preferred):** [src/server.js](../../../src/server.js) `/generate-coverletter` — reject request with 422 if all three paragraphs are empty after `wrapParagraph()`.
- **Workflow-side:** node 15b — IF condition gating the HTTP call on `$json.paragraph1 && $json.paragraph2 && $json.paragraph3`.

Parallel to this, the OpenAI "No output_text" rate is ~10% on this run. That's a cost/throttle problem to separately investigate — probably hitting gpt-4o-mini rate limits in the tight loop. Raising the wait in `13a1. Wait` from 2 s to 5 s is a cheap mitigation.

---

### C3. **German cover letters are near-duplicates** — detectable if a recruiter sees two
P3 template repetition (aggregated, city-normalized):
```
[6x] Ich bin ab sofort für eine Vollzeitstelle verfügbar. Mein Wohnsitz in <CITY>
     ermöglicht sowohl Vor-Ort-Arbeit in <CITY> als auch Remote-Tätigkeit. Über die
     Möglichkeit eines persönlichen Gesprächs würde ich mich freuen.
[5x] Ich bin ab sofort für eine Vollzeitstelle verfügbar. Mein Wohnsitz in <CITY>
     ermöglicht sowohl Vor-Ort-Arbeit als auch Remote-Tätigkeit. Über die
     Möglichkeit eines persönlichen Gesprächs würde ich mich freuen.
```
That's **11 out of 13 German P3s are the same paragraph** differing only by city names.

P1 openers, first two words:
```
[5x] "Die Verantwortung"      ← same JD→hook template
[4x] "Die Entwicklung"
[1x] each of 9 others
```
11/13 German P1s start with a "Die [Noun]…" structure.

adesso SE appears 3 times in this run (same company, three different roles). A recruiter in their HR team pulling two applications from Karan will immediately see the pattern.

**Fix — one of:**
- Add anti-template rules to the tailor prompt: "P3 MUST NOT begin with 'Ich bin ab sofort' more than once in a given conversational turn" doesn't work across API calls. Real fix is to seed the opening with forced variety — e.g., add 4 sample P1/P3 structures and instruct "pick whichever fits best, never the same structure twice in a week."
- Better: **parameterize the closing** — make availability/location/closing three sentences the AI composes from a rotating set of templates. Even injecting a `templateSeed: "A"/"B"/"C"` variable cycled by `(new Date().getTime() / 60000) % 3` gives three surface forms.

---

### C4. **P2 still short, P3 very short** — confirms residual #3 and #4 from the prompt plan

| Target | Hit rate | Average | Verdict |
|---|---|---|---|
| P1 in 50–70 | 16/18 (89%) | 66.0 | ✅ |
| **P2 in 80–110** | **1/18 (6%)** | **69.4** | ❌ target never met |
| **P3 in 40–60** | **0/18 (0%)** | **30.8** | ❌ every P3 underweight |

This is exactly what the follow-ups section of [2026-04-17-prompt-quality-upgrade.md](../plans/2026-04-17-prompt-quality-upgrade.md#follow-ups) predicted. gpt-4o-mini does not respect the word-budget even after three prompt revisions.

---

## Medium issues

### M1. German "passion" cliché slipped through — 1 job
`#19` adesso Lead Developer Salesforce CRM P1 opens: *"Die Leidenschaft für Salesforce-Technologien…"* — `Leidenschaft` is the direct translation of the banned English `passionate`. Not on the DE banned list today. Add it.

### M2. "excited" in Elevenlabs P2 — confirmed real banned hit
`#2` Elevenlabs: *"I am particularly excited about the opportunity to work with modern data transformation tools like dbt and BI tools such as Sigma."* — exact cliché. The SELF-CHECK gate didn't catch it. Confirms follow-up #8.

> Note: `#1` Intercom P1 *"analytics-driven decision-making"* is a legitimate compound, not a true `driven` hit. Detector needs `\b(results|self)-?driven\b` to avoid false positives.

### M3. `showCertificates` inconsistent for adjacent SF roles
Four jobs where the JD mentions Salesforce but the model chose `showCertificates: false`:

| # | Role | JD SF signal | Decision | Correct? |
|---|---|---|---|---|
| 1 | Intercom Senior Analytics Engineer | none | false | ✅ |
| 3 | Diamant AI Automation Engineer | JD says "Salesforce, Microsoft 365" as target systems | false | ⚠ borderline |
| 11 | FinMent PHP Full Stack | none | false | ✅ |
| 13 | Bertrandt DevOps | none | false | ✅ |

Actually only #3 is borderline. Current rule works as intended for 17/18.

### M4. Skill patch coverage low
Histogram of skills returned per patch: `{1: 5, 2: 2, 3: 1, 4: 2, 5: 2, 6: 6}`. Only 6/18 (33%) jobs return the full 6 skills array. The prompt says "Keep the same number of skill entries" — model is dropping unchanged categories. Merge logic handles this correctly (base resume fills in), but the AI loses the ability to REORDER by relevance, and the base order is fixed (Languages → Frontend → Backend → Cloud → Salesforce → Automation). That is sub-optimal for Salesforce-heavy JDs where Salesforce Platform should be #1.

**Fix:** tighten the prompt from "Keep the same number of skill entries" to "Return ALL 6 skill entries in the display order you want."

---

## Option A vs Option B — verdict

**This run makes Option A necessary but not sufficient.** The three residual issues from the previous plan (P2 length, P3 length, banned-phrase substrings) all showed up at predicted rates. A node-14 validator that:

1. Counts words per paragraph
2. Greps for banned phrases (EN + DE list updated with "Leidenschaft")
3. Checks paragraph-language matches `language` field
4. Triggers one regeneration with a re-ask message

…would have caught M1, M2, C4, and the first-line of C1 (language mismatch). Estimated cost: 1 extra OpenAI call on ~70% of jobs in this batch (most jobs fail at least one check).

**But Option A cannot fix C1 (translation-of-pinned-bullets), C2 (empty-PDF bug), or C3 (template repetition).** Those need different fixes:
- C1: prompt language-consistency rule + Option A language check
- C2: server-side/workflow empty-body guard (new, independent fix)
- C3: rotating template/anti-template rule (prompt + stateful seed)

**Recommendation:** do not spend money upgrading to gpt-4o (Option B) until Option A plus the three targeted fixes below are in place and re-tested. The failures are not model-capability failures — they are prompt-design and pipeline-gate failures that will recur regardless of model.

---

## Prioritized fix list

| # | Severity | Fix | Where |
|---|---|---|---|
| 1 | Critical | Block empty cover-letter PDFs | [src/server.js](../../../src/server.js) `/generate-coverletter` — reject if `p1+p2+p3` all empty |
| 2 | Critical | Translate pinned crown-jewel bullets to output language | [Job_Application_Automator_v6.json](../../../data/Job_Application_Automator_v6.json) node 13a — update "CROWN-JEWEL BULLETS" rule: "translate to output language, preserving metrics" |
| 3 | Critical | Node-14 validator (Option A) | node 14 — word-count + banned-phrase + paragraph-language-match, up to 1 regeneration |
| 4 | Critical | Rotate P1/P3 template structures | node 13a — inject `templateSeed` variable; expand to 3–4 parallel P1/P3 structures |
| 5 | High | Add "Leidenschaft" (+ "leidenschaftlich") to DE banned list | node 13a prompt |
| 6 | High | Tighten skills rule — always return 6 in desired order | node 13a prompt |
| 7 | Medium | Raise `13a1. Wait` from 2s to 5s | node 13a1 — reduces OpenAI empty-response rate |
| 8 | Low | Fix banned-phrase detector to require word boundaries for `driven` | (evaluator script only, not pipeline) |

---

## What's actually submittable from this batch

Of 18 successful jobs, realistically submittable without manual rework:
- **3 strong:** #3 Diamant, #13 Bertrandt, #16 Stolzberger Marketing (DE resume fully in German, JD-specific hook, metrics present, templates not identical)
- **~11 usable after bullet re-translation:** all the DE Salesforce jobs once C1 is fixed — the SUBSTANCE is good, the language mismatch is what kills them
- **4 English jobs:** #1 Intercom, #2 Elevenlabs (strip "excited"), #4 CEFALY, #10/#12 WZP-Solutions — cover letters passably generic, P2/P3 under length
- **2 do not submit:** #5 CLARK Holding, #14 apaleo — empty cover letters

**Advice:** don't send the remaining German ones until C1 is fixed.

---

## Data artifacts

- Extractor: [d:/tmp/run-2026-04-18/extract.mjs](../../../../tmp/run-2026-04-18/extract.mjs)
- Bulk scan: [d:/tmp/run-2026-04-18/scan.mjs](../../../../tmp/run-2026-04-18/scan.mjs)
- Deep dive dump: [d:/tmp/run-2026-04-18/deepdive.txt](../../../../tmp/run-2026-04-18/deepdive.txt)
- Consistency check: [d:/tmp/run-2026-04-18/crossrun.mjs](../../../../tmp/run-2026-04-18/crossrun.mjs)
- Per-job JSON: [d:/tmp/run-2026-04-18/jobs.json](../../../../tmp/run-2026-04-18/jobs.json)
