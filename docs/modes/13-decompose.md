# 13 — Decompose Mode

> Planner breaks the question into a DAG of sub-tasks. Workers solve parts in parallel. Assembler reunifies.

**Family:** Algorithmic
**Status:** Specified
**Min Models:** 2 (1 planner + 1 worker; planner doubles as assembler)
**Max Models:** 7 (1 planner + 5 workers + 1 assembler)
**Multi-turn:** No

---

## A. Requirements

### Functional

1. User submits a question or complex task.
2. **Stage 1 — Plan:** The planner model decomposes the question into 3-8 discrete sub-tasks. Each sub-task includes: an ID, title, description, dependency list (other task IDs that must complete first), estimated complexity (LOW/MEDIUM/HIGH), and an optional expertise tag.
3. **Stage 2 — Assign:** Server-side computation. Topological sort validates the DAG (detects cycles). Workers are assigned to tasks round-robin (or by expertise tag if specified and matching). Tasks are grouped into execution waves — a wave contains all tasks whose dependencies are satisfied.
4. **Stage 3 — Execute Waves:** For each wave in topological order, all tasks in the wave execute in parallel. Each worker receives the original question, its sub-task description, and the outputs of any dependency tasks. Waves are sequential (wave N+1 starts after wave N completes).
5. **Stage 4 — Assemble:** The assembler model receives the original question, the full task plan, and all sub-task outputs in topological order. It produces a unified, coherent response that integrates all parts.
6. A title is generated for new conversations.
7. All results are saved to the database via the `deliberation_stages` table.

### Non-Functional

- Stage 1 (Plan) is a single model call.
- Stage 2 (Assign) is instantaneous server-side computation.
- Each wave completes in the time of the slowest task within that wave (parallel).
- Waves are sequential.
- Stage 4 (Assemble) is a single model call.
- Total pipeline target: under 180 seconds.
- Topological sort and DAG validation are performed server-side in TypeScript, not delegated to the LLM.

### Model Constraints

- Minimum: 1 planner + 1 worker = 2 models. The planner can double as the assembler.
- Maximum: 1 planner + 5 workers + 1 assembler = 7 models.
- The planner model is always distinct and produces the task plan.
- Worker models execute sub-tasks. Multiple workers can be assigned different tasks.
- The assembler may be the same as the planner, or a distinct model.
- If only 1 worker is provided, all sub-tasks are assigned to that worker (sequential within each wave, but still wave-parallel across independent tasks).

### What Makes It Distinct

- DAG-based decomposition: complex questions are broken into manageable sub-tasks with explicit dependencies.
- Parallel execution of independent sub-tasks within each wave.
- Expertise routing: sub-tasks can be tagged for specific model strengths.
- Topological ordering ensures correct dependency resolution.
- Assembly produces a coherent unified answer, not a collection of fragments.
- Execution statistics provide transparency into parallelism efficiency and critical path timing.

---

## B. Pipeline Design

### Stages

| Stage | Name | Parallel? | Input | Output |
|-------|------|-----------|-------|--------|
| 1 | Plan | No | User query | `TaskPlan` |
| 2 | Assign | Server | TaskPlan + worker models | `TaskAssignment[]` |
| 3.N | Wave N | Yes (within wave) | Sub-task descriptions + dependency outputs | `TaskOutput[]` |
| 4 | Assemble | No | All task outputs + plan | `AssemblyResult` |

### Data Flow

```
User Query
    |
    v
Stage 1: queryModel(plannerModel, planPrompt)
    | TaskPlan — parsed into SubTask[] with dependencies
    v
Stage 2: topologicalSort(tasks) -> assignWorkers(tasks, workerModels)
    | executionWaves: string[][] — groups of task IDs per wave
    | assignments: Map<taskId, model>
    v
Wave 1: queryModelsParallel(wave1Workers, taskPrompts)
    | TaskOutput[] — each task's output stored
    v
Wave 2: queryModelsParallel(wave2Workers, taskPrompts + dependency outputs)
    | TaskOutput[]
    v
... (repeat for all waves)
    v
Stage 4: queryModel(assemblerModel, assemblyPrompt)
    | AssemblyResult — unified coherent response
    v
generateTitle() -> save to DB -> stream to client
```

### Task Plan Parser (server-side TypeScript)

```typescript
interface SubTask {
  id: string;               // "task_1", "task_2", etc.
  title: string;
  description: string;
  dependencies: string[];   // ["task_1", "task_3"] — other task IDs
  complexity: "LOW" | "MEDIUM" | "HIGH";
  expertise: string;        // "technical", "creative", "analytical", "general"
  assignedModel?: string;   // populated during assignment
  output?: string;          // populated during execution
  responseTimeMs?: number;  // populated during execution
  waveNumber?: number;      // populated during topological sort
}

interface TaskPlan {
  tasks: SubTask[];
  executionWaves: string[][];    // topologically sorted groups of task IDs
  criticalPath: string[];        // longest dependency chain (task IDs)
  maxParallelism: number;        // largest wave size
}

interface TaskAssignment {
  taskId: string;
  model: string;
  waveNumber: number;
}

function parseTaskPlan(text: string): SubTask[] {
  const tasks: SubTask[] = [];
  const taskBlocks = text.matchAll(
    /TASK\s+(task_\d+):\s*\n\s*Title:\s*(.+)\n\s*Description:\s*([\s\S]+?)\n\s*Dependencies:\s*(.+)\n\s*Complexity:\s*(LOW|MEDIUM|HIGH)\n\s*Expertise:\s*(.+)/gi
  );

  for (const match of taskBlocks) {
    const deps = match[4].trim().toLowerCase();
    tasks.push({
      id: match[1].toLowerCase(),
      title: match[2].trim(),
      description: match[3].trim(),
      dependencies: deps === "none" ? [] : deps.split(/,\s*/).map((d) => d.trim()),
      complexity: match[5].toUpperCase() as "LOW" | "MEDIUM" | "HIGH",
      expertise: match[6].trim().toLowerCase(),
    });
  }

  return tasks;
}
```

### Topological Sort (Kahn's Algorithm)

```typescript
function topologicalSort(tasks: SubTask[]): {
  waves: string[][];
  criticalPath: string[];
  hasCycle: boolean;
} {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const task of tasks) {
    inDegree.set(task.id, task.dependencies.length);
    if (!adjacency.has(task.id)) adjacency.set(task.id, []);
    for (const dep of task.dependencies) {
      if (!adjacency.has(dep)) adjacency.set(dep, []);
      adjacency.get(dep)!.push(task.id);
    }
  }

  // Kahn's algorithm: process in waves
  const waves: string[][] = [];
  const processed = new Set<string>();

  while (processed.size < tasks.length) {
    const wave: string[] = [];
    for (const task of tasks) {
      if (!processed.has(task.id) && inDegree.get(task.id) === 0) {
        wave.push(task.id);
      }
    }

    if (wave.length === 0) {
      // Cycle detected — no tasks with 0 in-degree remain
      return { waves, criticalPath: [], hasCycle: true };
    }

    waves.push(wave);
    for (const taskId of wave) {
      processed.add(taskId);
      for (const dependent of adjacency.get(taskId) ?? []) {
        inDegree.set(dependent, (inDegree.get(dependent) ?? 1) - 1);
      }
    }
  }

  // Compute critical path (longest path through DAG)
  const criticalPath = computeCriticalPath(tasks, waves);

  return { waves, criticalPath, hasCycle: false };
}

function computeCriticalPath(tasks: SubTask[], waves: string[][]): string[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const longestPath = new Map<string, string[]>();

  for (const wave of waves) {
    for (const taskId of wave) {
      const task = taskMap.get(taskId)!;
      if (task.dependencies.length === 0) {
        longestPath.set(taskId, [taskId]);
      } else {
        let longest: string[] = [];
        for (const dep of task.dependencies) {
          const depPath = longestPath.get(dep) ?? [];
          if (depPath.length > longest.length) longest = depPath;
        }
        longestPath.set(taskId, [...longest, taskId]);
      }
    }
  }

  // Return the longest path overall
  let result: string[] = [];
  for (const path of longestPath.values()) {
    if (path.length > result.length) result = path;
  }
  return result;
}
```

### Worker Assignment

```typescript
function assignWorkers(
  tasks: SubTask[],
  workerModels: string[],
  waves: string[][]
): TaskAssignment[] {
  const assignments: TaskAssignment[] = [];
  let roundRobinIndex = 0;

  for (let waveNum = 0; waveNum < waves.length; waveNum++) {
    for (const taskId of waves[waveNum]) {
      const task = tasks.find((t) => t.id === taskId)!;
      // TODO: expertise-based matching could be added here
      // For now, round-robin assignment
      const assignedModel = workerModels[roundRobinIndex % workerModels.length];
      roundRobinIndex++;

      task.assignedModel = assignedModel;
      task.waveNumber = waveNum + 1;

      assignments.push({
        taskId,
        model: assignedModel,
        waveNumber: waveNum + 1,
      });
    }
  }

  return assignments;
}
```

### Prompt Templates

**Plan Prompt** (`buildPlanPrompt`):

```
You are a task decomposition expert. Break the following question/task into 3-{{maxTasks}} discrete sub-tasks that, when completed and assembled, will produce a comprehensive answer.

QUESTION/TASK:
{{userQuery}}

For each sub-task, provide:
- ID: A short identifier (task_1, task_2, etc.)
- Title: Brief title
- Description: What this sub-task should produce (2-3 sentences)
- Dependencies: Which other task IDs must complete first (comma-separated, or "none")
- Complexity: LOW / MEDIUM / HIGH
- Expertise: Optional tag for best-suited model type (e.g., "technical", "creative", "analytical", or "general")

IMPORTANT RULES:
1. Tasks should be independent where possible to maximize parallelism.
2. Avoid circular dependencies.
3. Each task should produce a standalone output that can be understood in context.
4. The first task(s) should have no dependencies.
5. There should be a clear flow from initial research/analysis to final deliverables.

Format:

TASK PLAN:

TASK task_1:
Title: [title]
Description: [what to produce]
Dependencies: none
Complexity: [LOW|MEDIUM|HIGH]
Expertise: [tag or "general"]

TASK task_2:
Title: [title]
Description: [what to produce]
Dependencies: task_1
Complexity: [LOW|MEDIUM|HIGH]
Expertise: [tag or "general"]

...

EXECUTION SUMMARY:
Total tasks: [count]
Max parallelism: [how many can run simultaneously]
Critical path: [longest dependency chain, e.g., task_1 -> task_3 -> task_5]
```

**Sub-Task Execution Prompt** (`buildTaskExecutionPrompt`):

```
You are completing a specific sub-task as part of a larger decomposed question.

ORIGINAL QUESTION:
{{userQuery}}

YOUR SUB-TASK:
ID: {{TASK_ID}}
Title: {{TASK_TITLE}}
Description: {{TASK_DESCRIPTION}}

{{#if DEPENDENCY_OUTPUTS}}
OUTPUTS FROM PREREQUISITE TASKS:
{{#each DEPENDENCY_OUTPUTS}}
--- {{TASK_ID}}: {{TASK_TITLE}} ---
{{OUTPUT}}

{{/each}}
{{/if}}

Complete your sub-task thoroughly. Your output will be combined with other sub-task outputs to form the final answer. Focus on YOUR specific task — do not attempt to answer the entire original question.

SUB-TASK OUTPUT:
```

**Assembly Prompt** (`buildAssemblyPrompt`):

```
You are assembling the final answer from {{TASK_COUNT}} completed sub-tasks.

ORIGINAL QUESTION:
{{userQuery}}

TASK PLAN:
{{#each TASKS}}
- {{TASK_ID}}: {{TASK_TITLE}} (Complexity: {{COMPLEXITY}}, Dependencies: {{DEPENDENCIES}})
{{/each}}

COMPLETED SUB-TASKS (in dependency order):
{{#each TASK_OUTPUTS}}
--- {{TASK_ID}}: {{TASK_TITLE}} ({{MODEL}}) ---
{{OUTPUT}}

{{/each}}

{{#if MISSING_TASKS}}
MISSING/FAILED SUB-TASKS:
{{#each MISSING_TASKS}}
- {{TASK_ID}}: {{TASK_TITLE}} — FAILED ({{FAILURE_REASON}})
{{/each}}
{{/if}}

Your job:
1. Combine all sub-task outputs into a single, coherent, comprehensive answer.
2. Ensure smooth transitions between sections derived from different sub-tasks.
3. Remove redundancy where sub-tasks overlap.
4. Add an introduction and conclusion that frame the full answer.
5. Ensure consistent terminology and tone throughout.
6. If any sub-task output is missing or incomplete, note the gap.

ASSEMBLED ANSWER:
```

**Title Prompt** (`buildTitlePrompt`):

```
Generate a brief title (3-5 words) for a conversation that starts with this question:

"{{userQuery}}"

Reply with ONLY the title. No quotes, no punctuation, no explanation.
```

---

## C. SSE Event Sequence

```
 1. decompose_start         -> { conversationId, messageId, config }
 2. plan_start              -> {}
 3. plan_complete           -> { model, tasks, executionWaves, criticalPath, responseTimeMs }
 4. assignment_complete     -> { assignments: TaskAssignment[] }
 5. wave_start              -> { waveNumber: 1, tasks: WaveTaskPreview[] }
 6. task_complete           -> { taskId, title, model, outputPreview, responseTimeMs }
    ... (one per task in the wave, emitted as each finishes)
 7. wave_complete           -> { waveNumber: 1, completedCount, failedCount }
 8. wave_start              -> { waveNumber: 2, tasks: WaveTaskPreview[] }
 9. task_complete           -> { taskId, ... }
10. wave_complete           -> { waveNumber: 2, ... }
    ... (repeat for all waves)
11. assembly_start          -> {}
12. assembly_complete       -> { model, response (truncated preview), responseTimeMs }
13. title_complete          -> { data: { title: string } }     // new conversations only
14. complete                -> {}
```

On error at any point:
```
error -> { message: string }
```

### TypeScript Payload Interfaces

```typescript
// decompose_start
interface DecomposeStartPayload {
  conversationId: string;
  messageId: string;
  config: {
    plannerModel: string;
    workerModels: string[];
    assemblerModel: string;
    maxTasks: number;
  };
}

// plan_complete
interface PlanCompletePayload {
  model: string;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    dependencies: string[];
    complexity: "LOW" | "MEDIUM" | "HIGH";
    expertise: string;
  }>;
  executionWaves: string[][];
  criticalPath: string[];
  maxParallelism: number;
  totalTasks: number;
  responseTimeMs: number;
}

// assignment_complete
interface AssignmentCompletePayload {
  assignments: TaskAssignment[];
}

// wave_start
interface WaveStartPayload {
  waveNumber: number;
  tasks: WaveTaskPreview[];
}

interface WaveTaskPreview {
  taskId: string;
  title: string;
  model: string;
  dependencies: string[];
}

// task_complete (emitted per task as it finishes)
interface TaskCompletePayload {
  taskId: string;
  title: string;
  model: string;
  outputPreview: string;     // truncated to ~200 chars for SSE
  wordCount: number;
  responseTimeMs: number;
}

// wave_complete
interface WaveCompletePayload {
  waveNumber: number;
  completedCount: number;
  failedCount: number;
  waveTimeMs: number;        // wall-clock time for the wave
}

// assembly_complete
interface AssemblyCompletePayload {
  model: string;
  response: string;           // may be truncated for SSE
  responseTimeMs: number;
  tasksAssembled: number;
  missingTasks: string[];
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
interface DecomposeStreamRequest {
  question: string;
  mode: "decompose";
  conversationId?: string;
  modeConfig?: DecomposeConfig;
}

interface DecomposeConfig {
  plannerModel?: string;
  workerModels?: string[];
  assemblerModel?: string;
  maxTasks?: number;          // 3-8, default 6
  timeoutMs?: number;         // per-task timeout
}
```

### Zod Validation

```typescript
const decomposeConfigSchema = z.object({
  plannerModel: z.string().optional(),
  workerModels: z.array(z.string())
    .min(1, "At least 1 worker model required")
    .max(5, "Maximum 5 worker models allowed")
    .optional(),
  assemblerModel: z.string().optional(),
  maxTasks: z.number().int().min(3).max(8).default(6),
  timeoutMs: z.number().min(10_000).max(300_000).default(120_000),
});

const decomposeRequestSchema = z.object({
  question: z.string().min(1, "Question is required"),
  mode: z.literal("decompose"),
  conversationId: z.string().optional(),
  modeConfig: decomposeConfigSchema.optional(),
});
```

### Default Configuration

```typescript
const DEFAULT_DECOMPOSE_CONFIG: Required<DecomposeConfig> = {
  plannerModel: "anthropic/claude-opus-4-6",
  workerModels: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
  ],
  assemblerModel: "anthropic/claude-opus-4-6",
  maxTasks: 6,
  timeoutMs: 120_000,
};
```

### Example Requests

New conversation:
```json
{
  "question": "Design a complete authentication system for a SaaS application, including OAuth 2.0, session management, role-based access control, and audit logging.",
  "mode": "decompose",
  "modeConfig": {
    "plannerModel": "anthropic/claude-opus-4-6",
    "workerModels": [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro"
    ],
    "assemblerModel": "anthropic/claude-opus-4-6",
    "maxTasks": 6
  }
}
```

Minimal configuration (planner doubles as assembler):
```json
{
  "question": "Compare the top 5 JavaScript frameworks for building dashboards.",
  "mode": "decompose",
  "modeConfig": {
    "plannerModel": "anthropic/claude-opus-4-6",
    "workerModels": ["openai/o3"],
    "assemblerModel": "anthropic/claude-opus-4-6",
    "maxTasks": 5
  }
}
```

Maximum scale:
```json
{
  "question": "Write a comprehensive guide to deploying machine learning models in production.",
  "mode": "decompose",
  "modeConfig": {
    "plannerModel": "anthropic/claude-opus-4-6",
    "workerModels": [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro",
      "perplexity/sonar-pro",
      "meta-llama/llama-3.1-405b-instruct"
    ],
    "assemblerModel": "anthropic/claude-sonnet-4",
    "maxTasks": 8
  }
}
```

---

## E. Output Format

### Result Interface

```typescript
interface DecomposeResult {
  plan: TaskPlan;
  taskOutputs: TaskOutput[];
  assembly: AssemblyResult;
  executionStats: ExecutionStats;
  title?: string;
}

interface TaskOutput {
  taskId: string;
  title: string;
  model: string;
  output: string;
  wordCount: number;
  waveNumber: number;
  dependencies: string[];
  responseTimeMs: number;
  failed: boolean;
  failureReason?: string;
}

interface AssemblyResult {
  model: string;
  response: string;
  responseTimeMs: number;
  tasksAssembled: number;
  missingTasks: string[];
}

interface ExecutionStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalWaves: number;
  maxParallelism: number;
  criticalPath: string[];
  criticalPathMs: number;     // sum of response times along the critical path
  totalTimeMs: number;        // wall-clock pipeline time
  parallelismEfficiency: number; // totalTimeMs / sum(all task times)
}
```

### UI Display

- **DAG Visualization:** A directed acyclic graph showing tasks as nodes and dependencies as edges. Nodes are colored by status: gray (pending), blue (running), green (complete), red (failed). Wave groupings shown as vertical swim lanes or horizontal bands. Node size scaled by complexity (LOW=small, MEDIUM=medium, HIGH=large).
- **Task Detail Panel:** Clicking a node shows: task title, description, assigned model, the full sub-task output, word count, and response time.
- **Wave Progress:** Horizontal progress bar per wave showing task completion within the wave.
- **Execution Stats Panel:** Shows total time, critical path time, parallelism efficiency, and wave breakdown.
- **Assembly:** The assembled response is the primary displayed answer in the chat, shown below the DAG visualization.
- **Critical Path Highlight:** The critical path is highlighted in the DAG with a distinct edge color (e.g., orange) to show the longest dependency chain.

### DB Storage

All data stored in `deliberation_stages` table:

| `stageType` | `stageOrder` | `model` | `role` | `content` | `parsedData` |
|-------------|:------------:|---------|--------|-----------|--------------|
| `"plan"` | 0 | planner model | `"planner"` | Full plan text | `PlanParsedData` |
| `"task_1"` | 1 | worker model | `"worker"` | Full task output | `TaskParsedData` |
| `"task_2"` | 1 | worker model | `"worker"` | Full task output | `TaskParsedData` |
| `"task_3"` | 2 | worker model | `"worker"` | Full task output | `TaskParsedData` |
| `"task_4"` | 2 | worker model | `"worker"` | Full task output | `TaskParsedData` |
| `"task_5"` | 3 | worker model | `"worker"` | Full task output | `TaskParsedData` |
| `"assembly"` | 99 | assembler model | `"assembler"` | Full assembled response | `AssemblyParsedData` |

Note: `stageOrder` corresponds to the wave number (tasks in the same wave share the same `stageOrder`). The plan is always order 0. The assembly is always order 99.

### parsedData JSONB Examples

**Plan stage (`stageType: "plan"`):**
```json
{
  "type": "plan",
  "tasks": [
    {
      "id": "task_1",
      "title": "Research OAuth 2.0 flow options",
      "description": "Analyze the different OAuth 2.0 grant types and recommend which ones to support for a SaaS application.",
      "dependencies": [],
      "complexity": "MEDIUM",
      "expertise": "technical"
    },
    {
      "id": "task_2",
      "title": "Design session management strategy",
      "description": "Propose a session management approach including token types, storage, expiration, and refresh mechanisms.",
      "dependencies": [],
      "complexity": "MEDIUM",
      "expertise": "technical"
    },
    {
      "id": "task_3",
      "title": "Define RBAC model",
      "description": "Design the role-based access control model including roles, permissions, and inheritance rules.",
      "dependencies": [],
      "complexity": "MEDIUM",
      "expertise": "analytical"
    },
    {
      "id": "task_4",
      "title": "Integrate OAuth with sessions",
      "description": "Describe how the OAuth 2.0 flows connect to the session management layer, including token exchange and session creation.",
      "dependencies": ["task_1", "task_2"],
      "complexity": "HIGH",
      "expertise": "technical"
    },
    {
      "id": "task_5",
      "title": "Design audit logging system",
      "description": "Propose an audit logging architecture that captures authentication events, authorization decisions, and session lifecycle events.",
      "dependencies": ["task_3", "task_4"],
      "complexity": "MEDIUM",
      "expertise": "technical"
    },
    {
      "id": "task_6",
      "title": "Security review and hardening",
      "description": "Review the overall design for security vulnerabilities and propose hardening measures including rate limiting, brute force protection, and CSRF prevention.",
      "dependencies": ["task_4", "task_5"],
      "complexity": "HIGH",
      "expertise": "technical"
    }
  ],
  "executionWaves": [
    ["task_1", "task_2", "task_3"],
    ["task_4"],
    ["task_5"],
    ["task_6"]
  ],
  "criticalPath": ["task_1", "task_4", "task_5", "task_6"],
  "maxParallelism": 3
}
```

**Task execution (`stageType: "task_2"`):**
```json
{
  "taskId": "task_2",
  "title": "Design session management strategy",
  "waveNumber": 1,
  "dependenciesUsed": [],
  "wordCount": 450,
  "complexity": "MEDIUM",
  "expertise": "technical",
  "assignedModel": "openai/o3"
}
```

**Task execution with dependencies (`stageType: "task_4"`):**
```json
{
  "taskId": "task_4",
  "title": "Integrate OAuth with sessions",
  "waveNumber": 2,
  "dependenciesUsed": ["task_1", "task_2"],
  "wordCount": 620,
  "complexity": "HIGH",
  "expertise": "technical",
  "assignedModel": "anthropic/claude-opus-4-6"
}
```

**Failed task (`stageType: "task_5"`):**
```json
{
  "taskId": "task_5",
  "title": "Design audit logging system",
  "waveNumber": 3,
  "dependenciesUsed": ["task_3", "task_4"],
  "wordCount": 0,
  "complexity": "MEDIUM",
  "expertise": "technical",
  "assignedModel": "google/gemini-2.5-pro",
  "failed": true,
  "failureReason": "Model timeout after 120000ms"
}
```

**Assembly (`stageType: "assembly"`):**
```json
{
  "tasksAssembled": 5,
  "missingTasks": ["task_5"],
  "wordCount": 2800,
  "totalWaves": 4,
  "criticalPathMs": 34200,
  "totalPipelineMs": 52000
}
```

---

## F. Edge Cases

| Scenario | Handling |
|----------|----------|
| Planner fails | Fatal error. Emit `error` event. Pipeline cannot proceed without a plan. |
| Planner produces circular dependencies | Detected by topological sort (`hasCycle: true`). Re-query planner with a stricter prompt: "Your previous plan contained circular dependencies. Produce a new plan with NO circular dependencies." If retry also produces cycles, flatten all tasks into a single wave (all parallel, no dependencies). Log the fallback. |
| Planner produces >8 tasks | Truncate to the first 8 tasks (by order in plan). Emit a warning in the `plan_complete` event. Dependencies referencing truncated tasks are removed. |
| Planner produces <3 tasks | Proceed anyway. The question may be simple enough that 1-2 tasks suffice. No minimum enforcement during execution (only during validation). |
| Planner produces 0 parseable tasks | Parse failure. Re-query planner once. If still 0 tasks, emit `error` event. |
| A worker fails on a sub-task | Mark the task as failed. Downstream dependent tasks receive a note in their prompt: "Sub-task {{ID}} ({{TITLE}}) failed. Work without its output and note any gaps." The assembler also receives notification of the gap. |
| Multiple workers fail in the same wave | Each failed task is handled independently. Wave completes when all tasks (including failed ones) have resolved. |
| All workers fail in a wave | Subsequent waves that depend on the failed tasks proceed with gap notifications. The assembler notes all missing outputs. |
| Assembler fails | Emit `error` event. Fall back to concatenating task outputs in topological order with `---` separators as the response. Log the fallback. |
| All tasks fail AND assembler fails | Emit `error` event. Only the plan is saved. |
| Task with dependency on a non-existent task ID | Remove the invalid dependency. Log a warning. The task effectively has one fewer dependency. |
| Critical path exceeds timeout | Execute what we can within the global 600s timeout. Skip remaining waves. Assemble partial results. The assembler is instructed to note incomplete sections. |
| All workers assigned the same model | Valid. They still execute in parallel (separate API calls). |
| Planner and assembler are the same model | Valid. Common in minimal configurations. |
| Only 1 worker model | All tasks in a wave are assigned to the same model. They still execute as separate parallel API calls. |
| Conversation mode mismatch | If `conversationId` references a conversation with `mode != "decompose"`, return 400 error. |
| Timeout per task | `AbortSignal.timeout(timeoutMs)` per task. Treated as task failure. |

---

## G. Database Schema

Uses the `deliberation_stages` table exclusively (no legacy tables).

### Row Shapes

**Plan row:**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "plan",
  stageOrder: 0,
  model: "anthropic/claude-opus-4-6",
  role: "planner",
  content: "TASK PLAN:\n\nTASK task_1:\nTitle: Research OAuth 2.0 flow options\nDescription: Analyze the different OAuth 2.0 grant types...\nDependencies: none\nComplexity: MEDIUM\nExpertise: technical\n\nTASK task_2:\n...",
  parsedData: {
    type: "plan",
    tasks: [
      { id: "task_1", title: "Research OAuth 2.0 flow options", dependencies: [], complexity: "MEDIUM", expertise: "technical" },
      { id: "task_2", title: "Design session management strategy", dependencies: [], complexity: "MEDIUM", expertise: "technical" },
      { id: "task_3", title: "Define RBAC model", dependencies: [], complexity: "MEDIUM", expertise: "analytical" },
      { id: "task_4", title: "Integrate OAuth with sessions", dependencies: ["task_1", "task_2"], complexity: "HIGH", expertise: "technical" },
      { id: "task_5", title: "Design audit logging system", dependencies: ["task_3", "task_4"], complexity: "MEDIUM", expertise: "technical" },
      { id: "task_6", title: "Security review and hardening", dependencies: ["task_4", "task_5"], complexity: "HIGH", expertise: "technical" }
    ],
    executionWaves: [["task_1", "task_2", "task_3"], ["task_4"], ["task_5"], ["task_6"]],
    criticalPath: ["task_1", "task_4", "task_5", "task_6"],
    maxParallelism: 3
  },
  responseTimeMs: 8500,
  createdAt: "2026-02-09T..."
}
```

**Task execution row (wave 1, no dependencies):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "task_1",
  stageOrder: 1,
  model: "anthropic/claude-opus-4-6",
  role: "worker",
  content: "SUB-TASK OUTPUT:\n\nOAuth 2.0 provides several grant types suitable for a SaaS application...",
  parsedData: {
    taskId: "task_1",
    title: "Research OAuth 2.0 flow options",
    waveNumber: 1,
    dependenciesUsed: [],
    wordCount: 380,
    complexity: "MEDIUM",
    expertise: "technical",
    assignedModel: "anthropic/claude-opus-4-6"
  },
  responseTimeMs: 6200,
  createdAt: "2026-02-09T..."
}
```

**Task execution row (wave 2, with dependencies):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "task_4",
  stageOrder: 2,
  model: "google/gemini-2.5-pro",
  role: "worker",
  content: "SUB-TASK OUTPUT:\n\nIntegrating OAuth 2.0 with the session management layer requires...",
  parsedData: {
    taskId: "task_4",
    title: "Integrate OAuth with sessions",
    waveNumber: 2,
    dependenciesUsed: ["task_1", "task_2"],
    wordCount: 620,
    complexity: "HIGH",
    expertise: "technical",
    assignedModel: "google/gemini-2.5-pro"
  },
  responseTimeMs: 9400,
  createdAt: "2026-02-09T..."
}
```

**Failed task row:**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "task_5",
  stageOrder: 3,
  model: "google/gemini-2.5-pro",
  role: "worker",
  content: "[FAILED] Sub-task task_5 (Design audit logging system) failed: Model timeout after 120000ms",
  parsedData: {
    taskId: "task_5",
    title: "Design audit logging system",
    waveNumber: 3,
    dependenciesUsed: ["task_3", "task_4"],
    wordCount: 0,
    complexity: "MEDIUM",
    expertise: "technical",
    assignedModel: "google/gemini-2.5-pro",
    failed: true,
    failureReason: "Model timeout after 120000ms"
  },
  responseTimeMs: 120000,
  createdAt: "2026-02-09T..."
}
```

**Assembly row:**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "assembly",
  stageOrder: 99,
  model: "anthropic/claude-opus-4-6",
  role: "assembler",
  content: "ASSEMBLED ANSWER:\n\n## Complete Authentication System Design for SaaS\n\n### Introduction\nThis guide provides a comprehensive authentication system design...\n\n### 1. OAuth 2.0 Implementation\n...\n\n### 2. Session Management\n...\n\n### 3. Role-Based Access Control\n...\n\n### 4. OAuth-Session Integration\n...\n\n### Note on Audit Logging\nThe audit logging sub-task was not completed due to a timeout. This section would cover...\n\n### 5. Security Hardening\n...\n\n### Conclusion\n...",
  parsedData: {
    tasksAssembled: 5,
    missingTasks: ["task_5"],
    wordCount: 2800,
    totalWaves: 4,
    criticalPathMs: 34200,
    totalPipelineMs: 52000
  },
  responseTimeMs: 12300,
  createdAt: "2026-02-09T..."
}
```

### Indexes

The shared index from `00-shared-infrastructure.md` applies:
```sql
CREATE INDEX idx_deliberation_stages_message ON deliberation_stages(message_id, stage_order);
```

### Querying Pattern

```typescript
async function loadDecomposeResult(messageId: string): Promise<DecomposeResult> {
  const stages = await db
    .select()
    .from(deliberationStages)
    .where(eq(deliberationStages.messageId, messageId))
    .orderBy(deliberationStages.stageOrder, deliberationStages.createdAt);

  const planStage = stages.find((s) => s.stageType === "plan");
  const taskStages = stages.filter((s) => s.stageType.startsWith("task_"));
  const assemblyStage = stages.find((s) => s.stageType === "assembly");

  const planData = planStage?.parsedData as PlanParsedData;

  const taskOutputs: TaskOutput[] = taskStages.map((s) => {
    const pd = s.parsedData as TaskParsedData;
    return {
      taskId: pd.taskId,
      title: pd.title,
      model: s.model!,
      output: s.content,
      wordCount: pd.wordCount,
      waveNumber: pd.waveNumber,
      dependencies: pd.dependenciesUsed,
      responseTimeMs: s.responseTimeMs ?? 0,
      failed: pd.failed ?? false,
      failureReason: pd.failureReason,
    };
  });

  const assemblyData = assemblyStage?.parsedData as AssemblyParsedData;

  // Compute execution stats
  const completedTasks = taskOutputs.filter((t) => !t.failed);
  const failedTasks = taskOutputs.filter((t) => t.failed);
  const criticalPathTaskIds = planData.criticalPath;
  const criticalPathMs = criticalPathTaskIds.reduce((sum, taskId) => {
    const task = taskOutputs.find((t) => t.taskId === taskId);
    return sum + (task?.responseTimeMs ?? 0);
  }, 0);

  return {
    plan: {
      tasks: planData.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: "", // not stored in parsedData summary; full text in plan content
        dependencies: t.dependencies,
        complexity: t.complexity,
        expertise: t.expertise,
      })) as SubTask[],
      executionWaves: planData.executionWaves,
      criticalPath: planData.criticalPath,
      maxParallelism: planData.maxParallelism,
    },
    taskOutputs,
    assembly: {
      model: assemblyStage!.model!,
      response: assemblyStage!.content,
      responseTimeMs: assemblyStage!.responseTimeMs!,
      tasksAssembled: assemblyData.tasksAssembled,
      missingTasks: assemblyData.missingTasks,
    },
    executionStats: {
      totalTasks: taskOutputs.length,
      completedTasks: completedTasks.length,
      failedTasks: failedTasks.length,
      totalWaves: assemblyData.totalWaves,
      maxParallelism: planData.maxParallelism,
      criticalPath: criticalPathTaskIds,
      criticalPathMs,
      totalTimeMs: assemblyData.totalPipelineMs,
      parallelismEfficiency: assemblyData.totalPipelineMs > 0
        ? taskOutputs.reduce((sum, t) => sum + t.responseTimeMs, 0) / assemblyData.totalPipelineMs
        : 1.0,
    },
  };
}
```

### Conversation-Level Storage

```typescript
// conversations table
{ id, userId, title, mode: "decompose", createdAt, updatedAt }

// messages table
{ id, conversationId, role: "user", content: userQuestion }
{ id, conversationId, role: "assistant", content: assembledResponse }  // full assembled answer
```

The assistant message `content` is the assembler's unified response, providing the coherent final answer for display and any future context needs.
