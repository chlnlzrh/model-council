# 06 — Red Team Mode

> Adversarial loop: generate, attack, defend, harden.

**Family:** Adversarial
**Status:** Specified
**Min Models:** 2 (generator + attacker; generator doubles as synthesizer)
**Max Models:** 3 (generator + attacker + separate synthesizer)
**Multi-turn:** No
**Stages:** Generate + 1-3 attack/defend rounds + synthesis

---

## A. Requirements

### Functional

1. User submits content for adversarial review (code, architecture, argument, proposal, policy, etc.).
2. **Stage 1 — Generate:** The generator model structures the user's content into an analyzable format. Faithfully represents the input without adding or removing substance.
3. **Stage 2 — Attack Round N:** The attacker model finds vulnerabilities, flaws, and failure modes. Each finding has a title, severity (CRITICAL/HIGH/MEDIUM/LOW), location reference, vulnerability description, and concrete exploit scenario. Findings are numbered.
4. **Stage 3 — Defend Round N:** The generator addresses every finding with a verdict of ACCEPT (genuine flaw, provides specific revision) or REBUT (invalid finding, explains why). Produces a fully revised version incorporating all accepted fixes.
5. **Repeat Stages 2-3** for the configured number of rounds (1-3, default 2). In subsequent attack rounds, the attacker must find NEW weaknesses or demonstrate why previous defenses are insufficient.
6. **Final Stage — Synthesize:** A synthesizer model (may be the generator) produces the hardened final output plus a vulnerability audit summary table.
7. A title is generated for new conversations.
8. All results are saved to the database via the `deliberation_stages` table.

### Non-Functional

- Each stage is a single sequential model call.
- Per-stage timeout: 120 seconds.
- Global pipeline timeout: 600 seconds.
- Stages are strictly sequential (attack depends on generate, defend depends on attack).
- Total pipeline target: under 180 seconds for 2 rounds.

### Model Constraints

- Minimum 2 models: generator (also defends and optionally synthesizes) + attacker.
- Maximum 3 models: generator + attacker + separate synthesizer.
- Generator and attacker MUST be different models (adversarial integrity).
- The synthesizer may be the same as the generator or a third model.

### What Makes It Distinct

- True adversarial dynamic: attacker and defender are different models with opposing objectives.
- Severity-rated findings with structured format enable automated vulnerability tracking.
- ACCEPT/REBUT defense forces honest engagement with each finding.
- Multiple rounds escalate difficulty — attacker must find NEW weaknesses each round.
- Hardened output preserves a full audit trail of what was found and how it was addressed.

---

## B. Pipeline Design

### Stages

| Stage | Name | Parallel? | Input | Output |
|-------|------|-----------|-------|--------|
| 1 | Generate | No | User input | `GenerateResponse` |
| 2a | Attack (Round 1) | No | Generated content | `AttackResponse` |
| 2b | Defend (Round 1) | No | Original + attack report | `DefendResponse` |
| 3a | Attack (Round 2) | No | Revised content + previous defense | `AttackResponse` |
| 3b | Defend (Round 2) | No | Revised content + new attack report | `DefendResponse` |
| ... | ... | ... | ... | ... |
| N | Synthesize | No | All rounds data | `SynthesisResponse` |

### Data Flow

```
User Input
    |
    v
Stage 1: queryModel(generatorModel, generatePrompt)
    | GenerateResponse { structuredContent }
    v
Attack Round 1: queryModel(attackerModel, attackPrompt(structuredContent))
    | AttackResponse { findings[], summary }
    | if findings.length === 0 → skip defense, go to synthesis
    v
Defend Round 1: queryModel(generatorModel, defendPrompt(structuredContent, attackReport))
    | DefendResponse { responses[], revisedContent, accepted, rebutted }
    v
Attack Round 2: queryModel(attackerModel, attackPrompt(revisedContent, previousDefense))
    | AttackResponse { findings[], summary }
    | if findings.length === 0 → skip defense, go to synthesis
    v
Defend Round 2: queryModel(generatorModel, defendPrompt(revisedContent, attackReport))
    | DefendResponse { responses[], revisedContent, accepted, rebutted }
    v
... (up to configured rounds)
    v
Synthesize: queryModel(synthesizerModel, synthesisPrompt(all rounds))
    | SynthesisResponse { hardenedOutput, auditSummary }
    v
generateTitle() -> save to DB -> stream to client
```

### Prompt Templates

**Generator Prompt:**

```
You are preparing content for adversarial review. Present the following content in a clear, structured format that can be systematically analyzed for weaknesses.

USER INPUT:
{{USER_INPUT}}

Present this content in a well-organized format. If it is code, include the full code with clear section markers. If it is an architecture or argument, structure it with numbered sections. Do not add or remove substance — faithfully represent the user's input in an analyzable form.
```

**Attack Prompt (Round 1):**

```
You are a ruthless red team adversary. Your job is to find every weakness, vulnerability, flaw, gap, and failure mode in the following content. Do NOT be polite. Be direct and devastating.

CONTENT UNDER REVIEW:
{{CONTENT}}

For EACH finding:
- Severity: CRITICAL / HIGH / MEDIUM / LOW
- Location: [specific section or line]
- Vulnerability: [description]
- Exploit Scenario: [concrete failure case]

Format:
ATTACK REPORT — ROUND 1

FINDING 1: [Title]
Severity: [CRITICAL|HIGH|MEDIUM|LOW]
Location: [reference]
Vulnerability: [description]
Exploit Scenario: [how this fails]

FINDING 2: [Title]
...

SUMMARY:
- Critical: [count], High: [count], Medium: [count], Low: [count]
- Overall risk: [assessment]
```

**Attack Prompt (Round 2+):**

```
You are a ruthless red team adversary. Your job is to find every weakness, vulnerability, flaw, gap, and failure mode in the following content. Do NOT be polite. Be direct and devastating.

CONTENT UNDER REVIEW (REVISED):
{{REVISED_CONTENT}}

The author previously defended against these attacks:
{{PREVIOUS_DEFENSE}}

Find NEW weaknesses they missed, or demonstrate why their defenses are insufficient. Do not repeat findings that were adequately addressed.

For EACH finding:
- Severity: CRITICAL / HIGH / MEDIUM / LOW
- Location: [specific section or line]
- Vulnerability: [description]
- Exploit Scenario: [concrete failure case]

Format:
ATTACK REPORT — ROUND {{ROUND_NUMBER}}

FINDING 1: [Title]
Severity: [CRITICAL|HIGH|MEDIUM|LOW]
Location: [reference]
Vulnerability: [description]
Exploit Scenario: [how this fails]

...

SUMMARY:
- Critical: [count], High: [count], Medium: [count], Low: [count]
- Overall risk: [assessment]
- Delta from previous round: [improved/worsened/unchanged]
```

**Defense Prompt:**

```
You are defending your work against a red team attack. Address EVERY finding honestly. Do not dismiss valid concerns. Do not accept invalid ones.

ORIGINAL CONTENT:
{{ORIGINAL_CONTENT}}

ATTACK REPORT:
{{ATTACK_REPORT}}

For EACH finding: ACCEPT (genuine flaw — provide revision) or REBUT (invalid — explain why with evidence).

Format:
DEFENSE REPORT — ROUND {{ROUND_NUMBER}}

RESPONSE TO FINDING 1: [Title]
Verdict: [ACCEPT|REBUT]
Reasoning: [explanation]
Revision: [if ACCEPT, specific change. If REBUT, write "N/A"]

RESPONSE TO FINDING 2: [Title]
...

DEFENSE SUMMARY:
- Accepted: [count], Rebutted: [count]

---
REVISED CONTENT:
[full revised content incorporating all accepted fixes]
```

**Synthesis Prompt:**

```
You are a security-minded synthesizer producing the final hardened version of content that has undergone {{TOTAL_ROUNDS}} round(s) of adversarial review.

ORIGINAL CONTENT:
{{ORIGINAL_CONTENT}}

{{#each ROUNDS}}
--- ROUND {{ROUND_NUMBER}} ---
ATTACK REPORT:
{{ATTACK_REPORT}}

DEFENSE REPORT:
{{DEFENSE_REPORT}}
{{/each}}

Produce:

## Hardened Output
[The final, hardened version of the content. Integrate all accepted fixes. Where rebuttals were valid, preserve the original. Where the defense was weak, apply your own judgment to strengthen.]

## Vulnerability Audit Summary

| # | Finding | Severity | Verdict | Status |
|---|---------|----------|---------|--------|
{{#each ALL_FINDINGS}}
| {{@index + 1}} | {{title}} | {{severity}} | {{verdict}} | {{status}} |
{{/each}}

| Metric | Value |
|--------|-------|
| Total Findings | {{totalFindings}} |
| Critical | {{criticalCount}} ({{criticalAccepted}} accepted, {{criticalRebutted}} rebutted) |
| High | {{highCount}} ({{highAccepted}} accepted, {{highRebutted}} rebutted) |
| Medium | {{mediumCount}} ({{mediumAccepted}} accepted, {{mediumRebutted}} rebutted) |
| Low | {{lowCount}} ({{lowAccepted}} accepted, {{lowRebutted}} rebutted) |
| Rounds Completed | {{TOTAL_ROUNDS}} |
| Remaining Risks | [list any unresolved or partially addressed risks] |
| Hardening Confidence | [High/Medium/Low — based on severity of remaining risks] |
```

### Parser Functions

```typescript
interface Finding {
  title: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  location: string;
  vulnerability: string;
  exploitScenario: string;
}

interface AttackSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  overallRisk: string;
}

interface DefenseResponse {
  findingTitle: string;
  verdict: "ACCEPT" | "REBUT";
  reasoning: string;
  revision: string | null; // null if REBUT
}

function parseAttackReport(text: string): { findings: Finding[]; summary: AttackSummary } {
  // Regex: /FINDING\s+(\d+):\s*(.+)\nSeverity:\s*(CRITICAL|HIGH|MEDIUM|LOW)\nLocation:\s*(.+)\nVulnerability:\s*(.+)\nExploit Scenario:\s*(.+)/gi
  // Fallback: split by "FINDING" and parse each block
}

function parseDefenseReport(text: string): { responses: DefenseResponse[]; accepted: number; rebutted: number; revisedContent: string } {
  // Regex: /RESPONSE TO FINDING\s+\d+:\s*(.+)\nVerdict:\s*(ACCEPT|REBUT)\nReasoning:\s*(.+)\nRevision:\s*(.*)/gi
  // Extract REVISED CONTENT section after "---"
}
```

---

## C. SSE Event Sequence

```
 1. redteam_start         -> { conversationId, messageId, totalRounds }
 2. generate_start        -> {}
 3. generate_complete     -> { data: GenerateResponse }
 4. attack_start          -> { round: 1 }
 5. attack_complete       -> { round: 1, data: AttackCompletePayload }
 6. defend_start          -> { round: 1 }
 7. defend_complete       -> { round: 1, data: DefendCompletePayload }
 8. attack_start          -> { round: 2 }
 9. attack_complete       -> { round: 2, data: AttackCompletePayload }
10. defend_start          -> { round: 2 }
11. defend_complete       -> { round: 2, data: DefendCompletePayload }
12. synthesize_start      -> {}
13. synthesize_complete   -> { data: SynthesisResponse }
14. title_complete        -> { data: { title: string } }
15. complete              -> {}
```

On error at any point:
```
error -> { message: string }
```

Special case — attacker finds zero flaws:
```
 4. attack_start          -> { round: 1 }
 5. attack_complete       -> { round: 1, data: { findings: [], summary: {...}, noFlaws: true } }
    (skip defend_start/defend_complete for this round)
12. synthesize_start      -> {}
    ...
```

### TypeScript Payload Interfaces

```typescript
// redteam_start
interface RedTeamStartPayload {
  conversationId: string;
  messageId: string;
  totalRounds: number;
}

// generate_complete
interface GenerateCompletePayload {
  data: GenerateResponse;
}

interface GenerateResponse {
  model: string;
  structuredContent: string;
  responseTimeMs: number;
}

// attack_complete
interface AttackCompletePayload {
  round: number;
  data: {
    model: string;
    findings: Finding[];
    summary: AttackSummary;
    noFlaws: boolean;
    responseTimeMs: number;
  };
}

// defend_complete
interface DefendCompletePayload {
  round: number;
  data: {
    model: string;
    responses: DefenseResponse[];
    accepted: number;
    rebutted: number;
    revisedContent: string;
    responseTimeMs: number;
  };
}

// synthesize_complete
interface SynthesizeCompletePayload {
  data: SynthesisResponse;
}

interface SynthesisResponse {
  model: string;
  hardenedOutput: string;
  auditSummary: string;
  responseTimeMs: number;
}

// title_complete
interface TitleCompletePayload {
  data: { title: string };
}
```

---

## D. Input Format

### Request Body

```typescript
interface RedTeamStreamRequest {
  question: string;
  mode: "red_team";
  conversationId?: string;
  modeConfig?: RedTeamConfig;
}

interface RedTeamConfig {
  generatorModel?: string;      // structures content + defends
  attackerModel?: string;       // finds vulnerabilities
  synthesizerModel?: string;    // produces hardened output (defaults to generatorModel)
  rounds?: number;              // 1-3, default 2
  timeoutMs?: number;           // per-stage timeout, default 120_000
  maxInputLength?: number;      // truncate user input, default 25_000
}
```

### Zod Validation

```typescript
const redTeamConfigSchema = z.object({
  generatorModel: z.string().optional(),
  attackerModel: z.string().optional(),
  synthesizerModel: z.string().optional(),
  rounds: z.number().int().min(1).max(3).default(2),
  timeoutMs: z.number().min(30_000).max(180_000).default(120_000),
  maxInputLength: z.number().min(1_000).max(50_000).default(25_000),
}).refine(
  (data) => !data.generatorModel || !data.attackerModel || data.generatorModel !== data.attackerModel,
  { message: "Generator and attacker must be different models for adversarial integrity" }
).optional();

const redTeamRequestSchema = z.object({
  question: z.string().min(1, "Content for review is required"),
  mode: z.literal("red_team"),
  conversationId: z.string().optional(),
  modeConfig: redTeamConfigSchema,
});
```

### Example Requests

Code review:
```json
{
  "question": "Review this authentication middleware:\n\n```typescript\nexport async function authMiddleware(req: Request) {\n  const token = req.headers.get('authorization')?.split(' ')[1];\n  if (!token) return new Response('Unauthorized', { status: 401 });\n  const decoded = jwt.verify(token, process.env.JWT_SECRET!);\n  req.user = decoded;\n}\n```",
  "mode": "red_team",
  "modeConfig": {
    "generatorModel": "anthropic/claude-opus-4-6",
    "attackerModel": "openai/o3",
    "rounds": 2
  }
}
```

Architecture review:
```json
{
  "question": "Review our microservices architecture: API Gateway -> Auth Service -> User Service -> PostgreSQL. All services communicate via REST. No rate limiting. Secrets in environment variables.",
  "mode": "red_team",
  "modeConfig": {
    "generatorModel": "google/gemini-2.5-pro",
    "attackerModel": "anthropic/claude-opus-4-6",
    "synthesizerModel": "openai/o3",
    "rounds": 3
  }
}
```

Minimal (defaults):
```json
{
  "question": "Our password policy requires 8+ characters with at least one number.",
  "mode": "red_team"
}
```

---

## E. Output Format

### Result Interface

```typescript
interface RedTeamResult {
  generate: GenerateResponse;
  rounds: RedTeamRound[];
  synthesis: SynthesisResponse;
  totalFindings: number;
  totalAccepted: number;
  totalRebutted: number;
  severityCounts: AttackSummary; // aggregate across all rounds
  title?: string;
}

interface RedTeamRound {
  roundNumber: number;
  attack: {
    model: string;
    findings: Finding[];
    summary: AttackSummary;
    noFlaws: boolean;
    responseTimeMs: number;
  };
  defense: {
    model: string;
    responses: DefenseResponse[];
    accepted: number;
    rebutted: number;
    revisedContent: string;
    responseTimeMs: number;
  } | null; // null if attacker found zero flaws
}
```

### UI Display

- **Generate Stage:** Collapsible card showing the structured content produced by the generator. Labeled "Structured for Review" with generator model name and response time.
- **Attack/Defend Rounds:** Each round displayed as a two-column layout (attack left, defense right). Findings color-coded by severity: CRITICAL (red), HIGH (orange), MEDIUM (yellow), LOW (blue). Defense responses show ACCEPT (green check) or REBUT (red X) badges. Revised content shown in a diff view against the previous version.
- **Round Progression:** Visual indicator showing Round 1 of N, Round 2 of N, etc. Finding count badges per round.
- **Synthesis:** The hardened output is the primary displayed response in the chat. Vulnerability audit summary table rendered below with sortable columns.
- **Metrics Bar:** Total findings, acceptance rate, severity distribution as a horizontal stacked bar.

### DB Storage

All data stored in `deliberation_stages` table:

| stageType | stageOrder | model | role | content | parsedData |
|-----------|------------|-------|------|---------|------------|
| `generate` | 0 | generator model | `generator` | structured content | `{ inputLength, outputLength }` |
| `attack_round_1` | 1 | attacker model | `attacker` | full attack report text | `AttackParsedData` |
| `defend_round_1` | 2 | generator model | `defender` | full defense report text | `DefendParsedData` |
| `attack_round_2` | 3 | attacker model | `attacker` | full attack report text | `AttackParsedData` |
| `defend_round_2` | 4 | generator model | `defender` | full defense report text | `DefendParsedData` |
| `synthesis` | 99 | synthesizer model | `synthesizer` | hardened output + audit | `SynthesisParsedData` |

---

## F. Edge Cases

| Scenario | Handling |
|----------|----------|
| Attacker finds zero flaws in Round 1 | Skip all defense stages. Proceed directly to synthesis. Synthesizer notes "Content withstood adversarial review with no findings." |
| Attacker finds zero flaws in Round N (N > 1) | Skip defense for that round. Proceed to synthesis. Previous rounds' findings still included in audit. |
| Generator model fails in Generate stage | Use raw user input as the structured content. Log failure. Continue pipeline with user input verbatim. |
| Attacker model fails | Skip that attack round entirely. If Round 1, skip to synthesis with note "Attack phase failed." If Round 2+, use last defended content for synthesis. |
| Generator model fails in Defend stage | Skip defense for that round. Last available content (either original or previous revision) carries forward. Attacker findings remain unaddressed in audit. |
| Synthesizer model fails | Emit `error` event. Generate and round data are still saved. The last defended/revised content serves as the best available output. |
| Very large user input (> maxInputLength) | Truncate to `maxInputLength` characters (default 25,000). Add a note: "[Content truncated to {{maxInputLength}} characters for review]". |
| Per-stage timeout (120s) | `AbortSignal.timeout(timeoutMs)`. Treated as model failure for that stage. Apply the relevant failure handling above. |
| Global pipeline timeout (600s) | Complete current stage, skip remaining rounds, proceed to synthesis with available data. If synthesis cannot complete, emit partial results. |
| Parsing failure (attack report) | Store raw text in `content`. Set `parsedData` to `{ parseError: true, rawText: "..." }`. Synthesis receives raw text. |
| Parsing failure (defense report) | Store raw text in `content`. Set `parsedData` to `{ parseError: true, rawText: "..." }`. Extract revised content as best-effort from the raw text. |
| Generator and attacker are the same model | Rejected at validation (Zod `.refine()`). Return 400 error: "Generator and attacker must be different models." |
| Only 2 models configured (no separate synthesizer) | Generator doubles as synthesizer. This is the default behavior. |
| Attacker repeats findings from previous rounds | Not enforced server-side. The attack prompt instructs "find NEW weaknesses." Duplicate findings may appear in the audit but do not affect pipeline execution. |

---

## G. Database Schema

Uses the `deliberation_stages` table exclusively (no legacy tables).

### Row Shapes

**Generate row:**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "generate",
  stageOrder: 0,
  model: "anthropic/claude-opus-4-6",
  role: "generator",
  content: "## Authentication Middleware Analysis\n\n### Section 1: Token Extraction\n...",
  parsedData: {
    inputLength: 342,
    outputLength: 1580
  },
  responseTimeMs: 5400,
  createdAt: "2026-02-09T..."
}
```

**Attack row (Round 1):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "attack_round_1",
  stageOrder: 1,
  model: "openai/o3",
  role: "attacker",
  content: "ATTACK REPORT — ROUND 1\n\nFINDING 1: Missing Token Expiration Check\nSeverity: CRITICAL\n...",
  parsedData: {
    round: 1,
    findings: [
      {
        title: "Missing Token Expiration Check",
        severity: "CRITICAL",
        location: "Line 4: jwt.verify()",
        vulnerability: "No expiration validation. Tokens are valid indefinitely once issued.",
        exploitScenario: "A leaked token can be used forever, even after password change."
      },
      {
        title: "No Error Handling for jwt.verify",
        severity: "HIGH",
        location: "Line 4",
        vulnerability: "jwt.verify throws on invalid tokens. Unhandled exception crashes the server.",
        exploitScenario: "Attacker sends malformed JWT, causing 500 error and potential DoS."
      },
      {
        title: "Environment Variable Direct Access",
        severity: "MEDIUM",
        location: "Line 4: process.env.JWT_SECRET!",
        vulnerability: "Non-null assertion on env var. If unset, jwt.verify receives undefined as secret.",
        exploitScenario: "Deployment without JWT_SECRET set leads to signature bypass."
      }
    ],
    summary: {
      critical: 1,
      high: 1,
      medium: 1,
      low: 0,
      overallRisk: "HIGH — Critical authentication bypass possible"
    }
  },
  responseTimeMs: 11200,
  createdAt: "2026-02-09T..."
}
```

**Defense row (Round 1):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "defend_round_1",
  stageOrder: 2,
  model: "anthropic/claude-opus-4-6",
  role: "defender",
  content: "DEFENSE REPORT — ROUND 1\n\nRESPONSE TO FINDING 1: Missing Token Expiration Check\nVerdict: ACCEPT\n...",
  parsedData: {
    round: 1,
    responses: [
      {
        findingTitle: "Missing Token Expiration Check",
        verdict: "ACCEPT",
        reasoning: "Valid concern. Token expiration should be enforced.",
        revision: "Added expiresIn check and maxAge option to jwt.verify"
      },
      {
        findingTitle: "No Error Handling for jwt.verify",
        verdict: "ACCEPT",
        reasoning: "Correct. Unhandled throws will crash the process.",
        revision: "Wrapped jwt.verify in try-catch, returning 401 on failure"
      },
      {
        findingTitle: "Environment Variable Direct Access",
        verdict: "REBUT",
        reasoning: "The application validates all required env vars at startup via a config module. If JWT_SECRET is missing, the server refuses to start.",
        revision: null
      }
    ],
    accepted: 2,
    rebutted: 1,
    revisedContentLength: 1820
  },
  responseTimeMs: 14300,
  createdAt: "2026-02-09T..."
}
```

**Attack row (Round 2):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "attack_round_2",
  stageOrder: 3,
  model: "openai/o3",
  role: "attacker",
  content: "ATTACK REPORT — ROUND 2\n\nFINDING 1: Token Revocation Not Implemented\nSeverity: HIGH\n...",
  parsedData: {
    round: 2,
    findings: [
      {
        title: "Token Revocation Not Implemented",
        severity: "HIGH",
        location: "Overall architecture",
        vulnerability: "Even with expiration, there is no mechanism to revoke active tokens before expiry.",
        exploitScenario: "Compromised token remains valid until natural expiration."
      }
    ],
    summary: {
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
      overallRisk: "MEDIUM — Significant improvement from Round 1, one residual risk"
    }
  },
  responseTimeMs: 9800,
  createdAt: "2026-02-09T..."
}
```

**Synthesis row:**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "synthesis",
  stageOrder: 99,
  model: "anthropic/claude-opus-4-6",
  role: "synthesizer",
  content: "## Hardened Output\n\n```typescript\nexport async function authMiddleware(req: Request) {\n  ...\n}\n```\n\n## Vulnerability Audit Summary\n\n| # | Finding | Severity | Verdict | Status |\n|---|---------|----------|---------|--------|\n| 1 | Missing Token Expiration Check | CRITICAL | ACCEPT | Fixed |\n...",
  parsedData: {
    totalRounds: 2,
    totalFindings: 4,
    totalAccepted: 3,
    totalRebutted: 1,
    severityCounts: {
      critical: 1,
      high: 2,
      medium: 1,
      low: 0
    },
    hardeningConfidence: "Medium"
  },
  responseTimeMs: 16700,
  createdAt: "2026-02-09T..."
}
```

### Indexes

The shared index from `00-shared-infrastructure.md` applies:
```sql
CREATE INDEX idx_deliberation_stages_message ON deliberation_stages(message_id, stage_order);
```

### Querying Pattern

To reconstruct a complete Red Team result from the database:

```typescript
async function loadRedTeamResult(messageId: string): Promise<RedTeamResult> {
  const stages = await db
    .select()
    .from(deliberationStages)
    .where(eq(deliberationStages.messageId, messageId))
    .orderBy(deliberationStages.stageOrder, deliberationStages.createdAt);

  const generate = stages.find((s) => s.stageType === "generate");
  const attackStages = stages.filter((s) => s.stageType.startsWith("attack_round_"));
  const defendStages = stages.filter((s) => s.stageType.startsWith("defend_round_"));
  const synthesis = stages.find((s) => s.stageType === "synthesis");

  // Pair attack and defense stages by round number
  const rounds: RedTeamRound[] = attackStages.map((attack) => {
    const roundNum = parseInt(attack.stageType.split("_").pop()!, 10);
    const defense = defendStages.find((d) => d.stageType === `defend_round_${roundNum}`);
    return {
      roundNumber: roundNum,
      attack: { model: attack.model!, findings: attack.parsedData.findings, ... },
      defense: defense ? { model: defense.model!, responses: defense.parsedData.responses, ... } : null,
    };
  });

  // Aggregate severity counts across all rounds
  // Return full RedTeamResult
}
```
