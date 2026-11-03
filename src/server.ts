import 'dotenv/config';

import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createContainer } from './container.js';
import { seedDemoData } from './db/seed.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
const container = createContainer(config);
const { logger } = container;

if (config.seedDemoData) await seedDemoData(container);

const app = createApp(container);
const server = app.listen(config.PORT, config.HOST, () => {
  logger.info(`API listening on http://localhost:${config.PORT}/api/v1 (${config.NODE_ENV})`);
  if (config.apiDocsEnabled) logger.info(`API docs at http://localhost:${config.PORT}/api/docs`);
});

// Keep-alive must outlive the load balancer's idle timeout (often 60s), or it
// may reuse a connection the server just closed and return a 502.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

let shuttingDown = false;

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests
 * finish, release resources, then exit. Containers send SIGTERM on deploy.
 */
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);

  setTimeout(() => {
    logger.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  server.close(() => {
    void container
      .dispose()
      .catch((err: unknown) => {
        logger.error({ err }, 'Error while releasing resources');
      })
      .finally(() => {
        logger.info('Shutdown complete');
        process.exit(0);
      });
  });
  // Idle keep-alive connections would otherwise hold `close` open.
  server.closeIdleConnections();
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});

// A crash with unknown state is safer than limping on: log it and let the
// orchestrator restart the process.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});
