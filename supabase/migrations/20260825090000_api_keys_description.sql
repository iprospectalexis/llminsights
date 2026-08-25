-- The api-keys create/update endpoints accept an optional description and
-- the ORM model now maps it; the column never existed in the prod table
-- (POST /api-keys 500'd with "TypeError: 'description' is an invalid
-- keyword argument for ApiKey" — caught by the partner-migration e2e test).

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS description text;
