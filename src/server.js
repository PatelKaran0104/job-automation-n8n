import express from "express";
import { chromium } from "playwright";
import { mkdirSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { applyPatch } from "./mergePatch.js";
import { buildCoverLetterHtml } from "./mergeCoverLetter.js";
import { buildResumeHtml } from "./buildResumeHtml.js";
import { validatePatch } from "./validatePatch.js";

const OUTPUT_DIR = resolve("output");
mkdirSync(OUTPUT_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: "10mb" }));

// Shared browser instance — launched once at startup, reused across all requests
const browser = await chromium.launch({ headless: true });

// Sanitize company name for safe filenames: "SAP SE" → "sap-se"
function toSlug(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "company";
}

// Strips HTML tags to give AI clean plain text
function stripHtml(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// GET /context — returns only the human-readable resume content for AI input
app.get("/context", (_req, res) => {
  const base = JSON.parse(readFileSync(new URL("../data/resume.json", import.meta.url)));
  const resume = base.data.resumes[0];
  res.json({
    currentJobTitle: resume.personalDetails.jobTitle,
    currentProfile: stripHtml(resume.content.profile.entries[0]?.text),
    currentWork: resume.content.work.entries.map((e) => ({
      id: e.id,
      employer: e.employer,
      jobTitle: e.jobTitle,
      location: e.location,
      startDate: e.startDateNew,
      endDate: e.endDateNew,
      description: stripHtml(e.description),
    })),
    currentSkills: resume.content.skill.entries.map((e) => ({
      id: e.id,
      skill: e.skill,
      details: stripHtml(e.infoHtml),
    })),
  });
});

// POST /generate-resume
// Body: { patch: {...}, company: "SAP SE" }
app.post("/generate-resume", async (req, res) => {
  const { patch, company } = req.body;
  const rawPatch = patch || req.body;

  const validation = validatePatch(rawPatch);
  if (validation.warnings.length > 0) {
    console.warn("[/generate-resume] Patch warnings:", validation.warnings);
  }
  if (!validation.valid) {
    console.error("[/generate-resume] Invalid patch:", validation.errors);
    return res
      .status(422)
      .json({ success: false, error: "Invalid patch", details: validation.errors });
  }

  const mergedResume = applyPatch(rawPatch);
  const slug = toSlug(company || "company");
  const outPath = resolve(OUTPUT_DIR, `resume-${slug}.pdf`);

  let context;
  try {
    const html = buildResumeHtml(mergedResume);
    context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      margin: { top: "15mm", right: "18mm", bottom: "15mm", left: "18mm" },
    });
    if (!existsSync(outPath)) {
      throw new Error(`PDF was not written to disk: ${outPath}`);
    }
    res.json({ success: true, file: outPath });
  } catch (err) {
    console.error("Resume generation error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (context) await context.close();
  }
});

// POST /generate-coverletter
// Body: { role, company, companyAddress, paragraph1, paragraph2, paragraph3 }
app.post("/generate-coverletter", async (req, res) => {
  const { company } = req.body;
  const slug = toSlug(company || "company");
  const outPath = resolve(OUTPUT_DIR, `coverletter-${slug}.pdf`);

  let context;
  try {
    const html = buildCoverLetterHtml(req.body);
    context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    if (!existsSync(outPath)) {
      throw new Error(`PDF was not written to disk: ${outPath}`);
    }
    res.json({ success: true, file: outPath });
  } catch (err) {
    console.error("Cover letter generation error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (context) await context.close();
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
