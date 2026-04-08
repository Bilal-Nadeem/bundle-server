'use strict';

// ── Ring-buffer windowed tracker ──────────────────────────────────────────────
// Each tracker splits time into fixed-size buckets and keeps a ring of them.
// Stale buckets are zeroed out on first write after they roll over.
// lastHour  = 60 buckets × 1 min  → sliding 60-minute window
// last24h   = 24 buckets × 1 hour → sliding 24-hour window

const MINUTE_MS = 60_000;
const HOUR_MS   = 3_600_000;

const TRACKED = ['requests', 'cacheHits', 'cacheMisses', 'errors',
                 'robloxRequests', 'robloxSuccesses', 'robloxRateLimits', 'robloxErrors'];

function createWindowTracker(bucketCount, bucketMs) {
  const empty  = () => Object.fromEntries(TRACKED.map(f => [f, 0]));
  const buckets = Array.from({ length: bucketCount }, () => ({ ts: 0, ...empty() }));

  function nowTs()  { return Math.floor(Date.now() / bucketMs); }

  function bucket() {
    const ts  = nowTs();
    const idx = ts % bucketCount;
    if (buckets[idx].ts !== ts) buckets[idx] = { ts, ...empty() };
    return buckets[idx];
  }

  function inc(field) { bucket()[field]++; }

  function totals() {
    const now = nowTs();
    const acc = empty();
    for (const b of buckets) {
      if (b.ts > 0 && now - b.ts < bucketCount) {
        for (const f of TRACKED) acc[f] += b[f];
      }
    }
    return acc;
  }

  return { inc, totals };
}

const lastHour = createWindowTracker(60, MINUTE_MS);
const last24h  = createWindowTracker(24, HOUR_MS);

// ── All-time counters ─────────────────────────────────────────────────────────

const requests = { total: 0, cacheHits: 0, cacheMisses: 0, errors: 0 };
const roblox   = { requests: 0, successes: 0, rateLimits: 0, errors: 0, retries: 0 };
const proxies  = {};

// ── Increment helpers ─────────────────────────────────────────────────────────

const inc = {
  request()     { requests.total++;        lastHour.inc('requests');        last24h.inc('requests');        },
  cacheHit()    { requests.cacheHits++;    lastHour.inc('cacheHits');       last24h.inc('cacheHits');       },
  cacheMiss()   { requests.cacheMisses++;  lastHour.inc('cacheMisses');     last24h.inc('cacheMisses');     },
  reqError()    { requests.errors++;       lastHour.inc('errors');          last24h.inc('errors');          },

  robloxReq()   { roblox.requests++;       lastHour.inc('robloxRequests');  last24h.inc('robloxRequests');  },
  robloxOk()    { roblox.successes++;      lastHour.inc('robloxSuccesses'); last24h.inc('robloxSuccesses'); },
  robloxRL()    { roblox.rateLimits++;     lastHour.inc('robloxRateLimits');last24h.inc('robloxRateLimits');},
  robloxErr()   { roblox.errors++;         lastHour.inc('robloxErrors');    last24h.inc('robloxErrors');    },
  robloxRetry() { roblox.retries++;        },

  proxyInit(host) {
    if (!proxies[host]) proxies[host] = { requests: 0, successes: 0, rateLimits: 0, errors: 0 };
  },
  proxy(host, field) {
    if (proxies[host]) proxies[host][field]++;
  },
};

function getWindowed() {
  const h  = lastHour.totals();
  const d  = last24h.totals();
  const hitRateH = h.requests > 0 ? (h.cacheHits / h.requests * 100).toFixed(1) + '%' : 'n/a';
  const hitRateD = d.requests > 0 ? (d.cacheHits / d.requests * 100).toFixed(1) + '%' : 'n/a';
  const reqPerMin = (h.requests / 60).toFixed(2);
  return {
    lastHour:   { ...h, cacheHitRate: hitRateH },
    last24h:    { ...d, cacheHitRate: hitRateD },
    reqPerMin,
  };
}

module.exports = { requests, roblox, proxies, inc, getWindowed };
