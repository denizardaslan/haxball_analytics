import type { Express, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getAnalyticsRefreshStatus, triggerAnalyticsRefresh } from './analytics-refresh';

const ENDPOINTS = new Set(['summary', 'players', 'matches', 'lineups', 'xg', 'heatmap', 'pipeline']);

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

export function registerAnalyticsRoutes(app: Express): void {
  app.get('/api/analytics/:endpoint', analyticsHandler);
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
