/**
 * Haxball Analytics - Debug Server
 * WebSocket server + Express HTTP server for debug dashboard
 * 
 * Supports two dashboard modes:
 * - Debug dashboard (index.html): Basic real-time view
 * - Live dashboard (live.html): Full real-time analytics with heatmaps, xG, possession
 */

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'path';
import * as http from 'http';
import type { GameSnapshot, GameEvent, DebugServerConfig, HeatMapData } from './types';
import type { PossessionData } from './possession';
import type { DistanceData } from './distance';
import type { ShotsData } from './shots';
import { getHeatMapData, getPossessionData, getDistanceData, getShotsData, getAllGameStats } from './collector';
import { getHeatMapGridInfo } from './heatmap';
import { getShotsForVisualization } from './shots';
import { registerAnalyticsRoutes } from './analytics-api';

// Server instances
let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;

// Connected WebSocket clients
const clients = new Set<WebSocket>();

// Recent data for new connections
const recentSnapshots: GameSnapshot[] = [];
const recentEvents: GameEvent[] = [];
const MAX_RECENT = 50;

// Stats broadcast interval (1 second for analytics)
let statsInterval: ReturnType<typeof setInterval> | null = null;
const STATS_BROADCAST_INTERVAL = 1000;

/**
 * Starts the debug server
 */
export function startDebugServer(config: DebugServerConfig): void {
  if (process.env.ENABLE_DEBUG_DASHBOARD !== 'true') {
    console.log('[DebugServer] Debug dashboard disabled');
    return;
  }

  const app = express();

  // Serve static files from public directory
  app.use(express.static(path.join(process.cwd(), 'public')));

  // API endpoint for recent data
  app.get('/api/recent', (_req, res) => {
    res.json({
      snapshots: recentSnapshots,
      events: recentEvents,
    });
  });

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      clients: clients.size,
      recentSnapshots: recentSnapshots.length,
      recentEvents: recentEvents.length,
    });
  });

  registerAnalyticsRoutes(app);

  // Heat map data endpoint
  app.get('/api/heatmap', (_req, res) => {
    const heatMapData = getHeatMapData();
    if (heatMapData) {
      res.json(heatMapData);
    } else {
      res.json({ error: 'No active game', data: null });
    }
  });

  // Heat map grid info endpoint
  app.get('/api/heatmap/grid', (_req, res) => {
    res.json(getHeatMapGridInfo());
  });

  // Possession data endpoint
  app.get('/api/possession', (_req, res) => {
    const possessionData = getPossessionData();
    if (possessionData) {
      res.json(possessionData);
    } else {
      res.json({ error: 'No active game', data: null });
    }
  });

  // Distance data endpoint
  app.get('/api/distance', (_req, res) => {
    const distanceData = getDistanceData();
    if (distanceData) {
      res.json(distanceData);
    } else {
      res.json({ error: 'No active game', data: null });
    }
  });

  // Shots data endpoint
  app.get('/api/shots', (_req, res) => {
    const shotsData = getShotsData();
    if (shotsData) {
      res.json(shotsData);
    } else {
      res.json({ error: 'No active game', data: null });
    }
  });

  // Shots for visualization (simplified)
  app.get('/api/shots/visualization', (_req, res) => {
    const shots = getShotsForVisualization();
    if (shots) {
      res.json(shots);
    } else {
      res.json([]);
    }
  });

  // All game stats endpoint
  app.get('/api/stats', (_req, res) => {
    const stats = getAllGameStats();
    if (stats) {
      res.json(stats);
    } else {
      res.json({ error: 'No active game', data: null });
    }
  });

  // Create HTTP server
  httpServer = http.createServer(app);

  // Create WebSocket server on same port
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    console.log('[DebugServer] Client connected');
    clients.add(ws);

    // Send recent data and current stats to new client
    const initData = {
      type: 'init',
      snapshots: recentSnapshots,
      events: recentEvents,
      stats: {
        heatmap: getHeatMapData(),
        possession: getPossessionData(),
        distance: getDistanceData(),
        shots: getShotsData(),
      },
      gridInfo: getHeatMapGridInfo(),
    };
    
    ws.send(JSON.stringify(initData));

    ws.on('close', () => {
      console.log('[DebugServer] Client disconnected');
      clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('[DebugServer] WebSocket error:', error);
      clients.delete(ws);
    });
  });

  // Start stats broadcast
  startStatsBroadcast();

  // Start listening
  httpServer.listen(config.httpPort, () => {
    console.log(`[DebugServer] HTTP server running at http://localhost:${config.httpPort}`);
    console.log(`[DebugServer] WebSocket server running on same port`);
    console.log(`[DebugServer] Debug dashboard: http://localhost:${config.httpPort}`);
    console.log(`[DebugServer] Live dashboard: http://localhost:${config.httpPort}/live.html`);
  });
}

/**
 * Broadcasts a snapshot to all connected clients
 */
export function broadcastSnapshot(snapshot: GameSnapshot): void {
  // Store in recent
  recentSnapshots.push(snapshot);
  if (recentSnapshots.length > MAX_RECENT) {
    recentSnapshots.shift();
  }

  // Broadcast to clients
  const message = JSON.stringify({ type: 'snapshot', data: snapshot });
  broadcast(message);
}

/**
 * Broadcasts an event to all connected clients
 */
export function broadcastEvent(event: GameEvent): void {
  // Store in recent
  recentEvents.push(event);
  if (recentEvents.length > MAX_RECENT) {
    recentEvents.shift();
  }

  // Broadcast to clients
  const message = JSON.stringify({ type: 'event', data: event });
  broadcast(message);
}

/**
 * Broadcasts heat map data to all connected clients
 */
export function broadcastHeatMap(heatMapData: HeatMapData): void {
  const message = JSON.stringify({ type: 'heatmap', data: heatMapData });
  broadcast(message);
}

/**
 * Broadcasts possession data to all connected clients
 */
export function broadcastPossession(possessionData: PossessionData): void {
  const message = JSON.stringify({ type: 'possession', data: possessionData });
  broadcast(message);
}

/**
 * Broadcasts distance data to all connected clients
 */
export function broadcastDistance(distanceData: DistanceData): void {
  const message = JSON.stringify({ type: 'distance', data: distanceData });
  broadcast(message);
}

/**
 * Broadcasts shots/xG data to all connected clients
 */
export function broadcastShots(shotsData: ShotsData): void {
  const message = JSON.stringify({ type: 'shots', data: shotsData });
  broadcast(message);
}

/**
 * Broadcasts all game stats to all connected clients
 */
function broadcastAllStats(): void {
  if (clients.size === 0) return;
  
  const heatMapData = getHeatMapData();
  const possessionData = getPossessionData();
  const distanceData = getDistanceData();
  const shotsData = getShotsData();
  
  // Bundle all stats in a single message for efficiency
  const message = JSON.stringify({
    type: 'stats',
    data: {
      heatmap: heatMapData,
      possession: possessionData,
      distance: distanceData,
      shots: shotsData,
      timestamp: new Date().toISOString(),
    }
  });
  
  broadcast(message);
}

/**
 * Starts the periodic stats broadcast
 */
function startStatsBroadcast(): void {
  if (statsInterval) return;
  
  statsInterval = setInterval(() => {
    broadcastAllStats();
  }, STATS_BROADCAST_INTERVAL);
  
  console.log('[DebugServer] Stats broadcast started (1s interval)');
}

/**
 * Stops the periodic stats broadcast
 */
function stopStatsBroadcast(): void {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
    console.log('[DebugServer] Stats broadcast stopped');
  }
}

/**
 * Broadcasts a message to all connected clients
 */
function broadcast(message: string): void {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        console.error('[DebugServer] Error sending to client:', error);
      }
    }
  }
}

/**
 * Stops the debug server
 */
export function stopDebugServer(): void {
  // Stop stats broadcast
  stopStatsBroadcast();
  
  if (wss) {
    for (const client of clients) {
      client.close();
    }
    wss.close();
    wss = null;
  }

  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }

  clients.clear();
  console.log('[DebugServer] Server stopped');
}

/**
 * Gets debug server configuration from environment
 */
export function getDebugServerConfig(): DebugServerConfig {
  return {
    httpPort: parseInt(process.env.DEBUG_HTTP_PORT || '3000', 10),
    wsPort: parseInt(process.env.DEBUG_WS_PORT || '3001', 10),
  };
}
