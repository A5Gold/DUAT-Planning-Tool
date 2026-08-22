import { app, BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { createSqliteDatabase } from '../src/adapters/sqlite';
import { createEventDatabase } from '../src/adapters/sqlite/eventDatabase';
import { SQLiteEventStore } from '../src/adapters/sqlite/eventStore';
import { createMainIpcRuntime, registerIpcHandlers } from './ipc';
import { bootstrapReferenceData, referenceBootstrapPaths } from '../src/application/import';

let mainWindow: BrowserWindow | null = null;
let database: ReturnType<typeof createSqliteDatabase> | null = null;
let eventDatabase: ReturnType<typeof createEventDatabase> | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 930,
    minHeight: 680,
    backgroundColor: '#e9edf1',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  const dataRoot = app.isPackaged
    ? join(dirname(process.execPath), 'data')
    : join(app.getPath('userData'), 'data');
  // The reconstruction starts from a new event store. The legacy adapter DB is
  // an empty compatibility read model and is never seeded from old test data.
  eventDatabase = createEventDatabase(join(dataRoot, 'manpower-planner.events.sqlite'));
  const eventStore = new SQLiteEventStore(eventDatabase);
  if (eventStore.readAll().length === 0) {
    eventStore.append({
      aggregateType: 'Actor',
      aggregateId: 'planner-local',
      eventType: 'LocalActorProfileCreated',
      schemaVersion: 1,
      expectedSequence: 0,
      idempotencyKey: 'bootstrap:local-actor:planner-local',
      effectiveAt: new Date().toISOString(),
      actor: { id: 'planner-local', role: 'Planner' },
      source: 'first-launch',
      payload: { actorId: 'planner-local', role: 'Planner' },
    });
  }
  database = createSqliteDatabase(join(dataRoot, 'manpower-planner.read.sqlite'));
  if (!app.isPackaged) {
    const staffCount = (database.prepare("SELECT COUNT(*) AS count FROM staff").get() as { count: number }).count;
    if (staffCount === 0) {
      try {
        const bootstrap = await bootstrapReferenceData(database, referenceBootstrapPaths(process.cwd()));
        eventStore.append({
          aggregateType: 'ReferenceData',
          aggregateId: 'development-reference-workbooks',
          eventType: 'ReferenceDataBootstrapped',
          schemaVersion: 1,
          expectedSequence: eventStore.head('ReferenceData', 'development-reference-workbooks').sequence,
          idempotencyKey: `reference-bootstrap:${bootstrap.rosterRows}:${bootstrap.qualificationRows}:${bootstrap.jobRoleRows}`,
          effectiveAt: new Date().toISOString(),
          actor: { id: 'planner-local', role: 'Planner' },
          source: 'development-reference-workbooks',
          payload: { ...bootstrap, sourceRoot: process.cwd() },
        });
        console.info('reference-data-bootstrap-complete', bootstrap);
      } catch (error) {
        console.error('reference-data-bootstrap-failed', error);
      }
    }
  }
  const runtime = createMainIpcRuntime(database);
  registerIpcHandlers(runtime);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  database?.close();
  database = null;
  eventDatabase?.close();
  eventDatabase = null;
});
