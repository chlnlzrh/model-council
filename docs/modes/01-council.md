# 01 — Council Mode (Baseline)

> Answer → Rank → Synthesize. The original deliberation mode.

**Family:** Evaluation
**Status:** Implemented (Phase 1)
**Min Models:** 2 council + 1 chairman
**Multi-turn:** Yes

---

## A. Requirements

### Functional

1. User submits a question.
2. **Stage 1 — Collect:** All council models answer the question in parallel.
3. **Stage 2 — Rank:** Responses are anonymized (Response A, B, C...). All council models rank the anonymized responses. Rankings are parsed and aggregated by average position.
4. **Stage 3 — Synthesize:** The chairman model receives all responses + all rankings and produces a synthesized answer drawing on the collective wisdom.
5. A title is generated for new conversations.
6. All results are saved to the database.

### Non-Functional

- Stage 1 completes in the time of the slowest model (parallel).
- Stage 2 completes in the time of the slowest model (parallel).
- Stage 3 is a single model call.
- Total pipeline target: under 120 seconds.

### Model Constraints

- Minimum 2 council models + 1 chairman (chairman may overlap with a council model).
- Maximum 6 council models + 1 chairman.

### What Makes It Distinct

- Anonymized evaluation prevents model-name bias.
- Aggregate ranking provides consensus quality signal.
- Synthesis draws on both the responses AND the evaluations.

---

## B. Pipeline Design

### Stages

| Stage | Name | Parallel? | Input | Output |
|-------|------|-----------|-------|--------|
| 1 | Collect | Yes | User query (+ history) | `Stage1Response[]` |
| 2 | Rank | Yes | Anonymized Stage 1 responses | `Stage2Response[]` + `Stage2Metadata` |
| 3 | Synthesize | No | All Stage 1 + Stage 2 data (+ history) | `Stage3Response` |

### Data Flow

```
User Query
    ↓
Stage 1: queryModelsParallel(councilModels, query)
    ↓ Stage1Response[]
Stage 2: createLabelMap() → buildRankingPrompt() → queryModelsParallel()
    ↓ Stage2Response[] + aggregateRankings
Stage 3: buildSynthesisPrompt() → queryModel(chairmanModel)
    ↓ Stage3Response
generateTitle() → save to DB → stream to client
```

### Prompt Templates

**Ranking Prompt** (`buildRankingPrompt`):

```
You are an expert evaluator. Below is a question and several responses from different sources. Your task is to evaluate each response and rank them from best to worst.

Question: {{userQuery}}

{{#each labeledResponses}}
--- {{label}} ---
{{response}}

{{/each}}

Instructions:
1. Evaluate each response for accuracy, completeness, clarity, and helpfulness.
2. Consider the strengths and weaknesses of each response.
3. Provide your ranking from best to worst.

CRITICAL: You MUST end your response with a section titled "FINAL RANKING:" followed by a numbered list. Each item must be ONLY the response label (e.g., "Response A"). Example:

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Do not include any other text in the FINAL RANKING section.
```

**Synthesis Prompt** (`buildSynthesisPrompt`):

```
You are a chairman synthesizing the best possible answer from multiple AI model responses and their peer evaluations.

Original Question: {{userQuery}}

STAGE 1 — Individual Responses:

{{#each stage1Results}}
--- {{model}} ---
{{response}}

{{/each}}

STAGE 2 — Peer Rankings:

{{#each stage2Results}}
--- Evaluator: {{model}} ---
{{rankingText}}

{{/each}}

Synthesize the best possible answer to the original question. Consider:
1. The individual responses and their unique insights
2. The peer rankings and which responses were consistently rated highly
3. Areas of agreement and disagreement across responses
4. Any important nuances or caveats that individual responses captured

Provide a comprehensive, well-structured synthesis that represents the collective intelligence of all the models.
```

**Title Prompt** (`buildTitlePrompt`):

```
Generate a brief title (3-5 words) for a conversation that starts with this question:

"{{userQuery}}"

Reply with ONLY the title. No quotes, no punctuation, no explanation.
```

---

## C. SSE Event Sequence

```
1. stage1_start     → { conversationId, messageId }
2. stage1_complete  → { data: Stage1Response[] }
3. stage2_start     → {}
4. stage2_complete  → { data: Stage2Response[], metadata: Stage2Metadata }
5. stage3_start     → {}
6. stage3_complete  → { data: Stage3Response }
7. title_complete   → { data: { title: string } }     // new conversations only
8. complete         → {}
```

On error at any point:
```
error → { message: string }
```

### TypeScript Payload Interfaces

```typescript
// stage1_start
interface Stage1StartPayload {
  conversationId: string;
  messageId: string;
}

// stage1_complete
interface Stage1CompletePayload {
  data: Stage1Response[];
}

// stage2_complete
interface Stage2CompletePayload {
  data: Stage2Response[];
  metadata: Stage2Metadata;
}

// stage3_complete
interface Stage3CompletePayload {
  data: Stage3Response;
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
interface CouncilStreamRequest {
  question: string;
  conversationId?: string;
  councilModels?: string[];
  chairmanModel?: string;
}
```

### Zod Validation

```typescript
const councilRequestSchema = z.object({
  question: z.string().min(1, "Question is required"),
  conversationId: z.string().optional(),
  councilModels: z.array(z.string()).min(2).optional(),
  chairmanModel: z.string().optional(),
});
```

### Example Requests

```json
{
  "question": "What are the trade-offs between microservices and monolithic architectures?",
  "councilModels": ["anthropic/claude-opus-4-6", "openai/o3", "google/gemini-2.5-pro"],
  "chairmanModel": "anthropic/claude-opus-4-6"
}
```

Follow-up:
```json
{
  "question": "How does this apply to a team of 5 developers?",
  "conversationId": "existing-conversation-id"
}
```

---

## E. Output Format

### Result Interface

```typescript
interface CouncilResult {
  stage1: Stage1Response[];
  stage2: Stage2Response[];
  stage2Metadata: Stage2Metadata;
  stage3: Stage3Response;
  title?: string;
}
```

### UI Display

- **Stage 1:** Expandable cards for each model's individual response, with model name and response time.
- **Stage 2:** Aggregate ranking table showing models sorted by average rank. Expandable section for each evaluator's full ranking text. De-anonymization reveals which label mapped to which model.
- **Stage 3:** The synthesis is the primary displayed response in the chat.

### DB Storage

| Table | Data |
|-------|------|
| `conversations` | id, userId, title, mode="council" |
| `messages` | user message + assistant message (synthesis as content) |
| `stage1_responses` | One row per model: model, response, responseTimeMs |
| `stage2_rankings` | One row per evaluator: model, rankingText, parsedRanking (JSONB) |
| `stage2_label_map` | One row per label: label ("Response A"), model |
| `stage3_synthesis` | One row: model, response, responseTimeMs |

---

## F. Edge Cases

| Scenario | Handling |
|----------|----------|
| All council models fail in Stage 1 | Emit `error` event. Pipeline aborts. |
| Some models fail in Stage 1 | Continue with successful responses. Fewer responses to rank in Stage 2. Minimum 2 responses required. |
| Ranking parsing fails | `parseRanking()` has 4 fallback levels. If all fail, returns empty array. That evaluator is excluded from aggregation. |
| All rankings parse as empty | Stage 2 metadata has empty `aggregateRankings`. Synthesis proceeds without ranking data. |
| Chairman model fails in Stage 3 | Emit `error` event. Stage 1 and Stage 2 data are still saved. |
| Timeout | Per-stage 120s timeout via `AbortSignal.timeout()`. Global 600s not enforced (stages are sequential). |
| Multi-turn history too large | History is truncated to the last 10 turns. |

---

## G. Database Schema

Uses existing tables (no migration needed):

```typescript
// stage1_responses
{ id, messageId, model, response, responseTimeMs }

// stage2_rankings
{ id, messageId, model, rankingText, parsedRanking: RankingEntry[] }

// stage2_label_map
{ id, messageId, label, model }  // unique(messageId, label)

// stage3_synthesis
{ id, messageId, model, response, responseTimeMs }
```

No `deliberation_stages` table usage — Council mode retains its original schema for backward compatibility.
