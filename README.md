# Model Council

A production-grade LLM deliberation platform where multiple AI models collaboratively answer questions through a 3-stage process: individual responses, anonymized peer ranking, and chairman synthesis.

Inspired by [karpathy/llm-council](https://github.com/karpathy/llm-council). Greenfield rebuild in Next.js + TypeScript.

## Tech Stack

- **Framework:** Next.js 14+ (App Router) + TypeScript strict
- **Database:** Drizzle ORM + @vercel/postgres (Neon)
- **Auth:** Auth.js v5
- **AI:** Vercel AI SDK + OpenRouter (200+ models)
- **UI:** Tailwind CSS + Shadcn UI
- **Deploy:** Vercel

## How It Works

1. **Stage 1 — Collect:** Your question is sent to multiple LLMs in parallel
2. **Stage 2 — Rank:** Each model evaluates all responses anonymously ("Response A, B, C...") and provides rankings
3. **Stage 3 — Synthesize:** A chairman model reads everything and produces a final answer

## Development

```bash
npm install
cp .env.example .env.local  # Fill in your keys
npm run dev                  # http://localhost:3000
```

## Documentation

- [Gap Analysis](docs/GAP_ANALYSIS.md) — Prototype vs. target comparison
- [Requirements](docs/REQUIREMENTS.md) — 66 requirements with traceability
- [Design](docs/DESIGN.md) — Architecture, schema, key decisions
- [Implementation](docs/IMPLEMENTATION.md) — 5-phase build plan
- [Status](docs/STATUS.md) — Current progress and next steps

## Status

Pre-Phase 1: Documentation complete, application code pending. See [STATUS.md](docs/STATUS.md).
