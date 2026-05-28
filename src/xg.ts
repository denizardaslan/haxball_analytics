/**
 * Haxball Analytics - xG (Expected Goals) Calculation Model
 *
 * Calculates the probability of a shot resulting in a goal based on:
 * 1. Distance to goal - closer = higher xG
 * 2. Angle to goal - centered = higher xG
 * 3. Ball speed - faster shots harder to save
 * 4. Defender positions - more defenders = lower xG
 *
 * Stadium: Classic
 * - Field: 740 x 340 units (x: -370 to +370, y: -170 to +170)
 * - Red Goal: x = -370, y: -64 to +64 (left)
 * - Blue Goal: x = +370, y: -64 to +64 (right)
 * - Goal width: 128 units
 */

import type { PlayerSnapshot } from './types';

// Stadium constants (Classic map)
const RED_GOAL_X = -370;
const BLUE_GOAL_X = 370;

// xG model constants
const MAX_DISTANCE = 400; // Distance where xG becomes minimum
const MIN_XG = 0.01;
const MAX_XG = 0.95;

// Distance thresholds for xG tiers
const POINT_BLANK_DISTANCE = 50;  // Almost guaranteed goal
const CLOSE_RANGE_DISTANCE = 150; // High probability
const MEDIUM_RANGE_DISTANCE = 300; // Reasonable chance

export interface Position {
  x: number;
  y: number;
}

export interface XGResult {
  xg: number;
  distanceFactor: number;
  angleFactor: number;
  speedFactor: number;
  defenderFactor: number;
  distanceToGoal: number;
  angleToGoal: number; // in degrees
  goalX: number;
}

/**
 * Get the x-coordinate of the goal the team is shooting at.
 * Red (team=1) shoots at Blue goal (+370)
 * Blue (team=2) shoots at Red goal (-370)
 */
function getTargetGoalX(shootingTeam: number): number {
  if (shootingTeam === 1) {
    return BLUE_GOAL_X; // Red shoots at Blue goal
  } else if (shootingTeam === 2) {
    return RED_GOAL_X; // Blue shoots at Red goal
  }
  throw new Error(`Invalid team: ${shootingTeam}`);
}

/**
 * Get the center position of a goal.
 */
function getGoalCenter(goalX: number): Position {
  return { x: goalX, y: 0 };
}

/**
 * Calculate Euclidean distance between two positions.
 */
function euclideanDistance(pos1: Position, pos2: Position): number {
  return Math.sqrt(Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.y - pos2.y, 2));
}

/**
 * Calculate the angle (in radians) from the ball to the center of the goal.
 * A shot from directly in front of goal has angle 0.
 */
function calculateAngleToGoal(ballPos: Position, goalX: number): number {
  const goalCenter = getGoalCenter(goalX);
  const dx = goalCenter.x - ballPos.x;
  const dy = goalCenter.y - ballPos.y;
  return Math.atan2(Math.abs(dy), Math.abs(dx));
}

/**
 * Count defenders between the ball and goal.
 * Uses a cone-based approach for path detection.
 */
function countDefendersInPath(
  ballPos: Position,
  goalX: number,
  players: PlayerSnapshot[],
  shootingTeam: number,
  coneHalfAngle: number = 0.2 // ~11 degrees half-cone
): number {
  let count = 0;
  const goalCenter = getGoalCenter(goalX);

  // Direction vector to goal
  const dxGoal = goalCenter.x - ballPos.x;
  const dyGoal = goalCenter.y - ballPos.y;
  const distToGoal = Math.sqrt(dxGoal * dxGoal + dyGoal * dyGoal);

  if (distToGoal < 1) return 0; // Ball at goal

  // Normalize direction
  const dirX = dxGoal / distToGoal;
  const dirY = dyGoal / distToGoal;

  for (const player of players) {
    // Skip players on the shooting team or spectators
    if (player.team === shootingTeam || player.team === 0) continue;

    // Vector from ball to player
    const dxPlayer = player.x - ballPos.x;
    const dyPlayer = player.y - ballPos.y;
    const distToPlayer = Math.sqrt(dxPlayer * dxPlayer + dyPlayer * dyPlayer);

    if (distToPlayer < 1) continue; // Player at ball

    // Player must be between ball and goal
    if (distToPlayer > distToGoal) continue;

    // Check if player is in the cone
    const dot = (dxPlayer * dirX + dyPlayer * dirY) / distToPlayer;

    if (dot > 0) {
      const angleToPlayer = Math.acos(Math.min(1, Math.max(-1, dot)));
      // Use wider cone for closer defenders
      const effectiveCone = coneHalfAngle * (1 + distToPlayer / 100);
      if (angleToPlayer < effectiveCone) {
        count++;
      }
    }
  }

  return count;
}

/**
 * Calculate xG factor based on distance to goal.
 * Uses exponential decay - very close shots have very high xG.
 * 
 * Distance 0-50: xG 0.85-0.95 (point blank)
 * Distance 50-150: xG 0.40-0.85 (close range)
 * Distance 150-300: xG 0.10-0.40 (medium range)
 * Distance 300+: xG 0.01-0.10 (long range)
 */
function calculateDistanceFactor(distance: number): number {
  if (distance <= POINT_BLANK_DISTANCE) {
    // Point blank: 0.85 to 0.95
    return 0.95 - (distance / POINT_BLANK_DISTANCE) * 0.10;
  } else if (distance <= CLOSE_RANGE_DISTANCE) {
    // Close range: 0.40 to 0.85
    const t = (distance - POINT_BLANK_DISTANCE) / (CLOSE_RANGE_DISTANCE - POINT_BLANK_DISTANCE);
    return 0.85 - t * 0.45;
  } else if (distance <= MEDIUM_RANGE_DISTANCE) {
    // Medium range: 0.10 to 0.40
    const t = (distance - CLOSE_RANGE_DISTANCE) / (MEDIUM_RANGE_DISTANCE - CLOSE_RANGE_DISTANCE);
    return 0.40 - t * 0.30;
  } else {
    // Long range: exponential decay from 0.10
    const t = (distance - MEDIUM_RANGE_DISTANCE) / (MAX_DISTANCE - MEDIUM_RANGE_DISTANCE);
    return Math.max(0.02, 0.10 * Math.exp(-t * 2));
  }
}

/**
 * Calculate xG factor based on angle to goal.
 * Shots from center = higher factor.
 */
function calculateAngleFactor(angle: number): number {
  // cos(0) = 1, cos(pi/2) = 0
  // Using sqrt to make the falloff less steep
  return Math.max(0, Math.pow(Math.cos(angle), 0.5));
}

/**
 * Calculate xG factor based on ball speed.
 * Very fast shots are harder to save.
 */
function calculateSpeedFactor(speed: number): number {
  // Normalize around speed of 10
  // Speed 0 -> 0.5, Speed 10 -> 1.0, Speed 20 -> 1.5
  return Math.min(1.5, Math.max(0.5, speed / 10));
}

/**
 * Calculate xG factor based on defenders in path.
 * Each defender reduces xG by 20% (multiply by 0.8).
 */
function calculateDefenderFactor(numDefenders: number): number {
  return Math.pow(0.8, numDefenders);
}

/**
 * Calculate Expected Goals (xG) for a shot.
 *
 * @param ballPos - Ball position when kicked
 * @param shootingTeam - Team taking the shot (1=red, 2=blue)
 * @param ballSpeed - Optional ball speed { speedX, speedY }
 * @param players - Optional list of all players for defender calculation
 * @returns XGResult with xG value and factor breakdown
 */
export function calculateXG(
  ballPos: Position,
  shootingTeam: number,
  ballSpeed?: { speedX: number; speedY: number },
  players?: PlayerSnapshot[]
): XGResult {
  // Get target goal
  const goalX = getTargetGoalX(shootingTeam);
  const goalCenter = getGoalCenter(goalX);

  // Calculate distance to goal center
  const distance = euclideanDistance(ballPos, goalCenter);

  // Calculate angle to goal
  const angle = calculateAngleToGoal(ballPos, goalX);

  // Calculate factors
  const distanceFactor = calculateDistanceFactor(distance);
  const angleFactor = calculateAngleFactor(angle);

  // Speed factor (default to 1.0 if no speed data)
  let speedFactor = 1.0;
  if (ballSpeed) {
    const speed = Math.sqrt(
      ballSpeed.speedX * ballSpeed.speedX + ballSpeed.speedY * ballSpeed.speedY
    );
    speedFactor = calculateSpeedFactor(speed);
  }

  // Defender factor
  let defenderFactor = 1.0;
  if (players && players.length > 0) {
    const defenders = countDefendersInPath(ballPos, goalX, players, shootingTeam);
    defenderFactor = calculateDefenderFactor(defenders);
  }

  // Calculate final xG
  // Distance factor now directly represents the base probability
  // Other factors modify it up or down
  let xg = distanceFactor * angleFactor * defenderFactor;
  
  // Speed factor can boost xG slightly (fast shots harder to save)
  xg = xg * (0.7 + 0.3 * speedFactor);

  // Clamp to reasonable range
  xg = Math.min(MAX_XG, Math.max(MIN_XG, xg));

  return {
    xg: Math.round(xg * 10000) / 10000,
    distanceFactor: Math.round(distanceFactor * 10000) / 10000,
    angleFactor: Math.round(angleFactor * 10000) / 10000,
    speedFactor: Math.round(speedFactor * 10000) / 10000,
    defenderFactor: Math.round(defenderFactor * 10000) / 10000,
    distanceToGoal: Math.round(distance * 100) / 100,
    angleToGoal: Math.round((angle * 180) / Math.PI * 100) / 100,
    goalX,
  };
}

/**
 * Simplified xG calculation without defender data.
 * Useful for quick calculations when player positions aren't available.
 */
export function calculateXGSimple(
  x: number,
  y: number,
  team: number,
  speedX: number = 0,
  speedY: number = 0
): number {
  const result = calculateXG(
    { x, y },
    team,
    { speedX, speedY }
  );
  return result.xg;
}

/**
 * Determine if a kick is likely a shot (towards opponent's goal)
 * based on ball velocity direction.
 */
export function isLikelyShot(
  ballPos: Position,
  ballSpeed: { speedX: number; speedY: number },
  team: number
): boolean {
  const goalX = getTargetGoalX(team);
  const goalCenter = getGoalCenter(goalX);

  // Vector to goal
  const toGoalX = goalCenter.x - ballPos.x;
  const toGoalY = goalCenter.y - ballPos.y;
  const distToGoal = Math.sqrt(toGoalX * toGoalX + toGoalY * toGoalY);

  if (distToGoal < 1) return true; // Ball at goal

  // Normalize direction to goal
  const dirX = toGoalX / distToGoal;
  const dirY = toGoalY / distToGoal;

  // Ball speed magnitude
  const speed = Math.sqrt(ballSpeed.speedX * ballSpeed.speedX + ballSpeed.speedY * ballSpeed.speedY);
  if (speed < 0.1) return false; // Ball not moving

  // Normalize ball velocity
  const velX = ballSpeed.speedX / speed;
  const velY = ballSpeed.speedY / speed;

  // Dot product: how aligned is velocity with goal direction?
  const dot = dirX * velX + dirY * velY;

  // If dot > 0.3, ball is moving somewhat towards goal
  // Also consider if ball is close to goal (within shooting range)
  return dot > 0.3 || distToGoal < 150;
}
