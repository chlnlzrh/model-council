# 08 — Specialist Panel Mode

> Role-assigned expert analysis from multiple perspectives, synthesized into an integrated assessment.

**Family:** Role-Based
**Status:** Specified (Pre-Implementation)
**Min Models:** 2 specialists + 1 synthesizer
**Max Models:** 6 specialists + 1 synthesizer
**Multi-turn:** No

---

## A. Requirements

### Functional

1. User submits content for multi-perspective expert analysis.
2. User selects 2-6 specialist roles from the role library (or defines custom roles).
3. Each specialist role is assigned to a model.
4. **Stage 1 — Specialist Analysis:** Each model analyzes the same input from its assigned expert perspective in parallel. Each receives a unique system prompt establishing expertise, priorities, and evaluation criteria. Each produces a structured report with key findings, criteria scores (1-5), and top 3 recommendations.
5. **Stage 2 — Synthesis:** A dedicated synthesizer model receives all specialist reports. It identifies convergent findings (2+ specialists agree), divergent findings (specialists conflict), produces a consolidated risk matrix, unified recommendations, and an executive summary.
6. A title is generated for new conversations.
7. All results are saved to the database.

### Non-Functional

- Stage 1 completes in the time of the slowest specialist (parallel).
- Stage 2 is a single model call.
- Total pipeline target: under 150 seconds.

### Model Constraints

- Minimum 2 specialist models + 1 synthesizer.
- Maximum 6 specialist models + 1 synthesizer.
- The synthesizer model may overlap with a specialist model.
- Each specialist must have a unique role assignment (no duplicate roles).

### What Makes It Distinct

- Unlike Council where all models answer the SAME question with the SAME prompt, each model answers from a DIFFERENT expert perspective via role-specific system prompts.
- No ranking stage: perspectives are complementary, not competitive.
- Synthesis integrates multiple valid viewpoints rather than selecting or blending similar answers.
- Structured scoring rubric per role enables quantitative cross-domain comparison.

---

## B. Pipeline Design

### Stages

| Stage | Name | Parallel? | Input | Output |
|-------|------|-----------|-------|--------|
| 1 | Specialist Analysis | Yes | User input + role-specific system prompt | `SpecialistReport[]` |
| 2 | Synthesis | No | All specialist reports + user input | `SynthesisResult` |

### Data Flow

```
User Input + Role Assignments
    |
Stage 1: For each (model, role) pair:
    buildSpecialistPrompt(role, userInput) -> queryModelWithMessages(model, messages)
    All specialists run in parallel via Promise.allSettled()
    | SpecialistReport[]
Stage 2: buildSynthesisPrompt(userInput, specialistReports) -> queryModel(synthesizerModel)
    | SynthesisResult
generateTitle() -> save to DB -> stream to client
```

### Role Library

```typescript
interface SpecialistRole {
  id: string;
  title: string;
  expertiseAreas: string;
  description: string;
  priorities: string[];
  criteria: string[];
}

const SPECIALIST_ROLE_LIBRARY: Record<string, SpecialistRole> = {
  security_expert: {
    id: "security_expert",
    title: "Security Expert",
    expertiseAreas: "application security, threat modeling, vulnerability assessment, cryptography, access control",
    description: "You evaluate everything through the lens of security posture, attack surface, and risk mitigation. You prioritize identifying vulnerabilities, ensuring defense-in-depth, and recommending hardening measures.",
    priorities: [
      "Identify security vulnerabilities and attack vectors",
      "Assess authentication and authorization mechanisms",
      "Evaluate data protection and encryption practices",
      "Review compliance with security standards (OWASP, CIS)",
    ],
    criteria: [
      "Authentication & Authorization",
      "Data Protection",
      "Input Validation",
      "Attack Surface",
      "Incident Response Readiness",
    ],
  },
  cost_analyst: {
    id: "cost_analyst",
    title: "Cost Analyst",
    expertiseAreas: "financial analysis, TCO modeling, cloud cost optimization, resource budgeting",
    description: "You evaluate everything through the lens of cost efficiency, ROI, and financial sustainability. You prioritize identifying cost drivers, hidden expenses, and optimization opportunities.",
    priorities: [
      "Calculate total cost of ownership (TCO)",
      "Identify cost optimization opportunities",
      "Assess pricing model risks and lock-in",
      "Evaluate build vs. buy trade-offs",
    ],
    criteria: [
      "Infrastructure Costs",
      "Operational Costs",
      "Scaling Cost Curve",
      "Vendor Lock-in Risk",
      "ROI Timeline",
    ],
  },
  scalability_architect: {
    id: "scalability_architect",
    title: "Scalability Architect",
    expertiseAreas: "distributed systems, horizontal scaling, load balancing, caching strategies, database sharding",
    description: "You evaluate everything through the lens of scalability, performance under load, and architectural resilience. You prioritize identifying bottlenecks, single points of failure, and growth constraints.",
    priorities: [
      "Identify scalability bottlenecks and limits",
      "Assess horizontal vs. vertical scaling strategy",
      "Evaluate data layer scalability",
      "Review fault tolerance and resilience patterns",
    ],
    criteria: [
      "Horizontal Scalability",
      "Data Layer Scalability",
      "Fault Tolerance",
      "Latency Under Load",
      "Resource Efficiency",
    ],
  },
  ux_designer: {
    id: "ux_designer",
    title: "UX Designer",
    expertiseAreas: "user experience design, usability testing, accessibility, information architecture, interaction design",
    description: "You evaluate everything through the lens of user experience, usability, and accessibility. You prioritize user needs, cognitive load reduction, and inclusive design.",
    priorities: [
      "Assess user workflow and task completion efficiency",
      "Evaluate accessibility compliance (WCAG AA)",
      "Review information architecture and navigation",
      "Identify cognitive load and friction points",
    ],
    criteria: [
      "Usability",
      "Accessibility",
      "Information Architecture",
      "Visual Clarity",
      "Error Recovery",
    ],
  },
  devops_engineer: {
    id: "devops_engineer",
    title: "DevOps Engineer",
    expertiseAreas: "CI/CD pipelines, infrastructure as code, monitoring, observability, deployment strategies",
    description: "You evaluate everything through the lens of operational excellence, deployment reliability, and observability. You prioritize automation, reproducibility, and incident response.",
    priorities: [
      "Assess deployment pipeline maturity",
      "Evaluate monitoring and observability coverage",
      "Review infrastructure automation and IaC",
      "Identify operational risk and toil",
    ],
    criteria: [
      "Deployment Automation",
      "Monitoring Coverage",
      "Incident Response",
      "Infrastructure as Code",
      "Environment Parity",
    ],
  },
  compliance_officer: {
    id: "compliance_officer",
    title: "Compliance Officer",
    expertiseAreas: "regulatory compliance, GDPR, HIPAA, SOC 2, data governance, audit readiness",
    description: "You evaluate everything through the lens of regulatory compliance, data governance, and audit readiness. You prioritize identifying compliance gaps, data handling risks, and documentation completeness.",
    priorities: [
      "Identify regulatory compliance gaps",
      "Assess data handling and privacy practices",
      "Evaluate audit trail completeness",
      "Review consent and data retention mechanisms",
    ],
    criteria: [
      "Regulatory Coverage",
      "Data Privacy",
      "Audit Trail",
      "Consent Management",
      "Documentation Completeness",
    ],
  },
  performance_engineer: {
    id: "performance_engineer",
    title: "Performance Engineer",
    expertiseAreas: "performance optimization, profiling, benchmarking, caching, database tuning, CDN strategy",
    description: "You evaluate everything through the lens of runtime performance, latency, throughput, and resource utilization. You prioritize identifying performance bottlenecks and optimization opportunities.",
    priorities: [
      "Profile critical path latency",
      "Identify memory and CPU bottlenecks",
      "Assess caching strategy effectiveness",
      "Evaluate database query performance",
    ],
    criteria: [
      "Response Latency",
      "Throughput",
      "Memory Efficiency",
      "Cache Hit Ratio",
      "Database Performance",
    ],
  },
  data_architect: {
    id: "data_architect",
    title: "Data Architect",
    expertiseAreas: "data modeling, schema design, ETL pipelines, data warehousing, data quality, migration strategies",
    description: "You evaluate everything through the lens of data architecture, schema design, and data lifecycle management. You prioritize data integrity, query efficiency, and schema evolution.",
    priorities: [
      "Evaluate data model correctness and normalization",
      "Assess schema evolution and migration strategy",
      "Review data quality and validation mechanisms",
      "Identify data lifecycle and retention concerns",
    ],
    criteria: [
      "Schema Design",
      "Data Integrity",
      "Query Efficiency",
      "Migration Strategy",
      "Data Quality",
    ],
  },
};
```

### Custom Role Validation

```typescript
interface CustomRoleInput {
  title: string;           // min 3 chars
  expertiseAreas: string;  // min 10 chars
  description: string;     // min 20 chars
  priorities: string[];    // min 3 items
  criteria: string[];      // min 3 items
}
```

Custom roles must provide at least 3 priorities and 3 criteria. If fewer are provided, the request is rejected with a 400 error explaining the minimum requirements.

### Prompt Templates

**Specialist Analysis Prompt** (`buildSpecialistPrompt`):

The specialist prompt is delivered as a system message + user message pair.

System message:
```
You are a {{ROLE_TITLE}} with deep expertise in {{EXPERTISE_AREAS}}.

YOUR LENS: {{ROLE_DESCRIPTION}}

YOUR PRIORITIES (in order):
1. {{PRIORITY_1}}
2. {{PRIORITY_2}}
3. {{PRIORITY_3}}
4. {{PRIORITY_4}}

YOUR EVALUATION CRITERIA:
- {{CRITERION_1}}
- {{CRITERION_2}}
- {{CRITERION_3}}
- {{CRITERION_4}}
- {{CRITERION_5}}
```

User message:
```
Analyze the following content from your specialist perspective. Provide a structured assessment.

CONTENT TO ANALYZE:
{{USER_INPUT}}

Provide your analysis in this exact format:

## {{ROLE_TITLE}} Assessment

### Key Findings
[Numbered list of 3-8 findings from your perspective]

### Risk Assessment
| Criterion | Rating (1-5) | Notes |
|-----------|:---:|-------|
| {{CRITERION_1}} | [score] | [brief justification] |
| {{CRITERION_2}} | [score] | [brief justification] |
| {{CRITERION_3}} | [score] | [brief justification] |
| {{CRITERION_4}} | [score] | [brief justification] |
| {{CRITERION_5}} | [score] | [brief justification] |

### Top 3 Recommendations
1. [Most impactful recommendation from your perspective]
2. [Second priority recommendation]
3. [Third priority recommendation]

### Detailed Analysis
[Full analysis from the {{ROLE_TITLE}} perspective, 200-500 words]
```

**Synthesis Prompt** (`buildPanelSynthesisPrompt`):

```
You are synthesizing a multi-dimensional specialist panel analysis. {{SPECIALIST_COUNT}} specialists each analyzed the same content from their unique professional perspective.

ORIGINAL INPUT:
{{USER_INPUT}}

SPECIALIST REPORTS:
{{#each SPECIALIST_REPORTS}}
--- {{ROLE_TITLE}} ({{MODEL}}) ---
{{REPORT}}

{{/each}}

Produce a unified integrated assessment in this exact format:

## Integrated Assessment

### Convergent Findings
[Findings identified by 2 or more specialists. For each, note which specialists agree and their shared conclusion.]

### Divergent Findings
| Finding | Perspective A | Perspective B | Suggested Resolution |
|---------|--------------|---------------|---------------------|
[For each area where specialists reached conflicting conclusions, document both perspectives and suggest a resolution.]

### Consolidated Risk Matrix
| Domain | Risk Level (Critical/High/Medium/Low) | Key Concern | Recommended Action | Source Specialist(s) |
|--------|:---:|-------------|-------------------|---------------------|
[Consolidate risk items from all specialists into a unified matrix, ordered by risk level.]

### Unified Recommendations (Priority Order)
1. [Highest priority — cross-domain impact, supported by multiple specialists]
2. [Second priority]
3. [Third priority]
4. [Fourth priority]
5. [Fifth priority]
[Continue as needed, maximum 10 recommendations]

### Executive Summary
[2-3 paragraph synthesis covering: (1) Overall assessment across all dimensions, (2) Key strengths identified, (3) Critical areas requiring attention, (4) Recommended next steps.]
```

**Title Prompt**: Reuses shared `buildTitlePrompt(userInput)`.

### Specialist Report Parser

```typescript
interface ParsedSpecialistReport {
  roleTitle: string;
  criteriaScores: Array<{ criterion: string; score: number; notes: string }>;
  topRecommendations: string[];
  keyFindings: string[];
}

function parseSpecialistReport(text: string, role: SpecialistRole): ParsedSpecialistReport {
  const criteriaScores: Array<{ criterion: string; score: number; notes: string }> = [];

  // Parse criteria scores from the markdown table
  for (const criterion of role.criteria) {
    const escapedCriterion = criterion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `\\|\\s*${escapedCriterion}\\s*\\|\\s*(\\d)\\s*\\|\\s*([^|]+)\\|`,
      "i"
    );
    const match = text.match(regex);
    if (match) {
      criteriaScores.push({
        criterion,
        score: parseInt(match[1], 10),
        notes: match[2].trim(),
      });
    }
  }

  // Parse top 3 recommendations
  const recsMatch = text.match(/### Top 3 Recommendations\s*\n([\s\S]*?)(?=###|$)/i);
  const topRecommendations: string[] = [];
  if (recsMatch) {
    const lines = recsMatch[1].trim().split("\n");
    for (const line of lines) {
      const cleaned = line.replace(/^\d+\.\s*/, "").trim();
      if (cleaned) topRecommendations.push(cleaned);
    }
  }

  // Parse key findings
  const findingsMatch = text.match(/### Key Findings\s*\n([\s\S]*?)(?=###|$)/i);
  const keyFindings: string[] = [];
  if (findingsMatch) {
    const lines = findingsMatch[1].trim().split("\n");
    for (const line of lines) {
      const cleaned = line.replace(/^\d+\.\s*/, "").replace(/^-\s*/, "").trim();
      if (cleaned) keyFindings.push(cleaned);
    }
  }

  return {
    roleTitle: role.title,
    criteriaScores,
    topRecommendations: topRecommendations.slice(0, 3),
    keyFindings,
  };
}
```

---

## C. SSE Event Sequence

```
1. panel_start             -> { conversationId, messageId, mode: "specialist_panel", roles: string[] }
2. specialist_start        -> { totalSpecialists: number }
3. specialist_complete     -> { data: SpecialistCompletePayload }   // emitted per specialist as each finishes
   ... (repeated for each specialist)
4. all_specialists_complete -> { data: AllSpecialistsPayload }
5. synthesis_start         -> {}
6. synthesis_complete      -> { data: SynthesisCompletePayload }
7. title_complete          -> { data: { title: string } }           // new conversations only
8. complete                -> {}
```

On error at any point:
```
error -> { message: string }
```

### TypeScript Payload Interfaces

```typescript
// panel_start
interface PanelStartPayload {
  conversationId: string;
  messageId: string;
  mode: "specialist_panel";
  roles: string[];
}

// specialist_complete (emitted per specialist as each finishes)
interface SpecialistCompletePayload {
  data: {
    roleId: string;
    roleTitle: string;
    model: string;
    report: string;
    criteriaScores: Array<{ criterion: string; score: number; notes: string }>;
    topRecommendations: string[];
    keyFindings: string[];
    responseTimeMs: number;
    index: number;            // 0-based index of this specialist in the panel
    totalSpecialists: number; // total number of specialists
  };
}

// all_specialists_complete
interface AllSpecialistsPayload {
  data: {
    specialists: Array<{
      roleId: string;
      roleTitle: string;
      model: string;
      report: string;
      criteriaScores: Array<{ criterion: string; score: number; notes: string }>;
      topRecommendations: string[];
      responseTimeMs: number;
    }>;
    failedSpecialists: Array<{
      roleId: string;
      roleTitle: string;
      model: string;
      error: string;
    }>;
    totalSucceeded: number;
    totalFailed: number;
  };
}

// synthesis_complete
interface SynthesisCompletePayload {
  data: {
    model: string;
    integratedAssessment: string;
    responseTimeMs: number;
  };
}

// title_complete (shared)
interface TitleCompletePayload {
  data: { title: string };
}
```

---

## D. Input Format

### Request Body

```typescript
interface SpecialistPanelStreamRequest {
  question: string;
  mode: "specialist_panel";
  conversationId?: string;
  modeConfig: {
    specialists: Array<{
      roleId: string;             // predefined role ID or "custom"
      model: string;              // OpenRouter model identifier
      customRole?: CustomRoleInput; // required when roleId is "custom"
    }>;
    synthesizerModel: string;     // model for synthesis stage
    timeoutMs?: number;
  };
}
```

### Zod Validation

```typescript
const customRoleSchema = z.object({
  title: z.string().min(3, "Role title must be at least 3 characters"),
  expertiseAreas: z.string().min(10, "Expertise areas must be at least 10 characters"),
  description: z.string().min(20, "Role description must be at least 20 characters"),
  priorities: z.array(z.string().min(5)).min(3, "Custom roles require at least 3 priorities"),
  criteria: z.array(z.string().min(3)).min(3, "Custom roles require at least 3 criteria"),
});

const specialistAssignmentSchema = z.object({
  roleId: z.string().min(1),
  model: z.string().min(1),
  customRole: customRoleSchema.optional(),
}).refine(
  (data) => data.roleId !== "custom" || data.customRole !== undefined,
  { message: "customRole is required when roleId is 'custom'" }
);

const specialistPanelRequestSchema = z.object({
  question: z.string().min(1, "Content to analyze is required").max(100_000, "Content must be under 100,000 characters"),
  mode: z.literal("specialist_panel"),
  conversationId: z.string().optional(),
  modeConfig: z.object({
    specialists: z.array(specialistAssignmentSchema)
      .min(2, "Specialist Panel requires at least 2 specialists")
      .max(6, "Maximum 6 specialists allowed"),
    synthesizerModel: z.string().min(1, "Synthesizer model is required"),
    timeoutMs: z.number().min(30_000).max(600_000).optional(),
  }),
});
```

### Default Configuration

```typescript
const DEFAULT_SPECIALIST_PANEL_CONFIG = {
  specialists: [
    { roleId: "security_expert", model: "anthropic/claude-opus-4-6" },
    { roleId: "scalability_architect", model: "openai/o3" },
    { roleId: "cost_analyst", model: "google/gemini-2.5-pro" },
  ],
  synthesizerModel: "anthropic/claude-opus-4-6",
  timeoutMs: 150_000,
};
```

### Example Requests

New conversation with predefined roles:
```json
{
  "question": "We are migrating our monolith e-commerce platform to microservices on AWS EKS. The system handles 50k RPM peak, stores PII for 2M users, and has a $15k/month infrastructure budget. Here is our proposed architecture: [architecture description]...",
  "mode": "specialist_panel",
  "modeConfig": {
    "specialists": [
      { "roleId": "security_expert", "model": "anthropic/claude-opus-4-6" },
      { "roleId": "scalability_architect", "model": "openai/o3" },
      { "roleId": "cost_analyst", "model": "google/gemini-2.5-pro" },
      { "roleId": "devops_engineer", "model": "perplexity/sonar-pro" }
    ],
    "synthesizerModel": "anthropic/claude-opus-4-6"
  }
}
```

With a custom role:
```json
{
  "question": "Review our mobile app architecture...",
  "mode": "specialist_panel",
  "modeConfig": {
    "specialists": [
      { "roleId": "ux_designer", "model": "anthropic/claude-opus-4-6" },
      { "roleId": "performance_engineer", "model": "openai/o3" },
      {
        "roleId": "custom",
        "model": "google/gemini-2.5-pro",
        "customRole": {
          "title": "Mobile Platform Specialist",
          "expertiseAreas": "iOS/Android native development, React Native, cross-platform frameworks, app store requirements",
          "description": "You evaluate everything through the lens of mobile platform constraints, app store compliance, and cross-platform compatibility.",
          "priorities": [
            "Assess cross-platform compatibility",
            "Evaluate app store compliance requirements",
            "Review offline capability and sync strategy"
          ],
          "criteria": [
            "Platform Compatibility",
            "App Store Compliance",
            "Offline Support",
            "Battery Efficiency",
            "Bundle Size"
          ]
        }
      }
    ],
    "synthesizerModel": "anthropic/claude-opus-4-6"
  }
}
```

---

## E. Output Format

### Result Interface

```typescript
interface SpecialistPanelResult {
  specialists: SpecialistReport[];
  failedSpecialists: FailedSpecialist[];
  synthesis: SynthesisResult;
  title?: string;
}

interface SpecialistReport {
  roleId: string;
  roleTitle: string;
  model: string;
  report: string;                     // full report text
  criteriaScores: Array<{
    criterion: string;
    score: number;                    // 1-5
    notes: string;
  }>;
  topRecommendations: string[];       // up to 3
  keyFindings: string[];              // extracted findings
  responseTimeMs: number;
}

interface FailedSpecialist {
  roleId: string;
  roleTitle: string;
  model: string;
  error: string;
}

interface SynthesisResult {
  model: string;
  integratedAssessment: string;       // full synthesis text
  convergentFindings: string;         // extracted section (or full text if parsing fails)
  divergentFindings: string;          // extracted section
  recommendations: string;           // extracted section
  responseTimeMs: number;
}
```

### UI Display

- **Specialist Reports:** One expandable card per specialist, color-coded by role. Each card shows the role title, model name, response time, criteria scores as a horizontal bar chart (1-5 scale), top 3 recommendations as a bullet list, and expandable full report text.
- **Score Comparison:** A radar chart overlaying all specialists' average criteria scores for quick visual comparison across domains.
- **Synthesis:** The integrated assessment is the primary displayed response in the chat. Convergent findings, divergent findings, risk matrix, and recommendations are displayed as collapsible sections.

### DB Storage

Uses the `deliberation_stages` table:

| `stageType` | `stageOrder` | `model` | `role` | `content` | `parsedData` |
|-------------|:------------:|---------|--------|-----------|--------------|
| `"specialist_security_expert"` | 1 | model ID | `"security_expert"` | Full specialist report text | `SpecialistParsedData` |
| `"specialist_cost_analyst"` | 1 | model ID | `"cost_analyst"` | Full specialist report text | `SpecialistParsedData` |
| `"specialist_scalability_architect"` | 1 | model ID | `"scalability_architect"` | Full specialist report text | `SpecialistParsedData` |
| `"specialist_devops_engineer"` | 1 | model ID | `"devops_engineer"` | Full specialist report text | `SpecialistParsedData` |
| `"synthesis"` | 2 | synthesizer model ID | `"synthesizer"` | Full synthesis text | `SynthesisParsedData` |

Note: All specialists share `stageOrder: 1` since they run in parallel. Synthesis is `stageOrder: 2`.

### parsedData JSONB Examples

**Specialist stage (`stageType: "specialist_security_expert"`):**
```json
{
  "roleId": "security_expert",
  "roleTitle": "Security Expert",
  "criteriaScores": [
    { "criterion": "Authentication & Authorization", "score": 3, "notes": "JWT implementation lacks refresh token rotation" },
    { "criterion": "Data Protection", "score": 4, "notes": "Encryption at rest and in transit properly configured" },
    { "criterion": "Input Validation", "score": 2, "notes": "Missing server-side validation on 3 endpoints" },
    { "criterion": "Attack Surface", "score": 3, "notes": "API gateway helps but internal services lack mTLS" },
    { "criterion": "Incident Response Readiness", "score": 2, "notes": "No runbooks or alerting for security events" }
  ],
  "topRecommendations": [
    "Implement refresh token rotation with short-lived access tokens",
    "Add server-side input validation middleware to all API endpoints",
    "Create incident response runbooks and configure security alerting"
  ],
  "keyFindings": [
    "JWT tokens use long expiry without rotation",
    "Three API endpoints accept unvalidated user input",
    "No mTLS between internal microservices",
    "Security event logging is incomplete"
  ],
  "averageScore": 2.8,
  "responseTimeMs": 4520
}
```

**Specialist stage with custom role (`stageType: "specialist_custom_mobile_platform_specialist"`):**
```json
{
  "roleId": "custom",
  "roleTitle": "Mobile Platform Specialist",
  "criteriaScores": [
    { "criterion": "Platform Compatibility", "score": 4, "notes": "React Native covers iOS and Android well" },
    { "criterion": "App Store Compliance", "score": 3, "notes": "Missing privacy manifest for iOS 17+" },
    { "criterion": "Offline Support", "score": 2, "notes": "No offline-first architecture" }
  ],
  "topRecommendations": [
    "Add iOS privacy manifest before next App Store submission",
    "Implement offline queue with sync-on-reconnect",
    "Reduce bundle size below 50MB for emerging markets"
  ],
  "keyFindings": [
    "Privacy manifest missing for iOS 17+",
    "No offline capability implemented",
    "Bundle size exceeds 80MB"
  ],
  "averageScore": 3.0,
  "responseTimeMs": 3890
}
```

**Synthesis stage (`stageType: "synthesis"`):**
```json
{
  "specialistCount": 4,
  "convergentFindingCount": 3,
  "divergentFindingCount": 1,
  "recommendationCount": 7,
  "topRisk": "Security gaps in inter-service communication",
  "overallAssessment": "moderate_risk",
  "responseTimeMs": 6200
}
```

---

## F. Edge Cases

| Scenario | Handling |
|----------|----------|
| All specialists fail | Emit `error` event. Pipeline aborts. No synthesis attempted. |
| Some specialists fail (but 2+ succeed) | Continue with successful reports. Note failures in `failedSpecialists`. Synthesis proceeds with available reports. Synthesizer is informed which perspectives are missing. |
| Only 1 specialist succeeds | Emit `error` event: "Minimum 2 specialist reports required for synthesis." The single report is still saved. |
| Specialist goes off-role (ignores assigned perspective) | Report is included as-is. Synthesizer may note the off-role response. No automated detection. |
| Specialist does not follow output format | Parser extracts what it can. Missing criteria scores default to empty array. Missing recommendations default to empty array. Raw text is always saved in `content`. |
| All specialists produce identical findings | Synthesis marks all as "convergent." No divergent section produced. |
| Duplicate role IDs in request | Zod validation warns but allows (roles are assigned to different models). The `stageType` is disambiguated by appending the model name if roles collide. |
| Custom role with fewer than 3 priorities/criteria | Rejected at validation with 400 error before pipeline starts. |
| Custom role title too vague (e.g., "Expert") | Accepted but may produce low-quality results. No automated quality check on role definitions. |
| Synthesizer model fails | Emit `error` event. All specialist reports are still saved to the database. |
| Content exceeds 100,000 characters | Rejected at validation with 400 error. |
| Timeout (specialist) | Per-model timeout via `AbortSignal.timeout()`. Failed specialist excluded from results. |
| Timeout (synthesizer) | Emit `error` event. Specialist reports are still saved. |
| Conversation mode mismatch | If `conversationId` references a conversation with `mode != "specialist_panel"`, return 400 error. |

---

## G. Database Schema

Uses the shared `deliberation_stages` table (see `00-shared-infrastructure.md`):

```typescript
// deliberation_stages rows for a single Specialist Panel pipeline execution
[
  // Stage 1: Specialist reports (one row per specialist, all stageOrder 1)
  {
    id: "uuid-1",
    messageId: "msg-456",
    stageType: "specialist_security_expert",
    stageOrder: 1,
    model: "anthropic/claude-opus-4-6",
    role: "security_expert",
    content: "## Security Expert Assessment\n\n### Key Findings\n1. JWT tokens use long expiry...",
    parsedData: {
      roleId: "security_expert",
      roleTitle: "Security Expert",
      criteriaScores: [
        { criterion: "Authentication & Authorization", score: 3, notes: "JWT implementation lacks refresh token rotation" },
        { criterion: "Data Protection", score: 4, notes: "Encryption at rest and in transit properly configured" },
        { criterion: "Input Validation", score: 2, notes: "Missing server-side validation on 3 endpoints" },
        { criterion: "Attack Surface", score: 3, notes: "API gateway helps but internal services lack mTLS" },
        { criterion: "Incident Response Readiness", score: 2, notes: "No runbooks or alerting for security events" },
      ],
      topRecommendations: [
        "Implement refresh token rotation with short-lived access tokens",
        "Add server-side input validation middleware to all API endpoints",
        "Create incident response runbooks and configure security alerting",
      ],
      keyFindings: [
        "JWT tokens use long expiry without rotation",
        "Three API endpoints accept unvalidated user input",
        "No mTLS between internal microservices",
        "Security event logging is incomplete",
      ],
      averageScore: 2.8,
      responseTimeMs: 4520,
    },
    responseTimeMs: 4520,
  },
  {
    id: "uuid-2",
    messageId: "msg-456",
    stageType: "specialist_scalability_architect",
    stageOrder: 1,
    model: "openai/o3",
    role: "scalability_architect",
    content: "## Scalability Architect Assessment\n\n### Key Findings\n1. Database is a single instance...",
    parsedData: {
      roleId: "scalability_architect",
      roleTitle: "Scalability Architect",
      criteriaScores: [
        { criterion: "Horizontal Scalability", score: 4, notes: "Kubernetes autoscaling configured" },
        { criterion: "Data Layer Scalability", score: 2, notes: "Single Postgres instance, no read replicas" },
        { criterion: "Fault Tolerance", score: 3, notes: "Service mesh provides retry logic" },
        { criterion: "Latency Under Load", score: 3, notes: "P99 latency ~800ms at peak" },
        { criterion: "Resource Efficiency", score: 3, notes: "Over-provisioned for average load" },
      ],
      topRecommendations: [
        "Add read replicas for database layer",
        "Implement connection pooling with PgBouncer",
        "Right-size pod resource limits based on actual usage",
      ],
      keyFindings: [
        "Database is a single point of failure",
        "No connection pooling in place",
        "Kubernetes autoscaling properly configured",
      ],
      averageScore: 3.0,
      responseTimeMs: 3890,
    },
    responseTimeMs: 3890,
  },
  {
    id: "uuid-3",
    messageId: "msg-456",
    stageType: "specialist_cost_analyst",
    stageOrder: 1,
    model: "google/gemini-2.5-pro",
    role: "cost_analyst",
    content: "## Cost Analyst Assessment\n\n### Key Findings\n1. Current infrastructure spend...",
    parsedData: {
      roleId: "cost_analyst",
      roleTitle: "Cost Analyst",
      criteriaScores: [
        { criterion: "Infrastructure Costs", score: 3, notes: "Within budget but no cost optimization" },
        { criterion: "Operational Costs", score: 2, notes: "Manual processes increase operational overhead" },
        { criterion: "Scaling Cost Curve", score: 3, notes: "Linear scaling cost, no economy of scale" },
        { criterion: "Vendor Lock-in Risk", score: 4, notes: "Kubernetes provides portability" },
        { criterion: "ROI Timeline", score: 3, notes: "Migration ROI expected within 18 months" },
      ],
      topRecommendations: [
        "Implement spot instances for non-critical workloads",
        "Automate scaling down during off-peak hours",
        "Consolidate logging and monitoring tools to reduce SaaS costs",
      ],
      keyFindings: [
        "25% of infrastructure budget goes to idle resources",
        "No spot instance usage",
        "Three overlapping monitoring tools",
      ],
      averageScore: 3.0,
      responseTimeMs: 3200,
    },
    responseTimeMs: 3200,
  },

  // Stage 2: Synthesis (single row)
  {
    id: "uuid-4",
    messageId: "msg-456",
    stageType: "synthesis",
    stageOrder: 2,
    model: "anthropic/claude-opus-4-6",
    role: "synthesizer",
    content: "## Integrated Assessment\n\n### Convergent Findings\nAll three specialists...",
    parsedData: {
      specialistCount: 3,
      convergentFindingCount: 3,
      divergentFindingCount: 1,
      recommendationCount: 7,
      topRisk: "Database single point of failure",
      overallAssessment: "moderate_risk",
      responseTimeMs: 6200,
    },
    responseTimeMs: 6200,
  },
]
```

### Indexes

Covered by the shared index on `deliberation_stages(message_id, stage_order)` defined in `00-shared-infrastructure.md`.

### Query Patterns

```typescript
// Load full specialist panel result for a message
async function loadSpecialistPanelResult(messageId: string): Promise<SpecialistPanelResult> {
  const stages = await db
    .select()
    .from(deliberationStages)
    .where(eq(deliberationStages.messageId, messageId))
    .orderBy(deliberationStages.stageOrder);

  const specialistStages = stages.filter(s => s.stageType.startsWith("specialist_"));
  const synthesisStage = stages.find(s => s.stageType === "synthesis");

  return {
    specialists: specialistStages.map(s => {
      const parsed = s.parsedData as SpecialistParsedData;
      return {
        roleId: parsed.roleId,
        roleTitle: parsed.roleTitle,
        model: s.model!,
        report: s.content,
        criteriaScores: parsed.criteriaScores,
        topRecommendations: parsed.topRecommendations,
        keyFindings: parsed.keyFindings,
        responseTimeMs: s.responseTimeMs!,
      };
    }),
    failedSpecialists: [], // failures are not persisted as rows
    synthesis: {
      model: synthesisStage!.model!,
      integratedAssessment: synthesisStage!.content,
      convergentFindings: "", // extracted from content at display time
      divergentFindings: "",
      recommendations: "",
      responseTimeMs: synthesisStage!.responseTimeMs!,
    },
  };
}
```

### Conversation-Level Storage

```typescript
// conversations table
{ id, userId, title, mode: "specialist_panel", createdAt, updatedAt }

// messages table
{ id, conversationId, role: "user", content: userInput }
{ id, conversationId, role: "assistant", content: synthesisText }
```

The assistant message `content` is the synthesizer's full integrated assessment.
