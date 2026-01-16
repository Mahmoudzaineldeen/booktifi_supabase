# كيفية الحصول على رمز OTP

## المشكلة
لم تستلم بريد إلكتروني يحتوي على رمز OTP.

## الحلول

### الحل 1: التحقق من Console الخادم (Development Mode)

إذا كنت في وضع التطوير (`npm run dev`)، سيتم طباعة رمز OTP في console الخادم:

1. افتح terminal حيث يعمل الخادم (`project/server`)
2. ابحث عن رسالة مثل:
   ```
   📧 ============================================
   📧 OTP FOR MAHMOUDNZAINELDEEN@GMAIL.COM
   📧 CODE: 123456
   📧 Expires at: 2025-12-03T...
   📧 ============================================
   ```

### الحل 2: استخدام Script للتحقق من قاعدة البيانات

قم بتشغيل:
```bash
cd project
node scripts/get_otp_from_db.js mahmoudnzaineldeen@gmail.com
```

سيظهر لك:
- رمز OTP
- حالة الرمز (صالح/منتهي/مستخدم)
- وقت انتهاء الصلاحية

### الحل 3: التحقق يدوياً من قاعدة البيانات

```sql
SELECT email, otp_code, expires_at, created_at, verified 
FROM otp_requests 
WHERE email = 'mahmoudnzaineldeen@gmail.com' 
ORDER BY created_at DESC 
LIMIT 1;
```

### الحل 4: إعداد SMTP (لإرسال البريد فعلياً)

أضف إلى `project/server/.env`:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
```

**لـ Gmail:**
1. فعّل التحقق بخطوتين: https://myaccount.google.com/security
2. أنشئ App Password: https://myaccount.google.com/apppasswords
3. استخدم App Password في `SMTP_PASSWORD`

## ملاحظات

- في وضع التطوير، OTP يُحفظ في قاعدة البيانات حتى لو لم يُرسل البريد
- تحقق من مجلد Spam في بريدك
- تأكد من أن migration تم تطبيقه (عمود `email` موجود في `otp_requests`)

## التحقق من حالة SMTP

تحقق من console الخادم:
- ✅ `OTP email sent to...` = البريد أُرسل بنجاح
- ⚠️ `SMTP credentials not configured` = SMTP غير مُعد (OTP موجود في DB)
- ❌ `Failed to send OTP email` = خطأ في إرسال البريد (OTP موجود في DB)

---

**بعد الحصول على OTP من أي طريقة أعلاه، يمكنك استخدامه للتحقق!**

