# Roblox Bundle Server

A lightweight web server that replaces Roblox Memory Store bundle lookups with a shared HTTP API, enabling multiple games to share the same cached bundle data.

## How it works

When a Roblox game calls the API with an asset ID, the server:

1. Checks its in-memory cache for a valid (≤ 30 day old) result.
2. On a cache miss, fetches directly from the Roblox catalog API (`/catalog/v1/assets/{id}/bundles`).
3. Stores the result in two separate tables to avoid duplicate data:
   - **Asset table** – `assetId → [bundleId, bundleId, ...]`
   - **Bundle table** – `bundleId → { id, name, bundleType, items[] }`
4. Returns all matched bundle details to the caller.

## Requirements

- Node.js ≥ 18 (uses built-in `fetch` and `AbortSignal.timeout`)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the example env file and edit it
copy .env.example .env

# 3. Start the server
npm start
```

## Configuration (`.env`)

| Variable        | Default     | Description                                               |
|-----------------|-------------|-----------------------------------------------------------|
| `PORT`          | `3000`      | Port the server listens on                                |
| `HOST`          | `0.0.0.0`   | Network interface to bind                                 |
| `API_KEY`       | _(none)_    | If set, all `/api/*` requests must include `x-api-key`   |
| `CACHE_TTL_DAYS`| `30`        | Days before a cached result is considered stale           |

## API

### `GET /api/bundles/:assetId`

Returns all bundles linked to the given Roblox asset ID. Up to 100 bundles are returned (Roblox API limit).

**Headers**
```
x-api-key: <your key>   (required if API_KEY is set)
```

**Example request**
```
GET /api/bundles/837009922
```

**Example response**
```json
{
  "assetId": "837009922",
  "source": "roblox",
  "cachedAt": "2026-04-04T00:00:00.000Z",
  "bundles": [
    {
      "id": 56,
      "name": "Cartoony Animation Package",
      "bundleType": "AvatarAnimations",
      "items": [
        { "id": 837009922, "name": "Cartoony Run",   "type": "Asset", "assetType": 53 },
        { "id": 837010234, "name": "Cartoony Walk",  "type": "Asset", "assetType": 55 }
      ]
    }
  ]
}
```

`source` is `"cache"` on subsequent calls within the TTL window, `"roblox"` when freshly fetched.

### `GET /api/cache/stats`

Returns current cache state — useful for monitoring.

```json
{
  "validAssets": 42,
  "expiredAssets": 3,
  "validBundles": 187,
  "expiredBundles": 11,
  "cacheTtlDays": 30
}
```

### `GET /health`

Always returns `{ "status": "ok" }`. No auth required. Use for uptime checks.

## Calling from Roblox (Luau)

```lua
local HttpService = game:GetService('HttpService')

local BASE_URL = "https://your-server.com"
local API_KEY  = "your_key_here"

local function GetLinkedBundlesAsync(assetId)
    local url = string.format("%s/api/bundles/%d", BASE_URL, assetId)

    local ok, response = pcall(HttpService.RequestAsync, HttpService, {
        Url     = url,
        Method  = "GET",
        Headers = { ["x-api-key"] = API_KEY },
    })

    if not ok or not response.Success then
        warn("Bundle lookup failed:", response)
        return nil
    end

    local data = HttpService:JSONDecode(response.Body)
    return data.bundles  -- array of { id, name, bundleType, items[] }
end
```

## Deployment (VPS + Nginx + SSL)

The included `setup.sh` handles everything automatically — same pattern as roproxy.

```bash
# On your VPS, clone/copy the project then run:
sudo bash setup.sh
```

It will ask for:
- **Domain** — e.g. `bundles.example.com` (point DNS to your VPS IP first)
- **Email** — for Let's Encrypt SSL
- **API key** — secret used in `x-api-key` header from Roblox
- **Port** — default `3001` (use a different port if 3000 is taken by roproxy)
- **Cache TTL** — default 30 days

After setup, the server runs as a systemd service (`bundle-server`) and auto-restarts on crash.

```bash
systemctl status bundle-server     # check status
journalctl -u bundle-server -f     # live logs
systemctl restart bundle-server    # restart after update
```

To update the server after code changes:
```bash
cp -r /path/to/new/files/* /opt/bundle-server/
systemctl restart bundle-server
```

## File structure

```
index.js          Entry point – boots the Express server
src/
  server.js       Express app, auth middleware, error handler
  routes.js       /api/bundles/:assetId  and  /api/cache/stats
  cache.js        In-memory asset + bundle cache with TTL
  robloxApi.js    Fetches from catalog.roblox.com
.env.example      Environment variable template
```
