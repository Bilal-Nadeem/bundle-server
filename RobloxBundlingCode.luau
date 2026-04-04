local require = require(script:FindFirstAncestor('Honeypot') or game.ReplicatedStorage:WaitForChild('Honeypot'))

local RunService = game:GetService('RunService')

local LoadedItemIndex = require 'LoadedItemIndex'

local ItemDetailsBundling = {}

ItemDetailsBundling.ConfirmNoBundleConnections = LoadedItemIndex.ConfirmNoBundleConnections
ItemDetailsBundling.GetConnectedBundles = LoadedItemIndex.GetConnectedBundles
ItemDetailsBundling.LinkBundleToAsset = LoadedItemIndex.LinkBundleToAsset
ItemDetailsBundling.RegisterBundleItems = LoadedItemIndex.RegisterBundleItems
ItemDetailsBundling.RegisterNewItemData = LoadedItemIndex.RegisterNewItemData

if RunService:IsServer() then 
	local MemoryStoreService = game:GetService('MemoryStoreService')
	local HttpService = game:GetService('HttpService')
	local ServerStorage = game:GetService('ServerStorage')
	
	local PlayerRequestsBudgetHandler = require 'PlayerRequestsBudgetHandler'
	
	local CREDENTIALS = require(ServerStorage.CREDENTIALS)
	local GET_BUNDLES_URL = (CREDENTIALS.PROXY_URL_START.. "/catalog/v1/assets/%d/bundles?limit=100&sortOrder=Asc")
	
	local BundleLinksMap = MemoryStoreService:GetSortedMap('BundleLinks_2')
	
	--[[
		We have three different data formats here which can get a bit confusing:
			- WebLinkedBundles (Raw data returned from the web api)
			- MemorystoreLinkedBundles (Raw data returned from the memory store)
			- LinkedBundles (The format used in the main codebase)
	]]
	
	function ItemDetailsBundling.WebLinkedBundlesToMemoryLinkedBundles(WebLinkedBundles)
		local MemoryLinkedBundles = {}
		
		for _, BundleDetails in pairs(WebLinkedBundles) do 
			MemoryLinkedBundles[BundleDetails.id] = {}

			for _, ItemData in pairs(BundleDetails.items) do 
				if ItemData.type == 'UserOutfit' then continue end 
				table.insert(MemoryLinkedBundles[BundleDetails.id], ItemData.id)
			end
		end
		
		return MemoryLinkedBundles
	end
	
	function ItemDetailsBundling.MemoryLinkedBundlesToLinkedBundles(MemoryLinkedBundles)
		local LinkedBundles = {}

		for BundleId, BundleItems in pairs(MemoryLinkedBundles) do 
			local TableToInsert = {
				id = tonumber(BundleId),
				items = {}
			}

			for _, ItemId in pairs(BundleItems) do 
				table.insert(TableToInsert.items, {
					id = tonumber(ItemId),
					type = 'Unknown'
				})
			end

			table.insert(LinkedBundles, TableToInsert)
		end

		return LinkedBundles
	end
	
	function ItemDetailsBundling.CommitWebLinkedBundlesToMemoryStore(AssetId, MemoryLinkedBundles)
		local AssetId = tostring(AssetId)
	
		local Success, Response = pcall(
			BundleLinksMap.SetAsync,
			BundleLinksMap,
			AssetId,
			MemoryLinkedBundles,
			3_888_000
		)
		
		if (not Success) then 
			warn(Response)
		end
	end
	
	function ItemDetailsBundling.MemoryStoreSearchBundlesFromAssetId(AssetId)
		local AssetId = tostring(AssetId)
		
		local Success, MemoryLinkedBundles = pcall(
			BundleLinksMap.GetAsync,
			BundleLinksMap,
			AssetId
		)
		
		if Success and MemoryLinkedBundles then 
			return ItemDetailsBundling.MemoryLinkedBundlesToLinkedBundles(MemoryLinkedBundles)
		elseif Success then 
			return nil 
		else 
			warn(MemoryLinkedBundles)
			return false 
		end
	end
	
	function ItemDetailsBundling.WebSearchBundlesFromAssetId(Player, AssetId) 
		if (not PlayerRequestsBudgetHandler.GetAllowedAndCharge(Player, 'PlatanServer', 'UseProxy', 1)) then return end 
		
		local URL = string.format(GET_BUNDLES_URL, AssetId)
		
		local Success, Response = pcall( 
			HttpService.RequestAsync,
			HttpService,
			{
				Url = URL,
				Method = "GET",
				Headers = {
					['x-api-key'] = CREDENTIALS.WEB_SERVER.API_KEY,
				}
			}
		)

		if (not Success) then warn('Web search bundle http error', Response) return end 
		if (not Response.Success) then warn(string.format('Web search bundle error %d %s', Response.StatusCode, Response.StatusMessage)) return end

		local Page = HttpService:JSONDecode(Response.Body)
		local PageData = Page['data']

		if (not PageData) then warn('No data when importing asset\'s bundles') return end 
		
		return PageData
	end
end
 
return ItemDetailsBundling
