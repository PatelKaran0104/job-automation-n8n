import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCoverLetter } from "../src/validateCoverLetter.js";

// Word-count-correct fixtures used across tests.
// P1=60 words, P2=95 words, P3=50 words — inside all targets.
const goodDe = {
  language: "de",
  paragraph1:
    "Die Verantwortung für eine Terraform-basierte AWS-Infrastruktur in der CIAM-Domäne deckt sich exakt mit meiner aktuellen Praxis bei MV Clouds. " +
    "Mein M.Sc. Global Software Development an der Hochschule Fulda fokussiert auf verteilte Cloud-Architekturen und liefert die methodische Grundlage. " +
    "Bei MV Clouds betreibe ich eine produktionsreife AWS-Umgebung mit 41 Terraform-verwalteten Ressourcen und einer Jenkins-CI-CD-Pipeline. " +
    "Diese Erfahrung passt direkt zu Ihrer Stellenausschreibung, da Skalierbarkeit und Betriebsstabilität meine täglichen Aufgaben sind im Team.",
  paragraph2:
    "Bei MV Clouds habe ich eine Terraform-basierte AWS-Architektur mit 41 verwalteten Ressourcen in mehreren Verfügbarkeitszonen produktiv aufgebaut, inklusive VPC, RDS und EC2-Komponenten. " +
    "Parallel habe ich eine Jenkins-CI-CD-Pipeline implementiert, die die durchschnittliche Bereitstellungszeit um etwa 40 Prozent reduziert hat. " +
    "Für Salesforce-Integrationen habe ich REST-APIs entworfen, über die Agentforce-Agenten in Echtzeit mit externen Systemen kommunizieren. " +
    "Mein veröffentlichtes AppExchange-Paket erreicht über 85 Prozent Apex-Testabdeckung im vollständigen Sicherheitsreview-Zyklus. " +
    "Diese Skalierungs- und Automatisierungserfahrung deckt sich direkt mit Ihrer Anforderung an stabile, hochverfügbare Cloud-Services für Ihre Plattform.",
  paragraph3:
    "Ich bin ab sofort für eine Vollzeitstelle verfügbar und kann zum nächstmöglichen Termin mit Ihnen beginnen. " +
    "Mein Wohnsitz in Hessen ermöglicht sowohl die Vor-Ort-Arbeit in München als auch eine Remote-Tätigkeit. " +
    "Über die Möglichkeit eines persönlichen Gesprächs würde ich mich sehr freuen. " +
    "Gerne bespreche ich mit Ihnen die konkreten nächsten Schritte im Bewerbungsprozess.",
};

test("good DE letter passes with severity ok", () => {
  const r = validateCoverLetter(goodDe);
  assert.equal(r.valid, true);
  assert.equal(r.severity, "ok");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("missing paragraph1 → fail", () => {
  const r = validateCoverLetter({ ...goodDe, paragraph1: "" });
  assert.equal(r.valid, false);
  assert.equal(r.severity, "fail");
  assert.ok(r.errors.some((e) => e.includes("paragraph1 is empty")));
});

test("banned opener 'Ich bewerbe mich' → fail", () => {
  const r = validateCoverLetter({
    ...goodDe,
    paragraph1: "Ich bewerbe mich auf die Stelle als Cloud Engineer bei Ihnen, da ich mein M.Sc. Global Software Development an der Hochschule Fulda mit Cloud-Schwerpunkt absolviere und seit zwei Jahren AWS-Infrastruktur produktiv betreue mit Terraform.",
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.toLowerCase().includes("banned opener")));
});

test("missing Hochschule Fulda anchor in P1 → fail", () => {
  const r = validateCoverLetter({
    ...goodDe,
    paragraph1: "Die Verantwortung für eine Terraform-basierte AWS-Infrastruktur deckt sich mit meiner Praxis. Ich habe ein Masterstudium in Informatik abgeschlossen und betreibe AWS produktiv. Bei MV Clouds arbeite ich täglich mit 41 Ressourcen. Diese Erfahrung passt direkt zur Ausschreibung.",
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("Hochschule Fulda")));
});

test("banned phrase 'bringe ich' in body → warn", () => {
  const polluted = {
    ...goodDe,
    paragraph2: goodDe.paragraph2 + " Diese Kompetenzen bringe ich mit.",
  };
  const r = validateCoverLetter(polluted);
  assert.equal(r.valid, true);
  assert.equal(r.severity, "warn");
  assert.ok(r.warnings.some((w) => w.includes("bringe ich")));
});

test("P2 below word floor → warn", () => {
  const tooShort = { ...goodDe, paragraph2: "Bei MV Clouds habe ich Terraform und AWS eingesetzt. Ich habe Apex-Tests geschrieben." };
  const r = validateCoverLetter(tooShort);
  assert.equal(r.severity, "warn");
  assert.ok(r.warnings.some((w) => w.includes("paragraph2") && w.includes("below floor")));
});

test("P2 missing numeric metrics → warn", () => {
  const noNumbers = {
    ...goodDe,
    paragraph2:
      "Bei MV Clouds habe ich eine Terraform-basierte AWS-Architektur produktiv aufgebaut, inklusive VPC, RDS und EC2-Komponenten. " +
      "Parallel habe ich eine Jenkins-Pipeline implementiert, die die durchschnittliche Bereitstellungszeit reduziert hat. " +
      "Für Salesforce-Integrationen habe ich REST-APIs entworfen, über die Agentforce-Agenten in Echtzeit mit externen Systemen kommunizieren. " +
      "Mein AppExchange-Paket erreicht hohe Apex-Testabdeckung im Sicherheitsreview. " +
      "Diese Erfahrung deckt sich mit Ihrer Anforderung an stabile, hochverfügbare Cloud-Services für Ihre Plattform.",
  };
  const r = validateCoverLetter(noNumbers);
  assert.equal(r.severity, "warn");
  assert.ok(r.warnings.some((w) => w.includes("numeric metric")));
});

test("EN banned opener 'I am writing to apply' → fail", () => {
  const r = validateCoverLetter({
    language: "en",
    paragraph1: "I am writing to apply for the React Engineer role at your company, where my M.Sc. Global Software Development at Hochschule Fulda directly applies. I have built React and TypeScript apps. The role mirrors my work. I look forward to it.",
    paragraph2: goodDe.paragraph2,
    paragraph3: goodDe.paragraph3,
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.toLowerCase().includes("banned opener")));
});

test("auto-detects DE language when not specified", () => {
  const r = validateCoverLetter({
    paragraph1: goodDe.paragraph1,
    paragraph2: goodDe.paragraph2,
    paragraph3: goodDe.paragraph3,
  });
  assert.equal(r.stats.language, "de");
});

test("stats include word + sentence counts per paragraph", () => {
  const r = validateCoverLetter(goodDe);
  assert.equal(typeof r.stats.p1.words, "number");
  assert.equal(typeof r.stats.p1.sentences, "number");
  assert.ok(r.stats.p1.words >= 50 && r.stats.p1.words <= 70);
  assert.ok(r.stats.p2.words >= 80 && r.stats.p2.words <= 110);
  assert.ok(r.stats.p3.words >= 40 && r.stats.p3.words <= 60);
});
