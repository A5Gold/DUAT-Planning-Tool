import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS, type OhlrApi, type IpcChannel, type IpcRequest, type IpcResponse } from '../src/application/ipcContract';

function invoke<C extends IpcChannel>(channel: C, request: IpcRequest<C>): Promise<IpcResponse<C>> {
  return ipcRenderer.invoke(channel, request) as Promise<IpcResponse<C>>;
}

const planning = {
  getWorkbench: (request: IpcRequest<'planning:get-workbench'>) => invoke(IPC_CHANNELS.getWorkbench, request),
  getCandidates: (request: IpcRequest<'planning:get-candidates'>) => invoke(IPC_CHANNELS.getCandidates, request),
  updateWork: (request: IpcRequest<'planning:update-work'>) => invoke(IPC_CHANNELS.updateWork, request),
  addLocation: (request: IpcRequest<'planning:add-location'>) => invoke(IPC_CHANNELS.addLocation, request),
  updateLocation: (request: IpcRequest<'planning:update-location'>) => invoke(IPC_CHANNELS.updateLocation, request),
  deleteLocation: (request: IpcRequest<'planning:delete-location'>) => invoke(IPC_CHANNELS.deleteLocation, request),
  addAssignment: (request: IpcRequest<'planning:add-assignment'>) => invoke(IPC_CHANNELS.addAssignment, request),
  replaceAssignment: (request: IpcRequest<'planning:replace-assignment'>) => invoke(IPC_CHANNELS.replaceAssignment, request),
  removeAssignment: (request: IpcRequest<'planning:remove-assignment'>) => invoke(IPC_CHANNELS.removeAssignment, request),
  createScenario: (request: IpcRequest<'planning:create-scenario'>) => invoke(IPC_CHANNELS.createScenario, request),
  renameScenario: (request: IpcRequest<'planning:rename-scenario'>) => invoke(IPC_CHANNELS.renameScenario, request),
  deleteScenario: (request: IpcRequest<'planning:delete-scenario'>) => invoke(IPC_CHANNELS.deleteScenario, request),
  saveScenario: (request: IpcRequest<'planning:save-scenario'>) => invoke(IPC_CHANNELS.saveScenario, request),
  applyScenario: (request: IpcRequest<'planning:apply-scenario'>) => invoke(IPC_CHANNELS.applyScenario, request),
};

const imports = {
  preview: (request: IpcRequest<'import:preview'>) => invoke(IPC_CHANNELS.previewImport, request),
  selectFile: (request: IpcRequest<'import:select-file'>) => invoke(IPC_CHANNELS.selectImportFile, request),
  commit: (request: IpcRequest<'import:commit'>) => invoke(IPC_CHANNELS.commitImport, request),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
};

const api = {
  health: () => invoke(IPC_CHANNELS.health, undefined),
  planning,
  imports,
  [IPC_CHANNELS.health]: () => invoke(IPC_CHANNELS.health, undefined),
  [IPC_CHANNELS.getWorkbench]: planning.getWorkbench,
  [IPC_CHANNELS.getCandidates]: planning.getCandidates,
  [IPC_CHANNELS.updateWork]: planning.updateWork,
  [IPC_CHANNELS.addLocation]: planning.addLocation,
  [IPC_CHANNELS.updateLocation]: planning.updateLocation,
  [IPC_CHANNELS.deleteLocation]: planning.deleteLocation,
  [IPC_CHANNELS.addAssignment]: planning.addAssignment,
  [IPC_CHANNELS.replaceAssignment]: planning.replaceAssignment,
  [IPC_CHANNELS.removeAssignment]: planning.removeAssignment,
  [IPC_CHANNELS.createScenario]: planning.createScenario,
  [IPC_CHANNELS.renameScenario]: planning.renameScenario,
  [IPC_CHANNELS.deleteScenario]: planning.deleteScenario,
  [IPC_CHANNELS.saveScenario]: planning.saveScenario,
  [IPC_CHANNELS.applyScenario]: planning.applyScenario,
  [IPC_CHANNELS.previewImport]: imports.preview,
  [IPC_CHANNELS.selectImportFile]: imports.selectFile,
  [IPC_CHANNELS.commitImport]: imports.commit,
} satisfies OhlrApi;

contextBridge.exposeInMainWorld('ohlr', api);
