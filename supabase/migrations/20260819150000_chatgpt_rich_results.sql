-- Rich results for ChatGPT/SearchGPT (BrightData): ads, place cards,
-- local-business details, the "More sources" tier and map fan-out queries.
--
-- BrightData already returns these fields; until now they were dropped by
-- the converter or rode only in raw_response_data (which is NULLed after
-- competitor extraction). Existing columns shopping / shopping_visible /
-- is_map / search_sources (added 2025-10, never written) start being
-- populated by the same deploy.

ALTER TABLE llm_responses ADD COLUMN IF NOT EXISTS ads jsonb;
ALTER TABLE llm_responses ADD COLUMN IF NOT EXISTS business_locations jsonb;
ALTER TABLE llm_responses ADD COLUMN IF NOT EXISTS map_places jsonb;
ALTER TABLE llm_responses ADD COLUMN IF NOT EXISTS search_sources_more jsonb;
ALTER TABLE llm_responses ADD COLUMN IF NOT EXISTS map_search_queries jsonb;
