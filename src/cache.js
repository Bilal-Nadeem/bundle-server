'use strict';

const fs   = require('fs');
const path = require('path');

const CACHE_TTL_MS = (parseInt(process.env.CACHE_TTL_DAYS, 10) || 30) * 24 * 60 * 60 * 1000;
const CACHE_FILE   = path.join(__dirname, '..', 'cache-data.json');

// assetId (string) -> { bundleIds: number[], cachedAt: number }
const assetCache = new Map();

// bundleId (number) -> { id, name, bundleType, items[], cachedAt }
const bundleCache = new Map();

function isExpired(cachedAt) {
  return Date.now() - cachedAt > CACHE_TTL_MS;
}

// ── Asset cache ───────────────────────────────────────────────────────────────

function getAssetEntry(assetId) {
  const entry = assetCache.get(String(assetId));
  if (!entry || isExpired(entry.cachedAt)) return null;
  return entry;
}

function setAssetEntry(assetId, bundleIds) {
  assetCache.set(String(assetId), { bundleIds, cachedAt: Date.now() });
}

// ── Bundle cache ──────────────────────────────────────────────────────────────

function getBundleEntry(bundleId) {
  const entry = bundleCache.get(Number(bundleId));
  if (!entry || isExpired(entry.cachedAt)) return null;
  return entry;
}

function setBundleEntry(bundle) {
  bundleCache.set(Number(bundle.id), {
    id:         bundle.id,
    name:       bundle.name,
    bundleType: bundle.bundleType,
    items:      bundle.items,
    cachedAt:   Date.now(),
  });
}

// ── Persistent cache ──────────────────────────────────────────────────────────

function loadFromDisk() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    let loaded = 0, skipped = 0;

    for (const [k, v] of (data.assets || [])) {
      if (!isExpired(v.cachedAt)) { assetCache.set(k, v); loaded++; }
      else skipped++;
    }
    for (const [k, v] of (data.bundles || [])) {
      if (!isExpired(v.cachedAt)) { bundleCache.set(Number(k), v); loaded++; }
      else skipped++;
    }

    console.log(`[cache] Loaded ${loaded} entries from disk (${skipped} expired, skipped)`);
  } catch (err) {
    console.error('[cache] Failed to load from disk:', err.message);
  }
}

function saveToDisk() {
  try {
    const data = {
      savedAt: Date.now(),
      assets:  [...assetCache.entries()],
      bundles: [...bundleCache.entries()],
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
  } catch (err) {
    console.error('[cache] Failed to save to disk:', err.message);
  }
}

// Load persisted cache immediately on startup
loadFromDisk();

// Save every 5 minutes so we don't lose more than 5 min of work on a crash
setInterval(saveToDisk, 5 * 60 * 1000).unref();

// ── Periodic cleanup ──────────────────────────────────────────────────────────

function pruneExpired() {
  let prunedAssets = 0, prunedBundles = 0;
  for (const [k, e] of assetCache)  { if (isExpired(e.cachedAt)) { assetCache.delete(k);  prunedAssets++;  } }
  for (const [k, e] of bundleCache) { if (isExpired(e.cachedAt)) { bundleCache.delete(k); prunedBundles++; } }
  return { prunedAssets, prunedBundles };
}

setInterval(pruneExpired, 60 * 60 * 1000).unref();

// ── Stats ─────────────────────────────────────────────────────────────────────

function getStats() {
  let validAssets = 0, expiredAssets = 0, validBundles = 0, expiredBundles = 0;
  for (const e of assetCache.values())  { isExpired(e.cachedAt) ? expiredAssets++  : validAssets++;  }
  for (const e of bundleCache.values()) { isExpired(e.cachedAt) ? expiredBundles++ : validBundles++; }
  return { validAssets, expiredAssets, validBundles, expiredBundles, cacheTtlDays: CACHE_TTL_MS / 86400000 };
}

module.exports = { getAssetEntry, setAssetEntry, getBundleEntry, setBundleEntry, getStats, pruneExpired, saveToDisk };
