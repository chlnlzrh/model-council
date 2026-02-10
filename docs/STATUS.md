# Status: Model Council

> Read this file at every session start. Update after each milestone.

---

## Current State

| Field | Value |
|-------|-------|
| **Current Phase** | Multi-Mode Specs Complete — Ready for Multi-Mode Implementation |
| **Current Task** | Step 2: Shared Infrastructure for Multi-Mode Support |
| **Overall Completion** | 55% (Phases 1-4.5 done, multi-mode specs written, implementation next) |
| **Last Updated** | 2026-02-09 |
| **Production URL** | https://model-council-pink.vercel.app |

---

## Phase Progress

| Phase | Status | Completion |
|-------|--------|-----------|
| Docs | **COMPLETE** | 100% |
| Phase 1: Skeleton + Core Pipeline | **COMPLETE** | 100% |
| Phase 2: UI (Shadcn, Dark Mode, Responsive) | **COMPLETE** | 100% |
| Phase 3: Database + Auth | **COMPLETE** | 100% |
| Phase 4.1-4.2: Settings + Model Discovery | **COMPLETE** | 100% |
| Phase 4.3: Multi-Turn Conversations | **COMPLETE** | 100% |
| Phase 4.5: Markdown Export | **COMPLETE** | 100% |
| Multi-Mode Specs | **COMPLETE** | 100% |
| Multi-Mode Implementation | Not Started | 0% |
| Phase 5: Polish + Testing | Not Started | 0% |

---

## Multi-Mode Specification Documents

16 documents in `docs/modes/` totaling ~12,700 lines:

| File | Mode | Lines | Family | Sections |
|------|------|------:|--------|----------|
| `00-shared-infrastructure.md` | Cross-cutting concerns | 454 | — | A-J |
| `01-council.md` | Council (baseline, implemented) | 301 | Evaluation | A-G |
| `02-vote.md` | Vote | 648 | Evaluation | A-G |
| `03-jury.md` | Jury | 929 | Evaluation | A-G |
| `04-debate.md` | Debate | 993 | Evaluation | A-G |
| `05-delphi.md` | Delphi | 802 | Evaluation | A-G |
| `06-red-team.md` | Red Team | 768 | Adversarial | A-G |
| `07-chain.md` | Chain | 622 | Sequential | A-G |
| `08-specialist-panel.md` | Specialist Panel | 974 | Role-Based | A-G |
| `09-blueprint.md` | Blueprint | 861 | Role-Based | A-G |
| `10-peer-review.md` | Peer Review | 1,132 | Role-Based | A-G |
| `11-tournament.md` | Tournament | 836 | Algorithmic | A-G |
| `12-confidence-weighted.md` | Confidence-Weighted | 738 | Algorithmic | A-G |
| `13-decompose.md` | Decompose | 1,072 | Algorithmic | A-G |
| `14-brainstorm.md` | Brainstorm | 792 | Creative | A-G |
| `15-fact-check.md` | Fact-Check | 823 | Verification | A-G |

Each spec contains: Requirements, Pipeline Design (with full prompt templates), SSE Event Sequence, Input Format (Zod), Output Format (TypeScript interfaces), Edge Cases, Database Schema (parsedData JSONB examples).

---

## Multi-Mode Implementation Plan

### Step 1: Shared Infrastructure (Prerequisite for All Modes)

> Estimated: ~500 LOC across 5-6 files

| # | Task | File(s) | Description | Status |
|---|------|---------|-------------|--------|
| 1.1 | Add `mode` column to conversations | `lib/db/schema.ts` | `mode: text("mode").notNull().default("council")` — values from `DeliberationMode` union | Not Started |
| 1.2 | Create `deliberation_stages` table | `lib/db/schema.ts` | New table: id, messageId, stageType, stageOrder, model, role, content, parsedData (JSONB), responseTimeMs, createdAt | Not Started |
| 1.3 | Generate + push migration | `lib/db/migrations/` | `npm run db:generate && npm run db:push` | Not Started |
| 1.4 | Add DB query helpers | `lib/db/queries.ts` | `saveDeliberationStage()`, `loadDeliberationStages()`, `getConversationMode()` | Not Started |
| 1.5 | Extend types | `lib/council/types.ts` | `DeliberationMode` union, `BaseModeConfig`, `ModeDefinition`, shared interfaces per spec | Not Started |
| 1.6 | Mode registry | `lib/council/modes/index.ts` | `MODE_REGISTRY` map, mode dispatcher function, shared validation | Not Started |
| 1.7 | Extend SSE endpoint | `app/api/council/stream/route.ts` | Accept `mode` field in request, dispatch to mode-specific handler | Not Started |
| 1.8 | Generic client hook | `hooks/use-deliberation-stream.ts` | Mode-aware SSE consumer with mode-specific state reducers | Not Started |
| 1.9 | Tests | `__tests__/shared-infrastructure.test.ts` | Mode registry, type validation, dispatcher routing | Not Started |

### Step 2: Implement Modes (Priority Order)

Each mode = orchestrator + prompts + parser in a single file under `lib/council/modes/`.

| Priority | Mode | File | Complexity | Est. LOC | Dependencies | Status |
|----------|------|------|-----------|---------|-------------|--------|
| 1 | **Vote** | `modes/vote.ts` | Low | ~400 | Shared infra, `createLabelMap` | Not Started |
| 2 | **Chain** | `modes/chain.ts` | Low-Med | ~500 | Shared infra | Not Started |
| 3 | **Specialist Panel** | `modes/specialist-panel.ts` | Medium | ~700 | Shared infra | Not Started |
| 4 | **Jury** | `modes/jury.ts` | Medium | ~600 | Shared infra | Not Started |
| 5 | **Red Team** | `modes/red-team.ts` | Medium | ~700 | Shared infra | Not Started |
| 6 | **Blueprint** | `modes/blueprint.ts` | Med-High | ~800 | Shared infra | Not Started |
| 7 | **Peer Review** | `modes/peer-review.ts` | Medium | ~700 | Shared infra | Not Started |
| 8 | **Debate** | `modes/debate.ts` | High | ~800 | Shared infra, `createLabelMap` | Not Started |
| 9 | **Tournament** | `modes/tournament.ts` | Medium | ~700 | Shared infra | Not Started |
| 10 | **Confidence-Weighted** | `modes/confidence-weighted.ts` | Medium | ~600 | Shared infra | Not Started |
| 11 | **Decompose** | `modes/decompose.ts` | High | ~900 | Shared infra | Not Started |
| 12 | **Brainstorm** | `modes/brainstorm.ts` | Med-High | ~800 | Shared infra | Not Started |
| 13 | **Fact-Check** | `modes/fact-check.ts` | High | ~900 | Shared infra | Not Started |
| 14 | **Delphi** | `modes/delphi.ts` | Very High | ~1200 | Shared infra | Not Started |

**Total estimated: ~9,800 LOC** across 14 mode files + shared infra.

### Step 3: UI for Mode Selection + Mode-Specific Views

| # | Task | Description | Status |
|---|------|-------------|--------|
| 3.1 | Mode selector component | Dropdown/grid on council page to pick deliberation mode | Not Started |
| 3.2 | Mode-specific config panels | Per-mode configuration UI (role assignment, rounds, rubric selection, etc.) | Not Started |
| 3.3 | Mode-specific result views | Custom stage panels per mode (bracket viz for Tournament, DAG for Decompose, etc.) | Not Started |
| 3.4 | Conversation list mode badges | Show which mode was used for each conversation | Not Started |

### Step 4: Testing

| # | Task | Description | Status |
|---|------|-------------|--------|
| 4.1 | Per-mode unit tests | Parsers, prompt builders, convergence engines, bracket algorithms | Not Started |
| 4.2 | Per-mode integration tests | Mock SSE streams, verify event sequences | Not Started |
| 4.3 | E2E with real models | Test each mode end-to-end with live OpenRouter calls | Not Started |

---

## Existing Test Suite

| File | Tests | Status |
|------|------:|--------|
| `__tests__/ranking-parser.test.ts` | 18 | Passing |
| `__tests__/prompts.test.ts` | 11 | Passing |
| `__tests__/orchestrator.test.ts` | 13 | Passing |
| `__tests__/analytics-compute.test.ts` | 20 | Passing |
| **Total** | **62** | **All passing** |

---

## Completed Phases Summary

### Phase 1 — Core Pipeline
- Types, ranking parser, prompts, OpenRouter client, orchestrator, SSE endpoint
- 42 tests passing, deployed to Vercel

### Phase 2 — Full Dashboard UI
- Sidebar, header, mobile nav, theme toggle
- Council view with 3-stage panels, chat input, message list
- SSE streaming client hook, loading states, dark mode

### Phase 3 — Database + Auth
- Drizzle ORM schema (9 tables), Neon Postgres
- Auth.js v5 with credentials + Google OAuth
- Route protection middleware, session management

### Phase 4.1-4.2 — Settings + Model Discovery
- Settings page with model picker, preset manager
- OpenRouter model discovery API endpoint

### Phase 4.3 — Multi-Turn Conversations
- Conversation history loading for follow-up questions
- Context passed to Stage 1 + Stage 3 (not Stage 2)

### Phase 4.5 — Markdown Export
- Export full conversation with all stage data as .md

---

## Decisions Log

| # | Decision | Date | Rationale |
|---|----------|------|-----------|
| 1 | Greenfield build (no code migration) | 2026-02-09 | 14 CRITICAL gaps, complete framework change |
| 2 | Vercel AI SDK + OpenRouter for LLM transport | 2026-02-09 | SDK provides streaming + structured output; OpenRouter gives 200+ model access |
| 3 | Drizzle ORM + @vercel/postgres (Neon) | 2026-02-09 | Type-safe, migration tooling, same stack as System DNA Workbench |
| 4 | Removed `compatibility: "compatible"` from createOpenAI | 2026-02-09 | @ai-sdk/openai v3+ removed this option; just use baseURL + apiKey |
| 5 | Default council: Opus 4.6, o3, Gemini 2.5 Pro, Sonar Pro | 2026-02-09 | Top-tier reasoning models + Perplexity for web-grounded perspective |
| 6 | Removed DeepSeek R1 from default council | 2026-02-09 | Unreliable response times via OpenRouter, frequently timing out |
| 7 | Single `deliberation_stages` table for all new modes | 2026-02-09 | Generic JSONB `parsedData` column avoids schema explosion; Council keeps legacy tables for backward compat |
| 8 | 15 modes across 6 families | 2026-02-09 | Covers evaluation, adversarial, sequential, role-based, algorithmic, creative, and verification use cases |
| 9 | Single SSE endpoint with mode dispatcher | 2026-02-09 | Keeps API surface simple; mode-specific logic in orchestrator files |

---

## Next Steps

1. **Implement Step 1: Shared Infrastructure** — DB migration, type extensions, mode registry, dispatcher, generic hook
2. **Implement Step 2: Vote mode** — Simplest delta from Council, validates the abstraction layer
3. Continue through priority order (Chain → Specialist Panel → Jury → Red Team → ...)

See `docs/modes/00-shared-infrastructure.md` for full shared infrastructure spec.
See individual `docs/modes/NN-*.md` files for per-mode implementation specs.
