'use strict';

const express = require('express');
const logger  = require('./logger');
const cache   = require('./cache');
const routes  = require('./routes');

const app = express();

app.use(express.json());

// --- Request logging ---------------------------------------------------------
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const meta = { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start };
    if (res.statusCode >= 500) logger.error('request', meta);
    else if (res.statusCode >= 400) logger.warn('request', meta);
    else logger.info('request', meta);
  });
  next();
});

// --- API key auth ------------------------------------------------------------
const API_KEY = process.env.API_KEY;

app.use('/api', (req, res, next) => {
  if (!API_KEY) return next();
  const provided = req.headers['x-api-key'];
  if (!provided || provided !== API_KEY) {
    logger.warn('auth_failed', { path: req.path, ip: req.ip });
    return res.status(401).json({ error: 'Unauthorized: invalid or missing x-api-key header' });
  }
  next();
});

app.use('/api', routes);

// Health check (no auth) — includes uptime and cache stats for monitoring
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    cache: cache.getStats(),
  });
});

// 404 catch-all
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  logger.error('unhandled_error', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
