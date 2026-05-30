/**
 * Haxball Analytics - Main Entry Point
 * Initializes all components and starts the application
 */

import 'dotenv/config';
import { createRoom, getRoomConfig } from './room';
import { setupCollector, onSnapshot, isCurrentGameAnalyticsEnabled } from './collector';
import { setupEventHandlers, onEvent } from './events';
import { startBackupSession, backupSnapshot, backupEvent, closeBackupSession } from './backup';
import { initPublisher, publishSnapshot, publishEvent, closePublisher } from './publisher';
import { initFileWriter, closeFileWriter, flushFileWriter } from './file-writer';
import { startDebugServer, broadcastSnapshot, broadcastEvent, stopDebugServer, getDebugServerConfig } from './debug-server';
import { triggerAnalyticsRefresh } from './analytics-refresh';

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  console.log('========================================');
  console.log('   HAXBALL ANALYTICS - Starting...     ');
  console.log('========================================');
  console.log('');

  try {
    // Initialize components
    await initPublisher();
    startBackupSession();
    initFileWriter();
    startDebugServer(getDebugServerConfig());

    // Get room configuration
    const roomConfig = getRoomConfig();
    console.log('');
    console.log('[Main] Room configuration:');
    console.log(`  - Name: ${roomConfig.roomName}`);
    console.log(`  - Max Players: ${roomConfig.maxPlayers}`);
    console.log(`  - Public: ${roomConfig.public}`);
    console.log('');

    // Create the Haxball room
    const room = await createRoom(roomConfig);

    // Set up data collection
    setupCollector(room);

    // Set up event handlers
    setupEventHandlers(room);

    // Register snapshot handlers
    onSnapshot((snapshot) => {
      // Console log (limited output)
      if (snapshot.tickNumber % 60 === 0) {
        // Log every 30 seconds
        console.log(
          `[Snapshot] Game: ${snapshot.gameId.slice(0, 8)}... | ` +
          `Time: ${snapshot.gameTime.toFixed(1)}s | ` +
          `Score: ${snapshot.score.red}-${snapshot.score.blue} | ` +
          `Players: ${snapshot.players.length}`
        );
      }

      // Warm-up snapshots feed the live map only; competitive snapshots also feed durable analytics.
      if (isCurrentGameAnalyticsEnabled()) {
        backupSnapshot(snapshot);
        publishSnapshot(snapshot);
      }
      broadcastSnapshot(snapshot);
    });

    // Register event handlers
    onEvent((event) => {
      // Send to all outputs
      backupEvent(event);
      publishEvent(event);
      broadcastEvent(event);

      if (event.eventType === 'gameStop') {
        void (async () => {
          try {
            await flushFileWriter();
            const status = await triggerAnalyticsRefresh('gameStop event');
            console.log(`[Main] Analytics refresh ${status.state}: ${status.message}`);
          } catch (error) {
            console.error('[Main] Analytics refresh failed:', error);
          }
        })();
      }
    });

    // Get room link
    room.onRoomLink = (link: string) => {
      console.log('');
      console.log('========================================');
      console.log('   ROOM IS READY!                      ');
      console.log('========================================');
      console.log('');
      console.log(`Room Link: ${link}`);
      console.log('');
      console.log('Debug Dashboard: http://localhost:' + (process.env.DEBUG_HTTP_PORT || '3000'));
      console.log('');
      console.log('Waiting for players...');
      console.log('');
    };

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('');
      console.log('[Main] Shutting down...');
      
      stopDebugServer();
      closeFileWriter();
      closeBackupSession();
      await closePublisher();
      
      console.log('[Main] Goodbye!');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error('[Main] Fatal error:', error);
    process.exit(1);
  }
}

// Start the application
main().catch((error) => {
  console.error('[Main] Unhandled error:', error);
  process.exit(1);
});
