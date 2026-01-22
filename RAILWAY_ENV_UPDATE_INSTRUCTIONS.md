# Railway Environment Variable Update Instructions

## ⚠️ Critical: Update APP_URL in Railway

Your QR codes are still using the old Bolt URL (`https://bookati-2jy1.bolt.host`) because the `APP_URL` environment variable in Railway is not updated.

## Quick Fix

### Step 1: Access Railway Dashboard
1. Go to [Railway Dashboard](https://railway.app)
2. Select your project: `booktifisupabase-production`
3. Click on your backend service

### Step 2: Update APP_URL Environment Variable
1. Go to the **Variables** tab
2. Find the `APP_URL` variable
3. Update it to your Railway backend URL:
   ```
   https://booktifisupabase-production.up.railway.app
   ```
4. **Remove** any old Bolt URL values
5. Save the changes

### Step 3: Redeploy (if needed)
- Railway will automatically redeploy when environment variables change
- If not, manually trigger a redeploy

## Verify the Fix

After updating `APP_URL`:

1. **Check Railway Logs**: Look for QR code generation logs
   - Should see: `[QR Code] Generated URL for booking...`
   - Should see: `Source: APP_URL environment variable`
   - Should NOT see: `WARNING: APP_URL is set to old Bolt URL`

2. **Create a Test Booking**: 
   - Create a new booking
   - Check the generated ticket PDF
   - Scan the QR code
   - Verify it contains the Railway URL, not Bolt URL

3. **Test QR Scanning**:
   - Scan with external scanner → Should open Railway URL
   - Scan with internal scanner → Should validate correctly

## Current Railway Backend URL

Based on your configuration, your Railway backend URL should be:
```
https://booktifisupabase-production.up.railway.app
```

## Temporary Fallback

The code now includes a fallback that will:
- Detect if `APP_URL` contains `bolt.host`
- Try to use `RAILWAY_PUBLIC_DOMAIN` or `RAILWAY_STATIC_URL` if available
- Fall back to known Railway URL pattern

**However, you should still update `APP_URL` in Railway** to ensure consistency and avoid relying on fallbacks.

## Environment Variables to Check

In Railway, ensure these are set correctly:

1. **APP_URL** (Required)
   - Value: `https://booktifisupabase-production.up.railway.app`
   - Purpose: Backend base URL for QR codes and redirects

2. **FRONTEND_URL** (Optional)
   - Value: `https://delightful-florentine-7b58a9.netlify.app`
   - Purpose: Frontend URL (used as fallback if APP_URL not set)

3. **RAILWAY_PUBLIC_DOMAIN** (Auto-set by Railway)
   - Should be: `booktifisupabase-production.up.railway.app`
   - Purpose: Railway automatically sets this

## After Update

Once `APP_URL` is updated:
- ✅ New bookings will have QR codes with Railway URL
- ✅ Existing bookings with old QR codes will still work (backward compatible)
- ✅ External scanners will open Railway URL
- ✅ Internal scanners will extract booking ID correctly

## Need Help?

If you're unsure about your Railway URL:
1. Check Railway dashboard → Your service → Settings → Domains
2. Or check the Railway logs for the actual deployed URL
3. The URL format is usually: `https://{service-name}.up.railway.app`
