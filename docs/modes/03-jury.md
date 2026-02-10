# 03 — Jury Mode

> Present → Deliberate → Verdict. Multi-dimensional evaluation of existing content.

**Family:** Evaluation
**Status:** Specified (Pre-Implementation)
**Min Models:** 3 jurors + 1 foreman
**Multi-turn:** No

---

## A. Requirements

### Functional

1. User provides EXISTING content to be evaluated (not a question to be answered). Optionally provides the original question/context the content was responding to.
2. **Stage 1 — Present:** The content under evaluation and optional context are formatted and distributed to all juror models.
3. **Stage 2 — Deliberate:** All juror models independently evaluate the content in parallel. Each juror scores on 5 dimensions (1-10): Accuracy, Completeness, Clarity, Relevance, Actionability. Each provides a structured scorecard with justifications, deliberation notes, and a verdict: APPROVE / REVISE / REJECT.
4. **Stage 3 — Verdict:** The foreman model receives all juror assessments, calculates the majority verdict, and produces a formal verdict report with consolidated feedback, dimension-by-dimension aggregation, consensus strengths/weaknesses, dissenting opinions, and prioritized improvement recommendations.
5. A title is generated for the evaluation session.
6. All results are saved to the database.

### Non-Functional

- Stage 2 completes in the time of the slowest juror (parallel evaluation).
- Stage 3 is a single model call (foreman synthesis).
- Total pipeline target: under 90 seconds.
- Score parsing must be robust against formatting variations in juror output.

### Model Constraints

- Minimum 3 juror models + 1 foreman (4 total).
- Maximum 6 juror models + 1 foreman (7 total).
- Foreman model MUST NOT overlap with a juror model (foreman must be impartial).

### What Makes It Distinct

- Evaluates EXISTING content rather than generating new answers.
- Structured, dimensional scoring (5 dimensions, 1-10 each) provides granular feedback.
- Verdict system (APPROVE / REVISE / REJECT) gives a clear actionable outcome.
- Aggregated scores across jurors reveal consensus and disagreement.
- Not a generative mode: no new answer is produced, only an evaluation report.

### Scoring Dimensions

| Dimension | Definition | Score Range |
|-----------|-----------|:-----------:|
| Accuracy | Are the facts, claims, and technical details correct? | 1-10 |
| Completeness | Does it cover all important aspects of the topic? | 1-10 |
| Clarity | Is it well-organized, easy to follow, and unambiguous? | 1-10 |
| Relevance | Does it directly address the question/task at hand? | 1-10 |
| Actionability | Does it provide concrete, usable guidance? | 1-10 |

### Verdict Thresholds

| Verdict | Condition | Meaning |
|---------|-----------|---------|
| APPROVE | Average score >= 7.0 | Content is good enough for use as-is |
| REVISE | Average score >= 4.0 and < 7.0 | Content needs improvement before use |
| REJECT | Average score < 4.0 | Content is fundamentally flawed |

---

## B. Pipeline Design

### Stages

| Stage | Name | Parallel? | Input | Output |
|-------|------|-----------|-------|--------|
| 1 | Present | No | Content + optional context | Formatted presentation |
| 2 | Deliberate | Yes | Evaluation prompt per juror | `JurorAssessment[]` |
| 3 | Verdict | No | All juror assessments | `ForemanReport` |

### Data Flow

```
User provides: content + optional originalQuestion
    |
Stage 1: Format content for evaluation
    | EvaluationPresentation
Stage 2: queryModelsParallel(jurorModels, evaluationPrompt)
    | JurorAssessment[] (parse scores + verdicts from each)
         |
         +-- Calculate majority verdict
         +-- Aggregate dimension scores (avg, min, max)
         +-- Identify consensus strengths/weaknesses
    |
Stage 3: buildForemanPrompt() -> queryModel(foremanModel)
    | ForemanReport (formal verdict with consolidated analysis)
    |
generateTitle() -> save to DB -> stream to client
```

### Prompt Templates

**Evaluation Prompt** (`buildEvaluationPrompt`):

```
You are a juror evaluating the quality of a response. Score it on 5 dimensions (1-10 each) and deliver a verdict.

{{#if originalQuestion}}
ORIGINAL QUESTION:
{{originalQuestion}}

{{/if}}
CONTENT UNDER EVALUATION:
{{content}}

Score each dimension from 1 (terrible) to 10 (exceptional):

1. **Accuracy** — Are the facts, claims, and technical details correct?
2. **Completeness** — Does it cover all important aspects of the topic?
3. **Clarity** — Is it well-organized, easy to follow, and unambiguous?
4. **Relevance** — Does it directly address the question/task at hand?
5. **Actionability** — Does it provide concrete, usable guidance?

For each dimension, provide:
- A score (1-10)
- 1-2 sentences of justification

Then deliver your verdict based on your average score:
- APPROVE (average >= 7): The content is good enough for use
- REVISE (average 4-6.9): The content needs improvement before use
- REJECT (average < 4): The content is fundamentally flawed

Format your response as:

## Juror Assessment

### Scores

| Dimension | Score | Justification |
|-----------|:-----:|---------------|
| Accuracy | [1-10] | [justification] |
| Completeness | [1-10] | [justification] |
| Clarity | [1-10] | [justification] |
| Relevance | [1-10] | [justification] |
| Actionability | [1-10] | [justification] |
| **Average** | [avg] | |

### Deliberation Notes
[2-3 paragraphs explaining your overall assessment, key strengths, and key weaknesses]

### Verdict
VERDICT: [APPROVE|REVISE|REJECT]

### Recommendations
[If REVISE or REJECT: numbered list of specific improvements needed]
```

**Foreman Prompt** (`buildForemanPrompt`):

```
You are the foreman of a jury that has evaluated the following content. Synthesize all juror assessments into a final verdict report.

CONTENT EVALUATED:
{{content}}

{{#if originalQuestion}}
ORIGINAL QUESTION:
{{originalQuestion}}

{{/if}}
JUROR ASSESSMENTS:
{{#each jurorAssessments}}
--- Juror {{@index + 1}} ({{model}}) ---
{{assessment}}

{{/each}}

VOTE TALLY:
- APPROVE: {{approveCount}}
- REVISE: {{reviseCount}}
- REJECT: {{rejectCount}}
- Majority Verdict: {{majorityVerdict}}

Produce a formal verdict report:

## Jury Verdict Report

### Final Verdict: [APPROVE|REVISE|REJECT]
[1-2 sentence summary explaining the jury's decision]

### Dimension Analysis

| Dimension | Avg Score | Min | Max | Consensus |
|-----------|:---------:|:---:|:---:|-----------|
| Accuracy | [avg] | [min] | [max] | [agreement note] |
| Completeness | [avg] | [min] | [max] | [agreement note] |
| Clarity | [avg] | [min] | [max] | [agreement note] |
| Relevance | [avg] | [min] | [max] | [agreement note] |
| Actionability | [avg] | [min] | [max] | [agreement note] |
| **Overall** | [avg] | [min] | [max] | |

### Key Strengths (Consensus)
[Strengths identified by 2+ jurors — bulleted list]

### Key Weaknesses (Consensus)
[Weaknesses identified by 2+ jurors — bulleted list]

### Improvement Recommendations
[Prioritized numbered list — only include if verdict is REVISE or REJECT]

### Dissenting Opinions
[If any juror's verdict differed from the majority, summarize their reasoning here. If unanimous, state "The jury was unanimous."]
```

**Title Prompt** (`buildTitlePrompt`):

```
Generate a brief title (3-5 words) for a jury evaluation session about this content:

"{{contentPreview}}"

Reply with ONLY the title. No quotes, no punctuation, no explanation.
```

### Score Parser

```typescript
interface ParsedScores {
  accuracy: number | null;
  completeness: number | null;
  clarity: number | null;
  relevance: number | null;
  actionability: number | null;
}

function parseScores(text: string): ParsedScores {
  const dimensions = ["accuracy", "completeness", "clarity", "relevance", "actionability"] as const;
  const scores: ParsedScores = {
    accuracy: null, completeness: null, clarity: null,
    relevance: null, actionability: null,
  };

  for (const dim of dimensions) {
    // Primary: table format  | Dimension | Score |
    const tableRegex = new RegExp(
      `\\|\\s*${dim}\\s*\\|\\s*(\\d+)\\s*\\|`, "i"
    );
    const tableMatch = text.match(tableRegex);
    if (tableMatch) {
      const score = parseInt(tableMatch[1], 10);
      if (score >= 1 && score <= 10) {
        scores[dim] = score;
        continue;
      }
    }

    // Fallback: "Accuracy: 8" or "Accuracy — 8" or "**Accuracy**: 8/10"
    const inlineRegex = new RegExp(
      `${dim}[:\\s—-]+\\*?\\*?(\\d+)(?:\\/10)?`, "i"
    );
    const inlineMatch = text.match(inlineRegex);
    if (inlineMatch) {
      const score = parseInt(inlineMatch[1], 10);
      if (score >= 1 && score <= 10) {
        scores[dim] = score;
      }
    }
  }

  return scores;
}

function parseVerdict(text: string): "APPROVE" | "REVISE" | "REJECT" | null {
  // Primary: "VERDICT: APPROVE"
  const verdictMatch = text.match(/VERDICT:\s*(APPROVE|REVISE|REJECT)/i);
  if (verdictMatch) {
    return verdictMatch[1].toUpperCase() as "APPROVE" | "REVISE" | "REJECT";
  }

  // Fallback: look for standalone verdict keywords near end of text
  const lastParagraph = text.slice(-500);
  if (/\bAPPROVE\b/i.test(lastParagraph)) return "APPROVE";
  if (/\bREJECT\b/i.test(lastParagraph)) return "REJECT";
  if (/\bREVISE\b/i.test(lastParagraph)) return "REVISE";

  return null;
}

function calculateAverage(scores: ParsedScores): number | null {
  const values = Object.values(scores).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}
```

### Majority Verdict Calculation

```typescript
function calculateMajorityVerdict(
  verdicts: Array<"APPROVE" | "REVISE" | "REJECT" | null>
): { verdict: "APPROVE" | "REVISE" | "REJECT"; approveCount: number; reviseCount: number; rejectCount: number } {
  const validVerdicts = verdicts.filter((v): v is "APPROVE" | "REVISE" | "REJECT" => v !== null);
  const counts = {
    APPROVE: validVerdicts.filter(v => v === "APPROVE").length,
    REVISE: validVerdicts.filter(v => v === "REVISE").length,
    REJECT: validVerdicts.filter(v => v === "REJECT").length,
  };

  // Majority: most votes wins
  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);

  // If tie between APPROVE and REJECT, default to REVISE (conservative)
  if (sorted[0][1] === sorted[1][1] && sorted[0][0] !== "REVISE" && sorted[1][0] !== "REVISE") {
    return { verdict: "REVISE", approveCount: counts.APPROVE, reviseCount: counts.REVISE, rejectCount: counts.REJECT };
  }

  return {
    verdict: sorted[0][0] as "APPROVE" | "REVISE" | "REJECT",
    approveCount: counts.APPROVE,
    reviseCount: counts.REVISE,
    rejectCount: counts.REJECT,
  };
}
```

---

## C. SSE Event Sequence

```
1. jury_start            -> { conversationId, messageId, mode: "jury" }
2. present_start         -> {}
3. present_complete      -> { data: { content: string, originalQuestion?: string } }
4. deliberation_start    -> {}
5. juror_complete         -> { data: JurorAssessment }       // emitted per juror as they finish
6. juror_complete         -> { data: JurorAssessment }       // repeated for each juror
7. juror_complete         -> { data: JurorAssessment }       // ...
8. all_jurors_complete    -> { data: JurorSummary }           // aggregated scores + majority verdict
9. verdict_start          -> {}
10. verdict_complete      -> { data: ForemanReport }
11. title_complete        -> { data: { title: string } }     // new conversations only
12. complete              -> {}
```

On error at any point:
```
error -> { message: string }
```

### TypeScript Payload Interfaces

```typescript
// jury_start
interface JuryStartPayload {
  conversationId: string;
  messageId: string;
  mode: "jury";
}

// present_complete
interface PresentCompletePayload {
  data: {
    content: string;
    originalQuestion?: string;
  };
}

// juror_complete (emitted once per juror, as each finishes)
interface JurorCompletePayload {
  data: JurorAssessment;
}

interface JurorAssessment {
  model: string;
  assessmentText: string;            // full juror response
  scores: DimensionScores;
  average: number | null;
  verdict: "APPROVE" | "REVISE" | "REJECT" | null;
  recommendations: string[];
  responseTimeMs: number;
  parseSuccess: boolean;             // false if score/verdict parsing failed
}

interface DimensionScores {
  accuracy: number | null;
  completeness: number | null;
  clarity: number | null;
  relevance: number | null;
  actionability: number | null;
}

// all_jurors_complete
interface AllJurorsCompletePayload {
  data: JurorSummary;
}

interface JurorSummary {
  jurorCount: number;
  successfulJurors: number;
  majorityVerdict: "APPROVE" | "REVISE" | "REJECT";
  voteTally: {
    approve: number;
    revise: number;
    reject: number;
  };
  dimensionAverages: DimensionScores;   // averaged across all jurors
  dimensionRanges: DimensionRanges;
}

interface DimensionRanges {
  accuracy: { min: number; max: number };
  completeness: { min: number; max: number };
  clarity: { min: number; max: number };
  relevance: { min: number; max: number };
  actionability: { min: number; max: number };
}

// verdict_complete
interface VerdictCompletePayload {
  data: ForemanReport;
}

interface ForemanReport {
  model: string;
  reportText: string;                 // full foreman report
  finalVerdict: "APPROVE" | "REVISE" | "REJECT";
  dimensionAnalysis: DimensionAnalysisRow[];
  keyStrengths: string[];
  keyWeaknesses: string[];
  recommendations: string[];
  dissentingOpinions: string[];
  responseTimeMs: number;
}

interface DimensionAnalysisRow {
  dimension: string;
  avgScore: number;
  minScore: number;
  maxScore: number;
  consensus: string;                  // "Strong agreement" | "Mixed" | "Disagreement"
}

// title_complete (reused from shared)
interface TitleCompletePayload {
  data: { title: string };
}
```

---

## D. Input Format

### Request Body

```typescript
interface JuryStreamRequest {
  question: string;                   // contains the content to evaluate
  mode: "jury";
  conversationId?: string;
  modeConfig: {
    content: string;                  // the content under evaluation (required)
    originalQuestion?: string;        // the question the content was answering (optional)
    jurorModels: string[];            // models acting as jurors
    foremanModel: string;             // model acting as foreman
    timeoutMs?: number;
  };
}
```

### Zod Validation

```typescript
const juryRequestSchema = z.object({
  question: z.string().min(1, "Content to evaluate is required"),
  mode: z.literal("jury"),
  conversationId: z.string().optional(),
  modeConfig: z.object({
    content: z.string().min(1, "Content to evaluate is required"),
    originalQuestion: z.string().optional(),
    jurorModels: z.array(z.string())
      .min(3, "Jury mode requires at least 3 juror models")
      .max(6, "Maximum 6 juror models allowed"),
    foremanModel: z.string().min(1, "Foreman model is required"),
    timeoutMs: z.number().min(10_000).max(300_000).optional(),
  }),
}).refine(
  (data) => !data.modeConfig.jurorModels.includes(data.modeConfig.foremanModel),
  { message: "Foreman model must not be one of the juror models", path: ["modeConfig", "foremanModel"] }
);
```

### Default Configuration

```typescript
const DEFAULT_JURY_CONFIG = {
  jurorModels: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
  ],
  foremanModel: "perplexity/sonar-pro",
  timeoutMs: 120_000,
};
```

### Example Request

```json
{
  "question": "Evaluate this API documentation for quality",
  "mode": "jury",
  "modeConfig": {
    "content": "## GET /api/users\n\nReturns a list of users. Accepts optional query parameters:\n- `limit` (number): Maximum results to return\n- `offset` (number): Pagination offset\n\nResponse: 200 OK with JSON array of user objects.",
    "originalQuestion": "Write API documentation for the users endpoint",
    "jurorModels": [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro"
    ],
    "foremanModel": "perplexity/sonar-pro"
  }
}
```

---

## E. Output Format

### Result Interface

```typescript
interface JuryResult {
  presentation: {
    content: string;
    originalQuestion?: string;
  };
  jurors: JurorAssessment[];
  jurorSummary: JurorSummary;
  foreman: ForemanReport;
  majorityVerdict: "APPROVE" | "REVISE" | "REJECT";
  voteTally: {
    approve: number;
    revise: number;
    reject: number;
  };
  dimensionAverages: DimensionScores;
  title?: string;
}
```

### UI Display

- **Presentation:** The content under evaluation is displayed in a highlighted card at the top, with the original question (if provided) shown above it in a muted callout.
- **Juror Assessments:** Side-by-side cards (or a tabbed view on mobile) for each juror. Each card shows:
  - Juror model name and response time
  - Radar chart of the 5 dimension scores
  - Verdict badge (green APPROVE / yellow REVISE / red REJECT)
  - Expandable section for full assessment text and recommendations
- **Aggregated View:** Summary card showing:
  - Dimension-by-dimension bar chart with avg, min, max across jurors
  - Verdict pie chart (approve/revise/reject distribution)
  - Overall average score prominently displayed
- **Foreman Report:** The primary displayed content in the chat area. Shows the formal verdict report with dimension analysis table, consensus strengths/weaknesses, and prioritized recommendations.

### DB Storage

Uses the `deliberation_stages` table:

| `stageType` | `stageOrder` | `model` | `role` | `content` | `parsedData` |
|-------------|:------------:|---------|--------|-----------|--------------|
| `"present"` | 1 | `null` | `null` | Content under evaluation | `{ "originalQuestion": "..." }` |
| `"deliberation"` | 2 | juror model ID | `"juror"` | Full juror assessment text | See below |
| `"juror_summary"` | 3 | `null` | `null` | JSON summary of all scores | See below |
| `"verdict"` | 4 | foreman model ID | `"foreman"` | Full foreman verdict report | See below |

### parsedData JSONB Examples

**Deliberation stage (`stageType: "deliberation"`):**
```json
{
  "scores": {
    "accuracy": 8,
    "completeness": 7,
    "clarity": 9,
    "relevance": 8,
    "actionability": 6
  },
  "average": 7.6,
  "verdict": "APPROVE",
  "recommendations": [
    "Add error response documentation (4xx, 5xx status codes)",
    "Include example request/response bodies",
    "Document authentication requirements"
  ],
  "parseSuccess": true
}
```

**Juror summary stage (`stageType: "juror_summary"`):**
```json
{
  "jurorCount": 3,
  "successfulJurors": 3,
  "majorityVerdict": "APPROVE",
  "voteTally": {
    "approve": 2,
    "revise": 1,
    "reject": 0
  },
  "dimensionAverages": {
    "accuracy": 7.7,
    "completeness": 6.3,
    "clarity": 8.3,
    "relevance": 8.0,
    "actionability": 5.7
  },
  "dimensionRanges": {
    "accuracy": { "min": 7, "max": 8 },
    "completeness": { "min": 5, "max": 7 },
    "clarity": { "min": 7, "max": 9 },
    "relevance": { "min": 7, "max": 9 },
    "actionability": { "min": 4, "max": 7 }
  }
}
```

**Verdict stage (`stageType: "verdict"`):**
```json
{
  "finalVerdict": "APPROVE",
  "dimensionAnalysis": [
    {
      "dimension": "Accuracy",
      "avgScore": 7.7,
      "minScore": 7,
      "maxScore": 8,
      "consensus": "Strong agreement"
    },
    {
      "dimension": "Completeness",
      "avgScore": 6.3,
      "minScore": 5,
      "maxScore": 7,
      "consensus": "Mixed"
    },
    {
      "dimension": "Clarity",
      "avgScore": 8.3,
      "minScore": 7,
      "maxScore": 9,
      "consensus": "Strong agreement"
    },
    {
      "dimension": "Relevance",
      "avgScore": 8.0,
      "minScore": 7,
      "maxScore": 9,
      "consensus": "Strong agreement"
    },
    {
      "dimension": "Actionability",
      "avgScore": 5.7,
      "minScore": 4,
      "maxScore": 7,
      "consensus": "Disagreement"
    }
  ],
  "keyStrengths": [
    "Clear and well-structured documentation format",
    "Accurate parameter descriptions"
  ],
  "keyWeaknesses": [
    "Missing error response documentation",
    "No example request/response bodies"
  ],
  "recommendations": [
    "Add comprehensive error response documentation",
    "Include example JSON request and response bodies",
    "Document authentication and authorization requirements",
    "Add rate limiting information"
  ],
  "dissentingOpinions": [
    "Juror 2 voted REVISE, noting that the lack of error documentation is a significant gap for production use."
  ]
}
```

---

## F. Edge Cases

| Scenario | Handling |
|----------|----------|
| Content to evaluate is empty | Zod validation rejects with 400 error before pipeline starts. |
| Content is very short (< 50 chars) | Valid input. Jurors may note brevity in their assessment. No special handling. |
| Content is very long (> 10,000 chars) | Valid input. Content is passed in full. Models handle their own context limits. If a model fails due to context length, it is excluded (see below). |
| Original question not provided | Evaluation proceeds without context. The `{{#if originalQuestion}}` block in the prompt is omitted. Jurors may note lack of context in Relevance scoring. |
| All jurors fail | Emit `error` event: "All juror evaluations failed." Pipeline aborts. Presentation data is still saved. |
| Some jurors fail | Continue with successful jurors. Minimum 2 successful jurors required. If fewer than 2 succeed, emit `error`. |
| Score parsing fails for a juror | Set `parseSuccess: false` in that juror's parsedData. The juror's full text is preserved. Exclude that juror from dimension aggregation. The verdict text is still attempted to parse. |
| Verdict parsing fails for a juror | Set `verdict: null`. Exclude from majority verdict calculation. If all verdicts fail to parse, attempt to infer from average scores. |
| All score parsing fails | Emit warning in metadata. Foreman still receives raw juror text and can produce a qualitative report. Dimension averages will be null. |
| Tie between APPROVE and REJECT | Default to REVISE (conservative middle ground). Foreman notes the split. |
| Tie between APPROVE and REVISE | REVISE wins (conservative). |
| Tie between REVISE and REJECT | REJECT wins (conservative). |
| Three-way tie (1 each) | Default to REVISE. |
| Foreman fails | Emit `error` event. Juror assessments and summary are still saved. The `all_jurors_complete` event has already been sent with aggregated data. |
| Foreman model same as juror model | Zod refinement rejects with 400 error before pipeline starts. |
| Juror gives score outside 1-10 range | Score is treated as null (parsing failure for that dimension). Other dimensions are preserved. |
| Juror gives non-integer score (e.g., 7.5) | Rounded to nearest integer. If regex does not match, treated as null. |
| Timeout (Stage 2) | Per-juror 120s timeout. Timed-out jurors are excluded. Minimum 2 successful jurors enforced. |
| Timeout (Stage 3) | 120s timeout. If foreman times out, emit error. Juror data preserved. |

---

## G. Database Schema

Uses the shared `deliberation_stages` table (see `00-shared-infrastructure.md`):

```typescript
// deliberation_stages rows for a single Jury pipeline execution
[
  // Stage 1: Presentation (the content being evaluated)
  {
    id: "uuid-1",
    messageId: "msg-456",
    stageType: "present",
    stageOrder: 1,
    model: null,
    role: null,
    content: "## GET /api/users\n\nReturns a list of users...",
    parsedData: {
      originalQuestion: "Write API documentation for the users endpoint",
    },
    responseTimeMs: null,
  },

  // Stage 2: Deliberation (one row per juror)
  {
    id: "uuid-2",
    messageId: "msg-456",
    stageType: "deliberation",
    stageOrder: 2,
    model: "anthropic/claude-opus-4-6",
    role: "juror",
    content: "## Juror Assessment\n\n### Scores\n\n| Dimension | Score | Justification |\n...",
    parsedData: {
      scores: { accuracy: 8, completeness: 7, clarity: 9, relevance: 8, actionability: 6 },
      average: 7.6,
      verdict: "APPROVE",
      recommendations: [
        "Add error response documentation",
        "Include example request/response bodies",
      ],
      parseSuccess: true,
    },
    responseTimeMs: 3200,
  },
  {
    id: "uuid-3",
    messageId: "msg-456",
    stageType: "deliberation",
    stageOrder: 2,
    model: "openai/o3",
    role: "juror",
    content: "## Juror Assessment\n\n### Scores\n...",
    parsedData: {
      scores: { accuracy: 7, completeness: 5, clarity: 7, relevance: 7, actionability: 4 },
      average: 6.0,
      verdict: "REVISE",
      recommendations: [
        "Significantly expand documentation coverage",
        "Add authentication details",
        "Document rate limits",
      ],
      parseSuccess: true,
    },
    responseTimeMs: 2800,
  },
  {
    id: "uuid-4",
    messageId: "msg-456",
    stageType: "deliberation",
    stageOrder: 2,
    model: "google/gemini-2.5-pro",
    role: "juror",
    content: "## Juror Assessment\n\n### Scores\n...",
    parsedData: {
      scores: { accuracy: 8, completeness: 7, clarity: 9, relevance: 9, actionability: 7 },
      average: 8.0,
      verdict: "APPROVE",
      recommendations: [],
      parseSuccess: true,
    },
    responseTimeMs: 2500,
  },

  // Stage 3: Juror summary (aggregate row)
  {
    id: "uuid-5",
    messageId: "msg-456",
    stageType: "juror_summary",
    stageOrder: 3,
    model: null,
    role: null,
    content: '{"majorityVerdict":"APPROVE","voteTally":{"approve":2,"revise":1,"reject":0}}',
    parsedData: {
      jurorCount: 3,
      successfulJurors: 3,
      majorityVerdict: "APPROVE",
      voteTally: { approve: 2, revise: 1, reject: 0 },
      dimensionAverages: {
        accuracy: 7.7,
        completeness: 6.3,
        clarity: 8.3,
        relevance: 8.0,
        actionability: 5.7,
      },
      dimensionRanges: {
        accuracy: { min: 7, max: 8 },
        completeness: { min: 5, max: 7 },
        clarity: { min: 7, max: 9 },
        relevance: { min: 7, max: 9 },
        actionability: { min: 4, max: 7 },
      },
    },
    responseTimeMs: null,
  },

  // Stage 4: Foreman verdict
  {
    id: "uuid-6",
    messageId: "msg-456",
    stageType: "verdict",
    stageOrder: 4,
    model: "perplexity/sonar-pro",
    role: "foreman",
    content: "## Jury Verdict Report\n\n### Final Verdict: APPROVE\n...",
    parsedData: {
      finalVerdict: "APPROVE",
      dimensionAnalysis: [
        { dimension: "Accuracy", avgScore: 7.7, minScore: 7, maxScore: 8, consensus: "Strong agreement" },
        { dimension: "Completeness", avgScore: 6.3, minScore: 5, maxScore: 7, consensus: "Mixed" },
        { dimension: "Clarity", avgScore: 8.3, minScore: 7, maxScore: 9, consensus: "Strong agreement" },
        { dimension: "Relevance", avgScore: 8.0, minScore: 7, maxScore: 9, consensus: "Strong agreement" },
        { dimension: "Actionability", avgScore: 5.7, minScore: 4, maxScore: 7, consensus: "Disagreement" },
      ],
      keyStrengths: [
        "Clear and well-structured documentation format",
        "Accurate parameter descriptions",
      ],
      keyWeaknesses: [
        "Missing error response documentation",
        "No example request/response bodies",
      ],
      recommendations: [
        "Add comprehensive error response documentation",
        "Include example JSON request and response bodies",
        "Document authentication and authorization requirements",
        "Add rate limiting information",
      ],
      dissentingOpinions: [
        "Juror 2 voted REVISE, noting that the lack of error documentation is a significant gap for production use.",
      ],
    },
    responseTimeMs: 4100,
  },
]
```

### Indexes

Covered by the shared index on `deliberation_stages(message_id, stage_order)` defined in `00-shared-infrastructure.md`.

### Query Patterns

```typescript
// Load full jury result for a message
async function loadJuryResult(messageId: string): Promise<JuryResult> {
  const stages = await db
    .select()
    .from(deliberationStages)
    .where(eq(deliberationStages.messageId, messageId))
    .orderBy(deliberationStages.stageOrder);

  const presentStage = stages.find(s => s.stageType === "present");
  const deliberationStages_ = stages.filter(s => s.stageType === "deliberation");
  const summaryStage = stages.find(s => s.stageType === "juror_summary");
  const verdictStage = stages.find(s => s.stageType === "verdict");

  return {
    presentation: {
      content: presentStage!.content,
      originalQuestion: (presentStage?.parsedData as { originalQuestion?: string })?.originalQuestion,
    },
    jurors: deliberationStages_.map(s => ({
      model: s.model!,
      assessmentText: s.content,
      scores: (s.parsedData as JurorParsedData).scores,
      average: (s.parsedData as JurorParsedData).average,
      verdict: (s.parsedData as JurorParsedData).verdict,
      recommendations: (s.parsedData as JurorParsedData).recommendations,
      responseTimeMs: s.responseTimeMs!,
      parseSuccess: (s.parsedData as JurorParsedData).parseSuccess,
    })),
    jurorSummary: summaryStage?.parsedData as JurorSummary,
    foreman: {
      model: verdictStage!.model!,
      reportText: verdictStage!.content,
      finalVerdict: (verdictStage?.parsedData as ForemanParsedData).finalVerdict,
      dimensionAnalysis: (verdictStage?.parsedData as ForemanParsedData).dimensionAnalysis,
      keyStrengths: (verdictStage?.parsedData as ForemanParsedData).keyStrengths,
      keyWeaknesses: (verdictStage?.parsedData as ForemanParsedData).keyWeaknesses,
      recommendations: (verdictStage?.parsedData as ForemanParsedData).recommendations,
      dissentingOpinions: (verdictStage?.parsedData as ForemanParsedData).dissentingOpinions,
      responseTimeMs: verdictStage!.responseTimeMs!,
    },
    majorityVerdict: (summaryStage?.parsedData as JurorSummaryParsedData).majorityVerdict,
    voteTally: (summaryStage?.parsedData as JurorSummaryParsedData).voteTally,
    dimensionAverages: (summaryStage?.parsedData as JurorSummaryParsedData).dimensionAverages,
  };
}
```

### Conversation-Level Storage

```typescript
// conversations table
{ id, userId, title, mode: "jury", createdAt, updatedAt }

// messages table
{ id, conversationId, role: "user", content: contentToEvaluate }
{ id, conversationId, role: "assistant", content: foremanReportText }  // foreman's full report
```

The assistant message `content` is the foreman's full verdict report. Since Jury mode does not support multi-turn, this is purely for display consistency and conversation history.
