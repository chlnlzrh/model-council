# PROJECT CONTEXT — Model Council

## Header

| Field | Value |
|-------|-------|
| **Project** | Model Council |
| **Version** | 0.1.0 (pre-Phase 1) |
| **Framework** | Next.js 14+ App Router |
| **Language** | TypeScript strict |
| **Runtime** | Node.js 20+ |
| **Deploy** | Vercel |
| **Repo** | github.com/chlnlzrh/model-council |

## Overview

Model Council is a production-grade LLM deliberation platform. Multiple AI models respond to a user's question, then anonymously evaluate and rank each other's responses, and finally a "chairman" model synthesizes the collective wisdom into a single answer. Inspired by the `karpathy/llm-council` prototype, rebuilt from scratch in Next.js + TypeScript.

## Architecture

```
[Browser] ↔ [Next.js App Router on Vercel] ↔ [OpenRouter via Vercel AI SDK]
                    |              |
            [Neon Postgres]    [Auth.js v5]
            (Drizzle ORM)
```

### Directory Structure

```
model-council/
├── app/
│   ├── layout.tsx                    # Root layout + providers
│   ├── page.tsx                      # Landing/redirect
│   ├── globals.css
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx                # Sidebar + main content
│   │   ├── council/
│   │   │   ├── page.tsx              # Conversation list
│   │   │   └── [id]/page.tsx         # 3-stage council view
│   │   ├── settings/page.tsx         # Model config
│   │   └── analytics/page.tsx        # Dashboard
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── council/stream/route.ts   # SSE streaming
│       ├── conversations/route.ts
│       ├── conversations/[id]/route.ts
│       └── models/route.ts           # OpenRouter discovery
├── components/
│   ├── ui/                           # Shadcn primitives
│   ├── council/                      # Stage panels, chat input
│   ├── layout/                       # Sidebar, header, mobile nav
│   ├── settings/                     # Model picker, presets
│   └── analytics/                    # Charts
├── lib/
│   ├── council/
│   │   ├── types.ts                  # TypeScript interfaces
│   │   ├── orchestrator.ts           # 3-stage pipeline
│   │   ├── openrouter.ts             # Vercel AI SDK + OpenRouter
│   │   ├── ranking-parser.ts         # FINAL RANKING: extraction
│   │   └── prompts.ts               # Prompt templates
│   ├── db/
│   │   ├── index.ts                  # Drizzle client
│   │   ├── schema.ts                 # 9 tables
│   │   ├── queries.ts               # Repository functions
│   │   └── migrations/
│   └── auth/config.ts
├── hooks/
│   ├── use-council-stream.ts         # SSE client hook
│   └── use-conversations.ts
├── middleware.ts                      # Route protection
├── drizzle.config.ts
├── tailwind.config.ts
├── next.config.ts
└── docs/                             # Architecture docs
    ├── GAP_ANALYSIS.md
    ├── REQUIREMENTS.md
    ├── DESIGN.md
    ├── IMPLEMENTATION.md
    └── STATUS.md
```

## Key Modules

| File | Purpose |
|------|---------|
| `lib/council/orchestrator.ts` | 3-stage pipeline: collect → rank → synthesize |
| `lib/council/openrouter.ts` | Vercel AI SDK client pointed at OpenRouter |
| `lib/council/ranking-parser.ts` | Regex extraction of FINAL RANKING section |
| `lib/council/prompts.ts` | Ranking, synthesis, and title prompt templates |
| `lib/council/types.ts` | All TypeScript interfaces |
| `lib/db/schema.ts` | Drizzle ORM schema (9 tables) |
| `lib/db/queries.ts` | Database repository functions |
| `lib/auth/config.ts` | Auth.js v5 configuration |
| `app/api/council/stream/route.ts` | SSE streaming endpoint |
| `hooks/use-council-stream.ts` | Client-side SSE consumer |

## CLI Commands

```bash
npm run dev           # Start dev server (port 3000)
npm run build         # Production build
npm run start         # Start production server
npm run lint          # ESLint
npm run test          # Vitest
npm run test:coverage # Vitest with coverage
npm run db:generate   # Generate Drizzle migrations
npm run db:push       # Push schema to Neon
npm run db:studio     # Open Drizzle Studio
```

## API Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/council/stream` | SSE streaming 3-stage pipeline |
| GET | `/api/conversations` | List user's conversations |
| POST | `/api/conversations` | Create new conversation |
| GET | `/api/conversations/[id]` | Get conversation with all stages |
| DELETE | `/api/conversations/[id]` | Delete conversation |
| GET | `/api/models` | List available OpenRouter models |
| * | `/api/auth/[...nextauth]` | Auth.js handlers |

## SSE Event Types

```
stage1_start     → {}
stage1_complete  → { data: Stage1Response[] }
stage2_start     → {}
stage2_complete  → { data: Stage2Response[], metadata: { labelToModel, aggregateRankings } }
stage3_start     → {}
stage3_complete  → { data: Stage3Response }
title_complete   → { data: { title: string } }
complete         → {}
error            → { message: string }
```

## Data Flow

```
User Query
    ↓
Stage 1: Parallel queries to N models → [individual responses]
    ↓
Stage 2: Anonymize responses → Parallel ranking queries → [evaluations + parsed rankings]
    ↓
Aggregate Rankings: Calculate avg position across all evaluations
    ↓
Stage 3: Chairman model synthesizes from all responses + rankings
    ↓
Save to DB: conversations → messages → stage1/2/3 tables + label_map
    ↓
Stream to Client: 9 SSE events for progressive UI updates
```

## Environment Variables

```bash
# Required
POSTGRES_URL=postgresql://...        # Neon connection string
AUTH_SECRET=...                      # Auth.js secret (openssl rand -base64 32)
OPENROUTER_API_KEY=sk-or-v1-...     # OpenRouter API key

# Optional
GOOGLE_CLIENT_ID=...                # Google OAuth (optional)
GOOGLE_CLIENT_SECRET=...            # Google OAuth (optional)
```

## Database Schema (9 Tables)

- `users`, `accounts`, `sessions`, `verificationTokens` — Auth.js managed
- `conversations` — user_id FK, title, model_preset_id
- `messages` — conversation_id FK, role, content
- `stage1_responses` — message_id FK, model, response, response_time_ms
- `stage2_rankings` — message_id FK, model, ranking_text, parsed_ranking (JSONB)
- `stage2_label_map` — message_id FK, label, model
- `stage3_synthesis` — message_id FK, model, response, response_time_ms
- `model_presets` — user_id FK, name, council_models (JSONB), chairman_model

## Reference Prototype

The Karpathy prototype at `C:\Users\bimal\OneDrive\Desktop\ai\Apps\karpathy-llm-council\llm-council` contains the original logic. Key files:

| File | What to Reference |
|------|-------------------|
| `backend/council.py` | 3-stage pipeline, prompt templates, ranking parser regex |
| `backend/main.py` | SSE event format (9 event types) |
| `backend/openrouter.py` | Query patterns, parallel execution |
| `frontend/src/App.jsx` | SSE state machine, progressive updates |
| `frontend/src/components/Stage2.jsx` | De-anonymization, aggregate display |

**No code is copied.** All logic is reimplemented in TypeScript.

## Migration Status

See `docs/STATUS.md` for current phase, task progress, and next steps.

## Decisions Log

1. **Greenfield build** — not migrating, fresh codebase
2. **Vercel AI SDK + OpenRouter** — AI SDK as transport, OpenRouter for multi-model
3. **Drizzle + @vercel/postgres** — type-safe ORM, Neon Postgres
