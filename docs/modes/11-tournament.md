# 11 — Tournament Mode

> Bracket-style single-elimination. Pairwise judging until one response remains.

**Family:** Algorithmic
**Status:** Specified
**Min Models:** 5 (4 contestants + 1 judge)
**Max Models:** 9 (8 contestants + 1 judge)
**Multi-turn:** No

---

## A. Requirements

### Functional

1. User submits a question.
2. **Stage 1 — Collect:** All contestant models answer the question in parallel.
3. **Stage 2 — Bracket Seeding:** Models are seeded into bracket pairs based on their array index (deterministic). For odd contestant counts, the last model receives a "bye" (auto-advances to the next round).
4. **Stage 3 — Round N Matchups:** For each pair in the current round, the judge model receives two anonymized responses and selects a winner. All matchups within a round execute in parallel. The winner's original response advances to the next round.
5. Repeat Stage 3 until exactly one response remains.
6. **Stage 4 — Winner Declaration:** The champion model's unmodified original response is output as the final answer.
7. A title is generated for new conversations.
8. All results are saved to the database via the `deliberation_stages` table.

### Non-Functional

- Stage 1 completes in the time of the slowest contestant model (parallel).
- Each round completes in the time of the slowest matchup within that round (parallel matchups).
- Bracket seeding is an instantaneous server-side computation.
- Total pipeline target: under 180 seconds (3 rounds worst case with 8 contestants).
- The judge model is called once per matchup (not once per round).

### Model Constraints

- Minimum 4 contestant models + 1 judge model = 5 total.
- Maximum 8 contestant models + 1 judge model = 9 total.
- The judge model MUST NOT appear in the contestant list. This ensures unbiased evaluation.
- The judge model is reused across all matchups in all rounds.

### What Makes It Distinct

- Single-elimination bracket: familiar tournament format, easy to visualize.
- Pairwise comparison is cognitively simpler for the judge than ranking N responses simultaneously.
- Output is an UNMODIFIED model response (no synthesis), preserving the original voice and coherence.
- The bracket path provides a narrative of how the winner defeated each opponent.
- Deterministic seeding ensures reproducible bracket structure for the same model list.

---

## B. Pipeline Design

### Stages

| Stage | Name | Parallel? | Input | Output |
|-------|------|-----------|-------|--------|
| 1 | Collect | Yes | User query | `Stage1Response[]` |
| 2 | Bracket Seed | Server | Stage 1 results | `BracketMatchup[][]` |
| 3.N | Round N Matchups | Yes (within round) | Paired responses | `MatchupResult[]` |
| 4 | Winner Declaration | Server | Final matchup winner | `TournamentChampion` |

### Data Flow

```
User Query
    |
    v
Stage 1: queryModelsParallel(contestantModels, query)
    | Stage1Response[]
    v
Stage 2: generateBracket(models) — server-side
    | BracketMatchup[][] (rounds × matchups per round)
    v
Round 1: For each matchup pair:
    |   anonymize(responseA, responseB) -> buildJudgePrompt()
    |   queryModel(judgeModel, judgePrompt) -> parseWinner()
    | MatchupResult[] — winners advance
    v
Round 2: Pair winners from Round 1 -> repeat judging
    | MatchupResult[]
    v
... (repeat until 1 remains)
    v
Stage 4: Declare champion
    v
generateTitle() -> save to DB -> stream to client
```

### Bracket Algorithm (server-side TypeScript)

```typescript
interface BracketMatchup {
  roundNumber: number;
  matchIndex: number;
  contestantA: { model: string; response: string; label: string };
  contestantB: { model: string; response: string; label: string } | null; // null = bye
  winner?: string;          // model name of winner
  winnerLabel?: string;     // "Response A" or "Response B"
  judgeReasoning?: string;
  responseTimeMs?: number;
}

function generateBracket(
  models: string[],
  responses: Map<string, string>
): BracketMatchup[][] {
  const rounds: BracketMatchup[][] = [];
  let currentContestants = models.map((model, i) => ({
    model,
    response: responses.get(model) ?? "",
  }));

  let roundNumber = 1;
  while (currentContestants.length > 1) {
    const round: BracketMatchup[] = [];
    for (let i = 0; i < currentContestants.length; i += 2) {
      const a = currentContestants[i];
      const b = i + 1 < currentContestants.length ? currentContestants[i + 1] : null;
      round.push({
        roundNumber,
        matchIndex: round.length,
        contestantA: { model: a.model, response: a.response, label: "Response A" },
        contestantB: b ? { model: b.model, response: b.response, label: "Response B" } : null,
      });
    }
    rounds.push(round);
    // Placeholder: winners determined during execution, not here
    roundNumber++;
    // For bracket structure calculation, assume all advance
    currentContestants = round.map((m) =>
      m.contestantB === null ? { model: m.contestantA.model, response: m.contestantA.response }
        : { model: m.contestantA.model, response: m.contestantA.response } // placeholder
    );
  }
  return rounds;
}

function calculateTotalRounds(contestantCount: number): number {
  return Math.ceil(Math.log2(contestantCount));
}
```

**Bracket examples:**
- 4 contestants: 2 rounds (2 semis + 1 final).
- 5 contestants: 3 rounds (2 matches + 1 bye in R1, 2 matches in R2 with possible bye, 1 final).
- 6 contestants: 3 rounds (3 matches in R1, 2 matches in R2 with possible bye, 1 final).
- 8 contestants: 3 rounds (4 quarters, 2 semis, 1 final).

### Prompt Templates

**Judge Prompt (per matchup)** (`buildJudgePrompt`):

```
You are judging a head-to-head matchup between two responses to the same question. Pick the better response.

QUESTION:
{{userQuery}}

--- Response A ---
{{responseA}}

--- Response B ---
{{responseB}}

Evaluate on: accuracy, completeness, clarity, practical value, and overall quality.

Provide brief reasoning (2-3 sentences), then declare the winner:

REASONING: [your analysis]
WINNER: Response [A|B]
```

**Strict Retry Prompt (used on parse failure):**

```
Your previous response could not be parsed. You MUST declare a winner.

QUESTION:
{{userQuery}}

--- Response A ---
{{responseA}}

--- Response B ---
{{responseB}}

Reply with EXACTLY this format and nothing else:

REASONING: [one sentence]
WINNER: Response A

or

REASONING: [one sentence]
WINNER: Response B
```

**Title Prompt** (`buildTitlePrompt`):

```
Generate a brief title (3-5 words) for a conversation that starts with this question:

"{{userQuery}}"

Reply with ONLY the title. No quotes, no punctuation, no explanation.
```

### Winner Parser

Primary regex: `WINNER:\s*Response\s+([AB])`

```typescript
function parseMatchupWinner(text: string): "A" | "B" | null {
  // Primary: find last WINNER: Response [A|B] match
  const matches = [...text.matchAll(/WINNER:\s*Response\s+([AB])/gi)];
  if (matches.length > 0) {
    return matches[matches.length - 1][1].toUpperCase() as "A" | "B";
  }

  // Fallback: find any isolated "Response A" or "Response B" as last token
  const fallback = [...text.matchAll(/\bResponse\s+([AB])\b/gi)];
  if (fallback.length > 0) {
    return fallback[fallback.length - 1][1].toUpperCase() as "A" | "B";
  }

  return null;
}

function parseJudgeReasoning(text: string): string {
  const match = text.match(/REASONING:\s*(.+?)(?=\s*WINNER:|$)/si);
  return match ? match[1].trim() : text.trim();
}
```

---

## C. SSE Event Sequence

```
 1. tournament_start      -> { conversationId, messageId, config }
 2. collect_start          -> {}
 3. collect_complete        -> { data: Stage1Response[] }
 4. bracket_seeded          -> { bracket: BracketSeedPayload, totalRounds }
 5. round_start             -> { round: 1, matchups: MatchupPreview[] }
 6. matchup_complete        -> { round: 1, matchIndex: 0, winner, reasoning, responseTimeMs }
 7. matchup_complete        -> { round: 1, matchIndex: 1, winner, reasoning, responseTimeMs }
 8. round_complete          -> { round: 1, winners: string[], eliminated: string[] }
 9. round_start             -> { round: 2, matchups: MatchupPreview[] }
10. matchup_complete        -> { round: 2, matchIndex: 0, ... }
11. round_complete          -> { round: 2, winners, eliminated }
    ... (repeat for additional rounds)
12. winner_declared         -> { data: TournamentChampionPayload }
13. title_complete          -> { data: { title: string } }     // new conversations only
14. complete                -> {}
```

On error at any point:
```
error -> { message: string }
```

### TypeScript Payload Interfaces

```typescript
// tournament_start
interface TournamentStartPayload {
  conversationId: string;
  messageId: string;
  config: {
    contestantModels: string[];
    judgeModel: string;
    totalRounds: number;
  };
}

// collect_complete (reuses shared Stage1Response)
interface CollectCompletePayload {
  data: Stage1Response[];
}

// bracket_seeded
interface BracketSeedPayload {
  totalRounds: number;
  contestants: string[];
  byes: string[];          // models that received a bye in round 1
  matchups: Array<{
    roundNumber: number;
    matchIndex: number;
    contestantA: string;   // model name
    contestantB: string | null; // null if bye
  }>;
}

// round_start
interface RoundStartPayload {
  round: number;
  matchups: MatchupPreview[];
}

interface MatchupPreview {
  matchIndex: number;
  contestantA: { model: string; label: string };
  contestantB: { model: string; label: string } | null;
}

// matchup_complete
interface MatchupCompletePayload {
  round: number;
  matchIndex: number;
  winner: string;          // "Response A" or "Response B"
  winnerModel: string;     // actual model name
  loserModel: string;      // actual model name
  reasoning: string;       // judge's reasoning
  responseTimeMs: number;
}

// round_complete
interface RoundCompletePayload {
  round: number;
  winners: string[];       // model names advancing
  eliminated: string[];    // model names eliminated
}

// winner_declared
interface TournamentChampionPayload {
  data: {
    model: string;
    response: string;       // unmodified original response
    bracketPath: Array<{
      round: number;
      opponent: string;     // model name of opponent
      result: "won" | "bye";
    }>;
    totalMatchupsWon: number;
    totalRounds: number;
  };
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
interface TournamentStreamRequest {
  question: string;
  mode: "tournament";
  conversationId?: string;
  modeConfig?: TournamentConfig;
}

interface TournamentConfig {
  contestantModels?: string[];
  judgeModel?: string;
  timeoutMs?: number;       // per-matchup timeout
}
```

### Zod Validation

```typescript
const tournamentConfigSchema = z.object({
  contestantModels: z.array(z.string())
    .min(4, "Tournament mode requires at least 4 contestant models")
    .max(8, "Maximum 8 contestant models allowed")
    .optional(),
  judgeModel: z.string().optional(),
  timeoutMs: z.number().min(10_000).max(300_000).default(120_000),
});

const tournamentRequestSchema = z.object({
  question: z.string().min(1, "Question is required"),
  mode: z.literal("tournament"),
  conversationId: z.string().optional(),
  modeConfig: tournamentConfigSchema.optional(),
}).refine(
  (data) => {
    if (data.modeConfig?.contestantModels && data.modeConfig?.judgeModel) {
      return !data.modeConfig.contestantModels.includes(data.modeConfig.judgeModel);
    }
    return true;
  },
  { message: "Judge model must not be in the contestant list" }
);
```

### Default Configuration

```typescript
const DEFAULT_TOURNAMENT_CONFIG: Required<TournamentConfig> = {
  contestantModels: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
    "perplexity/sonar-pro",
  ],
  judgeModel: "anthropic/claude-sonnet-4",
  timeoutMs: 120_000,
};
```

### Example Requests

New conversation (4 contestants):
```json
{
  "question": "Explain the trade-offs between microservices and monolithic architectures.",
  "mode": "tournament",
  "modeConfig": {
    "contestantModels": [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro",
      "perplexity/sonar-pro"
    ],
    "judgeModel": "anthropic/claude-sonnet-4"
  }
}
```

Larger bracket (6 contestants):
```json
{
  "question": "Write a Python function to find the longest palindromic substring.",
  "mode": "tournament",
  "modeConfig": {
    "contestantModels": [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro",
      "perplexity/sonar-pro",
      "meta-llama/llama-3.1-405b-instruct",
      "mistralai/mistral-large"
    ],
    "judgeModel": "anthropic/claude-sonnet-4"
  }
}
```

---

## E. Output Format

### Result Interface

```typescript
interface TournamentResult {
  responses: Stage1Response[];
  bracket: BracketMatchup[][];
  rounds: TournamentRound[];
  champion: TournamentChampion;
  title?: string;
}

interface TournamentRound {
  roundNumber: number;
  matchups: TournamentMatchup[];
  winners: string[];
  eliminated: string[];
}

interface TournamentMatchup {
  matchIndex: number;
  contestantA: { model: string; label: string };
  contestantB: { model: string; label: string } | null;
  judgeReasoning: string;
  winner: string;           // model name
  winnerLabel: string;      // "Response A" or "Response B"
  loserModel: string | null; // null if bye
  responseTimeMs: number;
  isBye: boolean;
}

interface TournamentChampion {
  model: string;
  response: string;         // unmodified original response
  bracketPath: Array<{
    round: number;
    opponent: string;
    result: "won" | "bye";
  }>;
  totalMatchupsWon: number;
  totalRounds: number;
}
```

### UI Display

- **Bracket Diagram:** Visual bracket tree (like March Madness). Each matchup node shows the two model names. The winner is highlighted in the node, and a line connects to their next matchup. Byes shown as a dotted single-line connector with "bye" label.
- **Matchup Detail:** Clicking any matchup node expands to show both responses side-by-side and the judge's reasoning text.
- **Round Progress:** Active round is highlighted. Completed matchups animate a checkmark. Pending matchups pulse.
- **Champion Banner:** The champion's response is displayed prominently as the primary answer, with a badge indicating the winning model, total rounds, and bracket path summary (e.g., "beat o3 in semis, beat gemini-2.5-pro in final").

### DB Storage

All data stored in `deliberation_stages` table:

| `stageType` | `stageOrder` | `model` | `role` | `content` | `parsedData` |
|-------------|:------------:|---------|--------|-----------|--------------|
| `"collect"` | 0 | contestant model | `"contestant"` | Model's full response | `{ "responseTimeMs": 2340 }` |
| `"bracket_seed"` | 1 | `null` | `null` | Human-readable bracket description | `BracketSeedParsedData` |
| `"round_1_match_0"` | 2 | judge model | `"judge"` | Full judge response text | `MatchupParsedData` |
| `"round_1_match_1"` | 2 | judge model | `"judge"` | Full judge response text | `MatchupParsedData` |
| `"round_2_match_0"` | 3 | judge model | `"judge"` | Full judge response text | `MatchupParsedData` |
| `"winner"` | 99 | champion model | `"champion"` | Champion's unmodified response | `ChampionParsedData` |

### parsedData JSONB Examples

**Collect stage (`stageType: "collect"`):**
```json
{
  "responseTimeMs": 2340
}
```

**Bracket seed (`stageType: "bracket_seed"`):**
```json
{
  "type": "bracket",
  "totalRounds": 3,
  "contestants": [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
    "perplexity/sonar-pro",
    "meta-llama/llama-3.1-405b-instruct"
  ],
  "byes": ["meta-llama/llama-3.1-405b-instruct"],
  "round1Matchups": [
    { "matchIndex": 0, "a": "anthropic/claude-opus-4-6", "b": "openai/o3" },
    { "matchIndex": 1, "a": "google/gemini-2.5-pro", "b": "perplexity/sonar-pro" },
    { "matchIndex": 2, "a": "meta-llama/llama-3.1-405b-instruct", "b": null }
  ]
}
```

**Matchup stage (`stageType: "round_1_match_0"`):**
```json
{
  "round": 1,
  "matchIndex": 0,
  "contestantA": "anthropic/claude-opus-4-6",
  "contestantB": "openai/o3",
  "labelA": "Response A",
  "labelB": "Response B",
  "winner": "Response A",
  "winnerModel": "anthropic/claude-opus-4-6",
  "loserModel": "openai/o3",
  "reasoning": "Response A provides a more structured and comprehensive analysis with concrete examples, while Response B, though accurate, remains more surface-level.",
  "isBye": false
}
```

**Bye matchup (`stageType: "round_1_match_2"`):**
```json
{
  "round": 1,
  "matchIndex": 2,
  "contestantA": "meta-llama/llama-3.1-405b-instruct",
  "contestantB": null,
  "labelA": "Response A",
  "labelB": null,
  "winner": "Response A",
  "winnerModel": "meta-llama/llama-3.1-405b-instruct",
  "loserModel": null,
  "reasoning": "Bye — auto-advance",
  "isBye": true
}
```

**Winner (`stageType: "winner"`):**
```json
{
  "winnerModel": "anthropic/claude-opus-4-6",
  "totalMatchupsWon": 2,
  "totalRounds": 3,
  "bracketPath": [
    { "round": 1, "opponent": "openai/o3", "result": "won" },
    { "round": 2, "opponent": "google/gemini-2.5-pro", "result": "won" }
  ]
}
```

---

## F. Edge Cases

| Scenario | Handling |
|----------|----------|
| All contestant models fail in Stage 1 | Emit `error` event. Pipeline aborts. No bracket is seeded. |
| Some contestants fail in Stage 1 | Treat failed contestant as eliminated with a "no response" marker. Their scheduled opponent receives a bye. Minimum 2 successful responses required to proceed. If fewer than 2, emit `error`. |
| Exactly 1 contestant succeeds | Emit `error` event: "Tournament requires at least 2 successful responses." |
| 4 contestants (even) | 2 rounds: 2 semis + 1 final. No byes needed. |
| 5 contestants (odd) | Round 1: 2 matches + 1 bye. Round 2: 2 matches (or 1 match + 1 bye if odd winners). Round 3: 1 final. |
| 8 contestants (max even) | 3 rounds: 4 quarters + 2 semis + 1 final. No byes. |
| Judge fails on a matchup | Re-query the judge model once with the same prompt. If retry fails, pick contestant A (first listed) as winner by default. Log the forced decision. |
| Judge response parse fails (no WINNER line) | Re-query with the strict retry prompt. If still fails, random selection between A and B (coin flip using `Math.random() < 0.5`). |
| Judge picks neither A nor B (invalid letter) | Same as parse failure: retry with strict prompt, then random. |
| Judge model fails on ALL matchups in a round | Emit `error` event. Partial bracket results are saved. |
| Contestant has empty response from Stage 1 | Treat as a failed contestant. Opponent gets a bye. |
| Timeout on judge matchup query | Per-matchup timeout via `AbortSignal.timeout(timeoutMs)`. Treated as judge failure (retry once, then default). |
| Two models produce identical responses | Judge still evaluates them. If identical, judge may pick either; both are valid since both responses are equivalent. |
| Conversation mode mismatch | If `conversationId` references a conversation with `mode != "tournament"`, return 400 error. |
| Judge model appears in contestant list | Validation rejects at Zod schema level (refine rule). Returns 400 before pipeline starts. |

---

## G. Database Schema

Uses the `deliberation_stages` table exclusively (no legacy tables).

### Row Shapes

**Collect row (one per contestant):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "collect",
  stageOrder: 0,
  model: "anthropic/claude-opus-4-6",
  role: "contestant",
  content: "Microservices and monolithic architectures each have distinct trade-offs...",
  parsedData: { responseTimeMs: 2340 },
  responseTimeMs: 2340,
  createdAt: "2026-02-09T..."
}
```

**Bracket seed row:**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "bracket_seed",
  stageOrder: 1,
  model: null,
  role: null,
  content: "Tournament bracket: 5 contestants, 3 rounds. Round 1: [claude-opus vs o3], [gemini-pro vs sonar-pro], [llama-405b bye]. ...",
  parsedData: {
    type: "bracket",
    totalRounds: 3,
    contestants: [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro",
      "perplexity/sonar-pro",
      "meta-llama/llama-3.1-405b-instruct"
    ],
    byes: ["meta-llama/llama-3.1-405b-instruct"],
    round1Matchups: [
      { matchIndex: 0, a: "anthropic/claude-opus-4-6", b: "openai/o3" },
      { matchIndex: 1, a: "google/gemini-2.5-pro", b: "perplexity/sonar-pro" },
      { matchIndex: 2, a: "meta-llama/llama-3.1-405b-instruct", b: null }
    ]
  },
  responseTimeMs: null,
  createdAt: "2026-02-09T..."
}
```

**Matchup row (judge evaluation):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "round_1_match_0",
  stageOrder: 2,
  model: "anthropic/claude-sonnet-4",
  role: "judge",
  content: "REASONING: Response A provides a more structured analysis with concrete examples and addresses both developer experience and operational concerns. Response B covers the basics but lacks depth in deployment strategies.\nWINNER: Response A",
  parsedData: {
    round: 1,
    matchIndex: 0,
    contestantA: "anthropic/claude-opus-4-6",
    contestantB: "openai/o3",
    labelA: "Response A",
    labelB: "Response B",
    winner: "Response A",
    winnerModel: "anthropic/claude-opus-4-6",
    loserModel: "openai/o3",
    reasoning: "Response A provides a more structured analysis with concrete examples and addresses both developer experience and operational concerns. Response B covers the basics but lacks depth in deployment strategies.",
    isBye: false
  },
  responseTimeMs: 3200,
  createdAt: "2026-02-09T..."
}
```

**Bye row (no judge call):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "round_1_match_2",
  stageOrder: 2,
  model: null,
  role: null,
  content: "Bye — meta-llama/llama-3.1-405b-instruct auto-advances.",
  parsedData: {
    round: 1,
    matchIndex: 2,
    contestantA: "meta-llama/llama-3.1-405b-instruct",
    contestantB: null,
    labelA: "Response A",
    labelB: null,
    winner: "Response A",
    winnerModel: "meta-llama/llama-3.1-405b-instruct",
    loserModel: null,
    reasoning: "Bye — auto-advance",
    isBye: true
  },
  responseTimeMs: null,
  createdAt: "2026-02-09T..."
}
```

**Winner row:**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "winner",
  stageOrder: 99,
  model: "anthropic/claude-opus-4-6",
  role: "champion",
  content: "Microservices and monolithic architectures each have distinct trade-offs...",  // unmodified Stage 1 response
  parsedData: {
    winnerModel: "anthropic/claude-opus-4-6",
    totalMatchupsWon: 2,
    totalRounds: 3,
    bracketPath: [
      { round: 1, opponent: "openai/o3", result: "won" },
      { round: 2, opponent: "google/gemini-2.5-pro", result: "won" }
    ]
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

```typescript
async function loadTournamentResult(messageId: string): Promise<TournamentResult> {
  const stages = await db
    .select()
    .from(deliberationStages)
    .where(eq(deliberationStages.messageId, messageId))
    .orderBy(deliberationStages.stageOrder, deliberationStages.createdAt);

  const collectStages = stages.filter((s) => s.stageType === "collect");
  const bracketSeed = stages.find((s) => s.stageType === "bracket_seed");
  const matchupStages = stages.filter((s) =>
    /^round_\d+_match_\d+$/.test(s.stageType)
  );
  const winnerStage = stages.find((s) => s.stageType === "winner");

  // Group matchup stages by round number
  const roundGroups = new Map<number, typeof matchupStages>();
  for (const matchup of matchupStages) {
    const parsed = matchup.parsedData as MatchupParsedData;
    const round = parsed.round;
    if (!roundGroups.has(round)) roundGroups.set(round, []);
    roundGroups.get(round)!.push(matchup);
  }

  // Reconstruct TournamentRound[] from grouped matchup data
  const rounds: TournamentRound[] = [];
  for (const [roundNum, matchups] of [...roundGroups.entries()].sort((a, b) => a[0] - b[0])) {
    const winners: string[] = [];
    const eliminated: string[] = [];
    const roundMatchups: TournamentMatchup[] = matchups.map((m) => {
      const pd = m.parsedData as MatchupParsedData;
      winners.push(pd.winnerModel);
      if (pd.loserModel) eliminated.push(pd.loserModel);
      return {
        matchIndex: pd.matchIndex,
        contestantA: { model: pd.contestantA, label: pd.labelA },
        contestantB: pd.contestantB ? { model: pd.contestantB, label: pd.labelB! } : null,
        judgeReasoning: pd.reasoning,
        winner: pd.winnerModel,
        winnerLabel: pd.winner,
        loserModel: pd.loserModel,
        responseTimeMs: m.responseTimeMs ?? 0,
        isBye: pd.isBye,
      };
    });
    rounds.push({ roundNumber: roundNum, matchups: roundMatchups, winners, eliminated });
  }

  return {
    responses: collectStages.map((s) => ({
      model: s.model!,
      response: s.content,
      responseTimeMs: s.responseTimeMs!,
    })),
    bracket: [], // reconstructed from bracketSeed.parsedData
    rounds,
    champion: {
      model: (winnerStage?.parsedData as ChampionParsedData).winnerModel,
      response: winnerStage!.content,
      bracketPath: (winnerStage?.parsedData as ChampionParsedData).bracketPath,
      totalMatchupsWon: (winnerStage?.parsedData as ChampionParsedData).totalMatchupsWon,
      totalRounds: (winnerStage?.parsedData as ChampionParsedData).totalRounds,
    },
  };
}
```

### Conversation-Level Storage

```typescript
// conversations table
{ id, userId, title, mode: "tournament", createdAt, updatedAt }

// messages table
{ id, conversationId, role: "user", content: userQuestion }
{ id, conversationId, role: "assistant", content: championResponse }  // unmodified winner
```

The assistant message `content` is the champion model's unmodified original response.
