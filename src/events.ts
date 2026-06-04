/**
 * Haxball Analytics - Event Handlers
 * Captures game events: goals, kicks, player joins/leaves, game start/stop
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { HaxballRoom } from './room';
import { Team, type GameEvent } from './types';
import {
  getCurrentGameId,
  startGame,
  endGame,
  getCurrentPlayers,
  isCurrentGameAnalyticsEnabled,
} from './collector';
import { recordKickForPossession } from './possession';
import { processKickForShots, processGoalForShots } from './shots';
import { answerBruinChatQuestion, isBruinChatCommand } from './bruin-chat-analyst';

// Callbacks for event processing
type EventCallback = (event: GameEvent) => void;
const eventCallbacks: EventCallback[] = [];
const ACTIVE_PLAYERS_PER_TEAM = 2;
const INACTIVITY_LIMIT_MS = 60_000;
const INACTIVITY_CHECK_MS = 1_000;
const SOLO_WARMUP_MESSAGE = 'Stats are paused; at least 2 players needed.';
const DASHBOARD_URL = 'https://haxanalytics.denizaa.com/';
const DASHBOARD_MESSAGE = `Live results of this game: ${DASHBOARD_URL}`;
const TRAINING_STADIUM_PATH = path.join(process.cwd(), 'training_stadium.md');
const BRUIN_CHAT_COOLDOWN_MS = parseInt(process.env.BRUIN_CHAT_COOLDOWN_MS || '15000', 10);
const BRUIN_CHAT_MAX_CHARS = 235;
const ANNOUNCEMENT_COLOR = 0xFFD166;
const BRUIN_ANNOUNCEMENT_COLOR = 0xFF5364;
const BRUIN_QUESTION_COLOR = 0xFFD166;

type RoomPlayer = ReturnType<HaxballRoom['getPlayerList']>[number];

let joinSequence = 0;
const playerJoinOrder = new Map<number, number>();
const playerActivity = new Map<number, number>();
let inactivityTimer: NodeJS.Timeout | null = null;
let isManagingTeams = false;
let pendingWinner: Team | null = null;
let selectionTeam: Team.Red | Team.Blue | null = null;
let selectionCaptainId: number | null = null;
let selectionSlots = 0;
let selectionTimer: NodeJS.Timeout | null = null;
let isResettingSoloGoal = false;
let stadiumMode: 'classic' | 'training' | null = null;
let trainingStadiumCache: string | null = null;
const bruinChatLastUsed = new Map<number, number>();

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

function playersByTeam(room: HaxballRoom, team: Team): RoomPlayer[] {
  return room.getPlayerList().filter((player) => player.team === team);
}

function activePlayerCount(room: HaxballRoom): number {
  return playersByTeam(room, Team.Red).length + playersByTeam(room, Team.Blue).length;
}

function hasCompetitiveTeams(room: HaxballRoom): boolean {
  return playersByTeam(room, Team.Red).length > 0 && playersByTeam(room, Team.Blue).length > 0;
}

function winnerFromScores(scores: { red: number; blue: number } | null): Team.Red | Team.Blue | null {
  if (!scores || scores.red === scores.blue) {
    return null;
  }

  return scores.red > scores.blue ? Team.Red : Team.Blue;
}

function isTrackedGameActive(): boolean {
  return getCurrentGameId() !== null;
}

function isAnalyticsGameActive(): boolean {
  return isCurrentGameAnalyticsEnabled();
}

function orderOf(player: RoomPlayer): number {
  return playerJoinOrder.get(player.id) ?? Number.MAX_SAFE_INTEGER;
}

function orderedPlayers(players: RoomPlayer[]): RoomPlayer[] {
  return [...players].sort((a, b) => orderOf(a) - orderOf(b));
}

function latestPlayer(players: RoomPlayer[]): RoomPlayer | undefined {
  return [...players].sort((a, b) => orderOf(b) - orderOf(a))[0];
}

function markActive(playerId: number): void {
  playerActivity.set(playerId, Date.now());
}

function setManagedTeam(room: HaxballRoom, playerId: number, team: Team): void {
  isManagingTeams = true;
  room.setPlayerTeam(playerId, team);
  setTimeout(() => {
    isManagingTeams = false;
  }, 0);
}

function getTrainingStadium(): string {
  if (!trainingStadiumCache) {
    trainingStadiumCache = fs.readFileSync(TRAINING_STADIUM_PATH, 'utf8');
  }

  return trainingStadiumCache;
}

function setStadiumMode(room: HaxballRoom, mode: 'classic' | 'training'): void {
  if (stadiumMode === mode) {
    return;
  }

  if (mode === 'training') {
    room.setCustomStadium(getTrainingStadium());
  } else {
    room.setDefaultStadium('Classic');
  }

  stadiumMode = mode;
  console.log(`[Events] Stadium switched to ${mode}`);
}

function desiredStadiumMode(room: HaxballRoom): 'classic' | 'training' {
  return hasCompetitiveTeams(room) ? 'classic' : 'training';
}

function startOrRestartGame(room: HaxballRoom, restart: boolean): void {
  if (restart && room.getScores()) {
    room.stopGame();
    setTimeout(() => {
      if (activePlayerCount(room) > 0) {
        setStadiumMode(room, desiredStadiumMode(room));
        room.startGame();
      }
    }, 150);
    return;
  }

  if (!room.getScores()) {
    setStadiumMode(room, desiredStadiumMode(room));
    room.startGame();
  }
}

function announce(room: HaxballRoom, message: string, targetId?: number, color = ANNOUNCEMENT_COLOR): void {
  room.sendAnnouncement(message, targetId, color, 'bold', 1);
}

function announceBruin(room: HaxballRoom, message: string, targetId?: number): void {
  for (let start = 0; start < message.length; start += BRUIN_CHAT_MAX_CHARS) {
    announce(room, message.slice(start, start + BRUIN_CHAT_MAX_CHARS), targetId, BRUIN_ANNOUNCEMENT_COLOR);
  }
}

function announceBruinQuestion(room: HaxballRoom, player: RoomPlayer, message: string): void {
  announce(room, `${player.name}: ${message.trim()}`, undefined, BRUIN_QUESTION_COLOR);
}

function announceDashboard(room: HaxballRoom, targetId?: number): void {
  announce(room, DASHBOARD_MESSAGE, targetId);
}

function clearPlayerAdmin(room: HaxballRoom, player: RoomPlayer): void {
  if (player.admin) {
    room.setPlayerAdmin(player.id, false);
    console.log(`[Events] Removed admin from player: ${player.name}`);
  }
}

function clearAllPlayerAdmins(room: HaxballRoom): void {
  for (const player of room.getPlayerList()) {
    clearPlayerAdmin(room, player);
  }
}

function enforceActiveLimit(room: HaxballRoom): void {
  const red = orderedPlayers(playersByTeam(room, Team.Red));
  const blue = orderedPlayers(playersByTeam(room, Team.Blue));

  for (const player of red.slice(ACTIVE_PLAYERS_PER_TEAM)) {
    setManagedTeam(room, player.id, Team.Spectator);
  }

  for (const player of blue.slice(ACTIVE_PLAYERS_PER_TEAM)) {
    setManagedTeam(room, player.id, Team.Spectator);
  }
}

function maybeFillSecondPair(room: HaxballRoom): void {
  const red = playersByTeam(room, Team.Red);
  const blue = playersByTeam(room, Team.Blue);
  const specs = orderedPlayers(playersByTeam(room, Team.Spectator));

  if (red.length === 1 && blue.length === 1 && specs.length >= 2) {
    setManagedTeam(room, specs[0].id, Team.Red);
    setManagedTeam(room, specs[1].id, Team.Blue);
    announce(room, `${specs[0].name} and ${specs[1].name} joined. Playing 2v2.`);
  }
}

function fillTeamFromSpectators(room: HaxballRoom, team: Team, targetSize: number): number {
  const currentSize = playersByTeam(room, team).length;
  const needed = Math.max(0, targetSize - currentSize);
  const specs = orderedPlayers(playersByTeam(room, Team.Spectator)).slice(0, needed);

  for (const spec of specs) {
    setManagedTeam(room, spec.id, team);
    announce(room, `${spec.name} moved to ${team === Team.Red ? 'red' : 'blue'} to fill the game.`);
  }

  return specs.length;
}

function ensureSoloPlayerStartsFromRed(room: HaxballRoom): boolean {
  const red = playersByTeam(room, Team.Red);
  const blue = playersByTeam(room, Team.Blue);

  if (red.length === 0 && blue.length === 1) {
    setManagedTeam(room, blue[0].id, Team.Red);
    console.log(`[Events] Solo player ${blue[0].name} moved from blue to red for training kickoff`);
    return true;
  }

  return false;
}

function normalizeActiveTeams(room: HaxballRoom, restartAfterFill = false): void {
  enforceActiveLimit(room);

  if (ensureSoloPlayerStartsFromRed(room)) {
    startOrRestartGame(room, true);
    return;
  }

  const red = playersByTeam(room, Team.Red);
  const blue = playersByTeam(room, Team.Blue);
  const specs = orderedPlayers(playersByTeam(room, Team.Spectator));

  if (red.length === 0 && blue.length === 0) {
    const firstSpec = specs[0];
    if (firstSpec) {
      setManagedTeam(room, firstSpec.id, Team.Red);
      startOrRestartGame(room, restartAfterFill);
    }
    return;
  }

  if (red.length < blue.length) {
    const moved = fillTeamFromSpectators(room, Team.Red, Math.min(blue.length, ACTIVE_PLAYERS_PER_TEAM));
    if (moved > 0) {
      setTimeout(() => normalizeActiveTeams(room, restartAfterFill), 250);
      return;
    }

    if (blue.length > 1) {
      const playerToSit = latestPlayer(blue);
      if (playerToSit) {
        setManagedTeam(room, playerToSit.id, Team.Spectator);
        announce(room, `${playerToSit.name} moved to spectators because no red replacement was available.`);
      }
    }
    startOrRestartGame(room, true);
    return;
  }

  if (blue.length < red.length) {
    const moved = fillTeamFromSpectators(room, Team.Blue, Math.min(red.length, ACTIVE_PLAYERS_PER_TEAM));
    if (moved > 0) {
      setTimeout(() => normalizeActiveTeams(room, restartAfterFill), 250);
      return;
    }

    if (red.length > 1) {
      const playerToSit = latestPlayer(red);
      if (playerToSit) {
        setManagedTeam(room, playerToSit.id, Team.Spectator);
        announce(room, `${playerToSit.name} moved to spectators because no blue replacement was available.`);
      }
    }
    startOrRestartGame(room, true);
    return;
  }

  if (red.length === 1 && blue.length === 1 && specs.length >= 2) {
    setManagedTeam(room, specs[0].id, Team.Red);
    setManagedTeam(room, specs[1].id, Team.Blue);
    announce(room, `${specs[0].name} and ${specs[1].name} joined. Playing 2v2.`);
    setTimeout(() => normalizeActiveTeams(room, restartAfterFill), 250);
    return;
  }

  if (!room.getScores() && (playersByTeam(room, Team.Red).length > 0 || playersByTeam(room, Team.Blue).length > 0)) {
    room.startGame();
    return;
  }

  if (restartAfterFill) {
    startOrRestartGame(room, true);
  }
}

function handleAutoJoin(room: HaxballRoom, player: RoomPlayer): void {
  if (selectionTeam != null) {
    setManagedTeam(room, player.id, Team.Spectator);
    setTimeout(() => announceSelectionChoices(room), 100);
    return;
  }

  const red = playersByTeam(room, Team.Red);
  const blue = playersByTeam(room, Team.Blue);

  if (red.length === 0 && blue.length === 0) {
    setManagedTeam(room, player.id, Team.Red);
    startOrRestartGame(room, false);
    return;
  }

  if (red.length === 1 && blue.length === 0) {
    setManagedTeam(room, player.id, Team.Blue);
    startOrRestartGame(room, true);
    return;
  }

  setManagedTeam(room, player.id, Team.Spectator);
  setTimeout(() => maybeFillSecondPair(room), 100);
}

function clearSelection(): void {
  if (selectionTimer) {
    clearTimeout(selectionTimer);
    selectionTimer = null;
  }

  selectionTeam = null;
  selectionCaptainId = null;
  selectionSlots = 0;
}

function armSelectionTimer(room: HaxballRoom): void {
  if (selectionTimer) {
    clearTimeout(selectionTimer);
  }

  selectionTimer = setTimeout(() => {
    if (selectionTeam == null || selectionCaptainId == null) {
      return;
    }

    const captain = room.getPlayer(selectionCaptainId);
    if (captain) {
      room.kickPlayer(captain.id, 'No teammate selected in 15 seconds.', false);
    }

    clearSelection();
    setTimeout(() => normalizeActiveTeams(room, true), 150);
  }, 15_000);
}

function announceSelectionChoices(room: HaxballRoom): void {
  if (selectionTeam == null || selectionCaptainId == null) {
    return;
  }

  const captain = room.getPlayer(selectionCaptainId);
  if (!captain || captain.team !== selectionTeam) {
    clearSelection();
    return;
  }

  if (selectionSlots <= 0) {
    clearSelection();
    startOrRestartGame(room, true);
    return;
  }

  const specs = orderedPlayers(playersByTeam(room, Team.Spectator));
  if (specs.length === 0) {
    announce(room, `${captain.name}, no selectable spectators are available yet. Waiting for a teammate.`);
    armSelectionTimer(room);
    return;
  }

  const choices = [0, 1]
    .map((index) => {
      const spec = specs[index];
      return `${index + 1}: ${spec ? spec.name : 'none'}`;
    })
    .join(' | ');
  const message = `${captain.name}, choose your teammate: ${choices}. Type 1 or 2 in 15 seconds.`;
  announce(room, message);
  announce(room, message, captain.id);
  armSelectionTimer(room);
}

function openLoserSelection(
  room: HaxballRoom,
  team: Team.Red | Team.Blue,
  slots: number,
  captain: RoomPlayer
): void {
  selectionTeam = team;
  selectionCaptainId = captain.id;
  selectionSlots = Math.max(0, slots - 1);

  setManagedTeam(room, captain.id, team);

  if (selectionSlots === 0) {
    setTimeout(() => {
      clearSelection();
      startOrRestartGame(room, true);
    }, 150);
    return;
  }

  setTimeout(() => announceSelectionChoices(room), 150);
}

function handleGameRotation(room: HaxballRoom): void {
  const scores = room.getScores();
  const winner = pendingWinner ?? winnerFromScores(scores);

  pendingWinner = null;

  if (winner !== Team.Red && winner !== Team.Blue) {
    return;
  }

  const loser = winner === Team.Red ? Team.Blue : Team.Red;
  const waitingPlayers = orderedPlayers(playersByTeam(room, Team.Spectator));
  const winnerSize = playersByTeam(room, winner).length;
  const losers = playersByTeam(room, loser);

  if (waitingPlayers.length === 0) {
    announce(room, 'No waiting spectators. Starting a rematch.');
    startOrRestartGame(room, true);
    return;
  }

  for (const player of losers) {
    setManagedTeam(room, player.id, Team.Spectator);
  }

  setTimeout(() => openLoserSelection(room, loser, Math.max(1, winnerSize), waitingPlayers[0]), 150);
}

function finishTrackedGame(room: HaxballRoom, byPlayer?: RoomPlayer | null): void {
  if (!isTrackedGameActive()) {
    if (!isResettingSoloGoal) {
      console.log('[Events] Untracked warm-up stopped');
    }
    return;
  }

  if (!isAnalyticsGameActive()) {
    if (!isResettingSoloGoal) {
      console.log('[Events] Live warm-up stopped');
    }
    endGame();
    return;
  }

  pendingWinner = pendingWinner ?? winnerFromScores(room.getScores());

  const event = createEvent('gameStop', getCurrentGameId());
  if (byPlayer) {
    event.playerId = byPlayer.id;
    event.playerName = byPlayer.name;
  }
  emitEvent(event);
  endGame();
  setTimeout(() => handleGameRotation(room), 100);
}

function handleSelectionMessage(room: HaxballRoom, player: RoomPlayer, message: string): boolean {
  if (selectionTeam == null || !['1', '2'].includes(message.trim())) {
    return false;
  }

  if (player.id !== selectionCaptainId) {
    announce(room, 'Only the replacement player can choose right now.', player.id);
    return true;
  }

  const index = Number.parseInt(message.trim(), 10) - 1;
  const selected = orderedPlayers(playersByTeam(room, Team.Spectator))[index];

  if (!selected) {
    announce(room, 'No spectator in that slot.');
    return true;
  }

  setManagedTeam(room, selected.id, selectionTeam);
  selectionSlots--;

  if (selectionSlots <= 0 || playersByTeam(room, selectionTeam).length >= ACTIVE_PLAYERS_PER_TEAM) {
    clearSelection();
    startOrRestartGame(room, true);
    return true;
  }

  setTimeout(() => announceSelectionChoices(room), 100);
  return true;
}

function canUseBruinChat(player: RoomPlayer): { allowed: boolean; message?: string } {
  if (process.env.ENABLE_BRUIN_CHAT === 'false') {
    return { allowed: false, message: 'Bruin Analyst is disabled for this room.' };
  }

  if (process.env.BRUIN_CHAT_ADMIN_ONLY === 'true' && !player.admin) {
    return { allowed: false, message: 'Bruin Analyst is admin-only right now.' };
  }

  const now = Date.now();
  const lastUsed = bruinChatLastUsed.get(player.id) || 0;
  const remainingMs = BRUIN_CHAT_COOLDOWN_MS - (now - lastUsed);

  if (remainingMs > 0) {
    return {
      allowed: false,
      message: `Bruin Analyst cooldown: wait ${Math.ceil(remainingMs / 1000)}s.`,
    };
  }

  bruinChatLastUsed.set(player.id, now);
  return { allowed: true };
}

async function handleBruinChatCommand(room: HaxballRoom, player: RoomPlayer, message: string): Promise<void> {
  console.log(`[BruinChat] Command received from ${player.name} (${player.id}): ${message}`);

  const permission = canUseBruinChat(player);
  if (!permission.allowed) {
    console.log(`[BruinChat] Command blocked for ${player.name}: ${permission.message}`);
    announceBruin(room, permission.message || 'Bruin Analyst is unavailable.', player.id);
    return;
  }

  announceBruinQuestion(room, player, message);

  try {
    const response = await answerBruinChatQuestion(message);
    announceBruin(room, response.answer);
    console.log(`[BruinChat] ${player.name}: ${response.question || '(help)'} -> ${response.intent}`);
  } catch (error) {
    const detail = (error as Error).message;
    console.error('[BruinChat] Analyst query failed:', error);
    announceBruin(room, `Bruin Analyst: query failed. ${detail.slice(0, 180)}`, player.id);
  }
}

function startInactivityMonitor(room: HaxballRoom): void {
  if (INACTIVITY_LIMIT_MS <= 0) {
    console.log('[Events] Inactivity kicking disabled');
    return;
  }

  if (inactivityTimer) {
    return;
  }

  inactivityTimer = setInterval(() => {
    const now = Date.now();

    for (const player of room.getPlayerList()) {
      if (player.team === Team.Spectator) {
        playerActivity.set(player.id, now);
        continue;
      }

      const lastActive = playerActivity.get(player.id) ?? now;
      playerActivity.set(player.id, lastActive);

      if (now - lastActive >= INACTIVITY_LIMIT_MS) {
        room.kickPlayer(player.id, 'Inactive for 1 minute.', false);
      }
    }
  }, INACTIVITY_CHECK_MS);
}

/**
 * Sets up all event handlers on the room
 */
export function setupEventHandlers(room: HaxballRoom): void {
  console.log('[Events] Setting up event handlers...');
  clearAllPlayerAdmins(room);

  // Game lifecycle events
  room.onGameStart = (byPlayer) => {
    pendingWinner = null;

    if (!hasCompetitiveTeams(room)) {
      startGame(false);
      console.log('[Events] Solo warm-up started - live map enabled, analytics tracking disabled until both teams have players');
      return;
    }

    const gameId = startGame();
    const event = createEvent('gameStart', gameId);
    if (byPlayer) {
      event.playerId = byPlayer.id;
      event.playerName = byPlayer.name;
    }
    emitEvent(event);
  };

  room.onGameStop = (byPlayer) => {
    finishTrackedGame(room, byPlayer);
  };

  room.onTeamVictory = (scores) => {
    pendingWinner = winnerFromScores(scores);
    console.log(
      `[Events] Team victory: ${scores.red}-${scores.blue}` +
      (pendingWinner ? ` (${pendingWinner === Team.Red ? 'red' : 'blue'})` : '')
    );
    finishTrackedGame(room);
  };

  // Goal events
  room.onTeamGoal = (team) => {
    if (!hasCompetitiveTeams(room) || !isAnalyticsGameActive()) {
      console.log('[Events] Solo warm-up goal ignored - resetting play');
      announce(room, `Solo warm-up goal ignored. ${SOLO_WARMUP_MESSAGE}`);

      if (!isResettingSoloGoal) {
        isResettingSoloGoal = true;
        setTimeout(() => {
          if (room.getScores()) {
            room.stopGame();
          }
          setTimeout(() => {
            isResettingSoloGoal = false;
            if (activePlayerCount(room) > 0 && !room.getScores()) {
              room.startGame();
            }
          }, 200);
        }, 100);
      }
      return;
    }

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

    const scores = room.getScores();
    if (scores && scores.scoreLimit > 0 && (scores.red >= scores.scoreLimit || scores.blue >= scores.scoreLimit)) {
      pendingWinner = team;
    }
  };

  // Player kick events (for shot/pass detection)
  room.onPlayerBallKick = (player) => {
    markActive(player.id);
    if (!hasCompetitiveTeams(room) || !isAnalyticsGameActive()) {
      return;
    }

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
    
    // Shot detection keeps raw kick tracking separate from goalward chances.
    // Long Haxball shots can start from either half, so the shot tracker also
    // keeps recent dangerous kicks for goal recovery.
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
    playerJoinOrder.set(player.id, ++joinSequence);
    markActive(player.id);
    const event = createEvent('join', getCurrentGameId());
    event.playerId = player.id;
    event.playerName = player.name;
    event.metadata = { auth: player.auth };
    emitEvent(event);
    
    console.log(`[Events] Player joined: ${player.name} (ID: ${player.id})`);
    if (room.getPlayerList().length === 1) {
      announce(room, SOLO_WARMUP_MESSAGE, player.id);
      setTimeout(() => announceDashboard(room, player.id), 5_000);
    } else {
      announceDashboard(room, player.id);
    }
    clearPlayerAdmin(room, player);
    handleAutoJoin(room, player);
    enforceActiveLimit(room);
  };

  room.onPlayerLeave = (player) => {
    const oldTeam = player.team;
    const event = createEvent('leave', getCurrentGameId());
    event.playerId = player.id;
    event.playerName = player.name;
    event.team = player.team;
    emitEvent(event);
    
    console.log(`[Events] Player left: ${player.name} (ID: ${player.id})`);
    playerJoinOrder.delete(player.id);
    playerActivity.delete(player.id);
    bruinChatLastUsed.delete(player.id);

  if (player.id === selectionCaptainId) {
      clearSelection();
    }

    if (oldTeam === Team.Red || oldTeam === Team.Blue) {
      setTimeout(() => normalizeActiveTeams(room), 100);
    } else if (selectionTeam != null) {
      setTimeout(() => announceSelectionChoices(room), 100);
    }
  };

  room.onPlayerActivity = (player) => {
    markActive(player.id);
  };

  room.onPlayerChat = (player, message) => {
    markActive(player.id);

    if (isBruinChatCommand(message)) {
      void handleBruinChatCommand(room, player, message);
      return false;
    }

    return !handleSelectionMessage(room, player, message);
  };

  room.onPlayerTeamChange = (changedPlayer) => {
    markActive(changedPlayer.id);

    if (!isManagingTeams && changedPlayer.team !== Team.Spectator) {
      setManagedTeam(room, changedPlayer.id, Team.Spectator);
      announce(room, 'Teams are managed automatically.', changedPlayer.id);
      return;
    }

    enforceActiveLimit(room);
  };

  room.onPlayerAdminChange = (changedPlayer) => {
    clearPlayerAdmin(room, changedPlayer);
  };

  startInactivityMonitor(room);

  console.log('[Events] Event handlers ready');
}
