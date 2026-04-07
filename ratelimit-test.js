'use strict';

// Roblox Catalog API — rate limit comparison tool.
//
// Tests every combination of (connection) × (cookie on/off) concurrently and
// reports: burst capacity, recovery time, and max sustained req/sec.
//
// Usage:
//   node ratelimit-test.js                   # direct, no cookie
//   node ratelimit-test.js --proxies         # direct + all proxies
//   node ratelimit-test.js --cookie          # include cookie variants
//   node ratelimit-test.js --proxies --cookie
//   node ratelimit-test.js --skip-recovery   # skip the ~2min recovery phase
//
// Cookie loaded from cookies.json → { "roblosecurity": "..." }
// Proxy config loaded from proxies.json

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');

// ── Config ────────────────────────────────────────────────────────────────────

const ROBLOX_URL  = 'https://catalog.roblox.com/v1/assets/%s/bundles?limit=10&sortOrder=Asc';
const ASSETS      = [837009922, 301820684, 27112068, 27112025, 619535091,
                     10647852134, 73040429253865, 84403964697921, 14618207727];
const TIMEOUT_MS  = 8000;

const args           = process.argv.slice(2);
const USE_PROXIES    = args.includes('--proxies');
const TEST_COOKIE    = args.includes('--cookie');
const SKIP_RECOVERY  = args.includes('--skip-recovery');
const BURST_MAX      = 40; // max requests in burst phase before giving up
const RECOVERY_MAX_S = 120;
// Rates to sweep in sustained phase, from fastest to slowest
const SUSTAINED_RATES = [5, 4, 3, 2, 1.5, 1, 0.75, 0.5]; // req/sec
const SUSTAINED_N     = 12; // requests per rate level

// ── Load configs ──────────────────────────────────────────────────────────────

let proxyConfig = { enabled: false, proxies: [], username: '', password: '' };
const proxyCfgPath = path.join(__dirname, 'proxies.json');
if (fs.existsSync(proxyCfgPath)) proxyConfig = JSON.parse(fs.readFileSync(proxyCfgPath, 'utf8'));

let cookie = null;
const cookiePath = path.join(__dirname, 'cookies.json');
if (TEST_COOKIE && fs.existsSync(cookiePath)) {
  cookie = JSON.parse(fs.readFileSync(cookiePath, 'utf8')).roblosecurity;
  if (cookie) console.log('  Cookie loaded from cookies.json');
}

// ── Build test matrix ─────────────────────────────────────────────────────────
// Each entry: { label, agent, cookie }

const connections = [{ label: 'direct', agent: null }];
if (USE_PROXIES && proxyConfig.enabled) {
  for (const host of proxyConfig.proxies) {
    const agent = new HttpsProxyAgent(`http://${proxyConfig.username}:${proxyConfig.password}@${host}`);
    connections.push({ label: host, agent });
  }
}

const cookieVariants = TEST_COOKIE && cookie
  ? [{ tag: 'no-cookie', cookie: null }, { tag: 'cookie', cookie }]
  : [{ tag: 'no-cookie', cookie: null }];

const matrix = [];
for (const conn of connections) {
  for (const cv of cookieVariants) {
    matrix.push({ label: `${conn.label} [${cv.tag}]`, agent: conn.agent, cookie: cv.cookie });
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

let _assetIdx = 0;
function nextAsset() { return ASSETS[_assetIdx++ % ASSETS.length]; }

async function req(agent, cookie) {
  const url   = ROBLOX_URL.replace('%s', nextAsset());
  const start = Date.now();
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept':     'application/json',
  };
  if (cookie) headers['Cookie'] = `.ROBLOSECURITY=${cookie}`;

  try {
    const res = await fetch(url, { agent, headers, timeout: TIMEOUT_MS });
    return { ok: res.status === 200, status: res.status, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - start, err: err.message };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function pad(v, n, right = false) {
  const s = String(v);
  return right ? s.padEnd(n) : s.padStart(n);
}

// ── Phase 1: Burst ────────────────────────────────────────────────────────────

async function phaseBurst(entry) {
  const log = (s) => process.stdout.write(s);
  log(`  [${entry.label}] Burst... `);
  let successes = 0;
  for (let i = 0; i < BURST_MAX; i++) {
    const r = await req(entry.agent, entry.cookie);
    if (r.ok) { successes++; }
    else {
      log(`${successes} ok → ${r.status} on req #${i + 1}\n`);
      return { burstOk: successes, burstHitOn: i + 1, burstStatus: r.status };
    }
  }
  log(`${BURST_MAX}+ ok (no limit hit)\n`);
  return { burstOk: BURST_MAX, burstHitOn: null, burstStatus: null };
}

// ── Phase 2: Recovery ─────────────────────────────────────────────────────────

async function phaseRecovery(entry) {
  const log = (s) => process.stdout.write(s);
  log(`  [${entry.label}] Recovery: `);
  const start = Date.now();
  for (let s = 1; s <= RECOVERY_MAX_S; s++) {
    await sleep(1000);
    const r = await req(entry.agent, entry.cookie);
    if (r.ok) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      log(`recovered after ${elapsed}s\n`);
      return { recoverySec: parseFloat(elapsed) };
    }
    if (s % 15 === 0) log(`${s}s `); else log('.');
  }
  log(`not recovered in ${RECOVERY_MAX_S}s\n`);
  return { recoverySec: null };
}

// ── Phase 3: Sustained ────────────────────────────────────────────────────────

async function phaseSustained(entry) {
  const log = (s) => process.stdout.write(s);
  let safeRps = null;

  for (const rps of SUSTAINED_RATES) {
    const delayMs = Math.round(1000 / rps);
    log(`  [${entry.label}] Sustained ${rps}/s (${delayMs}ms gap, ${SUSTAINED_N} reqs): `);
    await sleep(1500); // brief cooldown between levels

    let ok = 0, fail = 0;
    for (let i = 0; i < SUSTAINED_N; i++) {
      const r = await req(entry.agent, entry.cookie);
      if (r.ok) ok++; else fail++;
      if (i < SUSTAINED_N - 1) await sleep(delayMs);
    }
    const pct = (ok / SUSTAINED_N * 100).toFixed(0);
    log(`${ok}/${SUSTAINED_N} (${pct}%) ${fail === 0 ? '✓ SAFE' : `✗ ${fail} failed`}\n`);

    if (fail === 0) { safeRps = rps; break; }
  }
  if (safeRps === null) log(`  [${entry.label}] All rates failed — below 0.5 req/s limit\n`);
  return { safeRps };
}

// ── Run all entries ───────────────────────────────────────────────────────────

async function testEntry(entry) {
  const burst = await phaseBurst(entry);

  let recovery = { recoverySec: 0 };
  if (burst.burstHitOn && !SKIP_RECOVERY) {
    recovery = await phaseRecovery(entry);
  } else if (burst.burstHitOn && SKIP_RECOVERY) {
    process.stdout.write(`  [${entry.label}] Recovery skipped (--skip-recovery)\n`);
    await sleep(3000); // small pause before sustained
  }

  const sustained = await phaseSustained(entry);
  return { ...entry, ...burst, ...recovery, ...sustained };
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Roblox Catalog API — Rate Limit Analysis`);
  console.log(`  ${matrix.length} test(s): ${matrix.map(m => m.label).join(', ')}`);
  if (SKIP_RECOVERY) console.log('  Recovery phase: SKIPPED');
  console.log(`${'═'.repeat(60)}\n`);

  // Run all matrix entries concurrently
  const results = await Promise.all(matrix.map(testEntry));

  // ── Summary table ────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  SUMMARY`);
  console.log(`  ${'─'.repeat(56)}`);
  console.log(`  ${'Connection'.padEnd(32)} ${'Burst'.padStart(7)} ${'Recover'.padStart(8)} ${'Max/s'.padStart(6)}`);
  console.log(`  ${'─'.repeat(56)}`);
  for (const r of results) {
    const burst   = r.burstHitOn ? `${r.burstOk} req` : `>${BURST_MAX} req`;
    const recover = r.recoverySec != null ? `${r.recoverySec}s` : SKIP_RECOVERY ? 'skip' : '>120s';
    const safe    = r.safeRps    != null ? `${r.safeRps}/s`    : '<0.5/s';
    console.log(`  ${pad(r.label, 32, true)} ${pad(burst, 7)} ${pad(recover, 8)} ${pad(safe, 6)}`);
  }
  console.log(`${'═'.repeat(60)}\n`);

  setTimeout(() => process.exit(0), 100);
})();
