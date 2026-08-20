/// <reference types="vite/client" />

import type { OhlrApi } from './application/ipcContract';

declare global {
  interface Window {
    ohlr?: OhlrApi;
  }
}

export {};
