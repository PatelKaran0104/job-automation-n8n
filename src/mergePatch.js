import { readFileSync } from "fs";
const baseResume = JSON.parse(readFileSync(new URL("../data/resume.json", import.meta.url)));

/**
 * Merges an AI patch into the base resume JSON.
 *
 * AI patch shape:
 * {
 *   jobTitle?: string,
 *   profile?: string,           // HTML string
 *   showCertificates?: false,   // omit section when Salesforce certs are irrelevant
 *   showProjects?: false,       // omit projects section
 *   work?: [{ id, description }],
 *   skills?: [{ id, skill?, infoHtml }],  // skill renames the category label
 *   projects?: [{ id, description?, techStack?, name? }]
 * }
 */
export function applyPatch(patch) {
  // Deep clone base to avoid mutating the imported module
  const data = JSON.parse(JSON.stringify(baseResume));

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
        if (skillPatch.skill) entry.skill = skillPatch.skill;
        if (skillPatch.infoHtml) entry.infoHtml = skillPatch.infoHtml;
        entry.updatedAt = new Date().toISOString();
      }
    }
  }

  if (patch.projects) {
    for (const projPatch of patch.projects) {
      const entry = data.content.project?.entries?.find((e) => e.id === projPatch.id);
      if (entry) {
        if (projPatch.description) entry.description = projPatch.description;
        if (projPatch.techStack) entry.techStack = projPatch.techStack;
        if (projPatch.name) entry.name = projPatch.name;
        entry.updatedAt = new Date().toISOString();
      }
    }
  }

  if (patch.showCertificates === false) {
    data.meta = data.meta || {};
    data.meta.showCertificates = false;
  }

  if (patch.showProjects === false) {
    data.meta = data.meta || {};
    data.meta.showProjects = false;
  }

  return data;
}
