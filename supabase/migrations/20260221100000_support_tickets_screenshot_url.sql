-- Add optional screenshot URL to support tickets (uploaded to Supabase Storage or data URL).
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS screenshot_url text;

COMMENT ON COLUMN support_tickets.screenshot_url IS 'Optional screenshot image URL (Storage or data URL) attached when creating the ticket.';
