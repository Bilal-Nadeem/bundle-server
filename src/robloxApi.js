'use strict';

const logger = require('./logger');

const ROBLOX_BUNDLES_URL = 'https://catalog.roblox.com/v1/assets/%s/bundles?limit=100&sortOrder=Asc';

/**
 * Fetches linked bundles for a given asset ID from the Roblox catalog API.
 *
 * Returns an array of bundle objects in the shape:
 *   { id, name, bundleType, items: [{ id, name, type, assetType }] }
 *
 * Returns null if the request fails or the asset has no bundles.
 */
async function fetchLinkedBundles(assetId) {
  const url = ROBLOX_BUNDLES_URL.replace('%s', encodeURIComponent(assetId));

  logger.info('roblox_request', { assetId, url });

  let response;
  try {
    response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'RobloxBundleServer/1.0',
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new Error(`Network error fetching bundles for asset ${assetId}: ${err.message}`);
  }

  if (!response.ok) {
    logger.error('roblox_api_error', { assetId, status: response.status });
    throw new Error(`Roblox API returned ${response.status} for asset ${assetId}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Invalid JSON from Roblox API for asset ${assetId}`);
  }

  if (!Array.isArray(body.data)) {
    throw new Error(`Unexpected response shape from Roblox API for asset ${assetId}`);
  }

  return body.data.map(bundle => ({
    id: bundle.id,
    name: bundle.name,
    bundleType: bundle.bundleType,
    items: (bundle.items || [])
      .filter(item => item.type !== 'UserOutfit')
      .map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        assetType: item.assetType ?? null,
      })),
  }));
}

module.exports = { fetchLinkedBundles };
