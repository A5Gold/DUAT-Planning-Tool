import {
  createEmptyNightPlan,
  createLocation,
  PlanningService,
  type NightPlan,
  type PlanningData,
  type PlanningState,
  type Qualification,
  type Staff,
  type Work,
} from '../domain/planning';

const asOf = '2026-08-20';

const qualification = (type: Qualification['type'], expiryDate: string): Qualification => ({
  type,
  expiryDate,
});

const staff = (
  staffNumber: string,
  name: string,
  team: Staff['team'],
  qualifications: Qualification[] = [],
  isGeneralEmployee = false,
): Staff => ({
  staffNumber,
  name,
  team,
  qualifications,
  isGeneralEmployee,
});

export const mockPlanningData: PlanningData = {
  staff: [
    staff('517968', 'YF Mak', 'S1', [qualification('AP', '2026-10-28'), qualification('CP(T)', '2027-04-08')]),
    staff('673706', 'SM Yeung', 'S1', [qualification('AP', '2027-03-20'), qualification('CP(T)', '2026-10-17')]),
    staff('469319', 'MT Chan', 'S1', [qualification('AP', '2027-01-03'), qualification('CP(P)', '2027-06-23')]),
    staff('321508', 'YW Ho', 'S2', [qualification('AP', '2027-02-10'), qualification('CP(P)', '2027-02-10')]),
    staff('461865', 'SC Lam', 'S2', [qualification('AP', '2027-01-30'), qualification('CP(P)', '2027-01-30')]),
    staff('676095', 'HH Chan', 'S2', [qualification('CP(P)', '2026-12-15')]),
    staff('681383', 'KW Ng', 'S2', [qualification('CP(T)', '2026-08-29')]),
    staff('684061', 'LF To', 'S2', [qualification('CP(T)', '2026-08-09')]),
    staff('679417', 'TK Cheung', 'S2', [qualification('CP(T)', '2026-12-19')]),
    staff('265691', 'CF Lee', 'S3', [qualification('AP', '2027-04-26'), qualification('CP(P)', '2027-04-26')]),
    staff('422401', 'KL Yeong', 'S3', [qualification('CP(P)', '2026-06-23')]),
    staff('679365', 'CY Kwok', 'S3', [qualification('CP(P)', '2027-01-18')]),
    staff('680682', 'WS Lai', 'S3', [qualification('CP(P)', '2027-02-12')]),
    staff('678954', 'WC Yuen', 'S3', [qualification('CP(P)', '2027-03-03')]),
    staff('685750', 'KW Wong', 'S3', [], true),
    staff('682089', 'HN Kwok', 'S3', [], true),
    staff('321524', 'WH Hui', 'S4', [qualification('AP', '2027-06-28'), qualification('CP(P)', '2026-10-20')]),
    staff('427616', 'HB So', 'S4', [qualification('AP', '2027-01-12'), qualification('CP(P)', '2027-01-12')]),
    staff('672075', 'KY Cheung', 'S4', [qualification('CP(T)', '2027-02-02')]),
    staff('655180', 'CS Yau', 'S4', [qualification('CP(T)', '2027-03-11')]),
    staff('673277', 'CH Ng', 'S4', [qualification('CP(P)', '2027-01-28')]),
    staff('674432', 'TH Ma', 'S4', [qualification('CP(P)', '2027-04-11')]),
    staff('422380', 'KH Tong', 'S5', [qualification('AP', '2026-11-14'), qualification('CP(P)', '2027-01-09')]),
    staff('669557', 'HN Lee', 'S5', [qualification('AP', '2027-02-21'), qualification('CP(T)', '2027-08-19')]),
    staff('505935', 'KK Lau', 'S5', [qualification('CP(P)', '2027-03-02')]),
    staff('580058', 'YH Zhang', 'S5', [qualification('CP(P)', '2027-03-02')]),
    staff('680417', 'MF Ngai', 'S5', [qualification('CP(T)', '2027-04-03')]),
    staff('684119', 'MR Yu', 'S5', [], true),
    staff('676140', 'CY Choi', 'S5', [], true),
  ],
  roster: [
    ...['517968', '673706', '469319'].map((staffNumber) => ({ date: asOf, staffNumber, status: 'available' as const })),
    ...['321508', '461865', '676095', '681383', '684061', '679417'].map((staffNumber) => ({
      date: asOf,
      staffNumber,
      status: 'night-duty' as const,
    })),
    ...['265691', '422401', '679365', '680682', '678954', '685750', '682089'].map((staffNumber) => ({
      date: asOf,
      staffNumber,
      status: 'day-duty' as const,
      reason: '非夜更',
    })),
    ...['321524', '427616', '672075', '655180', '673277', '674432'].map((staffNumber) => ({
      date: asOf,
      staffNumber,
      status: 'night-duty' as const,
    })),
    ...['422380', '669557', '505935', '580058', '680417', '684119', '676140'].map((staffNumber) => ({
      date: asOf,
      staffNumber,
      status: 'night-duty' as const,
    })),
  ],
};

const withWork = (plan: NightPlan, slot: 1 | 2 | 3 | 4 | 5, patch: Partial<Work>): NightPlan => ({
  ...plan,
  works: plan.works.map((work) => (work.slot === slot ? { ...work, ...patch } : work)),
});

const assignment = (workId: string, locationId: string | undefined, role: 'AP' | 'CP' | '一般員工', staffNumber: string) => ({
  id: `${workId}:${locationId ?? 'work'}:${role}:${staffNumber}`,
  workId,
  locationId,
  role,
  staffNumber,
  qualificationUsed: role === 'AP' ? ('AP' as const) : role === 'CP' ? ('CP(P)' as const) : undefined,
  source: 'manual' as const,
});

export function createMockPlan(date = asOf): NightPlan {
  let plan = createEmptyNightPlan(date);
  const work1Id = plan.works[0].id;
  const work2Id = plan.works[1].id;
  const wcd = createLocation(`${work1Id}:wcd`, 1, {
    locationName: 'WCD 車廠',
    isolationPoint: 'WCD-ISO-01',
    earthingPoint: 'WCD-E-01',
    minimumTotalHeadcount: 6,
  });
  const mainLine = createLocation(`${work1Id}:main-line`, 2, {
    locationName: '正線',
    isolationPoint: 'ML-ISO-02',
    earthingPoint: 'ML-E-02',
    minimumTotalHeadcount: 5,
  });
  const url = createLocation(`${work2Id}:url`, 1, {
    locationName: 'URL 區段',
    isolationPoint: 'URL-ISO-04',
    earthingPoint: 'URL-E-04',
    minimumTotalHeadcount: 4,
  });

  plan = withWork(plan, 1, {
    active: true,
    projectCode: 'C9021',
    type: 'Possession',
    jobDescription: 'WCD 車廠及正線架空電纜更新，完成隔電及接地安排。',
    remarks: 'WCD 與正線同晚進行；此 Project 優先。',
    locations: [wcd, mainLine],
  });
  plan = withWork(plan, 2, {
    active: true,
    projectCode: 'C7731',
    type: 'Possession',
    jobDescription: 'URL 區段檢修及部件更換。',
    remarks: '測試另一組工作組合。',
    locations: [url],
  });
  plan = withWork(plan, 3, { type: 'PA Work', projectCode: '未安排' });
  plan = withWork(plan, 4, { projectCode: '未安排' });

  plan.assignments = [
    assignment(work1Id, wcd.id, 'AP', '321508'),
    assignment(work1Id, wcd.id, 'CP', '676095'),
    assignment(work1Id, mainLine.id, 'AP', '321524'),
    assignment(work1Id, undefined, '一般員工', '684119'),
    assignment(work1Id, undefined, '一般員工', '676140'),
    assignment(work2Id, url.id, 'AP', '461865'),
  ];
  return plan;
}

export function createMockState(date = asOf): PlanningState {
  const main = createMockPlan(date);
  const scenarioAPlan: NightPlan = {
    ...main,
    assignments: [
      ...main.assignments,
      assignment(main.works[1].id, main.works[1].locations[0].id, 'CP', '427616'),
    ],
  };
  const now = new Date().toISOString();
  return {
    date,
    main,
    scenarios: [
      { id: 'scenario-a', name: '測試方案 A', plan: scenarioAPlan, temporary: true, createdAt: now, updatedAt: now },
      { id: 'scenario-b', name: '測試方案 B', plan: structuredClone(main), temporary: true, createdAt: now, updatedAt: now },
      { id: 'scenario-c', name: '測試方案 C', plan: structuredClone(main), temporary: true, createdAt: now, updatedAt: now },
    ],
    activeScenarioId: 'scenario-a',
  };
}

export const mockPlanningService = new PlanningService(mockPlanningData);
