'use strict';

const FAILING = [
  16732170561,
  70587206144490,
  18755938274,
  83546368697737,
  94487432166569,
  88299449479306,
  136187516215342,
  110026589607054,
  104422927709951,
  133981053950928,
];

const BASE_URL = process.env.TEST_BASE_URL || 'https://bundles.xn--pltan-sqa.com';
const API_KEY  = process.env.API_KEY || '';

const headers = API_KEY ? { 'x-api-key': API_KEY } : {};

function pad(str, len) {
  return String(str).padEnd(len);
}

async function fetchHealth() {
  try {
    const res  = await fetch(`${BASE_URL}/health`);
    return await res.json();
  } catch {
    return null;
  }
}

async function checkAsset(assetId) {
  const start = Date.now();
  try {
    const res  = await fetch(`${BASE_URL}/api/bundles/${assetId}`, { headers });
    const ms   = Date.now() - start;
    const body = await res.json().catch(() => null);

    if (res.status === 200) {
      const count = body?.bundles?.length ?? '?';
      return { assetId, status: 'PASS', code: 200, bundles: count, ms };
    } else {
      return { assetId, status: 'FAIL', code: res.status, bundles: 0, ms };
    }
  } catch (err) {
    return { assetId, status: 'FAIL', code: 'ERR', bundles: 0, ms: Date.now() - start, error: err.message };
  }
}

(async () => {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Bundle Server Diagnostics`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`${'─'.repeat(60)}\n`);

  // Pull server health before
  const health = await fetchHealth();
  if (health) {
    console.log(`  Server uptime  : ${health.uptime}`);
    console.log(`  Proxies active : ${health.proxyCount ?? 0}`);
    console.log(`  Cache  — assets: ${health.cache?.validAssets ?? 0}  bundles: ${health.cache?.validBundles ?? 0}  neg-cached: ${health.cache?.negativeCached ?? 0}`);
    console.log(`  Requests — total: ${health.requests?.total ?? 0}  hits: ${health.requests?.cacheHits ?? 0}  misses: ${health.requests?.cacheMisses ?? 0}  errors: ${health.requests?.errors ?? 0}`);
    console.log(`  Roblox  — calls: ${health.roblox?.requests ?? 0}  429s: ${health.roblox?.rateLimits ?? 0}  retries: ${health.roblox?.retries ?? 0}  success: ${health.roblox?.successRate ?? 'n/a'}`);

    if (health.proxies?.length) {
      console.log('\n  Proxy breakdown:');
      for (const p of health.proxies) {
        console.log(`    ${pad(p.host, 22)}  req:${pad(p.requests, 4)}  ok:${pad(p.successes, 4)}  429:${pad(p.rateLimits, 3)}  err:${pad(p.errors, 3)}  (${p.successRate})`);
      }
    }
  } else {
    console.log('  (Could not reach /health)');
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Checking ${FAILING.length} previously-failing assets...\n`);

  let passed = 0, failed = 0;
  const results = [];

  for (const id of FAILING) {
    const r = await checkAsset(id);
    results.push(r);
    const icon = r.status === 'PASS' ? '✓' : '✗';
    const bundleStr = r.status === 'PASS' ? `bundles=${r.bundles}` : `http=${r.code}`;
    console.log(`  ${icon} ${pad(r.assetId, 22)}  ${bundleStr}  (${r.ms}ms)`);
    if (r.status === 'PASS') passed++; else failed++;
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed out of ${FAILING.length}`);

  if (passed === FAILING.length) {
    console.log('  All assets resolved — cache is warm.');
  } else if (failed === FAILING.length) {
    console.log('  All assets failed — server may be rate-limited or auth is missing.');
  } else {
    console.log('  Partial success — some assets may still be in negative cache (retry in 60s).');
  }

  console.log(`${'─'.repeat(60)}\n`);

  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
})();
