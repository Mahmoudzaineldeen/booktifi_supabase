# Zoho 401 Error Fix

## ✅ What Was Fixed

### Issue
- **Error**: `Request failed with status code 401` when downloading invoice PDF
- **Cause**: Access token expired or invalid, but token refresh wasn't being triggered on 401 errors

### Solution
Added automatic token refresh and retry logic for 401 errors in `downloadInvoicePdf()`:

1. **Detect 401 Error**: When API returns 401 Unauthorized
2. **Refresh Token**: Automatically refresh access token using refresh token
3. **Retry Request**: Retry the PDF download with the new token
4. **Error Handling**: If refresh fails, provide clear error message

## 🔧 Implementation

### Before:
```typescript
async downloadInvoicePdf(tenantId, invoiceId) {
  const accessToken = await this.getAccessToken(tenantId);
  // Direct request - fails on 401
  const response = await axios.get(...);
}
```

### After:
```typescript
async downloadInvoicePdf(tenantId, invoiceId) {
  let accessToken = await this.getAccessToken(tenantId);
  try {
    const response = await axios.get(...);
  } catch (error) {
    if (error.response?.status === 401) {
      // Refresh token and retry
      accessToken = await this.refreshAccessToken(tenantId, refreshToken);
      const retryResponse = await axios.get(...); // Retry with new token
    }
  }
}
```

## 📋 How It Works

1. **First Attempt**: Try to download PDF with current access token
2. **401 Detected**: If API returns 401, catch the error
3. **Token Refresh**: Get refresh token from database and refresh access token
4. **Retry**: Retry the PDF download with the new access token
5. **Success**: Return PDF buffer if retry succeeds

## ⚠️ Error Handling

If token refresh fails:
- Clear error message: "Failed to download invoice PDF: Token refresh failed. Please re-authenticate Zoho."
- Logs detailed error information for debugging
- Suggests re-authentication if refresh token is invalid

## 🚀 Next Steps

If you still get 401 errors after this fix:

1. **Check Zoho OAuth**: Ensure OAuth flow is completed
   ```bash
   # Visit this URL to re-authenticate:
   http://localhost:3001/api/zoho/auth?tenant_id={your_tenant_id}
   ```

2. **Check Refresh Token**: Verify refresh token exists in database
   ```sql
   SELECT tenant_id, expires_at, updated_at 
   FROM zoho_tokens 
   WHERE tenant_id = '{your_tenant_id}';
   ```

3. **Check Token Expiry**: Tokens should auto-refresh, but if refresh token is invalid, re-authenticate

## 📝 Summary

✅ **Automatic token refresh** on 401 errors
✅ **Retry logic** with refreshed token
✅ **Better error messages** for debugging
✅ **Graceful failure** with clear instructions

The invoice PDF download should now handle expired tokens automatically!

