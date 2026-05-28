/**
 * Haxball Analytics - Room Configuration
 * Creates and configures the Haxball room using haxball.js
 */

import HaxballJS from 'haxball.js';
import type { RoomConfig } from './types';

// Room instance type from haxball.js
export type HaxballRoom = Awaited<ReturnType<Awaited<ReturnType<typeof HaxballJS>>>>;

/**
 * Creates a new Haxball room with the specified configuration
 */
export async function createRoom(config: RoomConfig): Promise<HaxballRoom> {
  console.log('[Room] Initializing Haxball.js...');
  
  const HBInit = await HaxballJS();
  
  console.log('[Room] Creating room:', config.roomName);
  
  const room = HBInit({
    roomName: config.roomName,
    maxPlayers: config.maxPlayers,
    noPlayer: true, // Headless mode - no host player
    public: config.public,
    token: config.token,
  });

  // Set default stadium and game rules
  room.setDefaultStadium('Classic');
  room.setScoreLimit(3);
  room.setTimeLimit(5);

  console.log('[Room] Room created successfully!');
  console.log('[Room] Stadium: Classic');
  console.log('[Room] Score limit: 3, Time limit: 5 minutes');

  return room;
}

/**
 * Gets room configuration from environment variables
 */
export function getRoomConfig(): RoomConfig {
  const token = process.env.HAXBALL_TOKEN;
  
  if (!token) {
    throw new Error(
      'HAXBALL_TOKEN environment variable is required. ' +
      'Get your token from: https://www.haxball.com/headlesstoken'
    );
  }

  return {
    roomName: process.env.ROOM_NAME || 'Haxball Analytics Room',
    maxPlayers: parseInt(process.env.ROOM_MAX_PLAYERS || '10', 10),
    public: process.env.ROOM_PUBLIC === 'true',
    token,
  };
}
