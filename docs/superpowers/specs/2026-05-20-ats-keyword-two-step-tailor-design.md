# Design: ATS Keyword Two-Step Tailor

**Date:** 2026-05-20
**Status:** Approved
**Goal:** Maximize resume and cover letter callback rate by separating keyword extraction from content generation, enforcing ATS keyword coverage, strengthening bullet structure, and sharpening cover letter hooks.

---

## Problem Statement

The current pipeline sends the full job description directly to OpenAI and asks it to simultaneously: extract relevant keywords, decide which bullets to keep, rewrite all bullet content, update all skills, write a 3-paragraph cover letter, and verify its own output. This is ~15 distinct tasks in one call.

Research shows:
- 99.7% of recruiters use keyword filters in ATS
- Resumes need 85%+ keyword match to pass ATS screening
- Quantified, formula-driven bullets increase callback rate by up to 40%
- German cover letter P1 hooks that use company-specific product language outperform generic JD-technology mentions

The root cause: Gemini passes only `{match, confidence, reason, jobType}` to the tailor step. OpenAI must re-analyse the JD from scratch with no guaranteed keyword list, which means keyword inclusion is best-effort rather than enforced.

---

## Architecture

### Current Flow (nodes 12 → 13b)

```
12. Is Match?
    ↓ (match=true, confidence≥45)
13a. Build Tailor Prompt   ← OpenAI sees raw JD, no keyword list
    ↓
13a1. Wait (2s)
    ↓
13b. OpenAI API Call       ← does ~15 tasks in one shot at effort="medium"
```

### New Flow

```
12. Is Match?
    ↓
13a0. Extract Keywords & Hook   ← NEW: Gemini Flash Lite, cheap/free
    ↓                             outputs: keywords[], companyHook, roleFamily
13a0a. Wait (1s)                ← NEW: rate limit guard
    ↓
13a. Build Tailor Prompt        ← injects keyword list + hook into prompt
    ↓
13a1. Wait (2s)
    ↓
13b. OpenAI API Call            ← effort="high", receives pre-extracted context
```

**What does NOT change:** Node.js server (`/context`, `/generate-resume`, `/generate-coverletter`), PDF rendering, Google Sheets logging schema, Gemini match step (nodes 10a–11), cover letter validator (`validateCoverLetter.js`), all existing prompt rules.

---

## New Node: `13a0. Extract Keywords & Hook`

### Input

The node receives from `12. Is Match?` the existing item fields:
- `title` — job title
- `company` — company name
- `description` — full JD text

### Prompt

```
You are a job description analyst. Extract structured data from the job description below.

Return STRICTLY VALID JSON with exactly these three keys:

{
  "keywords": ["keyword1", "keyword2", ...],
  "companyHook": "single sentence",
  "roleFamily": "one of the allowed values"
}

KEYWORDS rules:
- 10–15 items maximum
- Exact phrases from the JD — the literal strings an ATS will scan for
- Include: specific tools, technologies, frameworks, domain terms, role-specific nouns
- Exclude: generic words like "experience", "team", "software", "ability", "strong"
- Prefer multi-word exact phrases over single generic words
  Good: "containerd", "cgroups v2", "user namespaces", "kubelet CRI", "seccomp-bpf"
  Bad: "containers", "linux", "systems"

COMPANY_HOOK rules:
- One sentence only
- Extracted verbatim or closely paraphrased from the JD's single most specific and distinctive product/mission claim
- Must be something a reader would only encounter in THIS company's JD, not in 20 others
- Not a generic tech stack mention — a specific product claim, architecture decision, or mission statement
  Good: "vNode replaces virtual kubelets and microVMs with a runtime built on Linux user namespaces — without the VM tax."
  Bad: "This role involves Kubernetes and container runtimes."

ROLE_FAMILY rules — pick exactly one:
  salesforce | cloud-devops | frontend | backend | fullstack | ai-ml | distributed-systems | other

---

JOB TITLE: {{title}}
COMPANY: {{company}}
JOB DESCRIPTION:
{{description}}
```

### Output Shape

```json
{
  "keywords": [
    "containerd", "kubelet", "CRI", "user namespaces",
    "seccomp-bpf", "cgroups v2", "OCI hooks", "Go",
    "Kubernetes SIG-Node", "tenant isolation", "runc",
    "Linux namespaces", "container runtime"
  ],
  "companyHook": "vNode replaces virtual kubelets and microVMs with a runtime built on Linux user namespaces and seccomp — without the VM tax.",
  "roleFamily": "cloud-devops"
}
```

The parsed values are stored on the n8n item and passed to `13a. Build Tailor Prompt`.

### Error handling

If the extraction node fails or returns malformed JSON, `13a. Build Tailor Prompt` falls back to the previous behaviour (no keyword list, no hook injection). The tailor call still fires — a failed extraction degrades quality but does not block output.

---

## Prompt Upgrades to `13a. Build Tailor Prompt`

All existing rules stay. Three blocks are added/replaced.

### Addition 1: Mandatory Keyword Inclusion (new section, inserted after ABSOLUTE BANS)

```
========================
MANDATORY KEYWORDS (ATS PASS REQUIREMENT)
========================

The upstream analysis extracted these keywords directly from the JD.
Every keyword below MUST appear at least once in your output — in work bullets,
skills infoHtml, project descriptions, or the profile. Natural placement only —
do NOT keyword-stuff, but find a real place for each one. If a keyword genuinely
cannot fit anywhere authentically, leave it out.

KEYWORDS: {keywords}

After writing your output, run a mental scan: does each keyword appear at least
once? If not, find a bullet or skill entry where it fits and insert it.
This is verified in self-check #18.
```

`{keywords}` is replaced at prompt-build time with the comma-separated list from `13a0`.

### Addition 2: Bullet Formula (replaces existing action-verb guidance in WORK EXPERIENCE)

Replace:
> "Use action verbs: Built, Implemented, Optimized, Designed, Automated, Reduced, Delivered."

With:

```
BULLET FORMULA — EVERY bullet MUST follow this structure:
  [Strong Action Verb] + [what was built/done, specific] + [measurable outcome or technical impact]

Compliant:
  ✓ "Implemented a Jenkins CI/CD pipeline reducing average deployment time by ~40%."
  ✓ "Architected a 3-tier AWS infrastructure across 41 Terraform-managed resources with multi-AZ failover."

Non-compliant:
  ✗ "Worked on deployment pipeline improvements." (weak verb, no outcome)
  ✗ "Built CI/CD pipeline." (missing outcome)
  ✗ "Responsible for infrastructure." (banned opener, no outcome)

If a bullet has no quantifiable outcome, write the specific technical detail with
maximum precision: [Verb] + [specific tech] + [specific scope or constraint].
Do NOT use weak verbs (worked on, helped with, assisted, was involved in, responsible for).
```

### Addition 3: P1 Hook Rule Upgrade (replaces existing P1 Sentence 1 guidance)

Replace:
> "Sentence 1 — JD-specific concrete hook: name a product, team, technology, or paraphrased mission from the JD."

With:

```
Sentence 1 — Company-specific hook: Use the provided COMPANY_HOOK as the basis
for your opening sentence. Adapt it to make it grammatically natural as an opener,
but preserve its specificity. This must be something a reader would only encounter
in THIS company's JD, not in 20 others.

COMPANY_HOOK: {companyHook}

Good: "vNode replaces virtual kubelets and microVMs with a runtime built on Linux
user namespaces — the approach vCluster Labs is taking to VM-grade isolation
without the VM tax aligns directly with my systems work at MV Clouds."
Bad: "Kubernetes and container runtimes are central to this role." (too generic)
```

`{companyHook}` is replaced at prompt-build time with the hook from `13a0`.

### Addition 4: Self-check #18

Append to the existing self-check list:

```
18. Keyword coverage gate: for each keyword in the MANDATORY KEYWORDS list,
verify it appears at least once in patch.work bullets, patch.skills infoHtml,
patch.projects descriptions, or patch.profile. If any keyword is absent and
could fit authentically, insert it before emitting.
```

### Addition 5: Reasoning effort

In `13b. OpenAI API Call` node config, change:
```json
"reasoning": { "effort": "medium" }
```
to:
```json
"reasoning": { "effort": "high" }
```

---

## Data Flow Summary

```
JD text
  → 13a0: Extract Keywords & Hook
      → item.keywords[]
      → item.companyHook
      → item.roleFamily
  → 13a: Build Tailor Prompt
      → injects {keywords} into MANDATORY KEYWORDS block
      → injects {companyHook} into P1 hook rule
      → injects {roleFamily} into prompt input so the model reads the role family
        explicitly rather than inferring it; the existing crown-jewel and
        hard-mapping rules already act on role family — this just makes it
        unambiguous (e.g. "ROLE_FAMILY: cloud-devops" at the top of the INPUT block)
  → 13b: OpenAI API Call (effort="high")
      → same patch + coverLetter JSON output as before
  → 14: Parse AI Patch → 15a/15b: PDF generation (unchanged)
```

No changes to the Node.js server, PDF rendering, or Google Sheets schema.

---

## Files Changed

| File | Change |
|------|--------|
| `data/Job_Application_Automator_v6.json` | Add nodes `13a0`, `13a0a`; update `13a` prompt; update `13b` effort |
| `docs/superpowers/specs/2026-05-20-ats-keyword-two-step-tailor-design.md` | This document |

No Node.js source files are changed.

---

## Success Criteria

- Every generated resume contains all 10–15 extracted JD keywords at least once
- Every work bullet follows `[Verb] + [What] + [Outcome/Metric]`
- Cover letter P1 opens with the company-specific hook, not a generic tech mention
- Pipeline still produces PDF output for every matched job (no new failure modes)
- Extraction node failure gracefully falls back to current behaviour

---

## Out of Scope (Future Work)

- Post-generation ATS keyword density scoring (Approach C)
- Retry gate on low keyword hit rate
- Cover letter scoring node
- Company research beyond JD text (Kununu, LinkedIn, news)
