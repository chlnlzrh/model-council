# Design: Model Council

> Architecture, data model, and key design decisions for the production Model Council app.
> References: GAP_ANALYSIS.md (gaps), REQUIREMENTS.md (requirements), IMPLEMENTATION.md (phases).

---

## DS-1: Architecture Overview

### Current Architecture (Karpathy Prototype — Reference Only)

```
┌──────────┐    HTTP/SSE    ┌──────────────────┐    HTTPS    ┌─────────────┐
│  Browser  │ ←──────────→  │  FastAPI :8001    │ ─────────→ │  OpenRouter  │
│  (Vite)   │               │  (Python)        │            │  API         │
│  :5173    │               │                  │            └─────────────┘
└──────────┘               │  JSON Files      │
                            │  (data/convos/)  │
                            └──────────────────┘
```

- Single-process Python backend
- No auth, no database, no TypeScript
- JSON file storage (metadata not persisted)
- CORS required (separate origins)

### Target Architecture (Model Council)

```
┌──────────────────────────────────────────────────────────┐
│                     Vercel Edge Network                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Next.js 14+ App Router                │  │
│  │                                                    │  │
│  │  ┌──────────────┐  ┌───────────────────────────┐  │  │
│  │  │  Server       │  │  API Route Handlers       │  │  │
│  │  │  Components   │  │                           │  │  │
│  │  │  (RSC)        │  │  /api/auth/[...nextauth]  │  │  │
│  │  │              │  │  /api/council/stream       │  │  │
│  │  │  Dashboard    │  │  /api/conversations       │  │  │
│  │  │  Council      │  │  /api/conversations/[id]  │  │  │
│  │  │  Settings     │  │  /api/models              │  │  │
│  │  │  Analytics    │  │                           │  │  │
│  │  └──────┬───────┘  └──────────┬────────────────┘  │  │
│  │         │                      │                    │  │
│  │         ▼                      ▼                    │  │
│  │  ┌──────────────┐  ┌───────────────────────────┐  │  │
│  │  │  Drizzle ORM │  │  lib/council/             │  │  │
│  │  │  (queries)   │  │                           │  │  │
│  │  │              │  │  orchestrator.ts           │  │  │
│  │  │              │  │  openrouter.ts             │  │  │
│  │  │              │  │  ranking-parser.ts         │  │  │
│  │  └──────┬───────┘  └──────────┬────────────────┘  │  │
│  │         │                      │                    │  │
│  └─────────┼──────────────────────┼────────────────────┘  │
│            │                      │                        │
│            ▼                      ▼                        │
│  ┌──────────────────┐  ┌───────────────────────────┐     │
│  │  Neon Postgres   │  │  OpenRouter API           │     │
│  │  (@vercel/       │  │  (via Vercel AI SDK)      │     │
│  │   postgres)      │  │                           │     │
│  │                  │  │  200+ models:              │     │
│  │  7 tables        │  │  GPT-5.1, Gemini 3 Pro,  │     │
│  │  (Drizzle)       │  │  Claude Sonnet 4.5,       │     │
│  │                  │  │  Grok 4, etc.             │     │
│  └──────────────────┘  └───────────────────────────┘     │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Auth.js v5 (Drizzle Adapter)                      │  │
│  │  Email/Password + Google OAuth                     │  │
│  │  JWT Sessions + Middleware Route Protection         │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Key differences from prototype:**
- Same-origin (no CORS needed)
- Server Components for data fetching
- Persistent relational database
- Full authentication layer
- All TypeScript, all the way down

---

## DS-2: Directory Structure

```
model-council/
├── app/
│   ├── layout.tsx                          # Root layout: providers, fonts, metadata
│   ├── page.tsx                            # Landing → redirect to /council
│   ├── globals.css                         # Tailwind imports + CSS variables
│   │
│   ├── (auth)/
│   │   ├── login/page.tsx                  # Email/password + OAuth login
│   │   └── register/page.tsx               # New account registration
│   │
│   ├── (dashboard)/
│   │   ├── layout.tsx                      # Sidebar + main content shell
│   │   ├── council/
│   │   │   ├── page.tsx                    # Conversation list + new council
│   │   │   └── [id]/page.tsx              # 3-stage council view
│   │   ├── settings/page.tsx               # Model configuration + presets
│   │   └── analytics/page.tsx              # Usage dashboard + charts
│   │
│   └── api/
│       ├── auth/[...nextauth]/route.ts     # Auth.js catch-all handler
│       ├── council/stream/route.ts         # SSE streaming endpoint
│       ├── conversations/route.ts          # List + create conversations
│       ├── conversations/[id]/route.ts     # Get + update + delete conversation
│       └── models/route.ts                 # OpenRouter model discovery
│
├── components/
│   ├── ui/                                 # Shadcn UI primitives (auto-generated)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── tabs.tsx
│   │   ├── badge.tsx
│   │   ├── skeleton.tsx
│   │   ├── toast.tsx
│   │   ├── dialog.tsx
│   │   ├── select.tsx
│   │   ├── input.tsx
│   │   ├── textarea.tsx
│   │   └── separator.tsx
│   │
│   ├── council/
│   │   ├── stage1-panel.tsx                # Individual model responses (tabs)
│   │   ├── stage2-panel.tsx                # Rankings + de-anonymization + aggregates
│   │   ├── stage3-panel.tsx                # Chairman synthesis
│   │   ├── council-view.tsx                # Orchestrates 3 stage panels
│   │   ├── chat-input.tsx                  # Always-visible message input
│   │   ├── message-list.tsx                # Conversation message history
│   │   └── loading-stages.tsx              # Per-stage loading indicators
│   │
│   ├── layout/
│   │   ├── sidebar.tsx                     # Conversation list + nav
│   │   ├── header.tsx                      # Page title + user menu
│   │   ├── mobile-nav.tsx                  # Hamburger + slide panel
│   │   └── theme-toggle.tsx                # Light/dark/system switch
│   │
│   ├── settings/
│   │   ├── model-picker.tsx                # Multi-select model grid
│   │   ├── preset-manager.tsx              # CRUD for model presets
│   │   └── chairman-select.tsx             # Chairman model dropdown
│   │
│   └── analytics/
│       ├── win-rate-chart.tsx              # Bar chart: model win rates
│       ├── response-time-chart.tsx         # Line chart: response times
│       └── usage-stats.tsx                 # Summary cards
│
├── lib/
│   ├── council/
│   │   ├── types.ts                        # All TypeScript interfaces
│   │   ├── orchestrator.ts                 # 3-stage pipeline (REQ-CURR-001)
│   │   ├── openrouter.ts                   # Vercel AI SDK + OpenRouter client
│   │   ├── ranking-parser.ts               # FINAL RANKING: regex extraction
│   │   └── prompts.ts                      # Ranking + synthesis prompt templates
│   │
│   ├── db/
│   │   ├── index.ts                        # Drizzle client singleton
│   │   ├── schema.ts                       # All table definitions
│   │   ├── queries.ts                      # Repository functions
│   │   └── migrations/                     # Drizzle migration files
│   │
│   ├── auth/
│   │   └── config.ts                       # Auth.js configuration
│   │
│   └── utils.ts                            # cn() helper, formatters
│
├── hooks/
│   ├── use-council-stream.ts               # SSE client hook
│   └── use-conversations.ts                # Conversation CRUD hook
│
├── middleware.ts                            # Route protection
├── drizzle.config.ts                       # Drizzle CLI config
├── tailwind.config.ts                      # Tailwind + Shadcn theme
├── next.config.ts                          # Next.js config
├── components.json                         # Shadcn UI config
├── tsconfig.json                           # TypeScript strict
├── package.json
├── .env.example                            # Template for env vars
├── .env.local                              # Local env vars (gitignored)
├── .gitignore
├── CLAUDE.md                               # Project-specific AI context
├── README.md
└── docs/
    ├── GAP_ANALYSIS.md
    ├── REQUIREMENTS.md
    ├── DESIGN.md                           # (this file)
    ├── IMPLEMENTATION.md
    └── STATUS.md
```

---

## DS-3: Pipeline Design

### 3-Stage Orchestration (`lib/council/orchestrator.ts`)

Port of `council.py:296-335`. The core algorithm is identical; only the transport changes.

```
stage1_collect() → Promise.allSettled(models.map(queryModel))
    ↓ filter settled.fulfilled
stage2_collect_rankings(query, stage1Results) → Promise.allSettled(models.map(queryModel))
    ↓ parse rankings, build label map, calculate aggregates
stage3_synthesize(query, stage1Results, stage2Results) → queryModel(chairman)
    ↓
return { stage1, stage2, stage3, metadata }
```

**Key design:** `Promise.allSettled()` (not `Promise.all()`) — matches prototype's graceful degradation where individual model failures don't abort the pipeline.

### Vercel AI SDK + OpenRouter (`lib/council/openrouter.ts`)

```typescript
// Pseudocode: Create OpenRouter-compatible provider
import { createOpenAI } from '@ai-sdk/openai';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Query single model
async function queryModel(modelId: string, messages: Message[]) {
  return generateText({
    model: openrouter(modelId),
    messages,
  });
}

// Query all models in parallel
async function queryModelsParallel(modelIds: string[], messages: Message[]) {
  const results = await Promise.allSettled(
    modelIds.map(id => queryModel(id, messages))
  );
  // filter fulfilled, map to { model, response }
}
```

### Prompt Templates (`lib/council/prompts.ts`)

Port verbatim from `council.py`:

1. **Ranking prompt** (lines 64-93): Requires `FINAL RANKING:` header + numbered list
2. **Chairman prompt** (lines 142-157): Full context with all responses + all rankings
3. **Title prompt** (lines 268-272): 3-5 word summary generation

### Ranking Parser (`lib/council/ranking-parser.ts`)

Port of `council.py:177-208`. TypeScript regex implementation:

```typescript
// Primary: Match "FINAL RANKING:" section, extract numbered "Response X" entries
// Fallback 1: Extract any "Response X" patterns after "FINAL RANKING:"
// Fallback 2: Extract any "Response X" patterns in full text
```

### SSE Streaming (`app/api/council/stream/route.ts`)

Port of `main.py:126-194`. Same 6+3 event types:

| Event | Payload | When |
|-------|---------|------|
| `stage1_start` | `{}` | Pipeline begins Stage 1 |
| `stage1_complete` | `{ data: Stage1Response[] }` | All Stage 1 models responded |
| `stage2_start` | `{}` | Pipeline begins Stage 2 |
| `stage2_complete` | `{ data: Stage2Response[], metadata }` | All rankings collected + aggregated |
| `stage3_start` | `{}` | Pipeline begins Stage 3 |
| `stage3_complete` | `{ data: Stage3Response }` | Chairman synthesis complete |
| `title_complete` | `{ data: { title } }` | Auto-title generated |
| `complete` | `{}` | Full pipeline done, data persisted |
| `error` | `{ message }` | Unrecoverable error |

Implementation uses Next.js Route Handler with `ReadableStream` + `TextEncoder`.

---

## DS-4: Streaming Architecture

### Server Side (Route Handler)

```typescript
export async function POST(req: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      send({ type: 'stage1_start' });
      const stage1 = await orchestrator.stage1(query);
      send({ type: 'stage1_complete', data: stage1 });
      // ... stage2, stage3 ...

      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

### Client Side (`hooks/use-council-stream.ts`)

Port of `App.jsx:92-172` SSE state machine:

```typescript
// Fetch with EventSource-like pattern
const response = await fetch('/api/council/stream', { method: 'POST', body });
const reader = response.body.getReader();
const decoder = new TextDecoder();
// Parse SSE lines, dispatch to state reducer
```

---

## DS-5: UI Component Architecture

### Council View Layout

```
┌─────────────────────────────────────────────────┐
│  Header: "Council Session" + model preset badge  │
├──────────┬──────────────────────────────────────┤
│          │                                       │
│ Sidebar  │  Message History                      │
│          │  ┌─────────────────────────────────┐  │
│ Convos   │  │ User Message                    │  │
│ list     │  ├─────────────────────────────────┤  │
│          │  │ Council Response                │  │
│ + New    │  │ ┌─────────────────────────────┐ │  │
│          │  │ │ Tabs: Stage 1 | 2 | 3       │ │  │
│          │  │ │                             │ │  │
│          │  │ │ [Active Stage Panel]        │ │  │
│          │  │ │                             │ │  │
│          │  │ └─────────────────────────────┘ │  │
│          │  └─────────────────────────────────┘  │
│          │                                       │
│          │  ┌─────────────────────────────────┐  │
│          │  │ Chat Input (always visible)      │  │
│          │  └─────────────────────────────────┘  │
└──────────┴──────────────────────────────────────┘
```

### Stage Panel Components

**Stage 1 Panel** (`stage1-panel.tsx`):
- Shadcn `Tabs` for per-model responses
- `react-markdown` rendering
- Loading skeleton during `stage1_start`

**Stage 2 Panel** (`stage2-panel.tsx`):
- Shadcn `Tabs` for per-model evaluations
- De-anonymization: replace "Response X" → **model-name** (client-side)
- Parsed ranking display (ordered list below raw text)
- Aggregate rankings section with position + vote count
- Loading skeleton during `stage2_start`

**Stage 3 Panel** (`stage3-panel.tsx`):
- Chairman model name + badge
- Full synthesis rendered as markdown
- Visually distinct (accent background or border)
- Loading skeleton during `stage3_start`

---

## DS-6: Database Schema

### Entity-Relationship Diagram

```
users 1──────M conversations 1──────M messages
  │                │                    │
  │                │                    ├──1──M stage1_responses
  │                │                    ├──1──M stage2_rankings
  │                │                    ├──1──M stage2_label_map
  │                │                    └──1──1 stage3_synthesis
  │                │
  │                └──M──1 model_presets
  │
  └──1──────M model_presets
```

### Table Definitions (Drizzle)

#### `users` (Auth.js managed)

| Column | Type | Constraints |
|--------|------|-------------|
| id | `text` | PK |
| name | `text` | nullable |
| email | `text` | unique, not null |
| emailVerified | `timestamp` | nullable |
| image | `text` | nullable |
| hashedPassword | `text` | nullable (OAuth users) |

#### `accounts` (Auth.js managed)

| Column | Type | Constraints |
|--------|------|-------------|
| userId | `text` | FK → users, not null |
| type | `text` | not null |
| provider | `text` | not null |
| providerAccountId | `text` | not null |
| refresh_token | `text` | nullable |
| access_token | `text` | nullable |
| expires_at | `integer` | nullable |
| token_type | `text` | nullable |
| scope | `text` | nullable |
| id_token | `text` | nullable |
| session_state | `text` | nullable |

PK: `(provider, providerAccountId)`

#### `sessions` (Auth.js managed)

| Column | Type | Constraints |
|--------|------|-------------|
| sessionToken | `text` | PK |
| userId | `text` | FK → users, not null |
| expires | `timestamp` | not null |

#### `conversations`

| Column | Type | Constraints |
|--------|------|-------------|
| id | `uuid` | PK, default `gen_random_uuid()` |
| userId | `text` | FK → users, not null |
| title | `text` | default `'New Conversation'` |
| modelPresetId | `uuid` | FK → model_presets, nullable |
| createdAt | `timestamp` | default `now()` |
| updatedAt | `timestamp` | default `now()` |

#### `messages`

| Column | Type | Constraints |
|--------|------|-------------|
| id | `uuid` | PK, default `gen_random_uuid()` |
| conversationId | `uuid` | FK → conversations, not null, cascade delete |
| role | `text` | `'user'` or `'assistant'`, not null |
| content | `text` | nullable (null for assistant msgs) |
| createdAt | `timestamp` | default `now()` |

#### `stage1_responses`

| Column | Type | Constraints |
|--------|------|-------------|
| id | `uuid` | PK |
| messageId | `uuid` | FK → messages, not null, cascade delete |
| model | `text` | not null (OpenRouter model ID) |
| response | `text` | not null |
| responseTimeMs | `integer` | nullable |

#### `stage2_rankings`

| Column | Type | Constraints |
|--------|------|-------------|
| id | `uuid` | PK |
| messageId | `uuid` | FK → messages, not null, cascade delete |
| model | `text` | not null |
| rankingText | `text` | not null (full raw evaluation) |
| parsedRanking | `jsonb` | nullable (`["Response C", "Response A", ...]`) |
| responseTimeMs | `integer` | nullable |

#### `stage2_label_map`

| Column | Type | Constraints |
|--------|------|-------------|
| id | `uuid` | PK |
| messageId | `uuid` | FK → messages, not null, cascade delete |
| label | `text` | not null (`"Response A"`) |
| model | `text` | not null (OpenRouter model ID) |

Unique: `(messageId, label)`

#### `stage3_synthesis`

| Column | Type | Constraints |
|--------|------|-------------|
| id | `uuid` | PK |
| messageId | `uuid` | FK → messages, not null, cascade delete |
| model | `text` | not null (chairman model ID) |
| response | `text` | not null |
| responseTimeMs | `integer` | nullable |

#### `model_presets`

| Column | Type | Constraints |
|--------|------|-------------|
| id | `uuid` | PK |
| userId | `text` | FK → users, not null |
| name | `text` | not null |
| councilModels | `jsonb` | not null (`["openai/gpt-5.1", ...]`) |
| chairmanModel | `text` | not null |
| isDefault | `boolean` | default `false` |
| createdAt | `timestamp` | default `now()` |

---

## DS-7: Authentication Design

### Auth.js v5 Configuration

- **Adapter:** Drizzle adapter (uses `users`, `accounts`, `sessions` tables)
- **Providers:**
  1. Credentials (email + bcrypt-hashed password)
  2. Google OAuth
- **Session strategy:** JWT (stateless, no DB session lookups)
- **Callbacks:** `session` callback attaches `user.id` to session token

### Route Protection (middleware.ts)

```
Public routes:     /login, /register, /api/auth/*
Protected routes:  /council/*, /settings/*, /analytics/*, /api/conversations/*, /api/council/*
Redirect:          Unauthenticated → /login
```

### Conversation Ownership

Every query includes `WHERE userId = session.user.id`. No shared conversations.

---

## DS-8: Model Configuration Design

### Default Preset

Matches the prototype's hardcoded config:

```json
{
  "name": "Default Council",
  "councilModels": [
    "openai/gpt-5.1",
    "google/gemini-3-pro-preview",
    "anthropic/claude-sonnet-4.5",
    "x-ai/grok-4"
  ],
  "chairmanModel": "google/gemini-3-pro-preview",
  "isDefault": true
}
```

### OpenRouter Model Discovery

`GET /api/models` proxies to OpenRouter's `/api/v1/models` endpoint, filtered to chat-capable models. Returns model ID, name, context length, and pricing.

---

## DS-9: Analytics Design

Stored data enables these queries:

| Metric | Source Tables | Query Pattern |
|--------|-------------|---------------|
| Win rate | `stage2_rankings` + `stage2_label_map` | Count #1 positions per model |
| Avg rank | `stage2_rankings` + `stage2_label_map` | AVG position per model |
| Response time | `stage1_responses`, `stage2_rankings`, `stage3_synthesis` | AVG `responseTimeMs` per model |
| Usage count | `messages` | COUNT per time period |
| Cost estimation | Token counts (future) | Sum tokens × model pricing |

### Charts (Recharts)

- **Win rate bar chart:** model on X, win % on Y
- **Response time line chart:** date on X, ms on Y, line per model
- **Usage summary cards:** total queries, avg response time, favorite model

---

## DS-10: Export Design

| Format | Implementation | Content |
|--------|---------------|---------|
| Markdown | Server action → string builder | Full conversation with all 3 stages |
| PDF | `@react-pdf/renderer` or `html-to-pdf` | Same content, formatted |
| CSV | Server action → CSV string | Analytics data (rankings, times) |

---

## DS-11: Performance Design

| Target | Strategy |
|--------|----------|
| FCP < 1.5s | Server Components for initial render, streaming SSR |
| Bundle < 200KB | Dynamic imports for Recharts, react-markdown |
| CLS < 0.1 | Skeleton loaders with fixed dimensions |
| FID < 100ms | Minimal client JS, defer non-critical |
| Lighthouse > 90 | Optimize images, fonts, code splitting |

---

## DS-12: Testing Strategy

| Layer | Tool | Coverage Target |
|-------|------|----------------|
| Unit | Vitest | `orchestrator.ts`, `ranking-parser.ts`, `prompts.ts` |
| Component | React Testing Library | All council panels, layout components |
| Integration | Vitest + MSW | API routes with mocked OpenRouter |
| E2E | Playwright (future) | Critical user flows |

### Mock Strategy

- MSW intercepts OpenRouter API calls with fixture responses
- Drizzle test database (separate Neon branch or SQLite)
- Auth.js test session helpers

---

## Key Design Decisions

### 1. Vercel AI SDK + OpenRouter

**Decision:** Use `@ai-sdk/openai` compatible provider pointed at OpenRouter base URL.

**Rationale:** Gets streaming (`streamText()`), structured output (`generateObject()`), and tool use for free while accessing 200+ models through a single API. The AI SDK abstracts provider differences, so switching from OpenRouter to direct API calls requires only changing the provider config.

**Trade-off:** One extra hop (Vercel → OpenRouter → model provider) adds ~50ms latency. Acceptable for the flexibility of multi-model access.

### 2. Drizzle ORM over Raw SQL

**Decision:** Drizzle ORM with `@vercel/postgres` driver.

**Rationale:** Type-safe queries that catch schema mismatches at compile time. Migration tooling for schema evolution. Same stack as System DNA Workbench, reducing cognitive overhead.

**Trade-off:** Slightly more verbose than raw SQL for complex queries. Drizzle's query builder handles our use cases well.

### 3. Normalized Schema (7 Tables)

**Decision:** Fully normalized with separate tables for each stage's data.

**Rationale:** Fixes the prototype's biggest flaw (metadata not persisted). Enables analytics queries, historical ranking comparisons, and per-model performance tracking. Rankings, label maps, and aggregate scores are all queryable.

**Trade-off:** More JOINs for conversation loading. Mitigated by efficient queries in `lib/db/queries.ts`.

### 4. SSE over WebSockets

**Decision:** Server-Sent Events via Route Handler `ReadableStream`.

**Rationale:** Matches prototype's SSE pattern exactly. Simpler than WebSockets for one-way server→client streaming. Works with Vercel's serverless/edge functions. No persistent connection management needed.

**Trade-off:** Can't push server-initiated events (not needed for our use case).

### 5. JWT Sessions over Database Sessions

**Decision:** JWT-based sessions in Auth.js.

**Rationale:** No database lookup per request. Stateless, scales with Vercel edge. Session data (user.id) is small enough for JWT payload.

**Trade-off:** Can't revoke individual sessions (acceptable for this app).

### 6. Client-Side De-anonymization

**Decision:** Label-to-model mapping sent to client; replacement happens in browser.

**Rationale:** Preserves prototype's pattern. Models never see each other's names during evaluation. Users see both the anonymous labels and the revealed names for transparency.

**Trade-off:** None significant. Small mapping object, no security concern (it's the user's own data).
