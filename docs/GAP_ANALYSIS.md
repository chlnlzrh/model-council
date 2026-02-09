# Gap Analysis: Karpathy Prototype → Model Council

> Compares the `karpathy/llm-council` prototype (1,965 lines, React+Vite / FastAPI+Python / OpenRouter / JSON storage) against the production-grade Model Council target.

---

## 1. Framework & Language

| Aspect | Karpathy Prototype | Model Council Target | Gap Severity |
|--------|-------------------|---------------------|--------------|
| Frontend framework | React 19 + Vite SPA | Next.js 14+ App Router (RSC) | **CRITICAL** |
| Language | JavaScript (.jsx/.js) | TypeScript strict mode | **CRITICAL** |
| Build tool | Vite dev server (port 5173) | Next.js built-in (Turbopack) | HIGH |
| Routing | Client-side (react-router-like) | File-based App Router | HIGH |
| Rendering | Client-side only (CSR) | Server Components + Client Components | HIGH |
| Deployment | Manual (`uvicorn` + `npm run dev`) | Vercel (zero-config) | HIGH |

**Impact:** Complete rewrite required. No code can be directly ported — only logic patterns and prompt templates transfer.

---

## 2. Backend Architecture

| Aspect | Karpathy Prototype | Model Council Target | Gap Severity |
|--------|-------------------|---------------------|--------------|
| Server | FastAPI (Python 3.x, port 8001) | Next.js API Routes + Server Actions | **CRITICAL** |
| Entry point | `backend/main.py` (199 lines) | `app/api/` route handlers | **CRITICAL** |
| CORS | Manual middleware (localhost only) | Not needed (same origin) | LOW |
| API contract | 5 REST endpoints | Same contract + new endpoints | MEDIUM |
| Streaming | FastAPI `StreamingResponse` (SSE) | Route Handler `ReadableStream` (SSE) | HIGH |
| Request validation | Pydantic models | Zod schemas | HIGH |

**Impact:** All backend logic moves from Python to TypeScript. FastAPI patterns → Next.js API Routes. The SSE event format (6 event types) transfers directly.

### API Endpoints (Prototype)

```
GET  /                                       → Health check
GET  /api/conversations                      → List conversations
POST /api/conversations                      → Create conversation
GET  /api/conversations/{id}                 → Get conversation
POST /api/conversations/{id}/message         → Send message (batch)
POST /api/conversations/{id}/message/stream  → Send message (SSE)
```

### SSE Event Types (Prototype → Preserved)

```
stage1_start     → {}
stage1_complete  → { data: Stage1Response[] }
stage2_start     → {}
stage2_complete  → { data: Stage2Response[], metadata: { label_to_model, aggregate_rankings } }
stage3_start     → {}
stage3_complete  → { data: Stage3Response }
title_complete   → { data: { title: string } }
complete         → {}
error            → { message: string }
```

---

## 3. LLM Client

| Aspect | Karpathy Prototype | Model Council Target | Gap Severity |
|--------|-------------------|---------------------|--------------|
| HTTP client | Raw `httpx.AsyncClient` | Vercel AI SDK (`@ai-sdk/openai`) | **CRITICAL** |
| Provider | Direct OpenRouter HTTP calls | Vercel AI SDK → OpenRouter | HIGH |
| Parallel queries | `asyncio.gather()` (79 lines) | `Promise.allSettled()` via AI SDK | HIGH |
| Streaming | Not implemented (batch only) | AI SDK `streamText()` for token streaming | HIGH |
| Timeout | 120s hardcoded | Configurable per model | MEDIUM |
| Error handling | `try/except` returns `None` | Typed `Result<T, Error>` pattern | MEDIUM |
| Response format | `{ content, reasoning_details }` | AI SDK `TextStreamPart` types | MEDIUM |

**Impact:** Replace 79-line `openrouter.py` with Vercel AI SDK client. The SDK provides streaming, structured output, and tool use for free. OpenRouter is accessed by pointing `@ai-sdk/openai` at `https://openrouter.ai/api/v1`.

---

## 4. Data Persistence

| Aspect | Karpathy Prototype | Model Council Target | Gap Severity |
|--------|-------------------|---------------------|--------------|
| Storage | JSON files (`data/conversations/`) | Drizzle ORM + @vercel/postgres (Neon) | **CRITICAL** |
| Schema | Flat JSON per conversation | Normalized relational (7 tables) | **CRITICAL** |
| Rankings persistence | **NOT PERSISTED** (ephemeral metadata) | Fully persisted with parsed JSONB | **CRITICAL** |
| Label maps | Returned in API, not stored | Persisted in `stage2_label_map` table | HIGH |
| Aggregate rankings | Calculated on-the-fly, not stored | Stored + queryable for analytics | HIGH |
| Response times | Not tracked | `response_time_ms` per model per stage | HIGH |
| Conversation ownership | None (global) | User-scoped with FK constraints | HIGH |
| Migrations | N/A (schemaless JSON) | Drizzle migrations | MEDIUM |

**Impact:** The prototype's biggest architectural flaw. Rankings, label maps, and aggregate scores are calculated but never persisted. Model Council stores everything, enabling analytics and historical queries.

### Prototype Data Model (JSON)

```json
{
  "id": "uuid",
  "created_at": "ISO-8601",
  "title": "string",
  "messages": [
    { "role": "user", "content": "string" },
    {
      "role": "assistant",
      "stage1": [{ "model": "string", "response": "string" }],
      "stage2": [{ "model": "string", "ranking": "string", "parsed_ranking": ["Response A", ...] }],
      "stage3": { "model": "string", "response": "string" }
    }
  ]
}
```

### Target Data Model (Normalized)

```
users → conversations → messages → stage1_responses
                                 → stage2_rankings
                                 → stage2_label_map
                                 → stage3_synthesis
users → model_presets
```

---

## 5. Authentication & Authorization

| Aspect | Karpathy Prototype | Model Council Target | Gap Severity |
|--------|-------------------|---------------------|--------------|
| Authentication | **NONE** | Auth.js v5 (email/password + OAuth) | **CRITICAL** |
| Session management | N/A | Auth.js sessions (JWT/database) | **CRITICAL** |
| Route protection | N/A | Next.js middleware | HIGH |
| Conversation ownership | Global (anyone sees everything) | User-scoped (FK to `users`) | HIGH |
| API key management | Single `.env` key | Per-user or shared key | MEDIUM |

**Impact:** Zero-to-one gap. The prototype has no concept of users — all conversations are global.

---

## 6. UI Framework & Styling

| Aspect | Karpathy Prototype | Model Council Target | Gap Severity |
|--------|-------------------|---------------------|--------------|
| Component library | None (raw HTML + CSS) | Shadcn UI (Radix primitives) | HIGH |
| Styling approach | Vanilla CSS (484 lines, 5 files) | Tailwind CSS + design tokens | HIGH |
| Colors | Hardcoded hex (`#4a90e2`, `#f0fff0`) | Semantic tokens (CSS variables) | MEDIUM |
| Dark mode | **NONE** | Light/dark + system preference | HIGH |
| Typography | Default browser fonts | Inter, `text-xs` baseline | MEDIUM |
| Icons | None | Lucide React (16x16px) | LOW |
| Markdown rendering | `react-markdown` | `react-markdown` (preserved) | NONE |

**Impact:** Complete styling rewrite. The prototype's 484 lines of vanilla CSS become Tailwind utility classes + Shadcn tokens.

---

## 7. Responsive Design

| Aspect | Karpathy Prototype | Model Council Target | Gap Severity |
|--------|-------------------|---------------------|--------------|
| Layout approach | Fixed layout, no breakpoints | Mobile-first, 5 breakpoints | **CRITICAL** |
| Sidebar | Fixed 260px width | Collapsible, icon-only on mobile | HIGH |
| Touch targets | Standard (no mobile consideration) | 44x44pt min (iOS), 48x48dp (Android) | HIGH |
| Breakpoints | None | 320/375/768/1024/1440px | HIGH |
| Mobile nav | None | Hamburger → slide panel | HIGH |

**Impact:** The prototype is desktop-only. Complete responsive implementation needed.

---

## 8. Model Configuration

| Aspect | Karpathy Prototype | Model Council Target | Gap Severity |
|--------|-------------------|---------------------|--------------|
| Council models | 4 hardcoded in `config.py` | UI-configurable with presets | HIGH |
| Chairman model | Hardcoded (`gemini-3-pro-preview`) | User-selectable from council or separate | HIGH |
| Model discovery | Manual (edit config file) | OpenRouter API `/models` endpoint | MEDIUM |
| Presets | None | Saveable named configurations | MEDIUM |
| Per-conversation config | None | Model preset FK on conversation | MEDIUM |

**Impact:** Users cannot change models without editing source code. Need full settings UI.

### Prototype Hardcoded Models

```python
COUNCIL_MODELS = [
    "openai/gpt-5.1",
    "google/gemini-3-pro-preview",
    "anthropic/claude-sonnet-4.5",
    "x-ai/grok-4",
]
CHAIRMAN_MODEL = "google/gemini-3-pro-preview"
```

---

## 9. Multi-Turn Conversations

| Aspect | Karpathy Prototype | Model Council Target | Gap Severity |
|--------|-------------------|---------------------|--------------|
| Context management | Single-turn only | Full conversation history in context | HIGH |
| Input visibility | Top of chat, hidden on scroll | Always-visible bottom input | HIGH |
| Token management | None | Token counting + truncation | MEDIUM |
| Follow-up queries | Must reference prior context manually | Automatic context injection | HIGH |

**Impact:** The prototype sends only the current user query to models. No conversation history is included, making follow-up questions impossible without the user manually restating context.

---

## 10. Testing

| Aspect | Karpathy Prototype | Model Council Target | Gap Severity |
|--------|-------------------|---------------------|--------------|
| Unit tests | **ZERO** | 80% coverage minimum | **CRITICAL** |
| Integration tests | None | API route + DB tests | **CRITICAL** |
| E2E tests | None | Critical path coverage | HIGH |
| Test runner | None | Vitest + React Testing Library | HIGH |
| Mocking | None | MSW for API mocking | MEDIUM |
| CI | None | GitHub Actions pipeline | MEDIUM |

**Impact:** Zero test coverage. One of the largest gaps — the prototype has a single `test_openrouter.py` connectivity check.

---

## 11. Core Pipeline Logic (Transferable)

These patterns transfer conceptually (reimplemented in TypeScript):

| Component | Prototype Location | Lines | Transfer Strategy |
|-----------|-------------------|-------|-------------------|
| 3-stage orchestration | `council.py:296-335` | 40 | Reimplement as `orchestrator.ts` |
| Stage 1 parallel queries | `council.py:8-32` | 25 | AI SDK `Promise.allSettled()` |
| Stage 2 ranking prompt | `council.py:64-93` | 30 | Port prompt template verbatim |
| Stage 2 anonymization | `council.py:49-56` | 8 | Port label generation logic |
| Stage 3 chairman prompt | `council.py:142-157` | 16 | Port prompt template verbatim |
| Ranking parser (regex) | `council.py:177-208` | 32 | Port regex to TypeScript |
| Aggregate calculator | `council.py:211-255` | 45 | Port algorithm to TypeScript |
| Title generation | `council.py:258-293` | 36 | Port with AI SDK |
| SSE event format | `main.py:140-181` | 42 | Preserve 6 event types exactly |
| De-anonymization | `Stage2.jsx:5-15` | 11 | Port client-side logic |

---

## 12. Error Handling & Resilience

| Aspect | Karpathy Prototype | Model Council Target | Gap Severity |
|--------|-------------------|---------------------|--------------|
| Model failure | Returns `None`, continues | Typed `Result<T>`, continues + logs | MEDIUM |
| All models fail | Returns error message | Error state UI + retry | MEDIUM |
| Network errors | Generic `console.error` | Toast notifications + retry | MEDIUM |
| Optimistic UI | User message added pre-response | Same + rollback on total failure | LOW |
| Stream errors | SSE `error` event | Same + reconnection logic | MEDIUM |

**Impact:** The prototype's graceful degradation pattern is good and transfers. Need to add typed errors, retry logic, and user-visible error states.

---

## Summary: Gap Severity Distribution

| Severity | Count | Categories |
|----------|-------|-----------|
| **CRITICAL** | 14 | Framework, language, backend, LLM client, persistence (4), auth (2), responsive, testing (2) |
| **HIGH** | 18 | Build, routing, rendering, deployment, streaming, validation, model config (3), multi-turn (2), UI (3), responsive (3) |
| **MEDIUM** | 12 | Timeout, error types, migrations, API key, typography, token mgmt, presets, dark mode, mocking, CI, resilience (2) |
| **LOW** | 2 | CORS, icons |
| **NONE** | 1 | Markdown rendering |

**Total gaps identified: 47**

---

## Decision: Greenfield, Not Migration

Given 14 CRITICAL gaps and the complete framework/language change, migration is not viable. Every file must be rewritten. The prototype serves as:

1. **Logic reference** — 3-stage pipeline, prompt templates, ranking parser regex
2. **UX reference** — SSE state machine, progressive updates, tab-based stage views
3. **Contract reference** — SSE event format (6 types) preserved exactly

No source code will be copied. All logic is reimplemented in TypeScript with modern tooling.
