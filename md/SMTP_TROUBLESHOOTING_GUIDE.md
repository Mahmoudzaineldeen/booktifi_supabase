# SMTP Connection Troubleshooting Guide

## Common Error: Connection Timeout (ETIMEDOUT)

### Symptoms
- Error: `Connection timeout: SMTP server did not respond within 35 seconds`
- Error code: `ETIMEDOUT`
- Error command: `CONN`

### Permanent Solutions

#### 1. Use Gmail App Password (RECOMMENDED)

**Why:** Gmail blocks regular passwords for security. App Passwords are required.

**Steps:**
1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** (if not already enabled)
3. Go to [App Passwords](https://myaccount.google.com/apppasswords)
4. Select:
   - App: **Mail**
   - Device: **Other (Custom name)**
   - Name: **Bookati**
5. Click **Generate**
6. Copy the 16-character password (format: `xxxx xxxx xxxx xxxx`)
7. Use this password in your SMTP settings (spaces are optional)

**Important:** 
- Use the app password, NOT your regular Gmail password
- App passwords are case-sensitive
- Remove any spaces when entering

#### 2. Try Port 465 with SSL

**Why:** Port 465 uses SSL directly, which is often more reliable in cloud environments.

**Steps:**
1. Change SMTP port from `587` to `465`
2. Enable "Use SSL" option
3. Test the connection

**Settings:**
- Host: `smtp.gmail.com`
- Port: `465`
- Security: `SSL` (not TLS)
- Username: Your Gmail address
- Password: Gmail App Password

#### 3. Use Email API Service (BEST FOR PRODUCTION)

**Why:** Cloud environments often block SMTP ports. Email APIs are more reliable.

**Recommended Services:**

**SendGrid (Free Tier: 100 emails/day)**
- Sign up: https://sendgrid.com
- Get API key from dashboard
- Use SMTP relay or API

**Mailgun (Free Tier: 5,000 emails/month)**
- Sign up: https://www.mailgun.com
- Get SMTP credentials from dashboard

**AWS SES (Very Affordable)**
- Sign up: AWS Console
- Request production access
- Get SMTP credentials

**Benefits:**
- More reliable in cloud environments
- Better deliverability
- Analytics and tracking
- No port blocking issues

#### 4. Check Railway/Cloud Provider Settings

**Why:** Some cloud providers block outbound SMTP ports for security.

**Solutions:**
1. Contact Railway support to allow ports 587/465
2. Use Railway's email service (if available)
3. Use an email API service instead

#### 5. Network/Firewall Issues

**Check:**
- Is your network blocking SMTP ports?
- Try from a different network
- Check firewall rules
- Test from local machine first

### Quick Fix Checklist

- [ ] Using Gmail App Password (not regular password)
- [ ] 2-Step Verification enabled
- [ ] Tried port 465 with SSL
- [ ] Removed spaces from password
- [ ] Verified email address is correct
- [ ] Tested from different network
- [ ] Considered email API service

### Error Code Reference

| Error Code | Meaning | Solution |
|------------|---------|----------|
| `ETIMEDOUT` | Connection timeout | Use App Password, try port 465, or use email API |
| `ECONNREFUSED` | Connection refused | Port blocked - use email API service |
| `EAUTH` | Authentication failed | Use Gmail App Password |
| `EHOSTNOTFOUND` | Host not found | Check SMTP host address |
| `ECONNRESET` | Connection reset | Try port 465 or use email API |

### Testing

After making changes:
1. Save SMTP settings
2. Click "Test Connection"
3. Check your email inbox for test email
4. If still failing, try next solution

### Production Recommendation

For production deployments on Railway/cloud:
- **Best:** Use SendGrid, Mailgun, or AWS SES
- **Good:** Use Gmail App Password with port 465
- **Acceptable:** Use Gmail App Password with port 587 (may have issues)

---

**Need Help?** If none of these solutions work, the issue is likely with your hosting provider blocking SMTP ports. In this case, an email API service is the only reliable solution.
