# SMTP Port 587 Blocked - Railway/Cloud Hosting Fix

## Problem

**Error**: `SMTP connection failed: Connection timeout`

**Cause**: Railway (and most cloud hosting providers) **block SMTP port 587** to prevent spam and abuse. This is a standard security measure.

## Solution: Use Port 465 (SSL) Instead

Port 465 is less commonly blocked because it uses SSL/TLS encryption from the start.

### Steps to fix

1. **Go to Settings page** in your app
2. **Update SMTP Port**: Change from `587` to `465`
3. **Keep everything else the same**:
   - SMTP Host: `smtp.gmail.com`
   - Email: Your Gmail address
   - App Password: Your 16-character Gmail App Password
4. **Click "Test Connection"**

### SMTP Settings

```
SMTP Host:     smtp.gmail.com
SMTP Port:     465          ← CHANGE THIS from 587 to 465
Email:         your-email@gmail.com
App Password:  xxxx xxxx xxxx xxxx  (16 characters, no spaces)
```

## Why This Works

- **Port 587**: TLS encryption (STARTTLS) - Commonly blocked by hosting providers
- **Port 465**: SSL encryption (SMTPS) - Less commonly blocked, more secure

## Gmail App Password Required

Gmail requires an **App Password** (not your regular password) for SMTP access.

### How to generate Gmail App Password:

1. Go to: https://myaccount.google.com/apppasswords
2. **Enable 2-Step Verification** if not already enabled (required)
3. Click "Generate" under App Passwords
4. Select "Mail" as the app type
5. Copy the 16-character password (format: `xxxx xxxx xxxx xxxx`)
6. **Paste it WITHOUT spaces** in the App Password field

## After Making Changes

1. **Save SMTP Settings** with port 465
2. **Click "Test Connection"**
3. You should receive a test email within 10-15 seconds
4. If successful, tickets will be sent via email for all bookings

## Alternative Ports

If port 465 is also blocked (rare), you have these options:

### Option 1: Use a different email provider
- **Mailgun SMTP** (port 2525) - rarely blocked
- **SendinBlue SMTP** (port 587 but different IP ranges)
- **Amazon SES** (works well with cloud hosting)

### Option 2: Contact Railway support
- Ask them to unblock SMTP ports for your service
- Explain you need it for transactional emails (not spam)

## Testing

After changing to port 465:

```bash
# Run the email test
# The test will:
# 1. Verify SMTP connection
# 2. Send a test email
# 3. Confirm delivery
```

Expected result: ✅ "SMTP connection test successful! Test email sent to your-email@gmail.com"

## Verification

Check your Railway logs for:
```
[EmailAPI] ✅ Using SMTP as email provider
[EmailAPI]    SMTP Host: smtp.gmail.com
[EmailAPI]    SMTP Port: 465
[EmailAPI]    SMTP User: your-email@gmail.com
[EmailAPI] Testing SMTP connection to smtp.gmail.com:465...
[EmailAPI] ✅ SMTP connection verified successfully
[EmailAPI] ✅ Email sent via SMTP to your-email@gmail.com
```

## Important Notes

1. **App Password is NOT your Gmail password** - it's a special 16-character code
2. **2-Step Verification must be enabled** to generate App Passwords
3. **Port 465 works better on cloud hosting** than port 587
4. **Copy the App Password without spaces** (xxxxxxxxxxxx, not xxxx xxxx xxxx xxxx)

## Summary

- **Problem**: Port 587 blocked by Railway
- **Solution**: Use port 465 instead
- **Requirement**: Gmail App Password (not regular password)
- **Result**: Emails will work correctly

After these changes, all booking tickets will be automatically sent via email.
