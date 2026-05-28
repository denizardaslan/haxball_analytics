import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';

type RefreshState = 'idle' | 'running' | 'success' | 'failed';

export interface AnalyticsRefreshStatus {
  state: RefreshState;
  reason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  message: string;
}

let running: Promise<AnalyticsRefreshStatus> | null = null;
const status: AnalyticsRefreshStatus = {
  state: 'idle',
  reason: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  message: 'Analytics refresh has not run yet.',
};

function bruinPath(): string {
  return process.env.BRUIN_BIN || path.join(os.homedir(), '.local', 'bin', 'bruin');
}

export function getAnalyticsRefreshStatus(): AnalyticsRefreshStatus {
  return { ...status };
}

export function triggerAnalyticsRefresh(reason: string): Promise<AnalyticsRefreshStatus> {
  if (running) {
    return running;
  }

  status.state = 'running';
  status.reason = reason;
  status.startedAt = new Date().toISOString();
  status.finishedAt = null;
  status.exitCode = null;
  status.message = `Refreshing analytics after ${reason}.`;

  running = new Promise((resolve) => {
    const child = spawn(bruinPath(), ['run', 'bruin'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      status.state = 'failed';
      status.finishedAt = new Date().toISOString();
      status.message = error.message;
      running = null;
      resolve(getAnalyticsRefreshStatus());
    });

    child.on('close', (code) => {
      status.finishedAt = new Date().toISOString();
      status.exitCode = code;
      status.state = code === 0 ? 'success' : 'failed';
      status.message = code === 0
        ? 'Analytics are up to date.'
        : (stderr.trim() || `Bruin exited with code ${code}`);
      running = null;
      resolve(getAnalyticsRefreshStatus());
    });
  });

  return running;
}
