import 'dotenv/config';
import { startDebugServer, stopDebugServer, getDebugServerConfig } from './debug-server';

process.env.ENABLE_DEBUG_DASHBOARD = 'true';

startDebugServer(getDebugServerConfig());

process.on('SIGINT', () => {
  stopDebugServer();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopDebugServer();
  process.exit(0);
});
