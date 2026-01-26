# Production-Ready Email System Refactor

## Overview

The email system has been completely refactored to use **SendGrid API (HTTP-based)** instead of direct SMTP connections. This eliminates SMTP connection timeout issues in cloud/container environments.

## Architecture

### New Email Service (`emailApiService.ts`)

**Priority Order:**
1. **SendGrid API** (Recommended for production)
   - HTTP-based, no port blocking
   - Works reliably in all cloud environments
   - Free tier: 100 emails/day

2. **SMTP Fallback** (For local development)
   - Only used if SendGrid API key is not configured
   - Supports Gmail, Outlook, and other SMTP providers

### Configuration

**Environment Variables:**
- `SENDGRID_API_KEY` - Global SendGrid API key (optional, can be tenant-specific)

**Database Settings (per tenant):**
- `tenants.email_settings.sendgrid_api_key` - Tenant-specific SendGrid API key
- `tenants.email_settings.from_email` - Sender email address
- `tenants.smtp_settings` - SMTP fallback (for local development)

## Implementation Details

### 1. Email API Service (`server/src/services/emailApiService.ts`)

**Key Functions:**
- `sendEmail(tenantId, options)` - Main email sending function
- `testEmailConnection(tenantId)` - Test email configuration
- Automatic provider selection (SendGrid > SMTP)
- Comprehensive error handling and logging

**Features:**
- ✅ HTTP-based (no port blocking)
- ✅ Automatic fallback to SMTP if API not configured
- ✅ Tenant-specific configuration
- ✅ Attachment support (PDFs, images, etc.)
- ✅ HTML and plain text support
- ✅ Reply-to address support

### 2. Refactored Email Service (`server/src/services/emailService.ts`)

**Updated Functions:**
- `sendOTPEmail()` - Now uses email API service
- `sendBookingTicketEmail()` - Now uses email API service
- `testEmailService()` - Exported for API endpoints

**Backward Compatibility:**
- ✅ Same function signatures
- ✅ Same return types
- ✅ No breaking changes

### 3. Updated API Endpoints (`server/src/routes/tenants.ts`)

**PUT `/api/tenants/smtp-settings`:**
- Now accepts `sendgrid_api_key` parameter
- Supports both SendGrid API and SMTP configuration
- Stores settings in `email_settings` (SendGrid) and `smtp_settings` (SMTP)

**POST `/api/tenants/smtp-settings/test`:**
- Tests SendGrid API first (if configured)
- Falls back to SMTP testing
- Sends actual test email to verify configuration

## Migration Guide

### For Existing Tenants

**Option 1: Use SendGrid API (Recommended)**
1. Sign up for SendGrid: https://sendgrid.com
2. Get API key from SendGrid dashboard
3. Update tenant settings:
   ```json
   {
     "email_settings": {
       "sendgrid_api_key": "SG.xxxxxxxxxxxxx",
       "from_email": "noreply@yourdomain.com"
     }
   }
   ```

**Option 2: Keep SMTP (Local Development Only)**
- SMTP settings continue to work for local development
- Not recommended for production deployments

### Environment Variables

**Railway/Production:**
```env
SENDGRID_API_KEY=SG.xxxxxxxxxxxxx  # Optional: Global fallback
```

**Local Development:**
- Can use SMTP (Gmail, etc.)
- Or use SendGrid API key

## Benefits

### ✅ Production Reliability
- No SMTP port blocking issues
- Works in all cloud environments (Railway, Bolt, AWS, etc.)
- HTTP-based API (standard ports 80/443)

### ✅ Scalability
- SendGrid handles high email volumes
- Better deliverability rates
- Email analytics and tracking

### ✅ Security
- API keys stored securely in database
- No password exposure in logs
- Tenant-specific configuration

### ✅ Maintainability
- Single unified email service
- Consistent error handling
- Comprehensive logging

## Testing

### Test Email Connection
```bash
POST /api/tenants/smtp-settings/test
{
  "sendgrid_api_key": "SG.xxxxxxxxxxxxx"
}
```

### Test SMTP (Fallback)
```bash
POST /api/tenants/smtp-settings/test
{
  "smtp_user": "user@gmail.com",
  "smtp_password": "app-password"
}
```

## Error Handling

### SendGrid API Errors
- Invalid API key → Clear error message
- Rate limit exceeded → Automatic retry logic
- Invalid email format → Validation before sending

### SMTP Errors (Fallback)
- Connection timeout → Suggests using SendGrid API
- Authentication failed → Clear Gmail App Password instructions
- Port blocked → Recommends email API service

## Logging

All email operations are logged with:
- Provider used (SendGrid/SMTP)
- Success/failure status
- Error details (if failed)
- Message IDs (if successful)

## Future Enhancements

- [ ] Support for Mailgun API
- [ ] Support for AWS SES
- [ ] Email templates management
- [ ] Email delivery tracking
- [ ] Bounce handling

## Rollback Plan

If issues occur:
1. Remove `sendgrid_api_key` from tenant settings
2. System automatically falls back to SMTP
3. No code changes required

---

**Status:** ✅ **PRODUCTION-READY**  
**Deployment:** Ready for Railway/Bolt/production environments  
**Breaking Changes:** None (backward compatible)
