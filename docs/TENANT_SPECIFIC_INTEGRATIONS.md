# Tenant-Specific Integrations

## Overview
Each tenant (service provider) uses **only their own configured** WhatsApp and Email integrations. There are no global/fallback settings - each tenant must configure their own settings.

## Email (SMTP) Integration

### How It Works
- Each tenant has their own SMTP settings stored in `tenants.smtp_settings` (JSONB column)
- When sending emails, the system fetches SMTP settings from the tenant's database record
- **No environment variable fallback** - settings must be configured per tenant

### Configuration
Settings are stored in the database:
```json
{
  "smtp_host": "smtp.gmail.com",
  "smtp_port": 587,
  "smtp_user": "tenant@example.com",
  "smtp_password": "app-password"
}
```

### Where It's Used
1. **OTP Emails** (`server/src/routes/auth.ts`)
   - Uses `sendOTPEmail(email, otp, tenantId, language)`
   - Fetches SMTP settings for the specific tenant

2. **Booking Ticket Emails** (`server/src/routes/bookings.ts`)
   - Uses `sendBookingTicketEmail(email, pdf, bookingId, tenantId, ...)`
   - Uses tenant's SMTP settings to send ticket PDFs

### Code Flow
```typescript
// Email Service (emailService.ts)
async function getSmtpSettingsFromDb(tenantId: string) {
  // Fetches smtp_settings from tenants table WHERE id = tenantId
  // Returns null if not configured
}

// All email sending uses tenant-specific settings
sendOTPEmail(email, otp, tenantId, language)
  → getSmtpSettingsFromDb(tenantId)
  → createTransporterFromDb(tenantId)
  → send email using tenant's SMTP
```

## WhatsApp Integration

### How It Works
- Each tenant has their own WhatsApp settings stored in `tenants.whatsapp_settings` (JSONB column)
- When sending WhatsApp messages, the system fetches WhatsApp settings from the tenant's database record
- **No environment variable fallback** - settings must be configured per tenant

### Configuration
Settings are stored in the database:
```json
{
  "provider": "meta",  // or "twilio" or "wati"
  "phone_number_id": "939237089264920",
  "access_token": "EAAL1SdkJ7ysBQ...",
  // For Twilio:
  "account_sid": "ACxxxxx",
  "auth_token": "xxxxx",
  "from": "whatsapp:+14155238886",
  // For WATI:
  "api_url": "https://api.wati.io",
  "api_key": "xxxxx"
}
```

### Where It's Used
1. **OTP via WhatsApp** (`server/src/routes/auth.ts`)
   - Fetches WhatsApp settings from tenant database
   - Uses `sendOTPWhatsApp(phone, otp, language, tenantConfig)`

2. **Booking Tickets via WhatsApp** (`server/src/routes/bookings.ts`)
   - Fetches WhatsApp settings from tenant database
   - Uses `sendWhatsAppDocument(phone, pdf, filename, caption, tenantConfig)`

3. **Invoice Delivery via WhatsApp** (`server/src/services/zohoService.ts`)
   - Fetches WhatsApp settings from tenant database
   - Uses `sendWhatsAppDocument()` with tenant config

### Code Flow
```typescript
// Auth Route (auth.ts)
const { data: tenantData } = await supabase
  .from('tenants')
  .select('whatsapp_settings')
  .eq('id', tenantId)
  .maybeSingle();

const whatsappConfig = {
  provider: settings.provider,
  phoneNumberId: settings.phone_number_id,
  accessToken: settings.access_token,
  // ... other settings
};

// WhatsApp Service (whatsappService.ts)
sendOTPWhatsApp(phone, otp, language, tenantConfig)
  // Requires tenantConfig - no fallback to env vars
  → Uses tenant's specific provider and credentials
```

## Key Principles

### 1. No Global Settings
- ❌ No environment variable fallback
- ❌ No default/global SMTP or WhatsApp settings
- ✅ Each tenant must configure their own settings

### 2. Tenant Isolation
- Each tenant's communications use only their configured integrations
- Tenant A's emails sent via Tenant A's SMTP
- Tenant B's WhatsApp messages sent via Tenant B's WhatsApp account

### 3. Configuration Required
- If tenant hasn't configured settings, sending will fail with clear error
- Error messages guide admin to configure settings in tenant settings page

## Error Handling

### Email Not Configured
```
[EmailService] ❌ SMTP settings not configured for tenant {tenantId}
Please configure SMTP settings in the service provider settings page
```

### WhatsApp Not Configured
```
❌ WhatsApp tenant config is required. Settings must be configured in database.
WhatsApp not configured. Please configure WhatsApp settings in tenant settings.
```

## Configuration UI

Tenants configure their settings in:
- **Settings Page** (`src/pages/tenant/SettingsPage.tsx`)
  - SMTP Settings section
  - WhatsApp Settings section
  - Each tenant admin can only configure their own tenant's settings

## Database Schema

### Tenants Table
```sql
CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text,
  smtp_settings jsonb,        -- Tenant-specific SMTP config
  whatsapp_settings jsonb,    -- Tenant-specific WhatsApp config
  ...
);
```

## Benefits

1. **Multi-tenancy**: Each tenant uses their own branding and credentials
2. **Security**: Credentials isolated per tenant
3. **Flexibility**: Each tenant can use different providers (Gmail, Outlook, Meta, Twilio, etc.)
4. **Scalability**: No shared resource limits
5. **Compliance**: Each tenant controls their own communication channels

## Migration Notes

If you have existing code using environment variables:
1. Remove environment variable fallbacks
2. Ensure all email/WhatsApp sending functions receive `tenantId`
3. Update all calls to pass tenant-specific config
4. Configure settings in database for each tenant
