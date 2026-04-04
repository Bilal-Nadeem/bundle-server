'use strict';

const CACHE_TTL_MS = (parseInt(process.env.CACHE_TTL_DAYS, 10) || 30) * 24 * 60 * 60 * 1000;

// assetId (string) -> { bundleIds: number[], cachedAt: number }
const assetCache = new Map();

// bundleId (number) -> { id, name, bundleType, items: [{id, type, assetType}], cachedAt }
const bundleCache = new Map();

function isExpired(cachedAt) {
  return Date.now() - cachedAt > CACHE_TTL_MS;
}

// ---------- Asset cache ----------

function getAssetEntry(assetId) {
  const entry = assetCache.get(String(assetId));
  if (!entry || isExpired(entry.cachedAt)) return null;
  return entry;
}

function setAssetEntry(assetId, bundleIds) {
  assetCache.set(String(assetId), {
    bundleIds,
    cachedAt: Date.now(),
  });
}

// ---------- Bundle cache ----------

function getBundleEntry(bundleId) {
  const entry = bundleCache.get(Number(bundleId));
  if (!entry || isExpired(entry.cachedAt)) return null;
  return entry;
}

function setBundleEntry(bundle) {
  bundleCache.set(Number(bundle.id), {
    id: bundle.id,
    name: bundle.name,
    bundleType: bundle.bundleType,
    items: bundle.items,
    cachedAt: Date.now(),
  });
}

// ---------- Periodic cleanup ----------
// Expired entries are invisible to callers but still occupy memory.
// Prune them every hour so the Maps don't grow unboundedly over time.

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function pruneExpired() {
  let prunedAssets = 0;
  let prunedBundles = 0;
  for (const [key, entry] of assetCache) {
    if (isExpired(entry.cachedAt)) { assetCache.delete(key); prunedAssets++; }
  }
  for (const [key, entry] of bundleCache) {
    if (isExpired(entry.cachedAt)) { bundleCache.delete(key); prunedBundles++; }
  }
  return { prunedAssets, prunedBundles };
}

// .unref() means this interval won't keep the process alive on its own
setInterval(pruneExpired, CLEANUP_INTERVAL_MS).unref();

// ---------- Stats (for debugging) ----------

function getStats() {
  let validAssets = 0;
  let expiredAssets = 0;
  for (const entry of assetCache.values()) {
    isExpired(entry.cachedAt) ? expiredAssets++ : validAssets++;
  }
  let validBundles = 0;
  let expiredBundles = 0;
  for (const entry of bundleCache.values()) {
    isExpired(entry.cachedAt) ? expiredBundles++ : validBundles++;
  }
  return { validAssets, expiredAssets, validBundles, expiredBundles, cacheTtlDays: CACHE_TTL_MS / 86400000 };
}

module.exports = { getAssetEntry, setAssetEntry, getBundleEntry, setBundleEntry, getStats, pruneExpired };
