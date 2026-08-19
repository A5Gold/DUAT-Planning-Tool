/// <reference types="vite/client" />

interface Window {
  ohlr?: {
    health: () => Promise<{ ok: boolean; runtime: string }>;
  };
}
