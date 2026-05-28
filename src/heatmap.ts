/**
 * Haxball Analytics - Heat Map Aggregation
 *
 * Aggregates player position data into a grid for heat map visualization.
 *
 * Stadium: Classic (740 x 340 units)
 * Grid: 37 x 17 cells (20 units per cell)
 * Separate heat maps for: Red team, Blue team, Ball
 */

import type { GameSnapshot, PlayerSnapshot, BallState } from './types';

// Stadium constants (Classic map)
const FIELD_WIDTH = 740; // -370 to +370
const FIELD_HEIGHT = 340; // -170 to +170
const FIELD_MIN_X = -370;
const FIELD_MIN_Y = -170;

// Grid configuration
const CELL_SIZE = 20; // 20 units per cell
const GRID_COLS = 37; // 740 / 20 = 37
const GRID_ROWS = 17; // 340 / 20 = 17

export interface HeatMapData {
  gameId: string;
  timestamp: string;
  snapshotCount: number;
  heatMaps: {
    red: number[][]; // 37x17 grid - raw counts
    blue: number[][]; // 37x17 grid - raw counts
    ball: number[][]; // 37x17 grid - raw counts
  };
  normalized: {
    red: number[][]; // 37x17 grid - normalized 0-100
    blue: number[][]; // 37x17 grid - normalized 0-100
    ball: number[][]; // 37x17 grid - normalized 0-100
  };
}

/**
 * Creates an empty grid (37x17)
 */
function createEmptyGrid(): number[][] {
  return Array(GRID_ROWS)
    .fill(null)
    .map(() => Array(GRID_COLS).fill(0));
}

/**
 * Converts a field position to grid cell coordinates
 * Returns null if position is out of bounds
 */
function positionToCell(x: number, y: number): { col: number; row: number } | null {
  // Clamp to field bounds
  const clampedX = Math.max(FIELD_MIN_X, Math.min(FIELD_MIN_X + FIELD_WIDTH, x));
  const clampedY = Math.max(FIELD_MIN_Y, Math.min(FIELD_MIN_Y + FIELD_HEIGHT, y));

  // Convert to grid coordinates (0-indexed)
  const col = Math.floor((clampedX - FIELD_MIN_X) / CELL_SIZE);
  const row = Math.floor((clampedY - FIELD_MIN_Y) / CELL_SIZE);

  // Ensure within grid bounds
  const safeCol = Math.max(0, Math.min(GRID_COLS - 1, col));
  const safeRow = Math.max(0, Math.min(GRID_ROWS - 1, row));

  return { col: safeCol, row: safeRow };
}

/**
 * Normalizes a grid to 0-100 scale
 */
function normalizeGrid(grid: number[][]): number[][] {
  // Find max value in grid
  let maxVal = 0;
  for (const row of grid) {
    for (const val of row) {
      if (val > maxVal) maxVal = val;
    }
  }

  // Avoid division by zero
  if (maxVal === 0) {
    return grid.map((row) => row.map(() => 0));
  }

  // Normalize to 0-100
  return grid.map((row) => row.map((val) => Math.round((val / maxVal) * 100)));
}

/**
 * Deep clones a 2D grid
 */
function cloneGrid(grid: number[][]): number[][] {
  return grid.map((row) => [...row]);
}

/**
 * Heat Map Aggregator class
 * Maintains running heat map counts for a game
 */
export class HeatMapAggregator {
  private gameId: string;
  private snapshotCount: number = 0;
  private redGrid: number[][];
  private blueGrid: number[][];
  private ballGrid: number[][];
  private lastUpdate: string;

  constructor(gameId: string) {
    this.gameId = gameId;
    this.redGrid = createEmptyGrid();
    this.blueGrid = createEmptyGrid();
    this.ballGrid = createEmptyGrid();
    this.lastUpdate = new Date().toISOString();
  }

  /**
   * Processes a game snapshot and updates heat map counts
   */
  processSnapshot(snapshot: GameSnapshot): void {
    this.snapshotCount++;
    this.lastUpdate = snapshot.timestamp;

    // Process player positions
    for (const player of snapshot.players) {
      this.addPlayerPosition(player);
    }

    // Process ball position
    if (snapshot.ball) {
      this.addBallPosition(snapshot.ball);
    }
  }

  /**
   * Adds a player position to the appropriate team's heat map
   */
  private addPlayerPosition(player: PlayerSnapshot): void {
    const cell = positionToCell(player.x, player.y);
    if (!cell) return;

    // Team 1 = Red, Team 2 = Blue
    if (player.team === 1) {
      this.redGrid[cell.row][cell.col]++;
    } else if (player.team === 2) {
      this.blueGrid[cell.row][cell.col]++;
    }
    // Spectators (team 0) are ignored
  }

  /**
   * Adds a ball position to the ball heat map
   */
  private addBallPosition(ball: BallState): void {
    const cell = positionToCell(ball.x, ball.y);
    if (!cell) return;

    this.ballGrid[cell.row][cell.col]++;
  }

  /**
   * Gets the current heat map data with normalization
   */
  getHeatMapData(): HeatMapData {
    return {
      gameId: this.gameId,
      timestamp: this.lastUpdate,
      snapshotCount: this.snapshotCount,
      heatMaps: {
        red: cloneGrid(this.redGrid),
        blue: cloneGrid(this.blueGrid),
        ball: cloneGrid(this.ballGrid),
      },
      normalized: {
        red: normalizeGrid(this.redGrid),
        blue: normalizeGrid(this.blueGrid),
        ball: normalizeGrid(this.ballGrid),
      },
    };
  }

  /**
   * Gets the raw grid counts (for debugging)
   */
  getRawGrids(): { red: number[][]; blue: number[][]; ball: number[][] } {
    return {
      red: cloneGrid(this.redGrid),
      blue: cloneGrid(this.blueGrid),
      ball: cloneGrid(this.ballGrid),
    };
  }

  /**
   * Gets the total position counts
   */
  getTotalCounts(): { red: number; blue: number; ball: number } {
    const sum = (grid: number[][]) => grid.reduce((acc, row) => acc + row.reduce((a, b) => a + b, 0), 0);
    return {
      red: sum(this.redGrid),
      blue: sum(this.blueGrid),
      ball: sum(this.ballGrid),
    };
  }

  /**
   * Resets the heat map counts
   */
  reset(): void {
    this.snapshotCount = 0;
    this.redGrid = createEmptyGrid();
    this.blueGrid = createEmptyGrid();
    this.ballGrid = createEmptyGrid();
    this.lastUpdate = new Date().toISOString();
  }

  /**
   * Gets grid configuration info
   */
  static getGridInfo() {
    return {
      cols: GRID_COLS,
      rows: GRID_ROWS,
      cellSize: CELL_SIZE,
      fieldWidth: FIELD_WIDTH,
      fieldHeight: FIELD_HEIGHT,
      fieldMinX: FIELD_MIN_X,
      fieldMinY: FIELD_MIN_Y,
    };
  }
}

// =============================================================================
// Global Heat Map Manager
// =============================================================================

// Current game's heat map aggregator
let currentAggregator: HeatMapAggregator | null = null;

/**
 * Starts heat map tracking for a new game
 */
export function startHeatMapTracking(gameId: string): void {
  currentAggregator = new HeatMapAggregator(gameId);
  console.log(`[HeatMap] Started tracking for game: ${gameId}`);
}

/**
 * Stops heat map tracking
 */
export function stopHeatMapTracking(): HeatMapData | null {
  if (!currentAggregator) {
    return null;
  }

  const finalData = currentAggregator.getHeatMapData();
  const counts = currentAggregator.getTotalCounts();
  console.log(
    `[HeatMap] Stopped tracking. Snapshots: ${finalData.snapshotCount}, ` +
      `Positions - Red: ${counts.red}, Blue: ${counts.blue}, Ball: ${counts.ball}`
  );

  currentAggregator = null;
  return finalData;
}

/**
 * Processes a snapshot for heat map tracking
 */
export function processSnapshotForHeatMap(snapshot: GameSnapshot): void {
  if (!currentAggregator) {
    return;
  }

  currentAggregator.processSnapshot(snapshot);
}

/**
 * Gets current heat map data (without stopping)
 */
export function getCurrentHeatMapData(): HeatMapData | null {
  if (!currentAggregator) {
    return null;
  }

  return currentAggregator.getHeatMapData();
}

/**
 * Gets the heat map grid configuration
 */
export function getHeatMapGridInfo() {
  return HeatMapAggregator.getGridInfo();
}
