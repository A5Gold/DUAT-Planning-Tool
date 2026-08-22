## Agent skills

### Issue tracker

Issues and specs are tracked as local Markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the default five triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository; domain context lives in root `CONTEXT.md` and decisions in `docs/adr/`. See `docs/agents/domain.md`.

## Current product direction

The current target is the Manpower Planner reconstruction described in:

- `PRODUCT.md` — product scope, users and confirmed business rules.
- `DESIGN.md` — event-store, domain, optimizer and UX design.
- `DEVELOPMENT_SPEC.md` — implementation contracts, requirements, tests and delivery phases.

These files supersede the domain assumptions in `01 Plan/OHLR-DUAT Product Spec.md` and `01 Plan/OHLR-DUAT Development Spec.md` only for the new reconstruction. Those files remain historical v1 baseline references and must not be silently rewritten.

## Non-negotiable domain rules

- The new application starts with a new event store. The existing SQLite database contains test data and is not a migration source.
- Staff No. is the immutable identity key. Name-only records require an explicit alias reconciliation decision.
- All writes append versioned events. Do not update an event in place or let renderer code write directly to SQLite.
- Job Role, Qualification, Allocation, Planned Duty and Actual Duty are separate concepts.
- Isolation/Earthing requires AP and CP; CP(P) or CP(T) can satisfy the CP requirement. Possession requires CP(P). PA Work accepts CP(P) or CP(T).
- NP is optional by default and becomes required only when a template or Planner enables it.
- SPC has no qualification predicate, but it must be confirmed available, may overlay at most one other role in the same Job, must support another AP, and cannot self-check or cross Jobs.
- Unknown or unmapped Roster codes are `unknown` and never count as available supply.
- Job Role Record stores planned and actual layers. Future legacy rows are not silently treated as actual.
- The weekly three-night `2 Job Night` target is disabled and must not become an implicit solver rule.

## Event-sourcing working agreement

1. Discover code through the codebase-memory graph first (`search_graph`, `trace_path`, `get_code_snippet`, `query_graph`); fall back to `rg` for literals, configs and non-code files.
2. Every mutation enters through a typed command, expected aggregate sequence and idempotency key.
3. Add a projector/replay test for every new event type. A projection must be rebuildable from zero.
4. Keep policy versions and effective dates explicit. Do not bury a new business rule in a UI component or solver adapter.
5. Optimizer output is a proposal. It must include snapshot sequence, policy versions and explanations, and it must never publish automatically.
6. Preserve raw Excel values, source hashes and row/cell provenance. Unknown values go to the exception queue rather than being guessed.

## Import and data-safety rules

- Treat `00 Reference Document/Qualification/Qualification.xlsx`, `Job Role Record/Job Role Record.xlsx`, `Roster/2026 Roster.xlsx` and `Team Member/Team Formation.xlsx` as read-only source artifacts during analysis and tests.
- Do not use `Counta` formulas as ground truth; recalculate from raw role slots.
- Do not fuzzy-match names silently. Store candidate aliases and require an explicit resolution.
- Do not delete, reset or overwrite user-provided Excel files, `.superpowers/`, or codebase-memory artifacts.
- A source change after import preview invalidates the commit and requires a new preview.

## UI and workflow rules

- Use Fluent UI for the operational desktop interface. The primary flow is work-first: weekly strip, selectable date, Job cards, then a capacity/personnel sidebar.
- Preserve business validation, keyboard access, drag-and-drop fallback, loading/empty/error states and textual status labels.
- Dynamic `RoleRequirement` data drives role rows; do not hard-code AP/CP-only layouts.
- Do not fill unselected week dates with fake data.

## Verification expectations

Before calling a change complete, run the smallest relevant unit/domain tests, import fixtures, event replay tests and UI/E2E checks. For optimizer changes, include a deterministic golden fixture and an explanation test for every blocking shortage. For schema changes, test clean first launch, backup/restore and projection rebuild in a writable Windows folder.
