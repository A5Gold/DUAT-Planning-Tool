# Phase 3 Workflow Completion

## Objective

Complete the reconstruction workflow described by `PRODUCT.md`, `DESIGN.md` and
`DEVELOPMENT_SPEC.md` for the currently reported gaps: real module navigation,
Electron Excel import, personnel availability, reserve statistics, and dynamic
night Work capacity.

## Scope

1. **Desktop data path**
   - Keep file selection and workbook access in Electron main process.
   - Support Formation, Qualification and Roster import kinds through typed IPC.
   - After an accepted commit, refresh the workbench from the same read model so
     imported Staff, Qualification and Roster data immediately appears in the
     personnel sidebar and candidate queries.
   - Browser mode remains an explicit review mode; it must not pretend to have
     access to local files or silently seed production data.

2. **Planner workbench**
   - Start each new NightPlan with two active Work slots.
   - Allow Planner to add Work slots up to five. A sixth add attempt is rejected
     with a visible message and no state mutation.
   - Remove the obsolete four-Work rule from visible UI copy.
   - Preserve dynamic role validation, keyboard/drop fallback and scenario
     isolation.
   - Show available, qualified, assigned, reserved, spare and shortage counts in
     the personnel/capacity sidebar using the selected night snapshot.

3. **Operational modules**
   - Navigation buttons render real pages rather than only changing selection.
   - Projects: list/edit the project fields used by Work demand.
   - People and Qualifications: list Staff No., name, team, availability,
     qualifications and expiry state.
   - Roster: show daily resolved availability and raw status/reason.
   - Booking Rules: show the active versioned CP(P)/CP(T), Possession, PA Work,
     NP and SPC policy facts without duplicating solver logic in the renderer.
   - Reports and Backup: expose current-night capacity/reserve summary and the
     existing backup/restore capabilities or a truthful empty state when no
     records exist.

## Data and safety constraints

- Renderer writes only through typed IPC commands; no direct SQLite or Excel use.
- Unknown roster values remain unavailable and visible as unknown.
- Staff No. remains the identity key; no fuzzy name matching is introduced.
- Existing reference Excel files remain read-only.
- No fake data is inserted into unselected dates. Browser review mode is labeled.

## Verification

- Domain tests for default Work count, fifth/sixth Work behavior, reserve
  calculation and imported availability.
- IPC/import tests for Roster preview/commit and post-commit workbench refresh.
- Playwright coverage for module navigation, Work add limit, personnel display,
  import empty/browser state and Electron file-selection path.
- Run `npm run typecheck`, `npm test`, `npm run build`, Electron smoke and the
  relevant Playwright suite with the portable Node CA setting.
