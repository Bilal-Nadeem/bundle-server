'use strict';

module.exports = {
  requests: {
    total:       0,
    cacheHits:   0,
    cacheMisses: 0,
    errors:      0,
  },
  roblox: {
    requests:   0,
    successes:  0,
    rateLimits: 0,
    errors:     0,
    retries:    0,
  },
  proxies: {}, // proxyIp:port -> { requests, successes, rateLimits, errors }
};
