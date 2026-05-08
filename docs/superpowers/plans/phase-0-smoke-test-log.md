# Phase 0 End-to-End Smoke Test Log

**Plan:** [2026-05-06-job-pipeline-phase-0.md](./2026-05-06-job-pipeline-phase-0.md) Task 11.
**Code-side completion date:** 2026-05-07.
**Smoke test run date:** _<fill in>_
**Operator:** Karan.

This log records the manual end-to-end verification of all 10 prior Phase 0 changes working together. Tasks 1–10 are code-complete; Phase 0 is not "ready for production runs" until every fixture below is signed off.

---

## Manual prerequisites (do these once before running any fixture)

- [ ] Restart the n8n container (or `n8n start` if running natively) so it re-imports the modified `data/Job_Application_Automator_v6.json`.
- [ ] In the Google Sheet (`18zaWmognkbpaZyVsdaSLLvlB_Mas7BWetOW0zZUuC58`):
  - [ ] `Routing Tier` column header exists in the main log tab. _(Already added 2026-05-07.)_
  - [ ] `Fallback Model Used` column header exists in the main log tab.
  - [ ] A new tab named **`Rejected JDs`** exists with columns: `Date`, `Company`, `Role`, `Source`, `Job URL`, `Reject Reason`, `Reject Detail`.
- [ ] The Express PDF service is running locally (`npm start`) and reachable from n8n at `http://host.docker.internal:3000` (Docker) or `http://localhost:3000` (native).

---

## Fixture 1 — English JD, normal path

**Synthetic input** (paste into the Apify mock output for one run, or feed manually into node `1. Manual Configuration`):

```json
{
  "title": "Software Developer (Backend)",
  "company": "TestCo GmbH",
  "location": "Frankfurt, Germany",
  "url": "https://example.com/test-job",
  "applyUrl": "https://example.com/apply",
  "description": "We are looking for a backend developer to join our team in Frankfurt. Responsibilities: design and implement REST APIs, integrate third-party systems, write unit tests, participate in code reviews. Requirements: 2+ years of experience with Node.js, REST API design, SQL databases. Nice to have: AWS/Terraform exposure, CI/CD experience. We offer flexible hours, remote work options, and a friendly team."
}
```

### Per-node verification

- [ ] `4a. JD Quality Gate`: `_jdQuality.ok === true` (description >600 chars, "Responsibilities" + "Requirements" present, company set).
- [ ] `12. Is Match?`: passes (Salesforce + backend overlap should clear confidence ≥55).
- [ ] `12a. Decide Language`: outputs `outputLanguage: "en"`.
- [ ] `13a. Build Tailor Prompt`: receives `outputLanguage: "en"`; OpenAI request body shows `"reasoning":{"effort":"medium"}`.
- [ ] `14. Parse AI Patch`: returned patch contains `visibleWorkIds`, `visibleSkillIds`, `visibleProjectIds`. No `_qualityIssues` mentioning visibility-list absence.
- [ ] `15a. POST Generate Resume PDF`: returns 200 (company is `TestCo GmbH`, not empty/Unknown).
- [ ] `15b. POST Generate Cover Letter PDF`: returns 200.
- [ ] `17. Log to Google Sheets`: row appended to main tab. New columns populated:
  - `Routing Tier` likely `auto` (high confidence for backend role).
  - `Fallback Model Used`: `No`.

### PDF inspection — Resume

- [ ] Profile paragraph reads naturally and includes `Hochschule Fulda`.
- [ ] Phone number on header doesn't break across lines.
- [ ] Total page count is 1–2 (not bloated).
- [ ] Skills section shows only relevant categories (not all 6 by default).
- [ ] No invented "Senior" / "Specialist" titles.

### PDF inspection — Cover letter

- [ ] Body is in English.
- [ ] No banned phrases (`fundierte Kenntnisse`, `passionate`, `team player`, etc.).
- [ ] Footer renders one line per side (no wrap).
- [ ] Date is current.

**Outcome:** _<pass / partial / fail — fill in>_
**Notes:** _<anything noteworthy or surprising>_

---

## Fixture 2 — German JD, normal path

**Synthetic input:**

```json
{
  "title": "Softwareentwickler (Backend)",
  "company": "TestCo GmbH",
  "location": "Frankfurt am Main",
  "description": "Wir suchen einen Backend-Entwickler für unser Team in Frankfurt. Deine Aufgaben: Entwicklung von REST-APIs, Integration externer Systeme, Code Reviews. Anforderungen: 2+ Jahre Node.js, SQL-Datenbanken. Wünschenswert: AWS/Terraform. Wir bieten flexible Arbeitszeiten und ein freundliches Team."
}
```

### Per-node verification

- [ ] `4a. JD Quality Gate`: `_jdQuality.ok === true` (German "Aufgaben" / "Anforderungen" trip the structure regex).
- [ ] `12a. Decide Language`: outputs `outputLanguage: "de"`.
- [ ] `13a`: receives `outputLanguage: "de"`.
- [ ] `14`: patch has visibility lists; cover letter is German.
- [ ] `17. Log to Google Sheets`: row appended.

### PDF inspection — Resume

- [ ] All section headings are German (`PROFIL`, `BERUFSERFAHRUNG`, etc.).
- [ ] Profile text is German and natural-sounding (no "fundierte Kenntnisse" or other extended-banned phrases).
- [ ] Phone unbroken.

### PDF inspection — Cover letter

- [ ] Body is German.
- [ ] Greeting `Sehr geehrte Damen und Herren,` and sign-off `Mit freundlichen Grüßen,` present.
- [ ] German date format (DD. Monat YYYY).
- [ ] No banned German cliché phrases (full extended list from Task 6).

**Outcome:** _<pass / partial / fail>_
**Notes:** _<…>_

---

## Fixture 3 — Malformed JD, must be rejected

**Synthetic input** (empty company):

```json
{
  "title": "Software Developer",
  "company": "",
  "description": "Some description that is at least 600 characters long. Responsibilities: x. Some description that is at least 600 characters long. Responsibilities: x. Some description that is at least 600 characters long. Responsibilities: x. Some description that is at least 600 characters long. Responsibilities: x. Some description that is at least 600 characters long. Responsibilities: x. Some description that is at least 600 characters long. Responsibilities: x. Some description that is at least 600 characters long. Responsibilities: x. "
}
```

### Verification

- [ ] `4a. JD Quality Gate`: `_jdQuality.ok === false`, `_jdQuality.reason === "company_missing"`.
- [ ] `4b. JD Quality OK?` IF: routes to FALSE branch.
- [ ] `4c. Log Bad JD` → `4d. Log Bad JD Sheet`: row appended to **`Rejected JDs`** tab with `Reject Reason: jd_quality_low` and `Reject Detail: company_missing`.
- [ ] **No row in main log tab** for this fixture.
- [ ] **No tokens spent on tailor or cover letter generation** (confirm by reading n8n execution: tailor prompt node is not entered for this item).

### Optional follow-up: server-level guard test

For redundancy, manually `curl` the running PDF service with a deliberately bad payload (verifies Task 8's `validateCompanyParam` guard):

```bash
curl -X POST http://localhost:3000/generate-resume \
  -H "Content-Type: application/json" \
  -d '{"company":"Unknown","patch":{"jobTitle":"X","work":[{"id":"286ca64e-9ab1-4d32-9905-0996d5d6a5c1","description":"<ul><li><p>x</p></li></ul>"}],"skills":[{"id":"some-id","infoHtml":"<p>x</p>"}]}}'
```

- [ ] Returns HTTP 422 with body `{"success":false,"error":"Invalid company parameter","reason_code":"COMPANY_INVALID","detail":"company is 'Unknown'"}`.

**Outcome:** _<pass / partial / fail>_
**Notes:** _<…>_

---

## Cross-fixture spot checks

- [ ] After all 3 fixtures, the main Google Sheet log shows correct `Routing Tier` (auto/review) and `Fallback Model Used` (No/Yes) for each row.
- [ ] No `_qualityIssues` warnings about missing visibility lists in any tailored row (the AI is now reliably emitting them per the updated prompt).
- [ ] Profile paragraph matches Task 7 cleanup (no "Comfortable in AI-assisted", surfaces "85% test coverage" and "41 AWS resources" / "Hochschule Fulda").

---

## Final decision

- [ ] **Phase 0 ready for production runs** — user can resume submitting applications using outputs from the `auto` tier.
- [ ] **Phase 0 needs rework before Phase 1 starts** — list the specific items below and which task they belong to.

**Issues found (if any):**

| # | Severity | Description | Belongs to task | Notes |
|---|---|---|---|---|
|   |          |             |                |       |

---

## Sign-off

**Date:** _<fill in>_
**Operator decision:** _<phase 0 ready / needs rework>_
