'use strict';

const CACHE_TTL_MS    = (parseInt(process.env.CACHE_TTL_DAYS, 10) || 30) * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 60_000; // 60 s cooldown after a 429/error — stops retry spirals

// assetId -> { bundleIds: number[], cachedAt: number }
const assetCache = new Map();

// bundleId -> { id, name, bundleType, items[], cachedAt }
const bundleCache = new Map();

// assetId -> { failedAt: number }  — short-lived, prevents hammering a failing asset
const negativeCache = new Map();

function isExpired(cachedAt, ttl) {
  return Date.now() - cachedAt > ttl;
}

// ── Asset cache ───────────────────────────────────────────────────────────────

function getAssetEntry(assetId) {
  const entry = assetCache.get(String(assetId));
  if (!entry || isExpired(entry.cachedAt, CACHE_TTL_MS)) return null;
  return entry;
}

function setAssetEntry(assetId, bundleIds) {
  assetCache.set(String(assetId), { bundleIds, cachedAt: Date.now() });
}

// ── Bundle cache ──────────────────────────────────────────────────────────────

function getBundleEntry(bundleId) {
  const entry = bundleCache.get(Number(bundleId));
  if (!entry || isExpired(entry.cachedAt, CACHE_TTL_MS)) return null;
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

// ── Negative cache ────────────────────────────────────────────────────────────

function getNegativeEntry(assetId) {
  const entry = negativeCache.get(String(assetId));
  if (!entry || isExpired(entry.failedAt, NEGATIVE_TTL_MS)) {
    negativeCache.delete(String(assetId));
    return null;
  }
  return entry;
}

function setNegativeEntry(assetId) {
  negativeCache.set(String(assetId), { failedAt: Date.now() });
}

// ── Periodic cleanup ──────────────────────────────────────────────────────────

function pruneExpired() {
  let prunedAssets = 0, prunedBundles = 0, prunedNegative = 0;
  for (const [k, e] of assetCache)    { if (isExpired(e.cachedAt,  CACHE_TTL_MS))    { assetCache.delete(k);    prunedAssets++;   } }
  for (const [k, e] of bundleCache)   { if (isExpired(e.cachedAt,  CACHE_TTL_MS))    { bundleCache.delete(k);   prunedBundles++;  } }
  for (const [k, e] of negativeCache) { if (isExpired(e.failedAt,  NEGATIVE_TTL_MS)) { negativeCache.delete(k); prunedNegative++; } }
  return { prunedAssets, prunedBundles, prunedNegative };
}

setInterval(pruneExpired, 60 * 60 * 1000).unref();

// ── Stats ─────────────────────────────────────────────────────────────────────

function getStats() {
  let validAssets = 0, expiredAssets = 0, validBundles = 0, expiredBundles = 0;
  for (const e of assetCache.values())  { isExpired(e.cachedAt, CACHE_TTL_MS)  ? expiredAssets++  : validAssets++;  }
  for (const e of bundleCache.values()) { isExpired(e.cachedAt, CACHE_TTL_MS)  ? expiredBundles++ : validBundles++; }
  return {
    validAssets, expiredAssets,
    validBundles, expiredBundles,
    negativeCached: negativeCache.size,
    cacheTtlDays: CACHE_TTL_MS / 86400000,
  };
}

module.exports = { getAssetEntry, setAssetEntry, getBundleEntry, setBundleEntry, getNegativeEntry, setNegativeEntry, getStats, pruneExpired };
