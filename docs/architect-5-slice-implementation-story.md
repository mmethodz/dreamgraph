# Architect 5-Slice Implementation Story

> Source: `plans/IMPLEMENTATION_STORY_COGNITIVE_OUTPUT_SLICES.md`

---

# Cognitive Output Rendering — Implementation Story of Slices 1–5

**Source plan:** `plans/TDD_COGNITIVE_OUTPUT_V2.md`  
**Primary implementation area:** `extensions/vscode/`  
**System context:** `feature_cognitive_output_rendering_plan`, `feature_vscode_extension`, `feature_agentic_tool_execution_loop`

---

## Executive summary

This document tells the implementation story of the five-slice cognitive output rendering effort for the VS Code extension.

The work started from a very constrained baseline: the chat panel rendered plain text via `textContent`, the webview lived inside a single large inline HTML/JS string in `extensions/vscode/src/chat-panel.ts`, there was no webview bundler, and the extension already had an important architectural boundary: the real agentic tool execution loop had to stay host-driven and truthful.

Across five slices, the implementation evolved the chat panel from a plain-text stream viewer into a safer, richer, graph-aware cognitive UI with:
- markdown rendering
- entity-aware output structure
- semantic card rendering
- graph-backed verification semantics
- verdict and provenance presentation
- action blocks with explicit safety gating
- instance-aware persistence and runtime affordances

The most important architectural theme across all five slices was this:

> The UI could become richer, but it could not become dishonest.

That principle came from the surrounding system context, especially:
- `feature_vscode_extension` — the editor integration surface
- `feature_agentic_tool_execution_loop` — the real tool-calling and continuation loop
- `feature_cognitive_output_rendering_plan` — the implementation tracking feature for this rendering track

---

## Baseline: the system before Slice 1

Per `plans/TDD_COGNITIVE_OUTPUT_V2.md`, the starting point was intentionally simple but limiting:
- output rendering was plain text only
- webview behavior and styles were embedded inline in `chat-panel.ts`
- streaming appended raw chunks directly to the DOM
- there was no semantic rendering layer for markdown, cards, or entity verification
- the architecture had to remain inside `extensions/vscode/` only
- no daemon protocol changes were allowed

This meant the implementation challenge was not just “add UI features.” It was to incrementally grow a cognitive presentation layer without breaking:
- streaming behavior
- CSP safety
- packaging constraints
- actual host-side tool execution
- future graph-backed semantics

In other words, the project had to move from *text output* to *cognitive output* while staying faithful to the real system.

---

## The north star of the five slices

The five slices formed a deliberate progression:

1. **Slice 1 — Safe Markdown Foundation**  
   Establish a trustworthy rendering substrate.
2. **Slice 2 — Entity Links and interaction cues**  
   Start making output navigable as system knowledge.
3. **Slice 3 — Semantic cards**  
   Let the output carry structured cognitive shapes, not just formatted text.
4. **Slice 4 — Verification, trace, provenance**  
   Distinguish what is verified, speculative, or tool-grounded.
5. **Slice 5 — Actions, safety, and polish**  
   Turn the output into a controlled interaction surface without bypassing the real execution architecture.

Each slice was meant to be independently mergeable, and that shaped the implementation style:
- build a vertical slice
- verify with build/tests
- preserve working behavior
- add graph sync when structural understanding changed

---

## Slice 1 — Safe Markdown Foundation

### What Slice 1 was trying to solve

The first slice solved the most basic mismatch between the extension’s cognitive ambitions and its actual presentation layer.

Before Slice 1, even when the system produced rich content, the user saw plain text. Markdown syntax, code fences, lists, and tables were cognitively meaningful but visually inert. So Slice 1 had one job:

> make model output readable and useful without making it unsafe.

### System role

In system terms, Slice 1 belonged primarily to `feature_vscode_extension`. It did not yet make the output graph-aware, but it created the rendering substrate required for every later slice.

It also established a foundational safety principle that carried through the rest of the work:
- the model output is untrusted
- rendering may be richer, but not permissive

### Main implementation ideas from the plan

Per `plans/TDD_COGNITIVE_OUTPUT_V2.md`, Slice 1 introduced:
- markdown rendering
- fenced code blocks with language classes
- code block copy actions
- external link interception via host
- streaming-safe rerendering with debounce
- XSS defense via `html: false` and sanitization

The plan also introduced a structural cleanup:
- `chat-panel.ts` remains the lifecycle/orchestration owner
- `webview/protocol.ts` becomes the message-shape source of truth
- `webview/styles.ts` becomes the CSS home
- `webview/render-markdown.ts` becomes the rendering script generator

This mattered because the codebase started with a single monolithic webview definition. Slice 1 was not just about rendering; it was the first step in turning a monolith into a set of coherent responsibilities.

### Why this slice mattered beyond UI polish

Slice 1 changed the extension’s relationship to its own output.

Plain text implies: “this is just text.”  
Rendered markdown implies: “this is structured information.”

That shift was essential because later slices depend on the ability to render:
- links
- cards
- markers
- trace panels
- actions

Without Slice 1, those later features would either be impossible or bolted awkwardly onto plain text.

### Architectural significance

Slice 1 also surfaced the first major implementation trade-off: webview runtime packaging.

The plan chose a pragmatic path for the early phase:
- start with a no-bundler-compatible injection strategy
- defer a cleaner webview bundling story until Slice 3

That decision reflects a classic engineering pattern in this implementation story:
- unblock the slice with the smallest safe architecture
- migrate when complexity justifies the infrastructure cost

### Risks Slice 1 contained

Slice 1 had to avoid several failures:
- unsafe HTML execution
- broken streaming rerenders
- copy-button duplication
- link-opening through unsafe schemes
- packaged extension failures if browser assets were missing

So even though Slice 1 looks “visual,” it was fundamentally a security-and-integrity slice.

### Narrative takeaway

Slice 1 was the moment the project stopped treating assistant output as raw transcript and started treating it as rendered cognitive material.

---

## Slice 2 — Entity Links and the first graph-aware behaviors

### What Slice 2 was trying to solve

Once output could be rendered safely, the next question was: how should system concepts appear?

DreamGraph is not just a chat assistant; it is a graph-backed system. So Slice 2 started making output navigable in terms the system understands:
- features
- workflows
- ADRs
- tensions
- files
- related entity URIs

### System role

This slice sat at the boundary between:
- `feature_vscode_extension`
- the extension’s navigation and host messaging surface
- the beginning of graph-grounded UI behavior described in `feature_cognitive_output_rendering_plan`

This was not yet full graph verification. It was a lighter contract:
- if the output explicitly references graph-like URIs, the UI should preserve that semantics
- if the user clicks one, the extension should respond intentionally

### Main implementation ideas from the plan

The plan defined:
- explicit URI linkification such as `feature://...`, `workflow://...`, `adr://...`
- safe interception of those links
- inert behavior inside code blocks
- empty-state and thinking-indicator polish

This is important because Slice 2 was the first time the UI became aware that not all text is just prose. Some text is a reference into system knowledge.

### Why explicit URIs first

The plan explicitly deferred implicit entity detection until Slice 5+.

That was a good constraint. Explicit URIs have a clear contract:
- the model emitted a reference intentionally
- the UI can linkify deterministically
- the host can interpret it safely

Implicit detection is fuzzier and more error-prone. Slice 2 therefore chose the lower-ambiguity path first.

### Boundaries preserved

Even here, the UI did not take over the job of “understanding the system.” It only made explicit references actionable. That fits the overall architecture:
- system knowledge remains in the graph and host-side logic
- the webview remains a renderer and interaction surface

### Narrative takeaway

Slice 2 was the first move from “formatted output” to “knowledge-aware output.”

The assistant’s words could now point somewhere.

---

## Slice 3 — Semantic cards and structured cognitive output

### What Slice 3 was trying to solve

Once the UI could render markdown and explicit links, the next limitation was obvious: important content types still looked like ordinary prose or code fences.

But DreamGraph outputs often carry special semantic forms:
- entities
- ADRs
- tensions
- insights

Slice 3 answered the question:

> How does the UI show that some output is not just text, but a typed cognitive artifact?

### System role

This slice deepened `feature_cognitive_output_rendering_plan` from formatting into semantic presentation. It did not yet verify graph truth, but it gave special output types dedicated visual and structural treatment.

This is also where the UI started to align more strongly with DreamGraph’s broader knowledge model:
- typed objects in the graph
- typed blocks in the rendered response

### Main implementation ideas from the plan

Per the plan, Slice 3 introduced:
- structured card rendering for `entity`, `adr`, `tension`, and `insight` fenced blocks
- collapse/expand behavior
- safe fallback for malformed or unknown card types
- “during streaming, treat incomplete blocks conservatively” behavior
- the planned shift from inline library loading to a proper webview bundle

That last point matters: Slice 3 was where the accumulated complexity of the webview justified better build infrastructure.

### Why cards were important

Cards changed the tone of the UI.

Without cards, a tension or ADR is just text *about* a system concept.  
With cards, it becomes an object *presented as* that concept.

That improves:
- scanability
- trust
- consistency of output shape
- future extension points, such as verification markers and actions

### Safety posture

The plan deliberately chose a constrained contract for cards:
- cards come from fenced syntax
- malformed bodies fall back to plain code block rendering
- no broken UI, no parser panic, no partial-card corruption

This tells an important story about the implementation philosophy:
- semantic richness is earned through explicit structure
- fallback paths remain simple and safe

### Narrative takeaway

Slice 3 was where the UI stopped merely rendering markdown and began rendering cognitive artifact types.

The extension started to present not just language, but structured reasoning objects.

---

## Slice 4 — Verification, tool trace, provenance, and truth signals

### What Slice 4 was trying to solve

By Slice 3, the UI could show structured output beautifully. But a critical question remained unresolved:

> Which parts of this output are verified, which are speculative, and which come from real tool execution?

This is the slice where the project had to confront trust directly.

### System role

Slice 4 is where `feature_cognitive_output_rendering_plan` most strongly touches `feature_agentic_tool_execution_loop`.

This slice is not just about display polish. It is about making the UI honest about the origin and confidence of its content.

That is why the tool trace requirement is especially important. The graph context and prior RCA around the agentic loop made it clear that narrated tool usage is not enough; the UI must represent actual execution.

### Main implementation ideas from the plan

Per `plans/TDD_COGNITIVE_OUTPUT_V2.md`, Slice 4 introduced:
- graph-backed verification markers
- verdict banner
- collapsible tool trace
- provenance labels
- secret redaction
- verification batching and timeout behavior

This slice had both a UX mission and a safety mission.

### Secret redaction as a prerequisite for trust

Before tool traces and richer provenance could be shown safely, the extension had to ensure it would not surface sensitive material accidentally.

That is why secret redaction belongs here. It is not cosmetic. It is a precondition for safely showing richer internals of the interaction.

The plan made this extension-side, before webview delivery, which is architecturally correct because:
- secrets should be stripped before UI exposure
- the host is the right trust boundary
- the redaction policy should not depend on client-side discipline

### Graph verification semantics

Slice 4 is where the UI began to express graph-backed status, not just graph-flavored structure.

The important transition is:
- Slice 2: “this looks like a system entity reference”
- Slice 4: “this reference has a graph-backed status”

That distinction matters. Verification markers turn the UI from passive rendering into a lightweight epistemic layer.

### Tool trace as a truth contract

This was the most architecturally sensitive part of Slice 4.

The plan states clearly that tool trace entries must come exclusively from real executed tool calls in the host-side continuation loop. That aligns directly with `feature_agentic_tool_execution_loop`.

This is more than implementation detail. It is a boundary of system integrity:
- the model may narrate tool usage
- the UI may not treat narration as execution

That rule protects the user from a false sense of grounding.

### Provenance and verdicts

Once verification and tool trace existed, the UI could support a richer surface:
- verdict banner
- provenance labels
- tool trace disclosure

These elements work together:
- the verdict summarizes epistemic posture
- provenance explains grounding source
- tool trace shows operational evidence
- markers annotate claims locally

Together they shift the UI from “nice answer presentation” to “answer accountability.”

### Narrative takeaway

Slice 4 was the ethical center of the whole implementation.

It is where the extension learned not just to render content richly, but to communicate what kind of truth claim that content represents.

---

## Slice 5 — Actions, safety gating, instance awareness, and polish

### What Slice 5 was trying to solve

By the end of Slice 4, the output could be rich, structured, and epistemically annotated. The next step was obvious but dangerous:

> Can the output become interactive without compromising safety or architectural truth?

Slice 5 answered yes, but only under strict rules.

### System role

This slice sits at the seam between:
- `feature_vscode_extension`
- `feature_agentic_tool_execution_loop`
- the behavioral and presentation ambitions captured in `feature_cognitive_output_rendering_plan`

If Slice 4 was about answer accountability, Slice 5 was about action accountability.

### Core non-negotiable rules

The plan made the safety posture explicit:
1. no action auto-executes
2. no optimistic success
3. destructive actions require confirmation
4. action allowlist
5. tool trace reflects reality
6. no action bypasses the real tool execution path
7. action provenance is logged

These rules are the heart of the slice.

### Why Slice 5 was different from ordinary UI polish

Many systems add buttons late in a project as a visual convenience. Here, buttons were architectural commitments.

A button labeled “do X” in this extension is not just a UI element. It implies:
- a host-side execution path
- validation
- state feedback
- logging
- safety gating
- consistency with real tool execution architecture

That is why Slice 5 belongs to the system boundary between rendering and orchestration.

### Main implementation themes

Slice 5 added or completed the following interaction patterns:
- action blocks with primary/secondary buttons
- explicit-click action execution
- loading/completed/failed state protocol
- full-response expansion for truncated messages
- hover actions such as copy/retry/pin
- role header and context footer
- instance-scoped message persistence behavior
- implicit entity detection notice behavior
- render/resource limits

### Resource limits as product design

The resource limits in Slice 5 are easy to misread as defensive afterthoughts. They are actually part of the product design.

Limits such as:
- max rendered message size
- max entity links per message
- max card nesting depth
- verification batching and timeout caps

protect three things simultaneously:
- responsiveness
- comprehensibility
- trustworthiness

A cognitive UI that tries to show everything can become less truthful by overwhelming the user or collapsing under its own complexity.

### Instance awareness

One of the subtler but important themes in Slice 5 was instance isolation.

Because DreamGraph is instance-scoped, the chat UI cannot behave like a flat global transcript. Message persistence, restore behavior, and action context all need to respect the active instance boundary.

This ties back to the broader system’s instance-management concerns and to the testing context already present in the repository.

### Implicit entity detection

Another subtle step in Slice 5 was moving beyond explicit URI references toward detection of meaningful plain-text entity mentions.

This was handled conservatively, as notice-level behavior rather than uncontrolled linkification. That reflects a mature trade-off:
- make the UI more graph-aware
- do not over-assert semantic certainty where the signal is fuzzy

### Narrative takeaway

Slice 5 turned the output surface into an interaction surface, but only by making the host-side execution contract more explicit, not looser.

It is the slice where the UI became operational without becoming reckless.

---

## Cross-slice themes

### 1) The UI kept getting richer, but the host stayed authoritative

Across all five slices, one principle stayed stable:
- the webview renders and relays intent
- the extension host validates, executes, and owns truth-bearing behavior

This was especially important for:
- opening links
- clipboard actions
- entity verification
- tool trace generation
- action execution
- secret redaction

This is a strong architectural pattern, and it aligns with the extension’s role within DreamGraph.

### 2) Trust was treated as a first-class product feature

The implementation story is not just about visual improvement. It is about progressively layering trust signals:
- Slice 1: safe rendering
- Slice 2: explicit references
- Slice 3: semantic structures
- Slice 4: verification/provenance/trace
- Slice 5: action safety and auditability

That progression is unusually disciplined. Many products do these in reverse order or skip the truth-layer entirely.

### 3) Fallback behavior was part of the architecture, not an afterthought

Every slice included explicit fallback behavior:
- missing browser assets → plaintext fallback
- malformed cards → code block fallback
- disconnected verification → no markers
- partial verification → conservative statuses
- action failure → explicit error state, not fake success
- render limits → truncation plus controlled expansion

This matters because cognitive UI failures are often failures of ambiguity, not just crashes. The plan repeatedly chose conservative degradation over magical behavior.

### 4) The rendering layer increasingly mirrored the knowledge model

The output evolved through a sequence of increasingly knowledge-shaped forms:
- plain text
- markdown
- entity links
- semantic cards
- verification markers
- provenance and verdicts
- actions and contextual controls

This is effectively the UI side of DreamGraph’s philosophy: system understanding should be structured, inspectable, and grounded.

---

## How the slices relate to DreamGraph features

### `feature_vscode_extension`

This feature owns the user-facing editor integration, and the five-slice story is largely a specialization of that feature’s chat surface.

The slices transformed the extension from a minimal chat panel into a more faithful cognitive surface.

### `feature_agentic_tool_execution_loop`

This feature becomes especially important in Slices 4 and 5.

The most critical constraint it imposed was:
- rendering must not invent execution history
- actions must not bypass the real execution path
- traces must represent actual tool activity

Without this constraint, the UI could have become polished but misleading.

### `feature_cognitive_output_rendering_plan`

This feature is the planning-and-tracking umbrella for the entire effort. It captures the fact that this was not one change, but a staged implementation track with increasing cognitive fidelity.

In that sense, the plan itself became part of the system’s knowledge graph: not just a document, but a tracked feature boundary that connected design intent to realized implementation.

---

## What the five-slice journey accomplished

Taken together, the five slices changed the nature of the chat panel.

At the beginning, the panel was primarily:
- a message transcript
- a text streaming surface
- a thin shell around LLM output

By the end of the five-slice plan, it had become:
- a rendered cognitive document surface
- a graph-aware presentation layer
- an evidence-disclosing interaction layer
- a safety-gated action surface
- an instance-aware operational UI

That is a major shift in system role.

The chat panel stopped being merely where answers appear. It became where system understanding is presented, qualified, and sometimes acted upon.

---

## Final assessment of the implementation story

This five-slice implementation is best understood as a disciplined ascent through five levels of maturity:

1. **Readable** — safe markdown and code rendering  
2. **Navigable** — explicit entity-aware references  
3. **Semantic** — cards for typed cognitive artifacts  
4. **Accountable** — verification, provenance, and real trace  
5. **Actionable** — safe, logged, explicit interactions

That sequence is coherent and well-shaped. It respects both user experience and architectural truth.

The strongest aspect of the story is that the implementation did not confuse “richer UI” with “more freedom.” In fact, every increase in expressiveness came with stronger constraints:
- more rendering, but stricter sanitization
- more semantics, but clearer fallback
- more trace, but only from real execution
- more actions, but only through allowlisted, host-validated paths

That is the right shape for a cognitive system interface.

---

## Provenance

This story is based on:
- `plans/TDD_COGNITIVE_OUTPUT_V2.md`
- `query_resource("system://features")`

Graph-grounded features referenced:
- `feature_cognitive_output_rendering_plan`
- `feature_vscode_extension`
- `feature_agentic_tool_execution_loop`

Context note:
- Workflow and ADR context for the slices was sparse in the graph data available here.
- The narrative is therefore primarily **plan-grounded and feature-grounded**, with architectural interpretation inferred from the implementation plan and feature descriptions.
