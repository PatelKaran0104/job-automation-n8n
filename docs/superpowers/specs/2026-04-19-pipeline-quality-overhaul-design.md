# Pipeline Quality Overhaul — Design Spec

**Date:** 2026-04-19 (lean revision 2026-04-20, audit revision 2026-04-26)
**Author:** Brainstorming session with Claude (Opus 4.7)
**Target pipeline version:** v7-lite
**Target audience:** Karan — Salesforce Developer seeking ANY relevant role in Germany (internship / Werkstudent / full-time / remote). 25 jobs/day.
**Budget:** ~$60–90/month (OpenRouter, ~25 jobs/day).
**Directive:** Maximize interview callbacks at minimum complexity. Cut anything that doesn't move the needle for a recruiter's 8-second skim at a mid-tier German firm.

---

## Spec Revision Summary (2026-04-26 multi-angle review)

This spec was reviewed through four lenses (feasibility, failure modes, cost, goal alignment) on 2026-04-26. The original v7 design was **2-4x over the stated budget** by its own §9 estimate ($185-280/mo realistic vs $60-90/mo target) and contained several buildability gaps in n8n. This revision (**v7-lite**) preserves every change that addresses a 2026-04-18 critical failure (C1-C4) while cutting LLM stages and complexity that don't earn their keep at 25 jobs/day for a single user.

**What's cut from the original v7 design:**

- Research Extractor as a separate LLM stage → replaced with deterministic field passing (saves $10/mo, removes substring-verify code path).
- LLM Critic with 10 scoring dimensions → replaced with deterministic hard-fails + a single Planner-computed coverage score (saves $25-40/mo, removes cosine-similarity corpus, removes 30-day filter logic, kills `tests/similarity.test.js` and `tests/templateLRU.test.js`).
- Template pools + LRU rotation + 48 hand-vetted variants → spec's own §Goals already conceded "repetition across 25 employers is invisible." Negative exemplars in the Tailor system prompt + banned-phrase list cover C3 (model tics).
- `evidenceQuality.json` sidecar tag file → keep the audit, drop the tag scaffolding. Crown-jewel bullets pinned in Tailor system prompt do 90% of the work without index-drift risk.
- Opus 4.7 for Tailor → switched to Sonnet 4.6 (largest single-line cost cut). C1-C4 are prompt-architecture bugs (Planner separation, hard-fail validator, language token), not raw-capability bugs.
- Pre-Critic Validator as a new n8n Code node → collapsed into the existing Express `validatePatch.js`, called inline from `/generate-resume` and `/generate-coverletter`.

**What's added:**

- **Stage 0 — v6 hotfix path.** Two deterministic fixes (language-consistency rule in Tailor prompt + empty-body server guard) ship to v6 *first*, run for 14-30 days. This isolates whether quality is the bottleneck before committing to the full v7-lite rebuild. If interview-rate signal appears with v6+hotfix, v7-lite is descoped.
- **Retry budget math fix** (§11.3). Original spec capped at 15 LLM calls but §11.2 allows 3 attempts each → real ceiling was 24-45 calls. Now corrected.
- **Plateau-threshold fix** (§3.6). Original `score_delta < 5%` plateaued the 79→80 jump that crosses the ship line. Removed since the LLM Critic is gone.
- **Stage ordering fix.** Original §10.1 had circular deps (Stage 5 Planner needed Stage 9 server change). Server changes moved to Stage 1.
- **Substring verification rules tightened** — Unicode NFKC normalization, no cross-field concat, paraphrase-tolerant matching documented (only relevant if the optional Research Extractor is later re-enabled).
- **Approve sub-workflow row lock** (§7.4) — `Status=Rendering` intermediate state set atomically before HTTP call to close the TOCTOU race.

**Cost reset:** v7-lite targets **~$0.05-0.07/job → ~$25-35/month** at 500 jobs/month — inside budget, with headroom for retry amplification.

The remainder of this document is the v7-lite design.

---

## Problem Statement

The 2026-04-18 production run (evaluated in `docs/superpowers/evaluations/2026-04-18-run-quality-review.md`) exposed four critical failure modes in pipeline v6:

1. **C1 — Language mismatch (50%):** 9/18 German resumes shipped with English work/project bullets because crown-jewel pinning was interpreted as "do not modify."
2. **C2 — Empty cover letters (2/18):** CLARK Holding and apaleo shipped PDFs with empty body paragraphs under real company names. No server-side guard.
3. **C3 — Template repetition (85%):** 11/13 German P3 closers were near-identical; 9/13 P1 openers used the same `"Die [Noun]"` pattern.
4. **C4 — Length/specificity drift:** P2 hit target length 1/18 times; P3 hit 0/18. gpt-4o-mini's base capability ceiling.

**Caveat acknowledged in audit:** these are 4 critical defects from one 18-job batch. They are real "do-not-mail" bugs (especially C1 and C2), but the n=1 evidence base does not by itself prove that quality is the limiting factor on the user's 0-interview rate. Stage 0 (§10.1) is the experiment that isolates whether v6+hotfix produces interview signal before v7-lite commits to a multi-week rebuild.

---

## Goals

Each goal below is measurable and has a corresponding acceptance criterion in §12.

- **G1 — Zero hard-fail shipped output.** No letter ships with empty paragraphs, wrong-language bullets, banned-phrase matches, or missing skill entries, as checked by the deterministic validator. Measured on the golden set and on the first 25 live jobs.
- **G2 — Keyword-targeted tailoring.** Every shipped resume patch covers ≥80% of hard requirements (weight ≥0.7) identified by the Planner. Measured by validator keyword check.
- **G3 — Full skills coverage with role-fit ordering.** `patch.skills` contains all 6 skill entries (ids preserved verbatim) on every shipped output, reordered such that the most role-relevant group is first. Measured by validator.
- **G4 — Auto-ship majority.** ≥70% of jobs ship on pass 1 (no retries needed); the remainder land in the review queue tagged with actionable reason codes (§7.3).
- **G5 — Measurable interview impact.** v7-lite must establish a non-zero interview-invite rate within 60 days of cutover. Outcomes tracked per application (§12). **Stage 0 short-circuits this:** if v6+hotfix produces interview signal in 14-30 days, v7-lite is descoped and the budget is preserved.

**Explicitly NOT a goal:** template-uniqueness scoring across different companies, multi-pass qualitative refinement, voice-consistency scoring, deep company research (GitHub/News), evidenceQuality tag sidecar files, LLM-based critic. These target a recruiter audience that doesn't exist for the Werkstudent/internship/entry-level German market at 25 jobs/day.

## Non-Goals

- Switching off n8n orchestration (keep it; extend v6).
- Writing a custom web UI for the review step (Google Sheet tab suffices).
- Re-architecting the Express server beyond adding an empty-body guard and integrating the deterministic validator.
- Agentic web-browsing research (evaluated and rejected).
- Cloud-based observability (single-user tool; local JSONL logs suffice).
- Enriched company research (Google News, GitHub org fetch, /about page fetch). Existing Apify scrapers already provide enough company context at zero marginal cost.
- Template pools / LRU rotation / cosine-similarity uniqueness. Repetition across 25 different employers is invisible; the real risk is *model tics*, which are solved cheaply via 2-3 negative exemplars in the Tailor prompt.
- Multi-pass qualitative revision. One pass + one mechanical retry + review queue is the ship path.
- `evidenceQuality` sidecar tag file. Audit is valuable; the tag scaffolding isn't.
- LLM-based Critic. Hard-fails (deterministic) + Planner-computed `requirement_coverage` is all the gate needs.
- Research Extractor LLM call. Apify scrapers already provide structured `companyData`; pass it directly to the Planner.

---

## Definitions

- **Concrete company fact** — a string that appears in `companyData` (industry, tech_attributes, keywords, hq_location, etc.) directly emitted by the Apify scrapers. Substring-verifiable against the raw scraped text by construction.
- **The 6 skill groups** — the fixed entries in `data/resume.json → content.skill.entries`, identified by id:
  - `7e0af879-e5a3-457e-ab86-634363abf266` — Languages
  - `4e5c9b0d-2b32-48a6-9b61-0c320df13632` — Frontend
  - `b38fcbc7-ae5a-41f8-87c3-8e1fd55a8445` — Backend & APIs
  - `c7231132-d4b1-47eb-9bee-a66c7756ce1d` — Cloud & DevOps
  - `9a905d12-825c-4090-a90c-3ff010a9d8b4` — Salesforce Platform
  - `07d4ce0e-0dcf-4193-8425-06a3e01fe20c` — Automation & AI
- **Banned phrase** — a string or regex in `data/banned-phrases.json` (§6.3). Applies to all languages specified in that file.
- **Hard-fail** — any of the 8 deterministic checks in §3.5 returning `false`. A hard-failing output cannot ship; it enters revise (pass 1) or review (pass 2).
- **Crown-jewel bullet** — one of the top 5 bullets identified in the base-resume audit's "Crown-Jewel Bullets" section (§5). These are pinned-priority evidence for the Tailor, embedded directly in the Tailor system prompt as a small list.
- **Acceptance criterion** — a measurable condition that must hold before the corresponding stage (§10) or KPI (§12) is considered met.

---

## High-Level Architecture

```
[SCRAPE — nodes 2a–2e — UNCHANGED (Apify)]
         ↓
[NORMALIZE & MERGE — node 4 — UPGRADED]
  Preserve a companyData object from each source scraper's native fields
         ↓
[MATCH FILTER — nodes 10a–12 — UNCHANGED (Gemini 2.0 Flash-Lite + fallback)]
         ↓
[LOOP OVER MATCHED ITEMS — node 9]
         ↓
[NEW: PLANNER — Sonnet 4.6]
  Input:  JD + base_resume context + companyData (raw, no extractor LLM)
  Outputs: language_decision, role_classification, ranked_requirements,
           evidence_mapping, must_use_keywords, company_hooks (drawn
           from companyData fields), tone_profile, show_cert/show_proj,
           plan_confidence, requirement_coverage_target
         ↓
[UPGRADED: TAILOR — Sonnet 4.6, prompt-cached, single-pass]
  Inputs: plan + JD + base_resume + 1 exemplar per language + crown-jewel bullets
  Outputs: resume_patch + 3 paragraphs + requirement_to_evidence_map + self_check
         ↓
[NEW: DETERMINISTIC VALIDATOR — runs in Express, called by n8n via /validate]
  8 hard-fail checks (§3.5.2)
  If FAIL on pass 1 → one auto-retry with surgical instructions → re-run validator
  If FAIL on pass 2 → route to review queue (NO third LLM pass)
  If PASS → ship gate
         ↓
[GATE]
  ├ ship → [Resume PDF + Cover Letter PDF] → Log to main tracker (Outcome="No Response")
  └ review → [Log to Review Queue tab with reason_codes — NO PDF]
                         ↓
              [USER edits + Approves in sheet]
                         ↓
[NEW: APPROVE REVIEW QUEUE SUB-WORKFLOW — polls every 5 min]
  Atomic Status=Rendering → render PDFs → Status=Sent → log to main tracker
```

### Module Boundaries

| Module | Responsibility | Where it runs | Interface in | Interface out |
|---|---|---|---|---|
| Normalize & Merge (v7) | Unify scraper outputs; preserve company data | n8n Code node 4 | Raw scraper JSON per source | `{jd, company, url, location, companyData}` |
| Planner | Decide strategy (what to write) + coverage target | n8n HTTP node → OpenRouter | JD + base_resume + companyData | `plan` JSON |
| Tailor | Write the resume patch + cover letter (single pass; one retry on validator fail) | n8n HTTP node → OpenRouter | plan + JD + base_resume + [prior draft + validator fails on retry] | `tailor_output` JSON |
| Deterministic Validator | 8 hard-fail mechanical checks; computes ship/revise/review | **Express server (`src/validatePatch.js` extended)** — called via new `POST /validate` endpoint | `tailor_output`, `plan` | `validator_ok` + `validator_fails[]` + `verdict` |
| Review Queue | Human correction surface | Google Sheets tab | Tailor output + reason codes | Approved edits → PDF trigger |
| PDF Renderer | Existing Express `/generate-resume` + `/generate-coverletter` | Express server | patch + paragraphs + meta | PDF files |

Each module has one clear purpose, a well-defined input contract, and can be tested in isolation.

---

## Detailed Component Design

### 1. Research Bundle (deterministic only)

#### 1.1 Preserving existing scraper data (node 4 upgrade)

Current pipeline discards most of what scrapers return. v7-lite preserves a unified `companyData` object per job:

```json
{
  "name": "SAP SE",
  "domain": "sap.com",
  "website": "https://www.sap.com",
  "address": "Walldorf, Germany",
  "hq_location": "Walldorf",
  "size_category": "LARGE",
  "employee_count": "10000+",
  "year_founded": 1972,
  "revenue_bracket": "$10B+",
  "industry": "Enterprise Software",
  "rating": 3.9,
  "tech_attributes": ["SAP", "ABAP", "Java", "JavaScript", "..."],
  "company_profile_urls": {
    "stepstone": "...",
    "glassdoor": "...",
    "indeed": "..."
  },
  "keywords": ["..."],
  "_sources_present": ["stepstone", "glassdoor"]
}
```

Extend `BOARD_CONFIG` in node 4's Code step to map each source's native fields into this unified shape:

| `companyData` field | StepStone path | Glassdoor path | Indeed path | Xing path |
|---|---|---|---|---|
| `name` | `company_details.company_name` | `company.companyName` | `employer.name` | `company` |
| `website` | `company_details.company_website` | — | `employer.corporateWebsite` | — |
| `address` | `company_details.company_address` | `company.companyAddress` | `employer.address` | — |
| `size_category` | — | `company.companySizeCategory` | — | — |
| `year_founded` | — | `company.companyYearFounded` | — | — |
| `tech_attributes` | — | `attributes` | — | `keywords` |
| `industry` | — | — | `employer.industry` | (via `industry_id`) |

Missing fields become `null`. **No new scrapes, no API calls, no LLM extractor at this stage.** The Planner reads `companyData` directly.

#### 1.2 No Research Extractor LLM stage

The original v7 design ran a Sonnet extractor that produced an `evidence_json` blob with `safe_facts_to_cite`, `soft_signals`, `recent_news`, etc. In v7-lite the Planner consumes `companyData` directly:

- The Planner is given a single instruction: *"`company_hooks` must be drawn ONLY from string fields in `companyData`. Quote them verbatim or do not cite."*
- Substring verification becomes trivial — the Planner sees only the source text — and can be done as a single deterministic check post-Planner if needed.
- This removes one full LLM round-trip per job (~$0.02 saved), the substring-verification code node, and the `evidence_json` schema entirely.

If the deterministic validator (§3.5) later shows hallucinated company facts in shipped output, an Extractor stage may be re-introduced. As of this revision, no evidence supports the spend.

---

### 2. Planner

#### 2.1 Purpose

The Planner is plan-then-execute for application writing. It pre-chews the JD + base resume + `companyData` into a deterministic plan object the Tailor executes. This separation is the single biggest quality lever: the Tailor no longer has to do requirement extraction AND writing in one pass. **This addresses the C1 (language) and C4 (specificity) failure modes directly.**

#### 2.2 Inputs

- JD full text (from matched job)
- Base resume context (from `/context`)
- `companyData` (from node 4)

#### 2.3 Output schema

```json
{
  "language_decision": {
    "value": "de" | "en",
    "reason": "JD 85% DE vocabulary"
  },
  "role_classification": {
    "type": "salesforce" | "fullstack" | "backend" | "data" | "ai_ml" | "devops" | "other",
    "justification": "..."
  },
  "ranked_requirements": [
    {
      "rank": 1,
      "requirement": "5+ years Salesforce development",
      "keyword": "Salesforce",
      "keyword_synonyms": ["SFDC", "Salesforce.com"],
      "weight": 0.9,
      "kind": "hard" | "soft" | "nice_to_have"
    }
  ],
  "evidence_mapping": [
    {
      "requirement_rank": 1,
      "resume_entries": [
        { "id": "286ca64e-...", "type": "work", "why": "2+ yrs at MV Clouds — strongest SF signal" }
      ],
      "coverage": "strong" | "partial" | "weak"
    }
  ],
  "story_angles": [
    "Led AppExchange package from scratch — maps to their platform focus",
    "Aerospace client work = enterprise-compliance signal"
  ],
  "must_use_keywords": ["Apex", "LWC", "Sales Cloud", "AppExchange"],
  "company_hooks": [
    {
      "fact": "Walldorf-based",
      "source_field": "companyData.hq_location",
      "placement": "P1" | "P2" | "P3" | "resume_profile"
    }
  ],
  "tone_profile": {
    "register": "formal" | "semi-formal" | "startup-casual",
    "rationale": "Glassdoor + careers page signal enterprise formality"
  },
  "show_certificates": true,
  "show_projects": true,
  "risks_to_avoid": [
    "Do NOT over-emphasize Salesforce — this is a general fullstack role",
    "Avoid claiming K8s experience — base resume has only coursework-level"
  ],
  "requirement_coverage_target": 80,
  "plan_confidence": "high" | "medium" | "low"
}
```

#### 2.4 Key field semantics

- `language_decision` is authoritative downstream — Tailor and validator respect it absolutely.
- `ranked_requirements[].weight` and `keyword`/`keyword_synonyms` drive the validator's keyword-coverage check.
- `evidence_mapping` binds JD requirements to actual base-resume IDs. Tailor is forbidden from citing evidence outside this list.
- `must_use_keywords` are ATS-critical. Tailor must include all of them in output.
- `company_hooks[].source_field` is the verbatim path inside `companyData` — the validator can substring-check the hook against that field directly. Hooks may be empty if `companyData` is sparse (accepted; produces a generic but mechanically-correct letter).
- `risks_to_avoid` are hard negative constraints the Tailor must respect.
- `requirement_coverage_target` is the threshold the validator gates on (default 80; Planner may lower to 75 if base-resume evidence is genuinely sparse).
- `plan_confidence: "low"` triggers immediate route to review queue without Tailor (waste-avoidance).

#### 2.5 Model config

Claude Sonnet 4.6. No extended thinking — the schema is structured enough that standard output suffices. Temperature 0. Strict JSON output via tool-use.

#### 2.6 Failure handling

- Malformed JSON → 1 retry.
- Still malformed → fall back to minimal default plan (no hooks, no story_angles, `plan_confidence: "low"`) and force route to review queue with `reason_code: PLAN_FAILED`.
- Pipeline never blocks.

#### 2.7 Cost estimate

~3K input + ~1K output per plan ≈ **$0.014 per job** (Sonnet pricing).

---

### 3. Tailor

#### 3.1 Model config

**Claude Sonnet 4.6** (down from Opus 4.7 in original v7 design — see Spec Revision Summary). No extended thinking. Temperature 0.3 (slight creative latitude for prose). Strict JSON via tool-use.

#### 3.2 Prompt architecture

**System block (stable across batch — prompt-cached via OpenRouter `cache_control`):**

1. Role + meta-instruction
2. Style guide (language-switched: DE or EN, selected by `plan.language_decision.value`)
3. Two exemplars in the target language (synthetic, approved upfront — see §6)
4. Banned-phrase list (DE + EN)
5. Crown-jewel bullets (top 5 from base resume audit, pinned as priority evidence)
6. Negative exemplars: 2-3 short bullets showing model tics to avoid (the C3 anti-pattern fix)
7. Global rules (see §3.4)
8. Output schema (as Anthropic tool definition)

**Hard discipline:** nothing job-specific goes into the system block. All per-job data — JD, company, plan, prior draft, validator feedback — goes in the user block below the cache breakpoint.

**User block (per-job):**

```xml
<plan>{...full planner JSON...}</plan>
<companyData>{...raw scraper-merged object...}</companyData>
<jd>...</jd>
<base_resume>{...context from /context endpoint...}</base_resume>
<!-- ONLY on retry: -->
<prior_draft>{...}</prior_draft>
<validator_feedback>{...validator_fails[] formatted as surgical instructions...}</validator_feedback>
```

#### 3.3 No template pools

The original v7 design had 48 hand-vetted variants partitioned by register, with LRU rotation tracked in cross-run state. **All cut.** §Goals already conceded "repetition across 25 employers is invisible." C3 (model tics like the `"Die [Noun]"` opener pattern) is solved by:

- 2-3 negative exemplars in the system prompt showing the patterns to avoid
- Two positive exemplars per language showing varied openings
- Banned-phrase list catching specific tic phrases

This eliminates Stage 3 entirely (~1 week of work + 48 user approvals), removes `tests/templateLRU.test.js` and `tests/similarity.test.js`, and removes the cross-run state file design.

#### 3.4 Hard rules baked into system prompt

```
TRANSLATION CONSISTENCY (hard):
  - The letter language is plan.language_decision.value.
  - ALL work bullets, ALL project descriptions, ALL three paragraphs, and the profile MUST be in that language.
  - "Crown-jewel" bullets must be TRANSLATED to the target language.
    Preserving the EVIDENCE means keeping the fact, numbers, and impact — NOT keeping the English words.
  - Do NOT leave English sentences in a German resume, or vice versa.

SKILL RULES (hard):
  1. Return ALL 6 skill entries by id — never omit.
  2. Preserve every id verbatim — never invent or rename.
  3. Reorder entries so the most role-relevant group is first.
  4. You MAY modify skill.skill (display name) and skill.infoHtml.
     You MAY NOT add, remove, or renumber entries.

EVIDENCE DISCIPLINE (hard):
  - You may ONLY cite resume evidence listed in plan.evidence_mapping.
  - You may ONLY cite company facts listed in plan.company_hooks.
  - For each company_hook used, the cited string must substring-match
    the source_field text in companyData (validator will enforce).

KEYWORD COVERAGE (hard):
  - Every term in plan.must_use_keywords must appear at least once
    in your output (resume patch OR cover letter).

BANNED CONTENT (hard):
  - The phrases in the banned list are forbidden anywhere in output.
  - No em-dashes (—). Use comma, period, or semicolon.
  - No "I am writing to apply", "Hochmotiviert", "Mit großem Interesse",
    "passionate", "leidenschaftlich".
```

#### 3.5 Deterministic Validator (replaces the LLM Critic and the Pre-Critic Validator from v7-original)

A pure-code validator that runs on every Tailor output. **Lives in the Express server** (extends `src/validatePatch.js`) and is called via a new `POST /validate` endpoint by n8n. This consolidates failure surface in tested code, gives n8n filesystem-free access to checks, and avoids the "where does Pre-Critic live" ambiguity from the original design.

#### 3.5.1 Why deterministic-only

The 4 critical 2026-04-18 failure modes are all mechanically detectable. An LLM Critic with 10 scoring dimensions cost $25-40/mo to add a soft-score gate that mostly blocked pass-1 ships near the threshold and triggered expensive retries. v7-lite trusts deterministic checks and routes ambiguous cases straight to the human review queue — which is cheaper and faster than any LLM evaluator at this volume.

#### 3.5.2 Checks (all run; all failures collected)

| # | Check | Failure condition | Reason code |
|---|---|---|---|
| 1 | Schema shape | `patch`, `paragraph1`, `paragraph2`, `paragraph3`, `language` keys all present and well-typed | `SCHEMA_INVALID` |
| 2 | Non-empty paragraphs | `stripHtml(pN).trim().length >= 120` for N ∈ {1,2,3} | `EMPTY_BODY` |
| 3 | Skills integrity | `patch.skills.length === 6` AND every id ∈ Definitions skill-id set | `SKILLS_MALFORMED` |
| 4 | Work/project IDs | Every id in `patch.work[].id` and `patch.projects[].id` exists in base resume | `UNKNOWN_ID` |
| 5 | Language token | `language` ∈ `{"de","en"}` AND matches `plan.language_decision.value` | `LANGUAGE_TOKEN_MISMATCH` |
| 6 | Banned phrases | Substring/regex sweep with NFKC normalization, case-insensitive matching, against `data/banned-phrases.json` (language-scoped + universal) | `BANNED_PHRASE` |
| 7 | Quick language sniff | For DE letters: reject if output contains case-insensitive matches to a small English-only marker set (`"I am ", "Dear Hiring", "Kind regards"`). Restrict to letter body, not company-name fields, to avoid false positives on English company names embedded in DE letters. | `LANGUAGE_SNIFF` |
| 8 | Requirement keyword coverage | For every `plan.ranked_requirements[]` with `weight >= 0.7`, its `keyword` (or any `keyword_synonyms[]`) must appear at least once in `patch.work[].description ∪ patch.projects[].description ∪ P1 ∪ P2 ∪ P3` (case-insensitive). Coverage ratio must be ≥ `plan.requirement_coverage_target`. | `LOW_REQUIREMENT_COVERAGE` |

**Banned-phrase matching rules (closes the regex-bypass gap from review):**
- Apply Unicode NFKC normalization before matching.
- Case-insensitive by default.
- For `exact` entries: word-boundary aware (so `"Leidenschaft"` does NOT match the German compound `"Salesforce-Leidenschaft"` unless explicitly desired — the word-boundary regex `\bLeidenschaft\b` does NOT trigger in `"Salesforce-Leidenschaft"` either since `-` is a non-word character; if the user wants compound coverage, list the compound forms explicitly).
- For `regex` entries: as written, but tested against word-boundary edge cases in `tests/bannedPhrases.test.js`.
- Universal em-dash check: include `—` (U+2014), `–` (U+2013, en-dash), and `−` (U+2212, minus sign) — all three as banned in body text.

#### 3.5.3 Output

```json
{
  "validator_ok": false,
  "validator_fails": [
    {"reason_code": "EMPTY_BODY", "detail": "P2 body has 12 chars after strip"},
    {"reason_code": "LOW_REQUIREMENT_COVERAGE", "detail": "requirement[0].keyword 'Kubernetes' (synonyms: K8s, kube) not found in any bullet or paragraph; coverage 67% < target 80%"}
  ],
  "verdict": "revise" | "ship" | "review",
  "pass": 1
}
```

#### 3.5.4 Retry Controller

A small stateful node in n8n that orchestrates the tailor/validator loop. **Implemented as a single Code node** that calls the Tailor HTTP node and `/validate` endpoint via JS, since n8n's Loop Over Items primitive doesn't natively support stateful retry. This was a feasibility gap in the original v7 design.

```
state := { pass: 1, prior_draft: null, prior_validator_fails: [] }

# Pass 1
tailor_output := Tailor(plan, jd, base_resume)
validator := POST /validate (tailor_output, plan)

IF validator.validator_ok:
   verdict = "ship" → render PDFs

ELSE IF state.pass < 2:
   # Pass 2 — surgical retry
   state.pass := 2
   state.prior_draft := tailor_output
   state.prior_validator_fails := validator.validator_fails
   tailor_output_2 := Tailor(plan, jd, base_resume, state.prior_draft, state.prior_validator_fails)
   validator_2 := POST /validate (tailor_output_2, plan)
   IF validator_2.validator_ok:
      verdict = "ship"
   ELSE:
      verdict = "review", reason_codes = validator_2.validator_fails

ELSE:
   verdict = "review", reason_codes = validator.validator_fails
```

**Pass count:** maximum 2 Tailor calls per job. No third pass. Original v7's 3-pass cap was consumed by mechanical retries leaving no qualitative budget; v7-lite avoids the trap by going to review immediately on pass-2 fail.

#### 3.6 Output schema

```json
{
  "jobTitle": "Salesforce Developer",
  "language": "de",
  "patch": {
    "profile": "<p>...</p>",
    "showProjects": true,
    "showCertificates": true,
    "work": [{"id": "...", "description": "<ul>...</ul>"}],
    "skills": [/* all 6 entries, reordered */],
    "projects": [{"id": "...", "description": "<ul>...</ul>", "techStack": "...", "name": "..."}]
  },
  "paragraph1": "<p>...</p>",
  "paragraph2": "<p>...</p>",
  "paragraph3": "<p>...</p>",
  "requirement_to_evidence_map": [
    {
      "requirement_rank": 1,
      "addressed_in_text": "Two-plus years Apex/LWC at MV Clouds — AppExchange package shipped to ISVforce review."
    }
  ],
  "self_check": {
    "language_consistent": true,
    "no_banned_phrases": true,
    "all_hard_requirements_addressed": true,
    "all_six_skills_returned": true,
    "cover_letter_body_non_empty": true
  }
}
```

Note: `addressed_in_text` is now a free-text quote from the output (not a structured path like `"resume.work.0.bullet_2"`) — closes the parser-not-specified gap from review.

#### 3.7 Cost estimate

- Pass 1: ~6K input + ~1.1K output × Sonnet 4.6 ≈ **$0.025**
- Avg passes: ~1.2 (deterministic validator catches most issues mechanically; surgical retry succeeds most of the time)
- **Average tailor cost: ~$0.030/job**

---

### 4. (Reserved — LLM Critic removed)

The original v7 §4 described a Sonnet-based Critic with 6 hard-fails, 4 soft scores, a corpus filter, cosine similarity, and a 3-pass revise loop. **All cut in v7-lite.** Hard-fails are now in §3.5; coverage threshold is enforced by §3.5 check #8; soft scores (specificity, voice_consistency, template_uniqueness) are dropped because they primarily blocked pass-1 ships near the threshold and weren't earning their $25-40/mo at this volume.

The Retry Controller (was §4.7 in v7) is now §3.5.4.

---

### 5. Base Resume Audit

#### 5.1 Purpose and prerequisite status

The base resume is the floor under all generated output. Every bullet gets tailored, but none is invented. An audit happens BEFORE any pipeline work begins — it is part of Stage 1 of implementation.

#### 5.2 Process

```
Opus 4.7 reads data/resume.json
    ↓
Produces: docs/superpowers/evaluations/2026-04-19-base-resume-audit.md
    ↓
User reviews line-by-line, marks ☐ Approve / ☐ Edit / ☐ Reject per item
    ↓
Approved edits applied to data/resume.json (single git commit)
```

#### 5.3 Audit doc sections

1. **Health score** — overall 1–10 with summary rationale.
2. **Profile paragraph** — opener strength, metric presence, specificity. **Add: explicit check for German-recruiter skim fields (Aufenthaltstitel/visa, Deutschkenntnisse level, immediate availability) — see goal-alignment review note below.**
3. **Work entries** — per-bullet review: metric presence, verb-led, passive-voice flags, impact-first ordering.
4. **Projects** — per-description review: impact-first, tech stack concise, URLs present.
5. **Skills** — ordering recommendation (German tech market: Salesforce → Backend → Frontend → Cloud → Automation → Languages is the proposed default), keyword density per group.
6. **Education** — date formatting, stale coursework flags.
7. **Certificates** — currency check, deprecated-cert flags.
8. **Missing content opportunities** — suggestions for metrics that should be injected (e.g., "Bullet 3 has no user-count; if you have data, add it").
9. **Crown-jewel bullets** — ranked list of 3–5 strongest bullets across all sections, to be pinned as priority evidence in the Tailor system prompt.
10. **Positioning coherence check (NEW from goal-alignment review)** — flag if the user's targeting (Salesforce Developer + 2 yrs paid experience + Werkstudent/internship) reads as inconsistent to a DE recruiter. The audit is the place to surface and decide this, not the Tailor.

**Removed from v7-original:** the `Evidence Quality Tags` section (10 in original) and its sidecar tag file. Crown-jewel bullets pinned in the Tailor system prompt provide the same priority signal without index-drift risk.

#### 5.4 Time cost

~45 minutes of user review time, one-time. Audit doc + updated `resume.json` ship as one commit.

---

### 6. Exemplars + Style Guide + Banned Phrases

#### 6.1 Exemplars

**4 synthetic cover letters** (down from 6 in v7-original — register variants are dropped along with template pools) written by Claude, reviewed and edited once by user:

- 2 in German (one formal, one semi-formal — covers 95% of DE applications)
- 2 in English (same two registers)

Each exemplar is a complete 3-paragraph letter tuned to user's Salesforce Developer profile applying to a hypothetical representative role. They are the voice anchor for the Tailor.

**Storage:** `data/exemplars/{de|en}/{formal|semi_formal}.md` — 4 files, each ~400 words.

**User review:** ~40 minutes upfront, single review pass.

#### 6.2 Style guide

Language-specific guides — each a tight 600-word document covering:

- Tone/register by company type
- Paragraph structure (P1 hook → P2 evidence → P3 CTA)
- Target word counts per paragraph
- Recommended sentence structures + what to avoid
- Anschreiben cultural norms (DE) / US–UK cover letter norms (EN)

**Storage:** `data/styleguide/{de|en}.md`.

#### 6.3 Banned-phrase list

Deterministic string/regex list, maintained in `data/banned-phrases.json`:

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

Matching rules: see §3.5.2 banned-phrase rules (NFKC, case-insensitive, word-boundary-aware).

---

### 7. Review Queue

#### 7.1 Storage

New tab in the existing Google Sheets tracker: **"Review Queue"**.

#### 7.2 Columns

| Column | Source | Editable |
|---|---|---|
| Date | auto | no |
| Company | plan | no |
| Role | plan | no |
| JobId | auto | no |
| Reason Codes | validator (comma-separated) | no |
| Hard Fails | validator (condensed list) | no |
| P1 | tailor output | **yes** |
| P2 | tailor output | **yes** |
| P3 | tailor output | **yes** |
| Resume Patch (JSON) | tailor output | yes (advanced) |
| Approve? | user | **checkbox** |
| Status | auto | `Pending` / `Rendering` / `Approved` / `Sent` / `Rejected` / `PDF Failed` |

#### 7.3 Reason-code taxonomy

| Code | Trigger | Typical fix |
|---|---|---|
| `LANGUAGE_MIX` | check #1 + #5 + #7 combined | Manually translate or reject |
| `BANNED_PHRASE` | check #6 | Rewrite offending sentence |
| `EMPTY_BODY` | check #2 | Regenerate (pipeline bug if seen) |
| `LOW_REQUIREMENT_COVERAGE` | check #8 | Add bullet or rewrite P2 |
| `SKILLS_MALFORMED` | check #3 | Pipeline bug — investigate |
| `UNKNOWN_ID` | check #4 | Pipeline bug — Tailor invented an id |
| `LANGUAGE_TOKEN_MISMATCH` | check #5 | Pipeline bug — Tailor disagrees with plan |
| `LANGUAGE_SNIFF` | check #7 | Manual translation or reject |
| `SCHEMA_INVALID` | check #1 | Rerun job |
| `PLAN_FAILED` | Planner JSON malformed even after retry | Rerun job |
| `TAILOR_FAILED` | Tailor call failed all retries (§11) | Rerun job |
| `MAX_PASSES_EXHAUSTED` | 2 passes, validator still fails | Manual edit or skip |
| `TIMEOUT_BUDGET` | Job exceeded 10-min wall-clock (§11.3) | Rerun |
| `REQUEST_BUDGET_EXHAUSTED` | Job exceeded 10 LLM calls (§11.3) | Investigate loop behavior |

Removed from v7-original: `WRONG_TEMPLATE`, `GENERIC_P2`, `REPETITIVE_TEMPLATE`, `RESEARCH_CONFIDENCE_LOW`, `CRITIC_FAILED`, `COVERAGE_GAPS_HARD`. Each was tied to a feature now cut.

#### 7.4 "Approve Review Queue" sub-workflow — with row locking

A new lightweight n8n workflow triggered on a 5-minute cron (or manually):

```
1. Read Review Queue tab, filter: Status === "Pending" AND Approve? === true
2. For each matching row:
   a. ATOMIC: SET Status = "Rendering" via Google Sheets update — only if the
      current cell value is still "Pending" (use a conditional update; if the
      pre-condition fails, skip the row — another cron run is processing it).
   b. POST /generate-resume with edited resume_patch + metadata
   c. POST /generate-coverletter with edited P1/P2/P3 + metadata
   d. On both success:
      - Update row: Status = "Sent", write Resume File + Cover Letter File paths
      - Append row to main tracker tab with Status "Reviewed & Sent"
   e. On any failure:
      - Update row: Status = "PDF Failed", log error in Notes column
```

**Row-lock rationale:** the original v7.4 had no locking. A 5-min cron + concurrent user edits (toggling Approve, editing P2 mid-render) was a TOCTOU race. The `Status = "Rendering"` intermediate state, set atomically before any HTTP call, closes the race: a second cron run sees `Status != "Pending"` and skips. If the rendering call crashes, the row stays in `Rendering` and surfaces as a stuck row — a known-good failure mode that's easy to spot manually.

#### 7.5 Rejection path

User sets `Approve? = false` AND manually changes Status to `Rejected`. Row stays as history; no PDFs generated.

#### 7.6 Main tracker — Outcome column

The existing main tracker tab gets one new user-editable column: **`Outcome`**, with a controlled enum:

| Value | Meaning |
|---|---|
| `No Response` | Default; no reply received within 30 days |
| `Auto-Rejected` | Template rejection email from ATS |
| `Recruiter Reply` | Any human reply from company-side recruiter (not a rejection) |
| `Interview Invite` | First-round interview scheduled |
| `Offer` | Written offer received |

This is the **only callback-rate signal** the pipeline has. Filling it in is a user responsibility, not automated. Stage 13 (§10.5) aggregates this column.

---

### 8. Server changes (Express)

Three changes to `src/server.js` (Stage 1 — must land before any other pipeline work, since Stage 5 Planner tests depend on `/context` shape and Stage 7 retry controller calls `/validate`):

1. **Empty-body guard on `/generate-coverletter`:** reject requests where `stripHtml(paragraph1 + paragraph2 + paragraph3).trim().length === 0` with HTTP 422 and `reason_code: EMPTY_BODY`. Pipeline catches this and routes to review queue. **(This is also Stage 0 — see §10.1.)**

2. **New `POST /validate` endpoint:** accepts `{ tailor_output, plan }`, runs the 8 deterministic checks from §3.5.2, returns `{ validator_ok, validator_fails, verdict }`. Implemented by extending `src/validatePatch.js` with new check functions. Reuses `data/banned-phrases.json` and resume-id constants — those live on the server filesystem, which is exactly why this validator belongs in Express (closes the "where does Pre-Critic live" feasibility gap from review).

3. **No other server changes.** `buildResumeHtml`, `mergeCoverLetter`, `mergePatch` remain unchanged.

The original v7 §8.2 (`evidenceQuality` field on `/context`) is dropped along with the sidecar tag file.

---

### 9. Model Allocation Summary (via OpenRouter)

| Pipeline step | Model | Approx $/job |
|---|---|---|
| Match filter (10c) | Gemini 2.0 Flash-Lite | ~$0 |
| Match filter fallback tier 3 | Deterministic keyword rule (see below) | $0 |
| Planner | Sonnet 4.6 | ~$0.014 |
| Tailor (avg 1.2 passes) | Sonnet 4.6 | ~$0.030 |
| Validator | Deterministic (Express) | $0 |
| **Total per job** | | **~$0.044** |

**Match filter tier-3 deterministic fallback:** if both Gemini calls fail with `_apiError: true`, fall back to a code-only rule: accept if JD contains ≥2 terms from the user's crown-jewel keyword set (`Salesforce`, `Apex`, `LWC`, `Flow`, `Node.js`, `Express`, `React`, `TypeScript`) AND role title doesn't match the hard-reject regex from node 10a. Prevents silent zero-match days from API outages.

At 25 jobs/day × 20 working days/month = 500 jobs/month:
- **Steady state:** ~$22/month.
- **Bring-up phase (first 60 days, with cache misses + retry amplification + golden-set iteration + shadow eval ~$5-8/run × 5 runs):** ~$60-80/month.

**Both inside the $60-90 budget.** Original v7 design landed at $185-280/mo realistic — the headline failure that drove this revision.

---

### 10. Testing Strategy

#### 10.1 Staged implementation order

| Stage | Deliverable | Must pass before next stage |
|---|---|---|
| **0** | **v6 hotfix path:** language-consistency rule added to current Tailor prompt; empty-body guard added to `/generate-coverletter`. **Run for 14-30 days.** | If the user gets ≥1 Recruiter Reply in this window, **pause v7-lite** and continue v6+hotfix while diagnosing whether the bottleneck was ever pipeline quality. If 0 signal, proceed to Stage 1. |
| 1 | Server changes (`/validate` endpoint + empty-body guard already shipped in Stage 0) + base resume audit + `data/resume.json` updates | Audit approved by user, validator unit-tested |
| 2 | Style guides (DE + EN) + exemplars (4 files) + banned-phrases.json | User approval on exemplars |
| 3 | (REMOVED — was template pools) | — |
| 4 | Node 4 upgrade (companyData preservation) | Unit tests + golden set Stage-4 checks |
| 5 | Planner node + schema validation tests | Unit tests + golden set Stage-5 checks |
| 6 | Tailor prompt rewrite + Sonnet integration + `cache_control` breakpoint | Unit tests + golden set Stage-6 checks |
| 7 | Retry Controller (single n8n Code node, calls Tailor + `/validate`) | Unit tests + golden set Stage-7 checks |
| 8 | Review Queue tab + Approve Review Queue sub-workflow with row locking | End-to-end test with 1 manually-flagged row, including a deliberate concurrent-edit race test |
| 9 | (merged into Stage 1 — server changes go first) | — |
| 10 | Full integration pass | Full golden set (9 jobs) passes |
| 10.5 | Shadow evaluation against v6 on 20 historical jobs | v7-lite beats v6+hotfix on ≥80% of shadow jobs (note: bar shifts since the v6 baseline is also hotfixed in Stage 0) |
| 11 | Live 5-job batch | Ship-rate ≥50%, review queue behaves correctly, no hard-fails in shipped output |
| 12 | Live 25-job batch | Ship-rate ≥70%, review queue ≤10 flagged, no hard-fails in shipped output |
| 13 | 60-day callback review | Callback-window decision (see §10.5) |

**Calendar realism:** Stages 0-2 are user-review-bottlenecked (audit ~45min, exemplars ~40min). Realistic Stage 1-2 calendar: 3-4 days. Stages 4-7 are dev work: 1-2 weeks. Stages 10.5-12 are validation: 1 week. **Total realistic: 3-4 weeks** to live, plus the 14-30 day Stage 0 window.

#### 10.2 Unit tests (by component)

- `tests/validatePatch.test.js` — extended for new schema fields and the 8 §3.5.2 checks (existing file).
- `tests/planSchema.test.js` — validates Planner output against schema; rejects malformed plans.
- `tests/bannedPhrases.test.js` — regex and exact-match detection; word-boundary correctness; NFKC normalization; em-dash variants.
- `tests/retryController.test.js` — Tailor → validator → revise → ship/review state machine; pass-2 cap; surgical-retry feedback shape.

**Removed from v7-original:** `tests/templateLRU.test.js`, `tests/similarity.test.js`, `tests/criticVerdict.test.js`, `tests/evidenceQuality.test.js`. Each was tied to a feature now cut.

#### 10.3 Golden set (9 JDs)

Five variety cases + four regression cases pulled directly from the 2026-04-18 failures:

| # | Job | Language | Role type | Purpose |
|---|---|---|---|---|
| G1 | SAP Salesforce Developer (Walldorf) | DE | Salesforce | Baseline happy path |
| G2 | N26 Backend Engineer (Berlin) | DE | Backend | Non-Salesforce tech path |
| G3 | Celonis AI Engineer | EN | AI/ML | English + stretch-role fit |
| G4 | A German scaleup fullstack role (50–200 employees, semi-formal register) | DE | Fullstack | Register variation |
| G5 | Bosch Data Engineer | EN | Data | Under-evidenced role type |
| G6 | Bertrandt Salesforce (2026-04-18 job) | DE | Salesforce | **Regression:** LANGUAGE_MIX — must produce German bullets |
| G7 | DE letter from 2026-04-18 with "Die [Noun]" P1 | DE | any | **Regression:** model-tic avoidance via negative exemplars |
| G8 | CLARK Holding SE (2026-04-18) | DE | Salesforce | **Regression:** EMPTY_BODY — must produce non-empty letter |
| G9 | apaleo (2026-04-18) | DE | any | **Regression:** EMPTY_BODY — different trigger path |

Each golden job must produce a user-signable output. Iteration loop: run → hand-review → tune → re-run until all 9 pass.

#### 10.4 Shadow evaluation (Stage 10.5)

Replay 20 matched jobs from `Get_an_execution.json` through v7-lite WITHOUT writing PDFs or Sheet rows. Produce a diff doc at `docs/superpowers/evaluations/2026-04-XX-v7lite-shadow-eval.md` with per-job comparison on three axes:

- Language consistency (hard check)
- Requirement coverage (Planner score)
- Banned-phrase hit count (deterministic, comparable to v6+hotfix)

Must hit **v7-lite wins on ≥80%** of shadow jobs vs v6+hotfix before any live batch.

**Cost:** 20 jobs × $0.044 = ~$0.88 per shadow run. 5-8 prompt iterations during Stage 6 dev = ~$4-7 total. Down from $40-60 in v7-original.

#### 10.5 Rollback plan and callback-window decision

**Baseline acknowledgment:** As of 2026-04-20 the user has received 0 interview invites from v6 output. **Stage 0 (§10.1) is now the first decision gate** — it isolates whether quality is the bottleneck. v7-lite Stage 13 only fires if Stage 0 produces no signal.

**Backup & staging:**

- Before Stage 1 begins, current pipeline state is saved to branch `pipeline-v6-backup`.
- Each stage commits its own workflow JSON in `data/Job_Application_Automator_v7lite_stage{N}.json`.

**Stage 13 — 60-day callback review (decision gate):**

Defined decision 60 calendar days after Stage 12 goes live, evaluated against the `Outcome` column of the main tracker (§7.6):

| 60-day outcome | Decision |
|---|---|
| ≥1 Interview Invite AND ≥3 Recruiter Replies | **Continue** — v7-lite is working; iterate on margins |
| 0 Interview Invites AND ≤1 Recruiter Reply | **Revisit non-pipeline factors first.** Treat as evidence the bottleneck is targeting (which jobs?), positioning (resume coherence — see §5.3 #10), or channel (portal vs LinkedIn DM). Do NOT auto-rollback to v6 (v6 had the same 0-interview problem). |
| Mixed / sub-threshold volume | Extend review window another 30 days |

**Volume-floor caveat (added from review):** the original spec required "≥100 applications" for a Continue/Revisit decision. If the user only sends 60-80 in 60 days (review-queue bottleneck, holidays, Apify quotas), the matrix would say "Extend" indefinitely. **New rule:** if volume is <80 after 60 days, treat the bottleneck as throughput first — investigate review-queue volume and pre-filter aggressiveness — before any Continue/Revisit decision.

**Operational rollback triggers:**

- In-pipeline hard-fail rate in *shipped* output > 0 across any 25-job batch → halt pipeline, fix root cause, re-run Stage 10.5 shadow eval before resuming.
- Monthly spend > $90 (top of stated budget) → halt and audit model call counts / cache hit rates.

---

### 11. Retry & Backoff Policy (LLM + HTTP calls)

Distinct from the Tailor/validator loop (which is a *semantic* retry): this covers *network-level* retries for any outbound call the pipeline makes.

#### 11.1 Which calls this covers

| Call | Network retries |
|---|---|
| OpenRouter → Planner / Tailor | Yes |
| Gemini match filter (10c, 10e) | Yes |
| Express `/validate` | Yes |
| Express `/generate-resume` / `/generate-coverletter` | Yes |
| Google Sheets append | Yes |

#### 11.2 Policy

- **Max retries per call:** 2 (so up to 3 attempts total per call)
- **Backoff:** exponential — 1s, then 3s
- **Retry triggers:** HTTP 429, HTTP 5xx, timeout, network error, `_apiError: true` on JSON parse failure
- **Non-retry triggers:** HTTP 4xx (except 429), explicit content-filter/policy error — fail fast, route to review
- **On final failure:**
  - For Planner / Tailor: route job to review queue with `reason_code: PLAN_FAILED` / `TAILOR_FAILED`
  - For Match filter: tier-3 deterministic keyword fallback (see §9)
  - For `/generate-*`: mark the sheet row `Status = "PDF Failed"` and log error in Notes column

#### 11.3 Global per-job budget — corrected math

A single job attempt across all retries must not exceed:

- **Wall-clock:** 10 minutes end-to-end (timer starts at node 9 dequeue)
- **LLM calls:** **10 total** (covers 1 planner + 2 tailor + 7 margin for network-layer retries — see breakdown below)

**Real ceiling math (closes the v7-original undercount):**
- Planner: 1 logical call × up to 3 attempts = 3 calls worst case
- Tailor pass 1: 1 logical call × up to 3 attempts = 3 calls
- Tailor pass 2: 1 logical call × up to 3 attempts = 3 calls
- Total worst case: **9 LLM calls**, budget set to 10 with 1 margin.

Exceeding either halts that job, routes to review queue with `reason_code: TIMEOUT_BUDGET` or `REQUEST_BUDGET_EXHAUSTED`, and pipeline continues with next job.

Implementation: a single counter threaded through the Retry Controller Code node (§3.5.4) — increments before every OpenRouter HTTP call, halts the loop if exceeded.

---

### 12. Observability

Minimal logging that makes the pipeline's black box diagnosable without building a dashboard.

#### 12.1 Correlation ID

Every job carries `jobId` (already present — the job URL) as the correlation key. It appears in:
- Every n8n node's logged output for that job
- Every Express server log line for calls tied to that job
- Every row in the main tracker and review queue

#### 12.2 Structured JSONL logs

Every pipeline stage writes one JSONL line per job to a daily file:

```
output/YYYY-MM-DD/Logs/pipeline.jsonl
```

Schema per line:

```json
{
  "ts": "2026-04-20T09:15:32.411Z",
  "jobId": "https://www.linkedin.com/jobs/view/...",
  "stage": "planner" | "tailor" | "validator" | "pdf_resume" | "pdf_cover" | "sheet_log",
  "pass": 1,
  "model": "anthropic/claude-sonnet-4-6",
  "latency_ms": 4120,
  "input_tokens": 7834,
  "output_tokens": 612,
  "cache_read_tokens": 6200,
  "cost_usd": 0.021,
  "verdict": "ship" | "revise" | "review" | null,
  "reason_codes": ["LOW_REQUIREMENT_COVERAGE"],
  "error": null
}
```

#### 12.3 SLIs (watched weekly, not paged)

| SLI | Target | Source |
|---|---|---|
| p95 end-to-end latency per job | ≤ 4 min (down from 6 min — fewer LLM stages) | `pipeline.jsonl` |
| Pipeline error rate | ≤ 3% of jobs ending in non-review failure | Count of jobs with `error != null` on terminal stage |
| Avg passes per job (tailor) | ≤ 1.3 | mean of max(pass) per jobId |
| Ship-rate (rolling 25-job window) | ≥ 70% from Stage 12 onward | verdict == "ship" / total |
| Weekly model spend | within 20% of §9 estimate (~$5-8/week) | sum(cost_usd) |
| Validator fail rate (pass 1) | < 25% | count of jobs where `validator_ok === false` on pass 1 / total |

#### 12.4 Index refresh

Spend snapshot and ship-rate get appended to `docs/superpowers/evaluations/weekly-kpis.md` every Sunday (manual for now).

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Stage 0 fails to produce signal — proves quality wasn't the bottleneck | Medium | Low cost (2 hr) | This is the *whole point* of Stage 0; failing fast saves $80/mo and 4 weeks |
| Sonnet 4.6 produces noticeably weaker German prose than Opus 4.7 would have | Medium | Medium | If the Stage 12 batch shows a quality regression vs v6+hotfix, switch *only the Tailor* to Opus 4.7 and accept ~$60/mo Tailor cost — still inside $60-90 budget; monitor |
| OpenRouter caching semantics change | Low | Medium | Monitor cost weekly; system block is small (4 exemplars + crown-jewel + style guide) and easy to port |
| Sonnet 4.6 occasionally produces invalid JSON despite tool-use | Low | Low | 1 retry baked into Planner/Tailor, fall through to review after |
| Apify scrapers drift their output schemas | Medium | Medium | BOARD_CONFIG is isolated in node 4; schema changes fix there without downstream impact |
| Review queue becomes user bottleneck | Medium | Medium | Target ≤10 flagged/day; if higher, investigate Tailor failure rate first, retune validator thresholds second |
| User approves poor-quality letters without careful review | Low | High | Reason codes make bad letters obvious at a glance; `MAX_PASSES_EXHAUSTED` always deserves skepticism |
| v7-lite shadow eval loses to v6+hotfix on ≥20% of jobs | Medium | High | Fix regressions inline before any live batch; `pipeline-v6-backup` branch preserved |
| Stage 13 produces zero interview invites | Medium | High | Triggers a re-brainstorm on positioning/targeting/channel rather than auto-rollback |
| Concurrent-edit race in Approve Review Queue sub-workflow | Low | Medium | `Status = "Rendering"` atomic guard (§7.4) closes the TOCTOU window |
| Banned-phrase regex bypasses (case, NBSP, Unicode variants) | Medium | Low | NFKC + case-insensitive + word-boundary rules in §3.5.2; covered by `tests/bannedPhrases.test.js` |

---

## Open Items (for the implementation plan to resolve)

1. Exact exemplar content — Claude drafts 4 letters during Stage 2; user approves/edits once.
2. Crown-jewel bullet selection — output of Stage 1 base resume audit.
3. Negative-exemplar bullets (model tics to avoid) — drafted during Stage 6 from the C3 patterns observed in 2026-04-18 batch.
4. Retry Controller exact n8n implementation — single Code node calling HTTP nodes via `$http` is the planned shape; verify in Stage 7.

---

## Success Criteria

Organized by what's measurable at each time horizon.

**Stage 0 (immediate, 14-30 days):**

- **C1 hotfix:** 0 wrong-language bullets in any v6 output.
- **C2 hotfix:** 0 empty-body PDFs reach the user's outbox.
- **Signal check:** ≥1 Recruiter Reply across the Stage 0 window. If yes, v7-lite is descoped and Stage 1+ is paused.

**Within first post-launch 25-job batch (Stage 12):**

- **Quality:** Hard-fail rate (empty bodies, language mixes, banned phrases) in shipped output = 0.
- **Operational:** ship-rate ≥70%; review queue volume ≤10 flagged/day; user review time ≤10 min/day.
- **Cost:** monthly spend in $25-90 range (inside stated budget).

**Within first week (steady state):**

- **Regression resilience:** all 4 golden regression cases (G6–G9) continue to pass on every subsequent prompt/code change.
- **Observability:** every job has a complete `pipeline.jsonl` trace with a `verdict` field set.
- **Outcome tracking:** `Outcome` column on the main tracker gets filled in for ≥80% of applications that are >14 days old.

**60-day review (Stage 13 — the actual KPI):**

- **Absolute interview rate:** ≥1 `Interview Invite` across ≥80 applications.
- **Engagement rate:** ≥3 `Recruiter Reply` outcomes across ≥80 applications.
- **If neither target is hit:** Stage 13 decision matrix (§10.5) triggers a re-brainstorm focused on *non-pipeline* factors (positioning, targeting, channel) rather than another pipeline rebuild.
