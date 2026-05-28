/**
 * Haxball Analytics - Local Backup
 * Saves game data to local JSON files for debugging and backup
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GameSnapshot, GameEvent } from './types';

// Data directory path
const DATA_DIR = path.join(process.cwd(), 'data');

// File handles for current session
let snapshotStream: fs.WriteStream | null = null;
let eventStream: fs.WriteStream | null = null;
let sessionId: string | null = null;

/**
 * Ensures the data directory exists
 */
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('[Backup] Created data directory:', DATA_DIR);
  }
}

/**
 * Starts a new backup session
 */
export function startBackupSession(): void {
  if (!process.env.ENABLE_LOCAL_BACKUP || process.env.ENABLE_LOCAL_BACKUP !== 'true') {
    console.log('[Backup] Local backup disabled');
    return;
  }

  ensureDataDir();

  // Create session ID from timestamp
  sessionId = new Date().toISOString().replace(/[:.]/g, '-');
  
  // Create file streams for snapshots and events
  const snapshotPath = path.join(DATA_DIR, `snapshots_${sessionId}.jsonl`);
  const eventPath = path.join(DATA_DIR, `events_${sessionId}.jsonl`);

  snapshotStream = fs.createWriteStream(snapshotPath, { flags: 'a' });
  eventStream = fs.createWriteStream(eventPath, { flags: 'a' });

  console.log('[Backup] Session started:', sessionId);
  console.log('[Backup] Snapshots:', snapshotPath);
  console.log('[Backup] Events:', eventPath);
}

/**
 * Writes a snapshot to the backup file
 */
export function backupSnapshot(snapshot: GameSnapshot): void {
  if (!snapshotStream) return;
  
  try {
    snapshotStream.write(JSON.stringify(snapshot) + '\n');
  } catch (error) {
    console.error('[Backup] Error writing snapshot:', error);
  }
}

/**
 * Writes an event to the backup file
 */
export function backupEvent(event: GameEvent): void {
  if (!eventStream) return;
  
  try {
    eventStream.write(JSON.stringify(event) + '\n');
  } catch (error) {
    console.error('[Backup] Error writing event:', error);
  }
}

/**
 * Closes the backup session
 */
export function closeBackupSession(): void {
  if (snapshotStream) {
    snapshotStream.end();
    snapshotStream = null;
  }
  if (eventStream) {
    eventStream.end();
    eventStream = null;
  }
  if (sessionId) {
    console.log('[Backup] Session closed:', sessionId);
    sessionId = null;
  }
}

/**
 * Gets list of backup files
 */
export function listBackupFiles(): { snapshots: string[]; events: string[] } {
  ensureDataDir();
  
  const files = fs.readdirSync(DATA_DIR);
  
  return {
    snapshots: files.filter((f) => f.startsWith('snapshots_')),
    events: files.filter((f) => f.startsWith('events_')),
  };
}
