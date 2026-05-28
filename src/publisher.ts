/**
 * Haxball Analytics - Data Publisher
 * Validates live room data and fans it out to in-process subscribers.
 *
 * The competition architecture keeps live collection simple: Node.js writes
 * JSONL files and Bruin handles durable analytics in DuckDB.
 */

import type { GameSnapshot, GameEvent } from './types';
import { validateSnapshot, validateEvent } from './validation';

let isConnected = false;

// Stats
let publishedSnapshots = 0;
let publishedEvents = 0;
let failedPublishes = 0;

// In-memory live stream for WebSocket and file-writer subscribers.
type QueueCallback = (type: 'snapshot' | 'event', data: any) => void;
const subscribers: QueueCallback[] = [];

/**
 * Subscribe to the live in-memory event stream.
 */
export function subscribe(callback: QueueCallback): () => void {
  subscribers.push(callback);
  return () => {
    const index = subscribers.indexOf(callback);
    if (index > -1) subscribers.splice(index, 1);
  };
}

/**
 * Notify all in-memory subscribers
 */
function notifySubscribers(type: 'snapshot' | 'event', data: any): void {
  for (const callback of subscribers) {
    try {
      callback(type, data);
    } catch (error) {
      console.error('[Publisher] Subscriber error:', error);
    }
  }
}

/**
 * Initializes the publisher.
 */
export async function initPublisher(): Promise<void> {
  console.log('[Publisher] Using in-memory live stream');
  console.log('[Publisher] Durable analytics are handled by JSONL + Bruin + DuckDB');
  isConnected = true;
}

/**
 * Publishes a game snapshot
 */
export async function publishSnapshot(snapshot: GameSnapshot): Promise<void> {
  if (!isConnected) return;

  // Validate snapshot
  const validation = validateSnapshot(snapshot);
  if (!validation.valid) {
    console.warn('[Publisher] Invalid snapshot skipped:', validation.errors.join(', '));
    failedPublishes++;
    return;
  }

  // Log warnings but continue
  if (validation.warnings.length > 0) {
    console.debug('[Publisher] Snapshot warnings:', validation.warnings.join(', '));
  }

  notifySubscribers('snapshot', snapshot);
  publishedSnapshots++;
}

/**
 * Publishes a game event
 */
export async function publishEvent(event: GameEvent): Promise<void> {
  if (!isConnected) return;

  // Validate event
  const validation = validateEvent(event);
  if (!validation.valid) {
    console.warn('[Publisher] Invalid event skipped:', validation.errors.join(', '));
    failedPublishes++;
    return;
  }

  // Log warnings but continue
  if (validation.warnings.length > 0) {
    console.debug('[Publisher] Event warnings:', validation.warnings.join(', '));
  }

  notifySubscribers('event', event);
  publishedEvents++;
}

/**
 * Closes the publisher connection
 */
export async function closePublisher(): Promise<void> {
  if (!isConnected) return;

  subscribers.length = 0;
  isConnected = false;
  console.log('[Publisher] Publisher closed');
}

/**
 * Check if publisher is connected
 */
export function isPublisherConnected(): boolean {
  return isConnected;
}

/**
 * Get publisher mode description
 */
export function getPublisherMode(): string {
  if (!isConnected) return 'disconnected';
  return 'in-memory';
}

/**
 * Get publisher statistics
 */
export function getPublisherStats(): {
  snapshots: number;
  events: number;
  failed: number;
  mode: string;
} {
  return {
    snapshots: publishedSnapshots,
    events: publishedEvents,
    failed: failedPublishes,
    mode: getPublisherMode(),
  };
}
