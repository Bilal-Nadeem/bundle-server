'use strict';

const { Router } = require('express');
const cache  = require('./cache');
const logger = require('./logger');
const stats  = require('./stats');
const { fetchLinkedBundles } = require('./robloxApi');

const router   = Router();
const inFlight = new Map(); // assetId -> Promise<bundle[]>

router.get('/bundles/:assetId', async (req, res) => {
  const assetId = req.params.assetId;
  stats.inc.request();

  if (!/^\d+$/.test(assetId)) {
    stats.inc.reqError();
    return res.status(400).json({ error: 'assetId must be numeric' });
  }

  // Cache hit
  const assetEntry = cache.getAssetEntry(assetId);
  if (assetEntry) {
    stats.inc.cacheHit();
    const bundles = assetEntry.bundleIds.map(id => cache.getBundleEntry(id)).filter(Boolean);
    logger.info('cache_hit', { assetId, bundleCount: bundles.length });
    return res.json({ assetId, bundles });
  }

  // Cache miss — return null immediately and populate cache in the background
  stats.inc.cacheMiss();
  logger.info('cache_miss', { assetId });

  // Only start a fetch if one isn't already running for this asset
  if (!inFlight.has(assetId)) {
    const fetchPromise = fetchLinkedBundles(assetId)
      .then(rawBundles => {
        for (const bundle of rawBundles) cache.setBundleEntry(bundle);
        cache.setAssetEntry(assetId, rawBundles.map(b => b.id));
        logger.info('background_cached', { assetId, bundleCount: rawBundles.length });
      })
      .catch(err => {
        stats.inc.reqError();
        logger.error('background_fetch_failed', { assetId, error: err.message });
        // Cache invalid/deleted assets as empty so we don't retry them on every request
        if (err.message.includes('400')) {
          cache.setAssetEntry(assetId, []);
          logger.info('cached_invalid_asset', { assetId });
        }
      })
      .finally(() => inFlight.delete(assetId));

    inFlight.set(assetId, fetchPromise);
  } else {
    logger.info('cache_dedup', { assetId });
  }

  return res.json({ assetId, bundles: null });
});

router.get('/cache/stats', (_req, res) => {
  res.json(cache.getStats());
});

module.exports = router;
