import { app, BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { createSqliteDatabase, SqlitePlanningRepository } from '../src/adapters/sqlite';
import { createMockState, mockPlanningData } from '../src/data/mockData';
import { createMainIpcRuntime, registerIpcHandlers } from './ipc';

let mainWindow: BrowserWindow | null = null;
let database: ReturnType<typeof createSqliteDatabase> | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 930,
    minHeight: 680,
    backgroundColor: '#e9edf1',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
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

app.whenReady().then(() => {
  const dataRoot = app.isPackaged
    ? join(dirname(process.execPath), 'data')
    : join(app.getPath('userData'), 'data');
  database = createSqliteDatabase(join(dataRoot, 'ohlr-duat.sqlite'));
  const repository = new SqlitePlanningRepository(database);
  if (repository.getStaff().length === 0) repository.savePlanningData(mockPlanningData);
  const runtime = createMainIpcRuntime(database);
  // Fresh installs start with the vertical-slice fixture until the first Excel
  // commit replaces Formation and Qualification context.
  if (!repository.loadAggregate('2026-08-20')) repository.saveAggregate(createMockState('2026-08-20'), null);
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
});
