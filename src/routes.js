'use strict';

const { Router } = require('express');
const cache  = require('./cache');
const logger = require('./logger');
const { fetchLinkedBundles } = require('./robloxApi');

const router = Router();

// Tracks in-progress Roblox fetches so duplicate concurrent requests for the
// same uncached asset share one outbound HTTP call instead of hammering the API.
const inFlight = new Map(); // assetId (string) -> Promise<bundle[]>

/**
 * GET /api/bundles/:assetId  —  GetLinkedBundlesAsync
 *
 * Response shape:
 * {
 *   assetId: string,
 *   source: "cache" | "roblox",
 *   cachedAt: ISO string,
 *   bundles: [{ id, name, bundleType, items: [{ id, name, type, assetType }] }]
 * }
 */
router.get('/bundles/:assetId', async (req, res) => {
  const assetId = req.params.assetId;

  if (!/^\d+$/.test(assetId)) {
    return res.status(400).json({ error: 'assetId must be a numeric string' });
  }

  // --- Cache hit ---
  const assetEntry = cache.getAssetEntry(assetId);
  if (assetEntry) {
    const bundles = assetEntry.bundleIds
      .map(id => cache.getBundleEntry(id))
      .filter(Boolean);

    logger.info('cache_hit', { assetId, bundleCount: bundles.length });

    return res.json({ assetId, bundles });
  }

  // --- In-flight deduplication ---
  // If another request is already fetching this assetId, wait for it instead
  // of firing a second Roblox API call.
  if (inFlight.has(assetId)) {
    logger.info('cache_dedup', { assetId });
    try {
      const rawBundles = await inFlight.get(assetId);
      return res.json({ assetId, bundles: rawBundles });
    } catch (err) {
      return res.status(502).json({ error: 'Failed to fetch data from Roblox API', detail: err.message });
    }
  }

  // --- Cache miss: fetch from Roblox ---
  logger.info('cache_miss', { assetId });

  const fetchPromise = fetchLinkedBundles(assetId)
    .then(rawBundles => {
      for (const bundle of rawBundles) cache.setBundleEntry(bundle);
      cache.setAssetEntry(assetId, rawBundles.map(b => b.id));
      logger.info('roblox_fetched', { assetId, bundleCount: rawBundles.length });
      return rawBundles;
    })
    .catch(err => {
      logger.error('roblox_fetch_failed', { assetId, error: err.message });
      throw err;
    })
    .finally(() => {
      inFlight.delete(assetId);
    });

  inFlight.set(assetId, fetchPromise);

  try {
    const rawBundles = await fetchPromise;
    return res.json({ assetId, bundles: rawBundles });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch data from Roblox API', detail: err.message });
  }
});

/**
 * GET /api/cache/stats
 */
router.get('/cache/stats', (_req, res) => {
  const stats = cache.getStats();
  logger.info('cache_stats_requested', stats);
  res.json(stats);
});

module.exports = router;
