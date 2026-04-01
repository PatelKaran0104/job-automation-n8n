/**
 * Test script — simulates what n8n will POST to the server.
 * Usage:
 *   1. Start the server: npm start
 *   2. In another terminal: node test.js
 */

const patch = {
  jobTitle: "Salesforce Solution Architect",
  profile:
    "<p>Salesforce Developer and certified Agentforce Specialist with 2+ years of experience. Specialized in designing scalable Salesforce architectures, REST API integrations, and AI-assisted engineering. Proven track record delivering end-to-end solutions for SME clients.</p>",
  work: [
    {
      id: "286ca64e-9ab1-4d32-9905-0996d5d6a5c1",
      description:
        "<ul><li><p>Designed and delivered scalable Salesforce architectures for SME clients, applying solution design principles across Sales Cloud, Service Cloud, and Agentforce AI integrations.</p></li><li><p>Built REST API integrations connecting Salesforce to third-party systems including QuickBooks, HomeAdvisor, and an aerospace parts inventory platform.</p></li></ul>",
    },
  ],
  skills: [
    {
      id: "9a905d12-825c-4090-a90c-3ff010a9d8b4",
      infoHtml:
        "<p>Apex, Lightning Web Components (LWC), Aura, SOQL/SOSL, Triggers, Flows, Salesforce DX, Governor Limit Optimization, Solution Architecture</p>",
    },
  ],
};

const response = await fetch("http://localhost:3000/generate-resume", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ patch, company: "Test Company" }),
});

const result = await response.json();
console.log("Response:", result);

if (result.success) {
  console.log("PDF saved at:", result.file);
} else {
  console.error("Failed:", result);
}
