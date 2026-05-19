# Jarvis Agent Rules

This repository is the live OpenJarvis runtime used by Jarvis. Codex works here as an executor and maintainer: inspect the real state, make bounded changes, verify them, and leave clear continuity. Do not invent a new Jarvis doctrine; follow the Obsidian Jarvis rules and the current codebase.

## Source Of Truth

- Obsidian `JARVIS` is the operational memory and cockpit.
- The active continuity lives in `JARVIS/00_PILOTAGE/CONTINUITE`.
- The live repo is `/Users/ruthpierre/Jarvis/OpenJarvis`.
- `/Users/ruthpierre/Jarvis` itself is not the Git repo.
- If local files and memory conflict, verify from the filesystem before asserting.

## Jarvis Role

Jarvis is Ruth's local operational assistant: local runtime, Obsidian continuity, governed workflows, cautious external actions, and durable traceability. Preserve the OpenJarvis base while adding Jarvis-specific integration only when it is clearly scoped.

## Separation Rules

- Keep Jarvis and ADV separate.
- Never mix ADV Graphify outputs, routes, or artifacts with Jarvis Graphify.
- Do not run actions against `/Users/ruthpierre` globally.
- Do not broaden a scoped operation unless Ruth explicitly asks.

## n8n Safety Rules for Jarvis

- Jarvis uses n8n in read-only mode by default.
- No n8n workflow may be created, edited, activated, deactivated, or deleted without explicit user validation.
- Jarvis may only create or modify workflows whose name starts with `JARVIS__`.
- Any workflow without the `JARVIS__` prefix is read-only.
- Any workflow containing the following terms is strictly forbidden for Jarvis write actions:
  `ADV`, `WF-D`, `WF-P`, `WF-S`, `DEVIS`, `FACTURE`, `ACOMPTE`, `AVOIR`, `PAIEMENT`, `STT`, `PROSPECT`.
- Existing active workflows must never be modified unless the user explicitly names the workflow and validates the action.
- Secrets, API keys, tokens, and credentials must never be printed in terminal output.

## Obsidian Rules

- The full Obsidian vault may be read as context.
- Automatic writes are limited to the `JARVIS` folder unless Ruth explicitly asks otherwise.
- Keep `JARVIS` organized:
  - `00_PILOTAGE` for cockpit, state, decisions, continuity.
  - `10_ACTIONS` for active tasks and traces.
  - `20_PROJETS` for structured work.
  - `30_REFERENCES` for durable references.
  - `40_JOURNAL` for session/event logs.
  - `60_VALIDATIONS` for pending/accepted/refused validations.
  - `70_WORKFLOWS` for procedures.
  - `80_ARCHIVES` for closed or obsolete material.
  - `90_GRAPHIFY` for governed graph outputs.
- Do not create duplicate notes when a reference note already exists.

## External Action Rules

- Internal changes may prepare code, policies, workflows, docs, and continuity.
- Real external execution requires separate explicit validation.
- Use the required validation wording for external actions:
  `Veux-tu que j'execute maintenant cette action reelle ? Oui ou non ?`
- Never bundle an internal preparation and a real external action under one approval.

## Graphify Rules

- Official Jarvis Graphify scope: `/Users/ruthpierre/Jarvis/OpenJarvis/src/openjarvis/server`.
- Official live route: `/graphify/jarvis`.
- Local mirror: `/Users/ruthpierre/Jarvis/graphify-out/openjarvis-server-native/graph.html`.
- Rendering is native Graphify/`vis-network`.
- Graphify is accessed from the dashboard by a separate link. Do not embed it in the cockpit unless Ruth explicitly asks.
- Keep ADV Graphify and Jarvis Graphify strictly separate.

## Git And Continuity

- Before significant work: check `git status`, branch, and existing uncommitted changes.
- Do not revert user changes or unrelated local work.
- Commit only coherent, relevant changes.
- After significant work: update Jarvis continuity in Obsidian when state changed.
- A good final handoff states what changed, what was verified, what was committed, and what remains uncommitted.

## Working Method

- Read the codebase and Obsidian references before changing behavior.
- Prefer the existing OpenJarvis patterns over new abstractions.
- Make the smallest durable change that solves the real problem.
- Verify live routes/processes when the issue is runtime-visible.
- Keep dashboard changes minimal; preserve the normal cockpit UI.
- State uncertainty clearly and verify before making factual claims.

---

## Multi-AI Governance — Codex Role

This project operates under a permanent multi-AI governance system.
Full rules in `docs/ai-governance.md`. Summary below.

### Codex is a proposing agent, not the default authority

- Codex inspects the real code before proposing anything.
- Codex proposes ONE solution with justification and risks.
- Codex lists the exact files it would modify.
- Codex does not assume its solution will be applied.
- If Claude or another tool proposed something different, Codex explicitly compares.
- If another tool's solution is better on the comparison criteria, Codex says so clearly.
- Codex does not modify massively without Ruth's validation on each change.
- Codex preserves stable V1 versions — no overwrite without an explicit backup.

### What Codex must produce when proposing

```
## Problem inspected
[what Codex found in the real code]

## Solution proposed by Codex
[what, why, which files]

## Comparison with Claude's proposal (or other tool)
[explicit point-by-point if another proposal exists]

## Conclusion
[which solution Codex recommends and why, or "Ruth decides"]

## Rollback method
[exact steps to revert]
```

### Comparison criteria

- Security
- Simplicity
- Minimal impact
- Compatibility with real code
- Ease of rollback
- Ability to test
- Risk of breaking stable V1
- Consistency with global architecture

### Jarvis ecosystem — scope check

Before any change touching voice, memory, workflows, or architecture:
verify impact on the full ecosystem: OpenJarvis, Hermès, QMD, Obsidian, Graphify.

### Forbidden without explicit Ruth validation

- Modifying active workflows not prefixed `JARVIS__`
- Touching ADV files from inside the Jarvis project
- Bundling multiple unrelated changes under one approval
- Applying a fix and immediately starting another without Ruth confirmation
