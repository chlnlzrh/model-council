# Implementation Plan: Model Council

> 5-phase build plan with dependencies, deliverables, and verification criteria.
> Each phase is independently deployable. Phases build on each other sequentially.

---

## Phase Overview

| Phase | Focus | Depends On | Key Deliverables | Est. Files |
|-------|-------|-----------|-----------------|------------|
| **1** | Skeleton + Core Pipeline | Nothing | Working 3-stage pipeline, SSE endpoint, unit tests | ~15 |
| **2** | UI (Shadcn, Dark Mode, Responsive) | Phase 1 | Full dashboard UI, SSE client hook, all stage panels | ~25 |
| **3** | Database + Auth | Phase 1 | Drizzle schema, Auth.js, route protection, persistence | ~12 |
| **4** | New Features (Models, Multi-turn, Analytics, Export) | Phases 2+3 | Settings UI, analytics dashboard, export | ~15 |
| **5** | Polish + Testing (Coverage, A11y, Perf) | Phase 4 | 80% coverage, WCAG AA, Lighthouse >90 | ~20 |

---

## Phase 1: Skeleton + Core Pipeline

**Goal:** Next.js project with working 3-stage pipeline callable via API. No UI yet — just the engine.

### 1.1 Project Initialization

| Task | Command / Action | Output |
|------|-----------------|--------|
| Create Next.js app | `npx create-next-app@latest model-council --typescript --tailwind --app --src=no` | `app/`, `package.json`, `tsconfig.json` |
| Configure TypeScript strict | Edit `tsconfig.json`: `strict: true` | Compile-time type safety |
| Install Shadcn UI | `npx shadcn@latest init` | `components.json`, `lib/utils.ts` |
| Install Drizzle | `npm i drizzle-orm @vercel/postgres` + `npm i -D drizzle-kit` | ORM ready |
| Install AI SDK | `npm i ai @ai-sdk/openai` | LLM transport ready |
| Install dev deps | `npm i -D vitest @testing-library/react msw` | Test infra ready |
| Create `.env.example` | Template with all required env vars | Developer onboarding |
| Create `.gitignore` | Standard Next.js + `.env.local` | Clean repo |

### 1.2 Type System (`lib/council/types.ts`)

All TypeScript interfaces for the pipeline. Req: REQ-FW-002.

```typescript
// Core types (pseudocode)
interface Stage1Response { model: string; response: string; responseTimeMs?: number }
interface Stage2Response { model: string; rankingText: string; parsedRanking: string[] }
interface Stage3Response { model: string; response: string; responseTimeMs?: number }
interface LabelMap { [label: string]: string }  // "Response A" → "openai/gpt-5.1"
interface AggregateRanking { model: string; averageRank: number; rankingsCount: number }
interface CouncilResult { stage1: Stage1Response[]; stage2: Stage2Response[]; stage3: Stage3Response; metadata: CouncilMetadata }
interface CouncilMetadata { labelToModel: LabelMap; aggregateRankings: AggregateRanking[] }
interface SSEEvent { type: string; data?: unknown; metadata?: unknown; message?: string }
```

### 1.3 OpenRouter Client (`lib/council/openrouter.ts`)

Vercel AI SDK + OpenRouter integration. Reqs: REQ-SDK-001 through REQ-SDK-005.

- Create OpenAI-compatible provider with OpenRouter base URL
- `queryModel(modelId, messages)` — single model query with timing
- `queryModelsParallel(modelIds, messages)` — `Promise.allSettled()` with timing
- Graceful degradation: failed models return `null`, pipeline continues

### 1.4 Prompt Templates (`lib/council/prompts.ts`)

Port verbatim from `council.py`. Reqs: REQ-CURR-003, REQ-CURR-004, REQ-CURR-006.

- `buildRankingPrompt(query, stage1Results)` — Stage 2 prompt with FINAL RANKING format
- `buildChairmanPrompt(query, stage1Results, stage2Results)` — Stage 3 synthesis prompt
- `buildTitlePrompt(query)` — 3-5 word title generation

### 1.5 Ranking Parser (`lib/council/ranking-parser.ts`)

Port of `council.py:177-208`. Req: REQ-CURR-005.

- `parseRankingFromText(text)` — extract FINAL RANKING section
- `calculateAggregateRankings(stage2Results, labelToModel)` — avg position calculation
- Regex: `/\d+\.\s*Response [A-Z]/g` with fallback patterns

### 1.6 Orchestrator (`lib/council/orchestrator.ts`)

Port of `council.py:296-335`. Req: REQ-CURR-001.

- `runFullCouncil(query, models, chairman)` — complete 3-stage pipeline
- `stage1Collect(query, models)` — parallel model queries
- `stage2CollectRankings(query, stage1Results, models)` — anonymize + rank
- `stage3Synthesize(query, stage1Results, stage2Results, chairman)` — chairman synthesis
- `generateConversationTitle(query)` — title generation

### 1.7 SSE Streaming Endpoint (`app/api/council/stream/route.ts`)

Port of `main.py:126-194`. Req: REQ-CURR-009.

- POST handler accepting `{ content, models?, chairman? }`
- `ReadableStream` + `TextEncoder` for SSE
- Emits all 9 event types (stage[1-3]_start/complete, title_complete, complete, error)
- Error boundary: catches exceptions, emits `error` event

### 1.8 Unit Tests

Req: REQ-NFR-004 (partial — start building test foundation).

| Test File | Coverage |
|-----------|----------|
| `ranking-parser.test.ts` | All regex paths, edge cases, empty input, malformed input |
| `orchestrator.test.ts` | Pipeline flow with mocked OpenRouter, partial failures |
| `prompts.test.ts` | Prompt template output validation |

### Phase 1 Verification

- [x] `npm run dev` starts without errors
- [x] `POST /api/council/stream` with test query returns SSE events
- [x] All 9 stage events fire in correct order (tested live on Vercel)
- [x] Ranking parser correctly extracts from sample texts (18 tests)
- [x] `npm run test` passes — 42 tests across 3 test files
- [x] TypeScript compiles with zero errors in strict mode
- [x] Deployed to Vercel: https://model-council-pink.vercel.app

---

## Phase 2: UI (Shadcn, Dark Mode, Responsive)

**Goal:** Full dashboard UI consuming the Phase 1 SSE endpoint. No database yet — conversations are client-side state.

### 2.1 Root Layout (`app/layout.tsx`)

- Inter font via `next/font/google`
- ThemeProvider from `next-themes`
- Metadata (title, description)
- `globals.css` with Tailwind imports + CSS variables

### 2.2 Shadcn Components

Install via CLI:

```bash
npx shadcn@latest add button card tabs badge skeleton toast separator sheet textarea scroll-area
```

Also install:
```bash
npm i react-markdown
```

### 2.3 Model Colors Utility (`lib/council/model-colors.ts`)

Consistent HSL-based colors for model identity across all UI. Req: REQ-UI-017.

- `getModelColor(index)` → returns HSL color string
- `getModelColorClass(index)` → returns Tailwind-compatible class
- Color palette: blue, green, orange, purple, gray (fallback for 5+)

### 2.4 SSE Client Hook (`hooks/use-council-stream.ts`)

Port of `App.jsx:92-172` state machine. Reqs: REQ-CURR-010, REQ-UI-011, REQ-UI-012.

- `useCouncilStream()` hook returning `{ sendMessage, stage1, stage2, stage3, title, currentStage, isLoading, error, elapsedMs }`
- Fetch with `ReadableStream` reader
- Parse SSE lines → dispatch to React state
- Per-stage loading flags + elapsed time counter (REQ-UI-018)
- Individual model responses tracked as they arrive

### 2.5 Dashboard Layout (`app/(dashboard)/layout.tsx`)

- Sidebar component (conversation list + nav links)
- Main content area with max-width centering
- Mobile hamburger navigation with overlay
- Theme toggle in header

### 2.6 Sidebar (`components/layout/sidebar.tsx`)

- Conversation list (from client state initially)
- "New Council" button
- Nav links: Council, Settings, Analytics
- Collapsible on desktop, Shadcn Sheet slide panel on mobile
- Active conversation highlighted
- Model count in footer

### 2.7 Council Page (`app/(dashboard)/council/page.tsx`)

- Empty state: "Ask the Council" with description
- New council form: chat input at bottom
- On submit: create new conversation in client state, navigate to council view

### 2.8 Council View (`app/(dashboard)/council/[id]/page.tsx`)

- Message list showing user messages + council responses
- Each council response has 3-tab stage view with status dots
- Chat input fixed at bottom
- Auto-scroll to latest message

### 2.9 Stage 1 Panel (`components/council/stage1-panel.tsx`)

Reqs: REQ-CURR-011, REQ-UI-012, REQ-UI-014, REQ-UI-015.

- Model pill tabs with assigned colors (REQ-UI-017)
- Response time badge on each tab (e.g., "6.8s") — fastest highlighted green
- ReactMarkdown rendering for response content
- Collapsible responses: >300 chars shows "Show more" with gradient fade (REQ-UI-015)
- Copy button on hover (REQ-UI-016)
- Skeleton loader during stage1_start, individual skeletons per model

### 2.10 Stage 2 Panel (`components/council/stage2-panel.tsx`)

Reqs: REQ-CURR-012, REQ-CURR-014, REQ-UI-013, REQ-UI-020.

- **De-anonymization label map** at top: colored pills showing "Response A → Claude Opus 4.6" (REQ-UI-013)
- Model tabs for individual evaluations
- Within evaluation text, highlight "Response X" with model's assigned color
- Parsed ranking displayed as ordered list
- **Aggregate rankings section**:
  - Position badge (1st, 2nd, 3rd, 4th) with rank colors
  - Model name
  - Bar chart: width = `(numModels - avgRank + 1) / numModels * 100%` (REQ-UI-020)
  - Average rank score

### 2.11 Stage 3 Panel (`components/council/stage3-panel.tsx`)

Reqs: REQ-CURR-006, REQ-UI-016.

- Chairman badge with accent color
- Full synthesis with ReactMarkdown — always expanded (not collapsible)
- Visually distinct: accent left border + light accent background
- Copy button (REQ-UI-016)
- Response time + "Synthesized from N models" meta

### 2.12 Chat Input (`components/council/chat-input.tsx`)

Reqs: REQ-CURR-018, REQ-UI-018.

- Multiline textarea (auto-resize, max 5 rows)
- Enter to send, Shift+Enter for newline
- Disabled during pipeline execution with stage progress text
- Elapsed time indicator: "Stage 1 of 3 · Collecting responses... (8s)" (REQ-UI-018)
- Send button with loading state

### 2.13 Dark Mode + Theme

- `next-themes` ThemeProvider with system detection
- CSS variables for all colors (Shadcn default theme)
- Toggle component in sidebar footer
- `prefers-color-scheme` respected

### 2.14 Responsive Layout

Reqs: REQ-UI-004, REQ-UI-019.

- Mobile-first breakpoints: 320/375/768/1024/1440px
- Sidebar: full on desktop (260px), Sheet slide-in on mobile
- Model pill tabs: horizontal scroll with gradient fade edges on mobile (REQ-UI-019)
- Stage tabs: horizontal scroll on narrow screens
- Touch targets: 44px minimum
- Chat input: full width, centered with max-width matching messages

### Phase 2 Verification

- [ ] Full UI renders at all 5 breakpoints
- [ ] Dark mode toggles correctly
- [ ] SSE streaming updates all 3 stage panels progressively
- [ ] Loading skeletons appear during each stage with elapsed time
- [ ] Individual model responses appear as they arrive
- [ ] De-anonymization label map displays correctly in Stage 2
- [ ] Aggregate ranking bars use correct relative scale
- [ ] Long responses collapse with "Show more"
- [ ] Copy button works on synthesis and individual responses
- [ ] Model colors are consistent across all stages
- [ ] Keyboard navigation works (Tab, Enter, Escape)
- [ ] Sidebar collapses/expands on mobile
- [ ] Model pill tabs scroll horizontally with fade on mobile

---

## Phase 3: Database + Auth

**Goal:** Persistent storage + user authentication. Conversations saved to Neon Postgres.

### 3.1 Drizzle Schema (`lib/db/schema.ts`)

All 9 tables from DS-6:
- `users`, `accounts`, `sessions`, `verificationTokens` (Auth.js)
- `conversations`, `messages`, `stage1Responses`, `stage2Rankings`, `stage2LabelMap`, `stage3Synthesis`, `modelPresets`

### 3.2 Drizzle Configuration (`drizzle.config.ts`)

```typescript
// Points to POSTGRES_URL, schema at lib/db/schema.ts
// Migration output to lib/db/migrations/
```

### 3.3 Database Client (`lib/db/index.ts`)

- Drizzle client singleton using `@vercel/postgres` pool
- Export `db` instance

### 3.4 Repository Functions (`lib/db/queries.ts`)

| Function | Tables | Req |
|----------|--------|-----|
| `createConversation(userId, title?)` | conversations | REQ-CURR-015 |
| `listConversations(userId)` | conversations | REQ-CURR-015 |
| `getConversation(id, userId)` | conversations + messages + stages | REQ-CURR-015 |
| `deleteConversation(id, userId)` | conversations (cascade) | REQ-CURR-015 |
| `saveCouncilResponse(messageId, result)` | stage1/2/3 tables + label_map | REQ-CURR-001 |
| `updateConversationTitle(id, title)` | conversations | REQ-CURR-016 |
| `getAnalytics(userId, dateRange?)` | stage2_rankings + label_map | REQ-AN-001 |

### 3.5 Auth.js Configuration (`lib/auth/config.ts`)

- Drizzle adapter
- Credentials provider (email + bcrypt via `bcryptjs`)
- Google OAuth provider (optional, env-gated)
- JWT session strategy
- `session` callback: attach `user.id`

### 3.6 Auth Route Handler (`app/api/auth/[...nextauth]/route.ts`)

- Re-export Auth.js GET and POST handlers

### 3.7 Login + Register Pages

**`app/(auth)/login/page.tsx`:**
- Email + password form (React Hook Form + Zod)
- Google OAuth button (if configured)
- Link to register

**`app/(auth)/register/page.tsx`:**
- Name + email + password form
- Password strength indicator
- Link to login

### 3.8 Middleware (`middleware.ts`)

- Match protected routes: `/council/:path*`, `/settings/:path*`, `/analytics/:path*`
- Match protected API routes: `/api/conversations/:path*`, `/api/council/:path*`
- Redirect to `/login` if no session
- Allow: `/login`, `/register`, `/api/auth/:path*`

### 3.9 Wire Database to Pipeline

- Update SSE endpoint to save results after pipeline completes
- Update conversation list to fetch from DB
- Add user ownership to all queries

### 3.10 Migrations

```bash
npx drizzle-kit generate  # Generate SQL migrations
npx drizzle-kit push      # Push to Neon
```

### Phase 3 Verification

- [ ] `npm run db:push` creates all tables in Neon
- [ ] Login/register flow works (email/password)
- [ ] Unauthenticated users redirected to /login
- [ ] Conversations persist across page reloads
- [ ] User A cannot see User B's conversations
- [ ] Rankings and label maps persisted to DB
- [ ] `npm run test` passes with DB integration tests

---

## Phase 4: New Features

**Goal:** Model configuration, multi-turn, analytics, and export.

### 4.1 Settings Page (`app/(dashboard)/settings/page.tsx`)

- Model picker: searchable multi-select from OpenRouter model list
- Chairman selector: dropdown from selected council models (or separate)
- Preset manager: save/load/delete named presets
- Default preset indicator

Reqs: REQ-MODEL-001 through REQ-MODEL-006.

### 4.2 OpenRouter Model Discovery (`app/api/models/route.ts`)

- GET endpoint proxying to `https://openrouter.ai/api/v1/models`
- Filter to chat-capable models
- Return: id, name, context_length, pricing
- Cache response (5 min TTL)

Req: REQ-MODEL-004.

### 4.3 Multi-Turn Conversations

- Always-visible chat input at bottom of conversation view
- Include conversation history in model context
- Build context from `messages` table (user + assistant synthesis)
- Token counting: estimate tokens, truncate oldest messages when limit approached

Reqs: REQ-MT-001 through REQ-MT-004.

### 4.4 Analytics Dashboard (`app/(dashboard)/analytics/page.tsx`)

- Win rate bar chart (Recharts `BarChart`)
- Response time line chart (Recharts `LineChart`)
- Usage summary cards (total queries, avg time, top model)
- Date range filter

Reqs: REQ-AN-001 through REQ-AN-005.

### 4.5 Export

- Markdown export: Server Action generating markdown string, trigger download
- PDF export: `@react-pdf/renderer` or html-to-pdf
- CSV export: Server Action for analytics data

Reqs: REQ-EX-001 through REQ-EX-003.

### 4.6 Conversation API Routes

- `GET /api/conversations` — list user's conversations
- `POST /api/conversations` — create new conversation
- `GET /api/conversations/[id]` — get with all stages
- `DELETE /api/conversations/[id]` — soft or hard delete

Req: REQ-CURR-015.

### Phase 4 Verification

- [ ] Settings page: select models, save preset, load preset
- [ ] New council sessions use selected model preset
- [ ] Multi-turn: follow-up question includes prior context
- [ ] Analytics: charts render with real data
- [ ] Export: Markdown download works, content is complete
- [ ] OpenRouter model list loads and is searchable

---

## Phase 5: Polish + Testing

**Goal:** Production-ready quality — test coverage, accessibility, performance.

### 5.1 Test Suite

| Test Type | Tool | Target |
|-----------|------|--------|
| Unit | Vitest | `lib/council/*`, `lib/db/queries.ts` |
| Component | React Testing Library | All components in `components/council/`, `components/layout/` |
| Integration | Vitest + MSW | API route handlers with mocked OpenRouter |
| E2E | Playwright | Login → create council → view results → export |

**Coverage target:** 80% minimum (REQ-NFR-004).

### 5.2 Accessibility Audit

- Keyboard navigation: all interactive elements reachable via Tab
- ARIA labels: all buttons, tabs, dialogs properly labeled
- Contrast: WCAG AA (4.5:1 normal text, 3:1 large text)
- Screen reader testing: verify stage panel announcements
- Focus management: focus trapped in modals, returned on close
- `prefers-reduced-motion`: disable animations

Req: REQ-UI-006.

### 5.3 Responsive Audit

Test at all 5 breakpoints (320/375/768/1024/1440px):
- Sidebar behavior (collapse/expand)
- Stage tabs (horizontal scroll)
- Chat input (full width)
- Touch targets (44px min)
- No horizontal overflow

Req: REQ-UI-004.

### 5.4 Performance Optimization

| Metric | Target | Strategy |
|--------|--------|----------|
| FCP | < 1.5s | Server Components, streaming SSR |
| TTI | < 3s | Code splitting, dynamic imports |
| Bundle | < 200KB | Dynamic import Recharts, react-markdown |
| CLS | < 0.1 | Fixed-dimension skeletons |
| Lighthouse | > 90 | Image optimization, font loading |

Reqs: REQ-NFR-001 through REQ-NFR-003, REQ-NFR-006, REQ-NFR-007.

### 5.5 Security Hardening

- Env vars: verify no secrets in client bundle
- Input sanitization: all user inputs validated (Zod)
- Rate limiting: consider for API routes
- CSRF: Auth.js handles via token
- XSS: React's default escaping + no `dangerouslySetInnerHTML`

Req: REQ-NFR-005.

### 5.6 Vercel Deployment

- Configure Vercel project
- Set environment variables (POSTGRES_URL, AUTH_SECRET, OPENROUTER_API_KEY, GOOGLE_CLIENT_ID/SECRET)
- Verify build passes
- Test production URL

Req: REQ-FW-003.

### Phase 5 Verification

- [ ] `npm run test` passes with 80%+ coverage
- [ ] Lighthouse score > 90 on all pages
- [ ] WCAG AA compliance verified
- [ ] All 5 responsive breakpoints tested
- [ ] No console errors in production build
- [ ] Vercel deployment successful
- [ ] All environment variables set in Vercel dashboard

---

## Dependency Graph

```
Phase 1 ─────→ Phase 2 ─────┐
    │                         ├──→ Phase 4 ──→ Phase 5
    └────────→ Phase 3 ─────┘
```

- Phase 2 (UI) and Phase 3 (DB + Auth) can proceed in parallel after Phase 1
- Phase 4 (Features) requires both Phase 2 and Phase 3
- Phase 5 (Polish) requires Phase 4

---

## File Tracker

Every target file with its phase and status. Updated in STATUS.md as files are created.

| File | Phase | Status |
|------|-------|--------|
| `lib/council/types.ts` | 1 | **Done** |
| `lib/council/openrouter.ts` | 1 | **Done** |
| `lib/council/prompts.ts` | 1 | **Done** |
| `lib/council/ranking-parser.ts` | 1 | **Done** |
| `lib/council/orchestrator.ts` | 1 | **Done** |
| `app/api/council/stream/route.ts` | 1 | **Done** |
| `__tests__/ranking-parser.test.ts` | 1 | **Done** |
| `__tests__/orchestrator.test.ts` | 1 | **Done** |
| `__tests__/prompts.test.ts` | 1 | **Done** |
| `lib/council/modes/index.ts` | Multi-Mode | **Done** |
| `lib/council/modes/vote.ts` | Multi-Mode | **Done** |
| `lib/council/modes/chain.ts` | Multi-Mode | **Done** |
| `lib/council/modes/specialist-panel.ts` | Multi-Mode | **Done** |
| `lib/council/modes/jury.ts` | Multi-Mode | **Done** |
| `lib/council/modes/debate.ts` | Multi-Mode | **Done** |
| `lib/council/modes/delphi.ts` | Multi-Mode | **Done** |
| `lib/council/modes/red-team.ts` | Multi-Mode | **Done** |
| `lib/council/modes/blueprint.ts` | Multi-Mode | **Done** |
| `lib/council/modes/peer-review.ts` | Multi-Mode | **Done** |
| `lib/council/modes/tournament.ts` | Multi-Mode | **Done** |
| `lib/council/modes/confidence-weighted.ts` | Multi-Mode | **Done** |
| `lib/council/modes/decompose.ts` | Multi-Mode | Planned |
| `lib/council/modes/brainstorm.ts` | Multi-Mode | Planned |
| `lib/council/modes/fact-check.ts` | Multi-Mode | Planned |
| `__tests__/shared-infrastructure.test.ts` | Multi-Mode | **Done** |
| `__tests__/vote-mode.test.ts` | Multi-Mode | **Done** |
| `__tests__/chain-mode.test.ts` | Multi-Mode | **Done** |
| `__tests__/specialist-panel-mode.test.ts` | Multi-Mode | **Done** |
| `__tests__/jury-mode.test.ts` | Multi-Mode | **Done** |
| `__tests__/debate-mode.test.ts` | Multi-Mode | **Done** |
| `__tests__/delphi-mode.test.ts` | Multi-Mode | **Done** |
| `__tests__/red-team-mode.test.ts` | Multi-Mode | **Done** |
| `__tests__/blueprint-mode.test.ts` | Multi-Mode | **Done** |
| `__tests__/peer-review-mode.test.ts` | Multi-Mode | **Done** |
| `__tests__/tournament-mode.test.ts` | Multi-Mode | **Done** |
| `__tests__/confidence-weighted-mode.test.ts` | Multi-Mode | **Done** |
| `app/layout.tsx` | 2 | Planned |
| `app/globals.css` | 2 | Planned |
| `app/(dashboard)/layout.tsx` | 2 | Planned |
| `app/(dashboard)/council/page.tsx` | 2 | Planned |
| `app/(dashboard)/council/[id]/page.tsx` | 2 | Planned |
| `components/council/stage1-panel.tsx` | 2 | Planned |
| `components/council/stage2-panel.tsx` | 2 | Planned |
| `components/council/stage3-panel.tsx` | 2 | Planned |
| `components/council/council-view.tsx` | 2 | Planned |
| `components/council/chat-input.tsx` | 2 | Planned |
| `components/council/message-list.tsx` | 2 | Planned |
| `components/council/loading-stages.tsx` | 2 | Planned |
| `components/layout/sidebar.tsx` | 2 | Planned |
| `components/layout/header.tsx` | 2 | Planned |
| `components/layout/mobile-nav.tsx` | 2 | Planned |
| `components/layout/theme-toggle.tsx` | 2 | Planned |
| `hooks/use-council-stream.ts` | 2 | Planned |
| `hooks/use-conversations.ts` | 2 | Planned |
| `lib/db/schema.ts` | 3 | Planned |
| `lib/db/index.ts` | 3 | Planned |
| `lib/db/queries.ts` | 3 | Planned |
| `drizzle.config.ts` | 3 | Planned |
| `lib/auth/config.ts` | 3 | Planned |
| `app/api/auth/[...nextauth]/route.ts` | 3 | Planned |
| `app/(auth)/login/page.tsx` | 3 | Planned |
| `app/(auth)/register/page.tsx` | 3 | Planned |
| `middleware.ts` | 3 | Planned |
| `app/(dashboard)/settings/page.tsx` | 4 | Planned |
| `app/(dashboard)/analytics/page.tsx` | 4 | Planned |
| `app/api/models/route.ts` | 4 | Planned |
| `app/api/conversations/route.ts` | 4 | Planned |
| `app/api/conversations/[id]/route.ts` | 4 | Planned |
| `components/settings/model-picker.tsx` | 4 | Planned |
| `components/settings/preset-manager.tsx` | 4 | Planned |
| `components/settings/chairman-select.tsx` | 4 | Planned |
| `components/analytics/win-rate-chart.tsx` | 4 | Planned |
| `components/analytics/response-time-chart.tsx` | 4 | Planned |
| `components/analytics/usage-stats.tsx` | 4 | Planned |
