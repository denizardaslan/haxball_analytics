/**
 * Haxball Analytics - File Writer
 * Writes game data to daily JSONL files for later Parquet conversion
 * 
 * File Structure:
 *   data/snapshots/2026-01-27.jsonl
 *   data/events/2026-01-27.jsonl
 * 
 * The JSONL files are append-friendly during gameplay, then converted
 * to Parquet format for fast analytics with DuckDB.
 * 
 * Features:
 * - Automatic stream recovery on errors
 * - Buffered writes for failed data
 * - Error logging without crashes
 */

import * as fs from 'fs';
import * as path from 'path';
import { subscribe } from './publisher';
import type { GameSnapshot, GameEvent } from './types';

// Base data directory
const DATA_DIR = path.join(process.cwd(), 'data');
const SNAPSHOTS_DIR = path.join(DATA_DIR, 'snapshots');
const EVENTS_DIR = path.join(DATA_DIR, 'events');
const ERROR_LOG_PATH = path.join(DATA_DIR, 'file-writer-errors.log');

// Active file handles (keyed by date)
const snapshotStreams: Map<string, fs.WriteStream> = new Map();
const eventStreams: Map<string, fs.WriteStream> = new Map();

// Retry buffer for failed writes
const retryBuffer: Array<{ type: 'snapshot' | 'event'; data: unknown; date: string }> = [];
const MAX_RETRY_BUFFER = 1000;

// Unsubscribe function
let unsubscribe: (() => void) | null = null;

// Stats
let snapshotCount = 0;
let eventCount = 0;
let errorCount = 0;
let retryCount = 0;

/**
 * Gets today's date as YYYY-MM-DD string
 */
function getDateString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Ensures directories exist
 */
function ensureDirectories(): void {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    console.log('[FileWriter] Created directory:', SNAPSHOTS_DIR);
  }
  if (!fs.existsSync(EVENTS_DIR)) {
    fs.mkdirSync(EVENTS_DIR, { recursive: true });
    console.log('[FileWriter] Created directory:', EVENTS_DIR);
  }
}

/**
 * Logs file writer errors
 */
function logFileError(context: string, error: Error, data?: unknown): void {
  errorCount++;
  
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      context,
      error: error.message,
      data: data ? JSON.stringify(data).slice(0, 200) : undefined,
    };
    
    fs.appendFileSync(ERROR_LOG_PATH, JSON.stringify(logEntry) + '\n');
  } catch {
    // Ignore logging errors to prevent infinite loops
  }
}

/**
 * Creates a write stream with error handling
 */
function createStream(filePath: string, streamMap: Map<string, fs.WriteStream>, date: string): fs.WriteStream {
  const stream = fs.createWriteStream(filePath, { flags: 'a' });
  
  stream.on('error', (error) => {
    console.error(`[FileWriter] Stream error for ${filePath}:`, error.message);
    logFileError(`stream:${filePath}`, error);
    
    // Remove the broken stream so it can be recreated
    streamMap.delete(date);
  });
  
  return stream;
}

/**
 * Gets or creates a write stream for snapshots for the given date
 */
function getSnapshotStream(date: string): fs.WriteStream | null {
  let stream = snapshotStreams.get(date);
  if (!stream) {
    try {
      const filePath = path.join(SNAPSHOTS_DIR, `${date}.jsonl`);
      stream = createStream(filePath, snapshotStreams, date);
      snapshotStreams.set(date, stream);
      console.log('[FileWriter] Opened snapshot file:', filePath);
    } catch (error) {
      logFileError('createSnapshotStream', error as Error);
      return null;
    }
  }
  return stream;
}

/**
 * Gets or creates a write stream for events for the given date
 */
function getEventStream(date: string): fs.WriteStream | null {
  let stream = eventStreams.get(date);
  if (!stream) {
    try {
      const filePath = path.join(EVENTS_DIR, `${date}.jsonl`);
      stream = createStream(filePath, eventStreams, date);
      eventStreams.set(date, stream);
      console.log('[FileWriter] Opened event file:', filePath);
    } catch (error) {
      logFileError('createEventStream', error as Error);
      return null;
    }
  }
  return stream;
}

/**
 * Adds data to retry buffer
 */
function addToRetryBuffer(type: 'snapshot' | 'event', data: unknown, date: string): void {
  if (retryBuffer.length < MAX_RETRY_BUFFER) {
    retryBuffer.push({ type, data, date });
  } else {
    console.warn('[FileWriter] Retry buffer full, dropping data');
    logFileError('bufferFull', new Error('Retry buffer full'), data);
  }
}

/**
 * Processes retry buffer - attempts to write buffered data
 */
function processRetryBuffer(): void {
  if (retryBuffer.length === 0) return;
  
  const itemsToRetry = [...retryBuffer];
  retryBuffer.length = 0;
  
  for (const item of itemsToRetry) {
    if (item.type === 'snapshot') {
      writeSnapshot(item.data as GameSnapshot, true);
    } else {
      writeEvent(item.data as GameEvent, true);
    }
  }
  
  if (itemsToRetry.length > 0) {
    retryCount += itemsToRetry.length;
    console.log(`[FileWriter] Retried ${itemsToRetry.length} buffered items`);
  }
}

/**
 * Writes a snapshot to the daily JSONL file
 */
function writeSnapshot(snapshot: GameSnapshot, isRetry = false): void {
  const date = getDateString();
  const stream = getSnapshotStream(date);
  
  if (!stream) {
    if (!isRetry) {
      addToRetryBuffer('snapshot', snapshot, date);
    }
    return;
  }
  
  try {
    const success = stream.write(JSON.stringify(snapshot) + '\n');
    if (success) {
      snapshotCount++;
      // Try processing retry buffer on successful writes
      if (!isRetry && retryBuffer.length > 0) {
        processRetryBuffer();
      }
    } else {
      // Stream buffer full, will drain automatically
      stream.once('drain', () => {
        if (retryBuffer.length > 0) {
          processRetryBuffer();
        }
      });
    }
  } catch (error) {
    console.error('[FileWriter] Error writing snapshot:', (error as Error).message);
    logFileError('writeSnapshot', error as Error, snapshot);
    if (!isRetry) {
      addToRetryBuffer('snapshot', snapshot, date);
    }
  }
}

/**
 * Writes an event to the daily JSONL file
 */
function writeEvent(event: GameEvent, isRetry = false): void {
  const date = getDateString();
  const stream = getEventStream(date);
  
  if (!stream) {
    if (!isRetry) {
      addToRetryBuffer('event', event, date);
    }
    return;
  }
  
  try {
    const success = stream.write(JSON.stringify(event) + '\n');
    if (success) {
      eventCount++;
      // Try processing retry buffer on successful writes
      if (!isRetry && retryBuffer.length > 0) {
        processRetryBuffer();
      }
    }
  } catch (error) {
    console.error('[FileWriter] Error writing event:', (error as Error).message);
    logFileError('writeEvent', error as Error, event);
    if (!isRetry) {
      addToRetryBuffer('event', event, date);
    }
  }
}

/**
 * Handles incoming data from the publisher
 */
function handleData(type: 'snapshot' | 'event', data: GameSnapshot | GameEvent): void {
  if (type === 'snapshot') {
    writeSnapshot(data as GameSnapshot);
  } else if (type === 'event') {
    writeEvent(data as GameEvent);
  }
}

/**
 * Initializes the file writer and subscribes to the publisher
 */
export function initFileWriter(): void {
  if (process.env.ENABLE_FILE_WRITER !== 'true') {
    console.log('[FileWriter] File writer disabled (set ENABLE_FILE_WRITER=true to enable)');
    return;
  }

  ensureDirectories();
  
  // Subscribe to publisher for real-time data
  unsubscribe = subscribe(handleData);
  
  console.log('[FileWriter] Initialized - writing to daily JSONL files');
  console.log('[FileWriter] Snapshots:', SNAPSHOTS_DIR);
  console.log('[FileWriter] Events:', EVENTS_DIR);
}

/**
 * Closes all file streams and unsubscribes from publisher
 */
export function closeFileWriter(): void {
  // Unsubscribe from publisher
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  // Close all snapshot streams
  for (const [date, stream] of snapshotStreams) {
    stream.end();
    console.log(`[FileWriter] Closed snapshot file for ${date}`);
  }
  snapshotStreams.clear();

  // Close all event streams
  for (const [date, stream] of eventStreams) {
    stream.end();
    console.log(`[FileWriter] Closed event file for ${date}`);
  }
  eventStreams.clear();

  console.log(`[FileWriter] Closed - wrote ${snapshotCount} snapshots, ${eventCount} events`);
}

/**
 * Waits for currently buffered stream writes to reach the filesystem.
 */
export function flushFileWriter(): Promise<void> {
  const streams = [...snapshotStreams.values(), ...eventStreams.values()];
  if (streams.length === 0) {
    return Promise.resolve();
  }

  return Promise.all(streams.map((stream) => new Promise<void>((resolve) => {
    stream.write('', () => resolve());
  }))).then(() => undefined);
}

/**
 * Gets the current write statistics
 */
export function getFileWriterStats(): {
  snapshots: number;
  events: number;
  errors: number;
  retries: number;
  bufferSize: number;
} {
  return {
    snapshots: snapshotCount,
    events: eventCount,
    errors: errorCount,
    retries: retryCount,
    bufferSize: retryBuffer.length,
  };
}

/**
 * Lists all JSONL files in the data directories
 */
export function listJSONLFiles(): { snapshots: string[]; events: string[] } {
  ensureDirectories();

  const snapshotFiles = fs.readdirSync(SNAPSHOTS_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();

  const eventFiles = fs.readdirSync(EVENTS_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();

  return { snapshots: snapshotFiles, events: eventFiles };
}

/**
 * Lists all Parquet files in the data directories
 */
export function listParquetFiles(): { snapshots: string[]; events: string[] } {
  ensureDirectories();

  const snapshotFiles = fs.readdirSync(SNAPSHOTS_DIR)
    .filter((f) => f.endsWith('.parquet'))
    .sort();

  const eventFiles = fs.readdirSync(EVENTS_DIR)
    .filter((f) => f.endsWith('.parquet'))
    .sort();

  return { snapshots: snapshotFiles, events: eventFiles };
}
