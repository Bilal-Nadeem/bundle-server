'use strict';

// Global stats — imported and mutated by any module that needs to record events.
// Read by the /health endpoint.

module.exports = {
  requests: {
    total:        0,
    cacheHits:    0,
    cacheMisses:  0,
    negativeHits: 0, // blocked by negative cache (recent 429)
    errors:       0,
  },
  roblox: {
    requests:   0,
    successes:  0,
    rateLimits: 0, // 429s received
    errors:     0,
    retries:    0, // successful retries after initial failure
  },
  proxies: {}, // proxyIp:port -> { requests, successes, rateLimits, errors }
};
