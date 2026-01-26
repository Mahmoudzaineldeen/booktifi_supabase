# Production Email Solution - Permanent Fix

## Problem Solved

**Issue:** SMTP connection timeouts (ETIMEDOUT) in cloud/container environments (Railway, Bolt, etc.)

**Root Cause:** Cloud providers block outbound SMTP ports (587, 465) for security reasons

**Solution:** HTTP-based email API (SendGrid) that works in all environments

## Implementation

### ✅ 1. New Email API Service
- **File:** `server/src/services/emailApiService.ts`
- **Provider:** SendGrid API (HTTP-based, no port blocking)
- **Fallback:** SMTP (for local development)
- **Features:**
  - Automatic provider selection
  - Tenant-specific configuration
  - Attachment support
  - Comprehensive error handling

### ✅ 2. Refactored Email Service
- **File:** `server/src/services/emailService.ts`
- **Updated Functions:**
  - `sendOTPEmail()` - Uses new API service
  - `sendBookingTicketEmail()` - Uses new API service
- **Backward Compatible:** Same function signatures, no breaking changes

### ✅ 3. Updated API Endpoints
- **File:** `server/src/routes/tenants.ts`
- **PUT `/api/tenants/smtp-settings`:**
  - Now accepts `sendgrid_api_key`
  - Supports both SendGrid API and SMTP
- **POST `/api/tenants/smtp-settings/test`:**
  - Tests SendGrid API first
  - Falls back to SMTP if needed
  - Sends actual test email

### ✅ 4. Dependencies
- **Installed:** `@sendgrid/mail` package
- **Location:** `server/package.json`

## Configuration

### SendGrid API Setup (Recommended)

1. **Sign up for SendGrid:**
   - Go to: https://sendgrid.com
   - Free tier: 100 emails/day

2. **Get API Key:**
   - Dashboard → Settings → API Keys
   - Create new API key with "Mail Send" permissions
   - Copy the API key (starts with `SG.`)

3. **Configure in Application:**
   - **Option A:** Global (Railway environment variable)
     ```env
     SENDGRID_API_KEY=SG.xxxxxxxxxxxxx
     ```
   - **Option B:** Tenant-specific (Database)
     ```json
     {
       "email_settings": {
         "sendgrid_api_key": "SG.xxxxxxxxxxxxx",
         "from_email": "noreply@yourdomain.com"
       }
     }
     ```

### SMTP Fallback (Local Development)

If SendGrid API key is not configured, system falls back to SMTP:
- Works for local development
- Not recommended for production (port blocking issues)

## Usage

### Sending Emails

All existing email functions work automatically:

```typescript
// OTP Email
await sendOTPEmail(email, otp, tenantId, 'en');

// Booking Ticket Email
await sendBookingTicketEmail(
  email,
  pdfBuffer,
  bookingId,
  tenantId,
  bookingDetails,
  'en'
);
```

The system automatically:
1. Checks for SendGrid API key (tenant-specific or global)
2. Uses SendGrid API if available
3. Falls back to SMTP if API not configured

### Testing Email Configuration

```bash
# Test SendGrid API
POST /api/tenants/smtp-settings/test
{
  "sendgrid_api_key": "SG.xxxxxxxxxxxxx"
}

# Test SMTP (fallback)
POST /api/tenants/smtp-settings/test
{
  "smtp_user": "user@gmail.com",
  "smtp_password": "app-password"
}
```

## Benefits

### ✅ Production Reliability
- **No port blocking:** HTTP-based API uses standard ports (80/443)
- **Works everywhere:** Railway, Bolt, AWS, Azure, etc.
- **No timeouts:** Reliable connection in cloud environments

### ✅ Scalability
- **High volume:** SendGrid handles thousands of emails
- **Better deliverability:** Professional email infrastructure
- **Analytics:** Email tracking and delivery reports

### ✅ Security
- **API keys:** Secure authentication (no passwords)
- **Tenant isolation:** Each tenant has own configuration
- **No credential exposure:** Keys stored securely in database

### ✅ Maintainability
- **Unified service:** Single email service for all use cases
- **Consistent errors:** Same error handling everywhere
- **Comprehensive logging:** Full visibility into email operations

## Migration Path

### For Existing Tenants

**Step 1:** Get SendGrid API Key
- Sign up at https://sendgrid.com
- Create API key with "Mail Send" permissions

**Step 2:** Update Tenant Settings
- Go to Settings page in application
- Enter SendGrid API key
- Click "Test Connection"
- Verify test email received

**Step 3:** Verify Email Sending
- Create a test booking
- Verify ticket email is received
- Check server logs for confirmation

### For New Deployments

**Railway Environment Variables:**
```env
SENDGRID_API_KEY=SG.xxxxxxxxxxxxx  # Optional: Global fallback
```

**Tenant Configuration:**
- Each tenant can have their own SendGrid API key
- Or use global `SENDGRID_API_KEY` environment variable

## Error Handling

### SendGrid API Errors
- **Invalid API Key:** Clear error message with setup instructions
- **Rate Limit:** Automatic retry with exponential backoff
- **Invalid Email:** Validation before sending

### SMTP Errors (Fallback)
- **Connection Timeout:** Suggests using SendGrid API
- **Authentication Failed:** Clear Gmail App Password instructions
- **Port Blocked:** Recommends email API service

## Logging

All email operations log:
```
[EmailAPI] 📧 Sending email via SENDGRID
   To: customer@example.com
   Subject: Booking Ticket
   Attachments: 1 ticket(s)
[EmailAPI] ✅ Email sent via SendGrid to customer@example.com
   Message ID: sg-1234567890
```

## Testing Checklist

- [x] SendGrid API integration
- [x] SMTP fallback for local development
- [x] OTP email sending
- [x] Booking ticket email sending
- [x] Attachment support (PDFs)
- [x] Error handling and logging
- [x] Test endpoint for both providers
- [x] Tenant-specific configuration
- [x] Backward compatibility

## Rollback Plan

If issues occur:
1. Remove `sendgrid_api_key` from tenant settings
2. System automatically uses SMTP fallback
3. No code changes required
4. Can revert to previous version if needed

## Future Enhancements

- [ ] Support for Mailgun API
- [ ] Support for AWS SES
- [ ] Email templates management
- [ ] Delivery tracking webhooks
- [ ] Bounce and complaint handling

---

## Summary

✅ **PRODUCTION-READY EMAIL SYSTEM**

- **No more SMTP timeouts** - HTTP-based API works everywhere
- **Backward compatible** - Existing code works without changes
- **Automatic fallback** - SMTP for local development
- **Tenant-specific** - Each tenant can use their own SendGrid account
- **Comprehensive logging** - Full visibility into email operations
- **Error handling** - Clear error messages and recovery suggestions

**Status:** ✅ **READY FOR PRODUCTION DEPLOYMENT**

The email system will now work reliably in all cloud environments without SMTP connection timeouts.
