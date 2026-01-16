# Email Ticket Not Received - Diagnosis Guide

## Quick Checks

### 1. Check Server Logs

When a booking is created, the server should log:
```
📧 Step 3: Attempting to send ticket via Email to <email>...
✅ Step 3 Complete: Ticket PDF sent via Email to <email>
```

**If you see errors**, note them down.

### 2. Check Email Configuration

Run:
```bash
cd project/server
node scripts/check-customer-booking.js
```

This will show:
- SMTP configuration status
- Email addresses in bookings
- Any missing configuration

### 3. Common Issues

#### Issue: "SMTP verification failed"
**Solution**: Check SMTP credentials in `.env` file

#### Issue: "Email configuration missing"
**Solution**: Set `SMTP_USER` and `SMTP_PASSWORD` in `.env`

#### Issue: Email sent but not received
**Solutions**:
- Check spam folder
- Check promotions tab (Gmail)
- Verify email address is correct
- Check email provider's filters

### 4. Test Email Sending

The email is sent asynchronously in `process.nextTick`, so it won't block the booking response. Check server logs immediately after booking creation.

### 5. Manual Email Test

To test email sending separately, you can:
1. Check server logs when booking is created
2. Look for email sending errors
3. Verify SMTP credentials are working

## Expected Behavior

When a customer books:
1. ✅ Booking created in database
2. ✅ Ticket PDF generated
3. ✅ Ticket sent via WhatsApp (if phone provided)
4. ✅ Ticket sent via Email (if email provided)
5. ❌ Invoice NOT created (until payment confirmed)

## If Email Still Not Working

1. **Check SMTP Credentials**:
   - Gmail requires "App Password" (not regular password)
   - Enable "Less secure app access" or use OAuth2

2. **Check Firewall/Network**:
   - SMTP port 587 should be open
   - Check if your server can reach smtp.gmail.com

3. **Check Email Provider Limits**:
   - Gmail has daily sending limits
   - Check if you've exceeded limits

4. **Check Server Logs**:
   - Look for specific error messages
   - Check if email is being queued or failing immediately

