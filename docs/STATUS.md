# Status: Model Council

> Read this file at every session start. Update after each milestone.

---

## Current State

| Field | Value |
|-------|-------|
| **Current Phase** | Pre-Phase 1 (Documentation Complete) |
| **Current Task** | Project initialization pending |
| **Overall Completion** | 5% (docs done, no application code) |
| **Last Updated** | 2026-02-09 |

---

## Phase Progress

| Phase | Status | Completion |
|-------|--------|-----------|
| Docs | **COMPLETE** | 100% |
| Phase 1: Skeleton + Core Pipeline | Not Started | 0% |
| Phase 2: UI (Shadcn, Dark Mode, Responsive) | Not Started | 0% |
| Phase 3: Database + Auth | Not Started | 0% |
| Phase 4: New Features | Not Started | 0% |
| Phase 5: Polish + Testing | Not Started | 0% |

---

## File Tracker

### Documentation (Complete)

| File | Status |
|------|--------|
| `CLAUDE.md` | Done |
| `docs/GAP_ANALYSIS.md` | Done |
| `docs/REQUIREMENTS.md` | Done |
| `docs/DESIGN.md` | Done |
| `docs/IMPLEMENTATION.md` | Done |
| `docs/STATUS.md` | Done |

### Phase 1 Files

| File | Status |
|------|--------|
| `package.json` | Not Started |
| `tsconfig.json` | Not Started |
| `next.config.ts` | Not Started |
| `tailwind.config.ts` | Not Started |
| `components.json` | Not Started |
| `.env.example` | Not Started |
| `.gitignore` | Not Started |
| `lib/council/types.ts` | Not Started |
| `lib/council/openrouter.ts` | Not Started |
| `lib/council/prompts.ts` | Not Started |
| `lib/council/ranking-parser.ts` | Not Started |
| `lib/council/orchestrator.ts` | Not Started |
| `app/api/council/stream/route.ts` | Not Started |
| `__tests__/ranking-parser.test.ts` | Not Started |
| `__tests__/orchestrator.test.ts` | Not Started |

### Phase 2 Files

| File | Status |
|------|--------|
| `app/layout.tsx` | Not Started |
| `app/globals.css` | Not Started |
| `app/(dashboard)/layout.tsx` | Not Started |
| `app/(dashboard)/council/page.tsx` | Not Started |
| `app/(dashboard)/council/[id]/page.tsx` | Not Started |
| `components/council/stage1-panel.tsx` | Not Started |
| `components/council/stage2-panel.tsx` | Not Started |
| `components/council/stage3-panel.tsx` | Not Started |
| `components/council/council-view.tsx` | Not Started |
| `components/council/chat-input.tsx` | Not Started |
| `components/council/message-list.tsx` | Not Started |
| `components/council/loading-stages.tsx` | Not Started |
| `components/layout/sidebar.tsx` | Not Started |
| `components/layout/header.tsx` | Not Started |
| `components/layout/mobile-nav.tsx` | Not Started |
| `components/layout/theme-toggle.tsx` | Not Started |
| `hooks/use-council-stream.ts` | Not Started |
| `hooks/use-conversations.ts` | Not Started |

### Phase 3 Files

| File | Status |
|------|--------|
| `lib/db/schema.ts` | Not Started |
| `lib/db/index.ts` | Not Started |
| `lib/db/queries.ts` | Not Started |
| `drizzle.config.ts` | Not Started |
| `lib/auth/config.ts` | Not Started |
| `app/api/auth/[...nextauth]/route.ts` | Not Started |
| `app/(auth)/login/page.tsx` | Not Started |
| `app/(auth)/register/page.tsx` | Not Started |
| `middleware.ts` | Not Started |

### Phase 4 Files

| File | Status |
|------|--------|
| `app/(dashboard)/settings/page.tsx` | Not Started |
| `app/(dashboard)/analytics/page.tsx` | Not Started |
| `app/api/models/route.ts` | Not Started |
| `app/api/conversations/route.ts` | Not Started |
| `app/api/conversations/[id]/route.ts` | Not Started |
| `components/settings/model-picker.tsx` | Not Started |
| `components/settings/preset-manager.tsx` | Not Started |
| `components/settings/chairman-select.tsx` | Not Started |
| `components/analytics/win-rate-chart.tsx` | Not Started |
| `components/analytics/response-time-chart.tsx` | Not Started |
| `components/analytics/usage-stats.tsx` | Not Started |

---

## Decisions Log

| # | Decision | Date | Rationale |
|---|----------|------|-----------|
| 1 | Greenfield build (no code migration) | 2026-02-09 | 14 CRITICAL gaps, complete framework change |
| 2 | Vercel AI SDK + OpenRouter for LLM transport | 2026-02-09 | SDK provides streaming + structured output; OpenRouter gives 200+ model access |
| 3 | Drizzle ORM + @vercel/postgres (Neon) | 2026-02-09 | Type-safe, migration tooling, same stack as System DNA Workbench |

---

## Next Steps

1. **Run `create-next-app`** to scaffold the Next.js project with TypeScript + Tailwind
2. **Create `lib/council/types.ts`** — all TypeScript interfaces for the pipeline
3. **Create `lib/council/ranking-parser.ts`** + unit tests — port regex logic from Python

These are the first 3 tasks of Phase 1. See `docs/IMPLEMENTATION.md` Phase 1 for full breakdown.

---

## Session Log

| Date | Session | What Was Done |
|------|---------|---------------|
| 2026-02-09 | 1 | Created project directory, git init, wrote all 6 documentation files (GAP_ANALYSIS, REQUIREMENTS, DESIGN, IMPLEMENTATION, CLAUDE.md, STATUS.md). Analyzed Karpathy prototype: council.py (335 lines), main.py (199 lines), openrouter.py (79 lines), storage.py (172 lines), App.jsx (201 lines), Stage2.jsx (99 lines), config.py (27 lines). Pushed to GitHub. |
