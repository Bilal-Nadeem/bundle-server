'use strict';

/**
 * Test script for the Roblox Bundle Server.
 * Run with: node test.js
 * Make sure the server is already running (npm start) before executing this.
 */

const BASE_URL = 'https://bundles.xn--pltan-sqa.com';
const API_KEY  = 'LuaBearyGood_2026_iK35L3mK9pQ6sF4wX7iC5OH1gT3yK9nP1dc';

// Known test assets (from the spec)
const CARTOONY_RUN_ID       = '837009922';   // should return exactly 1 bundle: id=56
const CARTOONY_BUNDLE_ID    = 56;
const CARTOONY_BUNDLE_NAME  = 'Cartoony Animation Package';
const CARTOONY_ITEM_COUNT   = 7;             // 7 animations in the pack

const DEFAULT_MOOD_ID       = '10647852134'; // linked to many bundles (≤100)

// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function get(path) {
  const headers = { 'Accept': 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------

async function testHealth() {
  console.log('\n[1] Health check');
  const { status, body } = await get('/health');
  assert(status === 200, 'returns 200');
  assert(body?.status === 'ok', 'body.status is "ok"');
}

async function testCartoonyRunCacheMiss() {
  console.log(`\n[2] GetLinkedBundlesAsync(${CARTOONY_RUN_ID}) — first call`);
  const { status, body } = await get(`/api/bundles/${CARTOONY_RUN_ID}`);

  assert(status === 200, 'returns 200');
  assert(body?.assetId === CARTOONY_RUN_ID, `assetId is "${CARTOONY_RUN_ID}"`);
  assert(Array.isArray(body?.bundles), 'bundles is an array');
  assert(body.bundles.length === 1, 'exactly 1 bundle returned');

  const bundle = body.bundles[0];
  assert(bundle?.id === CARTOONY_BUNDLE_ID, `bundle id is ${CARTOONY_BUNDLE_ID}`);
  assert(bundle?.name === CARTOONY_BUNDLE_NAME, `bundle name is "${CARTOONY_BUNDLE_NAME}"`);
  assert(Array.isArray(bundle?.items), 'bundle.items is an array');
  assert(bundle.items.length === CARTOONY_ITEM_COUNT, `bundle has ${CARTOONY_ITEM_COUNT} items (UserOutfits stripped)`);

  // Verify the queried asset itself is inside the bundle's items
  const selfItem = bundle.items.find(i => i.id === Number(CARTOONY_RUN_ID));
  assert(selfItem !== undefined, 'queried asset (Cartoony Run) is present in bundle items');
  assert(selfItem?.type === 'Asset', 'item type is "Asset"');
  assert(selfItem?.assetType !== null, 'item has assetType value');

  // Verify no UserOutfit items leaked through
  const hasOutfit = bundle.items.some(i => i.type === 'UserOutfit');
  assert(!hasOutfit, 'no UserOutfit items in response');
}

async function testCartoonyRunCacheHit() {
  console.log(`\n[3] GetLinkedBundlesAsync(${CARTOONY_RUN_ID}) — second call (cache hit)`);
  const { status, body } = await get(`/api/bundles/${CARTOONY_RUN_ID}`);

  assert(status === 200, 'returns 200');
  assert(body?.bundles?.length === 1, 'still returns 1 bundle');
  assert(body?.bundles?.[0]?.id === CARTOONY_BUNDLE_ID, 'same bundle id from cache');
}

async function testHighBundleCountAsset() {
  console.log(`\n[4] GetLinkedBundlesAsync(${DEFAULT_MOOD_ID}) — high-bundle-count asset`);
  const { status, body } = await get(`/api/bundles/${DEFAULT_MOOD_ID}`);

  assert(status === 200, 'returns 200');
  assert(Array.isArray(body?.bundles), 'bundles is an array');
  assert(body.bundles.length > 1, 'multiple bundles returned');
  assert(body.bundles.length <= 100, 'respects 100-bundle cap');

  // Each bundle must have the expected shape
  const allHaveId      = body.bundles.every(b => typeof b.id === 'number');
  const allHaveName    = body.bundles.every(b => typeof b.name === 'string');
  const allHaveItems   = body.bundles.every(b => Array.isArray(b.items));
  const noBundleHasOutfits = body.bundles.every(b => b.items.every(i => i.type !== 'UserOutfit'));

  assert(allHaveId,          'every bundle has a numeric id');
  assert(allHaveName,        'every bundle has a name');
  assert(allHaveItems,       'every bundle has an items array');
  assert(noBundleHasOutfits, 'no UserOutfit items in any bundle');

  // The queried asset should appear in every bundle's items
  // (since that's what it means to be "linked" to a bundle)
  const assetAppearsInAllBundles = body.bundles.every(b =>
    b.items.some(i => i.id === Number(DEFAULT_MOOD_ID))
  );
  assert(assetAppearsInAllBundles, 'queried asset appears in every returned bundle');
}

async function testTwoTableStorage() {
  console.log('\n[5] Two-table storage structure');

  // The spec requires:
  //   assetCache: assetId -> [bundleId1, bundleId2, ...]
  //   bundleCache: bundleId -> full bundle details
  //
  // We verify this indirectly: if two different assets share a bundle,
  // the bundle details should be identical (same object from one store).
  //
  // Asset 10647852134 (DefaultFallBackMood) and 837009922 (Cartoony Run)
  // share no bundles, so we verify structure via stats and response shape.

  const { body: stats } = await get('/api/cache/stats');
  assert(typeof stats?.validAssets === 'number',  'cache reports validAssets count');
  assert(typeof stats?.validBundles === 'number', 'cache reports validBundles count (separate table)');
  assert(stats.validBundles >= stats.validAssets, 'bundles table can hold more entries than asset table (deduplication)');
  assert(stats.cacheTtlDays === 30, 'TTL is 30 days');

  // Confirm assets we fetched are in cache
  assert(stats.validAssets >= 2, 'at least 2 assets cached (Cartoony Run + DefaultFallBackMood)');
}

async function testInvalidAssetId() {
  console.log('\n[6] Invalid asset ID');
  const { status, body } = await get('/api/bundles/not-a-number');
  assert(status === 400, 'returns 400 for non-numeric assetId');
  assert(typeof body?.error === 'string', 'error message is present');
}

async function testUnknownRoute() {
  console.log('\n[7] Unknown route');
  const { status } = await get('/api/does-not-exist');
  assert(status === 404, 'returns 404 for unknown route');
}

// ---------------------------------------------------------------------------

async function run() {
  console.log(`\nRoblox Bundle Server — Test Suite`);
  console.log(`Base URL : ${BASE_URL}`);
  console.log(`API key  : ${API_KEY ? '(set)' : '(none)'}`);

  try {
    await testHealth();
    await testCartoonyRunCacheMiss();
    await testCartoonyRunCacheHit();
    await testHighBundleCountAsset();
    await testTwoTableStorage();
    await testInvalidAssetId();
    await testUnknownRoute();
  } catch (err) {
    console.error('\nUnexpected error during tests:', err.message);
    failed++;
  }

  console.log(`\n─────────────────────────────────`);
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  console.log(`─────────────────────────────────`);
  // Use setTimeout to allow fetch keep-alive sockets to drain before exit (Windows fix)
  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
}

run();
