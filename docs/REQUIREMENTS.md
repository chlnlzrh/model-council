# Requirements: Model Council

> Traces every capability from the Karpathy prototype through to new features.
> Each requirement has a unique ID for cross-referencing in DESIGN.md and IMPLEMENTATION.md.

---

## Part 1: Current Capabilities to Preserve

These exist in the Karpathy prototype and must be reimplemented in Model Council.

### Pipeline

| ID | Requirement | Prototype Source | Priority |
|----|-------------|-----------------|----------|
| REQ-CURR-001 | **3-stage pipeline**: collect responses → anonymized peer ranking → chairman synthesis | `council.py:296-335` | P0 |
| REQ-CURR-002 | **Parallel model queries**: all council models queried simultaneously in Stage 1 | `openrouter.py:56-79` | P0 |
| REQ-CURR-003 | **Anonymized ranking**: responses labeled "Response A, B, C..." — models never see each other's names | `council.py:49-56` | P0 |
| REQ-CURR-004 | **Ranking prompt**: structured prompt requiring `FINAL RANKING:` header + numbered list | `council.py:64-93` | P0 |
| REQ-CURR-005 | **Ranking parser**: regex extraction of `FINAL RANKING:` section with fallback patterns | `council.py:177-208` | P0 |
| REQ-CURR-006 | **Chairman synthesis**: single model synthesizes from all responses + all rankings | `council.py:115-174` | P0 |
| REQ-CURR-007 | **Aggregate rankings**: average rank position across all peer evaluations, sorted best-to-worst | `council.py:211-255` | P0 |
| REQ-CURR-008 | **Graceful degradation**: if some models fail, continue with successful responses | `openrouter.py:51-53` | P0 |

### Streaming & UI

| ID | Requirement | Prototype Source | Priority |
|----|-------------|-----------------|----------|
| REQ-CURR-009 | **SSE streaming**: 6 event types (stage[1-3]_start, stage[1-3]_complete, title_complete, complete, error) | `main.py:126-194` | P0 |
| REQ-CURR-010 | **Progressive UI updates**: each stage renders as it completes, not waiting for full pipeline | `App.jsx:92-172` | P0 |
| REQ-CURR-011 | **Tabbed stage views**: Stage 1 and Stage 2 show per-model tabs | `Stage2.jsx:34-44` | P1 |
| REQ-CURR-012 | **De-anonymization display**: client-side replacement of "Response X" with bold model names | `Stage2.jsx:5-15` | P1 |
| REQ-CURR-013 | **Markdown rendering**: all model responses rendered as markdown | `react-markdown` usage | P1 |
| REQ-CURR-014 | **Parsed ranking display**: extracted ranking shown below raw evaluation text | `Stage2.jsx:56-70` | P1 |

### Conversations

| ID | Requirement | Prototype Source | Priority |
|----|-------------|-----------------|----------|
| REQ-CURR-015 | **Conversation CRUD**: create, list, get, delete conversations | `main.py:59-79`, `storage.py` | P0 |
| REQ-CURR-016 | **Auto-generated titles**: first message triggers title generation via fast model | `council.py:258-293` | P1 |
| REQ-CURR-017 | **Loading states**: per-stage loading indicators during pipeline execution | `App.jsx:79-83` | P1 |
| REQ-CURR-018 | **Optimistic UI**: user message appears immediately before API response | `App.jsx:66-91` | P1 |

---

## Part 2: New Requirements

### Framework (REQ-FW)

| ID | Requirement | Gap Ref | Priority |
|----|-------------|---------|----------|
| REQ-FW-001 | Next.js 14+ App Router with Server Components | GAP-1 | P0 |
| REQ-FW-002 | TypeScript strict mode — no `.js` files | GAP-1 | P0 |
| REQ-FW-003 | Vercel deployment with zero-config | GAP-1 | P0 |
| REQ-FW-004 | File-based routing under `app/` directory | GAP-1 | P1 |
| REQ-FW-005 | Server Actions for mutations where appropriate | GAP-2 | P1 |

### Authentication (REQ-AUTH)

| ID | Requirement | Gap Ref | Priority |
|----|-------------|---------|----------|
| REQ-AUTH-001 | Auth.js v5 with Drizzle adapter | GAP-5 | P0 |
| REQ-AUTH-002 | Email/password credentials provider | GAP-5 | P0 |
| REQ-AUTH-003 | Google OAuth provider | GAP-5 | P1 |
| REQ-AUTH-004 | Session management (JWT or database sessions) | GAP-5 | P0 |
| REQ-AUTH-005 | Middleware-based route protection (`/council/*`, `/settings/*`, `/analytics/*`) | GAP-5 | P0 |
| REQ-AUTH-006 | Conversation ownership — users only see/modify their own data | GAP-5 | P0 |
| REQ-AUTH-007 | Login and register pages | GAP-5 | P0 |

### Model Configuration (REQ-MODEL)

| ID | Requirement | Gap Ref | Priority |
|----|-------------|---------|----------|
| REQ-MODEL-001 | UI model picker — select council members from available models | GAP-8 | P1 |
| REQ-MODEL-002 | Chairman model selection (can be same as or separate from council) | GAP-8 | P1 |
| REQ-MODEL-003 | Named model presets (e.g., "Fast Council", "Premium Council") | GAP-8 | P2 |
| REQ-MODEL-004 | OpenRouter model discovery via `/api/v1/models` endpoint | GAP-8 | P2 |
| REQ-MODEL-005 | Per-conversation model preset assignment | GAP-8 | P2 |
| REQ-MODEL-006 | Default preset with 4 models matching prototype config | GAP-8 | P1 |

### AI SDK Integration (REQ-SDK)

| ID | Requirement | Gap Ref | Priority |
|----|-------------|---------|----------|
| REQ-SDK-001 | Vercel AI SDK as transport layer (`ai` package) | GAP-3 | P0 |
| REQ-SDK-002 | OpenRouter provider via `@ai-sdk/openai` compatible client | GAP-3 | P0 |
| REQ-SDK-003 | Streaming text generation (`streamText()`) | GAP-3 | P0 |
| REQ-SDK-004 | Multi-model parallel queries via `Promise.allSettled()` | GAP-3 | P0 |
| REQ-SDK-005 | Configurable timeout per model | GAP-3 | P1 |
| REQ-SDK-006 | Token usage tracking from API responses | GAP-3 | P2 |

### Multi-Turn Conversations (REQ-MT)

| ID | Requirement | Gap Ref | Priority |
|----|-------------|---------|----------|
| REQ-MT-001 | Always-visible input at bottom of conversation view | GAP-9 | P1 |
| REQ-MT-002 | Conversation history included in model context for follow-ups | GAP-9 | P1 |
| REQ-MT-003 | Token counting to manage context window limits | GAP-9 | P2 |
| REQ-MT-004 | Smart truncation of older messages when context is full | GAP-9 | P2 |

### Analytics (REQ-AN)

| ID | Requirement | Gap Ref | Priority |
|----|-------------|---------|----------|
| REQ-AN-001 | Model win rate tracking (how often each model ranks #1) | GAP-4 | P2 |
| REQ-AN-002 | Response time tracking per model per stage | GAP-4 | P2 |
| REQ-AN-003 | Cost estimation per query (via OpenRouter pricing) | GAP-4 | P3 |
| REQ-AN-004 | Analytics dashboard with charts (Recharts) | GAP-4 | P2 |
| REQ-AN-005 | Date range filtering for analytics | GAP-4 | P3 |

### Export (REQ-EX)

| ID | Requirement | Gap Ref | Priority |
|----|-------------|---------|----------|
| REQ-EX-001 | Export conversation as Markdown | N/A | P2 |
| REQ-EX-002 | Export conversation as PDF | N/A | P3 |
| REQ-EX-003 | Export analytics as CSV | N/A | P3 |

### UI/UX (REQ-UI)

| ID | Requirement | Gap Ref | Priority |
|----|-------------|---------|----------|
| REQ-UI-001 | Shadcn UI components exclusively | GAP-6 | P0 |
| REQ-UI-002 | Tailwind CSS with design tokens — no hardcoded hex | GAP-6 | P0 |
| REQ-UI-003 | Dark mode (light/dark/system toggle) via `next-themes` | GAP-6 | P1 |
| REQ-UI-004 | Mobile-first responsive layout (320px → 1440px) | GAP-7 | P1 |
| REQ-UI-005 | Collapsible sidebar (icon-only on mobile) | GAP-7 | P1 |
| REQ-UI-006 | WCAG AA compliance (4.5:1 contrast, keyboard nav, ARIA) | GAP-7 | P1 |
| REQ-UI-007 | Loading/empty/error states for all async operations | GAP-6 | P1 |
| REQ-UI-008 | Skeleton loaders during data fetch | GAP-6 | P1 |
| REQ-UI-009 | Toast notifications for errors and confirmations | GAP-12 | P1 |
| REQ-UI-010 | Inter font, `text-xs` baseline typography | GAP-6 | P2 |
| REQ-UI-011 | **Progressive stage rendering**: Stage 1 content replaces skeletons while Stage 2 loads; each stage streams independently | Mockup review | P1 |
| REQ-UI-012 | **Per-model streaming**: individual model responses appear as they arrive, not all at once | Mockup review | P1 |
| REQ-UI-013 | **De-anonymization reveal**: Stage 2 shows "Response A → Model Name" mapping visually | Mockup review | P1 |
| REQ-UI-014 | **Response time comparison**: visual indicator showing relative speed of each model | Mockup review | P2 |
| REQ-UI-015 | **Collapsible responses**: long model responses can be collapsed/expanded, with "Show more" | Mockup review | P1 |
| REQ-UI-016 | **Copy button**: one-click copy on chairman synthesis (and individual responses) | Mockup review | P1 |
| REQ-UI-017 | **Model identity colors**: each model gets a consistent color across all stages for quick recognition | Mockup review | P2 |
| REQ-UI-018 | **Elapsed time indicator**: show "Stage 1: 8s elapsed..." during loading | Mockup review | P1 |
| REQ-UI-019 | **Horizontal scroll with fade**: model pill tabs scroll horizontally on mobile with gradient fade edges | Mockup review | P1 |
| REQ-UI-020 | **Aggregate ranking scale**: ranking bars use actual relative scale (not arbitrary widths) | Mockup review | P1 |

### Non-Functional (REQ-NFR)

| ID | Requirement | Gap Ref | Priority |
|----|-------------|---------|----------|
| REQ-NFR-001 | First Contentful Paint < 1.5s | N/A | P1 |
| REQ-NFR-002 | Initial bundle < 200KB | N/A | P1 |
| REQ-NFR-003 | Lighthouse performance score > 90 | N/A | P2 |
| REQ-NFR-004 | 80% test coverage minimum | GAP-10 | P1 |
| REQ-NFR-005 | No hardcoded secrets — env vars only | N/A | P0 |
| REQ-NFR-006 | Cumulative Layout Shift < 0.1 | N/A | P2 |
| REQ-NFR-007 | Time to Interactive < 3s | N/A | P2 |

---

## Traceability Matrix

Maps every requirement to its gap source, design section, implementation phase, and status.

| Requirement | Gap | Design Section | Phase | Status |
|-------------|-----|---------------|-------|--------|
| REQ-CURR-001 | GAP-2 | DS-3 (Pipeline) | 1 | **Done** |
| REQ-CURR-002 | GAP-3 | DS-3 (Pipeline) | 1 | **Done** |
| REQ-CURR-003 | GAP-2 | DS-3 (Pipeline) | 1 | **Done** |
| REQ-CURR-004 | GAP-2 | DS-3 (Pipeline) | 1 | **Done** |
| REQ-CURR-005 | GAP-2 | DS-3 (Pipeline) | 1 | **Done** |
| REQ-CURR-006 | GAP-2 | DS-3 (Pipeline) | 1 | **Done** |
| REQ-CURR-007 | GAP-2 | DS-3 (Pipeline) | 1 | **Done** |
| REQ-CURR-008 | GAP-12 | DS-3 (Pipeline) | 1 | **Done** |
| REQ-CURR-009 | GAP-2 | DS-4 (Streaming) | 1 | **Done** |
| REQ-CURR-010 | GAP-2 | DS-4 (Streaming) | 2 | Planned |
| REQ-CURR-011 | GAP-6 | DS-5 (UI) | 2 | Planned |
| REQ-CURR-012 | GAP-6 | DS-5 (UI) | 2 | Planned |
| REQ-CURR-013 | — | DS-5 (UI) | 2 | Planned |
| REQ-CURR-014 | GAP-6 | DS-5 (UI) | 2 | Planned |
| REQ-CURR-015 | GAP-4 | DS-6 (Data) | 3 | Planned |
| REQ-CURR-016 | — | DS-3 (Pipeline) | 1 | **Done** |
| REQ-CURR-017 | — | DS-5 (UI) | 2 | Planned |
| REQ-CURR-018 | — | DS-5 (UI) | 2 | Planned |
| REQ-FW-001 | GAP-1 | DS-1 (Architecture) | 1 | **Done** |
| REQ-FW-002 | GAP-1 | DS-1 (Architecture) | 1 | **Done** |
| REQ-FW-003 | GAP-1 | DS-1 (Architecture) | 5 | Planned |
| REQ-FW-004 | GAP-1 | DS-2 (Directory) | 1 | **Done** |
| REQ-FW-005 | GAP-2 | DS-3 (Pipeline) | 3 | Planned |
| REQ-AUTH-001 | GAP-5 | DS-7 (Auth) | 3 | Planned |
| REQ-AUTH-002 | GAP-5 | DS-7 (Auth) | 3 | Planned |
| REQ-AUTH-003 | GAP-5 | DS-7 (Auth) | 3 | Planned |
| REQ-AUTH-004 | GAP-5 | DS-7 (Auth) | 3 | Planned |
| REQ-AUTH-005 | GAP-5 | DS-7 (Auth) | 3 | Planned |
| REQ-AUTH-006 | GAP-5 | DS-7 (Auth) | 3 | Planned |
| REQ-AUTH-007 | GAP-5 | DS-7 (Auth) | 3 | Planned |
| REQ-MODEL-001 | GAP-8 | DS-8 (Models) | 4 | Planned |
| REQ-MODEL-002 | GAP-8 | DS-8 (Models) | 4 | Planned |
| REQ-MODEL-003 | GAP-8 | DS-8 (Models) | 4 | Planned |
| REQ-MODEL-004 | GAP-8 | DS-8 (Models) | 4 | Planned |
| REQ-MODEL-005 | GAP-8 | DS-8 (Models) | 4 | Planned |
| REQ-MODEL-006 | GAP-8 | DS-8 (Models) | 4 | Planned |
| REQ-SDK-001 | GAP-3 | DS-3 (Pipeline) | 1 | **Done** |
| REQ-SDK-002 | GAP-3 | DS-3 (Pipeline) | 1 | **Done** |
| REQ-SDK-003 | GAP-3 | DS-3 (Pipeline) | 1 | **Done** |
| REQ-SDK-004 | GAP-3 | DS-3 (Pipeline) | 1 | **Done** |
| REQ-SDK-005 | GAP-3 | DS-3 (Pipeline) | 1 | **Done** |
| REQ-SDK-006 | GAP-3 | DS-9 (Analytics) | 4 | Planned |
| REQ-MT-001 | GAP-9 | DS-5 (UI) | 4 | Planned |
| REQ-MT-002 | GAP-9 | DS-3 (Pipeline) | 4 | Planned |
| REQ-MT-003 | GAP-9 | DS-3 (Pipeline) | 4 | Planned |
| REQ-MT-004 | GAP-9 | DS-3 (Pipeline) | 4 | Planned |
| REQ-AN-001 | GAP-4 | DS-9 (Analytics) | 4 | Planned |
| REQ-AN-002 | GAP-4 | DS-9 (Analytics) | 4 | Planned |
| REQ-AN-003 | GAP-4 | DS-9 (Analytics) | 4 | Planned |
| REQ-AN-004 | GAP-4 | DS-9 (Analytics) | 4 | Planned |
| REQ-AN-005 | GAP-4 | DS-9 (Analytics) | 4 | Planned |
| REQ-EX-001 | — | DS-10 (Export) | 4 | Planned |
| REQ-EX-002 | — | DS-10 (Export) | 4 | Planned |
| REQ-EX-003 | — | DS-10 (Export) | 4 | Planned |
| REQ-UI-001 | GAP-6 | DS-5 (UI) | 2 | Planned |
| REQ-UI-002 | GAP-6 | DS-5 (UI) | 2 | Planned |
| REQ-UI-003 | GAP-6 | DS-5 (UI) | 2 | Planned |
| REQ-UI-004 | GAP-7 | DS-5 (UI) | 2 | Planned |
| REQ-UI-005 | GAP-7 | DS-5 (UI) | 2 | Planned |
| REQ-UI-006 | GAP-7 | DS-5 (UI) | 5 | Planned |
| REQ-UI-007 | GAP-6 | DS-5 (UI) | 2 | Planned |
| REQ-UI-008 | GAP-6 | DS-5 (UI) | 2 | Planned |
| REQ-UI-009 | GAP-12 | DS-5 (UI) | 2 | Planned |
| REQ-UI-010 | GAP-6 | DS-5 (UI) | 2 | Planned |
| REQ-UI-011 | Mockup | DS-5 (UI) | 2 | Planned |
| REQ-UI-012 | Mockup | DS-5 (UI) | 2 | Planned |
| REQ-UI-013 | Mockup | DS-5 (UI) | 2 | Planned |
| REQ-UI-014 | Mockup | DS-5 (UI) | 2 | Planned |
| REQ-UI-015 | Mockup | DS-5 (UI) | 2 | Planned |
| REQ-UI-016 | Mockup | DS-5 (UI) | 2 | Planned |
| REQ-UI-017 | Mockup | DS-5 (UI) | 2 | Planned |
| REQ-UI-018 | Mockup | DS-5 (UI) | 2 | Planned |
| REQ-UI-019 | Mockup | DS-5 (UI) | 2 | Planned |
| REQ-UI-020 | Mockup | DS-5 (UI) | 2 | Planned |
| REQ-NFR-001 | — | DS-11 (Perf) | 5 | Planned |
| REQ-NFR-002 | — | DS-11 (Perf) | 5 | Planned |
| REQ-NFR-003 | — | DS-11 (Perf) | 5 | Planned |
| REQ-NFR-004 | GAP-10 | DS-12 (Testing) | 5 | Planned |
| REQ-NFR-005 | — | DS-1 (Architecture) | 1 | **Done** |
| REQ-NFR-006 | — | DS-11 (Perf) | 5 | Planned |
| REQ-NFR-007 | — | DS-11 (Perf) | 5 | Planned |

---

## Priority Legend

| Priority | Meaning | Phase Target |
|----------|---------|-------------|
| **P0** | Must-have for MVP — blocks launch | Phases 1-3 |
| **P1** | Should-have — significantly degrades UX if missing | Phases 2-3 |
| **P2** | Nice-to-have — enhances product but not critical | Phase 4 |
| **P3** | Future — can ship without these | Phase 4+ |

### Priority Distribution

| Priority | Count |
|----------|-------|
| P0 | 22 |
| P1 | 26 |
| P2 | 14 |
| P3 | 4 |
| **Total** | **66** |
