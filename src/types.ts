/**
 * Haxball Analytics - Type Definitions
 * Core data models for game state and events
 */

// Ball state snapshot
export interface BallState {
  x: number;
  y: number;
  speedX: number;
  speedY: number;
}

// Player state snapshot
export interface PlayerSnapshot {
  id: number;
  name: string;
  team: number; // 0=spectator, 1=red, 2=blue
  x: number;
  y: number;
  speedX: number;
  speedY: number;
}

// Complete game state (collected every 500ms)
export interface GameSnapshot {
  gameId: string;
  timestamp: string;
  tickNumber: number;
  gameTime: number;
  score: { red: number; blue: number };
  ball: BallState | null;
  players: PlayerSnapshot[];
}

// Game events (goals, kicks, joins, etc.)
export interface GameEvent {
  eventId: string;
  gameId: string;
  timestamp: string;
  eventType: 'goal' | 'kick' | 'join' | 'leave' | 'gameStart' | 'gameStop';
  playerId?: number;
  playerName?: string;
  team?: number;
  position?: { x: number; y: number };
  ballPosition?: { x: number; y: number };
  ballSpeed?: { speedX: number; speedY: number };
  xg?: number; // Expected Goals value for kick/shot events
  metadata?: Record<string, unknown>;
}

// Room configuration
export interface RoomConfig {
  roomName: string;
  maxPlayers: number;
  public: boolean;
  token: string;
}

// Debug server configuration
export interface DebugServerConfig {
  httpPort: number;
  wsPort: number;
}

// Team enum for clarity
export enum Team {
  Spectator = 0,
  Red = 1,
  Blue = 2,
}

// Heat map grid data (37x17 cells, 20 units per cell)
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

// Heat map grid configuration
export interface HeatMapGridInfo {
  cols: number; // 37
  rows: number; // 17
  cellSize: number; // 20
  fieldWidth: number; // 740
  fieldHeight: number; // 340
  fieldMinX: number; // -370
  fieldMinY: number; // -170
}
