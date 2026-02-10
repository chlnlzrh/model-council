# 05 — Delphi Mode

> Iterative anonymous estimation with statistical feedback until convergence.

**Family:** Evaluation
**Status:** Specified
**Min Models:** 4 (3 panelists + 1 facilitator)
**Max Models:** 8 (7 panelists + 1 facilitator)
**Multi-turn:** No
**Stages:** 2-5 rounds + synthesis

---

## A. Requirements

### Functional

1. User submits a question (numeric estimation or qualitative choice).
2. **Question Classification:** The system classifies the question as NUMERIC (expects a number/estimate) or QUALITATIVE (expects a category/recommendation). This classification is performed by the facilitator model before Round 1 begins.
3. **Round 1 — Independent Answers:** All panelist models answer the question independently. For numeric questions, each provides a number, confidence level (LOW/MEDIUM/HIGH), and reasoning. For qualitative questions, each provides a categorized answer, confidence level, and reasoning.
4. **Statistical Aggregation (server-side):** After each round, compute aggregate statistics. For numeric: mean, median, standard deviation, range, coefficient of variation (CV). For qualitative: mode, agreement percentage, category distribution.
5. **Round 2-N — Revision:** Models receive ONLY the aggregate statistics from the previous round (never individual responses) and their own previous answer. They may revise their estimate or maintain their position.
6. **Convergence Check:** After each round, check convergence criteria. Stop when CV < 0.15 (numeric) or agreement >= 75% (qualitative), or max 5 rounds reached.
7. **Synthesis:** The facilitator model produces a final Delphi Report showing the convergence trajectory, consensus value, confidence interval, and analysis of how opinions shifted.
8. A title is generated for new conversations.
9. All results are saved to the database via the `deliberation_stages` table.

### Non-Functional

- Each round completes in the time of the slowest panelist model (parallel within rounds).
- Rounds are sequential (Round N depends on Round N-1 statistics).
- Classification is a single model call (~5s).
- Synthesis is a single model call.
- Total pipeline target: under 300 seconds (5 rounds worst case).
- Statistical calculations are performed server-side in TypeScript, not by the LLM.

### Model Constraints

- Minimum 4 models total: 3 panelists + 1 facilitator.
- Maximum 8 models total: 7 panelists + 1 facilitator.
- The facilitator model handles classification and final synthesis.
- Panelist models participate in estimation rounds only.
- The facilitator does NOT participate as a panelist (to avoid bias in the synthesis).

### What Makes It Distinct

- True Delphi method: models never see individual responses, only statistical aggregates.
- Iterative convergence: opinion shifts are tracked and analyzed across rounds.
- Dual question types: different prompts, parsers, and convergence criteria for numeric vs qualitative.
- Server-side statistics engine: aggregation and convergence are computed in TypeScript, not delegated to LLMs.
- Anonymous throughout: no model names or individual answers are ever shared between panelists.

---

## B. Pipeline Design

### Stages

| Stage | Name | Parallel? | Input | Output |
|-------|------|-----------|-------|--------|
| 0 | Classify | No | User query | `DelphiClassification` |
| 1 | Round 1 | Yes | User query + type-specific prompt | `DelphiEstimate[]` |
| 1.5 | Stats 1 | Server | Round 1 estimates | `DelphiStats` |
| 2 | Round 2 | Yes | Stats + own previous answer | `DelphiEstimate[]` |
| 2.5 | Stats 2 | Server | Round 2 estimates | `DelphiStats` |
| ... | Round N | Yes | Stats + own previous answer | `DelphiEstimate[]` |
| N+1 | Synthesize | No | All round stats + convergence data | `DelphiReport` |

### Data Flow

```
User Query
    |
    v
Stage 0: queryModel(facilitator, classifyPrompt)
    | DelphiClassification { type: "numeric" | "qualitative", options?: string[] }
    v
Round 1: queryModelsParallel(panelists, round1Prompt)
    | DelphiEstimate[] (parsed from each response)
    v
Stats 1: calculateStats(estimates) — server-side TypeScript
    | DelphiStats { mean, median, stdDev, cv, ... } or QualitativeStats { distribution, agreement }
    | Check convergence → if converged, skip to synthesis
    v
Round 2: queryModelsParallel(panelists, roundNPrompt with stats)
    | DelphiEstimate[] (revised or unchanged)
    v
Stats 2: calculateStats(estimates) — server-side
    | Check convergence → if converged, skip to synthesis
    v
... (up to Round 5)
    v
Synthesis: queryModel(facilitator, synthesisPrompt with all round stats)
    | DelphiReport
    v
generateTitle() -> save to DB -> stream to client
```

### Prompt Templates

**Classification Prompt:**

```
Classify the following question for a Delphi estimation exercise.

QUESTION:
{{userQuery}}

Determine:
1. Is this a NUMERIC question (expects a number, quantity, estimate, percentage, date, or measurable value)?
2. Or is this a QUALITATIVE question (expects a category, recommendation, choice, or opinion)?

If QUALITATIVE, suggest 3-6 answer options that cover the reasonable range of responses.

Format:
TYPE: [NUMERIC|QUALITATIVE]
OPTIONS: [comma-separated options, or "N/A" if NUMERIC]
REASONING: [one sentence explaining your classification]
```

**Round 1 Prompt (Numeric):**

```
You are participating in a Delphi estimation exercise. You will provide your independent estimate for a question. In later rounds, you will see aggregate statistics from all participants (but never individual responses).

QUESTION:
{{userQuery}}

Provide:
1. Your numeric estimate
2. Your confidence level (LOW/MEDIUM/HIGH)
3. Your reasoning (2-4 sentences)

Format:
ESTIMATE: [number]
CONFIDENCE: [LOW|MEDIUM|HIGH]
REASONING: [your reasoning]
```

**Round 1 Prompt (Qualitative):**

```
You are participating in a Delphi consensus exercise. You will provide your independent assessment. In later rounds, you will see aggregate results from all participants (but never individual responses).

QUESTION:
{{userQuery}}

Choose from these options:
{{#each OPTIONS}}
{{@index + 1}}. {{this}}
{{/each}}

Provide:
1. Your answer/recommendation
2. Your confidence level (LOW/MEDIUM/HIGH)
3. Your reasoning (2-4 sentences)

Format:
ANSWER: [your answer or option number]
CONFIDENCE: [LOW|MEDIUM|HIGH]
REASONING: [your reasoning]
```

**Round N (2+) Prompt (Numeric):**

```
DELPHI ROUND {{ROUND}} of {{MAX_ROUNDS}}

QUESTION: {{userQuery}}

YOUR PREVIOUS ESTIMATE: {{yourPreviousEstimate}}
YOUR PREVIOUS CONFIDENCE: {{yourPreviousConfidence}}

AGGREGATE STATISTICS FROM ALL {{PARTICIPANT_COUNT}} PARTICIPANTS (Round {{ROUND - 1}}):
- Mean: {{mean}}
- Median: {{median}}
- Standard Deviation: {{stdDev}}
- Range: {{min}} — {{max}}
- Coefficient of Variation: {{cv}}
- Confidence Distribution: {{lowCount}} LOW, {{medCount}} MEDIUM, {{highCount}} HIGH

You may revise your estimate based on these aggregates, or maintain your position if you believe you are correct.

ESTIMATE: [number]
CONFIDENCE: [LOW|MEDIUM|HIGH]
REASONING: [why you revised or maintained — reference the aggregates]
```

**Round N (2+) Prompt (Qualitative):**

```
DELPHI ROUND {{ROUND}} of {{MAX_ROUNDS}}

QUESTION: {{userQuery}}

YOUR PREVIOUS ANSWER: {{yourPreviousAnswer}}

AGGREGATE RESULTS FROM ALL {{PARTICIPANT_COUNT}} PARTICIPANTS (Round {{ROUND - 1}}):
- Distribution:
{{#each DISTRIBUTION}}
  {{answer}}: {{count}} participants ({{percentage}}%)
{{/each}}
- Agreement Level: {{agreementPercentage}}%
- Confidence Distribution: {{lowCount}} LOW, {{medCount}} MEDIUM, {{highCount}} HIGH

You may revise your answer based on these aggregates, or maintain your position.

ANSWER: [your answer]
CONFIDENCE: [LOW|MEDIUM|HIGH]
REASONING: [why you revised or maintained — reference the distribution]
```

**Facilitator Synthesis Prompt:**

```
You are the facilitator for a Delphi exercise that ran {{TOTAL_ROUNDS}} rounds with {{PARTICIPANT_COUNT}} participants.

QUESTION: {{userQuery}}

CONVERGENCE TRAJECTORY:
{{#each ROUNDS}}
Round {{roundNumber}}:
{{#if NUMERIC}}
- Mean: {{mean}}, Median: {{median}}, StdDev: {{stdDev}}, CV: {{cv}}
- Range: {{min}} — {{max}}
{{else}}
- Distribution: {{distribution}}
- Agreement: {{agreementPct}}%
{{/if}}
- Confidence: {{lowCount}}L / {{medCount}}M / {{highCount}}H
{{/each}}

CONVERGENCE STATUS: {{CONVERGED ? "Converged" : "Max rounds reached"}}
FINAL {{NUMERIC ? "CONSENSUS VALUE" : "MAJORITY ANSWER"}}: {{FINAL_VALUE}}

Produce a Delphi Report:

## Delphi Consensus Report

### Question
{{userQuery}}

### Final Consensus
[The consensus value/answer with confidence interval if numeric]

### Convergence Analysis
[How opinions shifted across rounds. Did they converge smoothly or oscillate? Which rounds saw the biggest shifts?]

### Confidence Trajectory
[How participant confidence changed across rounds]

### Outlier Analysis
[Were there persistent outliers who never converged? What might their reasoning have been?]

### Reliability Assessment
[How reliable is this consensus? Consider: convergence speed, final CV/agreement, confidence levels, participant count]
```

### Convergence Engine (server-side TypeScript)

```typescript
interface NumericStats {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  cv: number; // coefficient of variation = stdDev / |mean|
  confidenceCounts: { low: number; medium: number; high: number };
}

interface QualitativeStats {
  distribution: Array<{ answer: string; count: number; percentage: number }>;
  agreementPercentage: number; // highest single-answer percentage
  mode: string; // most common answer
  confidenceCounts: { low: number; medium: number; high: number };
}

function calculateNumericStats(estimates: DelphiNumericEstimate[]): NumericStats {
  const values = estimates.map((e) => e.estimate);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
  const stdDev = Math.sqrt(
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  );
  return {
    mean,
    median,
    stdDev,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    cv: mean !== 0 ? stdDev / Math.abs(mean) : Infinity,
    confidenceCounts: countConfidence(estimates),
  };
}

function hasConverged(
  stats: NumericStats | QualitativeStats,
  type: "numeric" | "qualitative"
): boolean {
  if (type === "numeric") {
    return (stats as NumericStats).cv < 0.15;
  }
  return (stats as QualitativeStats).agreementPercentage >= 75;
}
```

---

## C. SSE Event Sequence

```
 1. delphi_start          -> { conversationId, messageId, questionType }
 2. classify_complete      -> { data: DelphiClassification }
 3. round_start            -> { round: 1 }
 4. round_complete         -> { round: 1, data: { estimates: DelphiEstimateSummary[], stats: NumericStats | QualitativeStats } }
 5. round_start            -> { round: 2 }
 6. round_complete         -> { round: 2, data: { estimates: DelphiEstimateSummary[], stats: NumericStats | QualitativeStats } }
 7. ... (repeat for rounds 3-5 if needed)
 8. convergence_reached    -> { round: N, stats: NumericStats | QualitativeStats }
    OR max_rounds_reached  -> { round: 5, stats: NumericStats | QualitativeStats }
 9. synthesis_start        -> {}
10. synthesis_complete     -> { data: DelphiReport }
11. title_complete         -> { data: { title: string } }        // new conversations only
12. complete               -> {}
```

On error at any point:
```
error -> { message: string }
```

### TypeScript Payload Interfaces

```typescript
// delphi_start
interface DelphiStartPayload {
  conversationId: string;
  messageId: string;
  questionType: "numeric" | "qualitative";
}

// classify_complete
interface ClassifyCompletePayload {
  data: DelphiClassification;
}

interface DelphiClassification {
  type: "numeric" | "qualitative";
  options: string[] | null; // null for numeric, string[] for qualitative
  reasoning: string;
}

// round_start
interface RoundStartPayload {
  round: number;
}

// round_complete
interface RoundCompletePayload {
  round: number;
  data: {
    estimates: DelphiEstimateSummary[];
    stats: NumericStats | QualitativeStats;
    converged: boolean;
  };
}

// DelphiEstimateSummary — anonymized for client display (no model names during rounds)
interface DelphiEstimateSummary {
  participantIndex: number; // 1-based, stable across rounds
  estimate?: number;        // numeric only
  answer?: string;          // qualitative only
  confidence: "LOW" | "MEDIUM" | "HIGH";
  changed: boolean;         // whether they revised from previous round
}

// convergence_reached / max_rounds_reached
interface ConvergencePayload {
  round: number;
  stats: NumericStats | QualitativeStats;
}

// synthesis_complete
interface SynthesisCompletePayload {
  data: DelphiReport;
}

interface DelphiReport {
  facilitatorModel: string;
  report: string;
  totalRounds: number;
  converged: boolean;
  finalValue: number | string; // consensus estimate or majority answer
  responseTimeMs: number;
}

// title_complete
interface TitleCompletePayload {
  data: { title: string };
}
```

---

## D. Input Format

### Request Body

```typescript
interface DelphiStreamRequest {
  question: string;
  mode: "delphi";
  conversationId?: string;
  modeConfig?: DelphiConfig;
}

interface DelphiConfig {
  panelistModels?: string[];         // models that participate in rounds
  facilitatorModel?: string;         // model that classifies + synthesizes
  maxRounds?: number;                // 2-5, default 5
  numericConvergenceThreshold?: number;    // CV threshold, default 0.15
  qualitativeConvergenceThreshold?: number; // agreement %, default 75
  questionType?: "numeric" | "qualitative"; // override auto-classification
  options?: string[];                 // pre-defined qualitative options
  timeoutMs?: number;                // per-round timeout, default 120_000
}
```

### Zod Validation

```typescript
const delphiConfigSchema = z.object({
  panelistModels: z.array(z.string()).min(3).max(7).optional(),
  facilitatorModel: z.string().optional(),
  maxRounds: z.number().int().min(2).max(5).default(5),
  numericConvergenceThreshold: z.number().min(0.01).max(1.0).default(0.15),
  qualitativeConvergenceThreshold: z.number().min(50).max(100).default(75),
  questionType: z.enum(["numeric", "qualitative"]).optional(),
  options: z.array(z.string()).min(2).max(10).optional(),
  timeoutMs: z.number().min(30_000).max(180_000).default(120_000),
});

const delphiRequestSchema = z.object({
  question: z.string().min(1, "Question is required"),
  mode: z.literal("delphi"),
  conversationId: z.string().optional(),
  modeConfig: delphiConfigSchema.optional(),
});
```

### Example Requests

Numeric estimation:
```json
{
  "question": "How many software engineers will be employed globally by 2030?",
  "mode": "delphi",
  "modeConfig": {
    "panelistModels": [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro",
      "perplexity/sonar-pro"
    ],
    "facilitatorModel": "anthropic/claude-sonnet-4",
    "maxRounds": 4
  }
}
```

Qualitative with auto-classification:
```json
{
  "question": "What is the best programming language for a startup MVP in 2026?",
  "mode": "delphi",
  "modeConfig": {
    "panelistModels": [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro"
    ],
    "facilitatorModel": "anthropic/claude-sonnet-4"
  }
}
```

Qualitative with predefined options:
```json
{
  "question": "Should our company adopt a monorepo or polyrepo strategy?",
  "mode": "delphi",
  "modeConfig": {
    "questionType": "qualitative",
    "options": ["Monorepo", "Polyrepo", "Hybrid (monorepo for core, polyrepo for services)"],
    "maxRounds": 3
  }
}
```

---

## E. Output Format

### Result Interface

```typescript
interface DelphiResult {
  classification: DelphiClassification;
  rounds: DelphiRound[];
  converged: boolean;
  convergenceRound: number | null; // null if never converged
  finalValue: number | string;
  report: DelphiReport;
  title?: string;
}

interface DelphiRound {
  roundNumber: number;
  estimates: DelphiEstimate[];
  stats: NumericStats | QualitativeStats;
  converged: boolean;
}

interface DelphiNumericEstimate {
  model: string;
  estimate: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  reasoning: string;
  previousEstimate: number | null;
  changed: boolean;
  responseTimeMs: number;
}

interface DelphiQualitativeEstimate {
  model: string;
  answer: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  reasoning: string;
  previousAnswer: string | null;
  changed: boolean;
  responseTimeMs: number;
}

type DelphiEstimate = DelphiNumericEstimate | DelphiQualitativeEstimate;
```

### UI Display

- **Classification Banner:** Shows whether the question was classified as NUMERIC or QUALITATIVE, with the facilitator's reasoning.
- **Round-by-Round Timeline:** Vertical timeline showing each round's aggregate statistics. For numeric: a convergence chart (line graph of mean, with std dev shaded area narrowing over rounds). For qualitative: stacked bar chart showing distribution shifting toward consensus.
- **Estimate Cards (per round):** Anonymized during the exercise. After completion, reveal which model was Participant 1, 2, etc. Show estimate/answer, confidence, and whether they changed.
- **Convergence Indicator:** Visual badge showing "Converged in Round N" (green) or "Max rounds reached" (amber).
- **Facilitator Report:** The synthesis is the primary displayed response in the chat. Full Delphi Report with sections for consensus, convergence analysis, confidence trajectory, outlier analysis, and reliability assessment.

### DB Storage

All data stored in `deliberation_stages` table:

| stageType | stageOrder | model | role | content | parsedData |
|-----------|------------|-------|------|---------|------------|
| `classify` | 0 | facilitator model | `facilitator` | raw classification text | `DelphiClassification` |
| `round_1` | 1 | panelist model A | `panelist` | raw estimate text | `DelphiEstimateParsed` |
| `round_1` | 1 | panelist model B | `panelist` | raw estimate text | `DelphiEstimateParsed` |
| `round_1` | 1 | panelist model C | `panelist` | raw estimate text | `DelphiEstimateParsed` |
| `round_1_stats` | 2 | `null` | `stats` | human-readable stats summary | `DelphiStatsParsed` |
| `round_2` | 3 | panelist model A | `panelist` | raw estimate text | `DelphiEstimateParsed` |
| `round_2` | 3 | panelist model B | `panelist` | raw estimate text | `DelphiEstimateParsed` |
| `round_2` | 3 | panelist model C | `panelist` | raw estimate text | `DelphiEstimateParsed` |
| `round_2_stats` | 4 | `null` | `stats` | human-readable stats summary | `DelphiStatsParsed` |
| `synthesis` | 99 | facilitator model | `facilitator` | full Delphi Report text | `{ totalRounds, converged, finalValue }` |

---

## F. Edge Cases

| Scenario | Handling |
|----------|----------|
| Model produces non-numeric answer for numeric question | Exclude that model's response from aggregation for that round. Need minimum 3 valid estimates to continue. If fewer than 3, emit `error` event. |
| All models give identical answers in Round 1 | Already converged (CV = 0 for numeric, agreement = 100% for qualitative). Skip directly to synthesis with a note that consensus was immediate. |
| Convergence never reached after max rounds | Facilitator synthesis notes this explicitly. Report includes "Max rounds reached" status and final best-available statistics. Pipeline completes normally. |
| A model fails in a later round (2+) | Use that model's previous round answer as unchanged. Mark `changed: false` in parsedData. Log the failure. |
| A model fails in Round 1 | Exclude it from all subsequent rounds. Need minimum 3 successful panelists to continue. |
| All models fail in Round 1 | Emit `error` event. Pipeline aborts. No data saved. |
| Very wide range (CV > 2.0) | Flag in stats as `highVariance: true`. Facilitator synthesis notes the question may be too ambiguous or models may have fundamentally different interpretations. |
| Facilitator classification fails | Fall back to QUALITATIVE type (more permissive prompts). Log the fallback. |
| Facilitator synthesis fails | Emit `error` event. Round data is still saved. Partial results available. |
| Question type override conflicts with options | If `questionType: "numeric"` but `options` are provided, ignore options and use numeric prompts. If `questionType: "qualitative"` but no options, facilitator generates options via classification. |
| Timeout per round | `AbortSignal.timeout(timeoutMs)` per round. Models that timeout are treated as failures for that round (previous answer carried forward if round 2+). |
| Global pipeline timeout | 600s hard cap. If reached mid-round, complete current round, skip remaining rounds, proceed to synthesis with available data. |
| Confidence parsing fails | Default to MEDIUM. Log parsing failure. |
| Estimate parsing fails (no ESTIMATE: line) | Attempt regex extraction of any number from the response. If no number found, exclude model for that round. |

---

## G. Database Schema

Uses the `deliberation_stages` table exclusively (no legacy tables).

### Row Shapes

**Classification row:**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "classify",
  stageOrder: 0,
  model: "anthropic/claude-sonnet-4",
  role: "facilitator",
  content: "TYPE: NUMERIC\nOPTIONS: N/A\nREASONING: The question asks for a quantity...",
  parsedData: {
    type: "numeric",
    options: null,
    reasoning: "The question asks for a quantity estimate."
  },
  responseTimeMs: 2300,
  createdAt: "2026-02-09T..."
}
```

**Panelist estimate row (numeric, Round 1):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "round_1",
  stageOrder: 1,
  model: "anthropic/claude-opus-4-6",
  role: "panelist",
  content: "ESTIMATE: 42000000\nCONFIDENCE: MEDIUM\nREASONING: Based on current growth trends...",
  parsedData: {
    round: 1,
    type: "numeric",
    estimate: 42000000,
    confidence: "MEDIUM",
    previousEstimate: null,
    changed: false,
    reasoning: "Based on current growth trends in the software industry..."
  },
  responseTimeMs: 8500,
  createdAt: "2026-02-09T..."
}
```

**Panelist estimate row (numeric, Round 2 — revised):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "round_2",
  stageOrder: 3,
  model: "anthropic/claude-opus-4-6",
  role: "panelist",
  content: "ESTIMATE: 38000000\nCONFIDENCE: HIGH\nREASONING: After seeing the median was 35M...",
  parsedData: {
    round: 2,
    type: "numeric",
    estimate: 38000000,
    confidence: "HIGH",
    previousEstimate: 42000000,
    changed: true,
    reasoning: "After seeing the median was 35M, I revised downward..."
  },
  responseTimeMs: 7200,
  createdAt: "2026-02-09T..."
}
```

**Panelist estimate row (qualitative, Round 1):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "round_1",
  stageOrder: 1,
  model: "openai/o3",
  role: "panelist",
  content: "ANSWER: TypeScript\nCONFIDENCE: HIGH\nREASONING: Type safety and ecosystem...",
  parsedData: {
    round: 1,
    type: "qualitative",
    answer: "TypeScript",
    confidence: "HIGH",
    previousAnswer: null,
    changed: false,
    reasoning: "Type safety and ecosystem maturity make it ideal..."
  },
  responseTimeMs: 6100,
  createdAt: "2026-02-09T..."
}
```

**Stats row (numeric — model is null):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "round_1_stats",
  stageOrder: 2,
  model: null,
  role: "stats",
  content: "Round 1 Statistics: Mean=39,250,000 Median=40,000,000 StdDev=5,200,000 CV=0.132 Range=33,000,000-48,000,000",
  parsedData: {
    round: 1,
    type: "stats",
    mean: 39250000,
    median: 40000000,
    stdDev: 5200000,
    cv: 0.132,
    min: 33000000,
    max: 48000000,
    converged: true,
    confidenceCounts: { low: 0, medium: 3, high: 1 },
    highVariance: false
  },
  responseTimeMs: null,
  createdAt: "2026-02-09T..."
}
```

**Stats row (qualitative — model is null):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "round_2_stats",
  stageOrder: 4,
  model: null,
  role: "stats",
  content: "Round 2 Statistics: TypeScript 75%, Python 25%. Agreement: 75%.",
  parsedData: {
    round: 2,
    type: "stats",
    distribution: [
      { answer: "TypeScript", count: 3, percentage: 75 },
      { answer: "Python", count: 1, percentage: 25 }
    ],
    agreementPercentage: 75,
    mode: "TypeScript",
    converged: true,
    confidenceCounts: { low: 0, medium: 1, high: 3 }
  },
  responseTimeMs: null,
  createdAt: "2026-02-09T..."
}
```

**Synthesis row:**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "synthesis",
  stageOrder: 99,
  model: "anthropic/claude-sonnet-4",
  role: "facilitator",
  content: "## Delphi Consensus Report\n\n### Question\nHow many software engineers...\n\n### Final Consensus\n...",
  parsedData: {
    totalRounds: 2,
    converged: true,
    convergenceRound: 2,
    finalValue: 39250000
  },
  responseTimeMs: 12400,
  createdAt: "2026-02-09T..."
}
```

### Indexes

The shared index from `00-shared-infrastructure.md` applies:
```sql
CREATE INDEX idx_deliberation_stages_message ON deliberation_stages(message_id, stage_order);
```

### Querying Pattern

To reconstruct a complete Delphi result from the database:

```typescript
async function loadDelphiResult(messageId: string): Promise<DelphiResult> {
  const stages = await db
    .select()
    .from(deliberationStages)
    .where(eq(deliberationStages.messageId, messageId))
    .orderBy(deliberationStages.stageOrder, deliberationStages.createdAt);

  const classification = stages.find((s) => s.stageType === "classify");
  const roundStages = stages.filter((s) => s.stageType.startsWith("round_") && !s.stageType.endsWith("_stats"));
  const statsStages = stages.filter((s) => s.stageType.endsWith("_stats"));
  const synthesis = stages.find((s) => s.stageType === "synthesis");

  // Group round stages by round number, pair with stats
  // Reconstruct DelphiRound[] from grouped data
  // Return full DelphiResult
}
```
