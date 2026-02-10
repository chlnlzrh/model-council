# 12 — Confidence-Weighted Mode

> Answer with self-assessed confidence. Weighted synthesis favors higher-confidence responses.

**Family:** Algorithmic
**Status:** Specified
**Min Models:** 2
**Max Models:** 6
**Multi-turn:** Yes

---

## A. Requirements

### Functional

1. User submits a question.
2. **Stage 1 — Answer + Confidence:** All models answer the question in parallel. Each model provides: a detailed response, a self-assessed confidence score (0.0-1.0), and a brief explanation of what drives their confidence level.
3. **Stage 2 — Weight Calculation:** Server-side computation (no LLM call). Parse confidence scores from each response. Apply softmax with a configurable temperature parameter. Compute normalized weights. Flag outliers where confidence exceeds 0.95 or falls below 0.1.
4. **Stage 3 — Weighted Synthesis:** A synthesis model receives all responses ordered by weight (highest first) along with their normalized weights. The synthesis model produces a weighted synthesis that proportionally favors higher-weight responses, plus calibration notes assessing whether models' confidence matched their answer quality.
5. A title is generated for new conversations.
6. All results are saved to the database via the `deliberation_stages` table.

### Non-Functional

- Stage 1 completes in the time of the slowest model (parallel).
- Stage 2 is instantaneous server-side math (sub-millisecond).
- Stage 3 is a single model call.
- Total pipeline target: under 90 seconds.
- Weight calculation is performed server-side in TypeScript, not delegated to the LLM.

### Model Constraints

- Minimum 2 models (all models both answer and are weighted).
- Maximum 6 models.
- Any model in the list can also serve as the synthesis model.
- No separate "judge" or "chairman" role — the synthesis model is specified independently and may overlap with the respondent list.

### What Makes It Distinct

- Self-calibration: models explicitly reason about their own uncertainty.
- Weighted synthesis: high-confidence answers get proportionally more influence, governed by softmax temperature.
- Temperature control: the user can tune how much confidence differences matter (low temperature = winner-take-all; high temperature = more equal weighting).
- Calibration analysis: the synthesis detects whether models were appropriately, over-, or under-confident.
- Multi-turn support: conversation history is included in follow-up prompts.

---

## B. Pipeline Design

### Stages

| Stage | Name | Parallel? | Input | Output |
|-------|------|-----------|-------|--------|
| 1 | Answer + Confidence | Yes | User query (+ history) | `ConfidenceAnswer[]` |
| 2 | Weight Calculation | Server | Parsed confidences | `ConfidenceWeight[]` |
| 3 | Weighted Synthesis | No | Weighted responses | `WeightedSynthesis` |

### Data Flow

```
User Query (+ conversation history if multi-turn)
    |
    v
Stage 1: queryModelsParallel(models, answerConfidencePrompt)
    | ConfidenceAnswer[] — each has response + confidence + reasoning
    v
Stage 2: parseConfidences() -> computeWeights(confidences, temperature)
    | ConfidenceWeight[] — softmax-normalized weights
    | Flag outliers (confidence > 0.95 or < 0.1)
    v
Stage 3: queryModel(synthesisModel, weightedSynthesisPrompt)
    | WeightedSynthesis — synthesis + calibration notes
    v
generateTitle() -> save to DB -> stream to client
```

### Prompt Templates

**Answer + Confidence Prompt** (`buildAnswerConfidencePrompt`):

```
Answer the following question. After your response, assess your confidence in your answer on a scale from 0.0 (no confidence, pure guess) to 1.0 (absolute certainty, verified fact).

QUESTION:
{{userQuery}}

{{#if HISTORY}}
CONVERSATION CONTEXT:
{{#each HISTORY}}
{{role}}: {{content}}
{{/each}}
{{/if}}

Provide your response, then your confidence assessment:

RESPONSE:
[your detailed answer]

CONFIDENCE: [0.0-1.0]
CONFIDENCE_REASONING: [1-2 sentences explaining why you are this confident — what do you know for certain vs. what are you uncertain about?]
```

**Weighted Synthesis Prompt** (`buildWeightedSynthesisPrompt`):

```
You are synthesizing multiple model responses, weighted by each model's self-assessed confidence.

QUESTION:
{{userQuery}}

{{#if HISTORY}}
CONVERSATION CONTEXT:
{{#each HISTORY}}
{{role}}: {{content}}
{{/each}}
{{/if}}

RESPONSES (ordered by weight, highest first):

{{#each WEIGHTED_RESPONSES}}
--- {{MODEL}} (Weight: {{WEIGHT_PERCENT}}%, Confidence: {{RAW_CONFIDENCE}}) ---
{{#if IS_OUTLIER}}⚠️ OUTLIER CONFIDENCE — treat with appropriate skepticism{{/if}}
{{RESPONSE}}

{{/each}}

WEIGHT DISTRIBUTION:
{{#each WEIGHTS}}
- {{MODEL}}: {{WEIGHT_PERCENT}}% (raw confidence: {{RAW_CONFIDENCE}})
{{/each}}

Instructions:
1. Give proportionally MORE consideration to higher-weighted responses.
2. A response with 40% weight should influence roughly 2x as much as one with 20% weight.
3. However, do NOT blindly trust high-confidence responses — a model can be confidently wrong.
4. If high-confidence and low-confidence responses CONTRADICT each other, note the disagreement and reason about which is more likely correct.
5. Flag any responses where the confidence seems miscalibrated (overconfident or underconfident based on content quality).

SYNTHESIS:
[Your weighted synthesis]

CONFIDENCE CALIBRATION NOTES:
[Any observations about how well models calibrated their confidence]
```

**Title Prompt** (`buildTitlePrompt`):

```
Generate a brief title (3-5 words) for a conversation that starts with this question:

"{{userQuery}}"

Reply with ONLY the title. No quotes, no punctuation, no explanation.
```

### Confidence Parser

```typescript
function parseConfidence(text: string): {
  response: string;
  confidence: number;
  confidenceReasoning: string;
  parsedSuccessfully: boolean;
} {
  // Extract CONFIDENCE: line
  const confMatch = text.match(/CONFIDENCE:\s*(0?\.\d+|1\.0|1|0)\b/i);
  const confidence = confMatch ? parseFloat(confMatch[1]) : 0.5;
  const clamped = Math.max(0.0, Math.min(1.0, confidence));

  // Extract CONFIDENCE_REASONING: line
  const reasonMatch = text.match(/CONFIDENCE_REASONING:\s*(.+?)(?=\n|$)/si);
  const confidenceReasoning = reasonMatch ? reasonMatch[1].trim() : "";

  // Extract RESPONSE: content (between RESPONSE: and CONFIDENCE:)
  const responseMatch = text.match(/RESPONSE:\s*([\s\S]+?)(?=\nCONFIDENCE:)/i);
  const response = responseMatch ? responseMatch[1].trim() : text.split(/CONFIDENCE:/i)[0].trim();

  return {
    response,
    confidence: clamped,
    confidenceReasoning,
    parsedSuccessfully: confMatch !== null,
  };
}
```

### Weight Calculation (server-side TypeScript)

```typescript
interface ConfidenceWeight {
  model: string;
  rawConfidence: number;
  normalizedWeight: number;    // after softmax, sums to 1.0
  weightPercent: number;       // normalizedWeight * 100, for display
  isOutlier: boolean;          // confidence > 0.95 or < 0.1
}

function computeWeights(
  confidences: Map<string, number>,
  temperature: number = 1.0
): ConfidenceWeight[] {
  const entries = Array.from(confidences.entries());

  // Guard: if temperature is effectively zero, uniform weights
  if (temperature < 0.001) {
    const uniform = 1.0 / entries.length;
    return entries.map(([model, conf]) => ({
      model,
      rawConfidence: conf,
      normalizedWeight: uniform,
      weightPercent: Math.round(uniform * 10000) / 100,
      isOutlier: conf > 0.95 || conf < 0.1,
    }));
  }

  // Softmax: weight_i = exp(conf_i / temp) / sum(exp(conf_j / temp))
  const exps = entries.map(([, c]) => Math.exp(c / temperature));
  const sumExp = exps.reduce((a, b) => a + b, 0);

  return entries.map(([model, conf], i) => ({
    model,
    rawConfidence: conf,
    normalizedWeight: exps[i] / sumExp,
    weightPercent: Math.round((exps[i] / sumExp) * 10000) / 100,
    isOutlier: conf > 0.95 || conf < 0.1,
  }));
}
```

**Temperature behavior:**
- `temperature = 0.1`: Extreme winner-take-all. The highest-confidence model dominates almost entirely.
- `temperature = 1.0`: Default. Moderate differentiation. A 0.9-confidence model gets noticeably more weight than a 0.5-confidence model.
- `temperature = 5.0`: Near-uniform. Confidence differences barely matter.

---

## C. SSE Event Sequence

```
 1. confidence_start        -> { conversationId, messageId, config }
 2. answers_start           -> {}
 3. answer_complete         -> { model, response (truncated), confidence, confidenceReasoning, responseTimeMs }
    ... (one per model, emitted as each finishes)
 4. all_answers_complete    -> { count, failedCount }
 5. weights_calculated      -> { weights: ConfidenceWeight[], temperature }
 6. synthesis_start         -> {}
 7. synthesis_complete      -> { model, synthesis (truncated preview), calibrationNotes, responseTimeMs }
 8. title_complete          -> { data: { title: string } }     // new conversations only
 9. complete                -> {}
```

On error at any point:
```
error -> { message: string }
```

### TypeScript Payload Interfaces

```typescript
// confidence_start
interface ConfidenceStartPayload {
  conversationId: string;
  messageId: string;
  config: {
    models: string[];
    synthesisModel: string;
    temperature: number;
  };
}

// answer_complete (emitted per model as it finishes)
interface AnswerCompletePayload {
  model: string;
  response: string;          // may be truncated for SSE; full text in DB
  confidence: number;
  confidenceReasoning: string;
  parsedSuccessfully: boolean;
  responseTimeMs: number;
}

// all_answers_complete
interface AllAnswersCompletePayload {
  count: number;
  failedCount: number;
}

// weights_calculated
interface WeightsCalculatedPayload {
  weights: ConfidenceWeight[];
  temperature: number;
  outlierCount: number;
}

// synthesis_complete
interface SynthesisCompletePayload {
  model: string;
  synthesis: string;          // may be truncated for SSE
  calibrationNotes: string;
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
interface ConfidenceStreamRequest {
  question: string;
  mode: "confidence_weighted";
  conversationId?: string;
  modeConfig?: ConfidenceConfig;
}

interface ConfidenceConfig {
  models?: string[];           // models that answer + provide confidence
  synthesisModel?: string;     // model that performs weighted synthesis
  temperature?: number;        // softmax temperature (0.1-5.0, default 1.0)
  timeoutMs?: number;          // per-model timeout
}
```

### Zod Validation

```typescript
const confidenceConfigSchema = z.object({
  models: z.array(z.string())
    .min(2, "Confidence-weighted mode requires at least 2 models")
    .max(6, "Maximum 6 models allowed")
    .optional(),
  synthesisModel: z.string().optional(),
  temperature: z.number().min(0.1).max(5.0).default(1.0),
  timeoutMs: z.number().min(10_000).max(300_000).default(120_000),
});

const confidenceRequestSchema = z.object({
  question: z.string().min(1, "Question is required"),
  mode: z.literal("confidence_weighted"),
  conversationId: z.string().optional(),
  modeConfig: confidenceConfigSchema.optional(),
});
```

### Default Configuration

```typescript
const DEFAULT_CONFIDENCE_CONFIG: Required<ConfidenceConfig> = {
  models: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
  ],
  synthesisModel: "anthropic/claude-opus-4-6",
  temperature: 1.0,
  timeoutMs: 120_000,
};
```

### Example Requests

New conversation:
```json
{
  "question": "What is the half-life of caffeine in the human body?",
  "mode": "confidence_weighted",
  "modeConfig": {
    "models": [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro",
      "perplexity/sonar-pro"
    ],
    "synthesisModel": "anthropic/claude-opus-4-6",
    "temperature": 1.0
  }
}
```

High-temperature (near-equal weighting):
```json
{
  "question": "What will the S&P 500 close at on December 31, 2026?",
  "mode": "confidence_weighted",
  "modeConfig": {
    "models": [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro"
    ],
    "temperature": 3.0
  }
}
```

Follow-up (multi-turn):
```json
{
  "question": "How does this change for people who drink coffee daily?",
  "mode": "confidence_weighted",
  "conversationId": "existing-conversation-id"
}
```

---

## E. Output Format

### Result Interface

```typescript
interface ConfidenceWeightedResult {
  answers: ConfidenceAnswer[];
  weights: ConfidenceWeight[];
  temperature: number;
  synthesis: WeightedSynthesis;
  title?: string;
}

interface ConfidenceAnswer {
  model: string;
  response: string;
  rawConfidence: number;
  confidenceReasoning: string;
  parsedSuccessfully: boolean;
  responseTimeMs: number;
}

interface WeightedSynthesis {
  model: string;
  response: string;
  calibrationNotes: string;
  responseTimeMs: number;
}
```

### UI Display

- **Confidence Bar Chart:** Horizontal bar chart showing each model's raw confidence score (0.0-1.0) color-coded: green (0.6-0.85 well-calibrated zone), amber (< 0.3 or > 0.85), red outliers (< 0.1 or > 0.95). Overlaid with normalized weight percentages.
- **Response Cards:** Cards for each model's response, sized or bordered proportionally to their normalized weight. Higher-weight cards are visually larger or have thicker borders. Each card shows: model name, confidence score, weight percentage, confidence reasoning, and the full response.
- **Weight Distribution Pie Chart:** Optional pie chart showing normalized weight distribution across models.
- **Synthesis:** The weighted synthesis is the primary displayed response in the chat. The calibration notes section is shown below in a collapsible panel.
- **Temperature Slider (settings):** If the UI includes a configuration panel, a slider for temperature with labels: "Winner-take-all (0.1)" to "Equal weight (5.0)".

### DB Storage

All data stored in `deliberation_stages` table:

| `stageType` | `stageOrder` | `model` | `role` | `content` | `parsedData` |
|-------------|:------------:|---------|--------|-----------|--------------|
| `"answer_0"` | 0 | model A | `"respondent"` | Full response text (including CONFIDENCE lines) | `AnswerParsedData` |
| `"answer_1"` | 0 | model B | `"respondent"` | Full response text | `AnswerParsedData` |
| `"answer_2"` | 0 | model C | `"respondent"` | Full response text | `AnswerParsedData` |
| ... | 0 | ... | ... | ... | ... |
| `"weights"` | 1 | `null` | `null` | Human-readable weight summary | `WeightsParsedData` |
| `"synthesis"` | 2 | synthesis model | `"synthesizer"` | Full synthesis + calibration notes | `SynthesisParsedData` |

### parsedData JSONB Examples

**Answer stage (`stageType: "answer_0"`):**
```json
{
  "confidence": 0.82,
  "confidenceReasoning": "I am fairly certain about the core pharmacokinetics but less sure about individual variation factors.",
  "parsedSuccessfully": true,
  "responsePreview": "The half-life of caffeine in the human body is approximately 5-6 hours..."
}
```

**Answer stage with parse failure (`stageType: "answer_2"`):**
```json
{
  "confidence": 0.5,
  "confidenceReasoning": "",
  "parsedSuccessfully": false,
  "parseFailureNote": "No CONFIDENCE: line found in response. Defaulted to 0.5."
}
```

**Weights stage (`stageType: "weights"`):**
```json
{
  "type": "weights",
  "temperature": 1.0,
  "weights": [
    {
      "model": "anthropic/claude-opus-4-6",
      "rawConfidence": 0.82,
      "normalizedWeight": 0.35,
      "weightPercent": 35.0,
      "isOutlier": false
    },
    {
      "model": "openai/o3",
      "rawConfidence": 0.91,
      "normalizedWeight": 0.42,
      "weightPercent": 42.0,
      "isOutlier": false
    },
    {
      "model": "google/gemini-2.5-pro",
      "rawConfidence": 0.45,
      "normalizedWeight": 0.23,
      "weightPercent": 23.0,
      "isOutlier": false
    }
  ],
  "outlierCount": 0
}
```

**Weights with outliers:**
```json
{
  "type": "weights",
  "temperature": 1.0,
  "weights": [
    {
      "model": "openai/o3",
      "rawConfidence": 0.98,
      "normalizedWeight": 0.55,
      "weightPercent": 55.0,
      "isOutlier": true
    },
    {
      "model": "anthropic/claude-opus-4-6",
      "rawConfidence": 0.72,
      "normalizedWeight": 0.30,
      "weightPercent": 30.0,
      "isOutlier": false
    },
    {
      "model": "google/gemini-2.5-pro",
      "rawConfidence": 0.08,
      "normalizedWeight": 0.15,
      "weightPercent": 15.0,
      "isOutlier": true
    }
  ],
  "outlierCount": 2
}
```

**Synthesis stage (`stageType: "synthesis"`):**
```json
{
  "synthesisPreview": "Based on the weighted responses, the half-life of caffeine...",
  "calibrationNotes": "Model openai/o3 reported 0.98 confidence, which appears well-calibrated given its detailed pharmacokinetic citations. Model google/gemini-2.5-pro reported 0.08, which seems underconfident — its answer was largely accurate despite the low self-assessment.",
  "totalModels": 3,
  "highestWeight": { "model": "openai/o3", "weightPercent": 42.0 },
  "lowestWeight": { "model": "google/gemini-2.5-pro", "weightPercent": 23.0 }
}
```

---

## F. Edge Cases

| Scenario | Handling |
|----------|----------|
| All models fail in Stage 1 | Emit `error` event. Pipeline aborts. No data saved. |
| Some models fail in Stage 1 | Continue with successful responses. Minimum 1 successful response required. If only 1 succeeds, skip synthesis — output that model's response directly as the answer. |
| Only 1 model succeeds | That model's response is the output. No synthesis needed. Weight is 100%. Emit `answer_complete`, `all_answers_complete`, `weights_calculated` (trivial), then output the single response as final answer. |
| Confidence parse fails for a model | Default confidence to 0.5 (neutral). Set `parsedSuccessfully: false` in parsedData. Log the failure. |
| All confidences parse as 0.5 (default) | Softmax with identical inputs produces uniform weights. Synthesis treats all responses equally. |
| All models give the same confidence | Softmax produces uniform weights. Synthesis model receives equal weights. This is a valid outcome. |
| One model gives 1.0, others give 0.1 | That model dominates (especially at low temperature). The synthesis model is instructed to still critically evaluate, not blindly trust. |
| One model gives 0.0 confidence | Clamped to 0.0. After softmax, gets very low weight. Synthesis model sees the low weight and may note the response. |
| Temperature = 0.1 (extreme) | Winner-take-all: highest-confidence model gets nearly all weight. Valid configuration. |
| Temperature = 5.0 (extreme) | Near-uniform: all models get roughly equal weight regardless of confidence. Valid configuration. |
| Model response is clearly wrong but high confidence | Synthesis model is explicitly instructed to detect miscalibration. Calibration notes should flag this. |
| Model response is correct but low confidence | Synthesis model should note the underconfidence in calibration notes. |
| Synthesis model fails | Emit `error` event. Stage 1 answers and weights are still saved. Partial results available. |
| Multi-turn history too large | History truncated to last 10 turns. |
| Conversation mode mismatch | If `conversationId` references a conversation with `mode != "confidence_weighted"`, return 400 error. |
| Timeout (Stage 1) | Per-model timeout via `AbortSignal.timeout(timeoutMs)`. Failed models excluded. |
| Timeout (Stage 3) | Synthesis timeout. Emit `error`. Stage 1 + weights saved. |
| Confidence value out of range (e.g., 1.5, -0.3) | Clamp to [0.0, 1.0]. Log the clamping. |
| Model outputs confidence as percentage (e.g., "82%") | Extended parser: `CONFIDENCE:\s*(0?\.\d+|1\.0|1|0|(\d{1,3})%?)` — if value > 1.0 and <= 100, divide by 100. |

---

## G. Database Schema

Uses the `deliberation_stages` table exclusively (no legacy tables).

### Row Shapes

**Answer row (one per model):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "answer_0",
  stageOrder: 0,
  model: "anthropic/claude-opus-4-6",
  role: "respondent",
  content: "RESPONSE:\nThe half-life of caffeine in the human body is approximately 5-6 hours for most healthy adults...\n\nCONFIDENCE: 0.82\nCONFIDENCE_REASONING: I am fairly certain about the core pharmacokinetics but less sure about individual variation factors.",
  parsedData: {
    confidence: 0.82,
    confidenceReasoning: "I am fairly certain about the core pharmacokinetics but less sure about individual variation factors.",
    parsedSuccessfully: true,
    responsePreview: "The half-life of caffeine in the human body is approximately 5-6 hours..."
  },
  responseTimeMs: 4200,
  createdAt: "2026-02-09T..."
}
```

**Answer row with parse failure:**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "answer_2",
  stageOrder: 0,
  model: "google/gemini-2.5-pro",
  role: "respondent",
  content: "Caffeine has a half-life of about 5 hours on average, though this varies widely...",
  parsedData: {
    confidence: 0.5,
    confidenceReasoning: "",
    parsedSuccessfully: false,
    parseFailureNote: "No CONFIDENCE: line found in response. Defaulted to 0.5."
  },
  responseTimeMs: 3100,
  createdAt: "2026-02-09T..."
}
```

**Weights row (model is null):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "weights",
  stageOrder: 1,
  model: null,
  role: null,
  content: "Weight Distribution (temperature=1.0): anthropic/claude-opus-4-6: 35.0% (conf 0.82), openai/o3: 42.0% (conf 0.91), google/gemini-2.5-pro: 23.0% (conf 0.50 default). Outliers: 0.",
  parsedData: {
    type: "weights",
    temperature: 1.0,
    weights: [
      { model: "anthropic/claude-opus-4-6", rawConfidence: 0.82, normalizedWeight: 0.35, weightPercent: 35.0, isOutlier: false },
      { model: "openai/o3", rawConfidence: 0.91, normalizedWeight: 0.42, weightPercent: 42.0, isOutlier: false },
      { model: "google/gemini-2.5-pro", rawConfidence: 0.50, normalizedWeight: 0.23, weightPercent: 23.0, isOutlier: false }
    ],
    outlierCount: 0
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
  stageOrder: 2,
  model: "anthropic/claude-opus-4-6",
  role: "synthesizer",
  content: "SYNTHESIS:\nBased on the weighted responses, the half-life of caffeine in the human body is approximately 5-6 hours for healthy adults. This is well-established in pharmacological literature...\n\nCONFIDENCE CALIBRATION NOTES:\nAll three models showed reasonable calibration. openai/o3 (0.91 confidence) provided the most detailed pharmacokinetic references, justifying its high confidence. google/gemini-2.5-pro defaulted to 0.50 due to parse failure, but its response quality was comparable to the others, suggesting it would have reported moderate-to-high confidence if parsed correctly.",
  parsedData: {
    synthesisPreview: "Based on the weighted responses, the half-life of caffeine...",
    calibrationNotes: "All three models showed reasonable calibration...",
    totalModels: 3,
    highestWeight: { model: "openai/o3", weightPercent: 42.0 },
    lowestWeight: { model: "google/gemini-2.5-pro", weightPercent: 23.0 }
  },
  responseTimeMs: 6800,
  createdAt: "2026-02-09T..."
}
```

### Indexes

The shared index from `00-shared-infrastructure.md` applies:
```sql
CREATE INDEX idx_deliberation_stages_message ON deliberation_stages(message_id, stage_order);
```

### Querying Pattern

```typescript
async function loadConfidenceWeightedResult(messageId: string): Promise<ConfidenceWeightedResult> {
  const stages = await db
    .select()
    .from(deliberationStages)
    .where(eq(deliberationStages.messageId, messageId))
    .orderBy(deliberationStages.stageOrder, deliberationStages.createdAt);

  const answerStages = stages.filter((s) => s.stageType.startsWith("answer_"));
  const weightsStage = stages.find((s) => s.stageType === "weights");
  const synthesisStage = stages.find((s) => s.stageType === "synthesis");

  return {
    answers: answerStages.map((s) => ({
      model: s.model!,
      response: s.content,
      rawConfidence: (s.parsedData as AnswerParsedData).confidence,
      confidenceReasoning: (s.parsedData as AnswerParsedData).confidenceReasoning,
      parsedSuccessfully: (s.parsedData as AnswerParsedData).parsedSuccessfully,
      responseTimeMs: s.responseTimeMs!,
    })),
    weights: (weightsStage?.parsedData as WeightsParsedData).weights,
    temperature: (weightsStage?.parsedData as WeightsParsedData).temperature,
    synthesis: {
      model: synthesisStage!.model!,
      response: synthesisStage!.content,
      calibrationNotes: (synthesisStage?.parsedData as SynthesisParsedData).calibrationNotes,
      responseTimeMs: synthesisStage!.responseTimeMs!,
    },
  };
}
```

### Conversation-Level Storage

```typescript
// conversations table
{ id, userId, title, mode: "confidence_weighted", createdAt, updatedAt }

// messages table
{ id, conversationId, role: "user", content: userQuestion }
{ id, conversationId, role: "assistant", content: synthesisResponse }  // synthesis text
```

The assistant message `content` is the synthesis response (excluding calibration notes), ensuring multi-turn follow-ups use the synthesized answer as context.
