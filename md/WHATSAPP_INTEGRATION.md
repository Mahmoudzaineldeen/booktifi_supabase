# WhatsApp Business Integration for OTP

## Overview
This document describes the WhatsApp Business integration for sending OTP codes alongside email OTP.

## Features
- ✅ Support for multiple WhatsApp providers (Meta Cloud API, Twilio, WATI)
- ✅ Tenant-specific WhatsApp configuration
- ✅ Fallback to email if WhatsApp fails
- ✅ User choice between Email and WhatsApp for OTP delivery
- ✅ Test connection functionality

## Setup Instructions

### 1. Database Migration
Run the migration to add WhatsApp settings column:
```bash
# Apply migration
psql -U your_user -d your_database -f supabase/migrations/20251201000000_add_whatsapp_settings_to_tenants.sql
```

Or use the Node.js script:
```bash
node scripts/apply_whatsapp_migration.js
```

### 2. Configure WhatsApp Provider

#### Option A: Meta Cloud API (Recommended)
1. Go to [Meta Business Manager](https://business.facebook.com/)
2. Create a WhatsApp Business Account
3. Get your:
   - **Phone Number ID**: From WhatsApp → API Setup
   - **Access Token**: Generate from API Setup
4. Enter these in Settings → WhatsApp Business Settings

#### Option B: Twilio
1. Sign up at [Twilio](https://www.twilio.com/)
2. Get your:
   - **Account SID**: From Twilio Console
   - **Auth Token**: From Twilio Console
   - **WhatsApp Number**: Format: `whatsapp:+1234567890`
3. Enter these in Settings → WhatsApp Business Settings

#### Option C: WATI
1. Sign up at [WATI](https://www.wati.io/)
2. Get your:
   - **API Key**: From WATI Dashboard
   - **API URL**: Usually `https://api.wati.io`
3. Enter these in Settings → WhatsApp Business Settings

### 3. Configure in Tenant Settings
1. Navigate to Settings page in tenant dashboard
2. Scroll to "WhatsApp Business Settings" section
3. Select your provider
4. Enter required credentials
5. Click "Test Connection" to verify
6. Click "Save WhatsApp Settings"

## Usage

### For Customers
1. Go to Forgot Password page
2. Choose delivery method: **Email** or **WhatsApp**
3. Enter email (for Email) or phone number (for WhatsApp)
4. Receive OTP via selected method
5. Enter OTP to verify
6. Reset password or continue without changing

### For Service Providers
1. Configure WhatsApp settings in Settings page
2. Test connection to ensure it works
3. Customers can now choose WhatsApp when requesting OTP

## API Endpoints

### POST `/api/auth/forgot-password`
Request OTP via email or WhatsApp.

**Request Body:**
```json
{
  "email": "user@example.com",  // For email method
  "phone": "+966501234567",      // For WhatsApp method
  "method": "email",             // "email" or "whatsapp"
  "tenant_id": "tenant-uuid"     // Optional, for tenant-specific WhatsApp config
}
```

**Response:**
```json
{
  "success": true,
  "message": "If the email/phone exists, an OTP has been sent via email/whatsapp."
}
```

### GET `/api/tenants/whatsapp-settings`
Get WhatsApp settings for tenant (masked).

### PUT `/api/tenants/whatsapp-settings`
Update WhatsApp settings for tenant.

**Request Body:**
```json
{
  "provider": "meta",              // "meta", "twilio", or "wati"
  "phone_number_id": "...",        // For Meta
  "access_token": "...",          // For Meta
  "account_sid": "...",            // For Twilio
  "auth_token": "...",             // For Twilio
  "from": "whatsapp:+1234567890", // For Twilio
  "api_url": "...",                // For WATI
  "api_key": "..."                 // For WATI
}
```

### POST `/api/tenants/whatsapp-settings/test`
Test WhatsApp connection.

## Environment Variables (Optional)
You can also set default WhatsApp config in `.env`:
```env
WHATSAPP_PROVIDER=meta
WHATSAPP_API_URL=
WHATSAPP_API_KEY=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
WHATSAPP_FROM=
```

## Notes
- WhatsApp settings are stored per tenant in `whatsapp_settings` JSONB column
- Sensitive tokens are masked when retrieved via API
- If WhatsApp fails, system automatically falls back to email (if available)
- Phone numbers should include country code (e.g., +966501234567)

## Troubleshooting

### WhatsApp not sending
1. Check provider credentials are correct
2. Verify phone number format (include country code)
3. Test connection in Settings page
4. Check server console for error messages
5. Ensure WhatsApp Business Account is approved (for Meta)

### OTP not received
1. Check server console for OTP code (development mode)
2. Verify WhatsApp settings are saved
3. Check phone number is correct format
4. Try email method as fallback

