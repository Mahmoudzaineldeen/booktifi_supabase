# Zoho Region Mismatch Fix

## 🔍 Issue

After re-authenticating Zoho, token refresh succeeds but API calls still return 401. This indicates a **region mismatch** between:
- The Zoho organization location (Saudi Arabia)
- The API base URL being used (default: US region)

## 🎯 Solution

### Step 1: Determine Your Zoho Organization Region

1. Log in to [Zoho Invoice](https://invoice.zoho.com/)
2. Check the URL - it will show your region:
   - **US**: `invoice.zoho.com` → Use `https://invoice.zoho.com/api/v3`
   - **EU**: `invoice.zoho.eu` → Use `https://invoice.zoho.eu/api/v3`
   - **IN**: `invoice.zoho.in` → Use `https://invoice.zoho.in/api/v3`
   - **AU**: `invoice.zoho.com.au` → Use `https://invoice.zoho.com.au/api/v3`
   - **CN**: `invoice.zoho.com.cn` → Use `https://invoice.zoho.com.cn/api/v3`

### Step 2: Set the Correct API Base URL

Add to your `server/.env` file:

```env
# For Saudi Arabia (typically uses US or EU region)
# Check your Zoho Invoice URL to confirm
ZOHO_API_BASE_URL=https://invoice.zoho.com/api/v3
# OR if EU:
# ZOHO_API_BASE_URL=https://invoice.zoho.eu/api/v3
```

### Step 3: Re-authenticate Zoho

After setting the correct region:

1. Visit: `http://localhost:3001/api/zoho/auth?tenant_id=63107b06-938e-4ce6-b0f3-520a87db397b`
2. Complete the OAuth flow
3. New tokens will be stored for the correct region

### Step 4: Verify

Create a new booking and check server logs for:
- `[ZohoService] ✅ Step 2-3 Complete: Invoice PDF sent via WhatsApp...`

## 📋 Common Regions

| Organization Location | API Base URL |
|---------------------|--------------|
| United States | `https://invoice.zoho.com/api/v3` |
| Europe | `https://invoice.zoho.eu/api/v3` |
| India | `https://invoice.zoho.in/api/v3` |
| Australia | `https://invoice.zoho.com.au/api/v3` |
| China | `https://invoice.zoho.com.cn/api/v3` |

## ⚠️ Important Notes

- **Token Region Must Match API Region**: Tokens from one region won't work with APIs from another region
- **Re-authentication Required**: After changing `ZOHO_API_BASE_URL`, you must re-authenticate to get tokens for the correct region
- **Check Your Invoice URL**: The easiest way to determine your region is to check the URL when you log in to Zoho Invoice

## 🔧 Troubleshooting

### Still Getting 401 After Re-authentication?

1. **Verify Region**: Check your Zoho Invoice login URL
2. **Check Environment Variable**: Ensure `ZOHO_API_BASE_URL` is set correctly
3. **Restart Server**: Restart the server after changing environment variables
4. **Clear Tokens**: Delete old tokens from database and re-authenticate:
   ```sql
   DELETE FROM zoho_tokens WHERE tenant_id = '63107b06-938e-4ce6-b0f3-520a87db397b';
   ```

### How to Check Your Region

1. Log in to Zoho Invoice
2. Look at the browser URL:
   - If it contains `.zoho.com` (not `.zoho.eu`, `.zoho.in`, etc.) → US region
   - If it contains `.zoho.eu` → EU region
   - If it contains `.zoho.in` → India region
   - etc.

## ✅ Expected Outcome

After fixing the region:
- ✅ Token refresh will work correctly
- ✅ API calls will succeed
- ✅ Invoice PDFs will download successfully
- ✅ WhatsApp delivery will work

