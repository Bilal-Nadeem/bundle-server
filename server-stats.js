'use strict';

const BASE_URL = process.env.TEST_BASE_URL || 'https://bundles.xn--pltan-sqa.com';
const API_KEY  = process.env.API_KEY || 'LuaBearyGood_2026_iK35L3mK9pQ6sF4wX7iC5OH1gT3yK9nP1dc';

function pad(val, len, right = false) {
  const s = String(val);
  return right ? s.padEnd(len) : s.padStart(len);
}

function bar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function color(pct) {
  if (pct >= 95) return '\x1b[32m'; // green
  if (pct >= 75) return '\x1b[33m'; // yellow
  return '\x1b[31m';                // red
}
const reset = '\x1b[0m';
const dim   = '\x1b[2m';
const bold  = '\x1b[1m';

(async () => {
  try {
    const res  = await fetch(`${BASE_URL}/health`, {
      headers: API_KEY ? { 'x-api-key': API_KEY } : {},
    });

    if (!res.ok) {
      console.error(`\nFailed to reach /health — HTTP ${res.status}`);
      console.error(`Make sure API_KEY is set if the endpoint is protected.\n`);
      process.exit(1);
    }

    const h = await res.json();

    const sep  = '─'.repeat(56);
    const sep2 = '─'.repeat(56);

    console.log(`\n${bold}${sep}${reset}`);
    console.log(`${bold}  Bundle Server Stats${reset}   ${dim}${BASE_URL}${reset}`);
    console.log(`${bold}${sep}${reset}\n`);

    // ── Overview ─────────────────────────────────────────────────────────────
    console.log(`  ${bold}Uptime${reset}    ${h.uptime}`);
    console.log(`  ${bold}Proxies${reset}   ${h.proxyCount} configured`);

    // ── Cache ─────────────────────────────────────────────────────────────────
    console.log(`\n  ${bold}Cache${reset}`);
    const c = h.cache || {};
    const totalAssets  = (c.validAssets  || 0) + (c.expiredAssets  || 0);
    const totalBundles = (c.validBundles || 0) + (c.expiredBundles || 0);
    console.log(`  ${dim}  Assets ${reset} ${pad(c.validAssets || 0, 5)} valid   ${pad(c.expiredAssets || 0, 4)} expired   ${pad(totalAssets, 5)} total`);
    console.log(`  ${dim}  Bundles${reset} ${pad(c.validBundles || 0, 5)} valid   ${pad(c.expiredBundles || 0, 4)} expired   ${pad(totalBundles, 5)} total`);
    console.log(`  ${dim}  TTL    ${reset} ${c.cacheTtlDays} days`);

    // ── Requests ──────────────────────────────────────────────────────────────
    const rq = h.requests || {};
    const totalReq = rq.total || 0;
    const hitRate  = totalReq > 0 ? ((rq.cacheHits || 0) / totalReq * 100) : 0;
    const hitRateStr = totalReq > 0 ? hitRate.toFixed(1) + '%' : 'n/a';

    console.log(`\n  ${bold}Requests${reset}  (${totalReq.toLocaleString()} total)`);
    console.log(`  ${dim}  Cache hits  ${reset} ${pad(rq.cacheHits  || 0, 7).toLocaleString()}   ${hitRate >= 0 ? color(hitRate) : ''}${hitRateStr}${reset}  ${dim}${bar(hitRate)}${reset}`);
    console.log(`  ${dim}  Cache miss  ${reset} ${pad(rq.cacheMisses || 0, 7)}`);
    console.log(`  ${dim}  Errors      ${reset} ${pad(rq.errors || 0, 7)}`);

    // ── Roblox API ────────────────────────────────────────────────────────────
    const rb = h.roblox || {};
    const rbTotal = rb.requests || 0;

    console.log(`\n  ${bold}Roblox API${reset}  (${rbTotal.toLocaleString()} calls)`);
    console.log(`  ${dim}  Successes   ${reset} ${pad(rb.successes  || 0, 7)}   ${color(parseFloat(rb.successRate) || 0)}${rb.successRate || 'n/a'}${reset}`);
    console.log(`  ${dim}  Rate limits ${reset} ${pad(rb.rateLimits || 0, 7)}   ${dim}429s hit${reset}`);
    console.log(`  ${dim}  Retries     ${reset} ${pad(rb.retries    || 0, 7)}   ${dim}successful retries${reset}`);
    console.log(`  ${dim}  Errors      ${reset} ${pad(rb.errors     || 0, 7)}`);

    // ── Per-proxy ─────────────────────────────────────────────────────────────
    const proxies = h.proxies || [];
    if (proxies.length > 0) {
      console.log(`\n  ${bold}Proxy Breakdown${reset}`);
      console.log(`  ${dim}  ${'Host'.padEnd(24)} ${'Req'.padStart(6)} ${'OK'.padStart(6)} ${'429'.padStart(5)} ${'Err'.padStart(5)}  Rate${reset}`);
      console.log(`  ${dim}  ${'─'.repeat(54)}${reset}`);
      for (const p of proxies) {
        const pct = parseFloat(p.successRate) || 0;
        const row = `  ${pad(p.host, 24, true)} ${pad(p.requests, 6)} ${pad(p.successes, 6)} ${pad(p.rateLimits, 5)} ${pad(p.errors, 5)}  ${color(pct)}${p.successRate}${reset}`;
        console.log(row);
      }
    }

    console.log(`\n${dim}${sep2}${reset}\n`);

  } catch (err) {
    console.error(`\nError: ${err.message}\n`);
    process.exit(1);
  }

  setTimeout(() => process.exit(0), 100);
})();
