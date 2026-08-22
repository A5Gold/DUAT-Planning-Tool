import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Switch,
  Textarea,
  Tooltip,
} from '@fluentui/react-components';
import {
  Add20Regular,
  ArrowSync20Regular,
  CalendarLtr20Regular,
  CheckmarkCircle20Filled,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  Delete20Regular,
  Dismiss20Regular,
  DocumentBulletList20Regular,
  PeopleTeam20Regular,
  Save20Regular,
  Search20Regular,
  Settings20Regular,
  Warning20Filled,
} from '@fluentui/react-icons';
import {
  createLocation,
  PlanningService,
  type Assignment,
  type AssignmentRole,
  type ISODate,
  type Location,
  type NightPlan,
  type PlanningState,
  type Staff,
  type ValidationIssue,
  type ValidationOptions,
  type Work,
  type PlanningData,
} from './domain/planning';
import { createMockState } from './data/mockData';
import { ImportWorkbench } from './components/ImportWorkbench';
import type { IpcResult, PlanningMutationDto, WorkbenchSnapshotDto } from './application/ipcContract';

const INITIAL_DATE = '2026-08-20';
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const TEAM_ORDER: Staff['team'][] = ['S1', 'S2', 'S3', 'S4', 'S5'];

function parseDate(value: string): Date {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? new Date(`${INITIAL_DATE}T12:00:00`) : date;
}

function isoDate(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

function sundayStart(value: ISODate): Date {
  const date = parseDate(value);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function weekNumber(value: ISODate): number {
  const targetDate = parseDate(value);
  const date = sundayStart(value);
  const yearStart = new Date(`${targetDate.getFullYear()}-01-01T12:00:00`);
  const firstSunday = sundayStart(isoDate(yearStart));
  return Math.floor((date.getTime() - firstSunday.getTime()) / 604800000) + 1;
}

function dateRangeLabel(value: ISODate): string {
  const start = sundayStart(value);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${isoDate(start)} 至 ${isoDate(end)}`;
}

function getCurrentPlan(state: PlanningState): NightPlan {
  if (state.activeScenarioId === 'main') return state.main;
  return state.scenarios.find((scenario) => scenario.id === state.activeScenarioId)?.plan ?? state.main;
}

/** Offline/browser review starts from an empty projection; source facts must come from IPC/import. */
function createEmptyState(date: ISODate): PlanningState {
  const seed = createMockState(date);
  const emptyPlan = {
    ...seed.main,
    works: seed.main.works.map((work) => ({
      ...work,
      active: work.slot <= 2,
      projectCode: '',
      locations: work.slot <= 2 ? [createLocation(`${work.id}:location-1`, 1, { locationName: `Location ${work.slot}` })] : [],
      assignments: [],
    })),
    assignments: [],
  };
  return { ...seed, main: emptyPlan, scenarios: [], activeScenarioId: 'main' };
}

function staffForAssignment(assignments: readonly Assignment[], staffNumber: string): Assignment | undefined {
  return assignments.find((assignment) => assignment.staffNumber === staffNumber);
}

function getAssignment(
  assignments: readonly Assignment[],
  workId: string,
  locationId: string | undefined,
  role: AssignmentRole,
): Assignment | undefined {
  return assignments.find(
    (assignment) =>
      assignment.workId === workId && assignment.locationId === locationId && assignment.role === role,
  );
}

function staffForNumber(staff: readonly Staff[], staffNumber: string): Staff | undefined {
  return staff.find((person) => person.staffNumber === staffNumber);
}

function issueFor(
  issues: readonly ValidationIssue[],
  workId: string,
  locationId: string | undefined,
  role: AssignmentRole,
): ValidationIssue | undefined {
  return issues.find(
    (issue) => issue.workId === workId && issue.locationId === locationId && issue.role === role,
  );
}

function availabilityLabel(status: string | undefined): string {
  if (status === 'night-duty') return '夜更';
  if (status === 'available') return '可用';
  if (status === 'day-duty') return '非夜更';
  if (status === 'leave') return '休假';
  if (status === 'sickness') return '病假';
  if (status === 'training') return '培訓';
  if (status === 'unavailable') return '不可用';
  return '未確認';
}

function statusClass(status: string | undefined): string {
  if (status === 'night-duty' || status === 'available') return 'available';
  if (!status) return 'unknown';
  return 'unavailable';
}

function isRosterAvailable(status: string | undefined): boolean {
  return status === 'night-duty' || status === 'available';
}

function stateFromSnapshot(snapshot: WorkbenchSnapshotDto): PlanningState {
  return {
    date: snapshot.date,
    main: snapshot.main,
    scenarios: snapshot.scenarios,
    activeScenarioId: snapshot.selectedScenario.kind === 'main' ? 'main' : snapshot.selectedScenario.scenarioId,
  };
}

function dataFromSnapshot(snapshot: WorkbenchSnapshotDto): PlanningData {
  const staff = snapshot.personnel.map((person) => ({
    ...person.staff,
    qualifications: person.qualifications,
  }));
  return {
    staff,
    qualifications: snapshot.personnel.flatMap((person) => person.qualifications.map((qualification) => ({ ...qualification, staffNumber: person.staff.staffNumber }))),
    roster: snapshot.personnel.flatMap((person) => person.rosterStatus ? [{
      date: snapshot.date,
      staffNumber: person.staff.staffNumber,
      status: person.rosterStatus,
      reason: person.rosterReason,
    }] : []),
  };
}

function App() {
  const [planningData, setPlanningData] = useState<PlanningData>({ staff: [], roster: [] });
  const service = useMemo(() => new PlanningService(planningData), [planningData]);
  const [selectedDate, setSelectedDate] = useState<ISODate>(INITIAL_DATE);
  const [state, setState] = useState<PlanningState>(() => createEmptyState(INITIAL_DATE));
  const dateStates = useRef<Partial<Record<ISODate, PlanningState>>>({});
  const revisions = useRef<Partial<Record<ISODate, number>>>({});
  const mutationQueue = useRef(Promise.resolve());
  const [allowS1Support, setAllowS1Support] = useState(false);
  const [selectedStaffNumber, setSelectedStaffNumber] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [activeModule, setActiveModule] = useState('排工工作台');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [reservedStaff, setReservedStaff] = useState<Set<string>>(new Set());

  const ipcPlanning = typeof window !== 'undefined' ? window.ohlr?.planning : undefined;

  const refreshFromIpc = async (date: ISODate, scenario: 'main' | string = 'main') => {
    if (!ipcPlanning) return false;
    const result = await ipcPlanning.getWorkbench({ date });
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.error.message });
      return false;
    }
    const snapshot = result.data.snapshot;
    revisions.current[date] = snapshot.revision;
    setPlanningData(dataFromSnapshot(snapshot));
    const nextState = stateFromSnapshot({ ...snapshot, selectedScenario: scenario === 'main' ? { kind: 'main' } : { kind: 'scenario', scenarioId: scenario } });
    dateStates.current[date] = nextState;
    setState(nextState);
    return true;
  };

  const enqueueIpcMutation = <T,>(
    build: (expectedRevision: number) => Promise<IpcResult<T>>,
    onSuccess?: (data: T) => void,
  ) => {
    if (!ipcPlanning) return;
    mutationQueue.current = mutationQueue.current.then(async () => {
      const expectedRevision = revisions.current[selectedDate] ?? 0;
      const result = await build(expectedRevision);
      if (!result.ok) {
        setNotice({ tone: result.error.kind === 'domain' ? 'error' : 'warning', text: result.error.message });
        if (result.error.kind === 'conflict') await refreshFromIpc(selectedDate, state.activeScenarioId);
        return;
      }
      revisions.current[selectedDate] = (result.data as PlanningMutationDto).revision ?? expectedRevision;
      onSuccess?.(result.data);
    }).catch((error: unknown) => {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'IPC mutation failed。' });
    });
  };

  useEffect(() => {
    void refreshFromIpc(INITIAL_DATE);
    // Initial IPC hydration is intentionally attempted once; browser review
    // mode keeps the existing in-memory fixture when no preload is present.
  }, []);

  useEffect(() => {
    dateStates.current[selectedDate] = state;
  }, [selectedDate, state]);

  const currentPlan = getCurrentPlan(state);
  const validationOptions: ValidationOptions = { allowS1Support };
  const activeScenarioRef = state.activeScenarioId === 'main'
    ? { kind: 'main' as const }
    : { kind: 'scenario' as const, scenarioId: state.activeScenarioId };
  const report = useMemo(
    () => service.validatePlan(currentPlan, validationOptions),
    [currentPlan, allowS1Support, service],
  );

  const updateCurrentPlan = (update: (plan: NightPlan) => NightPlan) => {
    setState((previous) => {
      if (previous.activeScenarioId === 'main') return { ...previous, main: update(previous.main) };
      return service.updateScenarioPlan(previous, previous.activeScenarioId, update);
    });
  };

  const resetDate = (value: ISODate) => {
    setSelectedDate(value);
    setState((previous) => {
      dateStates.current[selectedDate] = previous;
      const nextState = dateStates.current[value] ?? createEmptyState(value);
      dateStates.current[value] = nextState;
      return nextState;
    });
    setSelectedStaffNumber(null);
    setNotice(null);
    void refreshFromIpc(value);
  };

  const moveDate = (days: number) => {
    const next = parseDate(selectedDate);
    next.setDate(next.getDate() + days);
    resetDate(isoDate(next));
  };

  const assignPerson = (staffNumber: string, workId: string, role: AssignmentRole, locationId?: string) => {
    const active = getCurrentPlan(state);
    const existing = getAssignment(active.assignments, workId, locationId, role);
    const request = { staffNumber, workId, role, locationId, source: 'manual' as const };
    const result = existing
      ? service.replaceAssignment(active, existing.id, request, validationOptions)
      : service.assign(active, request, validationOptions);
    if (!result.accepted) {
      setNotice({ tone: 'error', text: result.report.issues.find((item) => item.blocking)?.message ?? '分配未通過驗證。' });
      return;
    }
    updateCurrentPlan(() => result.plan);
    const assignment = { staffNumber, workId, role, ...(locationId ? { locationId } : {}) };
    if (ipcPlanning) {
      if (existing) {
        enqueueIpcMutation(
          (expectedRevision) => ipcPlanning.replaceAssignment({ date: selectedDate, scenario: activeScenarioRef, expectedRevision, allowS1Support, assignmentId: existing.id, assignment }),
          (data) => setState(stateFromSnapshot(data.snapshot)),
        );
      } else {
        enqueueIpcMutation(
          (expectedRevision) => ipcPlanning.addAssignment({ date: selectedDate, scenario: activeScenarioRef, expectedRevision, allowS1Support, assignment }),
          (data) => setState(stateFromSnapshot(data.snapshot)),
        );
      }
    }
    setSelectedStaffNumber(null);
    setNotice({ tone: 'success', text: '已更新人員分配，資源狀態已自動重算。' });
  };

  const removePerson = (assignmentId: string) => {
    updateCurrentPlan((plan) => service.removeAssignment(plan, assignmentId));
    enqueueIpcMutation(
      (expectedRevision) => ipcPlanning!.removeAssignment({ date: selectedDate, scenario: activeScenarioRef, expectedRevision, allowS1Support, assignmentId }),
      (data) => setState(stateFromSnapshot(data.snapshot)),
    );
    setNotice({ tone: 'warning', text: '已移除分配，請留意相關 Location 的人數警示。' });
  };

  const updateWork = (workId: string, patch: Partial<Work>) => {
    updateCurrentPlan((plan) => ({
      ...plan,
      works: plan.works.map((work) => (work.id === workId ? { ...work, ...patch } : work)),
    }));
    if (ipcPlanning) {
      const { active, projectCode, type, jobDescription, remarks } = patch;
      const workPatch = { active, projectCode, type, jobDescription, remarks };
      const filteredPatch = Object.fromEntries(Object.entries(workPatch).filter(([, value]) => value !== undefined));
      if (Object.keys(filteredPatch).length) {
        enqueueIpcMutation(
          (expectedRevision) => ipcPlanning.updateWork({ date: selectedDate, scenario: activeScenarioRef, expectedRevision, allowS1Support, workId, patch: filteredPatch }),
          (data) => setState(stateFromSnapshot(data.snapshot)),
        );
      }
    }
  };

  const updateLocation = (workId: string, locationId: string, patch: Partial<Location>) => {
    updateCurrentPlan((plan) => ({
      ...plan,
      works: plan.works.map((work) =>
        work.id === workId
          ? { ...work, locations: work.locations.map((location) => (location.id === locationId ? { ...location, ...patch } : location)) }
          : work,
      ),
    }));
    if (ipcPlanning) {
      const { locationName, isolationPoint, earthingPoint, minimumTotalHeadcount, demand } = patch;
      const locationPatch = Object.fromEntries(Object.entries({ locationName, isolationPoint, earthingPoint, minimumTotalHeadcount, demand }).filter(([, value]) => value !== undefined));
      enqueueIpcMutation(
        (expectedRevision) => ipcPlanning.updateLocation({ date: selectedDate, scenario: activeScenarioRef, expectedRevision, allowS1Support, workId, locationId, patch: locationPatch }),
        (data) => setState(stateFromSnapshot(data.snapshot)),
      );
    }
  };

  const addLocation = (work: Work) => {
    const nextSequence = work.locations.length + 1;
    const location = createLocation(`${work.id}:location-${Date.now()}`, nextSequence, {
      locationName: `Location ${nextSequence}`,
      minimumTotalHeadcount: 2,
    });
    updateCurrentPlan((plan) => ({
      ...plan,
      works: plan.works.map((item) => item.id === work.id ? { ...item, locations: [...item.locations, location] } : item),
    }));
    if (ipcPlanning) {
      enqueueIpcMutation(
        (expectedRevision) => ipcPlanning.addLocation({ date: selectedDate, scenario: activeScenarioRef, expectedRevision, allowS1Support, workId: work.id, location }),
        (data) => setState(stateFromSnapshot(data.snapshot)),
      );
    }
    setNotice({ tone: 'success', text: `已新增 Location ${nextSequence}。` });
  };

  const deleteLocation = (work: Work, location: Location) => {
    updateCurrentPlan((plan) => ({
      ...plan,
      works: plan.works.map((item) =>
        item.id === work.id ? { ...item, locations: item.locations.filter((entry) => entry.id !== location.id) } : item,
      ),
      assignments: plan.assignments.filter((assignment) => assignment.locationId !== location.id),
    }));
    if (ipcPlanning) {
      enqueueIpcMutation(
        (expectedRevision) => ipcPlanning.deleteLocation({ date: selectedDate, scenario: activeScenarioRef, expectedRevision, allowS1Support, workId: work.id, locationId: location.id }),
        (data) => setState(stateFromSnapshot(data.snapshot)),
      );
    }
    setNotice({ tone: 'warning', text: `已刪除 ${location.locationName || 'Location'}，相關 AP/CP 分配已移除。` });
  };

  const activateWork = (work: Work) => {
    const location = createLocation(`${work.id}:location-1`, 1, { locationName: '新 Location' });
    updateCurrentPlan((plan) => ({
      ...plan,
      works: plan.works.map((item) => item.id === work.id ? { ...item, active: true, projectCode: '', locations: [location] } : item),
    }));
    if (ipcPlanning) {
      enqueueIpcMutation(
        (expectedRevision) => ipcPlanning.updateWork({ date: selectedDate, scenario: activeScenarioRef, expectedRevision, allowS1Support, workId: work.id, patch: { active: true, projectCode: '' } }),
        (data) => setState(stateFromSnapshot(data.snapshot)),
      );
      enqueueIpcMutation(
        (expectedRevision) => ipcPlanning.addLocation({ date: selectedDate, scenario: activeScenarioRef, expectedRevision, allowS1Support, workId: work.id, location }),
        (data) => setState(stateFromSnapshot(data.snapshot)),
      );
    }
    setNotice({ tone: 'success', text: `已啟用 Work ${work.slot}，請輸入 Project Code。` });
  };

  const addWork = () => {
    const next = currentPlan.works.find((work) => !work.active);
    if (!next) {
      setNotice({ tone: 'warning', text: '每晚最多安排 5 個 Work。請先調整現有 Work。' });
      return;
    }
    activateWork(next);
  };

  const createScenario = () => {
    const nextLetter = ['A', 'B', 'C'].find(
      (letter) => !state.scenarios.some((scenario) => scenario.name === `測試方案 ${letter}`),
    );
    if (!nextLetter) return;
    const scenarioId = `scenario-${nextLetter.toLowerCase()}`;
    setState((previous) => service.createScenario(previous, scenarioId, `測試方案 ${nextLetter}`, 'main'));
    if (ipcPlanning) {
      enqueueIpcMutation(
        (expectedRevision) => ipcPlanning.createScenario({ date: selectedDate, scenario: activeScenarioRef, expectedRevision, allowS1Support, scenarioId, name: `測試方案 ${nextLetter}`, sourceScenario: { kind: 'main' }, temporary: true }),
        (data) => setState(stateFromSnapshot(data.snapshot)),
      );
    }
    setNotice({ tone: 'success', text: `已建立${`測試方案 ${nextLetter}`}，尚未套用至主要方案。` });
  };

  const deleteScenario = (scenarioId: string) => {
    setState((previous) => service.deleteScenario(previous, scenarioId));
    if (ipcPlanning) {
      enqueueIpcMutation(
        (expectedRevision) => ipcPlanning.deleteScenario({ date: selectedDate, scenario: activeScenarioRef, expectedRevision, allowS1Support, scenarioId }),
        (data) => setState(stateFromSnapshot(data.snapshot)),
      );
    }
    setNotice({ tone: 'warning', text: '測試方案已刪除，主要方案沒有變更。' });
  };

  const renameScenario = (scenarioId: string) => {
    const scenario = state.scenarios.find((item) => item.id === scenarioId);
    const nextName = window.prompt('重新命名測試方案', scenario?.name ?? '測試方案');
    if (!nextName?.trim()) return;
    const name = nextName.trim();
    setState((previous) => service.renameScenario(previous, scenarioId, name));
    if (ipcPlanning) {
      enqueueIpcMutation(
        (expectedRevision) => ipcPlanning.renameScenario({ date: selectedDate, scenario: activeScenarioRef, expectedRevision, allowS1Support, scenarioId, name }),
        (data) => setState(stateFromSnapshot(data.snapshot)),
      );
    }
  };

  const saveScenario = () => {
    if (state.activeScenarioId === 'main') {
      setNotice({ tone: 'warning', text: '主要方案會即時保留，不需要暫存測試。' });
      return;
    }
    setSavedAt(new Date().toLocaleTimeString('zh-Hant-HK', { hour: '2-digit', minute: '2-digit' }));
    if (ipcPlanning && state.activeScenarioId !== 'main') {
      enqueueIpcMutation(
        (expectedRevision) => ipcPlanning.saveScenario({ date: selectedDate, scenario: activeScenarioRef, expectedRevision, allowS1Support, scenarioId: state.activeScenarioId }),
        (data) => setState(stateFromSnapshot(data.snapshot)),
      );
    }
    setNotice({ tone: 'success', text: '測試方案已暫存於本機工作階段。' });
  };

  const applyScenario = () => {
    if (state.activeScenarioId === 'main') return;
    const scenarioName = state.scenarios.find((item) => item.id === state.activeScenarioId)?.name ?? '測試方案';
    setState((previous) => service.applyScenario(previous, previous.activeScenarioId));
    if (ipcPlanning) {
      enqueueIpcMutation(
        (expectedRevision) => ipcPlanning.applyScenario({ date: selectedDate, scenario: activeScenarioRef, expectedRevision, allowS1Support, scenarioId: state.activeScenarioId }),
        (data) => setState(stateFromSnapshot(data.snapshot)),
      );
    }
    setNotice({ tone: 'success', text: `${scenarioName} 已明確套用至主要方案。` });
  };

  const handleDrop = (event: React.DragEvent, workId: string, role: AssignmentRole, locationId?: string) => {
    event.preventDefault();
    const staffNumber = event.dataTransfer.getData('application/x-ohlr-person');
    if (staffNumber) assignPerson(staffNumber, workId, role, locationId);
  };

  const weekDays = useMemo(() => {
    const start = sundayStart(selectedDate);
    return WEEKDAY_LABELS.map((label, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const value = isoDate(date);
      const dayPlan = value === selectedDate ? currentPlan : null;
      const activeWorkCount = dayPlan?.works.filter((work) => work.active).length;
      return { label, value, date: date.getDate(), activeWorkCount };
    });
  }, [selectedDate, currentPlan]);

  return (
    <div className="app-frame">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark">OHLR</div>
          <div>
            <strong>OHLR-DUAT Planning Tool</strong>
            <span>夜間工程排工工作台</span>
          </div>
        </div>
        <div className="date-toolbar" aria-label="日期控制">
          <Tooltip content="上一日" relationship="label">
            <Button appearance="subtle" icon={<ChevronLeft20Regular />} onClick={() => moveDate(-1)} aria-label="上一日" />
          </Tooltip>
          <Field label="選擇日期" className="date-field">
            <Input type="date" value={selectedDate} onChange={(_, data) => resetDate(data.value)} contentBefore={<CalendarLtr20Regular />} />
          </Field>
          <Tooltip content="下一日" relationship="label">
            <Button appearance="subtle" icon={<ChevronRight20Regular />} onClick={() => moveDate(1)} aria-label="下一日" />
          </Tooltip>
          <Button appearance="secondary" onClick={() => resetDate(INITIAL_DATE)}>本週</Button>
        </div>
        <div className="week-meta">
          <strong>{parseDate(selectedDate).getFullYear()} 年第 {weekNumber(selectedDate)} 週</strong>
          <span>{dateRangeLabel(selectedDate)}</span>
        </div>
      </header>

      <div className="app-body">
        <nav className="side-nav" aria-label="模組導覽">
          <div className="side-nav-label">WORKSPACE</div>
          {[
            ['排工工作台', <PeopleTeam20Regular />],
            ['Projects', <DocumentBulletList20Regular />],
            ['人員與資格', <PeopleTeam20Regular />],
            ['Roster', <CalendarLtr20Regular />],
            ['Booking Rules', <Settings20Regular />],
          ].map(([label, icon]) => (
            <button
              type="button"
              className={`side-nav-item ${activeModule === label ? 'active' : ''}`}
              key={label as string}
              onClick={() => setActiveModule(label as string)}
            >
              <span className="nav-icon">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
          <div className="side-nav-label lower">DATA</div>
          {['資料匯入', '報告與備份'].map((label) => (
            <button type="button" className={`side-nav-item ${activeModule === label ? 'active' : ''}`} key={label} onClick={() => setActiveModule(label)}>
              <span className="nav-icon"><ArrowSync20Regular /></span>
              <span>{label}</span>
            </button>
          ))}
          <div className="side-nav-footer">offline<br />local workspace</div>
        </nav>

        <section className="workspace">
          <div className="week-strip" aria-label="星期日至星期六週覽">
            {weekDays.map((day) => (
              <button
                type="button"
                key={day.value}
                className={`day-tile ${day.value === selectedDate ? 'selected' : ''} ${day.activeWorkCount === 0 ? 'rest' : ''}`}
                onClick={() => resetDate(day.value)}
              >
                <span className="day-top"><strong>{day.label}</strong><small>{day.date}</small><em>{day.value === selectedDate ? (day.activeWorkCount ? `${day.activeWorkCount} Work` : '未安排') : '未載入'}</em></span>
                <span className="day-code">{day.value === selectedDate ? currentPlan.works.filter((work) => work.active).map((work) => work.projectCode || '未輸入').join(' + ') || '未安排' : '選取日期以載入'}</span>
              </button>
            ))}
          </div>

          <div className="scenario-bar">
            <div className="selected-night">
              <div>
                <strong>{selectedDate} 夜間工作安排</strong>
                <span>S2、S4、S5 夜更，S1 可選支援</span>
              </div>
              <Badge appearance="outline">已安排 {currentPlan.works.filter((work) => work.active).length} / 5 個 Work</Badge>
            </div>
            <div className="scenario-tabs" role="tablist" aria-label="Scenarios">
              <button type="button" className={`scenario-tab ${state.activeScenarioId === 'main' ? 'active' : ''}`} onClick={() => setState((previous) => service.switchScenario(previous, 'main'))}>主要方案</button>
              {state.scenarios.map((scenario) => (
                <div className={`scenario-tab-wrap ${state.activeScenarioId === scenario.id ? 'active' : ''}`} key={scenario.id}>
                  <button type="button" className="scenario-tab" onDoubleClick={() => renameScenario(scenario.id)} onClick={() => setState((previous) => service.switchScenario(previous, scenario.id))}>{scenario.name}</button>
                  <Tooltip content={`${scenario.name} 刪除`} relationship="label">
                    <button type="button" className="scenario-delete" aria-label={`${scenario.name} 刪除`} onClick={() => deleteScenario(scenario.id)}><Dismiss20Regular /></button>
                  </Tooltip>
                </div>
              ))}
              <Button appearance="subtle" icon={<Add20Regular />} onClick={createScenario} disabled={state.scenarios.length >= 3}>新增測試方案</Button>
            </div>
            <div className="scenario-actions">
              <Button appearance="secondary" icon={<Add20Regular />} onClick={addWork}>新增 Work</Button>
              <span className={`auto-status ${report.issues.length ? 'bad' : 'good'}`}><span className="status-dot" />{report.issues.length ? `自動檢查 · ${report.issues.length} 項待處理` : '自動檢查 · 可行'}</span>
              {state.activeScenarioId !== 'main' && <span className="temporary-label">暫存測試{savedAt ? ` ${savedAt}` : ''}</span>}
              {state.activeScenarioId !== 'main' && <Button appearance="secondary" className="temporary-save-button" icon={<Save20Regular />} onClick={saveScenario}>暫存此方案</Button>}
              {state.activeScenarioId !== 'main' && <Button appearance="primary" onClick={applyScenario}>Apply Scenario</Button>}
            </div>
          </div>

          {notice && (
            <MessageBar className="notice-bar" intent={notice.tone === 'error' ? 'error' : notice.tone === 'warning' ? 'warning' : 'success'}>
              <MessageBarBody>{notice.text}</MessageBarBody>
              <Button appearance="transparent" icon={<Dismiss20Regular />} onClick={() => setNotice(null)} aria-label="關閉提示" />
            </MessageBar>
          )}

          {activeModule === '資料匯入' ? <ImportWorkbench date={selectedDate} expectedRevision={revisions.current[selectedDate] ?? 0} onNotice={(tone, text) => setNotice({ tone, text })} onSnapshot={(snapshot) => { revisions.current[selectedDate] = snapshot.revision; setPlanningData(dataFromSnapshot(snapshot)); setState(stateFromSnapshot(snapshot)); }} /> : activeModule === '排工工作台' ? <div className="planning-layout">
            <main className="work-area" aria-label="Work 排工區">
              <div className="work-columns">
                {currentPlan.works.filter((work, index, works) => work.active || index === works.findIndex((item) => !item.active)).map((work) => (
                  <WorkCard
                    key={work.id}
                    work={work}
                    staff={planningData.staff}
                    assignments={currentPlan.assignments}
                    issues={report.issues}
                    onWorkChange={updateWork}
                    onLocationChange={updateLocation}
                    onLocationAdd={addLocation}
                    onLocationDelete={deleteLocation}
                    onActivate={activateWork}
                    onAssign={assignPerson}
                    onRemove={removePerson}
                    onDrop={handleDrop}
                    selectedStaffNumber={selectedStaffNumber}
                  />
                ))}
              </div>
            </main>

            <aside className="people-sidebar" aria-label="當晚可用人員">
              <div className="people-header">
                <div className="people-title"><PeopleTeam20Regular /><strong>當晚可用人員</strong><Badge appearance="tint">{planningData.staff.length}</Badge></div>
                <div className="capacity-summary" aria-label="當晚人力統計">
                  <span><strong>{planningData.staff.filter((person) => isRosterAvailable(service.getRosterEntry(selectedDate, person.staffNumber)?.status)).length}</strong> 可用</span>
                  <span><strong>{planningData.staff.filter((person) => person.qualifications?.length).length}</strong> 合資格</span>
                  <span><strong>{new Set(currentPlan.assignments.map((assignment) => assignment.staffNumber)).size}</strong> 已派</span>
                  <span><strong>{reservedStaff.size}</strong> 保留</span>
                  <span><strong>{Math.max(0, planningData.staff.filter((person) => isRosterAvailable(service.getRosterEntry(selectedDate, person.staffNumber)?.status)).length - new Set(currentPlan.assignments.map((assignment) => assignment.staffNumber)).size - reservedStaff.size)}</strong> 剩餘</span>
                </div>
                <span>拖放到 AP / CP 或一般員工 row</span>
                <Input size="small" value={search} onChange={(_, data) => setSearch(data.value)} contentBefore={<Search20Regular />} placeholder="搜尋姓名或 staff no." aria-label="搜尋人員" />
                <Switch checked={allowS1Support} onChange={(_, data) => setAllowS1Support(data.checked)} label="啟用 S1 支援" />
              </div>
              <div className="people-scroll">
                {!planningData.staff.length && <div className="empty-people"><strong>尚未匯入人員</strong><span>先匯入 Formation、Qualification，再匯入當月 Roster，這裡才會列出可排工人員。</span><Button appearance="primary" icon={<ArrowSync20Regular />} onClick={() => setActiveModule('資料匯入')}>前往資料匯入</Button></div>}
                {TEAM_ORDER.map((team) => {
                  const members = planningData.staff.filter((person) => person.team === team && `${person.name} ${person.staffNumber}`.toLowerCase().includes(search.toLowerCase()));
                  if (!members.length) return null;
                  return (
                    <section className={`team-group ${team === 'S1' ? 'support-team' : ''}`} key={team}>
                      <div className="team-heading"><strong>{team} {team === 'S1' ? '支援隊' : '主工作隊'}</strong><span>{members.length} 人</span></div>
                      {members.map((person) => {
                        const roster = service.getRosterEntry(selectedDate, person.staffNumber);
                        const assignmentState = staffForAssignment(currentPlan.assignments, person.staffNumber);
                        const isS1Locked = person.team === 'S1' && !allowS1Support;
                        const isSelected = selectedStaffNumber === person.staffNumber;
                        const availability = availabilityLabel(roster?.status);
                        const assignmentLabel = assignmentState
                          ? `已派 W${currentPlan.works.find((work) => work.id === assignmentState.workId)?.slot}`
                          : '';
                        const qualifications = ['AP', 'CP(P)', 'CP(T)'].filter((type) => service.isQualificationValid(person.staffNumber, type as 'AP' | 'CP(P)' | 'CP(T)', selectedDate));
                        const hasExpired = person.qualifications?.some((item) => ['AP', 'CP(P)', 'CP(T)'].includes(item.type) && item.expiryDate < selectedDate);
                        return (
                          <div className={`person-row-wrap ${reservedStaff.has(person.staffNumber) ? 'reserved' : ''}`} key={person.staffNumber}>
                          <button
                            type="button"
                            className={`person-row ${statusClass(roster?.status)} ${isSelected ? 'selected' : ''} ${isS1Locked || !isRosterAvailable(roster?.status) ? 'locked' : ''}`}
                            draggable={!isS1Locked && isRosterAvailable(roster?.status)}
                            onClick={() => setSelectedStaffNumber(isSelected ? null : person.staffNumber)}
                            onDragStart={(event) => event.dataTransfer.setData('application/x-ohlr-person', person.staffNumber)}
                            aria-label={`${person.name} ${person.team} ${availability}${assignmentLabel ? ` · ${assignmentLabel}` : ''}`}
                          >
                            <span className="person-main"><strong>{person.name}</strong><small>{person.staffNumber}</small></span>
                            <span className="person-meta"><span className="qualification-badges">{person.isGeneralEmployee ? <Badge appearance="tint">一般員工</Badge> : qualifications.map((item) => <Badge key={item} appearance="tint" color={item === 'AP' ? 'success' : item === 'CP(T)' ? 'informative' : 'warning'}>{item}</Badge>)}{hasExpired && <Badge appearance="tint" color="danger">資格過期</Badge>}</span><span className={`availability ${statusClass(roster?.status)}`}>{availability}{assignmentLabel ? ` · ${assignmentLabel}` : ''}</span></span>
                          </button>
                          <Button appearance="subtle" size="small" onClick={() => setReservedStaff((current) => { const next = new Set(current); if (next.has(person.staffNumber)) next.delete(person.staffNumber); else next.add(person.staffNumber); return next; })}>{reservedStaff.has(person.staffNumber) ? '取消保留' : '保留'}</Button>
                          </div>
                        );
                      })}
                    </section>
                  );
                })}
              </div>
            </aside>
          </div> : <ModulePage module={activeModule} date={selectedDate} planningData={planningData} plan={currentPlan} reservedStaff={reservedStaff} />}
        </section>
      </div>
      <footer className="status-footer"><span><span className="status-dot green" />Local data only</span><span>Roster: {selectedDate}</span><span>Formation {planningData.staff.length} · Qualification {planningData.qualifications?.length ?? 0}</span></footer>
    </div>
  );
}

interface ModulePageProps {
  module: string;
  date: ISODate;
  planningData: PlanningData;
  plan: NightPlan;
  reservedStaff: Set<string>;
}

function ModulePage({ module, date, planningData, plan, reservedStaff }: ModulePageProps) {
  const activeWorks = plan.works.filter((work) => work.active);
  const assigned = new Set(plan.assignments.map((assignment) => assignment.staffNumber));
  const roster = planningData.roster ?? [];
  const qualificationRows = planningData.qualifications ?? planningData.staff.flatMap((staff) => (staff.qualifications ?? []).map((qualification) => ({ ...qualification, staffNumber: staff.staffNumber })));
  const title = module === 'Projects' ? 'Projects' : module === '人員與資格' ? '人員與資格' : module === 'Roster' ? 'Roster' : module === 'Booking Rules' ? 'Booking Rules' : module === '報告與備份' ? '報告與備份' : module;
  return (
    <section className="module-page" aria-label={title}>
      <div className="module-heading"><div><span className="section-kicker">WORKSPACE / {module.toUpperCase()}</span><h2>{title}</h2><p>{date} 的本機 projection 與可追溯資料。</p></div><Badge appearance="tint">Local snapshot</Badge></div>
      {module === 'Projects' && <>
        <div className="module-summary"><strong>{activeWorks.length}</strong><span>當晚已啟用 Work</span><strong>{activeWorks.reduce((total, work) => total + work.locations.length, 0)}</strong><span>Locations</span></div>
        <div className="module-table"><div className="module-row module-row-head"><span>Work</span><span>Project Code</span><span>Type</span><span>Job Description</span><span>Remarks</span></div>{activeWorks.map((work) => <div className="module-row" key={work.id}><strong>Work {work.slot}</strong><span>{work.projectCode || '未輸入'}</span><span>{work.type}</span><span>{work.jobDescription || '未輸入'}</span><span>{work.remarks || '未輸入'}</span></div>)}</div>
      </>}
      {module === '人員與資格' && <div className="module-table"><div className="module-row module-row-head"><span>Staff No.</span><span>姓名</span><span>Team</span><span>資格</span><span>Expiry</span></div>{planningData.staff.map((staff) => <div className="module-row" key={staff.staffNumber}><strong>{staff.staffNumber}</strong><span>{staff.name}</span><span>{staff.team}</span><span>{(staff.qualifications ?? []).map((item) => item.type).join(', ') || (staff.isGeneralEmployee ? '一般員工' : '未匯入')}</span><span>{(staff.qualifications ?? []).map((item) => item.expiryDate).join(', ') || '-'}</span></div>)}</div>}
      {module === 'Roster' && <div className="module-table"><div className="module-row module-row-head"><span>Staff No.</span><span>日期</span><span>狀態</span><span>原因 / raw value</span><span>供應</span></div>{planningData.staff.map((staff) => { const entry = roster.find((item) => item.staffNumber === staff.staffNumber && item.date === date); const available = entry?.status === 'available' || entry?.status === 'night-duty'; return <div className="module-row" key={staff.staffNumber}><strong>{staff.staffNumber}</strong><span>{date}</span><span>{availabilityLabel(entry?.status)}</span><span>{entry?.reason || '未提供 override'}</span><span className={available ? 'ok-text' : 'missing-label'}>{available ? '可供排工' : entry?.status === undefined ? 'unknown' : '不可用'}</span></div>; })}</div>}
      {module === 'Booking Rules' && <div className="rule-list"><div className="rule-item"><strong>Isolation / Earthing</strong><span>AP required；CP(P) 或 CP(T) 均可</span><Badge appearance="tint">policy v1</Badge></div><div className="rule-item"><strong>Possession</strong><span>CP(P) required</span><Badge appearance="tint">active</Badge></div><div className="rule-item"><strong>PA Work</strong><span>CP(P) 或 CP(T)</span><Badge appearance="tint">active</Badge></div><div className="rule-item"><strong>NP</strong><span>預設 optional，只有模板或 Planner 啟用後 required</span><Badge appearance="tint">configurable</Badge></div><div className="rule-item"><strong>SPC</strong><span>無資格 predicate；當晚可用、同 Job 最多 overlay 一個，並支援另一 AP</span><Badge appearance="tint">active</Badge></div></div>}
      {module === '報告與備份' && <><div className="module-summary"><strong>{planningData.staff.filter((staff) => roster.some((entry) => entry.staffNumber === staff.staffNumber && (entry.status === 'available' || entry.status === 'night-duty'))).length}</strong><span>可用</span><strong>{qualificationRows.length}</strong><span>資格 rows</span><strong>{assigned.size}</strong><span>已派</span><strong>{reservedStaff.size}</strong><span>保留</span></div><div className="empty-module"><strong>備份與匯出</strong><p>事件資料由 Electron main process 管理。尚未建立可下載的報告檔時，這裡會清楚顯示空狀態，不會產生假檔案。</p></div></>}
    </section>
  );
}

interface WorkCardProps {
  work: Work;
  staff: readonly Staff[];
  assignments: readonly Assignment[];
  issues: readonly ValidationIssue[];
  selectedStaffNumber: string | null;
  onWorkChange: (workId: string, patch: Partial<Work>) => void;
  onLocationChange: (workId: string, locationId: string, patch: Partial<Location>) => void;
  onLocationAdd: (work: Work) => void;
  onLocationDelete: (work: Work, location: Location) => void;
  onActivate: (work: Work) => void;
  onAssign: (staffNumber: string, workId: string, role: AssignmentRole, locationId?: string) => void;
  onRemove: (assignmentId: string) => void;
  onDrop: (event: React.DragEvent, workId: string, role: AssignmentRole, locationId?: string) => void;
}

function WorkCard({
  work,
  staff,
  assignments,
  issues,
  selectedStaffNumber,
  onWorkChange,
  onLocationChange,
  onLocationAdd,
  onLocationDelete,
  onActivate,
  onAssign,
  onRemove,
  onDrop,
}: WorkCardProps) {
  const locationCount = work.locations.length;
  const relevantIssues = issues.filter((issue) => issue.workId === work.id);
  const firstIssue = relevantIssues.find((issue) => issue.severity === 'warning' || issue.severity === 'error');
  const generalAssignments = assignments.filter((assignment) => assignment.workId === work.id && assignment.role === '一般員工');
  const minimumPeople = work.locations.reduce((total, location) => total + location.minimumTotalHeadcount, 0);
  const assignedPeople = assignments.filter((assignment) => assignment.workId === work.id).length;
  const generalNeeded = Math.max(0, minimumPeople - assignments.filter((assignment) => assignment.workId === work.id && assignment.role !== '一般員工').length);

  if (!work.active) {
    return (
      <article className="work-card inactive-work" data-testid={`work-${work.slot}`}>
        <div className="work-header">
          <div><span className="work-eyebrow">WORK {work.slot}</span><Input className="project-input" value={work.projectCode} onChange={(_, data) => onWorkChange(work.id, { projectCode: data.value })} aria-label={`Work ${work.slot} Project Code`} /></div>
          <div className="segmented-control"><Button disabled>Possession</Button><Button disabled>PA Work</Button></div>
        </div>
        <div className="inactive-content"><strong>本晚未安排 Work {work.slot}</strong><span>此欄保留，方便加入另一個 Possession 或 PA Work。</span><Button icon={<Add20Regular />} onClick={() => onActivate(work)}>安排 Work {work.slot}</Button></div>
      </article>
    );
  }

  return (
    <article className={`work-card ${firstIssue ? 'has-error' : ''}`} data-testid={`work-${work.slot}`}>
      <div className="work-header">
        <div className="work-code-block"><span className="work-eyebrow">WORK {work.slot} · PROJECT CODE</span><Input className="project-input" value={work.projectCode} onChange={(_, data) => onWorkChange(work.id, { projectCode: data.value })} aria-label={`Work ${work.slot} Project Code`} /></div>
        <div className="segmented-control" role="group" aria-label={`Work ${work.slot} 類型`}>
          <Button appearance={work.type === 'Possession' ? 'primary' : 'secondary'} onClick={() => onWorkChange(work.id, { type: 'Possession' })}>Possession</Button>
          <Button appearance={work.type === 'PA Work' ? 'primary' : 'secondary'} onClick={() => onWorkChange(work.id, { type: 'PA Work' })}>PA Work</Button>
        </div>
      </div>

      <div className="work-content">
        <Field label="Job Description"><Textarea resize="vertical" value={work.jobDescription} onChange={(_, data) => onWorkChange(work.id, { jobDescription: data.value })} /></Field>
        <div className="location-section">
          <div className="section-summary"><strong>{locationCount} 個 Location</strong><span>每個 Location 預設 1 AP + 1 {work.type === 'Possession' ? 'CP(P)' : 'CP(P) / CP(T)'}</span></div>
          <div className="location-list">
            {work.locations.map((location) => (
              <LocationRow
                key={location.id}
                work={work}
                location={location}
                staff={staff}
                assignments={assignments}
                issues={issues}
                selectedStaffNumber={selectedStaffNumber}
                onLocationChange={onLocationChange}
                onDelete={onLocationDelete}
                onAssign={onAssign}
                onRemove={onRemove}
                onDrop={onDrop}
              />
            ))}
            <Button appearance="subtle" icon={<Add20Regular />} onClick={() => onLocationAdd(work)}>新增 Location</Button>
          </div>
        </div>

        <div
          className={`general-row ${issueFor(issues, work.id, undefined, '一般員工') ? 'row-error' : ''} ${selectedStaffNumber ? 'can-drop' : ''}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => onDrop(event, work.id, '一般員工')}
          onClick={() => selectedStaffNumber && onAssign(selectedStaffNumber, work.id, '一般員工')}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (selectedStaffNumber && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              onAssign(selectedStaffNumber, work.id, '一般員工');
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={`Work ${work.slot} 一般員工分配區`}
          data-testid={`work-${work.slot}-general`}
        >
          <div className="general-heading"><strong>一般員工</strong><span>Work 層級分配</span><Badge appearance="outline">已派 {generalAssignments.length} / 建議 {generalNeeded}</Badge></div>
          <div className="crew-chips">
            {generalAssignments.map((assignment) => {
              const person = staffForNumber(staff, assignment.staffNumber);
              return <button type="button" className="crew-chip" key={assignment.id} onClick={(event) => { event.stopPropagation(); onRemove(assignment.id); }} title="移除一般員工分配">{person?.name ?? assignment.staffNumber}<Dismiss20Regular /></button>;
            })}
            {!generalAssignments.length && <span className="empty-drop">拖放一般員工到此處</span>}
          </div>
        </div>

        <div className={`resource-message ${firstIssue ? 'bad' : 'good'}`}>
          {firstIssue ? <><Warning20Filled />{firstIssue.message}</> : <><CheckmarkCircle20Filled />資源檢查通過，可繼續調整。</>}
        </div>
        <Field label="Remarks"><Textarea resize="vertical" value={work.remarks} onChange={(_, data) => onWorkChange(work.id, { remarks: data.value })} /></Field>
        <div className="work-foot"><span>{assignedPeople} 人已分配</span><span>{minimumPeople} 人最低需求</span>{relevantIssues.length > 0 && <span className="issue-count">{relevantIssues.length} 項警示</span>}</div>
      </div>
    </article>
  );
}

interface LocationRowProps {
  work: Work;
  location: Location;
  staff: readonly Staff[];
  assignments: readonly Assignment[];
  issues: readonly ValidationIssue[];
  selectedStaffNumber: string | null;
  onLocationChange: (workId: string, locationId: string, patch: Partial<Location>) => void;
  onDelete: (work: Work, location: Location) => void;
  onAssign: (staffNumber: string, workId: string, role: AssignmentRole, locationId?: string) => void;
  onRemove: (assignmentId: string) => void;
  onDrop: (event: React.DragEvent, workId: string, role: AssignmentRole, locationId?: string) => void;
}

function LocationRow({
  work,
  location,
  staff,
  assignments,
  issues,
  selectedStaffNumber,
  onLocationChange,
  onDelete,
  onAssign,
  onRemove,
  onDrop,
}: LocationRowProps) {
  const apAssignment = getAssignment(assignments, work.id, location.id, 'AP');
  const cpAssignment = getAssignment(assignments, work.id, location.id, 'CP');
  const apIssue = issueFor(issues, work.id, location.id, 'AP');
  const cpIssue = issueFor(issues, work.id, location.id, 'CP');
  const personLabel = (assignment: Assignment | undefined) => {
    if (!assignment) return null;
    const person = staffForNumber(staff, assignment.staffNumber);
    return person ? `${person.name} · ${person.team}` : assignment.staffNumber;
  };

  return (
    <div className={`location-row ${apIssue || cpIssue ? 'has-error' : ''}`} data-testid={`location-${location.id}`}>
      <div className="location-heading">
        <Input value={location.locationName} onChange={(_, data) => onLocationChange(work.id, location.id, { locationName: data.value })} aria-label="Location Name" />
        <Button appearance="subtle" icon={<Delete20Regular />} onClick={() => onDelete(work, location)} aria-label={`${location.locationName || 'Location'} 刪除`} />
      </div>
      <div className="point-grid">
        <Field label="Isolation Point"><Input value={location.isolationPoint} onChange={(_, data) => onLocationChange(work.id, location.id, { isolationPoint: data.value })} /></Field>
        <Field label="Earthing Point"><Input value={location.earthingPoint} onChange={(_, data) => onLocationChange(work.id, location.id, { earthingPoint: data.value })} /></Field>
        <Field label="最低總人數"><Input type="number" min={2} value={String(location.minimumTotalHeadcount)} onChange={(_, data) => onLocationChange(work.id, location.id, { minimumTotalHeadcount: Math.max(2, Number(data.value) || 2) })} /></Field>
      </div>
      <AssignmentRow
        role="AP"
        label="AP"
        assignment={apAssignment}
        personLabel={personLabel(apAssignment)}
        issue={apIssue}
        requirement="需要有效 AP"
        selectedStaffNumber={selectedStaffNumber}
        onAssign={(staffNumber) => onAssign(staffNumber, work.id, 'AP', location.id)}
        onRemove={onRemove}
        onDrop={(event) => onDrop(event, work.id, 'AP', location.id)}
      />
      <AssignmentRow
        role="CP"
        label="CP"
        assignment={cpAssignment}
        personLabel={personLabel(cpAssignment)}
        issue={cpIssue}
        requirement={work.type === 'Possession' ? '需要 CP(P)' : 'CP(T) 優先，接受 CP(P)'}
        selectedStaffNumber={selectedStaffNumber}
        onAssign={(staffNumber) => onAssign(staffNumber, work.id, 'CP', location.id)}
        onRemove={onRemove}
        onDrop={(event) => onDrop(event, work.id, 'CP', location.id)}
        qualificationUsed={cpAssignment?.qualificationUsed}
      />
    </div>
  );
}

interface AssignmentRowProps {
  role: 'AP' | 'CP';
  label: string;
  assignment?: Assignment;
  personLabel: string | null;
  issue?: ValidationIssue;
  requirement: string;
  selectedStaffNumber: string | null;
  qualificationUsed?: string;
  onAssign: (staffNumber: string) => void;
  onRemove: (assignmentId: string) => void;
  onDrop: (event: React.DragEvent) => void;
}

function AssignmentRow({
  label,
  assignment,
  personLabel,
  issue,
  requirement,
  selectedStaffNumber,
  qualificationUsed,
  onAssign,
  onRemove,
  onDrop,
}: AssignmentRowProps) {
  return (
    <div
      className={`assignment-row ${issue ? 'row-error' : ''} ${selectedStaffNumber ? 'can-drop' : ''}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      onClick={() => selectedStaffNumber && onAssign(selectedStaffNumber)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (selectedStaffNumber && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onAssign(selectedStaffNumber);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${label} 分配區，${requirement}`}
    >
      <span className="role-label">{label}</span>
      <span className="assignment-target">
        {assignment ? <><strong>{personLabel}</strong><span className="assignment-qual">{qualificationUsed ?? label}<button type="button" onClick={(event) => { event.stopPropagation(); onRemove(assignment.id); }} aria-label={`${personLabel} 移除分配`}><Dismiss20Regular /></button></span></> : <><strong>未獲派</strong><span className="missing-label">{issue?.message ?? requirement}</span></>}
      </span>
    </div>
  );
}

export default App;
