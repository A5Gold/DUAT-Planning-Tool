export type DutyLayer = "planned" | "actual";
export type DutyStatus = "confirmed" | "substituted" | "absent" | "cancelled" | "corrected";

export interface PlannedDuty {
  dutyId: string;
  jobId: string;
  staffNumber: string;
  role: string;
  date: string;
  locationId?: string;
  publishedAt: string;
  snapshotSequence: number;
  policyVersion: string;
}

export interface ActualDuty {
  actualId: string;
  plannedDutyId: string;
  jobId: string;
  staffNumber?: string;
  role: string;
  date: string;
  status: DutyStatus;
  recordedAt: string;
  replacementFor?: string;
  reason?: string;
}

export type DutyEvent =
  | { type: "PlannedDutyPublished"; duty: PlannedDuty }
  | { type: "ActualDutyConfirmed"; duty: ActualDuty }
  | { type: "DutySubstituted"; duty: ActualDuty; replacementStaffNumber: string }
  | { type: "DutyAbsent"; duty: ActualDuty }
  | { type: "DutyCancelled"; duty: ActualDuty }
  | { type: "DutyCorrected"; duty: ActualDuty; correctsActualId: string };

export interface DutyProjection {
  planned: ReadonlyMap<string, PlannedDuty>;
  actual: ReadonlyMap<string, ActualDuty>;
}

export function replayDutyEvents(events: readonly DutyEvent[]): DutyProjection {
  const planned = new Map<string, PlannedDuty>();
  const actual = new Map<string, ActualDuty>();
  for (const event of events) {
    if (event.type === "PlannedDutyPublished") planned.set(event.duty.dutyId, event.duty);
    else actual.set(event.duty.actualId, event.duty);
  }
  return { planned, actual };
}

export interface DutyCorrectionInput {
  actualId: string;
  plannedDutyId: string;
  jobId: string;
  role: string;
  date: string;
  staffNumber?: string;
  reason: string;
  recordedAt: string;
}

export function correctActual(input: DutyCorrectionInput): DutyEvent {
  return {
    type: "DutyCorrected",
    correctsActualId: input.actualId,
    duty: { ...input, status: "corrected" },
  };
}
