# OTP Delivery Test Scripts

## Overview
Test scripts to verify OTP delivery via Email and WhatsApp.

## Test Accounts
- **Email**: mahmoudnzaineldeen@gmail.com
- **Phone**: +2001032560826

## Scripts

### 1. Simple OTP Test (`test-otp-simple.js`)
Quick test to send OTP via both email and WhatsApp.

**Usage**:
```bash
node scripts/test-otp-simple.js
```

**What it does**:
1. Checks server health
2. Sends OTP via email to mahmoudnzaineldeen@gmail.com
3. Sends OTP via WhatsApp to +2001032560826
4. Displays results

### 2. Comprehensive OTP Test (`test-otp-delivery.js`)
Full test suite with OTP verification and password reset.

**Usage**:
```bash
# Test email OTP only
node scripts/test-otp-delivery.js --skip-whatsapp

# Test WhatsApp OTP only
node scripts/test-otp-delivery.js --skip-email

# Test complete flow with OTP code
node scripts/test-otp-delivery.js --otp 123456 --method email
node scripts/test-otp-delivery.js --otp 123456 --method whatsapp
```

**What it does**:
1. Checks server health
2. Finds user by identifier
3. Requests OTP via selected method
4. Verifies OTP (if code provided)
5. Resets password (if verification successful)

## Expected Results

### Email OTP
- ✅ OTP request successful
- Check email inbox for OTP code
- In development mode, check server console for OTP

### WhatsApp OTP
- ✅ OTP request successful
- Check WhatsApp for OTP message
- In development mode, check server console for OTP

## Troubleshooting

### Server Not Running
```
❌ Cannot connect to server
```
**Solution**: Start the server
```bash
cd server && npm run dev
```

### Email OTP Failed
```
❌ Email OTP failed: SMTP settings not configured
```
**Solution**: Configure SMTP settings in tenant settings page

### WhatsApp OTP Failed
```
❌ WhatsApp OTP failed: WhatsApp settings not configured
```
**Solution**: Configure WhatsApp settings in tenant settings page

### User Not Found
```
❌ User not found
```
**Solution**: Ensure the test account exists in the database

## Verification Steps

1. **Run the test**:
   ```bash
   node scripts/test-otp-simple.js
   ```

2. **Check delivery**:
   - Email: Check inbox for OTP code
   - WhatsApp: Check WhatsApp messages
   - Server: Check console logs (development mode)

3. **Verify OTP** (optional):
   ```bash
   node scripts/test-otp-delivery.js --otp <CODE> --method email
   node scripts/test-otp-delivery.js --otp <CODE> --method whatsapp
   ```

## Notes

- In development mode, OTP codes are logged to server console
- OTP codes expire after 10 minutes
- Each OTP can only be used once
- Password reset requires OTP verification first
