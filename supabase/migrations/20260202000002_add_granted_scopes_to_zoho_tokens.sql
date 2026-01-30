-- Ensure zoho_tokens has granted_scopes (may be missing if DB was created from a migration that recreates zoho_tokens without it)
ALTER TABLE zoho_tokens
ADD COLUMN IF NOT EXISTS granted_scopes TEXT;

COMMENT ON COLUMN zoho_tokens.granted_scopes IS 'Comma-separated list of scopes granted with this token. Used to detect missing UPDATE scope.';
