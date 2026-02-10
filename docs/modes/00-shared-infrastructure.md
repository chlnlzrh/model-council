# 00 — Shared Infrastructure

> Cross-cutting concerns for all 15 deliberation modes.

---

## A. Mode Registry

### Mode Enum

```typescript
type DeliberationMode =
  | "council"
  | "vote"
  | "jury"
  | "debate"
  | "delphi"
  | "red_team"
  | "chain"
  | "specialist_panel"
  | "blueprint"
  | "peer_review"
  | "tournament"
  | "confidence_weighted"
  | "decompose"
  | "brainstorm"
  | "fact_check";
```

### Mode Metadata

```typescript
interface ModeDefinition {
  id: DeliberationMode;
  name: string;
  family: "evaluation" | "adversarial" | "sequential" | "role_based" | "algorithmic" | "creative" | "verification";
  description: string;
  minModels: number;
  maxModels: number;
  requiresSpecialRole: boolean;   // e.g. chairman, foreman, judge
  supportsMultiTurn: boolean;
  estimatedDurationMs: number;    // typical pipeline time
}

const MODE_REGISTRY: Record<DeliberationMode, ModeDefinition> = {
  council: {
    id: "council",
    name: "Council",
    family: "evaluation",
    description: "Models answer, rank each other anonymously, then a chairman synthesizes.",
    minModels: 3,  // 2 council + 1 chairman
    maxModels: 7,
    requiresSpecialRole: true,
    supportsMultiTurn: true,
    estimatedDurationMs: 120_000,
  },
  vote: {
    id: "vote",
    name: "Vote",
    family: "evaluation",
    description: "Models answer, vote for the best, tiebreaker by chairman.",
    minModels: 3,
    maxModels: 7,
    requiresSpecialRole: true,
    supportsMultiTurn: true,
    estimatedDurationMs: 90_000,
  },
  jury: {
    id: "jury",
    name: "Jury",
    family: "evaluation",
    description: "Models evaluate an existing answer on 5 dimensions, foreman delivers verdict.",
    minModels: 4, // 3 jurors + 1 foreman
    maxModels: 7,
    requiresSpecialRole: true,
    supportsMultiTurn: false,
    estimatedDurationMs: 90_000,
  },
  debate: {
    id: "debate",
    name: "Debate",
    family: "evaluation",
    description: "Models answer, see others' responses, revise, then vote on revised answers.",
    minModels: 3,
    maxModels: 6,
    requiresSpecialRole: false,
    supportsMultiTurn: false,
    estimatedDurationMs: 180_000,
  },
  delphi: {
    id: "delphi",
    name: "Delphi",
    family: "evaluation",
    description: "Iterative anonymous rounds with statistical feedback until convergence.",
    minModels: 4,
    maxModels: 8,
    requiresSpecialRole: true,
    supportsMultiTurn: false,
    estimatedDurationMs: 300_000,
  },
  red_team: {
    id: "red_team",
    name: "Red Team",
    family: "adversarial",
    description: "Adversarial loop: generate, attack, defend, judge.",
    minModels: 2,
    maxModels: 3,
    requiresSpecialRole: false,
    supportsMultiTurn: false,
    estimatedDurationMs: 180_000,
  },
  chain: {
    id: "chain",
    name: "Chain",
    family: "sequential",
    description: "Sequential improvement: draft, improve, refine, polish.",
    minModels: 2,
    maxModels: 6,
    requiresSpecialRole: false,
    supportsMultiTurn: false,
    estimatedDurationMs: 240_000,
  },
  specialist_panel: {
    id: "specialist_panel",
    name: "Specialist Panel",
    family: "role_based",
    description: "Role-assigned expert analysis, cross-review, and synthesis.",
    minModels: 3, // 2 specialists + 1 synthesizer
    maxModels: 7,
    requiresSpecialRole: true,
    supportsMultiTurn: false,
    estimatedDurationMs: 150_000,
  },
  blueprint: {
    id: "blueprint",
    name: "Blueprint",
    family: "role_based",
    description: "Outline, parallel section expansion, and assembly into a unified document.",
    minModels: 2,
    maxModels: 8,
    requiresSpecialRole: false,
    supportsMultiTurn: false,
    estimatedDurationMs: 300_000,
  },
  peer_review: {
    id: "peer_review",
    name: "Peer Review",
    family: "role_based",
    description: "Independent reviews with scoring rubric, consolidated into a unified report.",
    minModels: 3, // 2 reviewers + 1 consolidator
    maxModels: 7,
    requiresSpecialRole: true,
    supportsMultiTurn: false,
    estimatedDurationMs: 150_000,
  },
  tournament: {
    id: "tournament",
    name: "Tournament",
    family: "algorithmic",
    description: "Bracket-style elimination: pairwise judging until a winner emerges.",
    minModels: 5, // 4 contestants + 1 judge
    maxModels: 9,
    requiresSpecialRole: true,
    supportsMultiTurn: false,
    estimatedDurationMs: 180_000,
  },
  confidence_weighted: {
    id: "confidence_weighted",
    name: "Confidence-Weighted",
    family: "algorithmic",
    description: "Models answer with self-assessed confidence, weighted synthesis.",
    minModels: 2,
    maxModels: 6,
    requiresSpecialRole: false,
    supportsMultiTurn: true,
    estimatedDurationMs: 90_000,
  },
  decompose: {
    id: "decompose",
    name: "Decompose",
    family: "algorithmic",
    description: "Planner breaks question into sub-tasks, models solve parts, assembler reunifies.",
    minModels: 2,
    maxModels: 6,
    requiresSpecialRole: false,
    supportsMultiTurn: false,
    estimatedDurationMs: 180_000,
  },
  brainstorm: {
    id: "brainstorm",
    name: "Brainstorm",
    family: "creative",
    description: "Generate ideas freely, cluster, score, refine top cluster.",
    minModels: 3,
    maxModels: 6,
    requiresSpecialRole: false,
    supportsMultiTurn: false,
    estimatedDurationMs: 180_000,
  },
  fact_check: {
    id: "fact_check",
    name: "Fact-Check",
    family: "verification",
    description: "Generate content, extract claims, independently verify, produce evidence report.",
    minModels: 3,
    maxModels: 6,
    requiresSpecialRole: false,
    supportsMultiTurn: false,
    estimatedDurationMs: 180_000,
  },
};
```

---

## B. Database Changes

### 1. Add `mode` Column to `conversations` Table

```typescript
// In lib/db/schema.ts — add to existing conversations table
mode: text("mode").notNull().default("council"),
```

Values: One of the `DeliberationMode` union members.

### 2. New `deliberation_stages` Table

```typescript
export const deliberationStages = pgTable("deliberation_stages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  stageType: text("stage_type").notNull(),       // mode-specific: "vote", "attack_round_1", etc.
  stageOrder: integer("stage_order").notNull(),   // sequential ordering within the pipeline
  model: text("model"),                           // nullable for aggregate/stats-only rows
  role: text("role"),                             // "attacker", "security_expert", "drafter", etc.
  content: text("content").notNull(),             // full response text
  parsedData: jsonb("parsed_data"),               // mode-specific structured data (see per-mode specs)
  responseTimeMs: integer("response_time_ms"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// Index for fast lookups by message
// CREATE INDEX idx_deliberation_stages_message ON deliberation_stages(message_id, stage_order);
```

### 3. Backward Compatibility

Existing Council-specific tables remain untouched:
- `stage1_responses`
- `stage2_rankings`
- `stage2_label_map`
- `stage3_synthesis`

New modes use exclusively the `deliberation_stages` table. Council mode continues to use its existing tables (no migration needed). A future migration can consolidate Council into `deliberation_stages` if desired.

---

## C. API Routing

### Single Endpoint with Mode Dispatcher

```
POST /api/council/stream
```

**Extended Request Schema:**

```typescript
const streamRequestSchema = z.object({
  question: z.string().min(1),
  mode: z.enum([
    "council", "vote", "jury", "debate", "delphi",
    "red_team", "chain", "specialist_panel", "blueprint",
    "peer_review", "tournament", "confidence_weighted",
    "decompose", "brainstorm", "fact_check",
  ]).default("council"),
  conversationId: z.string().optional(),
  // Council-specific (backward compatible)
  councilModels: z.array(z.string()).optional(),
  chairmanModel: z.string().optional(),
  // Generic mode config
  modeConfig: z.record(z.unknown()).optional(),
});
```

**Dispatcher Logic:**

```typescript
// In route.ts POST handler
const { mode, question, conversationId, modeConfig } = parsed;

switch (mode) {
  case "council":
    return handleCouncilStream(question, conversationId, modeConfig);
  case "vote":
    return handleVoteStream(question, conversationId, modeConfig);
  case "jury":
    return handleJuryStream(question, conversationId, modeConfig);
  // ... etc for all 15 modes
  default:
    return new Response(JSON.stringify({ error: `Unknown mode: ${mode}` }), { status: 400 });
}
```

### Shared Logic (All Modes)

| Concern | Implementation |
|---------|---------------|
| Auth | `auth()` check at top of POST handler — shared |
| Conversation creation | Create/reuse conversation with `mode` column set |
| Message saving | Save user message to `messages` table — shared |
| SSE encoding | `sseEncode(event, data)` utility — shared |
| Title generation | `generateTitle(question)` — shared, called at end of pipeline |
| Error handling | Try/catch → `sseEncode("error", { message })` — shared |

---

## D. File Structure

```
lib/council/
  orchestrator.ts                    # Existing Council (unchanged)
  openrouter.ts                      # Reusable transport (unchanged)
  types.ts                           # Extended with DeliberationMode + all mode types
  prompts.ts                         # Existing Council prompts (unchanged)
  ranking-parser.ts                  # Existing Council parser (unchanged)
  modes/
    index.ts                         # Mode registry + dispatcher
    vote.ts                          # Vote orchestrator + prompts + parser
    jury.ts                          # Jury orchestrator + prompts + parser
    debate.ts                        # Debate orchestrator + prompts
    delphi.ts                        # Delphi orchestrator + prompts + convergence engine
    red-team.ts                      # Red Team orchestrator + prompts + parser
    chain.ts                         # Chain orchestrator + prompts
    specialist-panel.ts              # Panel orchestrator + prompts + role presets
    blueprint.ts                     # Blueprint orchestrator + prompts + skeleton parser
    peer-review.ts                   # Peer Review orchestrator + prompts + findings parser
    tournament.ts                    # Tournament orchestrator + bracket algorithm + prompts
    confidence-weighted.ts           # Confidence orchestrator + weighting math + prompts
    decompose.ts                     # Decompose orchestrator + task planner + prompts
    brainstorm.ts                    # Brainstorm orchestrator + clustering + prompts
    fact-check.ts                    # Fact-Check orchestrator + claim extractor + prompts
hooks/
  use-council-stream.ts              # Existing (unchanged)
  use-deliberation-stream.ts         # Generic hook with mode-specific state dispatch
```

---

## E. Reusable Functions

| Function | File | Used By |
|----------|------|---------|
| `queryModel()` | `openrouter.ts` | All 15 modes |
| `queryModelsParallel()` | `openrouter.ts` | All modes with parallel stages |
| `queryModelWithMessages()` | `openrouter.ts` | Multi-turn modes (Council, Vote, Confidence-Weighted) |
| `queryModelsParallelWithMessages()` | `openrouter.ts` | Multi-turn parallel stages |
| `generateTitle()` | `orchestrator.ts` | All 15 modes |
| `createLabelMap()` | `ranking-parser.ts` | Vote, Debate, Council, Tournament |
| `buildTitlePrompt()` | `prompts.ts` | All 15 modes |
| `sseEncode()` | SSE route | All 15 modes |

---

## F. Generic SSE Event Types

All modes share these event types in addition to their mode-specific ones:

```typescript
// Shared across all modes
type SharedSSEEventType =
  | "title_complete"    // { data: { title: string } }
  | "complete"          // {}
  | "error";            // { message: string }
```

Mode-specific events are prefixed or namespaced per mode (documented in each spec).

---

## G. Generic Client Hook

```typescript
// hooks/use-deliberation-stream.ts

interface DeliberationStreamState {
  mode: DeliberationMode;
  conversationId: string | null;
  messageId: string | null;
  stages: Map<string, unknown>;    // stage_type → stage data
  currentStage: string | null;     // currently active stage name
  isLoading: boolean;
  error: string | null;
  elapsedMs: number;
  title: string | null;
}

function useDeliberationStream() {
  // Returns state + sendMessage(mode, question, modeConfig) + reset()
  // Event handler dispatches by mode to mode-specific state reducers
}
```

Each mode spec defines its own state shape within the `stages` map.

---

## H. Conversation History for Multi-Turn Modes

Modes that support multi-turn (`council`, `vote`, `confidence_weighted`) load history via:

```typescript
async function loadConversationHistory(conversationId: string): Promise<ConversationTurn[]>
```

For modes using `deliberation_stages` instead of `stage3_synthesis`, the assistant message content is loaded from the final stage's `content` column instead.

---

## I. Error Handling Contract

Every mode MUST handle these scenarios:

| Scenario | Required Behavior |
|----------|------------------|
| All models fail | Emit `error` event with message. Do not save incomplete results. |
| Some models fail | Continue with successful results. Note failures in metadata. Minimum viable result defined per mode. |
| Parsing failure | Use raw text as fallback. Note parsing failure in `parsedData`. |
| Timeout | Per-stage timeout (default 120s). Global pipeline timeout (default 600s). Emit partial results + warning. |
| Empty response | Treat as model failure. Exclude from aggregation. |
| Invalid mode config | Return 400 with Zod validation errors before starting pipeline. |

---

## J. Implementation Priority

| Priority | Mode | Complexity | Rationale |
|----------|------|-----------|-----------|
| 0 | Shared Infrastructure | Medium | Prerequisite for all modes |
| 1 | Vote | Low (~400 LOC) | Simplest delta from Council |
| 2 | Chain | Low-Med (~500 LOC) | Simple sequential pattern |
| 3 | Specialist Panel | Medium (~700 LOC) | High value, parallel + synthesis |
| 4 | Jury | Medium (~600 LOC) | Evaluation paradigm |
| 5 | Red Team | Medium (~700 LOC) | Adversarial loop pattern |
| 6 | Blueprint | Med-High (~800 LOC) | Document generation |
| 7 | Peer Review | Medium (~700 LOC) | Review/audit use case |
| 8 | Debate | High (~800 LOC) | Per-model revision prompts |
| 9 | Tournament | Medium (~700 LOC) | Bracket algorithm |
| 10 | Confidence-Weighted | Medium (~600 LOC) | Weighting math |
| 11 | Decompose | High (~900 LOC) | DAG + topological sort |
| 12 | Brainstorm | Med-High (~800 LOC) | Clustering logic |
| 13 | Fact-Check | High (~900 LOC) | Multi-phase verification |
| 14 | Delphi | Very High (~1200 LOC) | Iterative convergence engine |
