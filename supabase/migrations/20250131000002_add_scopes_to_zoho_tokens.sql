/*
  # Add scopes column to zoho_tokens table
  
  This allows us to store the granted scopes with each token,
  enabling detection of missing UPDATE scope and prompting
  users to reconnect when needed.
*/

-- Add scopes column to store granted scopes
ALTER TABLE zoho_tokens
ADD COLUMN IF NOT EXISTS granted_scopes TEXT;

-- Add comment
COMMENT ON COLUMN zoho_tokens.granted_scopes IS 'Comma-separated list of scopes granted with this token. Used to detect missing UPDATE scope.';
