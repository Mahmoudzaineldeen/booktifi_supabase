# WhatsApp OTP Troubleshooting Guide

## Issue: WhatsApp OTP Not Received

If you're not receiving WhatsApp OTP messages, follow these steps:

## Step 1: Check Server Console Logs

The server logs detailed information about WhatsApp sending. Look for:

```
📱 ============================================
📱 Sending WhatsApp OTP
📱 ============================================
   Phone to use: +201032560826
   OTP: 123456
   Provider: meta
   Phone Number ID: 939237089264920
   Access Token: SET ✅
```

Then look for either:
- ✅ Success message with Message ID
- ❌ Error message with details

## Step 2: Common Issues and Solutions

### Issue 1: Access Token Expired
**Symptoms**:
- Error: "Invalid access token"
- Error: "Session is invalid"
- Error: "User logged out"

**Solution**:
1. Go to Meta Business Dashboard
2. Generate a new access token
3. Update it in tenant settings

### Issue 2: Phone Number Not Verified
**Symptoms**:
- Error: "Invalid phone number"
- Error: "Phone number not registered"

**Solution**:
1. Verify the phone number in Meta Business Account
2. Ensure the number is registered with WhatsApp Business API
3. Check phone number format (should be 201032560826 without + for API)

### Issue 3: WhatsApp Business Account Not Approved
**Symptoms**:
- Error: "Business account not approved"
- Messages not sending

**Solution**:
1. Check Meta Business Dashboard
2. Ensure WhatsApp Business Account is approved
3. Complete business verification if required

### Issue 4: Phone Number Format Issue
**Symptoms**:
- API call succeeds but message not delivered
- Wrong format in API request

**Solution**:
- Phone number should be: `201032560826` (without +) for Meta API
- Check server logs to see what format was sent

### Issue 5: Rate Limits
**Symptoms**:
- Error: "Rate limit exceeded"
- Messages stop working after many requests

**Solution**:
- Wait for rate limit to reset
- Check Meta Business Dashboard for rate limit status

## Step 3: Verify Configuration

Run the diagnostic script:
```bash
node scripts/check-whatsapp-otp-config.js
```

This will show:
- ✅ Tenant WhatsApp settings configured
- ✅ Provider and credentials status
- ✅ User phone number status

## Step 4: Test Directly

Run the test script and check server console:
```bash
node scripts/test-whatsapp-api-direct.js
```

Then check your server console for:
1. Phone number format used
2. API request details
3. API response or error

## Step 5: Check Meta Business Dashboard

1. Go to Meta Business Dashboard
2. Navigate to WhatsApp → API
3. Check message logs
4. Look for:
   - Message status (sent, delivered, failed)
   - Error messages
   - Rate limit status

## Expected Server Logs

### Success:
```
✅ WhatsApp OTP sent successfully to +201032560826
   Message ID: wamid.xxxxx
   API Response Status: 200
```

### Error:
```
❌ WhatsApp Sending Error
   Error Type: AxiosError
   Error Message: Request failed with status code 400
   Response Status: 400
   Response Data: {
     "error": {
       "message": "Invalid phone number",
       "type": "OAuthException",
       "code": 100
     }
   }
```

## Phone Number Format

### For Database Storage:
- Format: `+201032560826` (with + and country code)

### For Meta WhatsApp API:
- Format: `201032560826` (without +, just country code + number)
- The service automatically removes the + before sending

## Testing Checklist

- [ ] Server is running
- [ ] Tenant WhatsApp settings configured
- [ ] Access token is valid (not expired)
- [ ] Phone number is verified in Meta Business
- [ ] WhatsApp Business Account is approved
- [ ] Phone number format is correct
- [ ] Check server console for errors
- [ ] Check Meta Business Dashboard for message status

## Quick Test

1. Run: `node scripts/test-otp-simple.js`
2. Check server console immediately after
3. Look for WhatsApp API call logs
4. Check for any error messages

## Still Not Working?

If you've checked everything above and still not receiving messages:

1. **Check server console** - Most errors are logged there
2. **Check Meta Business Dashboard** - See actual message status
3. **Verify access token** - Generate a new one and update
4. **Test with a different phone** - Rule out phone-specific issues
5. **Check API response** - Server logs show the exact API response

## Contact Information

If the issue persists, provide:
- Server console logs (WhatsApp sending section)
- Meta Business Dashboard error messages
- Phone number format being used
- Access token status (valid/expired)
