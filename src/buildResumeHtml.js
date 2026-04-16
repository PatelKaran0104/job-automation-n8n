// src/buildResumeHtml.js

import { FONT_CSS } from "./loadFonts.js";

// Inline SVG icons — no Font Awesome CDN needed
const ICON = {
  envelope: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="icon"><path d="M48 64C21.5 64 0 85.5 0 112c0 15.1 7.1 29.3 19.2 38.4L236.8 313.6c11.4 8.5 27 8.5 38.4 0L492.8 150.4c12.1-9.1 19.2-23.3 19.2-38.4c0-26.5-21.5-48-48-48H48zM0 176V384c0 35.3 28.7 64 64 64H448c35.3 0 64-28.7 64-64V176L294.4 339.2c-22.8 17.1-54 17.1-76.8 0L0 176z"/></svg>`,
  phone:    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="icon"><path d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z"/></svg>`,
  location: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" class="icon"><path d="M215.7 499.2C267 435 384 279.4 384 192C384 86 298 0 192 0S0 86 0 192c0 87.4 117 243 168.3 307.2c12.3 15.3 35.1 15.3 47.4 0zM192 128a64 64 0 1 1 0 128 64 64 0 1 1 0-128z"/></svg>`,
  globe:    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="icon"><path d="M352 256c0 22.2-1.2 43.6-3.3 64H163.3c-2.2-20.4-3.3-41.8-3.3-64s1.2-43.6 3.3-64H348.7c2.2 20.4 3.3 41.8 3.3 64zm28.8-64H503.9c5.3 20.5 8.1 41.9 8.1 64s-2.8 43.5-8.1 64H380.8c2.1-20.6 3.2-42 3.2-64s-1.1-43.4-3.2-64zm112.6-32H376.7c-10-63.9-29.8-117.4-55.3-151.6c78.3 20.7 142 77.5 171.9 151.6zm-149.1 0H167.7c6.1-36.4 15.5-68.6 27-94.7c10.5-23.6 22.2-40.7 33.5-51.5C239.4 3.2 248.7 0 256 0s16.6 3.2 27.8 13.8c11.3 10.8 23 27.9 33.5 51.5c11.5 26 20.9 58.2 27 94.7zm-209 0H18.6C48.6 85.9 112.2 29.1 190.6 8.4C165.1 42.6 145.3 96.1 135.3 160zM8.1 192H131.2c-2.1 20.6-3.2 42-3.2 64s1.1 43.4 3.2 64H8.1C2.8 299.5 0 278.1 0 256s2.8-43.5 8.1-64zM194.7 446.6c-11.5-26-20.9-58.2-27-94.6H344.3c-6.1 36.4-15.5 68.6-27 94.6c-10.5 23.6-22.2 40.7-33.5 51.5C272.6 508.8 263.3 512 256 512s-16.6-3.2-27.8-13.8c-11.3-10.8-23-27.9-33.5-51.5zM135.3 352c10 63.9 29.8 117.4 55.3 151.6C112.2 482.9 48.6 426.1 18.6 352H135.3zm358.1 0c-30 74.1-93.6 130.9-171.9 151.6c25.5-34.2 45.2-87.7 55.3-151.6H493.4z"/></svg>`,
  github:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 496 512" class="icon"><path d="M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3.3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5.3-6.2 2.3zm44.2-1.7c-2.9.7-4.9 2.6-4.6 4.9.3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 389.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3.7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3.3 2.9 2.3 3.9 1.6 1 3.6.7 4.3-.7.7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3.7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3.7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z"/></svg>`,
  linkedin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" class="icon"><path d="M100.28 448H7.4V148.9h92.88zM53.79 108.1C24.09 108.1 0 83.5 0 53.8a53.79 53.79 0 0 1 107.58 0c0 29.7-24.1 54.3-53.79 54.3zM447.9 448h-92.68V302.4c0-34.7-.7-79.2-48.29-79.2-48.29 0-55.69 37.7-55.69 76.7V448h-92.78V148.9h89.08v40.8h1.3c12.4-23.5 42.69-48.3 87.88-48.3 94 0 111.28 61.9 111.28 142.3V448z"/></svg>`,
};

const ALLOWED_TAGS = new Set(["p", "ul", "ol", "li", "strong", "em", "b", "i", "br", "span"]);

function sanitizeHtml(html = "") {
  return html.replace(/<\/?([a-z0-9]+)[^>]*>/gi, (match, tag) =>
    ALLOWED_TAGS.has(tag.toLowerCase()) ? match : ""
  );
}

function stripHtml(html = "") {
  return html.replace(/<[^>]+>/g, "").trim();
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// Strip block-level wrappers to produce inline-safe content
function inlineHtml(html = "") {
  return sanitizeHtml(html)
    .replace(/<\/?(p|ul|ol|li)[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function entryMeta(start, end, location) {
  const dates = [start, end].filter(Boolean).join(" \u2013 ");
  return [dates, location].filter(Boolean).join(" | ");
}

function renderProfile(resume) {
  const text = sanitizeHtml(resume.content.profile?.entries?.[0]?.text || "");
  if (!text) return "";
  const heading = resume.content.profile.displayName || "PROFILE";
  return `
  <div class="section">
    <div class="section-heading">${escapeHtml(heading)}</div>
    <div>${text}</div>
  </div>`;
}

function renderWork(resume) {
  const entries = resume.content.work?.entries || [];
  if (!entries.length) return "";
  const heading = resume.content.work.displayName || "PROFESSIONAL EXPERIENCE";
  const items = entries.map(e => {
    const meta = entryMeta(e.startDateNew, e.endDateNew, e.location);
    const left = e.jobTitle
      ? `<strong>${escapeHtml(e.employer)},</strong> <em>${escapeHtml(e.jobTitle)}</em>`
      : `<strong>${escapeHtml(e.employer)}</strong>`;
    return `
    <div class="work-entry">
      <div class="entry-header">
        <span class="entry-left">${left}</span>
        <span class="entry-right">${escapeHtml(meta)}</span>
      </div>
      ${e.description ? `<div>${sanitizeHtml(e.description)}</div>` : ""}
    </div>`;
  }).join("");
  return `
  <div class="section">
    <div class="section-heading">${escapeHtml(heading)}</div>
    ${items}
  </div>`;
}

function renderEducation(resume) {
  const entries = resume.content.education?.entries || [];
  if (!entries.length) return "";
  const heading = resume.content.education.displayName || "EDUCATION";
  const items = entries.map(e => {
    const meta = entryMeta(e.startDateNew, e.endDateNew, e.location);
    const left = e.degree
      ? `<strong>${escapeHtml(e.school)},</strong> <em>${escapeHtml(e.degree)}</em>`
      : `<strong>${escapeHtml(e.school)}</strong>`;
    return `
    <div class="edu-entry">
      <div class="entry-header">
        <span class="entry-left">${left}</span>
        <span class="entry-right">${escapeHtml(meta)}</span>
      </div>
      ${e.description ? `<div class="edu-desc">${sanitizeHtml(e.description)}</div>` : ""}
    </div>`;
  }).join("");
  return `
  <div class="section">
    <div class="section-heading">${escapeHtml(heading)}</div>
    ${items}
  </div>`;
}

function renderCertificates(resume) {
  if (resume.meta?.showCertificates === false) return "";
  const entries = resume.content.certificate?.entries || [];
  if (!entries.length) return "";
  const heading = resume.content.certificate.displayName || "CERTIFICATES";
  const items = entries.map(e => `<li>${escapeHtml(e.certificate || "")}</li>`).join("");
  return `
  <div class="section">
    <div class="section-heading">${escapeHtml(heading)}</div>
    <ul class="cert-list">${items}</ul>
  </div>`;
}

function renderSkills(resume) {
  const entries = resume.content.skill?.entries || [];
  if (!entries.length) return "";
  const heading = resume.content.skill.displayName || "SKILLS";
  const items = entries.map(e =>
    `<p class="skill-entry"><strong>${escapeHtml(e.skill)}:</strong> ${inlineHtml(e.infoHtml || "")}</p>`
  ).join("");
  return `
  <div class="section">
    <div class="section-heading">${escapeHtml(heading)}</div>
    ${items}
  </div>`;
}

function renderProjects(resume) {
  if (resume.meta?.showProjects === false) return "";
  const entries = resume.content.project?.entries || [];
  if (!entries.length) return "";
  const heading = resume.content.project.displayName || "PROJECTS";
  const items = entries.map(e => {
    const nameHtml = escapeHtml(e.name || "");
    const rightParts = [e.techStack ? escapeHtml(e.techStack) : "", e.url ? escapeHtml(e.url) : ""].filter(Boolean);
    return `
    <div class="project-entry">
      <div class="entry-header">
        <span class="entry-left"><strong>${nameHtml}</strong></span>
        ${rightParts.length ? `<span class="entry-right">${rightParts.join(" | ")}</span>` : ""}
      </div>
      ${e.description ? `<div>${sanitizeHtml(e.description)}</div>` : ""}
    </div>`;
  }).join("");
  return `
  <div class="section">
    <div class="section-heading">${escapeHtml(heading)}</div>
    ${items}
  </div>`;
}

function renderLanguages(resume) {
  const entries = resume.content.language?.entries || [];
  if (!entries.length) return "";
  const heading = resume.content.language.displayName || "LANGUAGES";
  const items = entries.map(e => `
    <div>
      <div>${escapeHtml(e.language)}</div>
      <div>${stripHtml(e.infoHtml || "")}</div>
    </div>`).join("");
  return `
  <div class="section">
    <div class="section-heading">${escapeHtml(heading)}</div>
    <div class="lang-grid">${items}</div>
  </div>`;
}

const SECTION_RENDERERS = {
  profile:     renderProfile,
  work:        renderWork,
  project:     renderProjects,
  education:   renderEducation,
  certificate: renderCertificates,
  skill:       renderSkills,
  language:    renderLanguages,
};

// Matches the PDF section order
const DEFAULT_ORDER = ["profile", "work", "project", "education", "certificate", "skill", "language"];

// German overrides for section headings (used when language === "de")
const DE_HEADINGS = {
  profile:     "PROFIL",
  work:        "BERUFSERFAHRUNG",
  project:     "PROJEKTE",
  education:   "AUSBILDUNG",
  certificate: "ZERTIFIKATE",
  skill:       "KENNTNISSE",
  language:    "SPRACHEN",
};

export function buildResumeHtml(resume, options = {}) {
  if (!resume?.content) throw new Error("Invalid resume structure: missing content");
  if (!resume?.personalDetails) throw new Error("Invalid resume structure: missing personalDetails");

  const p = resume.personalDetails;
  const link = (href, icon, text) =>
    `<a href="${href}" class="contact-link"><span>${icon} ${escapeHtml(text)}</span></a>`;

  const contactLine1 = [
    p.displayEmail && link(`mailto:${p.displayEmail}`, ICON.envelope, p.displayEmail),
    p.phone        && link(`tel:${p.phone.replace(/\s/g, "")}`, ICON.phone, p.phone),
    p.address      && `<span>${ICON.location} ${escapeHtml(p.address)}</span>`,
    p.website      && link(`https://${p.website}`, ICON.globe, p.website),
  ].filter(Boolean);

  const contactLine2 = [
    p.social?.github?.display   && link(`https://${p.social.github.display}`, ICON.github, p.social.github.display),
    p.social?.linkedIn?.display && link(`https://${p.social.linkedIn.display}`, ICON.linkedin, p.social.linkedIn.display),
  ].filter(Boolean);

  const contactRow = [
    contactLine1.join(" · "),
    contactLine2.length ? contactLine2.join(" · ") : "",
  ].filter(Boolean).join("<br>");
  // Override section headings for German output
  if (options.language === "de") {
    for (const [key, heading] of Object.entries(DE_HEADINGS)) {
      if (resume.content[key]) resume.content[key].displayName = heading;
    }
  }

  const order = options.sectionOrder || DEFAULT_ORDER;
  const sections = order.map(key => SECTION_RENDERERS[key]?.(resume) || "").join("\n");

  const htmlLang = options.language === "de" ? "de" : "en";

  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8" />
  <style>
    ${FONT_CSS}
    @page { size: A4; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Source Serif Pro', Georgia, 'Times New Roman', serif;
      font-size: 10pt;
      line-height: 1.5;
      color: #000;
      background: #fff;
    }
    .icon {
      width: 0.85em; height: 0.85em;
      vertical-align: -0.125em;
      fill: currentColor;
      display: inline-block;
    }
    .header { text-align: center; margin-bottom: 14px; }
    .name { font-size: 22pt; font-weight: 700; }
    .job-title { font-size: 12pt; font-style: italic; margin-top: 2px; }
    .contact-row { margin-top: 8px; font-size: 9pt; }
    .contact-link { color: #1a5276; text-decoration: none; }
    .header hr { border: none; border-top: 1px solid #000; margin-top: 10px; }
    .section { margin-bottom: 10px; }
    .section-heading {
      font-size: 10.5pt;
      font-weight: 700;
      text-transform: uppercase;
      border-bottom: 1px solid #000;
      padding-bottom: 2px;
      margin-bottom: 6px;
    }
    .entry-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .entry-left { flex: 1; min-width: 0; }
    .entry-right { white-space: nowrap; font-size: 9.5pt; flex-shrink: 0; }
    .work-entry { margin-bottom: 10px; page-break-inside: avoid; }
    .edu-entry  { margin-bottom: 10px; page-break-inside: avoid; }
    .edu-desc { font-size: 9.5pt; }
    .project-entry { margin-bottom: 10px; page-break-inside: avoid; }
    .cert-list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px 8px;
      list-style: disc;
      padding-left: 16px;
    }
    .skill-entry { margin-bottom: 3px; }
    .lang-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 0; }
    ul { margin: 4px 0; padding-left: 16px; }
    li { margin: 0; }
    p  { margin: 2px 0; }
  </style>
</head>
<body>
  <div class="header">
    <div class="name">${escapeHtml(p.fullName || "")}</div>
    <div class="job-title">${escapeHtml(p.jobTitle || "")}</div>
    <div class="contact-row">${contactRow}</div>
    <hr />
  </div>
  ${sections}
</body>
</html>`;
}
