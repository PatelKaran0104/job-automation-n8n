import { readFileSync } from "fs";
const baseResume = JSON.parse(readFileSync(new URL("../data/resume.json", import.meta.url)));

/**
 * Merges an AI patch into the base FlowCV resume JSON.
 *
 * AI patch shape:
 * {
 *   jobTitle?: string,
 *   profile?: string,        // HTML string
 *   work?: [{ id, description }],
 *   skills?: [{ id, infoHtml }]
 * }
 */
export function applyPatch(patch) {
  // Deep clone base to avoid mutating the imported module
  const resume = JSON.parse(JSON.stringify(baseResume));
  const data = resume.data.resumes[0];

  if (patch.jobTitle) {
    data.personalDetails.jobTitle = patch.jobTitle;
  }

  if (patch.profile) {
    data.content.profile.entries[0].text = patch.profile;
    data.content.profile.entries[0].updatedAt = new Date().toISOString();
  }

  if (patch.work) {
    for (const workPatch of patch.work) {
      const entry = data.content.work.entries.find((e) => e.id === workPatch.id);
      if (entry) {
        entry.description = workPatch.description;
        entry.updatedAt = new Date().toISOString();
      }
    }
  }

  if (patch.skills) {
    for (const skillPatch of patch.skills) {
      const entry = data.content.skill.entries.find((e) => e.id === skillPatch.id);
      if (entry) {
        entry.infoHtml = skillPatch.infoHtml;
        entry.updatedAt = new Date().toISOString();
      }
    }
  }

  return data;
}
