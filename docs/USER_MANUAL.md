# Model Council — User Manual

A quick guide to using the multi-mode deliberation platform.

---

## Getting Started

1. **Sign in** at the login page with your credentials.
2. You land on the **Council** page with an empty conversation view.
3. Pick a **deliberation mode**, type a question, and press Enter.

---

## Selecting a Mode

Click the **mode pill** in the top-left of the conversation area. A popover opens showing all 15 modes grouped by family:

| Family | Modes | Best For |
|--------|-------|----------|
| **Evaluation** | Council, Vote, Jury, Debate, Delphi | Comparing and ranking answers |
| **Role-Based** | Specialist Panel, Blueprint, Peer Review | Expert analysis from assigned roles |
| **Sequential** | Chain | Step-by-step iterative improvement |
| **Algorithmic** | Tournament, Confidence-Weighted, Decompose | Structured elimination or weighting |
| **Adversarial** | Red Team | Security review and hardening |
| **Creative** | Brainstorm | Idea generation and clustering |
| **Verification** | Fact-Check | Claim extraction and evidence checking |

Each mode shows the number of models it supports (e.g. "3-7"). Hover over a mode name to see its description.

**The mode locks after your first message** — you cannot change it mid-conversation. To try a different mode, click **New** in the sidebar.

---

## The 15 Modes

### Council (default)
Multiple models answer your question independently. They then anonymously rank each other's responses. A chairman model synthesizes the collective wisdom into a single answer.

**View tabs:** Responses | Rankings | Synthesis

### Vote
Models answer independently, then vote for the best response among their peers. If there's a tie, a tiebreaker round decides the winner.

**View tabs:** Responses | Votes | Winner

### Debate
Models answer, see each other's responses, then decide whether to revise or stand firm. A final vote determines the winner of the debate.

**View tabs:** Answers | Revisions | Votes | Winner

### Jury
A panel of model-jurors evaluates content across multiple dimensions (clarity, accuracy, depth, etc.), scores each dimension, and a foreman delivers a unified verdict.

**View tabs:** Jurors | Verdict

### Delphi
Iterative anonymous rounds where models provide estimates with statistical feedback. Rounds repeat until the group converges on a consensus value. Best for numerical or quantifiable questions.

**View:** Round-by-round timeline with convergence indicator and final synthesis.

### Red Team
An adversarial loop: one model generates content, another attacks it for vulnerabilities, and a defender responds. Multiple rounds produce a hardened final output.

**View:** Round cards with severity badges (critical/high/medium/low), attack/defense pairs, and hardened output.

### Chain
A sequential improvement pipeline. Each model builds on the previous one's output — draft, improve, refine, polish.

**View:** Numbered step pipeline with model pills, mandates, and word counts.

### Specialist Panel
Models are assigned expert roles (e.g. "Security Analyst", "UX Researcher"). Each specialist produces a report, and a synthesis integrates all perspectives.

**View tabs:** Specialists | Synthesis

### Peer Review
Independent reviewers score your content on a rubric, identifying strengths, weaknesses, and suggestions. A consolidation step produces a unified report.

**View tabs:** Reviewers | Consolidated

### Blueprint
A structured document builder. One model creates an outline, multiple models write assigned sections in parallel, and the result is assembled into a unified document.

**View tabs:** Outline | Sections | Assembled

### Tournament
Bracket-style elimination. Models compete in pairwise matchups judged by a referee model. Winners advance through rounds until a champion emerges.

**View:** Round-by-round bracket with match cards and champion badge.

### Confidence-Weighted
Each model answers with a self-assessed confidence score (0-100%). High-confidence answers carry more weight in the final synthesis.

**View tabs:** Answers (with confidence bars) | Synthesis

### Decompose
A planner model breaks your question into sub-tasks. Different models solve each sub-task, and an assembler reunifies the results into a coherent answer.

**View:** Task plan, numbered task cards, and assembled answer.

### Brainstorm
Models generate ideas freely. Ideas are clustered by theme, scored for quality, and the best cluster is refined into polished output.

**View tabs:** Ideas | Clusters | Results

### Fact-Check
Claims are extracted from content, independently verified by multiple models with confidence scores, and compiled into an evidence report.

**View tabs:** Claims (with verdict badges: True/False/Uncertain) | Report

---

## Reading Results

Each mode shows results in a **card** below your message with mode-specific tabs or sections:

- **Stage indicators** (colored dots) show progress:
  - Gray = pending
  - Amber (pulsing) = in progress
  - Green = complete

- **Model pills** (colored capsules) identify which model produced each response. Click a pill to view that model's output.

- **Expandable cards** — click a card header to expand/collapse detailed content.

- The **status bar** below the input shows the current stage, e.g. `Stage 2 of 3 · Ranking responses... (12s)`

---

## Sidebar

The sidebar shows your conversation history:

- **New** button starts a fresh conversation (resets mode to Council).
- Each conversation shows its **title** (auto-generated after your first message).
- Non-council conversations show a **mode label** (e.g. "Vote", "Red Team") to the right of the title.
- Click any conversation to reload it with its full stage data.

---

## Exporting

When a conversation has completed at least one exchange, an **Export** button appears in the top-right corner. Click it to download the conversation as a Markdown file.

---

## Settings

Navigate to **Settings** in the sidebar to configure:

- **Council models** — choose which models participate (3-7 recommended).
- **Chairman model** — the model that synthesizes the final answer in Council mode.
- **Presets** — save and load model configurations.

---

## Tips

- **Try Vote mode** for quick, decisive answers — it's faster than Council.
- **Use Debate mode** when you want models to challenge each other.
- **Red Team** is excellent for reviewing code, plans, or documents for flaws.
- **Blueprint** works best for long-form content (essays, reports, documentation).
- **Fact-Check** is ideal when accuracy matters — it shows per-claim evidence.
- **Confidence-Weighted** is useful when you want to know how sure models are.
- **Decompose** shines on complex, multi-part questions.
- For the best results, **use 4-5 models** — enough diversity without excessive cost.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in input |
| `Escape` | Close mode picker / dismiss modal |

---

*Model Council v0.1.0*
