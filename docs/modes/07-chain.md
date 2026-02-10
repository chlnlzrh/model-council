# 07 — Chain Mode

> Sequential improvement pipeline: draft, refine, polish, harden.

**Family:** Sequential
**Status:** Specified
**Min Models:** 2
**Max Models:** 6
**Multi-turn:** No
**Stages:** 2-6 sequential steps (1 draft + 1-5 improvement mandates)

---

## A. Requirements

### Functional

1. User submits a request for content generation or improvement.
2. **Step 1 — Draft:** The first model produces a comprehensive initial draft. Prioritizes completeness and coverage over polish.
3. **Step N (2+) — Improve:** Each subsequent model receives the original query + the previous model's output + a specific improvement mandate. The model focuses exclusively on its assigned mandate while preserving existing quality.
4. **Mandates** are drawn from a predefined library: "Structure & Depth", "Accuracy & Completeness", "Polish & Format", "Security Review", "Cost Analysis". Users can also specify custom mandates.
5. Each model sees ONLY the original query + the immediately previous output + its mandate. It does NOT see the full chain history (to avoid context pollution and encourage fresh perspective on its specific mandate).
6. The final output is the last model's output. All intermediate versions are preserved for comparison.
7. A title is generated for new conversations.
8. All results are saved to the database via the `deliberation_stages` table.

### Non-Functional

- Steps are strictly sequential (Step N depends on Step N-1 output).
- Per-step timeout: 120 seconds.
- Global pipeline timeout: 600 seconds.
- Total pipeline target: under 240 seconds for 4 steps.
- Each step is a single model call.

### Model Constraints

- Minimum 2 models (1 drafter + 1 improver).
- Maximum 6 models (1 drafter + 5 improvers).
- Models CAN repeat (e.g., Model A drafts, Model B improves structure, Model A polishes).
- Each model is assigned exactly one step and one mandate.

### What Makes It Distinct

- Strictly sequential: each model builds on only the previous output, not the full chain history.
- Mandate-driven: each step has a specific improvement focus from a predefined library.
- Progressive refinement: content measurably improves across steps (word count, structural changes tracked).
- Transparent chain: all intermediate versions preserved for side-by-side comparison.
- No voting, ranking, or evaluation — purely constructive improvement.

---

## B. Pipeline Design

### Stages

| Stage | Name | Parallel? | Input | Output |
|-------|------|-----------|-------|--------|
| 1 | Draft | No | User query | `ChainStepResponse` |
| 2 | Improve (Mandate 1) | No | Query + Step 1 output + mandate | `ChainStepResponse` |
| 3 | Improve (Mandate 2) | No | Query + Step 2 output + mandate | `ChainStepResponse` |
| ... | ... | ... | ... | ... |
| N | Improve (Mandate N-1) | No | Query + Step N-1 output + mandate | `ChainStepResponse` |

### Data Flow

```
User Query
    |
    v
Step 1: queryModel(models[0], draftPrompt(userQuery))
    | ChainStepResponse { content, wordCount }
    v
Step 2: queryModel(models[1], improvePrompt(userQuery, step1Output, mandate1))
    | ChainStepResponse { content, wordCount }
    v
Step 3: queryModel(models[2], improvePrompt(userQuery, step2Output, mandate2))
    | ChainStepResponse { content, wordCount }
    v
... (up to configured steps)
    v
Final output = last step's content
    v
generateTitle() -> save to DB -> stream to client
```

### Mandate Library

| Mandate Key | Display Name | Details |
|-------------|-------------|---------|
| `draft` | Draft | Comprehensive first pass covering all aspects of the request. |
| `structure_depth` | Structure & Depth | Reorganize for logical flow, add missing sections, deepen shallow areas, improve headings and hierarchy. |
| `accuracy_completeness` | Accuracy & Completeness | Verify factual claims, fill gaps, add edge cases and caveats, ensure nothing important is omitted. |
| `polish_format` | Polish & Format | Improve readability, fix grammar and spelling, ensure consistent formatting, improve transitions between sections. |
| `security_review` | Security Review | Examine for security vulnerabilities, add security recommendations, flag risky patterns, suggest hardening measures. |
| `cost_analysis` | Cost Analysis | Add cost estimates, pricing comparisons, ROI analysis, budget considerations, and total cost of ownership. |
| `accessibility` | Accessibility | Review for accessibility concerns, add WCAG compliance notes, ensure inclusive language and design recommendations. |
| `performance` | Performance | Analyze for performance implications, add benchmarks or estimates, suggest optimizations, flag potential bottlenecks. |
| `custom` | Custom | User-provided mandate description. Passed verbatim to the improvement prompt. |

### Prompt Templates

**Draft Prompt:**

```
You are the first model in a sequential quality chain. Produce a comprehensive initial draft that subsequent models will improve.

USER REQUEST:
{{USER_INPUT}}

Produce a thorough, well-structured first draft. Prioritize completeness and coverage over polish. Subsequent models will improve structure, accuracy, and formatting.

Do not add disclaimers about being an AI or meta-commentary about the draft process. Produce the content directly.
```

**Improvement Prompt (Step N):**

```
You are step {{STEP_NUMBER}} of {{TOTAL_STEPS}} in a sequential quality chain. Your specific mandate is: **{{MANDATE_DISPLAY_NAME}}**

ORIGINAL USER REQUEST:
{{USER_INPUT}}

PREVIOUS VERSION (from step {{STEP_NUMBER - 1}}):
{{PREVIOUS_OUTPUT}}

Your mandate — {{MANDATE_DISPLAY_NAME}} — means you should focus on:
{{MANDATE_DETAILS}}

Rules:
1. Build on the previous version. Do NOT start from scratch.
2. Preserve what is already good.
3. If you add content, integrate it naturally into the existing structure.
4. If you remove content, explain in a brief editor's note at the top (prefixed with "[Editor's Note: ...]").
5. Do not add disclaimers about being an AI or meta-commentary about the chain process.

Produce the improved version now:
```

**Improvement Prompt (Step N — with skipped step note):**

```
You are step {{STEP_NUMBER}} of {{TOTAL_STEPS}} in a sequential quality chain. Your specific mandate is: **{{MANDATE_DISPLAY_NAME}}**

ORIGINAL USER REQUEST:
{{USER_INPUT}}

PREVIOUS VERSION (from step {{PREVIOUS_STEP_NUMBER}}):
{{PREVIOUS_OUTPUT}}

NOTE: Step {{SKIPPED_STEP_NUMBER}} ({{SKIPPED_MANDATE}}) was skipped due to a processing error. You may need to also address aspects of that mandate in addition to your own.

Your mandate — {{MANDATE_DISPLAY_NAME}} — means you should focus on:
{{MANDATE_DETAILS}}

Rules:
1. Build on the previous version. Do NOT start from scratch.
2. Preserve what is already good.
3. If you add content, integrate it naturally into the existing structure.
4. If you remove content, explain in a brief editor's note at the top (prefixed with "[Editor's Note: ...]").
5. Do not add disclaimers about being an AI or meta-commentary about the chain process.

Produce the improved version now:
```

---

## C. SSE Event Sequence

```
 1. chain_start           -> { conversationId, messageId, totalSteps, steps: ChainStepInfo[] }
 2. chain_step_start      -> { step: 1, model, mandate: "Draft" }
 3. chain_step_complete   -> { step: 1, data: ChainStepCompletePayload }
 4. chain_step_start      -> { step: 2, model, mandate: "Structure & Depth" }
 5. chain_step_complete   -> { step: 2, data: ChainStepCompletePayload }
 6. chain_step_start      -> { step: 3, model, mandate: "Accuracy & Completeness" }
 7. chain_step_complete   -> { step: 3, data: ChainStepCompletePayload }
 8. ... (repeat for all configured steps)
 9. title_complete        -> { data: { title: string } }        // new conversations only
10. complete              -> {}
```

On error at any point:
```
error -> { message: string }
```

Special case — middle step skipped:
```
 4. chain_step_start      -> { step: 2, model, mandate: "Structure & Depth" }
 5. chain_step_skipped    -> { step: 2, reason: "Model timeout", mandate: "Structure & Depth" }
 6. chain_step_start      -> { step: 3, model, mandate: "Accuracy & Completeness", note: "Previous step skipped" }
 7. chain_step_complete   -> { step: 3, data: ChainStepCompletePayload }
```

### TypeScript Payload Interfaces

```typescript
// chain_start
interface ChainStartPayload {
  conversationId: string;
  messageId: string;
  totalSteps: number;
  steps: ChainStepInfo[];
}

interface ChainStepInfo {
  step: number;
  model: string;
  mandate: string;       // mandate key
  mandateDisplay: string; // human-readable mandate name
}

// chain_step_start
interface ChainStepStartPayload {
  step: number;
  model: string;
  mandate: string;
  note?: string; // e.g., "Previous step skipped"
}

// chain_step_complete
interface ChainStepCompletePayload {
  step: number;
  data: {
    model: string;
    mandate: string;
    content: string;
    wordCount: number;
    previousWordCount: number;
    wordCountDelta: number;  // positive = added, negative = removed
    responseTimeMs: number;
  };
}

// chain_step_skipped
interface ChainStepSkippedPayload {
  step: number;
  reason: string;
  mandate: string;
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
interface ChainStreamRequest {
  question: string;
  mode: "chain";
  conversationId?: string;
  modeConfig?: ChainConfig;
}

interface ChainConfig {
  steps?: ChainStepConfig[];     // ordered list of steps (including draft)
  timeoutMs?: number;            // per-step timeout, default 120_000
}

interface ChainStepConfig {
  model: string;                 // model ID for this step
  mandate: string;               // mandate key from library, or "custom"
  customMandate?: string;        // required if mandate === "custom"
}
```

### Zod Validation

```typescript
const chainStepConfigSchema = z.object({
  model: z.string().min(1, "Model is required"),
  mandate: z.string().min(1, "Mandate is required"),
  customMandate: z.string().optional(),
}).refine(
  (data) => data.mandate !== "custom" || (data.customMandate && data.customMandate.length > 0),
  { message: "customMandate is required when mandate is 'custom'" }
);

const chainConfigSchema = z.object({
  steps: z.array(chainStepConfigSchema).min(2).max(6).optional(),
  timeoutMs: z.number().min(30_000).max(180_000).default(120_000),
});

const chainRequestSchema = z.object({
  question: z.string().min(1, "Request content is required"),
  mode: z.literal("chain"),
  conversationId: z.string().optional(),
  modeConfig: chainConfigSchema.optional(),
});
```

### Default Steps (when `steps` is omitted)

```typescript
const DEFAULT_CHAIN_STEPS: ChainStepConfig[] = [
  { model: "anthropic/claude-opus-4-6", mandate: "draft" },
  { model: "openai/o3", mandate: "structure_depth" },
  { model: "google/gemini-2.5-pro", mandate: "accuracy_completeness" },
  { model: "anthropic/claude-sonnet-4", mandate: "polish_format" },
];
```

### Example Requests

Full configuration:
```json
{
  "question": "Write a comprehensive guide to deploying Next.js applications on Vercel with edge functions, ISR, and middleware.",
  "mode": "chain",
  "modeConfig": {
    "steps": [
      { "model": "anthropic/claude-opus-4-6", "mandate": "draft" },
      { "model": "openai/o3", "mandate": "structure_depth" },
      { "model": "google/gemini-2.5-pro", "mandate": "accuracy_completeness" },
      { "model": "anthropic/claude-sonnet-4", "mandate": "polish_format" }
    ]
  }
}
```

With security review:
```json
{
  "question": "Design a user authentication system with OAuth2, MFA, and session management for a SaaS product.",
  "mode": "chain",
  "modeConfig": {
    "steps": [
      { "model": "anthropic/claude-opus-4-6", "mandate": "draft" },
      { "model": "openai/o3", "mandate": "structure_depth" },
      { "model": "google/gemini-2.5-pro", "mandate": "security_review" },
      { "model": "anthropic/claude-sonnet-4", "mandate": "polish_format" }
    ]
  }
}
```

With custom mandate:
```json
{
  "question": "Write a technical blog post about WebAssembly in production.",
  "mode": "chain",
  "modeConfig": {
    "steps": [
      { "model": "anthropic/claude-opus-4-6", "mandate": "draft" },
      { "model": "openai/o3", "mandate": "accuracy_completeness" },
      { "model": "google/gemini-2.5-pro", "mandate": "custom", "customMandate": "Add real-world case studies and benchmark data. Include at least 3 production examples from companies using WASM." },
      { "model": "anthropic/claude-sonnet-4", "mandate": "polish_format" }
    ]
  }
}
```

Minimal (uses defaults):
```json
{
  "question": "Explain the trade-offs between SQL and NoSQL databases for a startup.",
  "mode": "chain"
}
```

---

## E. Output Format

### Result Interface

```typescript
interface ChainResult {
  steps: ChainStepResult[];
  finalContent: string;       // last step's content
  totalSteps: number;
  completedSteps: number;     // may differ from totalSteps if steps were skipped
  skippedSteps: number[];     // step numbers that were skipped
  wordCountProgression: number[]; // [step1Count, step2Count, ...]
  title?: string;
}

interface ChainStepResult {
  step: number;
  model: string;
  mandate: string;
  mandateDisplay: string;
  content: string;
  wordCount: number;
  previousWordCount: number;
  wordCountDelta: number;
  responseTimeMs: number;
  skipped: boolean;
  skipReason?: string;
}
```

### UI Display

- **Step-by-Step Timeline:** Vertical timeline showing each step with its mandate, model name, and status (complete/skipped). Active step highlighted during streaming.
- **Content Viewer:** Two viewing modes:
  - **Final View (default):** Shows only the last step's output as the primary chat response.
  - **Chain View (expandable):** Shows all intermediate versions in a tabbed or accordion layout, one tab per step. Each tab labeled "Step N: [Mandate]" with model name and response time.
- **Diff View (optional toggle):** Side-by-side or unified diff between any two adjacent steps, highlighting additions (green), removals (red), and changes (blue).
- **Progress Metrics:** Word count progression as a small sparkline chart. Step completion badges.
- **Mandate Tags:** Each step displays its mandate as a colored badge: Draft (gray), Structure & Depth (blue), Accuracy & Completeness (green), Polish & Format (purple), Security Review (red), Cost Analysis (amber), Custom (teal).

### DB Storage

All data stored in `deliberation_stages` table:

| stageType | stageOrder | model | role | content | parsedData |
|-----------|------------|-------|------|---------|------------|
| `chain_step_1` | 1 | drafter model | `drafter` | full draft text | `ChainStepParsedData` |
| `chain_step_2` | 2 | improver model | `improver` | improved text | `ChainStepParsedData` |
| `chain_step_3` | 3 | improver model | `improver` | improved text | `ChainStepParsedData` |
| `chain_step_4` | 4 | improver model | `improver` | final polished text | `ChainStepParsedData` |

For skipped steps:

| stageType | stageOrder | model | role | content | parsedData |
|-----------|------------|-------|------|---------|------------|
| `chain_step_2` | 2 | improver model | `improver` | "" (empty) | `{ step: 2, mandate: "structure_depth", skipped: true, skipReason: "Model timeout" }` |

---

## F. Edge Cases

| Scenario | Handling |
|----------|----------|
| First model (drafter) fails | Fatal error. Emit `error` event. Pipeline cannot proceed without an initial draft. No data saved. |
| Middle model fails (Step 2-5) | Skip that step. Pass last successful output to the next step with a note: "Step N ({{mandate}}) was skipped due to a processing error. You may need to also address aspects of that mandate in addition to your own." Emit `chain_step_skipped` event. |
| Last model fails | Previous step's output becomes the final output. Emit `chain_step_skipped` for the last step. Pipeline completes with a warning. |
| Two consecutive middle models fail | Both skipped. The note to the next model lists both skipped mandates. If all models after the drafter fail, the draft is the final output. |
| Model produces identical output to input | Valid. Recorded as a step with `wordCountDelta: 0`. This means the model judged no changes needed for its mandate. Not treated as an error. |
| Model ignores mandate and rewrites everything | Not enforced server-side. The prompt instructs to build on the previous version, but the model may deviate. The output is accepted regardless. |
| Model produces empty output | Treated as a failure. Step is skipped. Previous output carries forward. |
| Per-step timeout (120s) | `AbortSignal.timeout(timeoutMs)` per step. Treated as model failure — step skipped, previous output carries forward. |
| Global pipeline timeout (600s) | Hard cap. If reached mid-step, skip all remaining steps. Last completed output is the final output. |
| Very large output from one step (> 100KB) | Accept as-is. Next model receives the full output. No truncation within the chain. |
| `steps` array has only 1 entry | Rejected by Zod validation (`.min(2)`). Need at least a drafter + one improver. |
| First step mandate is not "draft" | Allowed. The first step receives only the user query regardless of mandate. The mandate details still apply — the model just improves differently. |
| Custom mandate with empty `customMandate` | Rejected by Zod `.refine()`. Return 400 error. |
| Duplicate models in steps array | Allowed. A model can appear in multiple steps with different mandates. |
| Word count calculation | Server-side: `content.split(/\s+/).filter(Boolean).length`. Not delegated to the model. |

---

## G. Database Schema

Uses the `deliberation_stages` table exclusively (no legacy tables).

### Row Shapes

**Draft step (Step 1):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "chain_step_1",
  stageOrder: 1,
  model: "anthropic/claude-opus-4-6",
  role: "drafter",
  content: "# Deploying Next.js on Vercel\n\n## Introduction\nNext.js and Vercel form a powerful combination...\n\n## Edge Functions\n...",
  parsedData: {
    step: 1,
    mandate: "draft",
    mandateDisplay: "Draft",
    wordCount: 1200,
    previousWordCount: 0,
    wordCountDelta: 1200
  },
  responseTimeMs: 18500,
  createdAt: "2026-02-09T..."
}
```

**Improvement step (Step 2):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "chain_step_2",
  stageOrder: 2,
  model: "openai/o3",
  role: "improver",
  content: "# Deploying Next.js on Vercel: A Comprehensive Guide\n\n## Table of Contents\n1. Introduction\n2. Prerequisites\n...",
  parsedData: {
    step: 2,
    mandate: "structure_depth",
    mandateDisplay: "Structure & Depth",
    wordCount: 1450,
    previousWordCount: 1200,
    wordCountDelta: 250
  },
  responseTimeMs: 22100,
  createdAt: "2026-02-09T..."
}
```

**Improvement step (Step 3 — accuracy):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "chain_step_3",
  stageOrder: 3,
  model: "google/gemini-2.5-pro",
  role: "improver",
  content: "# Deploying Next.js on Vercel: A Comprehensive Guide\n\n## Table of Contents\n...\n\n[Editor's Note: Corrected ISR revalidation syntax for Next.js 14+ App Router. Added missing middleware matcher configuration.]\n...",
  parsedData: {
    step: 3,
    mandate: "accuracy_completeness",
    mandateDisplay: "Accuracy & Completeness",
    wordCount: 1680,
    previousWordCount: 1450,
    wordCountDelta: 230
  },
  responseTimeMs: 19800,
  createdAt: "2026-02-09T..."
}
```

**Final polish step (Step 4):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "chain_step_4",
  stageOrder: 4,
  model: "anthropic/claude-sonnet-4",
  role: "improver",
  content: "# Deploying Next.js on Vercel: A Comprehensive Guide\n\n...",
  parsedData: {
    step: 4,
    mandate: "polish_format",
    mandateDisplay: "Polish & Format",
    wordCount: 1620,
    previousWordCount: 1680,
    wordCountDelta: -60
  },
  responseTimeMs: 15300,
  createdAt: "2026-02-09T..."
}
```

**Skipped step:**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "chain_step_3",
  stageOrder: 3,
  model: "google/gemini-2.5-pro",
  role: "improver",
  content: "",
  parsedData: {
    step: 3,
    mandate: "accuracy_completeness",
    mandateDisplay: "Accuracy & Completeness",
    skipped: true,
    skipReason: "Model timeout after 120000ms",
    wordCount: 0,
    previousWordCount: 1450,
    wordCountDelta: 0
  },
  responseTimeMs: null,
  createdAt: "2026-02-09T..."
}
```

### Indexes

The shared index from `00-shared-infrastructure.md` applies:
```sql
CREATE INDEX idx_deliberation_stages_message ON deliberation_stages(message_id, stage_order);
```

### Querying Pattern

To reconstruct a complete Chain result from the database:

```typescript
async function loadChainResult(messageId: string): Promise<ChainResult> {
  const stages = await db
    .select()
    .from(deliberationStages)
    .where(eq(deliberationStages.messageId, messageId))
    .orderBy(deliberationStages.stageOrder);

  const steps: ChainStepResult[] = stages.map((stage) => ({
    step: stage.parsedData.step,
    model: stage.model!,
    mandate: stage.parsedData.mandate,
    mandateDisplay: stage.parsedData.mandateDisplay,
    content: stage.content,
    wordCount: stage.parsedData.wordCount,
    previousWordCount: stage.parsedData.previousWordCount,
    wordCountDelta: stage.parsedData.wordCountDelta,
    responseTimeMs: stage.responseTimeMs ?? 0,
    skipped: stage.parsedData.skipped ?? false,
    skipReason: stage.parsedData.skipReason,
  }));

  const completedSteps = steps.filter((s) => !s.skipped);
  const finalContent = completedSteps.length > 0
    ? completedSteps[completedSteps.length - 1].content
    : "";

  return {
    steps,
    finalContent,
    totalSteps: steps.length,
    completedSteps: completedSteps.length,
    skippedSteps: steps.filter((s) => s.skipped).map((s) => s.step),
    wordCountProgression: steps.map((s) => s.wordCount),
    title: undefined, // loaded from conversations table
  };
}
```
