/**
 * Haxball Analytics - Shot Detection and Tracking
 *
 * Detects and tracks shots on goal with xG values.
 *
 * A "shot" is a kick where:
 * 1. Ball is moving toward opponent's goal (x direction)
 * 2. Ball trajectory would pass through goal line
 * 3. Ball speed exceeds threshold
 */

import { randomUUID } from 'crypto';
import type { GameEvent } from './types';
import { calculateXG, type XGResult } from './xg';

// Stadium constants
const RED_GOAL_X = -370;
const BLUE_GOAL_X = 370;
const GOAL_Y_MIN = -64;
const GOAL_Y_MAX = 64;

// Shot detection constants
const MIN_SHOT_SPEED = 6; // Minimum ball speed to be considered a shot
const SHOT_DIRECTION_THRESHOLD = 0.4; // Minimum x-velocity component ratio
const MAX_SHOT_DISTANCE = 260;
const GOAL_TRAJECTORY_MARGIN = 42;

export type ShotResult = 'goal' | 'miss' | 'save' | 'pending';

export interface Shot {
  shotId: string;
  gameId: string;
  timestamp: string;
  playerId: number;
  playerName: string;
  team: number; // 1=red, 2=blue
  position: { x: number; y: number };
  ballSpeed: { speedX: number; speedY: number };
  xg: number;
  xgDetails: XGResult;
  result: ShotResult;
  goalTimestamp?: string; // If it resulted in a goal
}

export interface ShotsData {
  gameId: string;
  timestamp: string;
  shots: Shot[];
  summary: {
    red: {
      totalShots: number;
      goals: number;
      totalXG: number;
      shotsOnTarget: number;
    };
    blue: {
      totalShots: number;
      goals: number;
      totalXG: number;
      shotsOnTarget: number;
    };
  };
}

/**
 * Determine if a kick is likely a shot based on ball trajectory
 */
function isLikelyShot(
  ballX: number,
  ballY: number,
  speedX: number,
  speedY: number,
  team: number
): boolean {
  // Calculate total speed
  const totalSpeed = Math.sqrt(speedX * speedX + speedY * speedY);

  // Must have minimum speed
  if (totalSpeed < MIN_SHOT_SPEED) {
    return false;
  }

  // A shot has to start in the opponent half. This filters build-up touches,
  // clearances, and sideways kicks that happen far away from goal.
  if (team === 1 && ballX < 0) {
    return false;
  }
  if (team === 2 && ballX > 0) {
    return false;
  }

  // Determine target goal based on team
  const targetGoalX = team === 1 ? BLUE_GOAL_X : RED_GOAL_X;
  const distanceToGoal = Math.abs(targetGoalX - ballX);

  if (distanceToGoal > MAX_SHOT_DISTANCE) {
    return false;
  }

  // Ball must be moving toward the goal
  if (team === 1 && speedX <= 0) {
    return false; // Red team must shoot right (positive X)
  }
  if (team === 2 && speedX >= 0) {
    return false; // Blue team must shoot left (negative X)
  }

  // Check if x-velocity is significant portion of total velocity
  const xRatio = Math.abs(speedX) / totalSpeed;
  if (xRatio < SHOT_DIRECTION_THRESHOLD) {
    return false;
  }

  // Project where ball would cross goal line
  if (speedX !== 0) {
    const timeToGoal = (targetGoalX - ballX) / speedX;
    if (timeToGoal > 0) {
      const projectedY = ballY + speedY * timeToGoal;
      // Check if it would be within goal height (with some margin)
      if (projectedY >= GOAL_Y_MIN - GOAL_TRAJECTORY_MARGIN && projectedY <= GOAL_Y_MAX + GOAL_TRAJECTORY_MARGIN) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Shot Tracker class
 * Maintains all shots for a game
 */
export class ShotTracker {
  private gameId: string;
  private shots: Shot[] = [];
  private pendingShots: Map<string, Shot> = new Map(); // Shots waiting for result
  private lastUpdate: string;

  constructor(gameId: string) {
    this.gameId = gameId;
    this.lastUpdate = new Date().toISOString();
  }

  /**
   * Process a kick event and determine if it's a shot
   */
  processKick(event: GameEvent, players: Array<{ id: number; name: string; team: number; x: number; y: number }>): Shot | null {
    if (!event.ballPosition || !event.team || event.team === 0) {
      return null;
    }

    const ballX = event.ballPosition.x;
    const ballY = event.ballPosition.y;
    const speedX = event.ballSpeed?.speedX || 0;
    const speedY = event.ballSpeed?.speedY || 0;

    // Check if this is likely a shot
    if (!isLikelyShot(ballX, ballY, speedX, speedY, event.team)) {
      return null;
    }

    // Calculate xG for this shot
    const xgResult = calculateXG(
      { x: ballX, y: ballY },
      event.team,
      { speedX, speedY },
      players.map(p => ({
        id: p.id,
        name: p.name,
        team: p.team,
        x: p.x,
        y: p.y,
        speedX: 0,
        speedY: 0,
      }))
    );

    const shot: Shot = {
      shotId: randomUUID(),
      gameId: this.gameId,
      timestamp: event.timestamp,
      playerId: event.playerId || 0,
      playerName: event.playerName || 'Unknown',
      team: event.team,
      position: { x: ballX, y: ballY },
      ballSpeed: { speedX, speedY },
      xg: xgResult.xg,
      xgDetails: xgResult,
      result: 'pending',
    };

    this.shots.push(shot);
    this.pendingShots.set(shot.shotId, shot);
    this.lastUpdate = event.timestamp;

    console.log(
      `[Shots] Shot detected: ${shot.playerName} (${shot.team === 1 ? 'Red' : 'Blue'}) ` +
      `xG=${shot.xg.toFixed(3)} from (${ballX.toFixed(0)}, ${ballY.toFixed(0)})`
    );

    return shot;
  }

  /**
   * Process a goal event and update pending shots
   * Returns the scorer info if found from a tracked shot
   */
  processGoal(scoringTeam: number, timestamp: string): { playerId: number; playerName: string; xg: number } | null {
    // Find the most recent pending shot from the scoring team
    let mostRecentShot: Shot | null = null;
    let mostRecentTime = '';

    for (const shot of this.pendingShots.values()) {
      if (shot.team === scoringTeam && shot.timestamp > mostRecentTime) {
        mostRecentShot = shot;
        mostRecentTime = shot.timestamp;
      }
    }

    let scorerInfo: { playerId: number; playerName: string; xg: number } | null = null;

    if (mostRecentShot) {
      mostRecentShot.result = 'goal';
      mostRecentShot.goalTimestamp = timestamp;
      this.pendingShots.delete(mostRecentShot.shotId);

      scorerInfo = {
        playerId: mostRecentShot.playerId,
        playerName: mostRecentShot.playerName,
        xg: mostRecentShot.xg,
      };

      console.log(
        `[Shots] Goal! Shot by ${mostRecentShot.playerName} resulted in goal (xG=${mostRecentShot.xg.toFixed(3)})`
      );
    }

    // Mark other pending shots as misses (they didn't result in goal)
    for (const shot of this.pendingShots.values()) {
      if (shot.result === 'pending') {
        shot.result = 'miss';
      }
    }
    this.pendingShots.clear();

    return scorerInfo;
  }

  /**
   * Get all shots data
   */
  getShotsData(): ShotsData {
    const redShots = this.shots.filter(s => s.team === 1);
    const blueShots = this.shots.filter(s => s.team === 2);

    return {
      gameId: this.gameId,
      timestamp: this.lastUpdate,
      shots: [...this.shots],
      summary: {
        red: {
          totalShots: redShots.length,
          goals: redShots.filter(s => s.result === 'goal').length,
          totalXG: Math.round(redShots.reduce((sum, s) => sum + s.xg, 0) * 1000) / 1000,
          shotsOnTarget: redShots.filter(s => s.result === 'goal' || s.result === 'save').length,
        },
        blue: {
          totalShots: blueShots.length,
          goals: blueShots.filter(s => s.result === 'goal').length,
          totalXG: Math.round(blueShots.reduce((sum, s) => sum + s.xg, 0) * 1000) / 1000,
          shotsOnTarget: blueShots.filter(s => s.result === 'goal' || s.result === 'save').length,
        },
      },
    };
  }

  /**
   * Get shots for visualization (simplified format)
   */
  getShotsForVisualization(): Array<{
    x: number;
    y: number;
    team: number;
    xg: number;
    result: ShotResult;
    playerName: string;
  }> {
    return this.shots.map(shot => ({
      x: shot.position.x,
      y: shot.position.y,
      team: shot.team,
      xg: shot.xg,
      result: shot.result,
      playerName: shot.playerName,
    }));
  }

  /**
   * Reset shot tracking
   */
  reset(): void {
    this.shots = [];
    this.pendingShots.clear();
    this.lastUpdate = new Date().toISOString();
  }
}

// =============================================================================
// Global Shot Manager
// =============================================================================

let currentTracker: ShotTracker | null = null;

/**
 * Start shot tracking for a new game
 */
export function startShotTracking(gameId: string): void {
  currentTracker = new ShotTracker(gameId);
  console.log(`[Shots] Started tracking for game: ${gameId}`);
}

/**
 * Stop shot tracking
 */
export function stopShotTracking(): ShotsData | null {
  if (!currentTracker) {
    return null;
  }

  const finalData = currentTracker.getShotsData();
  console.log(
    `[Shots] Final: Red ${finalData.summary.red.goals}/${finalData.summary.red.totalShots} ` +
    `(xG ${finalData.summary.red.totalXG}), ` +
    `Blue ${finalData.summary.blue.goals}/${finalData.summary.blue.totalShots} ` +
    `(xG ${finalData.summary.blue.totalXG})`
  );

  currentTracker = null;
  return finalData;
}

/**
 * Process a kick event for shot detection
 */
export function processKickForShots(
  event: GameEvent,
  players: Array<{ id: number; name: string; team: number; x: number; y: number }>
): Shot | null {
  if (!currentTracker) {
    return null;
  }
  return currentTracker.processKick(event, players);
}

/**
 * Process a goal event for shot tracking
 * Returns the scorer info if found from a tracked shot
 */
export function processGoalForShots(scoringTeam: number, timestamp: string): { playerId: number; playerName: string; xg: number } | null {
  if (!currentTracker) {
    return null;
  }
  return currentTracker.processGoal(scoringTeam, timestamp);
}

/**
 * Get current shots data
 */
export function getCurrentShotsData(): ShotsData | null {
  if (!currentTracker) {
    return null;
  }
  return currentTracker.getShotsData();
}

/**
 * Get shots for visualization
 */
export function getShotsForVisualization(): Array<{
  x: number;
  y: number;
  team: number;
  xg: number;
  result: ShotResult;
  playerName: string;
}> | null {
  if (!currentTracker) {
    return null;
  }
  return currentTracker.getShotsForVisualization();
}
