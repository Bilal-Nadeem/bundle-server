'use strict';

const { Router } = require('express');
const cache  = require('./cache');
const logger = require('./logger');
const stats  = require('./stats');
const { fetchLinkedBundles } = require('./robloxApi');

const router   = Router();
const inFlight = new Map(); // assetId -> Promise<bundle[]>

function isNumericAssetId(value) {
  return /^\d+$/.test(String(value));
}

function startBackgroundFetch(assetId) {
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
}

function getBundleLookupResult(assetId) {
  // Cache hit
  const assetEntry = cache.getAssetEntry(assetId);
  if (assetEntry) {
    stats.inc.cacheHit();
    const bundles = assetEntry.bundleIds.map(id => cache.getBundleEntry(id)).filter(Boolean);
    logger.info('cache_hit', { assetId, bundleCount: bundles.length });
    return { assetId, bundles };
  }

  // Cache miss — return null immediately and populate cache in the background
  stats.inc.cacheMiss();
  logger.info('cache_miss', { assetId });
  startBackgroundFetch(assetId);
  return { assetId, bundles: null };
}

router.get('/bundles/:assetId', async (req, res) => {
  const assetId = req.params.assetId;
  stats.inc.request();

  if (!isNumericAssetId(assetId)) {
    stats.inc.reqError();
    return res.status(400).json({ error: 'assetId must be numeric' });
  }

  const { bundles } = getBundleLookupResult(assetId);
  return res.json({ bundles });
});

router.post('/bundles/batch', async (req, res) => {
  const { assetIds } = req.body || {};
  stats.inc.request();

  if (!Array.isArray(assetIds) || assetIds.length === 0) {
    stats.inc.reqError();
    return res.status(400).json({ error: 'assetIds must be a non-empty array of numeric IDs' });
  }

  for (const rawAssetId of assetIds) {
    if (!isNumericAssetId(rawAssetId)) {
      stats.inc.reqError();
      return res.status(400).json({ error: 'assetIds must contain only numeric IDs' });
    }
  }

  const seen = new Map(); // bundleId -> bundle object

  for (const rawAssetId of assetIds) {
    const { bundles } = getBundleLookupResult(String(rawAssetId));
    if (bundles !== null) {
      for (const bundle of bundles) {
        if (!seen.has(bundle.id)) seen.set(bundle.id, bundle);
      }
    }
  }

  return res.json({ bundles: Array.from(seen.values()) });
});

router.get('/cache/stats', (_req, res) => {
  res.json(cache.getStats());
});

module.exports = router;
