# OHLR-DUAT Planning Tool

## Product Specification

| Field | Value |
| --- | --- |
| Status | Approved development baseline |
| Date | 2026-08-20 |
| Primary user | OHL Department Planner |
| Product type | Internal offline decision-support tool |
| Delivery | Windows portable ZIP |
| UI baseline | Hybrid week and single-night workbench v4 |

## 1. Product Purpose

MTR OHL Department needs to arrange several concurrent night works with limited manpower, timeline and budget. AP, CP(P), CP(T), general employees, team availability, qualification dates, Isolation Points and Earthing Points can change from night to night.

The tool gives the Planner one place to model a week, test a selected night, see named resource assignments and identify shortages before the arrangement is issued. It is a local decision-support tool and does not replace the formal MTR planning platform.

## 2. Users and Context

The primary user is the Planner working on a Windows company computer, usually reviewing the next night and the surrounding week. The Planner needs a dense operational screen that supports scanning, direct editing, fast comparison and traceable remarks.

The interface uses Traditional Chinese for operational labels and keeps engineering abbreviations such as AP, CP(P), CP(T), SIL, DUAT and Roster.

## 3. Core Domain Vocabulary

- **Staff:** A person in the Formation or Qualification source data.
- **Main work team:** S2, S3, S4 or S5.
- **Support team:** S1, which may be selected as additional support.
- **Sup.:** Supervisor personnel outside the normal Formation; excluded by default and manually addable with a remark.
- **AP:** Authorized Person role.
- **CP(P):** Possession CP qualification.
- **CP(T):** PA Work CP qualification.
- **General employee:** A person without an AP or CP qualification. The UI label is 一般員工.
- **Project Code:** The same identifier as the item number. Each Work has one Project Code.
- **Work:** One project arrangement slot on a selected night. A night supports at most four Works.
- **Location:** A physical work area within a Work, with an editable name, Isolation Point and Earthing Point.
- **Scenario:** A saved alternative arrangement for one selected night.

## 4. Business Rules

### 4.1 Night and week rules

- The week runs Sunday to Saturday, with Sunday displayed first.
- The week containing January 1 is week 1.
- Saturday defaults to a rest day.
- Sunday normally supports Work 1 only.
- Work 2 is normally arranged on three weekday nights per week.
- The weekday target is three `2 Job Night` arrangements and two `1 Job Night` arrangements.
- Work 3 and Work 4 can be used for additional Possession or PA Work when resources allow.
- Any exception may be recorded in Remarks and must remain visible in the plan.

### 4.2 Resource rules

- Every Location requires exactly one AP and one CP by default.
- AP and CP must be different people.
- One person can belong to only one Work and one role on the same night.
- Possession requires CP(P).
- PA Work accepts CP(P) or CP(T), with CP(T) preferred by the suggestion engine.
- Minimum total headcount includes the assigned AP and CP. General employees fill the remaining headcount.
- General employees are allocated at Work level and are not assigned to individual Locations.
- S1 is optional support and can be added manually.
- Sup. personnel are excluded unless the Planner explicitly adds them and records a remark.

### 4.3 Qualification and availability rules

- Formation is the main source of current team membership.
- Qualification is matched by staff number.
- SIL, DUAT, CP(P) and CP(T) must be evaluated separately. A generic CP marker is not sufficient.
- `--` and blank qualification cells mean no qualification.
- A qualification is valid through its expiry date. It is invalid after that date.
- 90, 60 and 30-day expiry windows are warnings only.
- Non-night duty, leave, sickness, training, manual unavailability and expired qualification are hard restrictions.
- Roster is imported and can be corrected per night in the tool.

### 4.4 Priority and conflict rules

Suggestions are ranked by:

1. Deadline.
2. Project priority.
3. Progress gap.
4. Weekly target.

When Works compete for a person, the tool proposes alternatives and does not silently move an existing assignment.

## 5. Primary User Workflows

### 5.1 Prepare data

1. Import Team Formation and Qualification Excel files.
2. Import or create the weekly Roster.
3. Review the staging preview and fix row-level errors.
4. Maintain booking qualification rules when operational rules change.

### 5.2 Plan a week

1. Open the weekly workbench.
2. Use the date selector or seven-day strip to select a night.
3. Review the week number, date range and existing Work summary.
4. Keep all four Work slots visible, including grey inactive slots.

### 5.3 Arrange one night

1. Enter or select the Project Code for each Work.
2. Switch each Work between Possession and PA Work.
3. Enter Job Description and Remarks.
4. Add and edit Locations, Isolation Points and Earthing Points.
5. Set the minimum total headcount per Location.
6. Review automatic named suggestions.
7. Drag qualified people from the S1-S5 sidebar to AP/CP Location rows.
8. Drag general employees to the Work-level 一般員工 row.
9. Resolve red shortage warnings or record an approved exception.

### 5.4 Test alternatives

1. Copy the selected night into Scenario A, B or C.
2. Make temporary changes without modifying the formal plan.
3. Compare resource status and named assignments.
4. Delete obsolete scenarios.
5. Apply a scenario only after explicit confirmation.

### 5.5 Issue and recover a plan

1. Export detailed assignments to Excel.
2. Export or print a concise PDF summary.
3. Create a local backup.
4. Restore a backup when required.

## 6. Final UI Requirements

- Product title: `OHLR-DUAT Planning Tool`.
- Header shows a date selector, year week number and `YYYY-MM-DD 至 YYYY-MM-DD`; do not show full weekday names in the week metadata.
- Weekly strip contains Sunday through Saturday, with Sunday first.
- Selected night is processed in the center.
- Right sidebar is the当晚可用人員 list grouped by S1, S2, S3, S4 and S5. It shows names, qualifications, availability and current Work assignment.
- Sidebar personnel are draggable to Location AP/CP rows or Work-level general employee rows.
- Work 1 through Work 4 are always visible. Unarranged Works are grey.
- Project Code is prominent and editable.
- Work type is a Possession/PA Work segmented control.
- Each Work has Job Description and Remarks fields. Remarks has no helper text such as planner input or override reason.
- Each Location has editable Location Name, Isolation Point, Earthing Point and minimum total headcount.
- Each Location visibly shows the assigned AP and CP person.
- 一般員工 appears once per Work and is not allocated to a Location.
- Resource validation is automatic. Shortages are immediately red and there is no separate resource-check button.
- Scenario tabs have delete controls. Temporary-save labels and actions use orange.
- The work area has internal scrolling so the people sidebar remains available at desktop and 929px review widths.

## 7. Success Criteria

- A Planner can import the reference personnel data and see row-level validation results.
- A Planner can create a Sunday-to-Saturday week and select any night.
- A Planner can edit four Work slots and multiple Locations without losing the week context.
- Each Location shows a named AP and CP requirement and immediately reports missing qualifications.
- A Planner can drag personnel from S1-S5 into valid Work or Location assignments.
- Duplicate assignment, wrong qualification and unavailable personnel are prevented or clearly marked.
- Scenario changes remain isolated until explicitly applied.
- The plan can be exported, backed up, restored and reopened from the portable ZIP.

## 8. Out of Scope

- Multi-user synchronization or cloud hosting.
- Login, SSO, permissions and role administration.
- Live integration with the formal MTR planning platform.
- Payroll, attendance and automatic fatigue-law enforcement.
- Automatic generation of the external Roster.
- Mobile-native delivery.
- Silent automatic reallocation of an already confirmed Work.
- Automatic inference of unsupported booking combinations.

## 9. Reference Data

- `Team Formation.xlsx` is the source for Formation, team membership and planner constraints.
- `Qualification.xlsx` is the source for staff qualification and expiry data.
- The latest Qualification worksheet is selected by `Update on`.
- The v4 visual prototype is maintained separately from the product source until the implementation project is scaffolded.
