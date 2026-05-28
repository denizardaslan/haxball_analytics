/**
 * Haxball Analytics - Possession Calculation
 *
 * Calculates ball possession percentage for each team in real-time.
 *
 * Possession is determined by:
 * 1. Nearest player to the ball (if within control distance)
 * 2. Last player to kick the ball (if ball is contested)
 */

import type { GameSnapshot, PlayerSnapshot, BallState } from './types';

// Possession constants
const CONTROL_DISTANCE = 30; // Units - ball is "controlled" if player is within this distance
const CONTESTED_DISTANCE = 60; // Units - ball is contested if no player within control distance

export interface PossessionData {
  gameId: string;
  timestamp: string;
  snapshotCount: number;
  redTime: number; // Total snapshots with red possession
  blueTime: number; // Total snapshots with blue possession
  contestedTime: number; // Total snapshots with no clear possession
  redPercent: number; // Red possession percentage (0-100)
  bluePercent: number; // Blue possession percentage (0-100)
  currentPossession: 'red' | 'blue' | 'contested' | null;
  lastKicker: {
    playerId: number;
    playerName: string;
    team: number;
  } | null;
}

/**
 * Calculate Euclidean distance between two positions
 */
function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

/**
 * Find the nearest player to the ball
 */
function findNearestPlayer(
  ball: BallState,
  players: PlayerSnapshot[]
): { player: PlayerSnapshot; distance: number } | null {
  let nearest: PlayerSnapshot | null = null;
  let minDist = Infinity;

  for (const player of players) {
    // Skip spectators
    if (player.team === 0) continue;

    const dist = distance(ball.x, ball.y, player.x, player.y);
    if (dist < minDist) {
      minDist = dist;
      nearest = player;
    }
  }

  if (nearest) {
    return { player: nearest, distance: minDist };
  }
  return null;
}

/**
 * Determine which team has possession
 */
function determinePossession(
  ball: BallState | null,
  players: PlayerSnapshot[],
  lastKicker: { playerId: number; playerName: string; team: number } | null
): 'red' | 'blue' | 'contested' | null {
  if (!ball) {
    return null;
  }

  const nearestResult = findNearestPlayer(ball, players);

  if (!nearestResult) {
    return null;
  }

  const { player, distance: dist } = nearestResult;

  // Clear possession - player is close to ball
  if (dist < CONTROL_DISTANCE) {
    return player.team === 1 ? 'red' : 'blue';
  }

  // Ball is contested but we can use last kicker
  if (dist < CONTESTED_DISTANCE && lastKicker) {
    return lastKicker.team === 1 ? 'red' : 'blue';
  }

  // Ball is in transit or contested
  if (lastKicker) {
    return lastKicker.team === 1 ? 'red' : 'blue';
  }

  return 'contested';
}

/**
 * Possession Tracker class
 * Maintains running possession statistics for a game
 */
export class PossessionTracker {
  private gameId: string;
  private snapshotCount: number = 0;
  private redTime: number = 0;
  private blueTime: number = 0;
  private contestedTime: number = 0;
  private currentPossession: 'red' | 'blue' | 'contested' | null = null;
  private lastKicker: { playerId: number; playerName: string; team: number } | null = null;
  private lastUpdate: string;

  constructor(gameId: string) {
    this.gameId = gameId;
    this.lastUpdate = new Date().toISOString();
  }

  /**
   * Process a game snapshot and update possession
   */
  processSnapshot(snapshot: GameSnapshot): void {
    this.snapshotCount++;
    this.lastUpdate = snapshot.timestamp;

    const possession = determinePossession(
      snapshot.ball,
      snapshot.players,
      this.lastKicker
    );

    this.currentPossession = possession;

    if (possession === 'red') {
      this.redTime++;
    } else if (possession === 'blue') {
      this.blueTime++;
    } else {
      this.contestedTime++;
    }
  }

  /**
   * Record a kick event to update last kicker
   */
  recordKick(playerId: number, playerName: string, team: number): void {
    this.lastKicker = { playerId, playerName, team };
  }

  /**
   * Get current possession data
   */
  getPossessionData(): PossessionData {
    const totalWithPossession = this.redTime + this.blueTime;
    const redPercent = totalWithPossession > 0
      ? Math.round((this.redTime / totalWithPossession) * 100)
      : 50;
    const bluePercent = totalWithPossession > 0
      ? 100 - redPercent
      : 50;

    return {
      gameId: this.gameId,
      timestamp: this.lastUpdate,
      snapshotCount: this.snapshotCount,
      redTime: this.redTime,
      blueTime: this.blueTime,
      contestedTime: this.contestedTime,
      redPercent,
      bluePercent,
      currentPossession: this.currentPossession,
      lastKicker: this.lastKicker,
    };
  }

  /**
   * Reset possession tracking
   */
  reset(): void {
    this.snapshotCount = 0;
    this.redTime = 0;
    this.blueTime = 0;
    this.contestedTime = 0;
    this.currentPossession = null;
    this.lastKicker = null;
    this.lastUpdate = new Date().toISOString();
  }
}

// =============================================================================
// Global Possession Manager
// =============================================================================

let currentTracker: PossessionTracker | null = null;

/**
 * Start possession tracking for a new game
 */
export function startPossessionTracking(gameId: string): void {
  currentTracker = new PossessionTracker(gameId);
  console.log(`[Possession] Started tracking for game: ${gameId}`);
}

/**
 * Stop possession tracking
 */
export function stopPossessionTracking(): PossessionData | null {
  if (!currentTracker) {
    return null;
  }

  const finalData = currentTracker.getPossessionData();
  console.log(
    `[Possession] Final: Red ${finalData.redPercent}% - Blue ${finalData.bluePercent}%`
  );

  currentTracker = null;
  return finalData;
}

/**
 * Process a snapshot for possession tracking
 */
export function processSnapshotForPossession(snapshot: GameSnapshot): void {
  if (!currentTracker) {
    return;
  }
  currentTracker.processSnapshot(snapshot);
}

/**
 * Record a kick for possession tracking
 */
export function recordKickForPossession(
  playerId: number,
  playerName: string,
  team: number
): void {
  if (!currentTracker) {
    return;
  }
  currentTracker.recordKick(playerId, playerName, team);
}

/**
 * Get current possession data
 */
export function getCurrentPossessionData(): PossessionData | null {
  if (!currentTracker) {
    return null;
  }
  return currentTracker.getPossessionData();
}
