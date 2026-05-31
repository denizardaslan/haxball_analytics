/**
 * Haxball Analytics - Shot Detection and Tracking
 *
 * Detects and tracks shots on goal with xG values.
 *
 * A "shot" is a kick where the ball is moving toward the opponent goal with
 * enough speed and a plausible goal-mouth trajectory. Haxball long shots can
 * start from the player's own half, so the detector does not require attacking
 * half possession.
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
const MIN_SHOT_SPEED = 4.5; // Minimum ball speed to be considered a shot
const CLOSE_RANGE_MIN_SHOT_SPEED = 3.2;
const SHOT_DIRECTION_THRESHOLD = 0.25; // Minimum x-velocity component ratio
const CLOSE_RANGE_DIRECTION_THRESHOLD = 0.12;
const MAX_SHOT_DISTANCE = 780;
const CLOSE_RANGE_DISTANCE = 175;
const GOAL_TRAJECTORY_MARGIN = 56;
const MAX_DYNAMIC_TRAJECTORY_MARGIN = 72;
const RECENT_KICK_WINDOW_MS = 8000;
const RECENT_KICK_LIMIT = 30;

type PlayerContext = { id: number; name: string; team: number; x: number; y: number };

interface RecentKick {
  event: GameEvent;
  players: PlayerContext[];
}

function getTargetGoalX(team: number): number {
  return team === 1 ? BLUE_GOAL_X : RED_GOAL_X;
}

function getTotalSpeed(speedX: number, speedY: number): number {
  return Math.sqrt(speedX * speedX + speedY * speedY);
}

function isMovingTowardGoal(speedX: number, team: number): boolean {
  return (team === 1 && speedX > 0) || (team === 2 && speedX < 0);
}

function getProjectedGoalY(ballX: number, ballY: number, speedX: number, speedY: number, targetGoalX: number): number | null {
  if (speedX === 0) {
    return null;
  }

  const timeToGoal = (targetGoalX - ballX) / speedX;
  if (timeToGoal <= 0) {
    return null;
  }

  return ballY + speedY * timeToGoal;
}

function getTrajectoryMargin(distanceToGoal: number): number {
  return GOAL_TRAJECTORY_MARGIN + Math.min(MAX_DYNAMIC_TRAJECTORY_MARGIN, distanceToGoal * 0.08);
}

function isProjectedNearGoal(projectedY: number | null, distanceToGoal: number): boolean {
  if (projectedY === null) {
    return false;
  }

  const margin = getTrajectoryMargin(distanceToGoal);
  return projectedY >= GOAL_Y_MIN - margin && projectedY <= GOAL_Y_MAX + margin;
}

function isDangerousGoalwardKick(
  ballX: number,
  ballY: number,
  speedX: number,
  speedY: number,
  team: number,
  minSpeed: number
): boolean {
  const totalSpeed = getTotalSpeed(speedX, speedY);
  if (totalSpeed < minSpeed || !isMovingTowardGoal(speedX, team)) {
    return false;
  }

  const targetGoalX = getTargetGoalX(team);
  const distanceToGoal = Math.abs(targetGoalX - ballX);
  if (distanceToGoal > MAX_SHOT_DISTANCE) {
    return false;
  }

  const xRatio = Math.abs(speedX) / totalSpeed;
  const directionThreshold = distanceToGoal <= CLOSE_RANGE_DISTANCE
    ? CLOSE_RANGE_DIRECTION_THRESHOLD
    : SHOT_DIRECTION_THRESHOLD;

  if (xRatio < directionThreshold) {
    return false;
  }

  const projectedY = getProjectedGoalY(ballX, ballY, speedX, speedY, targetGoalX);
  if (isProjectedNearGoal(projectedY, distanceToGoal)) {
    return true;
  }

  // Close-range rebounds and angled touches often do not project neatly through
  // the exact goal mouth, but they are still genuine Haxball chances.
  return distanceToGoal <= CLOSE_RANGE_DISTANCE && Math.abs(ballY) <= GOAL_Y_MAX + getTrajectoryMargin(distanceToGoal);
}

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
  const targetGoalX = getTargetGoalX(team);
  const distanceToGoal = Math.abs(targetGoalX - ballX);
  const minSpeed = distanceToGoal <= CLOSE_RANGE_DISTANCE ? CLOSE_RANGE_MIN_SHOT_SPEED : MIN_SHOT_SPEED;

  return isDangerousGoalwardKick(ballX, ballY, speedX, speedY, team, minSpeed);
}

/**
 * Shot Tracker class
 * Maintains all shots for a game
 */
export class ShotTracker {
  private gameId: string;
  private shots: Shot[] = [];
  private pendingShots: Map<string, Shot> = new Map(); // Shots waiting for result
  private recentKicks: RecentKick[] = [];
  private lastUpdate: string;

  constructor(gameId: string) {
    this.gameId = gameId;
    this.lastUpdate = new Date().toISOString();
  }

  /**
   * Process a kick event and determine if it's a shot
   */
  private rememberKick(event: GameEvent, players: PlayerContext[]): void {
    this.recentKicks.push({
      event: {
        ...event,
        position: event.position ? { ...event.position } : undefined,
        ballPosition: event.ballPosition ? { ...event.ballPosition } : undefined,
        ballSpeed: event.ballSpeed ? { ...event.ballSpeed } : undefined,
        metadata: event.metadata ? { ...event.metadata } : undefined,
      },
      players: players.map((player) => ({ ...player })),
    });

    const eventTime = Date.parse(event.timestamp);
    const cutoff = Number.isFinite(eventTime) ? eventTime - RECENT_KICK_WINDOW_MS : Date.now() - RECENT_KICK_WINDOW_MS;
    this.recentKicks = this.recentKicks
      .filter((kick) => Date.parse(kick.event.timestamp) >= cutoff)
      .slice(-RECENT_KICK_LIMIT);
  }

  private createShot(event: GameEvent, players: PlayerContext[], result: ShotResult = 'pending', goalTimestamp?: string): Shot | null {
    if (!event.ballPosition || !event.team || event.team === 0) {
      return null;
    }

    const ballX = event.ballPosition.x;
    const ballY = event.ballPosition.y;
    const speedX = event.ballSpeed?.speedX || 0;
    const speedY = event.ballSpeed?.speedY || 0;

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
      result,
      goalTimestamp,
    };

    this.shots.push(shot);
    if (shot.result === 'pending') {
      this.pendingShots.set(shot.shotId, shot);
    }
    this.lastUpdate = event.timestamp;

    console.log(
      `[Shots] Shot detected: ${shot.playerName} (${shot.team === 1 ? 'Red' : 'Blue'}) ` +
      `xG=${shot.xg.toFixed(3)} from (${ballX.toFixed(0)}, ${ballY.toFixed(0)})`
    );

    return shot;
  }

  processKick(event: GameEvent, players: PlayerContext[]): Shot | null {
    this.rememberKick(event, players);

    if (!event.ballPosition || !event.team || event.team === 0) {
      return null;
    }

    const ballX = event.ballPosition.x;
    const ballY = event.ballPosition.y;
    const speedX = event.ballSpeed?.speedX || 0;
    const speedY = event.ballSpeed?.speedY || 0;

    if (!isLikelyShot(ballX, ballY, speedX, speedY, event.team)) {
      return null;
    }

    return this.createShot(event, players);
  }

  private findFallbackGoalShot(scoringTeam: number, timestamp: string): RecentKick | null {
    const goalTime = Date.parse(timestamp);
    const candidates = this.recentKicks.filter((kick) => {
      const event = kick.event;
      if (event.team !== scoringTeam || !event.ballPosition) {
        return false;
      }

      const ageMs = goalTime - Date.parse(event.timestamp);
      if (ageMs < 0 || ageMs > RECENT_KICK_WINDOW_MS) {
        return false;
      }

      return isDangerousGoalwardKick(
        event.ballPosition.x,
        event.ballPosition.y,
        event.ballSpeed?.speedX || 0,
        event.ballSpeed?.speedY || 0,
        event.team,
        CLOSE_RANGE_MIN_SHOT_SPEED
      );
    });

    return candidates.at(-1) || null;
  }

  /**
   * Process a goal event and update pending shots
   * Returns the scorer info if found from a tracked shot
   */
  processGoal(scoringTeam: number, timestamp: string): { playerId: number; playerName: string; xg: number } | null {
    // Find the most recent pending shot from the scoring team
    const goalTime = Date.parse(timestamp);
    let mostRecentShot: Shot | null = null;
    let mostRecentTime = '';

    for (const shot of this.pendingShots.values()) {
      const ageMs = goalTime - Date.parse(shot.timestamp);
      if (ageMs >= 0 && ageMs <= RECENT_KICK_WINDOW_MS && shot.team === scoringTeam && shot.timestamp > mostRecentTime) {
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
    } else {
      const fallbackKick = this.findFallbackGoalShot(scoringTeam, timestamp);
      const fallbackShot = fallbackKick
        ? this.createShot(fallbackKick.event, fallbackKick.players, 'goal', timestamp)
        : null;

      if (fallbackShot) {
        scorerInfo = {
          playerId: fallbackShot.playerId,
          playerName: fallbackShot.playerName,
          xg: fallbackShot.xg,
        };

        console.log(
          `[Shots] Goal recovered from recent kick by ${fallbackShot.playerName} ` +
          `(xG=${fallbackShot.xg.toFixed(3)})`
        );
      }
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
    this.recentKicks = [];
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
