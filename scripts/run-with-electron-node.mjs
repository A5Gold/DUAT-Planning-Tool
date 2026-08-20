import { spawn } from 'node:child_process';
import electronPath from 'electron';

const [entryPoint, ...args] = process.argv.slice(2);

if (!entryPoint) {
  console.error('Usage: node scripts/run-with-electron-node.mjs <entry-point> [...args]');
  process.exit(2);
}

const child = spawn(electronPath, [entryPoint, ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  },
});

child.once('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
