# 04 — Debate Mode

> Answer → Revise → Vote → Declare Winner. Multi-round deliberation with peer influence.

**Family:** Evaluation
**Status:** Specified (Pre-Implementation)
**Min Models:** 3
**Multi-turn:** No
**Stages:** 3-4

---

## A. Requirements

### Functional

1. User submits a question.
2. **Stage 1 — Initial Answers:** All models answer the question in parallel (identical to Council Stage 1).
3. **Stage 2 — Revision:** All Stage 1 responses are anonymized using a label map. For EACH model, a unique revision prompt is constructed containing that model's own original response plus all other anonymized responses. Each model can REVISE its answer, STAND by its original, or MERGE the best elements from all responses. All revision queries run in parallel (each with a different prompt).
4. **Stage 3 — Vote:** Revised responses are re-anonymized with a NEW label map (since responses have changed). All models vote for the single best revised response using the same voting mechanism as Vote mode.
5. **Stage 4 — Declare Winner:** If a plurality winner exists, that model's REVISED response is output. If there is a tie, the first tied response alphabetically by label is chosen (no chairman tiebreaker in Debate mode to maintain peer-only dynamics).
6. A title is generated for the conversation.
7. All results are saved to the database.

### Non-Functional

- Stage 1 completes in the time of the slowest model (parallel).
- Stage 2 completes in the time of the slowest model (parallel, unique prompts).
- Stage 3 completes in the time of the slowest model (parallel).
- Stage 4 is instantaneous (computation only, no model call).
- Total pipeline target: under 180 seconds (three parallel rounds).

### Model Constraints

- Minimum 3 models (all participate in every stage).
- Maximum 6 models.
- No special roles (no chairman, no foreman). All models are equal peers.
- Every model that succeeds in Stage 1 participates in Stage 2 and Stage 3.

### What Makes It Distinct

- **Peer influence:** Models see each other's responses and can change their minds. This is the only mode where models are explicitly shown other models' work and asked to reconsider.
- **Three decisions tracked:** Each model makes a REVISE / STAND / MERGE decision, revealing how persuasive the other responses were.
- **Democratic outcome:** The final answer is selected by vote on the revised responses.
- **No authority figure:** Unlike Council (chairman synthesis) or Vote (chairman tiebreaker), Debate has no special role. All models are equal.
- **Evolution visible:** The UI shows how each response evolved from Round 1 to Round 2.

---

## B. Pipeline Design

### Stages

| Stage | Name | Parallel? | Input | Output |
|-------|------|-----------|-------|--------|
| 1 | Initial Answers | Yes | User query | `Stage1Response[]` |
| 2 | Revision | Yes (unique prompts) | Own response + anonymized others | `RevisionResponse[]` |
| 3 | Vote | Yes | Anonymized revised responses | `VoteResponse[]` |
| 4 | Declare Winner | No (computation) | Vote tallies | `DebateWinnerResult` |

### Data Flow

```
User Query
    |
Stage 1: queryModelsParallel(allModels, query)
    | Stage1Response[]
    |
Stage 2: createLabelMap(round1) -> for EACH model:
    |     buildRevisionPrompt(model, ownResponse, otherAnonymizedResponses)
    |   queryModelsParallel(allModels, uniquePrompts[])  // parallel, different prompts
    | RevisionResponse[] (each with decision: REVISE|STAND|MERGE)
    |
Stage 3: createLabelMap(round2) -> buildVoteOnRevisedPrompt(revisedResponses)
    |   queryModelsParallel(allModels, votePrompt)
    | VoteResponse[] -> tallyVotes()
    |
Stage 4: Determine winner
    |   +--[plurality winner?]--> output winner's revised response
    |   +--[tie?]--> pick first alphabetically by label
    |
generateTitle() -> save to DB -> stream to client
```

### Prompt Templates

**Revision Prompt** (`buildRevisionPrompt` — unique per model):

```
You previously answered a question. Now you will see how other respondents answered the same question (anonymously). You may revise your response or stand by your original if you believe it was superior.

ORIGINAL QUESTION:
{{userQuery}}

YOUR ORIGINAL RESPONSE:
{{yourOriginalResponse}}

OTHER RESPONSES:
{{#each otherResponses}}
--- {{label}} ---
{{response}}

{{/each}}

Instructions:
1. Carefully consider the other responses. What insights do they offer that yours missed?
2. Identify any errors or omissions in your original response.
3. You have three options:
   a) REVISE: Produce an improved response incorporating insights from others
   b) STAND: Keep your original response unchanged (explain why)
   c) MERGE: Substantially rewrite by combining the best elements of all responses

State your choice, then provide the response:

DECISION: [REVISE|STAND|MERGE]
REASONING: [1-2 sentences on why]

REVISED RESPONSE:
[Your final response — if STAND, repeat your original]
```

**Vote-on-Revised Prompt** (`buildVoteOnRevisedPrompt`):

```
After a round of deliberation, all respondents have finalized their answers. Vote for the single best response.

Question: {{userQuery}}

{{#each revisedLabeledResponses}}
--- {{label}} ---
{{response}}

{{/each}}

Consider: accuracy, completeness, clarity, helpfulness, and practical value.

You MUST end your response with your vote in this exact format:
VOTE: Response X

where X is the letter of your chosen response. You may provide brief reasoning before the vote, but the last line MUST be your vote.
```

**Title Prompt** (`buildTitlePrompt`):

```
Generate a brief title (3-5 words) for a conversation that starts with this question:

"{{userQuery}}"

Reply with ONLY the title. No quotes, no punctuation, no explanation.
```

### Revision Parser

```typescript
interface ParsedRevision {
  decision: "REVISE" | "STAND" | "MERGE" | null;
  reasoning: string | null;
  revisedResponse: string | null;
}

function parseRevision(text: string): ParsedRevision {
  // Extract decision
  const decisionMatch = text.match(/DECISION:\s*(REVISE|STAND|MERGE)/i);
  const decision = decisionMatch
    ? (decisionMatch[1].toUpperCase() as "REVISE" | "STAND" | "MERGE")
    : null;

  // Extract reasoning
  const reasoningMatch = text.match(/REASONING:\s*(.+?)(?:\n\n|\nREVISED RESPONSE:)/is);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : null;

  // Extract revised response (everything after "REVISED RESPONSE:")
  const responseMatch = text.match(/REVISED RESPONSE:\s*\n?([\s\S]+)$/i);
  const revisedResponse = responseMatch ? responseMatch[1].trim() : null;

  // Fallback: if no REVISED RESPONSE marker, use the full text after the decision block
  if (!revisedResponse && decision) {
    const afterDecision = text.split(/REASONING:.*?\n/is);
    if (afterDecision.length > 1) {
      return { decision, reasoning, revisedResponse: afterDecision[afterDecision.length - 1].trim() };
    }
  }

  return { decision, reasoning, revisedResponse };
}
```

### Vote Parser (reused from Vote mode)

```typescript
function parseVote(text: string): string | null {
  // Primary: extract last "VOTE: Response X" match
  const voteMatches = [...text.matchAll(/VOTE:\s*Response\s+([A-Z])/gi)];
  if (voteMatches.length > 0) {
    return `Response ${voteMatches[voteMatches.length - 1][1].toUpperCase()}`;
  }

  // Fallback: last "Response X" in the text
  const fallbackMatches = [...text.matchAll(/Response\s+([A-Z])\b/gi)];
  if (fallbackMatches.length > 0) {
    return `Response ${fallbackMatches[fallbackMatches.length - 1][1].toUpperCase()}`;
  }

  return null;
}
```

### Unique Prompt Construction (Stage 2)

The key difference from all other modes: Stage 2 uses per-model unique prompts.

```typescript
function buildRevisionPrompts(
  stage1Results: Stage1Response[],
  labelMap: LabelMap,
  userQuery: string
): Map<string, string> {
  const prompts = new Map<string, string>();

  for (const result of stage1Results) {
    // Get the label assigned to this model's response
    const ownLabel = Object.entries(labelMap).find(([, model]) => model === result.model)?.[0];

    // Get all OTHER responses (anonymized)
    const otherResponses = stage1Results
      .filter(r => r.model !== result.model)
      .map(r => {
        const label = Object.entries(labelMap).find(([, model]) => model === r.model)?.[0];
        return { label: label!, response: r.response };
      });

    const prompt = buildRevisionPrompt({
      userQuery,
      yourOriginalResponse: result.response,
      otherResponses,
    });

    prompts.set(result.model, prompt);
  }

  return prompts;
}
```

### Parallel Execution with Unique Prompts

```typescript
async function queryModelsWithUniquePrompts(
  prompts: Map<string, string>,
  timeoutMs: number
): Promise<Map<string, QueryResult>> {
  const entries = Array.from(prompts.entries());
  const results = await Promise.allSettled(
    entries.map(([model, prompt]) =>
      queryModel(model, prompt, timeoutMs).then(result => ({ model, result }))
    )
  );

  const resultMap = new Map<string, QueryResult>();
  for (const settled of results) {
    if (settled.status === "fulfilled" && settled.value.result) {
      resultMap.set(settled.value.model, settled.value.result);
    }
  }

  return resultMap;
}
```

---

## C. SSE Event Sequence

```
1. debate_start         -> { conversationId, messageId, mode: "debate" }
2. round1_start         -> {}
3. round1_complete      -> { data: Stage1Response[] }
4. revision_start       -> { data: { labelMap: LabelMap } }
5. revision_complete    -> { data: RevisionRoundResult }
6. vote_start           -> { data: { revisedLabelMap: LabelMap } }
7. vote_complete        -> { data: DebateVoteResult }
8. winner_declared      -> { data: DebateWinnerResult }
9. title_complete       -> { data: { title: string } }      // new conversations only
10. complete            -> {}
```

On error at any point:
```
error -> { message: string }
```

### TypeScript Payload Interfaces

```typescript
// debate_start
interface DebateStartPayload {
  conversationId: string;
  messageId: string;
  mode: "debate";
}

// round1_complete (reuses Stage1Response from Council)
interface Round1CompletePayload {
  data: Stage1Response[];
}

// revision_start
interface RevisionStartPayload {
  data: {
    labelMap: LabelMap;               // Round 1 label map for anonymization context
  };
}

// revision_complete
interface RevisionCompletePayload {
  data: RevisionRoundResult;
}

interface RevisionRoundResult {
  revisions: RevisionResponse[];
  summary: RevisionSummary;
}

interface RevisionResponse {
  model: string;
  decision: "REVISE" | "STAND" | "MERGE" | null;
  reasoning: string | null;
  originalResponse: string;           // from Stage 1
  revisedResponse: string;            // the new response (or original if STAND)
  originalWordCount: number;
  revisedWordCount: number;
  responseTimeMs: number;
  parseSuccess: boolean;
}

interface RevisionSummary {
  totalModels: number;
  revised: number;                    // count of REVISE decisions
  stood: number;                      // count of STAND decisions
  merged: number;                     // count of MERGE decisions
  parseFailed: number;                // count of null decisions
}

// vote_start
interface DebateVoteStartPayload {
  data: {
    revisedLabelMap: LabelMap;        // NEW label map for revised responses
  };
}

// vote_complete
interface DebateVoteCompletePayload {
  data: DebateVoteResult;
}

interface DebateVoteResult {
  votes: VoteResponse[];
  tallies: Record<string, number>;    // "Response A" -> 2
  revisedLabelToModel: LabelMap;
  validVoteCount: number;
  invalidVoteCount: number;
  isTie: boolean;
  tiedLabels: string[];
}

interface VoteResponse {
  model: string;
  voteText: string;
  votedFor: string | null;            // "Response A" or null
  responseTimeMs: number;
}

// winner_declared
interface DebateWinnerDeclaredPayload {
  data: DebateWinnerResult;
}

interface DebateWinnerResult {
  winnerLabel: string;                // label in revised round
  winnerModel: string;
  winnerResponse: string;             // the REVISED response
  winnerDecision: "REVISE" | "STAND" | "MERGE" | null;
  voteCount: number;
  totalVotes: number;
  tiebroken: boolean;
  tiebreakerMethod?: "alphabetical";  // only if tiebroken
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
interface DebateStreamRequest {
  question: string;
  mode: "debate";
  conversationId?: string;
  modeConfig?: {
    models?: string[];                // all participating models (no special roles)
    timeoutMs?: number;
  };
}
```

### Zod Validation

```typescript
const debateRequestSchema = z.object({
  question: z.string().min(1, "Question is required"),
  mode: z.literal("debate"),
  conversationId: z.string().optional(),
  modeConfig: z.object({
    models: z.array(z.string())
      .min(3, "Debate mode requires at least 3 models")
      .max(6, "Maximum 6 models allowed")
      .optional(),
    timeoutMs: z.number().min(10_000).max(600_000).optional(),
  }).optional(),
});
```

### Default Configuration

```typescript
const DEFAULT_DEBATE_CONFIG = {
  models: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
  ],
  timeoutMs: 120_000,  // per-stage timeout
};
```

### Example Request

```json
{
  "question": "Should companies adopt a 4-day work week?",
  "mode": "debate",
  "modeConfig": {
    "models": [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro",
      "perplexity/sonar-pro"
    ]
  }
}
```

---

## E. Output Format

### Result Interface

```typescript
interface DebateResult {
  round1: Stage1Response[];
  round1LabelMap: LabelMap;
  revisions: RevisionResponse[];
  revisionSummary: RevisionSummary;
  revisedLabelMap: LabelMap;
  votes: DebateVoteResult;
  winner: DebateWinnerResult;
  title?: string;
}
```

### UI Display

- **Round 1 — Initial Answers:** Expandable cards per model showing the original response. Model name and response time visible. Identical layout to Council/Vote Stage 1.

- **Round 2 — Revision:** The most distinctive UI element of Debate mode.
  - Each model gets a card showing:
    - Decision badge: green "REVISED", blue "MERGED", or gray "STOOD"
    - Reasoning text (1-2 sentences explaining their decision)
    - Diff view toggled: show additions/removals between original and revised response
    - Word count change indicator (e.g., "+70 words")
  - Summary bar at top: "2 revised, 1 stood, 1 merged"
  - Optional "influence flow" visualization: arrows from anonymized labels to the models that revised, showing which responses influenced whom (derived from reasoning text analysis).

- **Round 3 — Vote:** Bar chart of vote tallies on revised responses. Each vote expandable to show reasoning. De-anonymization reveals which revised response belongs to which model.

- **Winner:** The winning model's REVISED response is displayed as the primary answer in the chat. A badge shows the winner model, their decision (REVISE/STAND/MERGE), and vote count.

### DB Storage

Uses the `deliberation_stages` table:

| `stageType` | `stageOrder` | `model` | `role` | `content` | `parsedData` |
|-------------|:------------:|---------|--------|-----------|--------------|
| `"round1_label_map"` | 0 | `null` | `null` | JSON label map | `{ "Response A": "model-1", ... }` |
| `"initial_answer"` | 1 | model ID | `"respondent"` | Full response | `{ "responseTimeMs": 2340 }` |
| `"revision"` | 2 | model ID | `"debater"` | Full revision text (including DECISION/REASONING/REVISED RESPONSE) | See below |
| `"revision_summary"` | 3 | `null` | `null` | JSON summary | See below |
| `"revised_label_map"` | 4 | `null` | `null` | JSON label map for revised round | `{ "Response A": "model-1", ... }` |
| `"debate_vote"` | 5 | model ID | `"voter"` | Full voting text | `{ "votedFor": "Response B" }` |
| `"debate_vote_tally"` | 6 | `null` | `null` | JSON tally | See below |
| `"debate_winner"` | 7 | winner model ID | `"winner"` | The winning revised response | See below |

### parsedData JSONB Examples

**Revision stage (`stageType: "revision"`):**
```json
{
  "decision": "REVISE",
  "reasoning": "Response B's point about caching was compelling and my original response overlooked async patterns",
  "originalWordCount": 450,
  "revisedWordCount": 520,
  "parseSuccess": true
}
```

**Revision stage with STAND (`stageType: "revision"`):**
```json
{
  "decision": "STAND",
  "reasoning": "My original response already covered all key points raised by others, and I believe my structure is clearer",
  "originalWordCount": 380,
  "revisedWordCount": 380,
  "parseSuccess": true
}
```

**Revision stage with MERGE (`stageType: "revision"`):**
```json
{
  "decision": "MERGE",
  "reasoning": "Each response had unique strengths — combining the technical depth of Response A with the practical examples of Response C",
  "originalWordCount": 400,
  "revisedWordCount": 650,
  "parseSuccess": true
}
```

**Revision summary (`stageType: "revision_summary"`):**
```json
{
  "totalModels": 4,
  "revised": 2,
  "stood": 1,
  "merged": 1,
  "parseFailed": 0
}
```

**Debate vote (`stageType: "debate_vote"`):**
```json
{
  "votedFor": "Response B"
}
```

**Debate vote tally (`stageType: "debate_vote_tally"`):**
```json
{
  "tallies": {
    "Response A": 1,
    "Response B": 2,
    "Response D": 1
  },
  "validVoteCount": 4,
  "invalidVoteCount": 0,
  "isTie": false,
  "winners": ["Response B"],
  "tiedLabels": []
}
```

**Debate winner (`stageType: "debate_winner"`):**
```json
{
  "winnerLabel": "Response B",
  "winnerModel": "openai/o3",
  "winnerDecision": "REVISE",
  "voteCount": 2,
  "totalVotes": 4,
  "tiebroken": false
}
```

---

## F. Edge Cases

| Scenario | Handling |
|----------|----------|
| All models fail in Stage 1 | Emit `error` event. Pipeline aborts. No data saved. |
| Some models fail in Stage 1 | Continue with successful models. Minimum 2 successful responses required to proceed to revision. If fewer than 2, emit `error`. |
| Only 2 models succeed in Stage 1 | Debate proceeds with 2 models. Each sees only one other response. Voting still occurs. |
| Model fails in revision (Stage 2) | Use that model's ORIGINAL Stage 1 response as its "revised" response. Mark decision as `null` and `parseSuccess: false`. The model still participates in voting. |
| All models fail in revision | Fall back to voting on ORIGINAL (Stage 1) responses. Revision summary shows `parseFailed: N`. |
| Revision parse fails (no DECISION found) | Set `decision: null`. Use the full revision text as the revised response (best-effort extraction). Mark `parseSuccess: false`. |
| REVISED RESPONSE section not found | Use the full text after the DECISION/REASONING block. If that also fails, use the original Stage 1 response. |
| All models STAND | The vote proceeds on original (unchanged) responses. This is valid — models were unpersuaded. Revision summary shows `stood: N`. |
| All models vote for themselves | Each model gets 1 vote, creating an N-way tie. Tiebreaker: first tied label alphabetically wins. |
| A model votes for its own revised response | Allowed. Since responses are anonymized, self-votes are not detectable. |
| Vote parsing fails for a model | That model's vote is excluded. `invalidVoteCount` incremented. |
| All vote parses fail | Emit `error` event: "All votes failed to parse." Stage 1 and revision data are still saved. |
| Two-way tie in voting | First tied label alphabetically by label letter wins (e.g., "Response A" beats "Response B"). `tiebroken: true`, `tiebreakerMethod: "alphabetical"`. |
| N-way tie (all different votes) | Same alphabetical resolution. |
| Timeout (Stage 1) | Per-model 120s timeout. Failed models excluded. Minimum 2 enforced. |
| Timeout (Stage 2) | Per-model 120s timeout. Failed models use original response. |
| Timeout (Stage 3) | Per-model 120s timeout. Failed votes excluded. |
| Conversation mode mismatch | If `conversationId` references a conversation with `mode != "debate"`, return 400 error. |
| Debate on follow-up question | Not supported (multi-turn = No). Return 400 if `conversationId` is provided and already has messages. |
| Duplicate models in config | Zod validation does not enforce uniqueness. If duplicates exist, they are treated as separate participants (each gets its own response). The label map assigns unique labels to each. |
| Model output too short in revision | Valid. Even a single-sentence revision is accepted. |
| Model includes markdown/formatting in DECISION line | Parser is case-insensitive and trims whitespace. "Decision: **REVISE**" matches via regex. |

### Label Map Strategy

Two separate label maps are used:

| Round | Label Map Purpose | Example |
|-------|-------------------|---------|
| Round 1 (Revision) | Anonymize Stage 1 responses shown to models during revision | `{ "Response A": "claude", "Response B": "gpt4", "Response C": "gemini" }` |
| Round 2 (Vote) | Anonymize revised responses for voting. May differ from Round 1 map (shuffled) to prevent position bias. | `{ "Response A": "gemini", "Response B": "claude", "Response C": "gpt4" }` |

The Round 2 label map is shuffled to prevent models from inferring identity based on the letter assignment they saw during revision.

---

## G. Database Schema

Uses the shared `deliberation_stages` table (see `00-shared-infrastructure.md`):

```typescript
// deliberation_stages rows for a single Debate pipeline execution
[
  // Stage 0: Round 1 label map
  {
    id: "uuid-1",
    messageId: "msg-789",
    stageType: "round1_label_map",
    stageOrder: 0,
    model: null,
    role: null,
    content: '{"Response A":"anthropic/claude-opus-4-6","Response B":"openai/o3","Response C":"google/gemini-2.5-pro","Response D":"perplexity/sonar-pro"}',
    parsedData: {
      "Response A": "anthropic/claude-opus-4-6",
      "Response B": "openai/o3",
      "Response C": "google/gemini-2.5-pro",
      "Response D": "perplexity/sonar-pro",
    },
    responseTimeMs: null,
  },

  // Stage 1: Initial answers (one row per model)
  {
    id: "uuid-2",
    messageId: "msg-789",
    stageType: "initial_answer",
    stageOrder: 1,
    model: "anthropic/claude-opus-4-6",
    role: "respondent",
    content: "Yes, companies should seriously consider a 4-day work week...",
    parsedData: { responseTimeMs: 3100 },
    responseTimeMs: 3100,
  },
  {
    id: "uuid-3",
    messageId: "msg-789",
    stageType: "initial_answer",
    stageOrder: 1,
    model: "openai/o3",
    role: "respondent",
    content: "The 4-day work week has pros and cons...",
    parsedData: { responseTimeMs: 2800 },
    responseTimeMs: 2800,
  },
  {
    id: "uuid-4",
    messageId: "msg-789",
    stageType: "initial_answer",
    stageOrder: 1,
    model: "google/gemini-2.5-pro",
    role: "respondent",
    content: "Research shows mixed results for 4-day work weeks...",
    parsedData: { responseTimeMs: 2500 },
    responseTimeMs: 2500,
  },
  {
    id: "uuid-5",
    messageId: "msg-789",
    stageType: "initial_answer",
    stageOrder: 1,
    model: "perplexity/sonar-pro",
    role: "respondent",
    content: "Several major trials of the 4-day work week have shown...",
    parsedData: { responseTimeMs: 2200 },
    responseTimeMs: 2200,
  },

  // Stage 2: Revisions (one row per model)
  {
    id: "uuid-6",
    messageId: "msg-789",
    stageType: "revision",
    stageOrder: 2,
    model: "anthropic/claude-opus-4-6",
    role: "debater",
    content: "DECISION: REVISE\nREASONING: Response B raised important industry-specific concerns...\n\nREVISED RESPONSE:\nYes, companies should consider a 4-day work week, but with caveats...",
    parsedData: {
      decision: "REVISE",
      reasoning: "Response B raised important industry-specific concerns that my original response glossed over",
      originalWordCount: 420,
      revisedWordCount: 510,
      parseSuccess: true,
    },
    responseTimeMs: 4200,
  },
  {
    id: "uuid-7",
    messageId: "msg-789",
    stageType: "revision",
    stageOrder: 2,
    model: "openai/o3",
    role: "debater",
    content: "DECISION: STAND\nREASONING: My balanced analysis already covered the key points...\n\nREVISED RESPONSE:\nThe 4-day work week has pros and cons...",
    parsedData: {
      decision: "STAND",
      reasoning: "My balanced analysis already covered the key points raised by other responses",
      originalWordCount: 380,
      revisedWordCount: 380,
      parseSuccess: true,
    },
    responseTimeMs: 3500,
  },
  {
    id: "uuid-8",
    messageId: "msg-789",
    stageType: "revision",
    stageOrder: 2,
    model: "google/gemini-2.5-pro",
    role: "debater",
    content: "DECISION: MERGE\nREASONING: Combining the empirical data from Response D with practical guidance...\n\nREVISED RESPONSE:\nA comprehensive look at the 4-day work week...",
    parsedData: {
      decision: "MERGE",
      reasoning: "Combining the empirical data from Response D with practical guidance from Response A creates a stronger answer",
      originalWordCount: 350,
      revisedWordCount: 580,
      parseSuccess: true,
    },
    responseTimeMs: 4800,
  },
  {
    id: "uuid-9",
    messageId: "msg-789",
    stageType: "revision",
    stageOrder: 2,
    model: "perplexity/sonar-pro",
    role: "debater",
    content: "DECISION: REVISE\nREASONING: Other responses prompted me to add implementation guidance...\n\nREVISED RESPONSE:\nSeveral major trials have shown promising results...",
    parsedData: {
      decision: "REVISE",
      reasoning: "Other responses prompted me to add implementation guidance alongside the research data",
      originalWordCount: 400,
      revisedWordCount: 470,
      parseSuccess: true,
    },
    responseTimeMs: 3800,
  },

  // Stage 3: Revision summary
  {
    id: "uuid-10",
    messageId: "msg-789",
    stageType: "revision_summary",
    stageOrder: 3,
    model: null,
    role: null,
    content: '{"totalModels":4,"revised":2,"stood":1,"merged":1,"parseFailed":0}',
    parsedData: {
      totalModels: 4,
      revised: 2,
      stood: 1,
      merged: 1,
      parseFailed: 0,
    },
    responseTimeMs: null,
  },

  // Stage 4: Revised label map (shuffled)
  {
    id: "uuid-11",
    messageId: "msg-789",
    stageType: "revised_label_map",
    stageOrder: 4,
    model: null,
    role: null,
    content: '{"Response A":"google/gemini-2.5-pro","Response B":"anthropic/claude-opus-4-6","Response C":"perplexity/sonar-pro","Response D":"openai/o3"}',
    parsedData: {
      "Response A": "google/gemini-2.5-pro",
      "Response B": "anthropic/claude-opus-4-6",
      "Response C": "perplexity/sonar-pro",
      "Response D": "openai/o3",
    },
    responseTimeMs: null,
  },

  // Stage 5: Votes on revised responses (one row per voter)
  {
    id: "uuid-12",
    messageId: "msg-789",
    stageType: "debate_vote",
    stageOrder: 5,
    model: "anthropic/claude-opus-4-6",
    role: "voter",
    content: "Response A provides the most comprehensive analysis... VOTE: Response A",
    parsedData: { votedFor: "Response A" },
    responseTimeMs: 1900,
  },
  {
    id: "uuid-13",
    messageId: "msg-789",
    stageType: "debate_vote",
    stageOrder: 5,
    model: "openai/o3",
    role: "voter",
    content: "After careful consideration... VOTE: Response A",
    parsedData: { votedFor: "Response A" },
    responseTimeMs: 1700,
  },
  {
    id: "uuid-14",
    messageId: "msg-789",
    stageType: "debate_vote",
    stageOrder: 5,
    model: "google/gemini-2.5-pro",
    role: "voter",
    content: "Response B has strong practical guidance... VOTE: Response B",
    parsedData: { votedFor: "Response B" },
    responseTimeMs: 1600,
  },
  {
    id: "uuid-15",
    messageId: "msg-789",
    stageType: "debate_vote",
    stageOrder: 5,
    model: "perplexity/sonar-pro",
    role: "voter",
    content: "The merged response is strongest... VOTE: Response A",
    parsedData: { votedFor: "Response A" },
    responseTimeMs: 1500,
  },

  // Stage 6: Vote tally
  {
    id: "uuid-16",
    messageId: "msg-789",
    stageType: "debate_vote_tally",
    stageOrder: 6,
    model: null,
    role: null,
    content: '{"tallies":{"Response A":3,"Response B":1},"isTie":false,"winners":["Response A"]}',
    parsedData: {
      tallies: { "Response A": 3, "Response B": 1 },
      validVoteCount: 4,
      invalidVoteCount: 0,
      isTie: false,
      winners: ["Response A"],
      tiedLabels: [],
    },
    responseTimeMs: null,
  },

  // Stage 7: Winner declaration
  {
    id: "uuid-17",
    messageId: "msg-789",
    stageType: "debate_winner",
    stageOrder: 7,
    model: "google/gemini-2.5-pro",
    role: "winner",
    content: "A comprehensive look at the 4-day work week...",  // the REVISED (merged) response
    parsedData: {
      winnerLabel: "Response A",
      winnerModel: "google/gemini-2.5-pro",
      winnerDecision: "MERGE",
      voteCount: 3,
      totalVotes: 4,
      tiebroken: false,
    },
    responseTimeMs: null,
  },
]
```

### Indexes

Covered by the shared index on `deliberation_stages(message_id, stage_order)` defined in `00-shared-infrastructure.md`.

### Query Patterns

```typescript
// Load full debate result for a message
async function loadDebateResult(messageId: string): Promise<DebateResult> {
  const stages = await db
    .select()
    .from(deliberationStages)
    .where(eq(deliberationStages.messageId, messageId))
    .orderBy(deliberationStages.stageOrder);

  const round1LabelMapStage = stages.find(s => s.stageType === "round1_label_map");
  const initialAnswers = stages.filter(s => s.stageType === "initial_answer");
  const revisions = stages.filter(s => s.stageType === "revision");
  const revisionSummaryStage = stages.find(s => s.stageType === "revision_summary");
  const revisedLabelMapStage = stages.find(s => s.stageType === "revised_label_map");
  const debateVotes = stages.filter(s => s.stageType === "debate_vote");
  const tallyStage = stages.find(s => s.stageType === "debate_vote_tally");
  const winnerStage = stages.find(s => s.stageType === "debate_winner");

  // Map initial answers to their revisions for pairing
  const revisionsByModel = new Map(revisions.map(r => [r.model!, r]));

  return {
    round1: initialAnswers.map(s => ({
      model: s.model!,
      response: s.content,
      responseTimeMs: s.responseTimeMs!,
    })),
    round1LabelMap: round1LabelMapStage?.parsedData as LabelMap,
    revisions: revisions.map(s => {
      const parsed = s.parsedData as RevisionParsedData;
      const originalStage = initialAnswers.find(a => a.model === s.model);
      return {
        model: s.model!,
        decision: parsed.decision,
        reasoning: parsed.reasoning,
        originalResponse: originalStage!.content,
        revisedResponse: s.content.match(/REVISED RESPONSE:\s*\n?([\s\S]+)$/i)?.[1]?.trim() ?? s.content,
        originalWordCount: parsed.originalWordCount,
        revisedWordCount: parsed.revisedWordCount,
        responseTimeMs: s.responseTimeMs!,
        parseSuccess: parsed.parseSuccess,
      };
    }),
    revisionSummary: revisionSummaryStage?.parsedData as RevisionSummary,
    revisedLabelMap: revisedLabelMapStage?.parsedData as LabelMap,
    votes: {
      votes: debateVotes.map(s => ({
        model: s.model!,
        voteText: s.content,
        votedFor: (s.parsedData as { votedFor: string | null }).votedFor,
        responseTimeMs: s.responseTimeMs!,
      })),
      tallies: (tallyStage?.parsedData as DebateVoteTallyParsedData).tallies,
      revisedLabelToModel: revisedLabelMapStage?.parsedData as LabelMap,
      validVoteCount: (tallyStage?.parsedData as DebateVoteTallyParsedData).validVoteCount,
      invalidVoteCount: (tallyStage?.parsedData as DebateVoteTallyParsedData).invalidVoteCount,
      isTie: (tallyStage?.parsedData as DebateVoteTallyParsedData).isTie,
      tiedLabels: (tallyStage?.parsedData as DebateVoteTallyParsedData).tiedLabels,
    },
    winner: {
      winnerLabel: (winnerStage?.parsedData as DebateWinnerParsedData).winnerLabel,
      winnerModel: (winnerStage?.parsedData as DebateWinnerParsedData).winnerModel,
      winnerResponse: winnerStage!.content,
      winnerDecision: (winnerStage?.parsedData as DebateWinnerParsedData).winnerDecision,
      voteCount: (winnerStage?.parsedData as DebateWinnerParsedData).voteCount,
      totalVotes: (winnerStage?.parsedData as DebateWinnerParsedData).totalVotes,
      tiebroken: (winnerStage?.parsedData as DebateWinnerParsedData).tiebroken,
      tiebreakerMethod: (winnerStage?.parsedData as DebateWinnerParsedData).tiebroken
        ? "alphabetical"
        : undefined,
    },
  };
}
```

### Conversation-Level Storage

```typescript
// conversations table
{ id, userId, title, mode: "debate", createdAt, updatedAt }

// messages table
{ id, conversationId, role: "user", content: userQuestion }
{ id, conversationId, role: "assistant", content: winnerRevisedResponse }  // winner's revised response
```

The assistant message `content` is the winning model's revised response. Since Debate mode does not support multi-turn, this is for display consistency and conversation history only.
