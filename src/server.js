'use strict';

const express = require('express');
const logger  = require('./logger');
const cache   = require('./cache');
const stats   = require('./stats');
const routes  = require('./routes');
const { proxyPool } = require('./robloxApi');

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

// Health check (no auth) — always responds quickly, no external calls
app.get('/health', (_req, res) => {
  try {
    const uptimeSec = process.uptime();
    const h = Math.floor(uptimeSec / 3600);
    const m = Math.floor((uptimeSec % 3600) / 60);
    const s = Math.floor(uptimeSec % 60);
    const uptime = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;

    const totalRoblox = stats.roblox.requests;
    const successRate = totalRoblox > 0
      ? ((stats.roblox.successes / totalRoblox) * 100).toFixed(1) + '%'
      : 'n/a';

    const proxySummary = Object.entries(stats.proxies).map(([host, p]) => ({
      host,
      requests:    p.requests,
      successes:   p.successes,
      rateLimits:  p.rateLimits,
      errors:      p.errors,
      successRate: p.requests > 0 ? ((p.successes / p.requests) * 100).toFixed(1) + '%' : 'n/a',
    }));

    res.json({
      status:     'ok',
      uptime,
      cache:      cache.getStats(),
      requests:   stats.requests,
      roblox:     { ...stats.roblox, successRate },
      proxies:    proxySummary,
      proxyCount: proxyPool.length,
      windowed:   stats.getWindowed(),
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 404 catch-all
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  logger.error('unhandled_error', { message: err.message, stack: err.stack });
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
