--[[
	BundleServerTest.luau
	
	Paste this into a Script in ServerScriptService and run the game to test.
	Set SERVER_URL and API_KEY to match your .env before running.
]]

local HttpService = game:GetService('HttpService')

local SERVER_URL = 'http://localhost:3000'  -- change to your deployed URL
local API_KEY    = ''                        -- leave blank if API_KEY not set in .env

-- Known test values from spec
local CARTOONY_RUN_ID      = 837009922   -- "Cartoony Run"
local CARTOONY_BUNDLE_ID   = 56          -- "Cartoony Animation Package"
local DEFAULT_MOOD_ID      = 10647852134 -- linked to many bundles

local passed = 0
local failed = 0

local function assert(condition, message)
	if condition then
		print('  ✓ ' .. message)
		passed += 1
	else
		warn('  ✗ ' .. message)
		failed += 1
	end
end

-- Calls GET /api/bundles/{assetId} — this is GetLinkedBundlesAsync per the spec
local function GetLinkedBundlesAsync(assetId)
	local url = string.format('%s/api/bundles/%d', SERVER_URL, assetId)

	local success, response = pcall(HttpService.RequestAsync, HttpService, {
		Url    = url,
		Method = 'GET',
		Headers = {
			['x-api-key'] = API_KEY,
			['Accept']    = 'application/json',
		},
	})

	if not success then
		warn('HTTP error:', response)
		return nil
	end

	if not response.Success then
		warn(string.format('Server error %d: %s', response.StatusCode, response.StatusMessage))
		return nil
	end

	local page = HttpService:JSONDecode(response.Body)
	return page
end

-- ─────────────────────────────────────────────────────────────────────────────

print('\n── Roblox Bundle Server Test ──')
print(string.format('Server: %s\n', SERVER_URL))

-- Test 1: Known asset returns correct bundle
print('[1] Cartoony Run (837009922) → should return bundle 56')
do
	local result = GetLinkedBundlesAsync(CARTOONY_RUN_ID)

	assert(result ~= nil, 'got a response')
	assert(result.assetId == tostring(CARTOONY_RUN_ID), 'assetId matches')
	assert(result.source == 'roblox' or result.source == 'cache', 'source is "roblox" or "cache"')
	assert(typeof(result.bundles) == 'table', 'bundles is a table')
	assert(#result.bundles == 1, 'exactly 1 bundle returned')

	local bundle = result.bundles[1]
	assert(bundle ~= nil, 'bundle exists')
	assert(bundle.id == CARTOONY_BUNDLE_ID, string.format('bundle id is %d', CARTOONY_BUNDLE_ID))
	assert(bundle.name == 'Cartoony Animation Package', 'bundle name is "Cartoony Animation Package"')
	assert(typeof(bundle.items) == 'table', 'bundle.items is a table')
	assert(#bundle.items > 0, 'bundle has items')

	-- The queried asset should be inside the bundle
	local foundSelf = false
	local hasOutfit = false
	for _, item in ipairs(bundle.items) do
		if item.id == CARTOONY_RUN_ID then foundSelf = true end
		if item.type == 'UserOutfit' then hasOutfit = true end
	end
	assert(foundSelf, 'Cartoony Run asset is inside the bundle items')
	assert(not hasOutfit, 'no UserOutfit items in response')
end

-- Test 2: Cache hit — calling the same asset again returns cached result
print('\n[2] Cache hit — same asset a second time')
do
	local result = GetLinkedBundlesAsync(CARTOONY_RUN_ID)
	assert(result ~= nil, 'got a response')
	assert(result.source == 'cache', 'source is "cache" on repeated call')
	assert(result.bundles[1].id == CARTOONY_BUNDLE_ID, 'same bundle returned from cache')
end

-- Test 3: High-bundle-count asset respects the 100-bundle cap
print('\n[3] DefaultFallBackMood (10647852134) → should return multiple bundles (≤ 100)')
do
	local result = GetLinkedBundlesAsync(DEFAULT_MOOD_ID)

	assert(result ~= nil, 'got a response')
	assert(typeof(result.bundles) == 'table', 'bundles is a table')
	assert(#result.bundles > 1, 'multiple bundles returned')
	assert(#result.bundles <= 100, 'at most 100 bundles returned')

	-- Every bundle must have the expected fields
	local allValid = true
	for _, bundle in ipairs(result.bundles) do
		if typeof(bundle.id) ~= 'number' then allValid = false break end
		if typeof(bundle.name) ~= 'string' then allValid = false break end
		if typeof(bundle.items) ~= 'table' then allValid = false break end
	end
	assert(allValid, 'every bundle has id, name, and items')

	-- The queried asset should appear in every returned bundle
	local assetInAll = true
	for _, bundle in ipairs(result.bundles) do
		local found = false
		for _, item in ipairs(bundle.items) do
			if item.id == DEFAULT_MOOD_ID then found = true break end
		end
		if not found then assetInAll = false break end
	end
	assert(assetInAll, 'queried asset appears in every returned bundle')
end

-- Test 4: Each bundle item has the correct fields (id, name, type, assetType)
print('\n[4] Bundle item fields match spec')
do
	local result = GetLinkedBundlesAsync(CARTOONY_RUN_ID)
	local item = result and result.bundles[1] and result.bundles[1].items[1]

	assert(item ~= nil, 'first item exists')
	assert(typeof(item.id) == 'number', 'item.id is a number')
	assert(typeof(item.name) == 'string', 'item.name is a string')
	assert(typeof(item.type) == 'string', 'item.type is a string')
	assert(item.assetType ~= nil, 'item.assetType is present')
end

-- ─────────────────────────────────────────────────────────────────────────────

print(string.format('\n── Results: %d passed, %d failed ──', passed, failed))
