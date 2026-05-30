/**
 * Haxball Analytics - Data Collector
 * Collects game state snapshots every 250ms (15 ticks)
 */

import { randomUUID } from 'crypto';
import type { HaxballRoom } from './room';
import type { GameSnapshot, PlayerSnapshot, BallState } from './types';
import {
  startHeatMapTracking,
  stopHeatMapTracking,
  processSnapshotForHeatMap,
  getCurrentHeatMapData,
  type HeatMapData,
} from './heatmap';
import {
  startPossessionTracking,
  stopPossessionTracking,
  processSnapshotForPossession,
  getCurrentPossessionData,
  type PossessionData,
} from './possession';
import {
  startDistanceTracking,
  stopDistanceTracking,
  processSnapshotForDistance,
  getCurrentDistanceData,
  type DistanceData,
} from './distance';
import {
  startShotTracking,
  stopShotTracking,
  getCurrentShotsData,
  type ShotsData,
} from './shots';

// Game runs at 60 ticks/second. Default 15 ticks = 250ms for smoother live tactical map.
const SNAPSHOT_INTERVAL = parseInt(process.env.SNAPSHOT_INTERVAL_TICKS || '15', 10);
const SNAPSHOT_INTERVAL_MS = Math.round((SNAPSHOT_INTERVAL / 60) * 1000);

// Current game state
let currentGameId: string | null = null;
let currentGameAnalyticsEnabled = true;
let tickCount = 0;

// Callbacks for snapshot processing
type SnapshotCallback = (snapshot: GameSnapshot) => void;
const snapshotCallbacks: SnapshotCallback[] = [];

/**
 * Registers a callback to receive game snapshots
 */
export function onSnapshot(callback: SnapshotCallback): void {
  snapshotCallbacks.push(callback);
}

// Game stats data returned when game ends
export interface GameStatsData {
  heatMap: HeatMapData | null;
  possession: PossessionData | null;
  distance: DistanceData | null;
  shots: ShotsData | null;
}

/**
 * Starts a new game session
 */
export function startGame(analyticsEnabled = true): string {
  currentGameId = randomUUID();
  currentGameAnalyticsEnabled = analyticsEnabled;
  tickCount = 0;
  
  // Start all tracking modules for this game
  startHeatMapTracking(currentGameId);
  startPossessionTracking(currentGameId);
  startDistanceTracking(currentGameId);
  startShotTracking(currentGameId);
  
  console.log(`[Collector] New ${analyticsEnabled ? 'tracked game' : 'live warm-up'} started: ${currentGameId}`);
  return currentGameId;
}

/**
 * Ends the current game session
 */
export function endGame(): GameStatsData | null {
  if (currentGameId) {
    console.log(`[Collector] Game ended: ${currentGameId}`);
    
    // Stop all tracking modules and get final data
    const statsData: GameStatsData = {
      heatMap: stopHeatMapTracking(),
      possession: stopPossessionTracking(),
      distance: stopDistanceTracking(),
      shots: stopShotTracking(),
    };
    
    currentGameId = null;
    currentGameAnalyticsEnabled = true;
    tickCount = 0;
    
    return statsData;
  }
  return null;
}

/**
 * Gets the current game ID
 */
export function getCurrentGameId(): string | null {
  return currentGameId;
}

/**
 * Whether the current session should be written into durable analytics.
 */
export function isCurrentGameAnalyticsEnabled(): boolean {
  return currentGameId !== null && currentGameAnalyticsEnabled;
}

// Store reference to room for player data access
let roomRef: HaxballRoom | null = null;

/**
 * Gets current player snapshots from the room
 * Used for xG calculation when a kick event occurs
 */
export function getCurrentPlayers(): PlayerSnapshot[] {
  if (!roomRef) {
    return [];
  }

  const players = roomRef.getPlayerList();
  return players
    .filter((p) => p.position != null)
    .map((p) => {
      const disc = roomRef!.getPlayerDiscProperties(p.id);
      return {
        id: p.id,
        name: p.name,
        team: p.team,
        x: p.position!.x,
        y: p.position!.y,
        speedX: disc?.xspeed || 0,
        speedY: disc?.yspeed || 0,
      };
    });
}

/**
 * Collects a game snapshot from the room
 */
function collectSnapshot(room: HaxballRoom): GameSnapshot | null {
  if (!currentGameId) {
    return null;
  }

  const scores = room.getScores();
  if (!scores) {
    return null;
  }

  const ballPos = room.getBallPosition();
  const ballDisc = room.getDiscProperties(0);
  const players = room.getPlayerList();

  // Build ball state
  let ball: BallState | null = null;
  if (ballPos) {
    ball = {
      x: ballPos.x,
      y: ballPos.y,
      speedX: ballDisc?.xspeed || 0,
      speedY: ballDisc?.yspeed || 0,
    };
  }

  // Build player snapshots (only players on field)
  const playerSnapshots: PlayerSnapshot[] = players
    .filter((p) => p.position != null)
    .map((p) => {
      const disc = room.getPlayerDiscProperties(p.id);
      return {
        id: p.id,
        name: p.name,
        team: p.team,
        x: p.position!.x,
        y: p.position!.y,
        speedX: disc?.xspeed || 0,
        speedY: disc?.yspeed || 0,
      };
    });

  return {
    gameId: currentGameId,
    timestamp: new Date().toISOString(),
    tickNumber: tickCount,
    gameTime: scores.time,
    score: { red: scores.red, blue: scores.blue },
    ball,
    players: playerSnapshots,
  };
}

/**
 * Processes a snapshot - sends to all registered callbacks
 */
function processSnapshot(snapshot: GameSnapshot): void {
  // Update all tracking modules with this snapshot
  processSnapshotForHeatMap(snapshot);
  processSnapshotForPossession(snapshot);
  processSnapshotForDistance(snapshot);
  
  // Send to all registered callbacks
  for (const callback of snapshotCallbacks) {
    try {
      callback(snapshot);
    } catch (error) {
      console.error('[Collector] Error in snapshot callback:', error);
    }
  }
}

/**
 * Gets current heat map data for the active game
 */
export function getHeatMapData(): HeatMapData | null {
  return getCurrentHeatMapData();
}

/**
 * Gets current possession data for the active game
 */
export function getPossessionData(): PossessionData | null {
  return getCurrentPossessionData();
}

/**
 * Gets current distance data for the active game
 */
export function getDistanceData(): DistanceData | null {
  return getCurrentDistanceData();
}

/**
 * Gets current shots data for the active game
 */
export function getShotsData(): ShotsData | null {
  return getCurrentShotsData();
}

/**
 * Gets all current game stats
 */
export function getAllGameStats(): GameStatsData | null {
  if (!currentGameId) {
    return null;
  }
  return {
    heatMap: getCurrentHeatMapData(),
    possession: getCurrentPossessionData(),
    distance: getCurrentDistanceData(),
    shots: getCurrentShotsData(),
  };
}

/**
 * Sets up the game tick handler for data collection
 */
export function setupCollector(room: HaxballRoom): void {
  console.log(`[Collector] Setting up data collection (${SNAPSHOT_INTERVAL_MS}ms intervals)...`);

  // Store room reference for player data access
  roomRef = room;

  room.onGameTick = () => {
    tickCount++;

    // Collect snapshots at the configured tick interval.
    if (tickCount % SNAPSHOT_INTERVAL === 0) {
      const snapshot = collectSnapshot(room);
      if (snapshot) {
        processSnapshot(snapshot);
      }
    }
  };

  console.log('[Collector] Data collection ready');
}
