import type { Request, Response, Router } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getAnalyticsRefreshStatus, triggerAnalyticsRefresh } from './analytics-refresh';

const ENDPOINTS = new Set(['summary', 'players', 'matches', 'lineups', 'xg', 'heatmap', 'pipeline', 'alltime']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function runAnalyticsQuery(endpoint: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'query_analytics.py');
    const venvPython = path.join(process.cwd(), '.venv', 'bin', 'python');
    const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3';
    const child = spawn(pythonBin, [scriptPath, endpoint], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Analytics query exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function analyticsHandler(req: Request, res: Response): Promise<void> {
  const endpointParam = req.params.endpoint;
  const endpoint = Array.isArray(endpointParam) ? endpointParam[0] : endpointParam;
  if (!ENDPOINTS.has(endpoint)) {
    res.status(404).json({ error: 'Unknown analytics endpoint' });
    return;
  }

  try {
    const data = await runAnalyticsQuery(endpoint);
    res.json(data);
  } catch (error) {
    res.status(503).json({
      error: 'Analytics database is not ready',
      detail: (error as Error).message,
      hint: 'Run `pip install -r requirements.txt` and `bruin run bruin`.',
    });
  }
}

async function collectGameRows<T>(folder: string, gameId: string): Promise<T[]> {
  const dir = path.join(process.cwd(), 'data', folder);
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = (await fs.promises.readdir(dir))
    .filter((file) => file.endsWith('.jsonl'))
    .sort();
  const rows: T[] = [];
  const needle = `"gameId":"${gameId}"`;

  for (const file of files) {
    const content = await fs.promises.readFile(path.join(dir, file), 'utf8');
    for (const line of content.split('\n')) {
      if (!line.includes(needle)) {
        continue;
      }

      try {
        rows.push(JSON.parse(line) as T);
      } catch {
        // Ignore malformed historical rows and keep the replay usable.
      }
    }
  }

  return rows;
}

function timestampOf(row: { timestamp?: string }): number {
  return row.timestamp ? Date.parse(row.timestamp) : 0;
}

async function replayHandler(req: Request, res: Response): Promise<void> {
  const gameIdParam = req.params.gameId;
  const gameId = Array.isArray(gameIdParam) ? gameIdParam[0] : gameIdParam;
  if (!UUID_PATTERN.test(gameId)) {
    res.status(400).json({ error: 'Invalid game id' });
    return;
  }

  try {
    const [snapshots, events] = await Promise.all([
      collectGameRows<{ timestamp: string }>('snapshots', gameId),
      collectGameRows<{ timestamp: string }>('events', gameId),
    ]);

    snapshots.sort((a, b) => timestampOf(a) - timestampOf(b));
    events.sort((a, b) => timestampOf(a) - timestampOf(b));

    if (!snapshots.length) {
      res.status(404).json({ error: 'Replay data not found for this match' });
      return;
    }

    const startedAt = snapshots[0].timestamp;
    const endedAt = snapshots.at(-1)?.timestamp || startedAt;
    res.json({
      title: `Match replay ${gameId.slice(0, 8)}`,
      note: 'Recorded public-room match replay built from stored snapshots and events.',
      gameId,
      startedAt,
      endedAt,
      durationMs: Math.max(1000, Date.parse(endedAt) - Date.parse(startedAt)),
      snapshots,
      events,
    });
  } catch (error) {
    res.status(503).json({
      error: 'Replay data is unavailable',
      detail: (error as Error).message,
    });
  }
}

type RouteRegistrar = Pick<Router, 'get' | 'post'>;

export function registerAnalyticsRoutes(app: RouteRegistrar): void {
  app.get('/api/analytics/:endpoint', analyticsHandler);
  app.get('/api/replay/:gameId', replayHandler);
  app.get('/api/analytics-refresh/status', (_req, res) => {
    res.json(getAnalyticsRefreshStatus());
  });
  app.post('/api/analytics-refresh/run', async (_req, res) => {
    const data = await triggerAnalyticsRefresh('manual request');
    res.json(data);
  });
  app.get('/api/pipeline/status', async (_req, res) => {
    try {
      const data = await runAnalyticsQuery('pipeline');
      res.json(data);
    } catch (error) {
      res.status(503).json({
        error: 'Pipeline status unavailable',
        detail: (error as Error).message,
        hint: 'Run `pip install -r requirements.txt` and `bruin run bruin`.',
      });
    }
  });
}
