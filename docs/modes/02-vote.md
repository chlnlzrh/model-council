# 02 — Vote Mode

> Answer → Vote → Declare Winner. The lightweight sibling of Council.

**Family:** Evaluation
**Status:** Specified (Pre-Implementation)
**Min Models:** 3 (all vote) + 1 chairman for tiebreaker
**Multi-turn:** Yes

---

## A. Requirements

### Functional

1. User submits a question.
2. **Stage 1 — Collect:** All council models answer the question in parallel (identical to Council Stage 1).
3. **Stage 2 — Vote:** Responses are anonymized using the same label map system as Council (Response A, B, C...). Each model sees all anonymized responses and casts exactly ONE vote for the best response. Votes are parsed to extract the chosen label.
4. **Stage 3 — Declare Winner:** If a plurality winner exists (one response has strictly more votes than any other), that model's ORIGINAL unmodified response is output as the final answer. If there is a tie, the chairman model receives the tied responses plus vote counts and picks the winner.
5. A title is generated for new conversations.
6. All results are saved to the database.

### Non-Functional

- Stage 1 completes in the time of the slowest model (parallel).
- Stage 2 completes in the time of the slowest model (parallel).
- Stage 3 (tiebreaker) is a single model call, only when needed.
- Total pipeline target: under 90 seconds (faster than Council due to simpler Stage 2).

### Model Constraints

- Minimum 3 voting models (each model votes; a model cannot vote for itself if self-identification is detectable, but since responses are anonymized this is not enforced).
- Maximum 7 voting models.
- Chairman model for tiebreaking may overlap with a voting model.

### What Makes It Distinct

- Simpler evaluation than Council: a single vote vs. a full ranking.
- Output is an UNMODIFIED model response (no synthesis step), preserving the original voice.
- Faster pipeline with fewer tokens consumed in Stage 2.
- Democratic selection: the majority picks the winner.

---

## B. Pipeline Design

### Stages

| Stage | Name | Parallel? | Input | Output |
|-------|------|-----------|-------|--------|
| 1 | Collect | Yes | User query (+ history) | `Stage1Response[]` |
| 2 | Vote | Yes | Anonymized Stage 1 responses | `VoteRoundResult` |
| 3 | Declare Winner | Conditional | Tied responses (if tie) | `VoteWinnerResult` |

### Data Flow

```
User Query
    |
Stage 1: queryModelsParallel(councilModels, query)
    | Stage1Response[]
Stage 2: createLabelMap() -> buildVotePrompt() -> queryModelsParallel()
    | VoteResponse[] -> tallyVotes()
         |
         +--[plurality winner?]--> output winner's original response
         |
         +--[tie?]--> buildTiebreakerPrompt() -> queryModel(chairmanModel)
                          | parse tiebreaker vote -> output winner's original response
    |
generateTitle() -> save to DB -> stream to client
```

### Prompt Templates

**Voting Prompt** (`buildVotePrompt`):

```
You are voting for the single best response to a question. Read all responses carefully, then cast exactly ONE vote.

Question: {{userQuery}}

{{#each labeledResponses}}
--- {{label}} ---
{{response}}

{{/each}}

Consider: accuracy, completeness, clarity, helpfulness, and practical value.

You MUST end your response with your vote in this exact format:
VOTE: Response X

where X is the letter of your chosen response. You may provide brief reasoning before the vote, but the last line MUST be your vote.
```

**Tiebreaker Prompt** (`buildTiebreakerPrompt`):

```
There is a tie in the voting. The following responses received equal votes:

{{#each tiedResponses}}
--- {{label}} ({{voteCount}} votes) ---
{{response}}

{{/each}}

Original question: {{userQuery}}

Choose the single best response. Reply with ONLY:
VOTE: Response X
```

**Title Prompt** (`buildTitlePrompt`):

```
Generate a brief title (3-5 words) for a conversation that starts with this question:

"{{userQuery}}"

Reply with ONLY the title. No quotes, no punctuation, no explanation.
```

### Vote Parser

Primary regex: `VOTE:\s*Response\s+([A-Z])`

Strategy:
1. Search for ALL matches of the primary regex in the response text.
2. Take the LAST match (the model may discuss votes before casting its own).
3. Fallback: scan for any isolated `Response\s+([A-Z])` pattern at the end of the text.
4. If no match found, return `null` (vote excluded).

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

### Vote Tally

```typescript
function tallyVotes(
  votes: VoteResponse[],
  labelMap: LabelMap
): VoteTally {
  const tallies: Record<string, number> = {};
  const validVotes: VoteResponse[] = [];
  const invalidVotes: VoteResponse[] = [];

  for (const vote of votes) {
    if (vote.votedFor && labelMap[vote.votedFor]) {
      tallies[vote.votedFor] = (tallies[vote.votedFor] ?? 0) + 1;
      validVotes.push(vote);
    } else {
      invalidVotes.push(vote);
    }
  }

  const maxVotes = Math.max(...Object.values(tallies), 0);
  const winners = Object.entries(tallies)
    .filter(([, count]) => count === maxVotes)
    .map(([label]) => label);

  return {
    tallies,
    validVotes,
    invalidVotes,
    winners,
    isTie: winners.length > 1,
    totalValidVotes: validVotes.length,
  };
}
```

---

## C. SSE Event Sequence

```
1. vote_start          -> { conversationId, messageId, mode: "vote" }
2. stage1_start        -> {}
3. stage1_complete     -> { data: Stage1Response[] }
4. vote_round_start    -> {}
5. vote_round_complete -> { data: VoteRoundResult }
6. tiebreaker_start    -> {}                              // only if tie
7. tiebreaker_complete -> { data: TiebreakerResult }      // only if tie
8. winner_declared     -> { data: VoteWinnerResult }
9. title_complete      -> { data: { title: string } }     // new conversations only
10. complete           -> {}
```

On error at any point:
```
error -> { message: string }
```

### TypeScript Payload Interfaces

```typescript
// vote_start
interface VoteStartPayload {
  conversationId: string;
  messageId: string;
  mode: "vote";
}

// stage1_complete (reused from Council)
interface Stage1CompletePayload {
  data: Stage1Response[];
}

// vote_round_complete
interface VoteRoundCompletePayload {
  data: VoteRoundResult;
}

interface VoteRoundResult {
  votes: VoteResponse[];
  tallies: Record<string, number>;  // "Response A" -> 2
  labelToModel: LabelMap;
  validVoteCount: number;
  invalidVoteCount: number;
  isTie: boolean;
  tiedLabels: string[];             // empty if no tie
}

interface VoteResponse {
  model: string;
  voteText: string;                 // full reasoning text
  votedFor: string | null;          // "Response A" or null if parse failed
  responseTimeMs: number;
}

// tiebreaker_complete
interface TiebreakerCompletePayload {
  data: TiebreakerResult;
}

interface TiebreakerResult {
  model: string;                    // chairman model
  voteText: string;
  votedFor: string;                 // "Response B"
  responseTimeMs: number;
}

// winner_declared
interface VoteWinnerDeclaredPayload {
  data: VoteWinnerResult;
}

interface VoteWinnerResult {
  winnerLabel: string;              // "Response A"
  winnerModel: string;              // "anthropic/claude-opus-4-6"
  winnerResponse: string;           // unmodified original response
  voteCount: number;
  totalVotes: number;
  tiebroken: boolean;
  tiebreakerModel?: string;        // only if tiebroken
}

// title_complete (reused from Council)
interface TitleCompletePayload {
  data: { title: string };
}
```

---

## D. Input Format

### Request Body

```typescript
interface VoteStreamRequest {
  question: string;
  mode: "vote";
  conversationId?: string;
  modeConfig?: {
    councilModels?: string[];
    chairmanModel?: string;         // used for tiebreaker only
    timeoutMs?: number;
  };
}
```

### Zod Validation

```typescript
const voteRequestSchema = z.object({
  question: z.string().min(1, "Question is required"),
  mode: z.literal("vote"),
  conversationId: z.string().optional(),
  modeConfig: z.object({
    councilModels: z.array(z.string())
      .min(3, "Vote mode requires at least 3 models")
      .max(7, "Maximum 7 models allowed")
      .optional(),
    chairmanModel: z.string().optional(),
    timeoutMs: z.number().min(10_000).max(300_000).optional(),
  }).optional(),
});
```

### Default Configuration

```typescript
const DEFAULT_VOTE_CONFIG = {
  councilModels: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
  ],
  chairmanModel: "anthropic/claude-opus-4-6",
  timeoutMs: 120_000,
};
```

### Example Requests

New conversation:
```json
{
  "question": "What is the best programming language for building web APIs in 2026?",
  "mode": "vote",
  "modeConfig": {
    "councilModels": [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro",
      "perplexity/sonar-pro"
    ],
    "chairmanModel": "anthropic/claude-opus-4-6"
  }
}
```

Follow-up (multi-turn):
```json
{
  "question": "What about for microservices specifically?",
  "mode": "vote",
  "conversationId": "existing-conversation-id"
}
```

---

## E. Output Format

### Result Interface

```typescript
interface VoteResult {
  stage1: Stage1Response[];
  voteRound: VoteRoundResult;
  tiebreaker?: TiebreakerResult;
  winner: VoteWinnerResult;
  title?: string;
}
```

### UI Display

- **Stage 1:** Expandable cards for each model's individual response, showing model name and response time. Identical to Council Stage 1.
- **Vote Round:** Bar chart showing vote tallies per response label. Each vote is expandable to show the voter's reasoning text. De-anonymization reveals the model behind each label.
- **Tiebreaker (if applicable):** Highlighted callout card showing the chairman's tiebreaker decision with reasoning.
- **Winner:** The winning model's UNMODIFIED original response is displayed as the primary answer in the chat. A badge indicates the winning model and vote count (e.g., "Winner: Claude Opus — 3 of 5 votes").

### DB Storage

Uses the `deliberation_stages` table (new modes schema):

| `stageType` | `stageOrder` | `model` | `role` | `content` | `parsedData` |
|-------------|:------------:|---------|--------|-----------|--------------|
| `"collect"` | 1 | model ID | `"respondent"` | Model's full response | `{ "responseTimeMs": 1234 }` |
| `"vote"` | 2 | model ID | `"voter"` | Full voting text with reasoning | `{ "votedFor": "Response A" }` |
| `"vote_tally"` | 3 | `null` | `null` | JSON-serialized tally summary | `{ "tallies": {...}, "isTie": false, "winners": ["Response A"] }` |
| `"tiebreaker"` | 4 | chairman ID | `"chairman"` | Tiebreaker response text | `{ "votedFor": "Response B" }` |
| `"winner"` | 5 | winner model ID | `"winner"` | The winning response (unmodified) | `{ "voteCount": 3, "totalVotes": 5, "tiebroken": false }` |
| `"label_map"` | 0 | `null` | `null` | JSON-serialized label map | `{ "Response A": "anthropic/claude-opus-4-6", ... }` |

Additionally, the `conversations` table stores `mode = "vote"` and the `messages` table stores the user question and the winning response as the assistant message.

### parsedData JSONB Examples

**Vote stage (`stageType: "vote"`):**
```json
{
  "votedFor": "Response A"
}
```

**Vote tally (`stageType: "vote_tally"`):**
```json
{
  "tallies": {
    "Response A": 2,
    "Response C": 1,
    "Response D": 1
  },
  "validVoteCount": 4,
  "invalidVoteCount": 0,
  "isTie": false,
  "winners": ["Response A"],
  "tiedLabels": []
}
```

**Tiebreaker (`stageType: "tiebreaker"`):**
```json
{
  "votedFor": "Response B",
  "tiedLabels": ["Response A", "Response B"],
  "tiedVoteCount": 2
}
```

**Winner (`stageType: "winner"`):**
```json
{
  "winnerLabel": "Response A",
  "winnerModel": "anthropic/claude-opus-4-6",
  "voteCount": 3,
  "totalVotes": 5,
  "tiebroken": false
}
```

**Label map (`stageType: "label_map"`):**
```json
{
  "Response A": "anthropic/claude-opus-4-6",
  "Response B": "openai/o3",
  "Response C": "google/gemini-2.5-pro"
}
```

---

## F. Edge Cases

| Scenario | Handling |
|----------|----------|
| All council models fail in Stage 1 | Emit `error` event. Pipeline aborts. No data saved. |
| Some models fail in Stage 1 | Continue with successful responses. Minimum 2 successful responses required for voting to proceed. If fewer than 2, emit `error`. |
| Only 2 models succeed in Stage 1 | Voting proceeds with 2 responses. All models that answered vote between the two. |
| Vote parsing fails for one model | That model's vote is excluded from tallies. `invalidVoteCount` is incremented. Pipeline continues. |
| All vote parses fail | Emit `error` event: "All votes failed to parse." Pipeline aborts. Stage 1 data is still saved. |
| Only one valid vote | That vote determines the winner (plurality of 1). No tiebreaker needed. |
| Clear plurality winner | Winner's response is output unmodified. No tiebreaker stage. |
| Two-way tie | Chairman receives both tied responses and breaks the tie. |
| N-way tie (all different) | Chairman receives all tied responses and picks one. This occurs when every model votes for a different response. |
| Chairman fails during tiebreaker | Emit `error` event. Stage 1 and vote data are saved. No winner declared. |
| Chairman tiebreaker vote parse fails | Retry once with the same prompt. If retry fails, pick the first tied response alphabetically by label. |
| A model votes for a non-existent label | Vote is treated as invalid (excluded). E.g., voting "Response F" when only A-D exist. |
| A model votes for its own response | Allowed (responses are anonymized, so self-votes are not detectable without de-anonymization). The vote counts normally. |
| Timeout (Stage 1) | Per-model 120s timeout via `AbortSignal.timeout()`. Failed models excluded. |
| Timeout (Stage 2) | Per-model 120s timeout. Failed votes excluded from tally. |
| Multi-turn history too large | History truncated to the last 10 turns. |
| Conversation mode mismatch | If `conversationId` references a conversation with `mode != "vote"`, return 400 error. |

---

## G. Database Schema

Uses the shared `deliberation_stages` table (see `00-shared-infrastructure.md`):

```typescript
// deliberation_stages rows for a single Vote pipeline execution
[
  // Stage 0: Label map (reference data)
  {
    id: "uuid-1",
    messageId: "msg-123",
    stageType: "label_map",
    stageOrder: 0,
    model: null,
    role: null,
    content: '{"Response A":"anthropic/claude-opus-4-6","Response B":"openai/o3","Response C":"google/gemini-2.5-pro"}',
    parsedData: { "Response A": "anthropic/claude-opus-4-6", "Response B": "openai/o3", "Response C": "google/gemini-2.5-pro" },
    responseTimeMs: null,
  },

  // Stage 1: Collect (one row per model)
  {
    id: "uuid-2",
    messageId: "msg-123",
    stageType: "collect",
    stageOrder: 1,
    model: "anthropic/claude-opus-4-6",
    role: "respondent",
    content: "The best programming language for web APIs...",
    parsedData: { responseTimeMs: 2340 },
    responseTimeMs: 2340,
  },
  // ... one row per model

  // Stage 2: Vote (one row per voter)
  {
    id: "uuid-5",
    messageId: "msg-123",
    stageType: "vote",
    stageOrder: 2,
    model: "anthropic/claude-opus-4-6",
    role: "voter",
    content: "Response A provides the most comprehensive analysis... VOTE: Response B",
    parsedData: { votedFor: "Response B" },
    responseTimeMs: 1800,
  },
  // ... one row per voter

  // Stage 3: Vote tally (aggregate row)
  {
    id: "uuid-8",
    messageId: "msg-123",
    stageType: "vote_tally",
    stageOrder: 3,
    model: null,
    role: null,
    content: '{"tallies":{"Response A":2,"Response C":1},"isTie":false,"winners":["Response A"]}',
    parsedData: {
      tallies: { "Response A": 2, "Response C": 1 },
      validVoteCount: 3,
      invalidVoteCount: 0,
      isTie: false,
      winners: ["Response A"],
      tiedLabels: [],
    },
    responseTimeMs: null,
  },

  // Stage 4: Tiebreaker (only if tie — omitted when no tie)
  // {
  //   stageType: "tiebreaker",
  //   stageOrder: 4,
  //   model: "anthropic/claude-opus-4-6",
  //   role: "chairman",
  //   content: "VOTE: Response B",
  //   parsedData: { votedFor: "Response B", tiedLabels: ["Response A", "Response B"], tiedVoteCount: 2 },
  //   responseTimeMs: 1200,
  // },

  // Stage 5: Winner declaration
  {
    id: "uuid-9",
    messageId: "msg-123",
    stageType: "winner",
    stageOrder: 5,
    model: "anthropic/claude-opus-4-6",
    role: "winner",
    content: "The best programming language for web APIs...",  // unmodified original response
    parsedData: {
      winnerLabel: "Response A",
      winnerModel: "anthropic/claude-opus-4-6",
      voteCount: 2,
      totalVotes: 3,
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
// Load full vote result for a message
async function loadVoteResult(messageId: string): Promise<VoteResult> {
  const stages = await db
    .select()
    .from(deliberationStages)
    .where(eq(deliberationStages.messageId, messageId))
    .orderBy(deliberationStages.stageOrder);

  const labelMap = stages.find(s => s.stageType === "label_map");
  const collectStages = stages.filter(s => s.stageType === "collect");
  const voteStages = stages.filter(s => s.stageType === "vote");
  const tallyStage = stages.find(s => s.stageType === "vote_tally");
  const tiebreakerStage = stages.find(s => s.stageType === "tiebreaker");
  const winnerStage = stages.find(s => s.stageType === "winner");

  return {
    stage1: collectStages.map(s => ({
      model: s.model!,
      response: s.content,
      responseTimeMs: s.responseTimeMs!,
    })),
    voteRound: {
      votes: voteStages.map(s => ({
        model: s.model!,
        voteText: s.content,
        votedFor: (s.parsedData as { votedFor: string | null }).votedFor,
        responseTimeMs: s.responseTimeMs!,
      })),
      tallies: (tallyStage?.parsedData as VoteTallyParsedData).tallies,
      labelToModel: labelMap?.parsedData as LabelMap,
      validVoteCount: (tallyStage?.parsedData as VoteTallyParsedData).validVoteCount,
      invalidVoteCount: (tallyStage?.parsedData as VoteTallyParsedData).invalidVoteCount,
      isTie: (tallyStage?.parsedData as VoteTallyParsedData).isTie,
      tiedLabels: (tallyStage?.parsedData as VoteTallyParsedData).tiedLabels,
    },
    tiebreaker: tiebreakerStage ? {
      model: tiebreakerStage.model!,
      voteText: tiebreakerStage.content,
      votedFor: (tiebreakerStage.parsedData as { votedFor: string }).votedFor,
      responseTimeMs: tiebreakerStage.responseTimeMs!,
    } : undefined,
    winner: {
      winnerLabel: (winnerStage?.parsedData as VoteWinnerParsedData).winnerLabel,
      winnerModel: (winnerStage?.parsedData as VoteWinnerParsedData).winnerModel,
      winnerResponse: winnerStage!.content,
      voteCount: (winnerStage?.parsedData as VoteWinnerParsedData).voteCount,
      totalVotes: (winnerStage?.parsedData as VoteWinnerParsedData).totalVotes,
      tiebroken: (winnerStage?.parsedData as VoteWinnerParsedData).tiebroken,
      tiebreakerModel: tiebreakerStage?.model ?? undefined,
    },
  };
}
```

### Conversation-Level Storage

```typescript
// conversations table
{ id, userId, title, mode: "vote", createdAt, updatedAt }

// messages table
{ id, conversationId, role: "user", content: userQuestion }
{ id, conversationId, role: "assistant", content: winnerResponse }  // unmodified winner
```

The assistant message `content` is the winning model's unmodified response, ensuring multi-turn follow-ups use the actual selected answer as context.
