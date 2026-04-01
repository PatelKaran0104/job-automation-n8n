// src/validatePatch.js
import { readFileSync } from "fs";

const baseResume = JSON.parse(
  readFileSync(new URL("../data/resume.json", import.meta.url))
);
const resumeData = baseResume.data.resumes[0];

const VALID_WORK_IDS = new Set(resumeData.content.work.entries.map((e) => e.id));
const VALID_SKILL_IDS = new Set(resumeData.content.skill.entries.map((e) => e.id));

/**
 * Validates an AI-generated patch before applyPatch() is called.
 *
 * @param {unknown} patch - The value received from req.body.patch or req.body
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 *
 * valid:false  → patch has no actionable content or is structurally broken
 * warnings     → unknown IDs or missing optional fields (patch still applied)
 */
export function validatePatch(patch) {
  const errors = [];
  const warnings = [];

  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    errors.push("patch must be a plain object");
    return { valid: false, errors, warnings };
  }

  if (patch._error) {
    errors.push(`AI parse failed: ${patch._error}`);
    return { valid: false, errors, warnings };
  }

  // Type checks for work and skills — before content-presence check
  if (patch.work !== undefined && !Array.isArray(patch.work)) {
    errors.push("patch.work must be an array if present");
  }
  if (patch.skills !== undefined && !Array.isArray(patch.skills)) {
    errors.push("patch.skills must be an array if present");
  }
  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  const hasTitle =
    typeof patch.jobTitle === "string" && patch.jobTitle.trim().length > 0;
  const hasProfile =
    typeof patch.profile === "string" && patch.profile.trim().length > 0;
  const hasWork = Array.isArray(patch.work) && patch.work.length > 0;
  const hasSkills = Array.isArray(patch.skills) && patch.skills.length > 0;

  if (!hasTitle && !hasProfile && !hasWork && !hasSkills) {
    errors.push(
      "patch has no actionable content: all sections are empty or missing"
    );
    return { valid: false, errors, warnings };
  }

  if (hasWork) {
    for (const item of patch.work) {
      if (!item || typeof item !== "object") {
        warnings.push("work array contains non-object item (skipped)");
        continue;
      }
      if (!item.id) {
        warnings.push(
          `work item missing id — will be ignored: ${JSON.stringify(item).slice(0, 80)}`
        );
        continue;
      }
      if (!VALID_WORK_IDS.has(item.id)) {
        warnings.push(`unknown work id "${item.id}" — will be ignored`);
      }
      if (!item.description) {
        warnings.push(`work item "${item.id}" has no description`);
      }
    }
  }

  if (hasSkills) {
    for (const item of patch.skills) {
      if (!item || typeof item !== "object") {
        warnings.push("skills array contains non-object item (skipped)");
        continue;
      }
      if (!item.id) {
        warnings.push(
          `skill item missing id — will be ignored: ${JSON.stringify(item).slice(0, 80)}`
        );
        continue;
      }
      if (!VALID_SKILL_IDS.has(item.id)) {
        warnings.push(`unknown skill id "${item.id}" — will be ignored`);
      }
      if (!item.infoHtml) {
        warnings.push(`skill item "${item.id}" has no infoHtml`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
