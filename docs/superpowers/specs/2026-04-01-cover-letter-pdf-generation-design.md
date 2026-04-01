# Cover Letter PDF Generation — Design Spec
**Date:** 2026-04-01

## Goal

Generate a cover letter PDF via the existing `/generate-coverletter` endpoint as part of the n8n automation pipeline, mirroring the resume PDF generation flow. Replace the current behaviour of storing raw cover letter text in Google Sheets with storing the generated PDF file path.

## Current State

```
11. Parse AI Patch → 12. POST Generate Resume PDF → 13. Prepare Sheet Log → 14. Log to Sheets
```

- Node 11 outputs `coverLetter` as a single plain-text string (`"p1\n\np2\n\np3"`)
- Node 13 stores that text directly in the Google Sheets "Cover Letter" column

## Target State

```
11. Parse AI Patch → 12. POST Generate Resume PDF → 12b. POST Generate Cover Letter PDF → 13. Prepare Sheet Log → 14. Log to Sheets
```

- Node 12b calls `POST /generate-coverletter` and returns `{ success, file }`
- Node 13 stores the PDF file path in a renamed "Cover Letter File" column

---

## Changes

### 1. Node `11. Parse AI Patch` (modify)

Split `coverLetter` into three paragraph fields before outputting:

```js
const parts = (coverLetter || '').split(/\n\n+/);
// Add to output json:
paragraph1: parts[0] || ''
paragraph2: parts[1] || ''
paragraph3: parts[2] || ''
```

Full output shape after change:
```json
{
  "patch": {},
  "coverLetter": "p1\n\np2\n\np3",
  "paragraph1": "p1",
  "paragraph2": "p2",
  "paragraph3": "p3",
  "job": { "title", "company", "location", ... }
}
```

### 2. New node `12b. POST Generate Cover Letter PDF` (add)

- **Type:** `n8n-nodes-base.httpRequest`
- **Method:** POST
- **URL:** `http://host.docker.internal:3000/generate-coverletter`
- **Body (JSON):**
  ```json
  {
    "role":           "={{ $('11. Parse AI Patch').first().json.job.title }}",
    "company":        "={{ $('11. Parse AI Patch').first().json.job.company }}",
    "companyAddress": "={{ $('11. Parse AI Patch').first().json.job.location }}",
    "paragraph1":     "={{ $('11. Parse AI Patch').first().json.paragraph1 }}",
    "paragraph2":     "={{ $('11. Parse AI Patch').first().json.paragraph2 }}",
    "paragraph3":     "={{ $('11. Parse AI Patch').first().json.paragraph3 }}"
  }
  ```
- **Timeout:** 60000ms (same as node 12)
- **Position:** wired after `12. POST Generate Resume PDF`, before `13. Prepare Sheet Log`

### 3. Node `13. Prepare Sheet Log` (modify)

- Change `'Cover Letter': patchData.coverLetter` → `'Cover Letter File': $input.first().json.file || ''`
- Update Status logic: `generateResult.success` refers to resume; add cover letter success check:
  ```js
  const resumeResult = $('12. POST Generate Resume PDF').first().json;
  const coverLetterResult = $input.first().json; // now comes from 12b
  Status: (resumeResult.success && coverLetterResult.success) ? 'Generated' : 'PDF Failed'
  ```

### 4. Node `14. Log to Google Sheets` (modify)

Rename schema entry:
- `id: "Cover Letter"` → `id: "Cover Letter File"`
- `displayName: "Cover Letter"` → `displayName: "Cover Letter File"`

---

## Connections

| From | To |
|------|----|
| `12. POST Generate Resume PDF` | `12b. POST Generate Cover Letter PDF` |
| `12b. POST Generate Cover Letter PDF` | `13. Prepare Sheet Log` |

Remove existing connection: `12. POST Generate Resume PDF` → `13. Prepare Sheet Log`

---

## Behaviour Notes

- `companyAddress` uses `job.location` (job city, not HQ address) — acceptable trade-off; field defaults to `""` if blank
- Cover letter PDF is saved to `output/coverletter-{slug}.pdf` (same slug logic as resume)
- If cover letter generation fails, `file` will be undefined; node 13 gracefully falls back to `''`
- Google Sheets column rename from "Cover Letter" to "Cover Letter File" — existing rows will have blank in the new column (expected)
