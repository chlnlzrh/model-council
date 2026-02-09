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

## DS-5.1: UI Standards (from CLAUDE.md)

All UI implementation must follow these specifications. Sourced from the project's governing CLAUDE.md.

### Typography

| Element | Specification |
|---------|--------------|
| Font family | Inter (via `next/font/google`) |
| Baseline size | `text-xs` (`12px`) |
| Baseline weight | `font-normal` (`400`) |
| Headers | `font-bold` allowed, must remain `text-xs` |
| Navigation labels | `text-xs font-normal` (never bold) |
| Dashboard content | Match menu typography exactly |
| Line height | Tailwind tokens only (`leading-*`) |
| Scale | Tokenized — no raw `px` or `rem` values outside tokens |

### Icons

| Aspect | Rule |
|--------|------|
| Library | Lucide React exclusively |
| Max size | 16x16px |
| Stroke | Default (2px) |

### Color System

| Aspect | Rule |
|--------|------|
| Tokens | Semantic only: `primary`, `secondary`, `success`, `error`, `warning`, `info` |
| Hardcoded values | **FORBIDDEN** — no hex/rgb/hsl literals |
| Contrast | WCAG AA: 4.5:1 normal text, 3:1 large text |
| Color blindness | Never rely solely on color to convey meaning |
| Dark mode | Full light + dark implementations with visual parity |
| System preference | `prefers-color-scheme` detection via `next-themes` |

### Spacing

| Aspect | Rule |
|--------|------|
| System | Tailwind tokens only (4px/8px base grid) |
| Custom values | **FORBIDDEN** — use nearest Tailwind token |
| Menu items | `py-1` to `py-1.5` max |
| Section gaps | `space-y-0.5` |
| Nesting indent | `ml-4` (level 2), `ml-6` (level 3), max 3 levels |

### Menu System

| Aspect | Rule |
|--------|------|
| Default state | All sections collapsed (`expandedSections: []`) |
| Selected item | `text-black dark:text-white` |
| Unselected item | `text-gray-500` |
| Hover state | `text-gray-700 dark:text-gray-300` with transition |
| Headers | Same `text-xs`, chevron indicators, full-area click targets |
| Content | Essential labels only — no descriptions or explanations |
| Persistence | Expanded/collapsed state in `localStorage` |
| Search | `text-xs`, real-time filter, `Cmd/Ctrl+K` shortcut |
| Scroll | Smooth scroll, visible scrollbar on hover, sticky headers |

### Sidebar

| Breakpoint | Behavior |
|-----------|----------|
| Desktop (≥1024px) | Collapsed icon-only by default, expands on hover/click |
| Tablet (768-1023px) | Hidden, toggle via hamburger |
| Mobile (<768px) | Hamburger → full-screen slide panel |

| Mobile Detail | Rule |
|--------------|------|
| Touch spacing | `py-2` minimum |
| Dismiss | Swipe gesture supported |
| Backdrop | Blur + dim overlay |
| Animation | 300ms spring transition |

### Animation & Motion

| Aspect | Rule |
|--------|------|
| Duration | 300ms spring (default) |
| Frame rate | 60fps minimum |
| Easing | Spring curve with staggered reveals |
| Reduced motion | Respect `prefers-reduced-motion` — disable animations, provide equivalent static feedback |
| Purpose | Motion must clarify state or provide feedback — no gratuitous animation |
| Backdrop effects | Blur + shadow gradients for overlays |

### Responsive Breakpoints

| Name | Width | Priority |
|------|-------|----------|
| Mobile S | 320px | Required |
| Mobile L | 375px | Required |
| Tablet | 768px | Required |
| Desktop | 1024px | Required |
| Desktop L | 1440px | Required |

**Approach:** Mobile-first — start at 320px, scale up.

### Touch Targets

| Platform | Minimum Size |
|----------|-------------|
| iOS | 44×44pt |
| Android | 48×48dp |
| Spacing | Adequate gap between adjacent targets |

### Loading States

| Condition | Pattern |
|-----------|---------|
| Content loading | Skeleton screens (fixed dimensions to prevent CLS) |
| Actions < 3s | Spinner |
| Actions > 3s | Progress bar |
| Actions > 5s | Progress bar + informative message |

### Empty States

| Element | Required |
|---------|----------|
| Explanation | Clear reason why content is empty |
| Next step | Actionable call-to-action |
| Visual | Helpful illustration or icon |
| Design | Consistent with app design language |

### Error States

| Element | Required |
|---------|----------|
| What | What went wrong (user-friendly terms) |
| Why | Why it happened (if known) |
| Fix | How to resolve (actionable steps) |
| Fallback | Retry button or alternative path |

### Modals & Dialogs

| Behavior | Rule |
|----------|------|
| Background | Dim overlay |
| Close: Escape | Required |
| Close: Background click | Yes (unless destructive action) |
| Focus | Trapped inside modal while open |
| Focus return | Return to trigger element on close |
| Background scroll | Prevented |
| Title | Clear and descriptive |
| Actions | Explicit buttons — cancel always available |
| Async actions | Loading state on confirm button |

### Accessibility

| Aspect | Rule |
|--------|------|
| Keyboard nav | Full: arrow keys, Enter, Escape, Tab |
| ARIA labels | All interactive elements, with expansion state |
| Focus trapping | Inside open menus and modals |
| Screen readers | Stage panel changes announced |
| Component library | Shadcn (Radix) provides baseline a11y |

### Component State Completeness

Every interactive component must implement all 6 states:

| State | Required |
|-------|----------|
| Default | Yes |
| Hover | Yes |
| Focus | Yes (visible focus ring) |
| Loading | Yes (for async) |
| Error | Yes |
| Disabled | Yes |

### Performance Budgets

| Metric | Target |
|--------|--------|
| First Contentful Paint | < 1.5s |
| Time to Interactive | < 3s |
| Cumulative Layout Shift | < 0.1 |
| First Input Delay | < 100ms |
| Lighthouse Performance | > 90 |
| Initial bundle | < 200KB |

### Data Tables (Analytics)

| Breakpoint | Pattern |
|-----------|---------|
| Mobile | Card layout per row |
| Desktop | Standard table with horizontal scroll if needed |
| Features | Sort by columns, filter controls, pagination |

### Breadcrumbs

| Aspect | Rule |
|--------|------|
| Typography | `text-xs` |
| Behavior | Reflect current menu selection, interactive links |
| Hierarchy | Match navigation depth |

---

## DS-5.2: Mockup-Driven UI Enhancements

Based on HTML mockup review (2026-02-09), these refinements address gaps discovered during visual prototyping.

### Progressive Stage Rendering (REQ-UI-011, REQ-UI-012)

The SSE pipeline delivers stages sequentially. The UI must reflect this:

```
Stage 1 loading:  [skeleton] [skeleton] [skeleton]
Stage 1 partial:  [Model A ✓] [Model B ✓] [skeleton]  ← models appear as they arrive
Stage 1 done:     [Model A] [Model B] [Model C] [Model D]
Stage 2 loading:  Stage 1 content stays visible, Stage 2 tab shows spinner
Stage 2 done:     Rankings visible, Stage 3 tab shows spinner
Stage 3 done:     All three tabs fully populated
```

- Each model response renders independently as it arrives from the SSE stream
- Completed stages remain visible and interactive while later stages load
- Stage tabs show status dots: green (done), yellow pulsing (loading), gray (pending)

### De-anonymization Reveal (REQ-UI-013)

Stage 2 evaluations reference anonymous labels ("Response A"). The UI provides a visual mapping:

```
Label Map (shown at top of Stage 2):
  Response A → Claude Opus 4.6
  Response B → OpenAI o3
  Response C → Gemini 2.5 Pro
  Response D → Perplexity Sonar Pro
```

- Shown as colored pills/badges at the top of the Stage 2 panel
- Within evaluation text, "Response X" is highlighted with the model's assigned color
- Hover on "Response A" shows the model name in a tooltip

### Collapsible Responses (REQ-UI-015)

Long model responses (>300 characters) default to collapsed with "Show more" toggle:

- First ~4 lines visible with gradient fade
- Click "Show more" to expand; "Show less" to collapse
- Synthesis (Stage 3) is always expanded by default

### Copy Button (REQ-UI-016)

- Floating copy icon on hover for synthesis and individual responses
- Click copies plain text (stripped markdown)
- Brief "Copied!" toast confirmation

### Model Identity Colors (REQ-UI-017)

Each model gets a consistent HSL-based color:

| Model Index | Color | Usage |
|-------------|-------|-------|
| Model 0 | Blue (`hsl(220, 70%, 55%)`) | Tab pill, ranking dot, label highlight |
| Model 1 | Green (`hsl(160, 70%, 40%)`) | Same |
| Model 2 | Orange (`hsl(30, 85%, 55%)`) | Same |
| Model 3 | Purple (`hsl(280, 60%, 55%)`) | Same |
| Model 4+ | Gray (`hsl(0, 0%, 55%)`) | Fallback |

Colors apply to: model tab pills, ranking position badges, de-anonymization labels, response time bars.

### Elapsed Time Indicator (REQ-UI-018)

During pipeline execution, the chat input area shows:

```
Stage 1 of 3 · Collecting responses... (8s)
Stage 2 of 3 · Ranking responses... (12s)
Stage 3 of 3 · Synthesizing... (5s)
```

Timer increments every second. Resets per stage.

### Response Time Comparison (REQ-UI-014)

Stage 1 model tabs show response time as a subtle badge:

```
[Claude Opus 4.6  10.9s] [OpenAI o3  6.8s] [Gemini 2.5 Pro  21.0s]
```

Fastest model gets a subtle highlight (e.g., green text on the time).

### Aggregate Ranking Scale (REQ-UI-020)

Ranking bars use relative scale where:
- Bar width = `(numModels - avgRank + 1) / numModels * 100%`
- Ensures #1 ranked is always full width, last place is minimal

### Mobile Scroll Affordance (REQ-UI-019)

Model pill tabs on mobile:
- Horizontal scroll container with `overflow-x: auto`
- Left/right gradient fade (16px) indicating more content
- Fade disappears when scrolled to the respective edge

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
