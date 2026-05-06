# Job Application Pipeline — Quality Overhaul Design

**Date:** 2026-05-06
**Status:** Design v2 — integrated reviewer feedback (JD Quality Gate, frontend family, evidence-priority trim, Patch Diff before CL, Auto-Apply Eligibility Gate); awaiting re-review
**Owner:** Karan Patel

---

## 1. Goal

Transform the existing pipeline from a **document generator** into a **truth-preserving application compiler** that produces submittable CV + cover letter pairs reliably enough to send 25 applications/day without per-document manual review on every output.

**Primary objective:** maximize recruiter response and interview rate. Application volume is secondary.

## 2. Success criteria

The pipeline is "done" when:

1. **Every output passing the Auto Apply queue is sendable as-is** — no Hard Stops from the rejection checklist (title overreach, language mixing, tool overclaiming, automation artifacts).
2. **No fabricated claims.** Every sentence in CV bullets and cover letter paragraphs traces to a specific evidence ID in `data/resume.json`. New nouns/tools/domains that aren't in JD or resume evidence get caught and rejected.
3. **Page budget enforced deterministically.** A 1-page A4 CV is the default; 1.5-page is acceptable only when justified by content density. Layout validation runs pre-render, not post-hoc.
4. **Match tiering works.** Confidence ≥70 with critic-pass goes to Auto Apply. 55–69 OR fallback-model output goes to Review Queue. <55 OR fatal-gap goes to Rejected JDs.
5. **Role family targeting is honest.** Salesforce, backend, frontend, full-stack, cloud/DevOps, AI integration are accepted. Security, BI/Analytics (Tableau/Power BI/Snowflake-heavy), GTM/RevOps, Magento/Shopify/WooCommerce *platform-specific* roles, embedded, and senior/specialized data engineering are rejected at the matcher. Junior/Werkstudent data engineering with Python/SQL/cloud overlap routes to Review only. SWE roles at e-commerce companies are NOT rejected just because the domain is e-commerce.
6. **Outcome tracking exists.** The Sheet captures Applied/Response/Interview/Outcome columns. The system logs structured audit data so prompt-level changes can be evaluated against response rates over time.

## 3. Scope

**Target role types:** Salesforce ecosystem, backend SWE, frontend SWE, full-stack SWE, cloud/DevOps, AI integration. Werkstudent / Internship / Vollzeit / Teilzeit. Germany on-site or DE/EU remote.

**Out of scope:** automatic submission to job portals, multi-language support beyond DE/EN, integration with LinkedIn Easy Apply or similar, PDF watermarking or signing.

## 4. Architecture

### 4.1 High-level flow

```
SCRAPED JOB
   │
   ▼
[JD Quality Gate]  ── cheap deterministic; reject if description<600 chars,
   │                  company empty/Unknown, title missing, JD is mostly
   │                  navigation/footer/legal boilerplate
   ▼
[Hardened Matcher]  ── reject Security/BI-Analytics/GTM/Magento-platform/
   │                   embedded/senior-data-eng; thresholds: ≥70 auto /
   │                   55–69 review / <55 skip
   ▼
[Structured JD Parser]  ── one Gemini call; outputs:
   │                       role_family, must_have_skills, nice_to_have_skills,
   │                       responsibilities, language_requirements,
   │                       seniority_signals, employmentType, red_flags
   ▼
[Language Decision Gate]  ── deterministic; outputs hard outputLanguage
   │                        variable. Only decides LANGUAGE, never eligibility.
   ▼
[GET /context?family=X]  ── tag-filtered projection of resume.json
   │                        (evidence-ID granular)
   ▼
[Claim Ledger Builder]  ── matches each must_have/nice_to_have to evidence IDs;
   │                       outputs coverage_score, fatal_gap, reject_reason;
   │   ── fatal_gap = true if hard German C1+ unsupported, or any other
   │                  unsupported core must-have
   │   ── if fatal_gap → Review Queue (not auto-reject; let user judge stretch)
   │   ── if coverage_score < 60 → Rejected JDs
   ▼
[CV Tailor Call]  ── reasoning: medium; only claims using ledger evidence IDs;
   │                 outputs visibleProjectIds / visibleWorkIds /
   │                 visibleSkillIds; mandatory _evidenceMap on every claim
   ▼
[Patch Diff Validator]  ── deterministic + LLM; catches dangerous changes
   │                       BEFORE CL can reuse polluted claims
   │                       (skill-level upgrade, new tech word, metric tampering)
   │   ── deterministic violations → revert field; flag for Review
   │   ── safe → continue
   ▼
[CL Tailor Call]  ── separate call; reasoning: medium; reads ledger + clean
   │                 CV patch; mandatory _evidenceMap on every claim
   ▼
[Critic Pass]  ── reasoning: high; structured audit
   │             (claim audit, language, German style, no-new-nouns,
   │              ATS coverage of SUPPORTED must-haves only, layout);
   │             decision: pass / repair / reject
   │
   ├── repair → re-tailor with critic notes (max 1 retry)
   ├── reject → Rejected JDs
   └── pass
   ▼
[Layout Validator]  ── deterministic char/line budgets;
   │                   evidence-priority trimming
   │                   (never trim must-have-mapped bullets unless covered
   │                    elsewhere); flag if trimmed
   ▼
[Auto-Apply Eligibility Gate]  ── computes autoApplyEligible boolean and
   │                              manualReviewRequired with reasons array
   │                              (see §5.11)
   │
   ├── autoApplyEligible = true   →  Auto Apply Queue
   └── manualReviewRequired = true → Review Queue
   │
   ▼
[PDF Generator]  ── server-side; rejects on missing/empty/Unknown company
   │
   ▼
[Google Sheet]  ── Auto Apply Queue / Review Queue / Rejected JDs
```

### 4.2 Application Package Object

Every node in the pipeline reads from and writes to a single canonical object. This is the n8n contract; every node validates inputs against this schema and emits outputs conforming to it.

```jsonc
{
  "job": {
    "source": "linkedin | indeed | stepstone | glassdoor | xing",
    "title": "string",
    "company": "string",
    "location": "string",
    "url": "string",
    "applyUrl": "string",
    "description": "string (raw scraped JD)",
    "postedAt": "ISO8601",
    "salary": "string"
  },
  "match": {
    "match": "boolean",
    "confidence": "0-100",
    "reason": "string",
    "jobType": "fulltime | werkstudent | internship | teilzeit | freelance | unknown",
    "_apiError": "boolean",
    "_fallbackModelUsed": "boolean"
  },
  "jdParsed": {
    "role_family": "salesforce | backend | frontend | fullstack | cloud-devops | ai-integration | other",
    "must_have_skills": ["string"],
    "nice_to_have_skills": ["string"],
    "responsibilities": ["string"],
    "language_requirements": [{ "language": "de|en", "level": "C1|C2|native|active-learner|none", "hard": "boolean" }],
    "seniority_signals": ["string (e.g. 'senior', '5+ years', 'lead')"],
    "employmentType": "vollzeit | werkstudent | internship | teilzeit | freelance | unknown",
    "red_flags": ["string"]
  },
  "outputLanguage": "de | en",
  "resumeContext": {
    "family": "salesforce | backend | frontend | fullstack | cloud-devops | ai-integration",
    "evidenceItems": [
      { "evidence_id": "string", "claim": "string", "metrics": ["string"], "technologies": ["string"], "role_families": ["string"], "source_section": "work|project|skill", "entry_id": "string" }
    ]
  },
  "claimLedger": {
    "requirements": [
      {
        "requirement": "string (from must_have or nice_to_have)",
        "importance": "must-have | nice-to-have",
        "matched_evidence_ids": ["evidence_id"],
        "strength": "strong | partial | unsupported",
        "fatal": "boolean (true if must-have and unsupported and core to role)"
      }
    ],
    "must_have_total": "integer",
    "strong_supported": "integer",
    "partial_supported": "integer",
    "unsupported": "integer",
    "coverage_score": "0-100",
    "fatal_gap": "boolean",
    "reject_reason": "string | null"
  },
  "cvPatch": {
    "jobTitle": "string",
    "profile": "<p>...</p>",
    "showCertificates": "boolean",
    "showProjects": "boolean",
    "visibleProjectIds": ["entry_id"],
    "visibleWorkIds": ["entry_id"],
    "visibleSkillIds": ["entry_id"],
    "work": [{ "id": "entry_id", "description": "<ul>..." }],
    "skills": [{ "id": "entry_id", "skill": "string", "infoHtml": "<p>..." }],
    "projects": [{ "id": "entry_id", "name": "string", "techStack": "string", "description": "<ul>..." }],
    "_evidenceMap": [{ "section": "work|profile|project|skill", "entry_id": "string", "bullet_index": "integer", "claim": "string", "evidence_ids": ["string"] }]
  },
  "coverLetter": {
    "paragraph1": "string",
    "paragraph2": "string",
    "paragraph3": "string",
    "_evidenceMap": [{ "paragraph": 1|2|3, "claim": "string", "evidence_ids": ["string"] }]
  },
  "criticAudit": {
    "claim_audit": [{ "text": "string", "verdict": "supported|partial|unsupported", "evidence_id": "string|null" }],
    "language_mismatch": ["string"],
    "german_style_issues": [{ "text": "string", "issue": "string", "replacement": "string" }],
    "no_new_nouns_violations": ["string"],
    "ats_keyword_coverage": { "covered": ["string"], "missing_must_haves": ["string"] },
    "layout_risk": "low | medium | high",
    "decision": "pass | repair | reject",
    "repair_notes": "string"
  },
  "patchDiffAudit": {
    "new_skills_added": ["string"],
    "renamed_skill_categories": [{ "from": "string", "to": "string" }],
    "metrics_changed": [{ "from": "string", "to": "string" }],
    "removed_high_value_metrics": ["string"],
    "dangerous_changes": ["string"]
  },
  "layoutAudit": {
    "profileChars": "integer",
    "workBulletCount": "integer",
    "projectCount": "integer",
    "coverLetterTotalChars": "integer",
    "withinBudget": "boolean",
    "trimmed": "boolean"
  },
  "routingDecision": {
    "queue": "auto | review | rejected",
    "autoApplyEligible": "boolean",
    "manualReviewRequired": "boolean",
    "reasons": ["string (e.g. 'fallback_model_used', 'layout_trimmed', 'coverage_score_below_auto_threshold', 'fatal_german_gap', 'dangerous_diff', 'critic_repair_remained', 'jd_quality_low')"]
  },
  "renderedFiles": {
    "resumeFile": "string (path)",
    "coverLetterFile": "string (path)",
    "resumeUrl": "string",
    "coverLetterUrl": "string"
  },
  "qualityFlag": "Good Fit | Review | Bad Fit | Error"
}
```

## 5. Component design

### 5.1 JD Quality Gate (new, runs before Matcher)

**Purpose:** cheap deterministic gate that drops obviously-broken scrapes before spending LLM tokens on them.

**Inputs:** raw scraped `job` object.

**Logic (all deterministic, no LLM):**
- Reject if `job.description.length < 600` chars (likely truncated/partial scrape).
- Reject if `job.company` is empty, falsy, or matches `/^unknown$/i` / `/^n\.?\s*a\.?$/i`.
- Reject if `job.title` is empty.
- Reject if `job.description` lacks any responsibility/requirement signal — heuristic: must contain at least one of `/responsibilities|requirements|qualifications|tasks|aufgaben|profil|anforderungen|qualifikation|deine aufgaben|das bringst du mit|womit du arbeitest|was du mitbringst|must.haves|nice.to.haves/i`.
- Reject if >70% of the description text matches navigation/footer/legal boilerplate patterns (`/cookie|datenschutz|privacy policy|impressum|equal opportunity employer|gleiche chancen/i`-density check).

**Action:** rejected JDs go to "Rejected JDs" sheet with `reject_reason: "jd_quality_low"`. Never reach the matcher.

**Implementation:** new n8n code node between `4. Normalize & Merge Jobs` and `5. Sync Jobs + Sheet`.

### 5.2 Hardened Matcher

**Purpose:** filter out role families the candidate cannot credibly fill, before any generation work.

**Inputs:** `job.title`, `job.description`, `job.company`, candidate profile snippet.

**Logic:**
- Hard reject (deterministic, before LLM call) if title or description matches reject patterns:
  - Security: `/security|appsec|threat\s*model|soc\s*(analyst|engineer)|cisa|cissp|penetration|cybersecurity/i`
  - BI/Analytics: `/business intelligence|bi\s*(analyst|engineer|developer)|tableau|looker|power\s*bi|snowflake|dbt\b/i` (note: `dbt` only as standalone word, not in unrelated contexts)
  - GTM/RevOps: `/gtm\s*engineer|revops|sales\s*engineer|pre[\s\-]?sales|technical\s*sales/i`
  - E-commerce platform-specific: `/magento|hyva|shopify\s*(developer|engineer)|woocommerce|prestashop/i` (NOT a blanket e-commerce reject — SWE roles AT e-commerce companies pass)
  - Embedded/hardware: `/embedded|firmware|robotics|hardware\s*engineer|kernel|fpga|asic/i`
  - Senior data engineering: `/senior\s*data\s*engineer|principal\s*data\s*engineer|staff\s*data\s*engineer/i` AND title or description mentions Spark/Kafka/Airflow/dbt-heavy stack.
- Soft reject / low confidence if seniority demands exceed 3+ years and no Salesforce-related JD signal.
- Junior/Werkstudent data engineering with Python/SQL/cloud overlap: do NOT auto-reject. Let it through to Review Queue (Auto-Apply Eligibility Gate will downgrade based on coverage).
- Hard German C1/C2/native is NOT rejected here — handled by Claim Ledger as `fatal_gap`.
- Confidence tiering applied at this node:
  - `>=70` → continue normally
  - `55-69` → continue but mark `routingDecision.queue = "review"` downstream
  - `<55` → drop, log to Rejected JDs

**Implementation:** stays in `10a. Build Match Prompt` + `12. Is Match?` nodes. The `12. Is Match?` IF node gets a tier branch.

### 5.3 Structured JD Parser

**Purpose:** convert raw scraped JD text into structured fields the rest of the pipeline can reason about.

**Inputs:** `job.description`, `job.title`, `job.location`.

**Outputs:** `jdParsed` object (see schema in §4.2).

**Implementation:** new n8n node, single Gemini call with JSON-mode output. Replaces the current crude JD splitting logic in `13a. Build Tailor Prompt`. The parser uses the full JD (no character cap) because Gemini's context window is large and structured extraction tolerates bloat better than raw concatenation.

**Reasoning effort:** Gemini doesn't expose this directly; use `gemini-2.5-flash` (not flash-lite) for parser.

**Failure mode:** if parser returns malformed JSON, retry once with `gemini-2.5-flash`; if still failing, mark `qualityFlag = "Error"` and route to Rejected.

### 5.4 Language Decision Gate

**Purpose:** decide CV/CL output language before generation, removing a degree of freedom from the tailor. **This gate decides only LANGUAGE, never eligibility.** Hard German C1/C2/native unsupported is handled by the Claim Ledger as `fatal_gap` (§5.6), not here.

**Inputs:** `jdParsed.language_requirements`, `job.description` (for majority-language detection), `job.location`.

**Logic (deterministic, no LLM):**
1. If JD body is majority-German (>60% of words are German tokens via simple stopword count) → `de`.
2. Else if JD body is majority-English AND `language_requirements` contains a hard German C1+ → `en`, AND P3 acknowledges German active-learner status. (The application still proceeds because Claim Ledger will route it to Review Queue via fatal_gap, where the user decides per-application.)
3. Else if JD body is majority-English AND German appears only as nice-to-have → `en`.
4. Bilingual JD: requirements-section language wins. Tied → `de`.
5. Default: `en`.

**Output:** `outputLanguage` is set as a hard variable on the package object. CV and CL tailor calls receive it as input; they cannot override it.

**Implementation:** new n8n code node, deterministic JS.

### 5.5 Tag-filtered `/context?family=X` endpoint

**Purpose:** project `data/resume.json` to only the evidence relevant to the resolved role family + universal items.

**API:** `GET /context?family=salesforce|backend|fullstack|cloud-devops|ai-integration`

**Server logic:** `src/server.js` reads `data/resume.json`, walks `content.work[].entries[].descriptionItems[]`, `content.project[].entries[]`, `content.skill[].entries[]`. Each item has a `role_families` array. Items where `role_families` includes the requested family OR the literal value `"universal"` are kept. Result is returned as `resumeContext.evidenceItems` plus the original entry-level structure.

**Schema change in `data/resume.json`:** see §6.

### 5.6 Claim Ledger Builder

**Purpose:** match each JD requirement to specific evidence IDs from the projected resume; produce coverage score and fatal-gap detection.

**Inputs:** `jdParsed.must_have_skills`, `jdParsed.nice_to_have_skills`, `jdParsed.seniority_signals`, `jdParsed.language_requirements`, `resumeContext.evidenceItems`.

**Outputs:** `claimLedger` (see §4.2).

**Logic:**
- For each must-have and nice-to-have, the LLM (Gemini 2.5 flash) returns matched evidence IDs and strength assessment.
- Coverage score = (strong_supported × 1.0 + partial_supported × 0.5) / must_have_total × 100.
- Fatal gap detection (deterministic, post-LLM):
  - Hard German requirement (C1/C2/native/verhandlungssicher) without supporting evidence → `fatal: true`. Note: candidate is German active-learner, never C1+.
  - Seniority "5+ years" or "senior" or "lead" or "principal" with candidate's 2+ years experience and no equivalent project portfolio → `fatal: true`.
  - Domain-specific must-have with zero matched evidence (e.g., "Kubernetes production experience" with no K8s evidence) → `fatal: true`.
- **Routing rules (changed from previous version):**
  - `coverage_score < 60` → reject (route to Rejected JDs with `reject_reason: "coverage_below_minimum"`)
  - `coverage_score 60-69` → continue but flag `manualReviewRequired = true` (downstream Auto-Apply Eligibility Gate routes to Review Queue)
  - `coverage_score >= 70` → continue, eligible for auto if all other gates pass
  - `fatal_gap === true` → continue but flag `manualReviewRequired = true` (NOT auto-rejected; user decides per-application via Review Queue, since stretch jobs sometimes pay off). Reason added: `fatal_german_gap` or `fatal_seniority_gap` or `fatal_domain_gap`.

**Implementation:** new n8n node, Gemini call + post-processing JS.

### 5.7 CV Tailor Call

**Purpose:** generate the CV patch using only ledger-approved evidence.

**Inputs:** `resumeContext`, `jdParsed`, `claimLedger`, `outputLanguage`, employment type from `jdParsed.employmentType`.

**Outputs:** `cvPatch` with mandatory `_evidenceMap`.

**Key changes from current `13a. Build Tailor Prompt`:**
- `reasoning.effort: 'medium'` (was `'minimal'`).
- Receives ledger as input; system prompt instructs: "you may only make claims that map to one or more `matched_evidence_id` from the ledger. Each rewritten bullet, profile sentence, and project bullet MUST cite its source `evidence_ids` (plural) in `_evidenceMap`. Output without complete `_evidenceMap` is invalid and will be rejected by the Critic."
- `_evidenceMap` is **mandatory** — every generated claim must include `evidence_ids` (plural; some claims combine 2 pieces of evidence). The Critic in §5.9 validates this; a claim with empty/missing `evidence_ids` triggers repair (or reject if 3+ violations).
- Outputs explicit `visibleWorkIds`, `visibleProjectIds`, `visibleSkillIds`. Server-side merge enforces these (see §5.13).
- Profile and bullets are family-locked: title vocabulary restricted to a closed list per family. Initial proposed values:
  - `salesforce`: "Salesforce Developer", "Salesforce Engineer", "Apex Developer", "AppExchange Developer", "Salesforce Platform Developer"
  - `backend`: "Software Developer", "Backend Engineer", "Software Engineer", "Backend Developer"
  - `frontend`: "Frontend Developer", "Frontend Engineer", "React Developer", "Software Developer", "Software Engineer"
  - `fullstack`: "Full-Stack Developer", "Software Engineer", "Software Developer"
  - `cloud-devops`: "DevOps Engineer", "Cloud Engineer", "Site Reliability Engineer", "Platform Engineer"
  - `ai-integration`: "Software Developer (AI Integration)", "AI Engineer", "Automation Engineer"
  - The tailor cannot output any title outside its family's list. No "Senior X" / "Specialist Y" / "Lead Z" inventions, regardless of JD wording.
- Profile lead sentence varies by `employmentType`: werkstudent/internship leads with student status + Hochschule Fulda; vollzeit leads with experience + Hochschule Fulda anchor in second sentence.
- Bullet ceiling lowered from 8 to 5 per work entry. Project ceiling lowered from 3 to 2.
- Layout char budgets enforced in prompt as soft guidance; deterministic validator (§5.11) is the hard enforcement.
- Cover letter generation removed from this call (split into §5.8).

### 5.8 CL Tailor Call

**Purpose:** generate the cover letter using ledger-approved evidence and the **clean** (Patch-Diff-validated) CV patch.

**Inputs:** `claimLedger`, `cvPatch` (post-Patch-Diff), `jdParsed`, `outputLanguage`, `employmentType`, `job.company`, `job.title`.

**Outputs:** `coverLetter` with mandatory `_evidenceMap` (`evidence_ids` plural per paragraph claim).

**Key changes from current architecture:**
- Separate call from CV. CV call AND Patch Diff Validator must complete first; CL receives the cleaned CV patch as context to ensure consistency. CL never reads a CV patch with unresolved `dangerous_changes`.
- `reasoning.effort: 'medium'`.
- `_evidenceMap` is **mandatory** for every paragraph's primary claims. Critic rejects/repairs missing maps.
- Hard structural rules retained from current prompt (P1 4-5 sentences, P2 5-7 with 2+ metrics + 2+ tech, P3 3-4 atomic sentences).
- Hochschule Fulda anchor in P1 retained.
- Banned phrase list extended with German style sanitizer terms: `fundierte Kenntnisse`, `ausgeprägte Fähigkeiten`, `spannende Herausforderung`, `dynamisches Umfeld`, `innovative Lösungen`, `mit großer Begeisterung`, `Ich verfüge über eine hohe Motivation`, `Ich bin überzeugt, dass`, `umfangreiche Expertise`.
- P3 availability sentence is generated deterministically by the n8n node based on `employmentType` (e.g., werkstudent → "Als Werkstudent kann ich 20 Stunden/Woche während des Semesters und bis zu 40 Stunden/Woche in den Semesterferien einbringen."). The LLM is asked to write only the location sentence (sentence 2) and close (sentence 3); availability is prepended by the node post-call. This guarantees correct werkstudent/Vollzeit/internship phrasing every time.

### 5.9 Critic Pass

**Purpose:** structured audit of the generated CV and CL against the rejection checklist.

**Inputs:** `cvPatch` (post-Patch-Diff), `coverLetter`, `claimLedger`, `jdParsed`, `outputLanguage`.

**Outputs:** `criticAudit` (see §4.2).

**Reasoning effort:** `'high'`. Uses OpenAI gpt-5-mini (or upgraded to gpt-5 if budget allows).

**Audit checks:**

| Check | Method | Failure action |
|---|---|---|
| Mandatory `_evidenceMap` (every claim has non-empty `evidence_ids`) | Deterministic | repair if 1-2 missing; reject if 3+ |
| Claim audit (every claim's `evidence_ids` actually map to ledger evidence) | LLM | repair |
| Language mismatch (DE/EN mixing inside one paragraph) | Hybrid (regex + LLM) | repair |
| German style issues (banned-phrase + soft-cliché detection) | LLM | repair |
| No-new-nouns (every proper noun, tool, tech, domain in output is in JD or resume evidence) | LLM | repair if 1-2; reject if 3+ |
| ATS keyword coverage (≥80% of **supported and partial** must-have skills surface verbatim somewhere in CV; **unsupported must-haves must NOT be claimed**) | Deterministic regex | repair if low; reject if any unsupported must-have is claimed |
| Layout risk (rough char count vs budget) | Deterministic | repair if medium; reject if high |
| Title overreach (`patch.jobTitle` not in family-locked list) | Deterministic regex against allowed family titles | reject |
| Tool overclaim (CL mentions tool not in resume evidence) | Hybrid | reject |
| Banned-phrase substring match | Deterministic | repair |

**Decision logic:**
- Any "reject" trigger → `decision: "reject"`.
- 1-2 repair triggers → `decision: "repair"`, with `repair_notes` listing the specific issues.
- 0 issues → `decision: "pass"`.

**Repair loop:** up to 1 retry. Repair feeds the critic notes back to CV/CL tailor; if the second output still fails, route to Review Queue (don't reject — let user judge).

### 5.10 Patch Diff Validator (runs BEFORE CL Tailor)

**Purpose:** catch dangerous changes between CV patch and base resume that the critic might miss. **Positioned before CL Tailor so dangerous CV claims do not pollute the cover letter.**

**Inputs:** `cvPatch` (post-CV-Tailor), base `data/resume.json`.

**Outputs:** `patchDiffAudit`.

**Checks:**
- **Deterministic (regex/diff):**
  - New tech word: any tool/technology in patch text that doesn't appear (case-insensitive substring) anywhere in base resume → revert that field to base.
  - Metric tampering: numeric values in patch vs base; reject any change in `85%`, `40%`, `41`, `95`, `20Hz` → revert.
  - Language-skill upgrade: pattern `/active learner|grundkenntnisse|basic/i` in base vs `/professional|fluent|verhandlungssicher|c1|c2|native|fließend/i` in patch for the same language entry → revert.
- **LLM (semantic, gpt-5-mini):**
  - Claim strengthening: bullet meaning shifted from "implemented X" to "led/architected/owned X" without evidence → flag.
  - Scope expansion: project description expanded to include domains/tools not in base → flag.

**Failure action:**
- Deterministic violations: silently revert the offending field to base value, log in `patchDiffAudit.dangerous_changes` for transparency.
- LLM-flagged dangerous changes: set `manualReviewRequired = true` with reason `dangerous_diff`; CL Tailor proceeds with the reverted patch.
- Hard violation (3+ unrelated dangerous changes): set `decision = reject`, route to Rejected JDs.

### 5.11 Layout Validator (evidence-priority trimming)

**Purpose:** deterministic char/line budgets enforced before PDF render. **Trimming respects evidence priority — must-have-mapped bullets are never silently dropped if they are the only coverage for that requirement.**

**Inputs:** `cvPatch`, `coverLetter`, `claimLedger` (for evidence priority).

**Logic:**

```javascript
const limits = {
  profileChars: 420,
  workBullets: 5,         // per entry
  workBulletChars: 145,   // per bullet
  projectCount: 2,
  projectBullets: 3,      // per project
  projectBulletChars: 120,
  skillCategories: 6,
  skillInfoChars: 110,    // per category
  coverLetterTotalChars: 2200,
};
```

**Evidence priority for trimming (highest priority is preserved last):**
1. **P1 — bullets covering must-have requirements** (via `claimLedger.requirements[].matched_evidence_ids`).
2. **P2 — bullets covering responsibilities** in `jdParsed.responsibilities`.
3. **P3 — bullets covering nice-to-have requirements**.
4. **P4 — general credibility bullets** with no JD mapping.

**Trim algorithm (when bullet count over budget):**
1. Sort bullets by priority (P4 first, P1 last).
2. Drop P4, then P3, then P2 until under budget.
3. Never drop a P1 bullet **unless** another retained bullet covers the same `requirement` from the ledger.
4. If trimming would require dropping the last covering bullet for any must-have → set `layoutAudit.trimmed = true`, `manualReviewRequired = true`, do not silently drop. Route to Review Queue.

**Action:**
- `profileChars > limit`: trim to last full sentence under limit.
- `workBullets > limit`: apply evidence-priority trim algorithm above.
- `projectCount > limit`: drop lowest-priority project (one not in ledger's `matched_evidence_ids`).
- Any other budget exceeded by content that can't be safely trimmed: log in `layoutAudit.trimmed`, set `manualReviewRequired = true`.
- `coverLetterTotalChars > 2200`: do not auto-trim CL (sentence integrity matters); set `manualReviewRequired = true` with reason `layout_trimmed`.

**Implementation:** new n8n code node OR move into `src/server.js` as a pre-render step in `/generate-resume`. Recommendation: server-side, because it's deterministic and belongs to the rendering pipeline. Add a new endpoint `POST /validate-layout` that accepts a patch + ledger and returns `{ withinBudget, trimmedPatch, audit, mustHaveLossDetected }`.

### 5.12 Auto-Apply Eligibility Gate (replaces Confidence Router)

**Purpose:** compute one explicit boolean — `autoApplyEligible` — and route accordingly. Auto Apply requires **all** clean signals; any single weakness routes to Review.

**Inputs:** `match`, `claimLedger`, `criticAudit`, `patchDiffAudit`, `layoutAudit`, `job`, `coverLetter`, `outputLanguage`.

**Outputs:** `routingDecision = { queue, autoApplyEligible, manualReviewRequired, reasons[] }`.

**Logic:**

```javascript
// Hard rejects (terminal)
if (criticAudit.decision === "reject") → Rejected JDs, reasons: ["critic_reject"]
if (claimLedger.coverage_score < 60) → Rejected JDs, reasons: ["coverage_below_minimum"]
if (patchDiffAudit.dangerous_changes.length >= 3) → Rejected JDs, reasons: ["dangerous_diff_terminal"]

// Auto Apply requires ALL of:
const autoApplyEligible =
  match.confidence >= 70 &&
  claimLedger.coverage_score >= 70 &&
  claimLedger.fatal_gap === false &&
  criticAudit.decision === "pass" &&
  patchDiffAudit.dangerous_changes.length === 0 &&
  layoutAudit.withinBudget === true &&
  layoutAudit.trimmed === false &&
  match._fallbackModelUsed === false &&
  job.company !== "" &&
  job.company.toLowerCase() !== "unknown" &&
  coverLetter.paragraph1 !== "" &&
  coverLetter.paragraph2 !== "" &&
  coverLetter.paragraph3 !== "" &&
  outputLanguage in ["de", "en"];

if (autoApplyEligible) → Auto Apply Queue, reasons: []
else → Review Queue, reasons: [list of which specific gates failed]
```

**Reason codes** populated when `manualReviewRequired = true`:
- `confidence_below_auto_threshold` (match < 70)
- `coverage_below_auto_threshold` (coverage 60-69)
- `fatal_german_gap` / `fatal_seniority_gap` / `fatal_domain_gap`
- `critic_repair_remained` (decision = repair after retry)
- `dangerous_diff` (patchDiff flagged ≥1 change)
- `layout_trimmed`
- `must_have_evidence_loss` (Layout Validator detected priority-1 bullet would be dropped)
- `fallback_model_used`
- `company_missing`
- `cover_letter_empty`

**Note:** the only way an output reaches the Auto Apply Queue is when **every** gate is clean. Everything else lands in Review where the user makes the final call.

**Implementation:** small JS code node before PDF generation.

### 5.13 PDF Generator hardening

**Changes to `src/server.js`:**
- `/generate-resume`: return 422 if `req.body.company` is empty, falsy, or matches `/^unknown$/i`. Return 422 if `patch.work` is empty AND no `visibleWorkIds` provided.
- `/generate-coverletter`: existing 422 on empty paragraphs stays. Add 422 on empty company.
- Fix automation artifacts in `src/mergeCoverLetter.js`: any line-break splitting issues in phone number rendering, footer rendering. (Specific bugs to be identified during Phase 0 implementation.)

### 5.14 Sheet schema (3 tabs)

**Auto Apply Queue** (existing columns + new):
- `Date, Company, Role, Job Type, Location, Source, Job URL, Apply URL, Resume File, Cover Letter File, Match Confidence, Coverage Score, Status, Applied, Applied Date, Response, Response Date, Interview, Interview Date, Outcome, Notes, Quality Flag`

**Review Queue:** same columns + `Review Reason, Reviewed (checkbox), Reviewer Notes, Final Decision (Send | Reject)`. User reviews these manually; on `Send`, the row migrates to Auto Apply Queue.

**Rejected JDs:** lighter columns: `Date, Company, Role, Source, Job URL, Reject Reason (matcher | parser | ledger | critic | layout | diff), Reject Detail`.

## 6. Data model: `data/resume.json` evidence-ID restructure

### 6.1 New shape

The current shape (`description: "<ul><li>...</li></ul>"`) becomes:

```jsonc
{
  "id": "286ca64e-9ab1-4d32-9905-0996d5d6a5c1",
  "employer": "MV Clouds",
  "jobTitle": "Salesforce Developer",
  "location": "Ahmedabad, India",
  "startDateNew": "02/2023",
  "endDateNew": "04/2025",
  "bullets": [
    {
      "evidence_id": "work_mvclouds_appexchange_security_review",
      "html": "Built and published a managed AppExchange package through Salesforce's full security review cycle, enforcing 85%+ Apex test coverage via automated test suites and code reviews; authored documentation and marketing materials for the listing.",
      "claim": "Built and published a managed AppExchange package through Salesforce security review",
      "technologies": ["Salesforce", "Apex", "AppExchange", "Salesforce DX"],
      "metrics": ["85%+ Apex test coverage"],
      "role_families": ["salesforce", "backend"]
    },
    {
      "evidence_id": "work_mvclouds_agentforce_rest",
      "html": "Designed and implemented REST API callouts and custom Apex actions enabling Salesforce AI agents to read from and write to external systems in real time, including HomeAdvisor (lead ingestion), QuickBooks (financial sync), and an aerospace parts inventory platform.",
      "claim": "Designed REST API integrations between Salesforce Agentforce agents and third-party systems",
      "technologies": ["Apex", "REST", "Agentforce", "Salesforce"],
      "metrics": [],
      "role_families": ["salesforce", "backend", "ai-integration"]
    }
    // ... ~9 evidence items per work entry
  ]
}
```

**Same restructure for `content.project[].entries[]` and `content.skill[].entries[]`.**

### 6.2 Backwards compatibility

`buildResumeHtml.js` is updated to render from `bullets[].html` instead of `description`. Any consumer expecting the old `description` string is updated. The `applyPatch` logic in `mergePatch.js` continues to merge by `id` at the entry level; bullets within an entry are replaced wholesale by the patch (patch.work[].description still wraps the AI's reordered/edited bullets in `<ul><li>` HTML; `mergePatch.js` writes this into `entry.description` as today, but `buildResumeHtml.js` reads `entry.description` if present, else falls back to assembling from `entry.bullets[].html`).

### 6.3 AI-smell cleanup (Phase 0)

Manual edits to `data/resume.json` to remove buzzwords from base content:
- "applying the same architectural review discipline to AI-generated outputs as to hand-written code" → cut or rephrase concretely.
- "low-code-first thinking for system integration and workflow orchestration" → cut.
- "Comfortable in AI-assisted engineering environments: I use AI tools to accelerate development while owning architecture, code review, and quality" → rephrase as concrete bullet about tools used.
- "production-grade" → cut wherever it adds nothing concrete.
- "AI-assisted engineering" as a bullet header → reframe.
- Profile paragraph: tighten to 3 short sentences.

This is a one-time cleanup, ~30-45 min of careful editing.

## 7. Phasing

### Phase 0 — Quick wins (1 day)

No architectural change. Highest-leverage fixes that ship before any structural work.

1. **`reasoning.effort: 'minimal' → 'medium'`** in tailor call (`13a. Build Tailor Prompt`).
2. **Match threshold 45 → 70 auto + 55–69 review band** in `12. Is Match?` IF node (add second IF branch).
3. **Fallback-model output flag → Review Queue only** — when matcher uses `gemini-2.0-flash-lite` fallback, propagate `_fallbackModelUsed: true` and route downstream output to Review Queue regardless of confidence.
4. **Basic JD Quality Gate** (new n8n code node, deterministic) — reject JDs with description<600 chars, empty/Unknown company, missing title, no responsibility/requirement section, or majority-boilerplate text. Saves LLM tokens on garbage scrapes.
5. **Language Decision Gate** (new n8n code node, deterministic) — replaces the language-detection logic embedded in tailor prompt.
6. **German Style Sanitizer ban-list extension** added to existing `BANNED_PHRASES` array in `14. Parse AI Patch`.
7. **AI-smell cleanup** in `data/resume.json` (manual).
8. **PDF/server guards** in `src/server.js`: 422 on missing/empty/Unknown company; 422 on empty CL paragraphs (already exists, verify); investigate and fix any phone/footer rendering bugs in `src/mergeCoverLetter.js`.
9. **Visibility lists in patch** (`visibleProjectIds`, `visibleWorkIds`, `visibleSkillIds`):
   - Tailor prompt instructed to emit them.
   - `src/mergePatch.js` enforces them — entries not in the visible list are filtered out before render.

**Exit criterion:** outputs noticeably tighter and on-language; user can start applying carefully end-of-Phase-0.

### Phase 1 — Truth-preservation backbone (2-3 days)

1. **Evidence-ID restructure of `data/resume.json`** (~9 bullets × 2 work entries + ~7 projects + ~6 skills = ~35-40 evidence items).
2. **`buildResumeHtml.js` update** to render from `bullets[].html` array (with fallback to `description` for safety).
3. **Tag schema** (`role_families` per evidence) populated in resume.json.
4. **Structured JD Parser** node (single Gemini call replacing crude split logic).
5. **`/context?family=X` endpoint** added to `src/server.js` (tag-filtered projection).

**Exit criterion:** ledger has granular evidence to work with; family routing is real.

### Phase 2 — Ledger + split generation + safety (3-4 days)

In pipeline order:

1. **Claim Ledger Builder** node (Gemini call + coverage scoring + fatal-gap detection).
2. **CV Tailor Call** restructured: receives ledger; outputs mandatory `_evidenceMap` (with `evidence_ids` plural) and `visibleXIds`.
3. **Patch Diff Validator** node (deterministic + LLM hybrid) — placed BEFORE CL Tailor so dangerous CV claims don't pollute the cover letter.
4. **CL Tailor Call** as separate node (reads ledger + clean CV patch).
5. **Critic Pass** with structured audit output (gpt-5-mini, reasoning: high). Includes mandatory `_evidenceMap` validation and supported-only ATS coverage check.
6. **Layout Validator** with evidence-priority trimming (server-side, `POST /validate-layout`).
7. **Auto-Apply Eligibility Gate** (small JS node, replaces simple Confidence Router).
8. **3-tab Sheet schema** (Auto Apply / Review Queue / Rejected JDs).

**Exit criterion:** the system can run unattended for runs of 10–20 jobs and outputs the user trusts to send without per-document review (Auto Apply queue items only).

### Phase 3 — Polish (2-3 days)

1. **Application Package Object schema** documented in code (TypeScript types or JSDoc) and validated at node boundaries.
2. **Manual review queue ergonomics**: Sheet Reviewer Notes column, simple checkbox-based approval flow, "Send" action that migrates rows from Review → Auto Apply.
3. **Outcome tracking**: ensure Applied/Response/Interview/Outcome columns are wired into both queues with timestamps.
4. **Optional native-German review flow** for high-priority applications (top 10-20% by match confidence + coverage score) — staged for user manual DE polish before submission.
5. **Prompt tuning based on response data** — once 50+ Applied/Response data points exist, correlate response rate with role family, employment type, coverage score; tune thresholds and prompts.

**Exit criterion:** the full pipeline runs at 25 applications/day with manual review only on Review Queue items (target <30% of throughput).

## 8. Testing approach

- **Unit tests** (`node:test`) for:
  - Language Decision Gate (input JD samples → expected language)
  - Layout Validator (patch fixtures → expected trim outcomes)
  - Patch Diff Validator deterministic checks
  - Coverage score calculation
  - Visibility list enforcement in `mergePatch.js`
- **Smoke tests** (manual scripts in `scripts/`):
  - End-to-end run with one fixture JD per role family (6 fixtures: salesforce, backend, frontend, fullstack, cloud-devops, ai-integration).
  - One fixture per employment type (werkstudent, internship, vollzeit).
  - One fixture per language (de, en).
  - One adversarial fixture (Security role) — must be rejected at matcher.
- **Output inspection**: run a Phase 0 batch of 10 jobs, manually review each output against the rejection checklist; record what still fails.

## 9. Cost and operational notes

**Per-application cost estimate** (post-Phase-2):

| Call | Model | Tokens (est.) | Cost (est.) |
|---|---|---|---|
| Match | Gemini 2.5 Flash-Lite | 2k in / 200 out | free tier |
| JD Parser | Gemini 2.5 Flash | 4k in / 600 out | ~$0.001 |
| Claim Ledger | Gemini 2.5 Flash | 6k in / 1k out | ~$0.002 |
| CV Tailor | gpt-5-mini, reasoning medium | 8k in / 1.5k out | ~$0.02 |
| CL Tailor | gpt-5-mini, reasoning medium | 5k in / 600 out | ~$0.01 |
| Critic | gpt-5-mini, reasoning high | 8k in / 1k out | ~$0.04 |
| Repair (~30% of apps) | gpt-5-mini, reasoning medium | 8k in / 1.5k out | ~$0.02 × 0.3 = $0.006 |

**Total: ~$0.08 per application.** At 25/day = $2/day = ~**$60/month**. Within budget per user constraint.

**Latency:** sequential per application ~30-45 seconds (Gemini calls fast; OpenAI calls 5-10s each). 25 applications/day with 5-second n8n loop wait = ~25 minutes per run.

## 10. Open questions / future enhancements

1. **Outcome-driven prompt tuning:** once Applied/Response data accumulates (50+ data points), correlate response rate with role family, employment type, coverage score. Adjust thresholds. Out of scope for initial build.
2. **Full evidence bank (allowed_rewrites + forbidden_rewrites per evidence ID):** deferred. Current structure (claim + technologies + metrics) is enough for ledger v1.
3. **German native review pass:** for the top 10-20% of applications by match confidence, a human DE pass would catch nuances no LLM reliably handles. Out of scope; user can add this manually for high-priority applications via the Review Queue.
4. **Multi-base resume files:** explicitly rejected. Single source of truth + tag-based projection.
5. **Auto-submission to portals:** out of scope.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Evidence-ID restructure breaks existing `mergePatch.js` / `buildResumeHtml.js` consumers | Phase 1 includes update + smoke tests; old `description` field rendering retained as fallback |
| Layout char budgets too tight for senior roles with extensive evidence | Budgets are configurable; reviewed after Phase 2 with real outputs |
| Critic over-rejects (too many "reject" decisions) | Repair-with-notes is the first action; reject only on Hard Stops; Review Queue is the safety net |
| Gemini JD Parser fails on non-standard JD formats (e.g., Apify returning HTML-stripped concatenations) | Fallback to passing raw JD to tailor with parsed=null; log and inspect |
| Cost overrun if tailor needs 2+ repair retries | Hard cap at 1 retry; second-failure outputs route to Review Queue, not infinite loop |
| Build time stretches beyond estimate | Phase boundaries are independent; user can stop after any phase and have a working improved system |
