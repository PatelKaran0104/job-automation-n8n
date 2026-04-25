# Pipeline Quality Overhaul — Design Spec

**Date:** 2026-04-19 (lean revision 2026-04-20)
**Author:** Brainstorming session with Claude (Opus 4.7)
**Target pipeline version:** v7
**Target audience:** Karan — Salesforce Developer seeking ANY relevant role in Germany (internship / Werkstudent / full-time / remote). 25 jobs/day.
**Budget:** ~$60–90/month (OpenRouter, ~25 jobs/day).
**Directive:** Maximize interview callbacks at minimum complexity. Cut anything that doesn't move the needle for a recruiter's 8-second skim at a mid-tier German firm.

---

## Problem Statement

The 2026-04-18 production run (evaluated in `docs/superpowers/evaluations/2026-04-18-run-quality-review.md`) exposed four critical failure modes in pipeline v6:

1. **C1 — Language mismatch (50%):** 9/18 German resumes shipped with English work/project bullets because crown-jewel pinning was interpreted as "do not modify."
2. **C2 — Empty cover letters (2/18):** CLARK Holding and apaleo shipped PDFs with empty body paragraphs under real company names. No server-side guard.
3. **C3 — Template repetition (85%):** 11/13 German P3 closers were near-identical; 9/13 P1 openers used the same `"Die [Noun]"` pattern.
4. **C4 — Length/specificity drift:** P2 hit target length 1/18 times; P3 hit 0/18. gpt-4o-mini's base capability ceiling.

Medium failures (banned phrases slipping through, missing skills, generic letters) compounded these. The verdict: fix-and-polish on the existing prompt architecture is insufficient — a deeper rebuild is warranted.

---

## Goals

Each goal below is measurable and has a corresponding acceptance criterion in §12.

- **G1 — Zero hard-fail shipped output.** No letter ships with empty paragraphs, wrong-language bullets, banned-phrase matches, or missing skill entries, as checked by the pre-critic validator and LLM critic. Measured on the golden set and on the first 25 live jobs.
- **G2 — Keyword-targeted tailoring.** Every shipped resume patch covers ≥80% of hard requirements (weight ≥0.7) identified by the Planner. Measured by pre-critic validator keyword check.
- **G3 — Full skills coverage with role-fit ordering.** `patch.skills` contains all 6 skill entries (ids preserved verbatim) on every shipped output, reordered such that the most role-relevant group is first. Measured by pre-critic validator.
- **G4 — Auto-ship majority.** ≥70% of jobs ship on pass 1 (no retries needed); the remainder land in the review queue tagged with actionable reason codes (§7.3).
- **G5 — Measurable interview impact.** v7 must establish a non-zero interview-invite rate within 60 days of cutover. Outcomes tracked per application (§12).

**Explicitly NOT a goal** (dropped from the aggressive v7 draft — see "What we cut and why" below): template-uniqueness scoring across different companies, multi-pass qualitative refinement, voice-consistency scoring, deep company research (GitHub/News), evidenceQuality tag sidecar files. These target a recruiter audience that doesn't exist for the Werkstudent/internship/entry-level German market.

## Non-Goals

- Switching off n8n orchestration (keep it; extend v6).
- Writing a custom web UI for the review step (Google Sheet tab suffices).
- Re-architecting the Express server beyond adding an empty-body guard.
- Agentic web-browsing research (evaluated and rejected).
- Cloud-based observability (single-user tool; local JSONL logs suffice).
- Enriched company research (Google News, GitHub org fetch, /about page fetch). Existing Apify scrapers already provide enough company context at zero marginal cost.
- Template pools / LRU rotation / cosine-similarity uniqueness. Repetition across 25 different employers is invisible; the real risk is *model tics*, which are solved cheaply via 2-3 negative exemplars in the Tailor prompt.
- Multi-pass qualitative revision. One pass + one mechanical retry + review queue is the ship path.
- `evidenceQuality` sidecar tag file. Audit is valuable; the tag scaffolding isn't.
- `voice_consistency` / `template_uniqueness` / composite Critic score. Hard-fails + keyword coverage is all the Critic needs to gate on.

---

## Definitions

Terms used throughout this spec with precise meaning:

- **Concrete company fact** — a string that appears in `evidence_json.safe_facts_to_cite`. By construction (§1.3), such a string has `confidence === "high"`, a named source, age ≤18 months, and must be substring-verifiable against the raw scraped text (see §1.4).
- **The 6 skill groups** — the fixed entries in `data/resume.json → content.skill.entries`, identified by id:
  - `7e0af879-e5a3-457e-ab86-634363abf266` — Languages
  - `4e5c9b0d-2b32-48a6-9b61-0c320df13632` — Frontend
  - `b38fcbc7-ae5a-41f8-87c3-8e1fd55a8445` — Backend & APIs
  - `c7231132-d4b1-47eb-9bee-a66c7756ce1d` — Cloud & DevOps
  - `9a905d12-825c-4090-a90c-3ff010a9d8b4` — Salesforce Platform
  - `07d4ce0e-0dcf-4193-8425-06a3e01fe20c` — Automation & AI
- **Banned phrase** — a string or regex in `data/banned-phrases.json` (§6.3). Applies to all languages specified in that file.
- **Hard-fail** — any of the 6 deterministic checks in §4.3 returning `false`. A hard-failing output cannot ship; it enters revise (pass 1–2) or review (pass 3 or plateau).
- **Crown-jewel bullet** — one of the top 5 bullets identified in the base-resume audit's "Crown-Jewel Bullets" section (§5). These are pinned-priority evidence for the Tailor, embedded directly in the Tailor system prompt as a small list.
- **Acceptance criterion** — a measurable condition that must hold before the corresponding stage (§10) or KPI (§12) is considered met. Distinct from a "goal" which is aspirational prose.

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
[NEW: RESEARCH EXTRACTOR — Sonnet 4.6]
  Input: Apify companyData only (no new enrichment fetches)
  Outputs: evidence_json (structured, provenance-tagged) + evidence_brief (≤200w)
         ↓
[NEW: PLANNER — Sonnet 4.6]
  Outputs: language_decision, role_classification, ranked_requirements,
           evidence_mapping, must_use_keywords, company_hooks,
           tone_profile, show_cert/show_proj, plan_confidence
         ↓
[UPGRADED: TAILOR — Opus 4.7, prompt-cached, single-pass]
  Inputs: plan + evidence + JD + base_resume + 1 exemplar per language + crown-jewel bullets
  Outputs: resume_patch + 3 paragraphs + requirement_to_evidence_map + self_check
         ↓
[NEW: PRE-CRITIC VALIDATOR — deterministic code]
  If FAIL on pass 1 → one auto-retry with surgical instructions → re-run Pre-Critic
  If FAIL on pass 2 → route to review queue
  If PASS → Critic
         ↓
[NEW: CRITIC — Sonnet 4.6, single-pass]
  Evaluates 6 hard-fails + requirement_coverage
  Verdict: ship | review (no revise path; qualitative issues → review)
         ↓
[GATE ON CRITIC VERDICT]
  ├ ship → [Resume PDF + Cover Letter PDF] → Log to main tracker (Outcome="No Response")
  └ review → [Log to Review Queue tab with reason_codes — NO PDF]
                         ↓
              [USER edits + Approves in sheet]
                         ↓
[NEW: APPROVE REVIEW QUEUE SUB-WORKFLOW — polls every 5 min]
  For each Approved & Pending row: render PDFs → mark Sent → log to main tracker
```

### Module Boundaries

| Module | Responsibility | Interface in | Interface out |
|---|---|---|---|
| Normalize & Merge (v7) | Unify scraper outputs; preserve company data | Raw scraper JSON per source | `{jd, company, url, location, companyData}` |
| Research Extractor | Turn raw scraped company data into structured evidence | `companyData` | `evidence_json`, `evidence_brief` |
| Planner | Decide strategy (what to write) | JD + base_resume + evidence_json | `plan` JSON |
| Tailor | Write the resume patch + cover letter (single pass) | plan + evidence + JD + base_resume + [prior draft + pre-critic fails on mechanical retry] | `tailor_output` JSON |
| Pre-Critic Validator | Deterministic mechanical checks; at most one auto-retry | `tailor_output`, `plan` | `pre_critic_ok` + `pre_critic_fails[]` |
| Critic | Hard-fail + keyword coverage verdict | plan + evidence + tailor_output | `ship` or `review + reason_codes` |
| Review Queue | Human correction surface | Tailor output + reason codes | Approved edits → PDF trigger |
| PDF Renderer | Existing Express `/generate-resume` + `/generate-coverletter` | patch + paragraphs + meta | PDF files |

Each module has one clear purpose, a well-defined input contract, and can be tested in isolation.

---

## Detailed Component Design

### 1. Research Bundle

#### 1.1 Preserving existing scraper data (node 4 upgrade)

Current pipeline discards most of what scrapers return. v7 preserves a unified `companyData` object per job:

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
  "raw_about_text": null,
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

Missing fields become `null`. No new scrapes or API calls at this stage.

#### 1.2 Research Extractor (Sonnet 4.6)

**No new enrichment fetches.** The Apify scrapers already provide enough company signal for a recruiter's 8-second skim. Extractor consumes only `companyData` + JD text.

Outputs:

**`evidence_json`** (strict schema):

```json
{
  "research_confidence": "high" | "medium" | "low",
  "company": {
    "name": "...",
    "domain": "...",
    "hq_location": "..."
  },
  "positioning": {
    "headline": "...",
    "confidence": "high" | "medium" | "low",
    "source": "company_site" | "about_page" | "news" | "scraper" | "inferred"
  },
  "product_terms": [
    { "term": "...", "confidence": "high|medium|low", "source": "..." }
  ],
  "stack_signals": [
    { "term": "...", "source": "...", "confidence": "..." }
  ],
  "tone_markers": ["customer-obsessed", "enterprise-grade", "..."],
  "recent_news": [
    {
      "fact": "Announced Joule AI assistant GA in March 2026",
      "date": "2026-03-14",
      "source": "news",
      "confidence": "high",
      "relevance": "high"
    }
  ],
  "safe_facts_to_cite": [
    "Walldorf-based",
    "Joule AI assistant is GA",
    "S/4HANA cloud migration focus 2026"
  ],
  "soft_signals": [
    "Glassdoor reviews describe collaborative culture",
    "Job posts emphasize global distributed teams"
  ],
  "rejected": [
    { "text": "...", "reason": "too old" | "unverified" | "off-topic" }
  ]
}
```

**`evidence_brief`**: a 200-word human-readable paragraph summarizing positioning + recent context. Used only for tone-setting in the Tailor; it is NOT the source of citable facts.

**Rules hard-coded into the extractor's system prompt:**

- A fact may only appear in `safe_facts_to_cite` if it has a concrete Apify-sourced basis AND is not older than 18 months.
- `soft_signals` must NEVER be quoted directly in cover letters — they inform tone only.
- If fewer than 2 items land in `safe_facts_to_cite`, set `research_confidence: "low"` (and the pipeline accepts a generic letter — not every job has enough public signal).

**Model config:** Sonnet 4.6, temperature 0, JSON mode via tool-use. ~2K input + ~500 output tokens per call (~$0.01).

#### 1.3 Substring verification pass (deterministic, post-extractor)

After the Sonnet 4.6 extractor returns, a deterministic code step runs **before** the Planner:

```
raw_text_corpus := concat of all string fields on companyData
                   (name, industry, tech_attributes joined, keywords joined,
                    raw_about_text if present, any description fields)

For each fact in evidence_json.safe_facts_to_cite:
   normalize(fact) := lowercase, strip punctuation, collapse whitespace
   normalize(raw_text_corpus) same
   IF normalize(fact) NOT substring of normalize(raw_text_corpus):
      Move fact from safe_facts_to_cite → rejected with reason: "unverified_substring"
      Log warning: { fact, company, extractor_source }

IF safe_facts_to_cite.length < 2 after pruning:
   Set research_confidence = "low"
```

Rationale: the LLM extractor can paraphrase or hallucinate. Substring verification is the cheapest, most reliable guardrail against citing invented company facts — the single most interview-killing failure mode.

Implementation: a small Code node in n8n between the extractor call and the Planner.

---

### 2. Planner

#### 2.1 Purpose

The Planner is plan-then-execute for application writing. It pre-chews the JD + base resume + evidence into a deterministic plan object the Tailor executes. This separation is the single biggest quality lever: the Tailor no longer has to do requirement extraction AND writing in one pass.

#### 2.2 Inputs

- JD full text (from matched job)
- Base resume context (from `/context`)
- `evidence_json` (from extractor)

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
      "fact": "Joule AI assistant GA in March 2026",
      "placement": "P1" | "P2" | "P3" | "resume_profile" | "resume_bullet",
      "technique": "reference_fact" | "mirror_vocabulary" | "connect_to_experience",
      "hint": "Tie their AI direction to my document-generation pipeline bullet"
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
  "plan_confidence": "high" | "medium" | "low"
}
```

#### 2.4 Key field semantics

- `language_decision` is authoritative downstream — Tailor and Critic respect it absolutely.
- `ranked_requirements[].weight` drives critic `requirement_coverage` math.
- `evidence_mapping` binds JD requirements to actual base-resume IDs. Tailor is forbidden from citing evidence outside this list.
- `must_use_keywords` are ATS-critical. Tailor must include all of them in output.
- `company_hooks` are drawn exclusively from `evidence_json.safe_facts_to_cite` — never from `soft_signals`. If research_confidence is "low", company_hooks may be empty (accepted).
- `risks_to_avoid` are hard negative constraints the Tailor must respect.
- `plan_confidence: "low"` triggers stricter Critic thresholds and lower auto-ship probability.

#### 2.5 Model config

Claude Sonnet 4.6. No extended thinking — the schema is structured enough that standard output suffices. Temperature 0. Strict JSON output via tool-use.

#### 2.6 Failure handling

- Malformed JSON → 1 retry.
- Still malformed → fall back to minimal default plan (no hooks, no story_angles, `plan_confidence: "low"`) and force route to review queue with `reason_code: PLAN_FAILED`.
- Pipeline never blocks.

#### 2.7 Cost estimate

~4K input + ~1K output per plan ≈ $0.02 per job.

---

### 3. Tailor

#### 3.1 Model config

Claude Opus 4.7, no extended thinking. Temperature 0.3 (slight creative latitude for prose). Strict JSON via tool-use.

#### 3.2 Prompt architecture

**System block (stable across batch — prompt-cached via OpenRouter `cache_control`):**

1. Role + meta-instruction
2. Style guide (language-switched: DE or EN, selected by `plan.language_decision.value`)
3. Three exemplars in the target language (synthetic, approved upfront — see §4)
4. Banned-phrase list (DE + EN)
5. Opener/closer template pools (partitioned by register — see §3.3)
6. Global rules (see §3.4)
7. Output schema (as Anthropic tool definition)

**Hard discipline:** nothing job-specific goes into the system block. All per-job data — JD, company, plan, template seeds, prior draft, critic feedback — goes in the user block below the cache breakpoint.

**User block (per-job):**

```xml
<plan>{...full planner JSON...}</plan>
<evidence_json>{...}</evidence_json>
<evidence_brief>...</evidence_brief>
<jd>...</jd>
<base_resume>{...context with evidenceQuality tags...}</base_resume>
<template_seeds>{"p1_sub_pool": "formal_de", "p1_index": 2, "p3_sub_pool": "formal_de", "p3_index": 5}</template_seeds>
<!-- ONLY on retry: -->
<prior_draft>{...}</prior_draft>
<critic_feedback>{...structured soft_issues + hard_fails...}</critic_feedback>
```

#### 3.3 Template pools

Each pool (P1 DE, P1 EN, P3 DE, P3 EN) is partitioned by register:

```
P1_DE_POOL = {
  "formal_de":        [v1, v2, v3, v4],   // 4 variants
  "semi_formal_de":   [v1, v2, v3, v4],
  "startup_casual_de":[v1, v2, v3, v4]
}
```

Variants are distinct opening patterns (structure + vocabulary), all pre-vetted against the banned list.

**Selection:**

1. Planner picks the sub-pool via `plan.tone_profile.register`.
2. Within the sub-pool, the **least-recently-used** variant (across the last 10 jobs, tracked in a `template_history` field in a state sheet or JSON file) is selected.
3. The selected `(sub_pool, index)` flows into `template_seeds` in the user block.

**Critic still validates fit** — if a mismatched template slipped through (edge case), Critic flags `WRONG_TEMPLATE` and the job routes to review.

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

TEMPLATE SEEDS (hard):
  - Paragraph 1 must begin with the opener pattern at template_seeds.p1_index from sub-pool template_seeds.p1_sub_pool.
  - Paragraph 3 must begin with the closer pattern at template_seeds.p3_index from sub-pool template_seeds.p3_sub_pool.
  - Record the seeds you actually used in output.template_seeds_used.

EVIDENCE DISCIPLINE (hard):
  - You may ONLY cite resume evidence listed in plan.evidence_mapping.
  - You may ONLY cite company facts listed in plan.company_hooks or evidence_json.safe_facts_to_cite.
  - Never cite anything from evidence_json.soft_signals directly.

KEYWORD COVERAGE (hard):
  - Every term in plan.must_use_keywords must appear at least once in your output (resume patch OR cover letter).

BANNED CONTENT (hard):
  - The phrases in the banned list are forbidden anywhere in output.
  - No em-dashes (—). Use comma, period, or semicolon.
  - No "I am writing to apply", "Hochmotiviert", "Mit großem Interesse", "passionate", "leidenschaftlich".
```

#### 3.5 Output schema

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
      "addressed_in": ["resume.work.0.bullet_2", "P2.sentence_1"],
      "specific_language": "2+ years Apex/LWC, AppExchange package shipped"
    }
  ],
  "template_seeds_used": {
    "p1_sub_pool": "formal_de",
    "p1_index": 2,
    "p3_sub_pool": "formal_de",
    "p3_index": 5
  },
  "self_check": {
    "language_consistent": true,
    "no_banned_phrases": true,
    "all_hard_requirements_addressed": true,
    "all_six_skills_returned": true,
    "template_seeds_used": true,
    "cover_letter_body_non_empty": true
  },
  "coverage_gaps_remaining": [
    {"requirement_rank": 3, "reason": "no direct evidence in base resume for K8s depth"}
  ]
}
```

#### 3.6 Retry behavior (revise loop)

Controlled by the Retry Controller (§4.5):

```
pass 1 → Critic → verdict
   ├ ship → proceed to PDF
   ├ revise → pass 2 with prior_draft + critic_feedback
   └ review → queue

pass 2 → Critic → verdict (same 3 outcomes)
pass 3 → Critic → verdict; if revise again → force review
```

Max 3 tailor passes. Plateau stop: `(score_delta < 5%) AND (hard_fails_resolved_this_pass === 0)` → route to review.

#### 3.7 Cost estimate

- Pass 1: ~8K input (most cache-read) + ~1.1K output ≈ $0.20
- Avg passes: ~1.3
- Average tailor cost: **~$0.26/job**

---

### 3.5 Pre-Critic Validator (Deterministic)

A pure-code validator that runs on every Tailor output **before** any Critic LLM call. Catches mechanical failures the Critic should not waste tokens on, and produces a `pre_critic_fails` list that the Tailor sees on retry with surgical instructions.

#### 3.5.1 Why deterministic-first

The 2026-04-18 run shows 4 of the 6 most-costly failure modes are mechanically detectable (empty paragraph bodies, wrong language token, missing skill IDs, banned-phrase hits). Running these as code saves a Critic round-trip and gives the Tailor a specific, unambiguous revision instruction ("P2 body is empty — regenerate") instead of an LLM-written one.

#### 3.5.2 Checks (all run; all failures collected)

| # | Check | Failure condition | Reason code |
|---|---|---|---|
| 1 | Schema shape | `patch`, `paragraph1`, `paragraph2`, `paragraph3`, `language` keys all present | `SCHEMA_INVALID` |
| 2 | Non-empty paragraphs | `stripHtml(pN).trim().length >= 120` for N ∈ {1,2,3} | `EMPTY_BODY` |
| 3 | Skills integrity | `patch.skills.length === 6` AND every id ∈ Definitions skill-id set | `SKILLS_MALFORMED` |
| 4 | Work/project IDs | Every id in `patch.work[].id` and `patch.projects[].id` exists in base resume | `UNKNOWN_ID` |
| 5 | Language token | `language` ∈ `{"de","en"}` AND matches `plan.language_decision.value` | `LANGUAGE_TOKEN_MISMATCH` |
| 6 | Banned phrases | Substring/regex sweep of full output against `data/banned-phrases.json` (language-scoped + universal) | `BANNED_PHRASE` |
| 7 | Quick language sniff | For DE letters: reject if output contains any of a small English-only marker set (`"I am", "Dear Hiring", "Kind regards"`) as case-insensitive substrings, and vice versa. This is a cheap catch for the 2026-04-18 C1 failure class — full language verification still happens in the Critic. | `LANGUAGE_SNIFF` |
| 8 | Requirement keyword coverage | For every `plan.hard_requirements[]` (weight >= 0.7), its `keyword` (or any `keyword_synonyms[]`) must appear at least once in `patch.work[].description ∪ P1 ∪ P2 ∪ P3` (case-insensitive substring). | `HARD_REQUIREMENT_MISSING_KEYWORD` |

#### 3.5.3 Output

```json
{
  "pre_critic_ok": false,
  "pre_critic_fails": [
    {"reason_code": "EMPTY_BODY", "detail": "P2 body has 12 chars after strip"},
    {"reason_code": "HARD_REQUIREMENT_MISSING_KEYWORD", "detail": "requirement[0].keyword 'Kubernetes' (synonyms: K8s, kube) not found in any bullet or paragraph"}
  ]
}
```

#### 3.5.4 Integration with Retry Controller

```
tailor_output := Tailor(...)
pre_critic := PreCriticValidator(tailor_output, plan)

IF NOT pre_critic.pre_critic_ok:
   IF state.pass < 3:
      # Skip Critic entirely — Tailor must fix mechanical issues first
      state.prior_feedback := pre_critic.pre_critic_fails (formatted as surgical instructions)
      state.pass += 1
      continue
   ELSE:
      route to review with reason_codes = pre_critic.pre_critic_fails.reason_code[]

ELSE:
   critic := Critic(...)
   # proceed as §4.7
```

#### 3.5.5 Why this matters for the retry budget

Without this layer, a mechanical failure (empty P2) costs: 1 Tailor + 1 Critic + 1 Tailor + 1 Critic = 4 LLM calls. With this layer, the same failure costs: 1 Tailor + validator (free) + 1 Tailor + 1 Critic = 2 LLM calls + 1 Critic. At 25 jobs/day × ~15% pre-critic fail rate, this saves ~$1.20/day and one retry slot per failing job (freeing passes 2–3 for *qualitative* revisions).

---

### 4. Critic + Retry Controller

#### 4.1 Critic model config

Claude Sonnet 4.6, no extended thinking, temperature 0, JSON mode.

#### 4.2 Inputs

- `plan` (for requirements, weights, language, hooks)
- `evidence_json` (for verifying `safe_facts_to_cite` usage)
- Full Tailor output
- Prior outputs corpus — up to 5 most-recent shipped outputs in same language, from OTHER companies, within the last 30 days (see §4.4 for corpus rules). If fewer than 5 exist, use all available; if zero, `template_uniqueness` defaults to 100.
- `pass` number (1, 2, or 3)

#### 4.3 Scoring dimensions (10 total)

**Hard-fails (any `false` → cannot ship):**

| # | Dimension | Check |
|---|---|---|
| 1 | `language_consistent` | Every bullet + paragraph matches `plan.language_decision.value` |
| 2 | `no_banned_phrases` | Regex sweep of full output against DE+EN banned list |
| 3 | `cover_letter_body_non_empty` | All 3 paragraphs have text content after HTML-stripping |
| 4 | `all_hard_requirements_addressed` | Every `weight >= 0.7` requirement appears in `requirement_to_evidence_map` AND visible in output |
| 5 | `all_six_skills_returned` | `patch.skills.length === 6`, all ids preserved verbatim |
| 6 | `template_seeds_used` | P1/P3 match the seeded patterns |

**Soft scores (0–100):**

| # | Dimension | How computed |
|---|---|---|
| 7 | `requirement_coverage` | Weighted: `Σ(weight × coverage_grade) / Σ(weights)` |
| 8 | `specificity` | Count of `company_hooks` + `safe_facts_to_cite` actually cited in letter, normalized |
| 9 | `voice_consistency` | Qualitative match to target-language exemplar tone |
| 10 | `template_uniqueness` | `1 − max cosine(current_similarity_text, c)` for c in corpus |

#### 4.4 Template uniqueness — corpus rules

**similarity_text(output)** is constructed as:
```
P1.sentences[1..]          // P1 body — exclude templated opener
+ P2.full
+ P3.sentences[..last-1]   // P3 body — exclude templated closer
```

**corpus(current):**
```
up_to_5_most_recent_shipped_outputs
WHERE output.language == current.language
  AND output.jobId != current.jobId
  AND output.company_domain != current.company_domain
  AND output.shipped_at > now() - 30 days
```

Exclusions prevent false positives: prior passes on the same job, sibling roles at the same company, and template-pool-origin text are all legitimately reused.

#### 4.5 Verdict logic

```
composite_score = 0.40 × requirement_coverage
                + 0.25 × specificity
                + 0.20 × voice_consistency
                + 0.15 × template_uniqueness

IF any hard_fail.value === false:
    IF pass < 3:  verdict = "revise"
    ELSE:         verdict = "review"

ELIF composite_score >= 80:
    verdict = "ship"

ELSE:  # hard-fails pass, but score < 80
    IF pass < 3 AND NOT plateau:  verdict = "revise"
    ELSE:                          verdict = "review"

plateau = (score_delta < 5%) AND (hard_fails_resolved_this_pass === 0)
```

#### 4.6 Critic output schema

```json
{
  "verdict": "ship" | "revise" | "review",
  "pass": 1,
  "scores": {
    "language_consistent": true,
    "no_banned_phrases": true,
    "cover_letter_body_non_empty": true,
    "all_hard_requirements_addressed": true,
    "all_six_skills_returned": true,
    "template_seeds_used": true,
    "requirement_coverage": 82,
    "specificity": 71,
    "voice_consistency": 85,
    "template_uniqueness": 88,
    "composite_score": 80
  },
  "hard_fails": [
    {
      "dimension": "language_consistent",
      "reason_code": "LANGUAGE_MIX",
      "evidence": "P2 sentence 3: 'excited to contribute' is English in a DE letter"
    }
  ],
  "soft_issues": [
    {
      "dimension": "specificity",
      "score": 71,
      "issue": "P2 cites no company_hooks — only generic AI/automation mentions",
      "revision_instruction": "Add one concrete reference to company_hooks[0] (Joule AI GA) in P2 opening sentence. Keep sentences 2–3."
    }
  ],
  "reason_codes": ["GENERIC_P2"],
  "review_notes": "Shippable if moderate specificity acceptable. Adding Joule mention in P2 would reach 85+."
}
```

#### 4.7 Retry Controller

A small stateful node in n8n that orchestrates the tailor/critic loop:

```
state := { pass: 1, prior_draft: null, prior_score: 0 }

loop:
  tailor_output := Tailor(plan, evidence, jd, base_resume, state.prior_draft, state.prior_feedback, pass=state.pass)
  critic := Critic(plan, evidence, tailor_output, corpus, pass=state.pass)

  score_delta := critic.composite_score - state.prior_score
  hard_fails_resolved_this_pass := count(prior_hard_fails_dimensions) - count(current_hard_fails_dimensions)
  plateau := (score_delta < 5) AND (hard_fails_resolved_this_pass === 0)

  IF critic.verdict == "ship":
    return {verdict: "ship", tailor_output, critic}
  ELIF critic.verdict == "review" OR state.pass >= 3 OR plateau:
    return {verdict: "review", tailor_output, critic, reason_codes: critic.reason_codes}
  ELSE:  # revise
    state.pass += 1
    state.prior_draft := tailor_output
    state.prior_feedback := critic.soft_issues + critic.hard_fails
    state.prior_score := critic.composite_score
    continue
```

#### 4.8 Cost estimate

~6K input + ~500 output per critic call ≈ $0.026 × avg 1.3 calls = **~$0.034/job** ≈ $25/month at 25/day.

---

### 5. Base Resume Audit

#### 5.1 Purpose and prerequisite status

The base resume is the floor under all generated output. Every bullet gets tailored, but none is invented. An audit happens BEFORE any pipeline work begins — it is Stage 1 of implementation.

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
2. **Profile paragraph** — opener strength, metric presence, specificity.
3. **Work entries** — per-bullet review: metric presence, verb-led, passive-voice flags, impact-first ordering.
4. **Projects** — per-description review: impact-first, tech stack concise, URLs present.
5. **Skills** — ordering recommendation (German tech market: Salesforce → Backend → Frontend → Cloud → Automation → Languages is the proposed default), keyword density per group.
6. **Education** — date formatting, stale coursework flags.
7. **Certificates** — currency check, deprecated-cert flags.
8. **Missing content opportunities** — suggestions for metrics that should be injected (e.g., "Bullet 3 has no user-count; if you have data, add it").
9. **Crown-jewel bullets** — ranked list of 3–5 strongest bullets across all sections, to be pinned as priority evidence in the Tailor system prompt.
10. **Evidence Quality Tags (NEW)** — every work bullet, project description, skill group tagged as:
    - `strong` — quantified, specific, role-relevant
    - `usable` — specific but unquantified
    - `weak` — generic, hedged, low-signal

#### 5.4 Evidence Quality Tags — downstream integration

The `evidenceQuality` tag list is surfaced on the `/context` endpoint:

```json
{
  "currentJobTitle": "...",
  "currentProfile": "...",
  "currentWork": [...],
  "currentSkills": [...],
  "currentProjects": [...],
  "evidenceQuality": [
    {"id": "286ca64e-...", "section": "work", "bullet": 1, "tag": "strong", "reason": "quantified + crown-jewel"},
    {"id": "286ca64e-...", "section": "work", "bullet": 2, "tag": "weak", "reason": "generic verbs, no metric"},
    {"id": "7abecff6-...", "section": "project", "bullet": 1, "tag": "strong", "reason": "10k monthly generations — quantified"}
  ]
}
```

Planner's `evidence_mapping` respects tag priority: `strong` > `usable` > `weak`. A plan whose mapping relies only on `weak` evidence sets `plan_confidence: "low"`.

Tags are stored in a sidecar file `data/evidenceQuality.json` (not in `resume.json` — keeps the source file clean). Server reads both at request time.

#### 5.5 Time cost

~45 minutes of user review time, one-time. Audit doc + updated `resume.json` + `evidenceQuality.json` ship as one commit.

---

### 6. Exemplars + Style Guide

#### 6.1 Exemplars

6 synthetic cover letters written by Claude, reviewed and edited once by user:

- 3 in German (one formal enterprise, one semi-formal scaleup, one startup-casual)
- 3 in English (same three register variants)

Each exemplar is a complete 3-paragraph letter tuned to user's Salesforce Developer profile applying to a hypothetical representative role. They are the voice anchor for the Tailor.

**Storage:** `data/exemplars/{de|en}/{formal|semi_formal|startup_casual}.md` — 6 files, each ~400 words.

**User review:** ~1 hour upfront, single review pass. Only re-reviewed if Tailor voice drifts significantly.

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
    "exact": ["—"]  // em-dash
  }
}
```

Regex list must use word boundaries to avoid false positives (e.g., "analytics-driven" must not trigger "results-driven").

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
| Reason Codes | critic (comma-separated) | no |
| Composite Score | critic | no |
| Hard Fails | critic (condensed list) | no |
| P1 | tailor output | **yes** |
| P2 | tailor output | **yes** |
| P3 | tailor output | **yes** |
| Resume Patch (JSON) | tailor output | yes (advanced) |
| Critic Notes | critic `review_notes` | no |
| Approve? | user | **checkbox** |
| Status | auto | `Pending` / `Approved` / `Sent` / `Rejected` / `PDF Failed` |

#### 7.3 Reason-code taxonomy

| Code | Trigger | Typical fix |
|---|---|---|
| `LANGUAGE_MIX` | hard_fail #1 after 3 passes | Manually translate or reject |
| `BANNED_PHRASE` | hard_fail #2 | Rewrite offending sentence |
| `EMPTY_BODY` | hard_fail #3 | Regenerate (pipeline bug if seen) |
| `LOW_REQUIREMENT_COVERAGE` | hard_fail #4 | Add bullet or rewrite P2 |
| `SKILLS_MISSING` | hard_fail #5 | Pipeline bug — investigate |
| `WRONG_TEMPLATE` | hard_fail #6 | Re-trigger with different seed |
| `GENERIC_P2` | specificity < 70 | Edit P2 to add company hook |
| `REPETITIVE_TEMPLATE` | template_uniqueness < 70 | Re-trigger with next LRU seed |
| `COVERAGE_GAPS_HARD` | tailor surfaced gaps on hard req | Accept or skip |
| `MAX_PASSES_EXHAUSTED` | 3 passes, no ship | Manual edit or skip |
| `PLAN_FAILED` | Planner JSON malformed even after retry | Rerun that job |
| `RESEARCH_CONFIDENCE_LOW` | <3 safe_facts_to_cite | Accept generic or skip |
| `TAILOR_FAILED` | Tailor call failed all retries (§11) | Rerun that job |
| `CRITIC_FAILED` | Critic call failed all retries (§11) | Rerun that job |
| `TIMEOUT_BUDGET` | Job exceeded 10-min wall-clock (§11.3) | Rerun with simpler target |
| `REQUEST_BUDGET_EXHAUSTED` | Job exceeded 15 LLM calls (§11.3) | Investigate loop behavior |
| `SCHEMA_INVALID` / `SKILLS_MALFORMED` / `UNKNOWN_ID` / `LANGUAGE_TOKEN_MISMATCH` / `LANGUAGE_SNIFF` / `HARD_REQUIREMENT_MISSING_KEYWORD` | Pre-Critic Validator (§3.5) after 3 passes | Rerun or accept with manual edit |

#### 7.4 "Approve Review Queue" sub-workflow

A new lightweight n8n workflow triggered on a 5-minute cron (or manually):

```
1. Read Review Queue tab, filter: Status === "Pending" AND Approve? === true
2. For each matching row:
   a. POST /generate-resume with edited resume_patch + metadata
   b. POST /generate-coverletter with edited P1/P2/P3 + metadata
   c. On both success:
      - Update row: Status = "Sent", write Resume File + Cover Letter File paths
      - Append row to main tracker tab with Status "Reviewed & Sent"
   d. On any failure:
      - Update row: Status = "PDF Failed", log error in Notes
```

#### 7.5 Rejection path

User sets `Approve? = false` AND manually changes Status to `Rejected`. Row stays as history; no PDFs generated.

#### 7.6 Main tracker — Outcome column (NEW)

The existing main tracker tab gets one new user-editable column: **`Outcome`**, with a controlled enum:

| Value | Meaning |
|---|---|
| `No Response` | Default; no reply received within 30 days |
| `Auto-Rejected` | Template rejection email from ATS |
| `Recruiter Reply` | Any human reply from company-side recruiter (not a rejection) |
| `Interview Invite` | First-round interview scheduled |
| `Offer` | Written offer received |

This is the **only callback-rate signal** the pipeline has. Filling it in is a user responsibility, not automated. Stage 13 (§10.5) aggregates this column. The enum is deliberately coarse — fine distinctions (phone screen vs on-site) are noise at current volumes.

The column is read-only to the pipeline — no n8n node writes to it. Main-tracker rows written at ship-time populate `Outcome = "No Response"` by default.

---

### 8. Server changes (Express)

Minimal changes to `src/server.js`:

1. **Empty-body guard on `/generate-coverletter`:** reject requests where `stripHtml(paragraph1 + paragraph2 + paragraph3).trim().length === 0` with HTTP 422 and `reason_code: EMPTY_BODY`. Pipeline catches this and routes to review queue.

2. **`evidenceQuality` field on `/context`:** extend response to include the tag list from `data/evidenceQuality.json`. No functional change to current consumers.

3. **No other server changes.** `buildResumeHtml`, `mergeCoverLetter`, `mergePatch`, `validatePatch` remain unchanged.

---

### 9. Model Allocation Summary (via OpenRouter)

| Pipeline step | Model | Reasoning | Approx $/job |
|---|---|---|---|
| Match filter (10c) | Gemini 2.0 Flash-Lite | Unchanged primary; free tier sufficient | ~$0 |
| Match filter fallback tier 3 (new) | Deterministic keyword rule | If both Gemini calls fail with `_apiError: true`, fall back to a code-only rule: accept if JD contains ≥2 terms from the user's crown-jewel keyword set (`Salesforce`, `Apex`, `LWC`, `Flow`, `Node.js`, `Express`, `React`, `TypeScript`) AND role title doesn't match the hard-reject regex from node 10a. Prevents silent zero-match days from API outages. | $0 |
| Research extractor | Sonnet 4.6 | JSON extraction workhorse | ~$0.02 |
| Planner | Sonnet 4.6 + extended thinking | Reasoning-heavy ranking + mapping | ~$0.05 |
| Tailor (avg 1.3 passes) | Opus 4.7 | Premium German creative writing | ~$0.26 |
| Critic (avg 1.3 calls) | Sonnet 4.6 | Evaluation is cheaper than generation | ~$0.034 |
| **Total per job** | | | **~$0.37** |

At 25 jobs/day × 20 working days/month = 500 jobs/month:
- Uncached: ~$185/month
- With prompt-cached system prompts (est. 30% savings on Tailor input): **~$140–170/month**

---

### 10. Testing Strategy

#### 10.1 Staged implementation order

| Stage | Deliverable | Must pass before next stage |
|---|---|---|
| 1 | Base resume audit + `data/resume.json` updates + `data/evidenceQuality.json` | Audit approved by user, updated files committed |
| 2 | Style guides (DE + EN) + exemplars (6 files) + banned-phrases.json | User approval on exemplars |
| 3 | Template pools (P1 DE/EN, P3 DE/EN — 12 variants each) | User approval on pool |
| 4 | Node 4 upgrade (companyData preservation) + Research Enrichment + Extractor node | Unit tests + golden set Stage-4 checks |
| 5 | Planner node + schema validation tests | Unit tests + golden set Stage-5 checks |
| 6 | Tailor prompt rewrite + Opus integration + `cache_control` breakpoint | Unit tests + golden set Stage-6 checks |
| 7 | Critic node + Retry Controller + revise loop | Unit tests + golden set Stage-7 checks |
| 8 | Review Queue tab + Approve Review Queue sub-workflow | End-to-end test with 1 manually-flagged row |
| 9 | Server changes: `/generate-coverletter` empty-body guard + `/context` evidenceQuality | Unit tests |
| 10 | Full integration pass | Full golden set passes |
| 10.5 | **Shadow evaluation** against v6 on 20 historical jobs | v7 beats v6 on ≥80% of shadow jobs |
| 11 | Live 5-job batch | Ship-rate ≥50%, review queue behaves correctly, no hard-fails in shipped output |
| 12 | Live 25-job batch | Ship-rate ≥70%, review queue ≤10 flagged, no hard-fails in shipped output |
| 13 | **60-day callback review** | Callback-window decision (see §10.5) |

#### 10.2 Unit tests (by component)

- `tests/validatePatch.test.js` — extended for new schema fields (existing file).
- `tests/planSchema.test.js` — validates Planner output against schema; rejects malformed plans.
- `tests/templateLRU.test.js` — verifies LRU selection from partitioned pool; verifies exclusion rules.
- `tests/similarity.test.js` — cosine similarity math; corpus filter rules (language, jobId, company_domain, shipped_at).
- `tests/criticVerdict.test.js` — covers ship/revise/review transitions, hard-fail handling, plateau rule, pass-count thresholds.
- `tests/bannedPhrases.test.js` — regex and exact-match detection; word-boundary correctness.
- `tests/evidenceQuality.test.js` — `/context` response shape with and without tag file.

#### 10.3 Golden set (9 JDs)

Five variety cases + four regression cases pulled directly from the 2026-04-18 failures:

| # | Job | Language | Role type | Purpose |
|---|---|---|---|---|
| G1 | SAP Salesforce Developer (Walldorf) | DE | Salesforce | Baseline happy path |
| G2 | N26 Backend Engineer (Berlin) | DE | Backend | Non-Salesforce tech path |
| G3 | Celonis AI Engineer | EN | AI/ML | English + stretch-role fit |
| G4 | A German scaleup fullstack role (50–200 employees, startup-casual register) — picked during Stage 10 | DE | Fullstack | Casual register + LRU test |
| G5 | Bosch Data Engineer | EN | Data | Under-evidenced role type (research stress-test) |
| G6 | Bertrandt Salesforce (2026-04-18 job) | DE | Salesforce | **Regression:** LANGUAGE_MIX — must produce German bullets |
| G7 | DE letter from 2026-04-18 with "Die [Noun]" P1 | DE | any | **Regression:** REPETITIVE_TEMPLATE — must pick non-Die P1 |
| G8 | CLARK Holding SE (2026-04-18) | DE | Salesforce | **Regression:** EMPTY_BODY — must produce non-empty letter |
| G9 | apaleo (2026-04-18) | DE | any | **Regression:** EMPTY_BODY — different trigger path |

Each golden job must produce a user-signable output. Iteration loop: run → hand-review → tune → re-run until all 9 pass.

#### 10.4 Shadow evaluation (Stage 10.5)

Replay 20 matched jobs from `Get_an_execution.json` through v7 WITHOUT writing PDFs or Sheet rows. Produce a diff doc at `docs/superpowers/evaluations/2026-04-XX-v7-shadow-eval.md` with per-job comparison on four axes:

- Language consistency (hard check)
- P1/P3 template uniqueness vs v6
- Requirement coverage (Planner score)
- Critic composite

Must hit **v7 wins on ≥80%** of shadow jobs before any live batch.

#### 10.5 Rollback plan and callback-window decision

**Baseline acknowledgment:** As of 2026-04-20 the user has received **0 interview invites** from v6 output. There is no callback-rate baseline for v7 to "beat" — instead, v7 must establish a positive interview rate on its own.

**Backup & staging:**

- Before Stage 1 begins, current pipeline state is saved to branch `pipeline-v6-backup`.
- Each stage commits its own workflow JSON in `data/Job_Application_Automator_v7_stage{N}.json`.

**Stage 13 — 60-day callback review (decision gate):**

Defined decision 60 calendar days after Stage 12 goes live, evaluated against the `Outcome` column of the main tracker (§7.6):

| 60-day outcome | Decision |
|---|---|
| ≥1 Interview Invite AND ≥3 Recruiter Replies across ≥100 applications | **Continue** — v7 is working; iterate on margins |
| 0 Interview Invites AND ≤1 Recruiter Reply across ≥100 applications | **Revisit approach** — freeze v7 pipeline, re-audit base resume + exemplars + research depth. Rolling back to v6 is NOT automatic (v6 had the same 0-interview problem); treat as a full re-brainstorm on what's different about the signal the user sends to recruiters. |
| Mixed / <100 applications sent | Extend review window another 30 days |

**Operational rollback triggers (separate from callback decision):**

- In-pipeline hard-fail rate in *shipped* output > 0 across any 25-job batch → halt pipeline, fix root cause, re-run Stage 10.5 shadow eval before resuming.
- Monthly spend > $250 (30% above upper estimate) → halt and audit model call counts / cache hit rates.

---

### 11. Retry & Backoff Policy (LLM + HTTP calls)

Distinct from the Tailor/Critic loop (which is a *semantic* retry): this covers *network-level* retries for any outbound call the pipeline makes.

#### 11.1 Which calls this covers

| Call | Retries |
|---|---|
| OpenRouter → any model (Research Extractor, Planner, Tailor, Critic) | Yes |
| Gemini match filter (10c, 10e) | Yes |
| Google News RSS fetch | Yes |
| Company `/about` page fetch | No (1 attempt; 15s timeout; fail → null) |
| GitHub org fetch | No (1 attempt; failure → field null) |
| Express `/generate-resume` / `/generate-coverletter` | Yes |
| Google Sheets append | Yes |

#### 11.2 Policy

- **Max retries:** 2 (so up to 3 attempts total per call)
- **Backoff:** exponential — 1s, then 3s
- **Retry triggers:** HTTP 429, HTTP 5xx, timeout, network error, `_apiError: true` on JSON parse failure
- **Non-retry triggers:** HTTP 4xx (except 429), explicit content-filter/policy error — fail fast, route to review
- **On final failure:**
  - For Research Extractor / enrichment: continue with `research_confidence: "low"` and whatever fields succeeded
  - For Planner / Tailor / Critic: route job to review queue with `reason_code: PLAN_FAILED` / `TAILOR_FAILED` / `CRITIC_FAILED`
  - For Match filter: tier-3 deterministic keyword fallback (see §9)
  - For `/generate-*`: mark the sheet row `Status = "PDF Failed"` and log error in Notes column

#### 11.3 Global per-job budget

A single job attempt across all retries must not exceed:

- **Wall-clock:** 10 minutes end-to-end (timer starts at node 9 dequeue)
- **LLM calls:** 15 total (covers 3 tailor + 3 critic + planner + extractor + margin)

Exceeding either halts that job, routes to review queue with `reason_code: TIMEOUT_BUDGET` or `REQUEST_BUDGET_EXHAUSTED`, and pipeline continues with next job.

---

### 12. Observability

Minimal logging that makes the pipeline's black box diagnosable without building a dashboard.

#### 12.1 Correlation ID

Every job carries `jobId` (already present — the job URL) as the correlation key. It appears in:
- Every n8n node's logged output for that job
- Every Express server log line for calls tied to that job
- Every row in the main tracker and review queue

No new ID is introduced.

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
  "stage": "planner" | "tailor" | "critic" | "pre_critic" | "pdf_resume" | "pdf_cover" | "sheet_log",
  "pass": 1,
  "model": "anthropic/claude-sonnet-4-6",
  "latency_ms": 4120,
  "input_tokens": 7834,
  "output_tokens": 612,
  "cache_read_tokens": 6200,
  "cost_usd": 0.021,
  "verdict": "revise",
  "reason_codes": ["GENERIC_P2"],
  "error": null
}
```

Fields that don't apply to a stage (e.g., `cache_read_tokens` on PDF stages) are `null`.

#### 12.3 SLIs (watched weekly, not paged)

| SLI | Target | Source |
|---|---|---|
| p95 end-to-end latency per job | ≤ 6 min | `pipeline.jsonl` — max(ts) − min(ts) per jobId |
| Pipeline error rate | ≤ 3% of jobs ending in non-review failure | Count of jobs with `error != null` on terminal stage |
| Avg passes per job (tailor/critic) | ≤ 1.7 | mean of max(pass) per jobId |
| Ship-rate (rolling 25-job window) | ≥ 70% from Stage 12 onward | verdict == "ship" / total |
| Weekly model spend | within 20% of §9 estimate | sum(cost_usd) |
| Pre-critic fail rate | < 20% | count of jobs where any `pre_critic_ok === false` on pass 1 / total |

#### 12.4 Index refresh

Spend snapshot and ship-rate get appended to `docs/superpowers/evaluations/weekly-kpis.md` every Sunday (manual for now — automate in a later stage if useful).

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OpenRouter caching semantics change | Low | Medium | Monitor cost weekly; style guide + exemplars are the cached block, easy to port |
| Opus 4.7 occasionally produces invalid JSON despite tool-use | Low | Low | 1 retry baked into Tailor, fall through to review after |
| Google News RSS rate limits on batch runs | Medium | Low | Each call is independent, 15s timeout; failure → field null, not a block |
| Apify scrapers drift their output schemas | Medium | Medium | BOARD_CONFIG is isolated in node 4; schema changes fix there without downstream impact |
| Review queue becomes user bottleneck | Medium | Medium | Target ≤10 flagged/day; if higher, re-tune critic thresholds |
| User approves poor-quality letters without careful review | Low | High | Reason codes make bad letters obvious at a glance; `MAX_PASSES_EXHAUSTED` always deserves skepticism |
| v7 shadow eval loses to v6 on ≥20% of jobs | Medium | High | Fix regressions inline before any live batch; `pipeline-v6-backup` branch preserved |
| v7 produces zero interview invites in 60-day review window | Medium | High | Stage 13 triggers a re-brainstorm rather than auto-rollback, since v6 baseline is also zero — the pipeline may not be the limiting factor |
| Evidence quality tags drift as base resume evolves | Medium | Medium | `data/evidenceQuality.json` is user-editable; regenerate via audit any time base changes |

---

## Open Items (for the implementation plan to resolve)

1. Exact template variants — user approval required on 48 total pool variants (12 per pool × 4 pools). Draft-and-review workflow during Stage 3.
2. Exemplar content — Claude drafts 6 letters during Stage 2; user approves/edits once.
3. Google Sheets layout for `template_history` — JSON column on main tracker vs dedicated state tab. Decide during Stage 7 implementation.
4. Critic prompt style — few-shot examples of correctly-flagged issues. Build during Stage 7.

---

## Success Criteria

Organized by what's measurable at each time horizon. The KPI at the bottom is the only one that ultimately matters — everything above it is a leading indicator.

**Within first post-launch 25-job batch (Stage 12):**

- **Quality:** ≥90% of shipped letters reference at least one `safe_facts_to_cite` fact. Hard-fail rate (empty bodies, language mixes, banned phrases) in shipped output = 0.
- **Operational:** ship-rate ≥70%; review queue volume ≤10 flagged/day; user review time ≤10 min/day.
- **Cost:** monthly spend in $140–200 range (within 20% of estimate).

**Within first week (steady state):**

- **Regression resilience:** all 4 golden regression cases (G6–G9) continue to pass on every subsequent prompt/code change.
- **Observability:** every job has a complete `pipeline.jsonl` trace with a `verdict` field set. No "silent" jobs (where the user can't reconstruct what happened).
- **Outcome tracking:** `Outcome` column on the main tracker gets filled in for ≥80% of applications that are >14 days old (user-side discipline).

**60-day review (Stage 13 — the actual KPI):**

- **Absolute interview rate:** ≥1 `Interview Invite` across ≥100 applications. Since v6 baseline is 0, this is establishing a positive rate, not beating a prior one.
- **Engagement rate:** ≥3 `Recruiter Reply` outcomes across ≥100 applications (human signal that the letter landed).
- **If neither target is hit:** Stage 13 decision matrix (§10.5) triggers a re-brainstorm. The pipeline is then a known-good baseline for isolating whether the resume content itself, the targeting (which jobs get applied to), or volume is the limiting factor.
