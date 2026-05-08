import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatch } from "../src/mergePatch.js";
import { readFileSync } from "fs";

const baseResume = JSON.parse(
  readFileSync(new URL("../data/resume.json", import.meta.url))
);

const ALL_WORK_IDS = baseResume.content.work.entries.map(e => e.id);
const FIRST_WORK_ID = ALL_WORK_IDS[0];
const ALL_SKILL_IDS = baseResume.content.skill.entries.map(e => e.id);
const ALL_PROJECT_IDS = (baseResume.content.project?.entries || []).map(e => e.id);

test("visibleWorkIds filters to listed entries only", () => {
  const result = applyPatch({
    work: [{ id: FIRST_WORK_ID, description: "<ul><li><p>x</p></li></ul>" }],
    skills: [{ id: ALL_SKILL_IDS[0], infoHtml: "<p>x</p>" }],
    visibleWorkIds: [FIRST_WORK_ID],
  });
  assert.equal(result.content.work.entries.length, 1);
  assert.equal(result.content.work.entries[0].id, FIRST_WORK_ID);
});

test("visibleSkillIds filters to listed entries only", () => {
  const result = applyPatch({
    work: [{ id: FIRST_WORK_ID, description: "<ul><li><p>x</p></li></ul>" }],
    skills: [{ id: ALL_SKILL_IDS[0], infoHtml: "<p>x</p>" }],
    visibleSkillIds: [ALL_SKILL_IDS[0]],
  });
  assert.equal(result.content.skill.entries.length, 1);
  assert.equal(result.content.skill.entries[0].id, ALL_SKILL_IDS[0]);
});

test("visibleProjectIds filters to listed entries only", () => {
  if (ALL_PROJECT_IDS.length < 2) return; // Skip if base has <2 projects
  const result = applyPatch({
    work: [{ id: FIRST_WORK_ID, description: "<ul><li><p>x</p></li></ul>" }],
    skills: [{ id: ALL_SKILL_IDS[0], infoHtml: "<p>x</p>" }],
    projects: [{ id: ALL_PROJECT_IDS[0], description: "<ul><li><p>x</p></li></ul>" }],
    visibleProjectIds: [ALL_PROJECT_IDS[0]],
  });
  assert.equal(result.content.project.entries.length, 1);
});

test("absent visibility list preserves existing behavior (no filter)", () => {
  const result = applyPatch({
    work: [{ id: FIRST_WORK_ID, description: "<ul><li><p>x</p></li></ul>" }],
    skills: [{ id: ALL_SKILL_IDS[0], infoHtml: "<p>x</p>" }],
  });
  assert.equal(result.content.work.entries.length, ALL_WORK_IDS.length);
  assert.equal(result.content.skill.entries.length, ALL_SKILL_IDS.length);
});

test("empty visibility list filters out everything in that section", () => {
  const result = applyPatch({
    work: [{ id: FIRST_WORK_ID, description: "<ul><li><p>x</p></li></ul>" }],
    skills: [{ id: ALL_SKILL_IDS[0], infoHtml: "<p>x</p>" }],
    visibleWorkIds: [],
  });
  assert.equal(result.content.work.entries.length, 0);
});
