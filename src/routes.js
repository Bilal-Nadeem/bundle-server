'use strict';

const { Router } = require('express');
const cache  = require('./cache');
const logger = require('./logger');
const stats  = require('./stats');
const { fetchLinkedBundles } = require('./robloxApi');

const router  = Router();
const inFlight = new Map(); // assetId -> Promise<bundle[]>

router.get('/bundles/:assetId', async (req, res) => {
  const assetId = req.params.assetId;
  stats.requests.total++;

  if (!/^\d+$/.test(assetId)) {
    stats.requests.errors++;
    return res.status(400).json({ error: 'assetId must be numeric' });
  }

  // Negative cache — asset recently failed, don't hammer Roblox again
  if (cache.getNegativeEntry(assetId)) {
    stats.requests.negativeHits++;
    logger.warn('negative_cache_hit', { assetId });
    return res.status(503).json({ error: 'Temporarily unavailable, try again shortly' });
  }

  // Cache hit
  const assetEntry = cache.getAssetEntry(assetId);
  if (assetEntry) {
    stats.requests.cacheHits++;
    const bundles = assetEntry.bundleIds.map(id => cache.getBundleEntry(id)).filter(Boolean);
    logger.info('cache_hit', { assetId, bundleCount: bundles.length });
    return res.json({ assetId, bundles });
  }

  // In-flight dedup
  if (inFlight.has(assetId)) {
    logger.info('cache_dedup', { assetId });
    try {
      const rawBundles = await inFlight.get(assetId);
      return res.json({ assetId, bundles: rawBundles });
    } catch {
      return res.status(503).json({ error: 'Temporarily unavailable, try again shortly' });
    }
  }

  // Cache miss — fetch from Roblox
  stats.requests.cacheMisses++;
  logger.info('cache_miss', { assetId });

  const fetchPromise = fetchLinkedBundles(assetId)
    .then(rawBundles => {
      for (const bundle of rawBundles) cache.setBundleEntry(bundle);
      cache.setAssetEntry(assetId, rawBundles.map(b => b.id));
      return rawBundles;
    })
    .catch(err => {
      cache.setNegativeEntry(assetId); // cooldown — don't retry for 60 s
      throw err;
    })
    .finally(() => inFlight.delete(assetId));

  inFlight.set(assetId, fetchPromise);

  try {
    const rawBundles = await fetchPromise;
    return res.json({ assetId, bundles: rawBundles });
  } catch (err) {
    stats.requests.errors++;
    return res.status(503).json({ error: 'Temporarily unavailable, try again shortly' });
  }
});

router.get('/cache/stats', (_req, res) => {
  res.json(cache.getStats());
});

module.exports = router;
