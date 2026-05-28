/**
 * Haxball Analytics - Data Validation
 * Validates game snapshots and events before processing
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GameSnapshot, GameEvent, BallState, PlayerSnapshot } from './types';

// Field boundaries (Classic Map)
const FIELD_BOUNDS = {
  minX: -420,  // Slightly outside goal area
  maxX: 420,
  minY: -200,
  maxY: 200,
};

// Valid event types
const VALID_EVENT_TYPES = ['goal', 'kick', 'join', 'leave', 'gameStart', 'gameStop'];

// Error log path
const ERROR_LOG_PATH = path.join(process.cwd(), 'data', 'errors.log');

// Validation result
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Logs validation errors to file
 */
function logError(context: string, data: unknown, errors: string[]): void {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      context,
      errors,
      data: JSON.stringify(data).slice(0, 500), // Truncate large data
    };
    
    // Ensure data directory exists
    const dataDir = path.dirname(ERROR_LOG_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.appendFileSync(ERROR_LOG_PATH, JSON.stringify(logEntry) + '\n');
  } catch (err) {
    console.error('[Validation] Failed to log error:', err);
  }
}

/**
 * Validates a UUID format
 */
function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Validates an ISO timestamp
 */
function isValidTimestamp(timestamp: string): boolean {
  const date = new Date(timestamp);
  return !isNaN(date.getTime());
}

/**
 * Validates coordinates are within field bounds
 */
function isWithinBounds(x: number, y: number): boolean {
  return (
    x >= FIELD_BOUNDS.minX &&
    x <= FIELD_BOUNDS.maxX &&
    y >= FIELD_BOUNDS.minY &&
    y <= FIELD_BOUNDS.maxY
  );
}

/**
 * Validates ball state
 */
function validateBall(ball: BallState | null, result: ValidationResult): void {
  if (ball === null) {
    return; // Ball can be null when game is paused
  }

  if (typeof ball.x !== 'number' || typeof ball.y !== 'number') {
    result.errors.push('Ball position must be numbers');
    return;
  }

  if (!isWithinBounds(ball.x, ball.y)) {
    result.warnings.push(`Ball position out of bounds: (${ball.x}, ${ball.y})`);
  }
}

/**
 * Validates a player snapshot
 */
function validatePlayer(player: PlayerSnapshot, index: number, result: ValidationResult): void {
  if (typeof player.id !== 'number') {
    result.errors.push(`Player ${index}: id must be a number`);
  }

  if (typeof player.name !== 'string' || player.name.length === 0) {
    result.errors.push(`Player ${index}: name must be a non-empty string`);
  }

  if (typeof player.team !== 'number' || player.team < 0 || player.team > 2) {
    result.errors.push(`Player ${index}: team must be 0, 1, or 2`);
  }

  if (typeof player.x !== 'number' || typeof player.y !== 'number') {
    result.errors.push(`Player ${index}: position must be numbers`);
  } else if (!isWithinBounds(player.x, player.y)) {
    result.warnings.push(`Player ${index} (${player.name}) out of bounds: (${player.x}, ${player.y})`);
  }
}

/**
 * Validates a game snapshot
 */
export function validateSnapshot(snapshot: GameSnapshot): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  // Validate gameId
  if (!snapshot.gameId || !isValidUUID(snapshot.gameId)) {
    result.errors.push('Invalid or missing gameId (must be UUID)');
  }

  // Validate timestamp
  if (!snapshot.timestamp || !isValidTimestamp(snapshot.timestamp)) {
    result.errors.push('Invalid or missing timestamp (must be ISO format)');
  }

  // Validate tickNumber
  if (typeof snapshot.tickNumber !== 'number' || snapshot.tickNumber < 0) {
    result.errors.push('Invalid tickNumber (must be non-negative number)');
  }

  // Validate gameTime
  if (typeof snapshot.gameTime !== 'number' || snapshot.gameTime < 0) {
    result.errors.push('Invalid gameTime (must be non-negative number)');
  }

  // Validate score
  if (!snapshot.score || typeof snapshot.score.red !== 'number' || typeof snapshot.score.blue !== 'number') {
    result.errors.push('Invalid score object');
  }

  // Validate ball
  validateBall(snapshot.ball, result);

  // Validate players
  if (!Array.isArray(snapshot.players)) {
    result.errors.push('players must be an array');
  } else {
    snapshot.players.forEach((player, index) => {
      validatePlayer(player, index, result);
    });
  }

  // Set valid flag
  result.valid = result.errors.length === 0;

  // Log errors if invalid
  if (!result.valid) {
    logError('snapshot', snapshot, result.errors);
  }

  return result;
}

/**
 * Validates a game event
 */
export function validateEvent(event: GameEvent): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  // Validate eventId
  if (!event.eventId || !isValidUUID(event.eventId)) {
    result.errors.push('Invalid or missing eventId (must be UUID)');
  }

  // Validate gameId
  if (!event.gameId || !isValidUUID(event.gameId)) {
    result.errors.push('Invalid or missing gameId (must be UUID)');
  }

  // Validate timestamp
  if (!event.timestamp || !isValidTimestamp(event.timestamp)) {
    result.errors.push('Invalid or missing timestamp (must be ISO format)');
  }

  // Validate eventType
  if (!event.eventType || !VALID_EVENT_TYPES.includes(event.eventType)) {
    result.errors.push(`Invalid eventType: ${event.eventType}. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`);
  }

  // Validate playerId for player events
  const playerEvents = ['goal', 'kick', 'join', 'leave'];
  if (playerEvents.includes(event.eventType)) {
    if (event.playerId === undefined || event.playerId === null) {
      result.warnings.push(`${event.eventType} event should have playerId`);
    }
    if (!event.playerName) {
      result.warnings.push(`${event.eventType} event should have playerName`);
    }
  }

  // Validate position if provided
  if (event.position) {
    if (typeof event.position.x !== 'number' || typeof event.position.y !== 'number') {
      result.errors.push('Event position must have numeric x and y');
    } else if (!isWithinBounds(event.position.x, event.position.y)) {
      result.warnings.push(`Event position out of bounds: (${event.position.x}, ${event.position.y})`);
    }
  }

  // Validate ball position if provided
  if (event.ballPosition) {
    if (typeof event.ballPosition.x !== 'number' || typeof event.ballPosition.y !== 'number') {
      result.errors.push('Event ballPosition must have numeric x and y');
    }
  }

  // Set valid flag
  result.valid = result.errors.length === 0;

  // Log errors if invalid
  if (!result.valid) {
    logError('event', event, result.errors);
  }

  return result;
}

/**
 * Validates and filters an array of snapshots
 * Returns only valid snapshots, logging invalid ones
 */
export function filterValidSnapshots(snapshots: GameSnapshot[]): GameSnapshot[] {
  return snapshots.filter((snapshot) => {
    const result = validateSnapshot(snapshot);
    if (!result.valid) {
      console.warn(`[Validation] Invalid snapshot dropped: ${result.errors.join(', ')}`);
    }
    return result.valid;
  });
}

/**
 * Validates and filters an array of events
 * Returns only valid events, logging invalid ones
 */
export function filterValidEvents(events: GameEvent[]): GameEvent[] {
  return events.filter((event) => {
    const result = validateEvent(event);
    if (!result.valid) {
      console.warn(`[Validation] Invalid event dropped: ${result.errors.join(', ')}`);
    }
    return result.valid;
  });
}

/**
 * Get validation error log stats
 */
export function getErrorLogStats(): { count: number; lastError: string | null } {
  try {
    if (!fs.existsSync(ERROR_LOG_PATH)) {
      return { count: 0, lastError: null };
    }
    
    const content = fs.readFileSync(ERROR_LOG_PATH, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    
    return {
      count: lines.length,
      lastError: lines.length > 0 ? lines[lines.length - 1] : null,
    };
  } catch {
    return { count: 0, lastError: null };
  }
}
