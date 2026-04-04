-- paste into ServerScriptService, enable HTTP requests first

local HttpService = game:GetService('HttpService')

local SERVER_URL = 'https://bundles.xn--pltan-sqa.com'
local API_KEY = 'LuaBearyGood_2026_iK35L3mK9pQ6sF4wX7iC5OH1gT3yK9nP1dc'

local function getLinkedBundles(assetId)
	local ok, res = pcall(HttpService.RequestAsync, HttpService, {
		Url = string.format('%s/api/bundles/%d', SERVER_URL, assetId),
		Method = 'GET',
		Headers = { ['x-api-key'] = API_KEY },
	})
	if not ok or not res.Success then
		warn('failed', ok and res.StatusCode or res)
		return
	end
	print(res.Body)
end

getLinkedBundles(837009922)   -- cartoony run, should return bundle 56
