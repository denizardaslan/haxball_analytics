/**
 * Haxball Analytics - Distance Covered Tracking
 *
 * Tracks cumulative distance covered by each player during the game.
 *
 * Unit conversion: ~1 Haxball unit ≈ 0.1 meter (estimated)
 */

import type { GameSnapshot, PlayerSnapshot } from './types';

// Conversion constants
const UNITS_TO_METERS = 0.1; // 1 Haxball unit ≈ 0.1 meter
const METERS_TO_KM = 0.001;
const SPRINT_SPEED_THRESHOLD = 4; // Units per tick - considered "sprinting"

export interface PlayerDistanceData {
  playerId: number;
  playerName: string;
  team: number;
  totalDistance: number; // In Haxball units
  totalDistanceMeters: number;
  totalDistanceKm: number;
  sprintDistance: number; // High-speed movement distance
  sprintDistanceMeters: number;
  snapshotCount: number;
  averageSpeed: number; // Units per snapshot
}

export interface DistanceData {
  gameId: string;
  timestamp: string;
  gameTime: number;
  snapshotCount: number;
  players: PlayerDistanceData[];
  teamTotals: {
    red: { distance: number; distanceKm: number; sprintKm: number };
    blue: { distance: number; distanceKm: number; sprintKm: number };
  };
}

interface PlayerTrackingState {
  playerId: number;
  playerName: string;
  team: number;
  lastX: number;
  lastY: number;
  totalDistance: number;
  sprintDistance: number;
  snapshotCount: number;
}

/**
 * Calculate Euclidean distance between two positions
 */
function calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

/**
 * Distance Tracker class
 * Maintains running distance statistics for all players in a game
 */
export class DistanceTracker {
  private gameId: string;
  private snapshotCount: number = 0;
  private gameTime: number = 0;
  private playerStates: Map<number, PlayerTrackingState> = new Map();
  private lastUpdate: string;

  constructor(gameId: string) {
    this.gameId = gameId;
    this.lastUpdate = new Date().toISOString();
  }

  /**
   * Process a game snapshot and update distances
   */
  processSnapshot(snapshot: GameSnapshot): void {
    this.snapshotCount++;
    this.gameTime = snapshot.gameTime;
    this.lastUpdate = snapshot.timestamp;

    for (const player of snapshot.players) {
      this.updatePlayerDistance(player);
    }
  }

  /**
   * Update distance for a single player
   */
  private updatePlayerDistance(player: PlayerSnapshot): void {
    const state = this.playerStates.get(player.id);

    if (state) {
      // Calculate distance moved since last snapshot
      const dist = calculateDistance(state.lastX, state.lastY, player.x, player.y);

      // Update totals
      state.totalDistance += dist;
      state.snapshotCount++;

      // Check if sprinting (using player speed from snapshot)
      const speed = Math.sqrt(player.speedX ** 2 + player.speedY ** 2);
      if (speed > SPRINT_SPEED_THRESHOLD) {
        state.sprintDistance += dist;
      }

      // Update last position
      state.lastX = player.x;
      state.lastY = player.y;
      state.playerName = player.name; // Update in case of name change
      state.team = player.team;
    } else {
      // First time seeing this player
      this.playerStates.set(player.id, {
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        lastX: player.x,
        lastY: player.y,
        totalDistance: 0,
        sprintDistance: 0,
        snapshotCount: 1,
      });
    }
  }

  /**
   * Get distance data for all players
   */
  getDistanceData(): DistanceData {
    const players: PlayerDistanceData[] = [];
    let redTotal = 0;
    let redSprint = 0;
    let blueTotal = 0;
    let blueSprint = 0;

    for (const state of this.playerStates.values()) {
      const distanceMeters = state.totalDistance * UNITS_TO_METERS;
      const sprintMeters = state.sprintDistance * UNITS_TO_METERS;

      players.push({
        playerId: state.playerId,
        playerName: state.playerName,
        team: state.team,
        totalDistance: Math.round(state.totalDistance * 100) / 100,
        totalDistanceMeters: Math.round(distanceMeters * 100) / 100,
        totalDistanceKm: Math.round(distanceMeters * METERS_TO_KM * 1000) / 1000,
        sprintDistance: Math.round(state.sprintDistance * 100) / 100,
        sprintDistanceMeters: Math.round(sprintMeters * 100) / 100,
        snapshotCount: state.snapshotCount,
        averageSpeed: state.snapshotCount > 0
          ? Math.round((state.totalDistance / state.snapshotCount) * 100) / 100
          : 0,
      });

      if (state.team === 1) {
        redTotal += state.totalDistance;
        redSprint += state.sprintDistance;
      } else if (state.team === 2) {
        blueTotal += state.totalDistance;
        blueSprint += state.sprintDistance;
      }
    }

    // Sort by total distance (descending)
    players.sort((a, b) => b.totalDistance - a.totalDistance);

    return {
      gameId: this.gameId,
      timestamp: this.lastUpdate,
      gameTime: this.gameTime,
      snapshotCount: this.snapshotCount,
      players,
      teamTotals: {
        red: {
          distance: Math.round(redTotal * 100) / 100,
          distanceKm: Math.round(redTotal * UNITS_TO_METERS * METERS_TO_KM * 1000) / 1000,
          sprintKm: Math.round(redSprint * UNITS_TO_METERS * METERS_TO_KM * 1000) / 1000,
        },
        blue: {
          distance: Math.round(blueTotal * 100) / 100,
          distanceKm: Math.round(blueTotal * UNITS_TO_METERS * METERS_TO_KM * 1000) / 1000,
          sprintKm: Math.round(blueSprint * UNITS_TO_METERS * METERS_TO_KM * 1000) / 1000,
        },
      },
    };
  }

  /**
   * Reset distance tracking
   */
  reset(): void {
    this.snapshotCount = 0;
    this.gameTime = 0;
    this.playerStates.clear();
    this.lastUpdate = new Date().toISOString();
  }
}

// =============================================================================
// Global Distance Manager
// =============================================================================

let currentTracker: DistanceTracker | null = null;

/**
 * Start distance tracking for a new game
 */
export function startDistanceTracking(gameId: string): void {
  currentTracker = new DistanceTracker(gameId);
  console.log(`[Distance] Started tracking for game: ${gameId}`);
}

/**
 * Stop distance tracking
 */
export function stopDistanceTracking(): DistanceData | null {
  if (!currentTracker) {
    return null;
  }

  const finalData = currentTracker.getDistanceData();
  console.log(
    `[Distance] Final: Red ${finalData.teamTotals.red.distanceKm}km, Blue ${finalData.teamTotals.blue.distanceKm}km`
  );

  currentTracker = null;
  return finalData;
}

/**
 * Process a snapshot for distance tracking
 */
export function processSnapshotForDistance(snapshot: GameSnapshot): void {
  if (!currentTracker) {
    return;
  }
  currentTracker.processSnapshot(snapshot);
}

/**
 * Get current distance data
 */
export function getCurrentDistanceData(): DistanceData | null {
  if (!currentTracker) {
    return null;
  }
  return currentTracker.getDistanceData();
}
