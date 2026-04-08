'use strict';

const fetch   = require('node-fetch');
const BASE_URL = process.env.TEST_BASE_URL || 'https://bundles.xn--pltan-sqa.com';
const API_KEY  = process.env.API_KEY || 'LuaBearyGood_2026_iK35L3mK9pQ6sF4wX7iC5OH1gT3yK9nP1dc';

const reset  = '\x1b[0m';
const dim    = '\x1b[2m';
const bold   = '\x1b[1m';
const green  = '\x1b[32m';
const yellow = '\x1b[33m';
const red    = '\x1b[31m';
const cyan   = '\x1b[36m';
const SEP    = '─'.repeat(60);

function pad(val, len, right = false) {
  const s = String(val);
  return right ? s.padEnd(len) : s.padStart(len);
}

function colorPct(pct) {
  if (pct >= 95) return green;
  if (pct >= 50) return yellow;
  return red;
}

function bar(pct, width = 20) {
  const filled = Math.round(Math.min(pct, 100) / 100 * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function hitPctStr(hits, total) {
  if (!total) return { str: 'n/a', pct: 0 };
  const pct = hits / total * 100;
  return { str: pct.toFixed(1) + '%', pct };
}

function windowSection(label, w) {
  if (!w) return;
  const total = w.requests || 0;
  const { str: hitStr, pct: hitPct } = hitPctStr(w.cacheHits || 0, total);
  const rbTotal  = w.robloxRequests || 0;
  const rbOkPct  = rbTotal > 0 ? (w.robloxSuccesses || 0) / rbTotal * 100 : 0;
  const rbOkStr  = rbTotal > 0 ? rbOkPct.toFixed(1) + '%' : 'n/a';

  console.log(`\n  ${bold}${label}${reset}  ${dim}(${total.toLocaleString()} requests)${reset}`);
  console.log(`    Cache hits    ${pad(w.cacheHits   || 0, 7)}   ${colorPct(hitPct)}${hitStr}${reset}  ${dim}${bar(hitPct)}${reset}`);
  console.log(`    Cache misses  ${pad(w.cacheMisses || 0, 7)}`);
  console.log(`    Errors        ${pad(w.errors      || 0, 7)}`);
  console.log(`    Roblox calls  ${pad(rbTotal,              7)}   ${colorPct(rbOkPct)}${rbOkStr}${reset}  ${dim}${pad(w.robloxRateLimits || 0, 3)} rate-limited${reset}`);
}

(async () => {
  try {
    const res = await fetch(`${BASE_URL}/health`, {
      headers: API_KEY ? { 'x-api-key': API_KEY } : {},
    });

    if (!res.ok) {
      console.error(`\nFailed to reach /health — HTTP ${res.status}\n`);
      process.exit(1);
    }

    const h  = await res.json();
    const c  = h.cache    || {};
    const rq = h.requests || {};
    const rb = h.roblox   || {};
    const w  = h.windowed || {};

    console.log(`\n${bold}${SEP}${reset}`);
    console.log(`${bold}  Bundle Server Stats${reset}   ${dim}${BASE_URL}${reset}`);
    console.log(`${bold}${SEP}${reset}`);

    // ── Overview ──────────────────────────────────────────────────────────────
    const reqPerMin = w.reqPerMin ?? 'n/a';
    console.log(`\n  ${bold}Uptime${reset}   ${h.uptime}    ${dim}${h.proxyCount} proxies configured   ${reqPerMin} req/min${reset}`);

    // ── Cache ─────────────────────────────────────────────────────────────────
    const totalAssets  = (c.validAssets  || 0) + (c.expiredAssets  || 0);
    const totalBundles = (c.validBundles || 0) + (c.expiredBundles || 0);
    const bundleTtl    = c.bundleTtlDays === 'permanent' ? 'permanent' : `${c.bundleTtlDays}d`;
    console.log(`\n  ${bold}Cache${reset}`);
    console.log(`    Assets   ${pad(c.validAssets  || 0, 6)} valid   ${pad(c.expiredAssets  || 0, 5)} expired   ${pad(totalAssets,  6)} total  ${dim}TTL ${c.assetTtlDays || '?'}d${reset}`);
    console.log(`    Bundles  ${pad(c.validBundles || 0, 6)} valid   ${pad(c.expiredBundles || 0, 5)} expired   ${pad(totalBundles, 6)} total  ${dim}TTL ${bundleTtl}${reset}`);

    // ── All-time requests ─────────────────────────────────────────────────────
    const total  = rq.total || 0;
    const { str: hitStr, pct: hitPct } = hitPctStr(rq.cacheHits || 0, total);
    console.log(`\n  ${bold}All-time Requests${reset}  ${dim}(${total.toLocaleString()} total)${reset}`);
    console.log(`    Cache hits   ${pad(rq.cacheHits   || 0, 7)}   ${colorPct(hitPct)}${hitStr}${reset}  ${dim}${bar(hitPct)}${reset}`);
    console.log(`    Cache misses ${pad(rq.cacheMisses || 0, 7)}`);
    console.log(`    Errors       ${pad(rq.errors      || 0, 7)}`);

    // ── All-time Roblox API ───────────────────────────────────────────────────
    const rbTotal = rb.requests || 0;
    const okPct   = parseFloat(rb.successRate) || 0;
    console.log(`\n  ${bold}All-time Roblox API${reset}  ${dim}(${rbTotal.toLocaleString()} calls)${reset}`);
    console.log(`    Successes    ${pad(rb.successes  || 0, 7)}   ${colorPct(okPct)}${rb.successRate || 'n/a'}${reset}`);
    console.log(`    Rate limits  ${pad(rb.rateLimits || 0, 7)}   ${dim}429s${reset}`);
    console.log(`    Timeouts/err ${pad(rb.errors     || 0, 7)}`);
    console.log(`    Retries      ${pad(rb.retries    || 0, 7)}`);

    // ── Windowed stats ────────────────────────────────────────────────────────
    console.log(`\n${dim}${SEP}${reset}`);
    windowSection(`Last Hour`, w.lastHour);
    windowSection(`Last 24h`, w.last24h);

    // ── Per-proxy ─────────────────────────────────────────────────────────────
    const proxies = h.proxies || [];
    if (proxies.length > 0) {
      console.log(`\n${dim}${SEP}${reset}`);
      console.log(`\n  ${bold}Proxies${reset}`);
      console.log(`  ${dim}  ${'Host'.padEnd(28)} ${'Req'.padStart(7)} ${'OK'.padStart(6)} ${'429'.padStart(6)} ${'Err'.padStart(7)}  Rate${reset}`);
      console.log(`  ${dim}  ${'─'.repeat(60)}${reset}`);
      for (const p of proxies) {
        const pct = parseFloat(p.successRate) || 0;
        console.log(`    ${pad(p.host, 28, true)} ${pad(p.requests, 7)} ${pad(p.successes, 6)} ${pad(p.rateLimits, 6)} ${pad(p.errors, 7)}  ${colorPct(pct)}${p.successRate}${reset}`);
      }
    }

    console.log(`\n${dim}${SEP}${reset}\n`);

  } catch (err) {
    console.error(`\nError: ${err.message}\n`);
    process.exit(1);
  }

  setTimeout(() => process.exit(0), 200);
})();
