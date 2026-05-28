/**
 * Haxball Analytics - Event Handlers
 * Captures game events: goals, kicks, player joins/leaves, game start/stop
 */

import { randomUUID } from 'crypto';
import type { HaxballRoom } from './room';
import type { GameEvent } from './types';
import { getCurrentGameId, startGame, endGame, getCurrentPlayers } from './collector';
import { recordKickForPossession } from './possession';
import { processKickForShots, processGoalForShots } from './shots';

// Callbacks for event processing
type EventCallback = (event: GameEvent) => void;
const eventCallbacks: EventCallback[] = [];

/**
 * Registers a callback to receive game events
 */
export function onEvent(callback: EventCallback): void {
  eventCallbacks.push(callback);
}

/**
 * Emits an event to all registered callbacks
 */
function emitEvent(event: GameEvent): void {
  console.log(`[Events] ${event.eventType}:`, event.playerName || event.team || '');
  
  for (const callback of eventCallbacks) {
    try {
      callback(event);
    } catch (error) {
      console.error('[Events] Error in event callback:', error);
    }
  }
}

/**
 * Creates a base event object
 */
function createEvent(
  eventType: GameEvent['eventType'],
  gameId: string | null
): GameEvent {
  return {
    eventId: randomUUID(),
    gameId: gameId || 'no-game',
    timestamp: new Date().toISOString(),
    eventType,
  };
}

/**
 * Updates admin status - assigns admin to first player if no admin exists
 */
function updateAdmins(room: HaxballRoom): void {
  const players = room.getPlayerList();
  
  // No players, nothing to do
  if (players.length === 0) return;
  
  // Check if any player is already admin
  const hasAdmin = players.some((p) => p.admin);
  if (hasAdmin) return;
  
  // Assign admin to the first player
  const firstPlayer = players[0];
  room.setPlayerAdmin(firstPlayer.id, true);
  console.log(`[Events] Auto-assigned admin to: ${firstPlayer.name}`);
}

/**
 * Sets up all event handlers on the room
 */
export function setupEventHandlers(room: HaxballRoom): void {
  console.log('[Events] Setting up event handlers...');

  // Game lifecycle events
  room.onGameStart = (byPlayer) => {
    const gameId = startGame();
    const event = createEvent('gameStart', gameId);
    if (byPlayer) {
      event.playerId = byPlayer.id;
      event.playerName = byPlayer.name;
    }
    emitEvent(event);
  };

  room.onGameStop = (byPlayer) => {
    const event = createEvent('gameStop', getCurrentGameId());
    if (byPlayer) {
      event.playerId = byPlayer.id;
      event.playerName = byPlayer.name;
    }
    emitEvent(event);
    endGame();
  };

  // Goal events
  room.onTeamGoal = (team) => {
    const event = createEvent('goal', getCurrentGameId());
    event.team = team;
    
    // Get ball position at time of goal
    const ballPos = room.getBallPosition();
    if (ballPos) {
      event.ballPosition = { x: ballPos.x, y: ballPos.y };
    }
    
    // Update shot tracking - mark the shot that resulted in this goal
    // This returns the scorer info if we tracked the shot
    const scorerInfo = processGoalForShots(team, event.timestamp);
    
    // Add scorer info to the goal event if available
    if (scorerInfo) {
      event.playerId = scorerInfo.playerId;
      event.playerName = scorerInfo.playerName;
      event.xg = scorerInfo.xg;
    }
    
    emitEvent(event);
  };

  // Player kick events (for shot/pass detection)
  room.onPlayerBallKick = (player) => {
    const event = createEvent('kick', getCurrentGameId());
    event.playerId = player.id;
    event.playerName = player.name;
    event.team = player.team;
    
    // Get player position
    if (player.position) {
      event.position = { x: player.position.x, y: player.position.y };
    }
    
    // Get ball position and speed
    const ballPos = room.getBallPosition();
    const ballDisc = room.getDiscProperties(0);
    
    if (ballPos) {
      event.ballPosition = { x: ballPos.x, y: ballPos.y };
    }
    
    // Get ball speed for xG calculation
    if (ballDisc) {
      event.ballSpeed = {
        speedX: ballDisc.xspeed || 0,
        speedY: ballDisc.yspeed || 0,
      };
    }
    
    // Shot detection is stricter than raw kick tracking. Only kicks that are
    // close to the opponent goal and traveling goalward get xG attached.
    if (ballPos && player.team) {
      try {
        const currentPlayers = getCurrentPlayers();
        const shot = processKickForShots(event, currentPlayers);
        if (shot) {
          event.xg = shot.xg;
          event.metadata = {
            ...(event.metadata || {}),
            isShot: true,
            shotId: shot.shotId,
            shotResult: shot.result,
            distanceToGoal: shot.xgDetails.distanceToGoal,
            angleToGoal: shot.xgDetails.angleToGoal,
          };
        }
      } catch (error) {
        // xG calculation failed (e.g., spectator kick), skip
      }
      
      // Record kick for possession tracking
      recordKickForPossession(player.id, player.name, player.team);
    }
    
    emitEvent(event);
  };

  // Player join/leave events
  room.onPlayerJoin = (player) => {
    const event = createEvent('join', getCurrentGameId());
    event.playerId = player.id;
    event.playerName = player.name;
    event.metadata = { auth: player.auth };
    emitEvent(event);
    
    console.log(`[Events] Player joined: ${player.name} (ID: ${player.id})`);
    
    // Auto-assign admin if needed
    updateAdmins(room);
  };

  room.onPlayerLeave = (player) => {
    const event = createEvent('leave', getCurrentGameId());
    event.playerId = player.id;
    event.playerName = player.name;
    event.team = player.team;
    emitEvent(event);
    
    console.log(`[Events] Player left: ${player.name} (ID: ${player.id})`);
    
    // Re-assign admin if the leaving player was admin
    updateAdmins(room);
  };

  console.log('[Events] Event handlers ready');
}
