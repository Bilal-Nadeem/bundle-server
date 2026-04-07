'use strict';

const fs   = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');

const logger = require('./logger');
const stats  = require('./stats');

const ROBLOX_BUNDLES_URL = 'https://catalog.roblox.com/v1/assets/%s/bundles?limit=100&sortOrder=Asc';
const MAX_RETRIES        = 3;
const TIMEOUT_MS         = 4_000; // fail fast so retries happen quickly

// ── Proxy setup ───────────────────────────────────────────────────────────────

let proxyConfig = { enabled: false, proxies: [] };
const proxyConfigPath = path.join(__dirname, '..', 'proxies.json');
if (fs.existsSync(proxyConfigPath)) {
  proxyConfig = JSON.parse(fs.readFileSync(proxyConfigPath, 'utf8'));
}

const proxyPool = proxyConfig.enabled
  ? [
      ...proxyConfig.proxies.map(host => {
        const url   = `http://${proxyConfig.username}:${proxyConfig.password}@${host}`;
        const agent = new HttpsProxyAgent(url);
        stats.proxies[host] = { requests: 0, successes: 0, rateLimits: 0, errors: 0 };
        return { host, agent };
      }),
      ...(proxyConfig.useDirect
        ? [(() => {
            stats.proxies['direct'] = { requests: 0, successes: 0, rateLimits: 0, errors: 0 };
            return { host: 'direct', agent: null };
          })()]
        : []),
    ]
  : [];

let proxyIndex = 0;

function getNextProxy() {
  if (proxyPool.length === 0) return null;
  const entry = proxyPool[proxyIndex % proxyPool.length];
  proxyIndex++;
  return entry;
}

// ── Concurrency limiter ───────────────────────────────────────────────────────
// Caps simultaneous outbound Roblox requests so we don't flood all proxies at
// once during cold-start bursts. Queued fetches run as soon as a slot opens.

class Semaphore {
  constructor(limit) {
    this._limit  = limit;
    this._active = 0;
    this._queue  = [];
  }
  acquire() {
    if (this._active < this._limit) { this._active++; return Promise.resolve(); }
    return new Promise(resolve => this._queue.push(resolve));
  }
  release() {
    this._active--;
    if (this._queue.length > 0) { this._active++; this._queue.shift()(); }
  }
  get queued()  { return this._queue.length; }
  get active()  { return this._active; }
}

// Allow 2 concurrent requests per proxy slot — enough throughput without bursting
const MAX_CONCURRENT = Math.max(proxyPool.length * 2, 6);
const sem = new Semaphore(MAX_CONCURRENT);

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function _fetch(assetId) {
  const url = ROBLOX_BUNDLES_URL.replace('%s', encodeURIComponent(assetId));
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const proxy    = getNextProxy();
    const proxyKey = proxy?.host ?? 'direct';

    stats.roblox.requests++;
    if (stats.proxies[proxyKey]) stats.proxies[proxyKey].requests++;

    logger.info('roblox_request', { assetId, proxy: proxyKey, attempt });

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        agent:   proxy?.agent ?? undefined,
        signal:  controller.signal,
        headers: {
          'Accept':     'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        },
      });

      clearTimeout(timer);

      if (response.status === 429 || response.status === 503) {
        stats.roblox.rateLimits++;
        if (stats.proxies[proxyKey]) stats.proxies[proxyKey].rateLimits++;
        logger.warn('roblox_rate_limited', { assetId, status: response.status, proxy: proxyKey, attempt });
        lastError = new Error(`Roblox API returned ${response.status} for asset ${assetId}`);
        continue;
      }

      if (!response.ok) {
        stats.roblox.errors++;
        if (stats.proxies[proxyKey]) stats.proxies[proxyKey].errors++;
        logger.error('roblox_api_error', { assetId, status: response.status, proxy: proxyKey });
        throw new Error(`Roblox API returned ${response.status} for asset ${assetId}`);
      }

      const body = await response.json();
      if (!Array.isArray(body.data)) throw new Error('Unexpected Roblox API response shape');

      stats.roblox.successes++;
      if (attempt > 1) stats.roblox.retries++;
      if (stats.proxies[proxyKey]) stats.proxies[proxyKey].successes++;

      logger.info('roblox_fetched', { assetId, bundleCount: body.data.length, proxy: proxyKey, attempt });

      return body.data.map(bundle => ({
        id:         bundle.id,
        name:       bundle.name,
        bundleType: bundle.bundleType,
        items: (bundle.items || [])
          .filter(item => item.type !== 'UserOutfit')
          .map(item => ({
            id:        item.id,
            name:      item.name,
            type:      item.type,
            assetType: item.assetType ?? null,
          })),
      }));

    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      stats.roblox.errors++;
      if (stats.proxies[proxyKey]) stats.proxies[proxyKey].errors++;

      if (err.name === 'AbortError') {
        logger.warn('roblox_timeout', { assetId, proxy: proxyKey, attempt });
      } else if (!err.message.includes('429') && !err.message.includes('503')) {
        logger.error('roblox_fetch_failed', { assetId, proxy: proxyKey, error: err.message });
      }
    }
  }

  throw lastError ?? new Error(`All ${MAX_RETRIES} attempts failed for asset ${assetId}`);
}

async function fetchLinkedBundles(assetId) {
  await sem.acquire();
  try {
    return await _fetch(assetId);
  } finally {
    sem.release();
  }
}

module.exports = { fetchLinkedBundles, proxyPool, sem };
