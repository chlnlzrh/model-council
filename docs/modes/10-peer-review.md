# 10 — Peer Review Mode

> Independent expert reviews with standardized scoring rubrics, consolidated into a unified report.

**Family:** Role-Based
**Status:** Specified (Pre-Implementation)
**Min Models:** 2 reviewers + 1 consolidator
**Max Models:** 6 reviewers + 1 consolidator
**Multi-turn:** No

---

## A. Requirements

### Functional

1. User submits existing work for peer review and selects a review type.
2. A standardized scoring rubric is applied based on the review type. Each criterion has a name, description, and weight.
3. **Stage 1 — Review:** All reviewer models independently evaluate the submitted work using the same rubric (parallel). Each produces structured output: scores per criterion (1-5) with justification, a list of findings with severity (CRITICAL/MAJOR/MINOR/SUGGESTION), category, location reference, impact description, and recommendation, plus a strengths section and summary.
4. **Stage 2 — Consolidate:** A consolidator model receives all reviews. It calculates consensus scores (average and standard deviation per criterion), identifies consensus findings (flagged by 2+ reviewers), unique findings (flagged by only 1 reviewer), disputed assessments (where score standard deviation exceeds 1.5), computes inter-reviewer agreement metrics, and produces prioritized action items with effort estimates.
5. A title is generated for new conversations.
6. All results are saved to the database.

### Non-Functional

- Stage 1 completes in the time of the slowest reviewer (parallel).
- Stage 2 is a single model call (consolidator).
- Total pipeline target: under 150 seconds.

### Model Constraints

- Minimum 2 reviewer models + 1 consolidator.
- Maximum 6 reviewer models + 1 consolidator.
- The consolidator model may overlap with a reviewer model.
- All reviewers use the same rubric (no per-reviewer customization).

### What Makes It Distinct

- Evaluation of EXISTING work (not answering a question).
- Standardized scoring rubric enables quantitative comparison across reviewers.
- Structured findings with severity classification enable triage.
- Inter-reviewer agreement metrics provide confidence signals.
- Consolidation identifies both consensus issues and unique insights.
- Output is directly actionable: prioritized action items with effort estimates.

---

## B. Pipeline Design

### Stages

| Stage | Name | Parallel? | Input | Output |
|-------|------|-----------|-------|--------|
| 1 | Review | Yes | Work under review + rubric | `ReviewResult[]` |
| 2 | Consolidate | No | All reviews + work under review | `ConsolidationResult` |

### Data Flow

```
User's Work + Review Type
    |
Resolve rubric from review type
    |
Stage 1: For each reviewer model:
    buildReviewPrompt(work, reviewType, rubric) -> queryModel(reviewerModel)
    All reviewers run in parallel via Promise.allSettled()
    | ReviewResult[] -> parseReviewScores() + parseFindings()
Stage 2: buildConsolidationPrompt(work, reviews, rubric) -> queryModel(consolidatorModel)
    | ConsolidationResult
generateTitle() -> save to DB -> stream to client
```

### Review Types and Rubrics

```typescript
type ReviewType =
  | "architecture_review"
  | "code_review"
  | "design_spec_review"
  | "compliance_audit"
  | "business_plan_review"
  | "custom";

interface RubricCriterion {
  name: string;
  description: string;
  weight: number;           // relative importance (1-5)
}

interface ReviewRubric {
  id: ReviewType;
  name: string;
  description: string;
  criteria: RubricCriterion[];
}

const REVIEW_RUBRICS: Record<ReviewType, ReviewRubric> = {
  architecture_review: {
    id: "architecture_review",
    name: "Architecture Review",
    description: "Evaluate software architecture for quality, scalability, and operational readiness.",
    criteria: [
      { name: "Scalability", description: "Ability to handle growth in users, data, and traffic without fundamental redesign.", weight: 5 },
      { name: "Security", description: "Protection against threats, secure data handling, authentication, and authorization.", weight: 5 },
      { name: "Maintainability", description: "Code organization, modularity, documentation, and ease of change.", weight: 4 },
      { name: "Cost Efficiency", description: "Resource utilization, infrastructure costs, and optimization opportunities.", weight: 3 },
      { name: "Reliability", description: "Fault tolerance, disaster recovery, data integrity, and uptime guarantees.", weight: 4 },
      { name: "Performance", description: "Latency, throughput, resource usage, and optimization under load.", weight: 3 },
    ],
  },
  code_review: {
    id: "code_review",
    name: "Code Review",
    description: "Evaluate code quality, correctness, and engineering best practices.",
    criteria: [
      { name: "Correctness", description: "Code produces expected results, handles edge cases, and is logically sound.", weight: 5 },
      { name: "Readability", description: "Code is clear, well-named, properly structured, and easy to understand.", weight: 4 },
      { name: "Security", description: "No vulnerabilities, proper input validation, secure data handling.", weight: 5 },
      { name: "Performance", description: "Efficient algorithms, no unnecessary allocations, optimized hot paths.", weight: 3 },
      { name: "Test Coverage", description: "Adequate tests for public interfaces, edge cases, and error conditions.", weight: 4 },
      { name: "Error Handling", description: "Graceful error handling, informative messages, no silent failures.", weight: 4 },
    ],
  },
  design_spec_review: {
    id: "design_spec_review",
    name: "Design Specification Review",
    description: "Evaluate technical design documents for completeness and feasibility.",
    criteria: [
      { name: "Completeness", description: "All required aspects of the design are covered with sufficient detail.", weight: 5 },
      { name: "Feasibility", description: "The design can be implemented with available resources and technology.", weight: 4 },
      { name: "User Impact", description: "Design decisions properly consider end-user experience and needs.", weight: 4 },
      { name: "Technical Accuracy", description: "Technical claims and assumptions are correct and well-supported.", weight: 5 },
      { name: "Risk Assessment", description: "Risks are identified, assessed, and mitigated in the design.", weight: 3 },
    ],
  },
  compliance_audit: {
    id: "compliance_audit",
    name: "Compliance Audit",
    description: "Evaluate regulatory compliance, governance, and audit readiness.",
    criteria: [
      { name: "Regulatory Coverage", description: "All applicable regulations are identified and addressed.", weight: 5 },
      { name: "Gap Identification", description: "Compliance gaps are clearly identified with specific references.", weight: 5 },
      { name: "Evidence Quality", description: "Supporting evidence and documentation are adequate for audit.", weight: 4 },
      { name: "Control Effectiveness", description: "Implemented controls actually mitigate the identified risks.", weight: 4 },
    ],
  },
  business_plan_review: {
    id: "business_plan_review",
    name: "Business Plan Review",
    description: "Evaluate business plans for viability, market fit, and execution readiness.",
    criteria: [
      { name: "Market Analysis", description: "Market sizing, segmentation, and competitive landscape are well-researched.", weight: 4 },
      { name: "Financial Viability", description: "Financial projections are realistic, assumptions are stated, and unit economics work.", weight: 5 },
      { name: "Competitive Advantage", description: "Clear differentiation and defensible competitive moat.", weight: 4 },
      { name: "Risk Assessment", description: "Key risks are identified with mitigation strategies.", weight: 4 },
      { name: "Execution Plan", description: "Clear timeline, milestones, resource allocation, and accountability.", weight: 3 },
    ],
  },
  custom: {
    id: "custom",
    name: "Custom Review",
    description: "User-defined review rubric.",
    criteria: [], // provided by user in modeConfig
  },
};
```

### Severity Levels

```typescript
type FindingSeverity = "CRITICAL" | "MAJOR" | "MINOR" | "SUGGESTION";

const SEVERITY_DESCRIPTIONS: Record<FindingSeverity, string> = {
  CRITICAL: "Must be fixed before proceeding. Blocks deployment or poses significant risk.",
  MAJOR: "Should be fixed in this iteration. Significant quality or risk concern.",
  MINOR: "Should be fixed when convenient. Low-impact quality issue.",
  SUGGESTION: "Optional improvement. Nice-to-have enhancement.",
};
```

### Prompt Templates

**Review Prompt** (`buildReviewPrompt`):

```
You are a peer reviewer evaluating the following {{WORK_TYPE}} against a standardized rubric. Provide a thorough, independent evaluation. Be specific and cite exact locations in the work.

WORK UNDER REVIEW:
{{USER_INPUT}}

REVIEW TYPE: {{REVIEW_TYPE_NAME}}

SCORING RUBRIC (1-5 scale):
1 = Critical deficiencies — fundamental issues that must be addressed immediately
2 = Significant gaps — important issues that undermine quality
3 = Adequate — meets minimum expectations but has room for improvement
4 = Good — above average quality with minor issues
5 = Excellent — exceptional quality with negligible issues

CRITERIA TO EVALUATE:
{{#each CRITERIA}}
{{@index + 1}}. {{this.name}} (weight: {{this.weight}}/5): {{this.description}}
{{/each}}

Provide your review in this exact format:

## Peer Review

### Scores
| Criterion | Score (1-5) | Weight | Justification |
|-----------|:---:|:---:|---------------|
{{#each CRITERIA}}
| {{this.name}} | [score] | {{this.weight}} | [2-3 sentence justification] |
{{/each}}
| **Weighted Overall** | [weighted average to 1 decimal] | | [1 sentence overall assessment] |

### Findings

{{for each finding, use this exact format:}}

**FINDING [n]:** [Concise title]
- **Category:** [which rubric criterion this relates to]
- **Severity:** [CRITICAL|MAJOR|MINOR|SUGGESTION]
- **Location:** [specific reference to where in the work this applies — line number, section name, component name, etc.]
- **Description:** [what the issue is]
- **Impact:** [why this matters — what happens if not addressed]
- **Recommendation:** [specific, actionable fix]

[Include at least 3 findings. Number them sequentially.]

### Strengths
[List 3-5 specific strengths of the work, with references to specific parts.]

### Summary
[2-3 paragraph overall assessment covering: (1) general quality level, (2) most critical issues, (3) recommendation for next steps.]
```

**Consolidation Prompt** (`buildConsolidationPrompt`):

```
You are consolidating {{REVIEWER_COUNT}} independent peer reviews of a {{WORK_TYPE}} into a unified, actionable report. Your job is to aggregate scores, identify consensus vs. disputed findings, and produce prioritized action items.

ORIGINAL WORK:
{{USER_INPUT}}

REVIEW TYPE: {{REVIEW_TYPE_NAME}}

SCORING RUBRIC:
{{#each CRITERIA}}
- {{this.name}} (weight: {{this.weight}}/5): {{this.description}}
{{/each}}

INDIVIDUAL REVIEWS:
{{#each REVIEWS}}
--- Reviewer {{@index + 1}} ({{MODEL}}) ---
{{REVIEW_TEXT}}

{{/each}}

Produce a consolidated report in this exact format:

# Consolidated Peer Review Report

## Consensus Scores
| Criterion | Weight | {{#each REVIEWS}}R{{@index + 1}} | {{/each}}Avg | StdDev | Agreement |
|-----------|:---:|{{#each REVIEWS}}:---:|{{/each}}:---:|:---:|-----------|
{{#each CRITERIA}}
| {{this.name}} | {{this.weight}} | [scores from each reviewer] | [average to 1 decimal] | [standard deviation to 2 decimals] | [High if stddev < 0.5, Medium if 0.5-1.5, Low if > 1.5] |
{{/each}}
| **Weighted Overall** | | [overall scores] | [weighted avg] | [weighted stddev] | [overall agreement] |

## Findings Summary

### By Severity
| Severity | Total Count | Consensus (2+ reviewers) | Unique (1 reviewer) |
|----------|:---:|:---:|:---:|
| CRITICAL | [count] | [count] | [count] |
| MAJOR | [count] | [count] | [count] |
| MINOR | [count] | [count] | [count] |
| SUGGESTION | [count] | [count] | [count] |

### Consensus Findings (Identified by 2+ Reviewers)
[For each consensus finding:]
**[n]. [Title]** ({{SEVERITY}}) — Identified by Reviewers {{list}}
- **Description:** [merged description]
- **Impact:** [consolidated impact]
- **Recommendation:** [best recommendation from reviewers]

### Unique Findings (Identified by 1 Reviewer Only)
[For each unique finding:]
**[n]. [Title]** ({{SEVERITY}}) — Reviewer {{number}} only
- **Description:** [description]
- **Recommendation:** [recommendation]
- **Credibility Note:** [assess whether this finding seems valid despite being unique]

### Disputed Assessments
[For criteria where standard deviation > 1.5 or findings where reviewers explicitly disagree:]
| Topic | Reviewer A Position | Reviewer B Position | Analysis |
|-------|-------------------|-------------------|----------|

## Inter-Reviewer Agreement
| Metric | Value | Interpretation |
|--------|-------|---------------|
| Average Score StdDev | [value] | [interpretation] |
| Findings Overlap Rate | [percentage of findings identified by 2+ reviewers] | [interpretation] |
| Severity Agreement | [percentage where reviewers agree on severity for shared findings] | [interpretation] |

## Prioritized Action Items
[Ordered by: CRITICAL findings first, then by number of reviewers who identified, then by criterion weight.]

1. **[CRITICAL]** [Specific action] — Evidence: [which reviewers, finding numbers]. Effort: [Low/Medium/High].
2. **[CRITICAL]** [action] — Evidence: [...]. Effort: [...].
3. **[MAJOR]** [action] — Evidence: [...]. Effort: [...].
[Continue for all actionable items, maximum 15.]

## Executive Summary
[3-4 paragraphs covering: (1) Overall quality assessment with consensus score, (2) Critical issues requiring immediate attention, (3) Areas of reviewer agreement and disagreement, (4) Recommended next steps and timeline.]
```

**Title Prompt**: Reuses shared `buildTitlePrompt(userInput)`.

### Review Parser

```typescript
interface ParsedReview {
  scores: Array<{
    criterion: string;
    score: number;
    weight: number;
    justification: string;
  }>;
  overallScore: number;
  findings: ParsedFinding[];
  strengths: string[];
  findingCounts: Record<FindingSeverity, number>;
}

interface ParsedFinding {
  number: number;
  title: string;
  category: string;
  severity: FindingSeverity;
  location: string;
  description: string;
  impact: string;
  recommendation: string;
}

function parseReview(text: string, rubric: ReviewRubric): ParsedReview {
  const scores: ParsedReview["scores"] = [];

  // Parse scores from markdown table
  for (const criterion of rubric.criteria) {
    const escapedName = criterion.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `\\|\\s*${escapedName}\\s*\\|\\s*(\\d)\\s*\\|\\s*\\d\\s*\\|\\s*([^|]+)\\|`,
      "i"
    );
    const match = text.match(regex);
    if (match) {
      scores.push({
        criterion: criterion.name,
        score: parseInt(match[1], 10),
        weight: criterion.weight,
        justification: match[2].trim(),
      });
    }
  }

  // Calculate weighted overall score
  let weightedSum = 0;
  let totalWeight = 0;
  for (const score of scores) {
    weightedSum += score.score * score.weight;
    totalWeight += score.weight;
  }
  const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Parse findings
  const findingRegex = /\*\*FINDING\s+(\d+):\*\*\s*(.+)\n-\s*\*\*Category:\*\*\s*(.+)\n-\s*\*\*Severity:\*\*\s*(CRITICAL|MAJOR|MINOR|SUGGESTION)\n-\s*\*\*Location:\*\*\s*(.+)\n-\s*\*\*Description:\*\*\s*(.+)\n-\s*\*\*Impact:\*\*\s*(.+)\n-\s*\*\*Recommendation:\*\*\s*(.+)/gi;
  const findings: ParsedFinding[] = [];
  let findingMatch;

  while ((findingMatch = findingRegex.exec(text)) !== null) {
    findings.push({
      number: parseInt(findingMatch[1], 10),
      title: findingMatch[2].trim(),
      category: findingMatch[3].trim(),
      severity: findingMatch[4].trim() as FindingSeverity,
      location: findingMatch[5].trim(),
      description: findingMatch[6].trim(),
      impact: findingMatch[7].trim(),
      recommendation: findingMatch[8].trim(),
    });
  }

  // Count findings by severity
  const findingCounts: Record<FindingSeverity, number> = {
    CRITICAL: 0,
    MAJOR: 0,
    MINOR: 0,
    SUGGESTION: 0,
  };
  for (const finding of findings) {
    findingCounts[finding.severity]++;
  }

  // Parse strengths
  const strengthsMatch = text.match(/### Strengths\s*\n([\s\S]*?)(?=###|$)/i);
  const strengths: string[] = [];
  if (strengthsMatch) {
    const lines = strengthsMatch[1].trim().split("\n");
    for (const line of lines) {
      const cleaned = line.replace(/^\d+\.\s*/, "").replace(/^-\s*/, "").trim();
      if (cleaned) strengths.push(cleaned);
    }
  }

  return {
    scores,
    overallScore: Math.round(overallScore * 10) / 10,
    findings,
    strengths,
    findingCounts,
  };
}
```

---

## C. SSE Event Sequence

```
1. review_start              -> { conversationId, messageId, mode: "peer_review", reviewType: string }
2. reviewers_start           -> { totalReviewers: number }
3. reviewer_complete         -> { data: ReviewerCompletePayload }  // emitted per reviewer as each finishes
   ... (repeated for each reviewer)
4. all_reviewers_complete    -> { data: AllReviewersPayload }
5. consolidation_start       -> {}
6. consolidation_complete    -> { data: ConsolidationCompletePayload }
7. title_complete            -> { data: { title: string } }        // new conversations only
8. complete                  -> {}
```

On error at any point:
```
error -> { message: string }
```

### TypeScript Payload Interfaces

```typescript
// review_start
interface ReviewStartPayload {
  conversationId: string;
  messageId: string;
  mode: "peer_review";
  reviewType: string;
}

// reviewer_complete (emitted per reviewer as each finishes)
interface ReviewerCompletePayload {
  data: {
    reviewerIndex: number;          // 0-based
    model: string;
    reviewText: string;             // full review text
    scores: Array<{
      criterion: string;
      score: number;
      weight: number;
      justification: string;
    }>;
    overallScore: number;           // weighted average
    findingCounts: Record<FindingSeverity, number>;
    findings: ParsedFinding[];
    strengths: string[];
    responseTimeMs: number;
    totalReviewers: number;
  };
}

// all_reviewers_complete
interface AllReviewersPayload {
  data: {
    reviews: Array<{
      reviewerIndex: number;
      model: string;
      overallScore: number;
      findingCounts: Record<FindingSeverity, number>;
      responseTimeMs: number;
    }>;
    failedReviewers: Array<{
      reviewerIndex: number;
      model: string;
      error: string;
    }>;
    totalSucceeded: number;
    totalFailed: number;
    averageOverallScore: number;
  };
}

// consolidation_complete
interface ConsolidationCompletePayload {
  data: {
    model: string;
    consolidatedReport: string;     // full consolidated report text
    consensusScores: Array<{
      criterion: string;
      average: number;
      stddev: number;
      agreement: "High" | "Medium" | "Low";
    }>;
    actionItemCount: number;
    criticalFindingCount: number;
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
interface PeerReviewStreamRequest {
  question: string;                     // the work to be reviewed
  mode: "peer_review";
  conversationId?: string;
  modeConfig: {
    reviewType: ReviewType;
    reviewerModels: string[];           // models that perform independent reviews
    consolidatorModel: string;          // model that produces consolidated report
    customRubric?: {                    // required when reviewType is "custom"
      name: string;
      description: string;
      criteria: Array<{
        name: string;
        description: string;
        weight: number;
      }>;
    };
    timeoutMs?: number;
  };
}
```

### Zod Validation

```typescript
const rubricCriterionSchema = z.object({
  name: z.string().min(2, "Criterion name must be at least 2 characters"),
  description: z.string().min(10, "Criterion description must be at least 10 characters"),
  weight: z.number().min(1).max(5, "Weight must be between 1 and 5"),
});

const customRubricSchema = z.object({
  name: z.string().min(3, "Rubric name must be at least 3 characters"),
  description: z.string().min(10, "Rubric description must be at least 10 characters"),
  criteria: z.array(rubricCriterionSchema)
    .min(3, "Custom rubric requires at least 3 criteria")
    .max(10, "Maximum 10 criteria allowed"),
});

const peerReviewRequestSchema = z.object({
  question: z.string()
    .min(1, "Work to review is required")
    .max(200_000, "Work must be under 200,000 characters"),
  mode: z.literal("peer_review"),
  conversationId: z.string().optional(),
  modeConfig: z.object({
    reviewType: z.enum([
      "architecture_review",
      "code_review",
      "design_spec_review",
      "compliance_audit",
      "business_plan_review",
      "custom",
    ]),
    reviewerModels: z.array(z.string().min(1))
      .min(2, "Peer Review requires at least 2 reviewers")
      .max(6, "Maximum 6 reviewers allowed"),
    consolidatorModel: z.string().min(1, "Consolidator model is required"),
    customRubric: customRubricSchema.optional(),
    timeoutMs: z.number().min(30_000).max(600_000).optional(),
  }).refine(
    (data) => data.reviewType !== "custom" || data.customRubric !== undefined,
    { message: "customRubric is required when reviewType is 'custom'" }
  ),
});
```

### Default Configuration

```typescript
const DEFAULT_PEER_REVIEW_CONFIG = {
  reviewType: "architecture_review" as ReviewType,
  reviewerModels: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
  ],
  consolidatorModel: "anthropic/claude-opus-4-6",
  timeoutMs: 150_000,
};
```

### Example Requests

Architecture review:
```json
{
  "question": "## Architecture Overview\n\nOur e-commerce platform uses a microservices architecture...\n\n### Services\n1. **User Service** — handles auth via JWT...\n2. **Product Catalog** — PostgreSQL with Redis cache...\n3. **Order Processing** — event-driven via RabbitMQ...\n[full architecture description]...",
  "mode": "peer_review",
  "modeConfig": {
    "reviewType": "architecture_review",
    "reviewerModels": [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro"
    ],
    "consolidatorModel": "anthropic/claude-opus-4-6"
  }
}
```

Code review with custom rubric:
```json
{
  "question": "```typescript\nexport async function processPayment(orderId: string, amount: number) {\n  const order = await db.orders.findById(orderId);\n  if (!order) throw new Error('Order not found');\n  ...\n}\n```",
  "mode": "peer_review",
  "modeConfig": {
    "reviewType": "custom",
    "reviewerModels": [
      "anthropic/claude-opus-4-6",
      "openai/o3"
    ],
    "consolidatorModel": "anthropic/claude-opus-4-6",
    "customRubric": {
      "name": "Payment Processing Review",
      "description": "Review payment processing code for correctness and compliance.",
      "criteria": [
        { "name": "PCI Compliance", "description": "Adherence to PCI-DSS standards for payment data handling.", "weight": 5 },
        { "name": "Idempotency", "description": "Payment operations are safe to retry without double-charging.", "weight": 5 },
        { "name": "Error Recovery", "description": "Graceful handling of payment failures, timeouts, and partial completions.", "weight": 4 }
      ]
    }
  }
}
```

---

## E. Output Format

### Result Interface

```typescript
interface PeerReviewResult {
  reviews: ReviewResult[];
  failedReviewers: FailedReviewer[];
  consolidation: ConsolidationResult;
  title?: string;
}

interface ReviewResult {
  reviewerIndex: number;              // 0-based
  model: string;
  reviewText: string;                 // full review text
  scores: Array<{
    criterion: string;
    score: number;                    // 1-5
    weight: number;                   // 1-5
    justification: string;
  }>;
  overallScore: number;               // weighted average
  findings: ParsedFinding[];
  findingCounts: Record<FindingSeverity, number>;
  strengths: string[];
  responseTimeMs: number;
}

interface FailedReviewer {
  reviewerIndex: number;
  model: string;
  error: string;
}

interface ConsolidationResult {
  model: string;
  consolidatedReport: string;         // full consolidated report text
  consensusScores: Array<{
    criterion: string;
    average: number;
    stddev: number;
    agreement: "High" | "Medium" | "Low";
  }>;
  actionItemCount: number;
  criticalFindingCount: number;
  responseTimeMs: number;
}
```

### UI Display

- **Review Cards:** One expandable card per reviewer. Each card shows the reviewer model name, response time, overall score as a badge (color-coded: 1-2 red, 3 yellow, 4-5 green), criteria scores as horizontal bars, finding counts by severity as colored chips (CRITICAL=red, MAJOR=orange, MINOR=yellow, SUGGESTION=blue), and expandable full review text.
- **Score Comparison Matrix:** Interactive table showing all reviewers' scores side-by-side with average and standard deviation columns. Cells where stddev > 1.5 are highlighted in orange to indicate disagreement.
- **Findings Board:** Kanban-style board with columns for CRITICAL, MAJOR, MINOR, SUGGESTION. Consensus findings (2+ reviewers) are visually distinct from unique findings. Each finding card shows title, category, reviewer(s), and expandable details.
- **Consolidated Report:** The primary displayed response in the chat. Includes collapsible sections for consensus scores, findings summary, action items, and executive summary.
- **Agreement Metrics:** Small dashboard widget showing inter-reviewer agreement stats.

### DB Storage

Uses the `deliberation_stages` table:

| `stageType` | `stageOrder` | `model` | `role` | `content` | `parsedData` |
|-------------|:------------:|---------|--------|-----------|--------------|
| `"review_1"` | 1 | reviewer model ID | `"reviewer"` | Full review text | `ReviewParsedData` |
| `"review_2"` | 1 | reviewer model ID | `"reviewer"` | Full review text | `ReviewParsedData` |
| `"review_3"` | 1 | reviewer model ID | `"reviewer"` | Full review text | `ReviewParsedData` |
| `"review_4"` | 1 | reviewer model ID | `"reviewer"` | Full review text | `ReviewParsedData` |
| `"review_5"` | 1 | reviewer model ID | `"reviewer"` | Full review text | `ReviewParsedData` |
| `"review_6"` | 1 | reviewer model ID | `"reviewer"` | Full review text | `ReviewParsedData` |
| `"consolidation"` | 2 | consolidator model ID | `"consolidator"` | Full consolidated report | `ConsolidationParsedData` |

Note: All reviewers share `stageOrder: 1` since they run in parallel. Consolidation is `stageOrder: 2`.

### parsedData JSONB Examples

**Review stage (`stageType: "review_1"`):**
```json
{
  "reviewerIndex": 0,
  "scores": [
    { "criterion": "Scalability", "score": 4, "weight": 5, "justification": "Kubernetes autoscaling is well-configured, but database remains a single instance." },
    { "criterion": "Security", "score": 3, "weight": 5, "justification": "JWT auth is implemented but lacks refresh token rotation. No mTLS between services." },
    { "criterion": "Maintainability", "score": 4, "weight": 4, "justification": "Clean service boundaries and good documentation. Some shared libraries need versioning." },
    { "criterion": "Cost Efficiency", "score": 3, "weight": 3, "justification": "Over-provisioned for average load. No spot instance usage." },
    { "criterion": "Reliability", "score": 3, "weight": 4, "justification": "Circuit breakers present but no chaos testing. DR plan is incomplete." },
    { "criterion": "Performance", "score": 4, "weight": 3, "justification": "Redis caching strategy is effective. P99 latency is within target." }
  ],
  "overallScore": 3.5,
  "findingCounts": {
    "CRITICAL": 1,
    "MAJOR": 2,
    "MINOR": 3,
    "SUGGESTION": 2
  },
  "findings": [
    {
      "number": 1,
      "title": "Single-Instance Database is a Single Point of Failure",
      "category": "Reliability",
      "severity": "CRITICAL",
      "location": "Data Layer — PostgreSQL configuration",
      "description": "The primary database runs as a single instance with no read replicas or failover configuration.",
      "impact": "A database failure would cause complete system downtime with potential data loss.",
      "recommendation": "Implement PostgreSQL streaming replication with automatic failover using Patroni or AWS RDS Multi-AZ."
    },
    {
      "number": 2,
      "title": "Missing Refresh Token Rotation",
      "category": "Security",
      "severity": "MAJOR",
      "location": "User Service — JWT authentication flow",
      "description": "JWT access tokens have 24-hour expiry with no refresh token rotation mechanism.",
      "impact": "Compromised tokens remain valid for extended periods, increasing attack window.",
      "recommendation": "Implement short-lived access tokens (15 min) with refresh token rotation."
    }
  ],
  "strengths": [
    "Clean microservice boundaries with well-defined APIs",
    "Effective Redis caching strategy with proper invalidation",
    "Comprehensive API documentation"
  ],
  "responseTimeMs": 5200
}
```

**Review stage (`stageType: "review_2"`):**
```json
{
  "reviewerIndex": 1,
  "scores": [
    { "criterion": "Scalability", "score": 3, "weight": 5, "justification": "Application layer scales well but data layer is the bottleneck." },
    { "criterion": "Security", "score": 2, "weight": 5, "justification": "Several input validation gaps and no rate limiting on public endpoints." },
    { "criterion": "Maintainability", "score": 4, "weight": 4, "justification": "Good separation of concerns. Logging could be more structured." },
    { "criterion": "Cost Efficiency", "score": 3, "weight": 3, "justification": "Reasonable for current scale but scaling costs will be linear." },
    { "criterion": "Reliability", "score": 2, "weight": 4, "justification": "No disaster recovery testing. Backup strategy is untested." },
    { "criterion": "Performance", "score": 3, "weight": 3, "justification": "Acceptable but no load testing evidence provided." }
  ],
  "overallScore": 2.8,
  "findingCounts": {
    "CRITICAL": 2,
    "MAJOR": 3,
    "MINOR": 1,
    "SUGGESTION": 1
  },
  "findings": [
    {
      "number": 1,
      "title": "Database Single Point of Failure",
      "category": "Reliability",
      "severity": "CRITICAL",
      "location": "Infrastructure — Database tier",
      "description": "No database replication or failover mechanism in place.",
      "impact": "Complete service outage on database failure.",
      "recommendation": "Deploy multi-AZ database with automated failover."
    },
    {
      "number": 2,
      "title": "Missing Rate Limiting on API Gateway",
      "category": "Security",
      "severity": "CRITICAL",
      "location": "API Gateway configuration",
      "description": "No rate limiting configured on public-facing endpoints.",
      "impact": "Vulnerable to DDoS and brute-force attacks.",
      "recommendation": "Implement rate limiting at the API gateway level with per-IP and per-user quotas."
    }
  ],
  "strengths": [
    "Event-driven order processing reduces coupling",
    "Well-structured service boundaries",
    "Good use of container orchestration"
  ],
  "responseTimeMs": 4800
}
```

**Consolidation stage (`stageType: "consolidation"`):**
```json
{
  "reviewerCount": 3,
  "consensusScores": [
    { "criterion": "Scalability", "average": 3.7, "stddev": 0.47, "agreement": "High" },
    { "criterion": "Security", "average": 2.7, "stddev": 0.94, "agreement": "Medium" },
    { "criterion": "Maintainability", "average": 4.0, "stddev": 0.00, "agreement": "High" },
    { "criterion": "Cost Efficiency", "average": 3.0, "stddev": 0.00, "agreement": "High" },
    { "criterion": "Reliability", "average": 2.7, "stddev": 0.47, "agreement": "High" },
    { "criterion": "Performance", "average": 3.3, "stddev": 0.47, "agreement": "High" }
  ],
  "weightedOverallAvg": 3.2,
  "weightedOverallStddev": 0.35,
  "overallAgreement": "High",
  "totalFindings": 16,
  "consensusFindingCount": 5,
  "uniqueFindingCount": 6,
  "disputedAssessmentCount": 1,
  "actionItemCount": 8,
  "criticalFindingCount": 3,
  "majorFindingCount": 5,
  "interReviewerAgreement": {
    "averageScoreStddev": 0.39,
    "findingsOverlapRate": 0.45,
    "severityAgreementRate": 0.80
  },
  "responseTimeMs": 7800
}
```

---

## F. Edge Cases

| Scenario | Handling |
|----------|----------|
| All reviewers fail | Emit `error` event. Pipeline aborts. No consolidation attempted. |
| Some reviewers fail (but 2+ succeed) | Continue with successful reviews. Note failures in `failedReviewers`. Consolidation proceeds with available reviews. |
| Only 1 reviewer succeeds | Emit `error` event: "Minimum 2 reviews required for consolidation." The single review is still saved. |
| All reviewers give identical scores | Consolidation notes "unanimous consensus" with stddev of 0.00 and agreement "High" for all criteria. |
| Wild disagreement (stddev > 1.5 on a criterion) | Highlighted in the "Disputed Assessments" section. Consolidator analyzes both positions. |
| Reviewer does not follow scoring format | Parser extracts what it can. Missing scores default to empty. Reviewer is excluded from score aggregation but included for qualitative findings. Full raw text is always saved. |
| Reviewer produces no findings | Consolidation notes "no findings" from that reviewer. If the reviewer scored everything 5/5, consolidation may note "meets all criteria from Reviewer N's perspective." |
| Reviewer goes off-rubric (adds extra criteria) | Extra criteria are ignored by the parser. Only rubric criteria are included in score aggregation. |
| Custom rubric with fewer than 3 criteria | Rejected at validation with 400 error. |
| Custom rubric with weight = 0 | Rejected at validation (weight must be 1-5). |
| Consolidator model fails | Emit `error` event. All individual reviews are still saved to the database. |
| Work under review exceeds 200,000 characters | Rejected at validation with 400 error. |
| Timeout (reviewer) | Per-model timeout via `AbortSignal.timeout()`. Failed reviewer excluded from results. |
| Timeout (consolidator) | Emit `error` event. Individual reviews are still saved. |
| Conversation mode mismatch | If `conversationId` references a conversation with `mode != "peer_review"`, return 400 error. |

---

## G. Database Schema

Uses the shared `deliberation_stages` table (see `00-shared-infrastructure.md`):

```typescript
// deliberation_stages rows for a single Peer Review pipeline execution
[
  // Stage 1: Reviews (one row per reviewer, all stageOrder 1)
  {
    id: "uuid-1",
    messageId: "msg-101",
    stageType: "review_1",
    stageOrder: 1,
    model: "anthropic/claude-opus-4-6",
    role: "reviewer",
    content: "## Peer Review\n\n### Scores\n| Criterion | Score (1-5) | Weight | Justification |\n...",
    parsedData: {
      reviewerIndex: 0,
      scores: [
        { criterion: "Scalability", score: 4, weight: 5, justification: "Kubernetes autoscaling is well-configured..." },
        { criterion: "Security", score: 3, weight: 5, justification: "JWT auth is implemented but lacks refresh token rotation..." },
        { criterion: "Maintainability", score: 4, weight: 4, justification: "Clean service boundaries..." },
        { criterion: "Cost Efficiency", score: 3, weight: 3, justification: "Over-provisioned for average load..." },
        { criterion: "Reliability", score: 3, weight: 4, justification: "Circuit breakers present but no chaos testing..." },
        { criterion: "Performance", score: 4, weight: 3, justification: "Redis caching strategy is effective..." },
      ],
      overallScore: 3.5,
      findingCounts: { CRITICAL: 1, MAJOR: 2, MINOR: 3, SUGGESTION: 2 },
      findings: [
        {
          number: 1,
          title: "Single-Instance Database is a Single Point of Failure",
          category: "Reliability",
          severity: "CRITICAL",
          location: "Data Layer — PostgreSQL configuration",
          description: "The primary database runs as a single instance...",
          impact: "A database failure would cause complete system downtime...",
          recommendation: "Implement PostgreSQL streaming replication...",
        },
      ],
      strengths: [
        "Clean microservice boundaries with well-defined APIs",
        "Effective Redis caching strategy",
        "Comprehensive API documentation",
      ],
      responseTimeMs: 5200,
    },
    responseTimeMs: 5200,
  },
  {
    id: "uuid-2",
    messageId: "msg-101",
    stageType: "review_2",
    stageOrder: 1,
    model: "openai/o3",
    role: "reviewer",
    content: "## Peer Review\n\n### Scores\n| Criterion | Score (1-5) | Weight | Justification |\n...",
    parsedData: {
      reviewerIndex: 1,
      scores: [
        { criterion: "Scalability", score: 3, weight: 5, justification: "Application layer scales well but data layer is the bottleneck..." },
        { criterion: "Security", score: 2, weight: 5, justification: "Several input validation gaps..." },
        { criterion: "Maintainability", score: 4, weight: 4, justification: "Good separation of concerns..." },
        { criterion: "Cost Efficiency", score: 3, weight: 3, justification: "Reasonable for current scale..." },
        { criterion: "Reliability", score: 2, weight: 4, justification: "No disaster recovery testing..." },
        { criterion: "Performance", score: 3, weight: 3, justification: "Acceptable but no load testing evidence..." },
      ],
      overallScore: 2.8,
      findingCounts: { CRITICAL: 2, MAJOR: 3, MINOR: 1, SUGGESTION: 1 },
      findings: [
        {
          number: 1,
          title: "Database Single Point of Failure",
          category: "Reliability",
          severity: "CRITICAL",
          location: "Infrastructure — Database tier",
          description: "No database replication or failover mechanism...",
          impact: "Complete service outage on database failure.",
          recommendation: "Deploy multi-AZ database with automated failover.",
        },
        {
          number: 2,
          title: "Missing Rate Limiting on API Gateway",
          category: "Security",
          severity: "CRITICAL",
          location: "API Gateway configuration",
          description: "No rate limiting configured on public-facing endpoints.",
          impact: "Vulnerable to DDoS and brute-force attacks.",
          recommendation: "Implement rate limiting at the API gateway level.",
        },
      ],
      strengths: [
        "Event-driven order processing reduces coupling",
        "Well-structured service boundaries",
        "Good use of container orchestration",
      ],
      responseTimeMs: 4800,
    },
    responseTimeMs: 4800,
  },
  {
    id: "uuid-3",
    messageId: "msg-101",
    stageType: "review_3",
    stageOrder: 1,
    model: "google/gemini-2.5-pro",
    role: "reviewer",
    content: "## Peer Review\n\n### Scores\n...",
    parsedData: {
      reviewerIndex: 2,
      scores: [
        { criterion: "Scalability", score: 4, weight: 5, justification: "Good horizontal scaling design..." },
        { criterion: "Security", score: 3, weight: 5, justification: "Basic security in place but needs hardening..." },
        { criterion: "Maintainability", score: 4, weight: 4, justification: "Well-organized codebase..." },
        { criterion: "Cost Efficiency", score: 3, weight: 3, justification: "Room for optimization..." },
        { criterion: "Reliability", score: 3, weight: 4, justification: "Needs DR testing and backup validation..." },
        { criterion: "Performance", score: 3, weight: 3, justification: "Meets current needs but needs load testing..." },
      ],
      overallScore: 3.4,
      findingCounts: { CRITICAL: 1, MAJOR: 2, MINOR: 2, SUGGESTION: 3 },
      findings: [
        {
          number: 1,
          title: "No Database Failover Configuration",
          category: "Reliability",
          severity: "CRITICAL",
          location: "Database infrastructure",
          description: "Single database instance without replication.",
          impact: "Single point of failure for the entire system.",
          recommendation: "Set up streaming replication with automated failover.",
        },
      ],
      strengths: [
        "Microservice architecture enables independent deployment",
        "Good API versioning strategy",
        "Effective use of Redis for caching",
      ],
      responseTimeMs: 4100,
    },
    responseTimeMs: 4100,
  },

  // Stage 2: Consolidation (single row)
  {
    id: "uuid-4",
    messageId: "msg-101",
    stageType: "consolidation",
    stageOrder: 2,
    model: "anthropic/claude-opus-4-6",
    role: "consolidator",
    content: "# Consolidated Peer Review Report\n\n## Consensus Scores\n| Criterion | Weight | R1 | R2 | R3 | Avg | StdDev | Agreement |\n...",
    parsedData: {
      reviewerCount: 3,
      consensusScores: [
        { criterion: "Scalability", average: 3.7, stddev: 0.47, agreement: "High" },
        { criterion: "Security", average: 2.7, stddev: 0.47, agreement: "High" },
        { criterion: "Maintainability", average: 4.0, stddev: 0.00, agreement: "High" },
        { criterion: "Cost Efficiency", average: 3.0, stddev: 0.00, agreement: "High" },
        { criterion: "Reliability", average: 2.7, stddev: 0.47, agreement: "High" },
        { criterion: "Performance", average: 3.3, stddev: 0.47, agreement: "High" },
      ],
      weightedOverallAvg: 3.2,
      weightedOverallStddev: 0.35,
      overallAgreement: "High",
      totalFindings: 16,
      consensusFindingCount: 5,
      uniqueFindingCount: 6,
      disputedAssessmentCount: 1,
      actionItemCount: 8,
      criticalFindingCount: 3,
      majorFindingCount: 5,
      interReviewerAgreement: {
        averageScoreStddev: 0.39,
        findingsOverlapRate: 0.45,
        severityAgreementRate: 0.80,
      },
      responseTimeMs: 7800,
    },
    responseTimeMs: 7800,
  },
]
```

### Indexes

Covered by the shared index on `deliberation_stages(message_id, stage_order)` defined in `00-shared-infrastructure.md`.

### Query Patterns

```typescript
// Load full peer review result for a message
async function loadPeerReviewResult(messageId: string): Promise<PeerReviewResult> {
  const stages = await db
    .select()
    .from(deliberationStages)
    .where(eq(deliberationStages.messageId, messageId))
    .orderBy(deliberationStages.stageOrder);

  const reviewStages = stages.filter(s => s.stageType.startsWith("review_"));
  const consolidationStage = stages.find(s => s.stageType === "consolidation");

  return {
    reviews: reviewStages.map(s => {
      const parsed = s.parsedData as ReviewParsedData;
      return {
        reviewerIndex: parsed.reviewerIndex,
        model: s.model!,
        reviewText: s.content,
        scores: parsed.scores,
        overallScore: parsed.overallScore,
        findings: parsed.findings,
        findingCounts: parsed.findingCounts,
        strengths: parsed.strengths,
        responseTimeMs: s.responseTimeMs!,
      };
    }),
    failedReviewers: [], // failures are not persisted as rows
    consolidation: {
      model: consolidationStage!.model!,
      consolidatedReport: consolidationStage!.content,
      consensusScores: (consolidationStage?.parsedData as ConsolidationParsedData).consensusScores,
      actionItemCount: (consolidationStage?.parsedData as ConsolidationParsedData).actionItemCount,
      criticalFindingCount: (consolidationStage?.parsedData as ConsolidationParsedData).criticalFindingCount,
      responseTimeMs: consolidationStage!.responseTimeMs!,
    },
  };
}
```

### Conversation-Level Storage

```typescript
// conversations table
{ id, userId, title, mode: "peer_review", createdAt, updatedAt }

// messages table
{ id, conversationId, role: "user", content: workUnderReview }
{ id, conversationId, role: "assistant", content: consolidatedReport }
```

The assistant message `content` is the consolidator's full report, ensuring the consolidated review is accessible from the conversation view.
