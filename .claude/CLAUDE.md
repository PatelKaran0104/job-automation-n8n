# CLAUDE.md — Resume Generator

Node.js/Express service that tailors resumes and cover letters for job applications. n8n drives it: fetches the base resume via `/context`, asks AI for a patch (Gemini match + OpenAI tailor), posts the patch back to merge, render HTML, and export a PDF via Playwright.

## Stack

- Node.js ES modules (`"type": "module"`)
- Express 4.18.2
- Playwright 1.43.0 (Chromium, headless)
- Tests: `node:test` (built-in)
- No DB, no build step, no TypeScript, no linter/formatter

## Main files

- `src/server.js` — Express server, all 3 endpoints
- `src/buildResumeHtml.js` — resume JSON → full HTML page
- `src/mergePatch.js` — applies AI patch to deep clone of base resume
- `src/validatePatch.js` — validates patch shape and IDs (rejects 422)
- `src/mergeCoverLetter.js` — cover-letter HTML via JS template literal
- `src/loadFonts.js` — base64-inlines Source Serif Pro WOFF2
- `data/resume.json` — immutable source of truth (FlowCV export schema)
- `data/Job_Application_Automator_v6.json` — n8n workflow (36 nodes)
- `output/` — generated PDFs, date-organized, git-ignored
- `PIPELINE.md` — full n8n setup guide

## Commands

```bash
npm start                  # port 3000
npm run test:unit          # node:test unit tests
npm test                   # manual resume smoke test
npm run test:coverletter   # manual cover-letter smoke test
```

## API

### `GET /context`
Returns base resume as plain text (HTML stripped). Reads `data/resume.json` fresh per request — not cached. **IDs returned here are the only valid IDs for patches.** Work descriptions use `stripHtmlPreserveBullets()`; other fields use `stripHtml()`.

### `POST /generate-resume`
Body: `{ patch, company, role, language?, jobId? }` — `patch` may also be sent flat at top level (server tries `req.body.patch || req.body`).

`patch` shape: `{ jobTitle, profile, showCertificates?, showProjects?, work[], skills[], projects[] }` — work/skills/projects entries match by `id` from `/context`. `language: "de"` → German headings. Optional `jobId` is echoed in the response for downstream pairing.

Flow: validate → deep-clone base → merge by ID → render HTML → export PDF to `output/YYYY-MM-DD/Resume/resume-{company}--{role}-HHMMSS.pdf`.

Response: `{ success: true, file, fileName, jobId? }`.

### `POST /generate-coverletter`
Body: `{ role, company, companyAddress, paragraph1, paragraph2, paragraph3, language?, jobId? }`. Exports PDF to `output/YYYY-MM-DD/Coverletter/...`.

- Language: `de` (default) → `Sehr geehrte Damen und Herren,` / `Mit freundlichen Grüßen,` / de-DE date. `en` → `Dear Hiring Manager,` / `Kind regards,` / en-US date.
- **Empty-body guard:** if all 3 paragraphs strip to empty, returns 422 with `reason_code: "EMPTY_BODY"` before any PDF work.
- Plain-text paragraphs (no `<`) are auto-wrapped in `<p>` by `wrapParagraph()`.
- Personal contact details, subject line, footer role are hardcoded in `src/mergeCoverLetter.js` — edit the file, not via API.

## Important behavior

- **Never modify `data/resume.json` at runtime.** Loaded once at module import and cached; `applyPatch()` deep-clones via `JSON.parse(JSON.stringify(...))` and mutates only the clone.
- Work/skill/project entries match by `id` only — IDs must come from `/context`.
- `updatedAt` is set to `new Date().toISOString()` on every modified entry.
- **One shared Playwright browser** launches at startup and is reused. Each request opens `browser.newContext()` and closes it in `finally`. Never close the shared browser inside a request handler.
- Never cache cover-letter output — date must be current per request.

## Code conventions

- ES modules only — `import`/`export`, never `require()` (will crash)
- File URLs for data paths: `new URL("../data/resume.json", import.meta.url)`
- camelCase for functions/variables, UPPER_SNAKE_CASE for top-level constants
- Verb-first function names: `applyPatch`, `buildResumeHtml`, `toSlug`, `stripHtml`
- Browser contexts always closed in `finally`

## Non-obvious gotchas

- **`scripts/test.js` sends a flat patch** (no `patch:` wrapper). Server handles both via `applyPatch(patch || req.body)`.
- **`data/resume.json` is a FlowCV export, but FlowCV is no longer used.** Field names like `infoHtml`, `startDateNew`, `endDateNew` look weird but are intentional — don't "fix" them.
- **HTML sanitization whitelist** in `buildResumeHtml.js`: `p, ul, ol, li, strong, em, b, i, br, span`. Anything else is stripped.
- Resume schema is flat (no FlowCV wrapper): `resume.{meta, personalDetails, content.{profile, work, project, education, certificate, skill, language}}`. All `description`/`infoHtml` fields are HTML strings.

## n8n workflow

**Claude Code only edits the Express server — n8n orchestrates everything else.** Trigger is manual. Models (`geminiModel`, `fallbackFilteringModel`, `openaiModel`) are parametrized in node `1. Manual Configuration`. Local server URL: `http://host.docker.internal:3000` (Docker) or `http://localhost:3000` (native). See PIPELINE.md for setup, flow, and how to add a new job board.

---

# Behavioral Guidelines (Karpathy Principles)

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
