# When OTPs are Sent Through WhatsApp

## Overview
OTPs are sent through WhatsApp when specific conditions are met. This document explains when and how WhatsApp OTP sending works.

## Conditions for WhatsApp OTP Sending

### 1. Automatic Method Detection (Frontend)
**When a user enters their phone number for password reset, the system automatically uses WhatsApp:**

The frontend automatically detects the identifier type and sets the method:
- **Phone number entered** → Method automatically set to `'whatsapp'`
- **Email entered** → Method automatically set to `'email'`
- **Username entered** → User can choose between email or WhatsApp (if both available)

```typescript
// Frontend auto-detection logic (CustomerForgotPasswordPage.tsx)
if (data.data.searchType === 'phone' && data.data.hasPhone) {
  setMethod('whatsapp');  // ← Automatically uses WhatsApp for phone numbers
} else if (data.data.searchType === 'email' && data.data.hasEmail) {
  setMethod('email');
}
```

### 2. Manual Method Parameter (API)
You can also explicitly set the method parameter:

```javascript
POST /api/auth/forgot-password
{
  "identifier": "+2010032560826",  // phone number
  "method": "whatsapp",  // ← Explicitly set (or auto-detected from phone)
  "tenant_id": "optional-tenant-id"
}
```

### 3. User Must Have Phone Number
The user account must have a phone number stored in the database:
- Phone number must be in `users.phone` column
- Phone number should be in international format (e.g., `+2010032560826`)

### 4. WhatsApp Settings Must Be Configured
The tenant must have WhatsApp settings configured in the database:
- Settings stored in `tenants.whatsapp_settings` (JSONB column)
- Required fields depend on provider:
  - **Meta**: `provider: "meta"`, `phone_number_id`, `access_token`
  - **Twilio**: `provider: "twilio"`, `account_sid`, `auth_token`, `from`
  - **WATI**: `provider: "wati"`, `api_url`, `api_key`

## Flow Diagram

```
User enters identifier (phone/email/username)
    ↓
Backend detects identifier type
    ↓
Phone number detected?
    ↓ YES
Frontend auto-sets method = 'whatsapp'
    ↓
User has phone number in database?
    ↓ YES
Tenant has WhatsApp config?
    ↓ YES
Send OTP via WhatsApp
    ↓
Success? → ✅ Done
    ↓ NO
Fallback to Email (if user has email)
```

**Key Point**: When a user enters their phone number, WhatsApp is automatically used - no need to explicitly set `method: 'whatsapp'`.

## Automatic Fallback

If WhatsApp sending fails, the system automatically falls back to email if:
1. The user has an email address
2. Email sending is configured

This ensures OTP delivery even if WhatsApp is unavailable.

## Common Issues

### Issue 1: OTP Not Sent via WhatsApp
**Symptoms**: OTP request succeeds but no WhatsApp message received

**Possible Causes**:
1. WhatsApp settings not configured in tenant settings
2. Invalid or expired access token (Meta)
3. Invalid phone number format
4. WhatsApp provider API error

**Solution**: Check server logs for WhatsApp sending errors

### Issue 2: "WhatsApp settings not configured"
**Symptoms**: Error message about WhatsApp not being configured

**Solution**: 
1. Go to tenant settings
2. Configure WhatsApp settings:
   - Provider (meta/twilio/wati)
   - Required credentials for chosen provider
   - Phone number ID (for Meta)

### Issue 3: "Phone number not found"
**Symptoms**: Error when requesting WhatsApp OTP

**Solution**: 
1. Ensure user account has phone number
2. Phone should be in international format: `+2010032560826`

## Testing WhatsApp OTP

### Test Script
```bash
node scripts/test_whatsapp_otp.mjs
```

### Manual Test via API
```bash
curl -X POST http://localhost:3001/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "user@example.com",
    "method": "whatsapp",
    "tenant_id": "your-tenant-id"
  }'
```

## Configuration

### Meta WhatsApp Configuration
```json
{
  "provider": "meta",
  "phone_number_id": "939237089264920",
  "access_token": "EAAL1SdkJ7ysBQ..."
}
```

### Twilio WhatsApp Configuration
```json
{
  "provider": "twilio",
  "account_sid": "ACxxxxx",
  "auth_token": "xxxxx",
  "from": "whatsapp:+14155238886"
}
```

### WATI Configuration
```json
{
  "provider": "wati",
  "api_url": "https://api.wati.io",
  "api_key": "xxxxx"
}
```

## Code Locations

- **OTP Request Handler**: `server/src/routes/auth.ts` (line ~711)
- **WhatsApp Service**: `server/src/services/whatsappService.ts`
- **WhatsApp Sending Logic**: `server/src/routes/auth.ts` (line ~1073)
- **Frontend Auto-Detection**: `src/pages/customer/CustomerForgotPasswordPage.tsx` (line ~141-153)

## Summary

**✅ OTPs are AUTOMATICALLY sent via WhatsApp when:**
1. User enters their **phone number** for password reset (frontend auto-detects and sets method to 'whatsapp')
2. User has a phone number stored in their account
3. Tenant has WhatsApp settings configured
4. WhatsApp provider credentials are valid

**OR manually when:**
1. Method parameter is explicitly set to `"whatsapp"` in the API request
2. User has a phone number in their account
3. Tenant has WhatsApp settings configured

**If WhatsApp fails, the system will:**
→ Automatically fallback to email (if user has email)

**Key Takeaway**: When users forget their password and enter their phone number, they automatically receive OTP via WhatsApp - no manual method selection needed!
