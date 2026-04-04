--[[
	ItemDetailsBundling — migrated to web server
	
	Replaces the Memory Store system with a single HTTP call to the bundle server.
	The server handles:
	  - Caching (30-day TTL)
	  - Deduplication (assetId → bundleIds, separate bundle lookup table)
	  - Fetching from Roblox when not cached
	
	Only one function is needed: GetLinkedBundlesAsync(Player, AssetId)
	All Memory Store functions have been removed.
]]

local require = require(script:FindFirstAncestor('Honeypot') or game.ReplicatedStorage:WaitForChild('Honeypot'))

local RunService = game:GetService('RunService')

local LoadedItemIndex = require 'LoadedItemIndex'

local ItemDetailsBundling = {}

-- These are unchanged — they live in LoadedItemIndex and don't touch the server
ItemDetailsBundling.ConfirmNoBundleConnections = LoadedItemIndex.ConfirmNoBundleConnections
ItemDetailsBundling.GetConnectedBundles        = LoadedItemIndex.GetConnectedBundles
ItemDetailsBundling.LinkBundleToAsset          = LoadedItemIndex.LinkBundleToAsset
ItemDetailsBundling.RegisterBundleItems        = LoadedItemIndex.RegisterBundleItems
ItemDetailsBundling.RegisterNewItemData        = LoadedItemIndex.RegisterNewItemData

if RunService:IsServer() then
	local HttpService   = game:GetService('HttpService')
	local ServerStorage = game:GetService('ServerStorage')

	local PlayerRequestsBudgetHandler = require 'PlayerRequestsBudgetHandler'

	local CREDENTIALS = require(ServerStorage.CREDENTIALS)

	-- e.g. "https://bundles.example.com"
	local GET_LINKED_BUNDLES_URL = CREDENTIALS.WEB_SERVER.URL .. '/api/bundles/%d'

	--[[
		GetLinkedBundlesAsync(Player, AssetId)
		
		Calls the bundle server for the given AssetId.
		Returns an array of bundle objects in the format:
		
		{
		    { id = 56, name = "Cartoony Animation Package", bundleType = "AvatarAnimations",
		      items = {
		          { id = 837009922, name = "Cartoony Run",  type = "Asset", assetType = 53 },
		          { id = 837010234, name = "Cartoony Walk", type = "Asset", assetType = 55 },
		          ...
		      }
		    },
		    ...
		}
		
		Returns nil on any failure (rate limited, HTTP error, bad response).
		UserOutfit items are already stripped by the server.
		Results are already cached server-side for 30 days.
	]]
	function ItemDetailsBundling.GetLinkedBundlesAsync(Player, AssetId)
		if not PlayerRequestsBudgetHandler.GetAllowedAndCharge(Player, 'BundleServer', 'GetLinkedBundles', 1) then
			return
		end

		local URL = string.format(GET_LINKED_BUNDLES_URL, AssetId)

		local Success, Response = pcall(
			HttpService.RequestAsync,
			HttpService,
			{
				Url    = URL,
				Method = 'GET',
				Headers = {
					['x-api-key'] = CREDENTIALS.WEB_SERVER.API_KEY,
				},
			}
		)

		if not Success then
			warn('[ItemDetailsBundling] HTTP error for asset', AssetId, Response)
			return
		end

		if not Response.Success then
			warn(string.format('[ItemDetailsBundling] Server error %d %s for asset %d',
				Response.StatusCode, Response.StatusMessage, AssetId))
			return
		end

		local Page = HttpService:JSONDecode(Response.Body)
		local Bundles = Page['bundles']

		if not Bundles then
			warn('[ItemDetailsBundling] No bundles field in response for asset', AssetId)
			return
		end

		return Bundles
	end
end

return ItemDetailsBundling
