'use strict';

require('dotenv').config();

const app    = require('./src/server');
const logger = require('./src/logger');
const cache  = require('./src/cache');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  logger.info('server_start', {
    url:      `http://${HOST}:${PORT}`,
    auth:     process.env.API_KEY ? 'enabled' : 'disabled',
    cacheTtl: `${process.env.CACHE_TTL_DAYS || 30}d`,
  });
});

// --- Graceful shutdown -------------------------------------------------------
// On SIGTERM/SIGINT, stop accepting new connections and wait for in-flight
// requests to complete before exiting. Critical for zero-downtime deploys.

function shutdown(signal) {
  logger.info('shutdown_signal', { signal });

  server.close(() => {
    logger.info('server_closed');
    cache.saveToDisk();
    process.exit(0);
  });

  // Safety net: force-exit if connections don't drain within 10 s
  setTimeout(() => {
    logger.error('shutdown_timeout', { msg: 'forcing exit after 10s' });
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// --- Unhandled errors --------------------------------------------------------

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('uncaught_exception', { message: err.message, stack: err.stack });
  process.exit(1);
});
