/**
 * Email Service - Production-Ready Implementation
 * Uses SendGrid API (HTTP-based) for cloud environments
 * Falls back to SMTP for local development
 * 
 * This service automatically handles:
 * - SendGrid API (production, no port blocking)
 * - SMTP fallback (local development)
 * - Tenant-specific configuration
 * - Comprehensive error handling and logging
 */

import { sendEmail, testEmailConnection, type SendEmailOptions, type EmailAttachment } from './emailApiService';
import { supabase } from '../db';

// Legacy functions removed - now using emailApiService
// These were kept for reference but are no longer used

/**
 * Get sender email from tenant SMTP settings
 */
async function getSenderEmail(tenantId: string): Promise<string> {
  try {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('smtp_settings')
      .eq('id', tenantId)
      .single();

    if (tenant?.smtp_settings?.smtp_user) {
      return tenant.smtp_settings.smtp_user;
    }
    
    return 'noreply@bookati.com';
  } catch (error: any) {
    console.error('Error fetching sender email:', error);
    return 'noreply@bookati.com';
  }
}

/**
 * Send OTP email via SMTP
 */
export async function sendOTPEmail(email: string, otp: string, tenantId: string, language: 'en' | 'ar' = 'en') {
  const subject = language === 'ar' 
    ? 'رمز التحقق لإعادة تعيين كلمة المرور'
    : 'Password Reset OTP Code';
  
  const html = language === 'ar' 
    ? `
      <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb;">رمز التحقق لإعادة تعيين كلمة المرور</h2>
        <p>مرحباً،</p>
        <p>لقد طلبت إعادة تعيين كلمة المرور. استخدم الرمز التالي للتحقق:</p>
        <div style="background-color: #f0f0f0; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; border-radius: 8px; border: 2px solid #2563eb;">
          ${otp}
        </div>
        <p style="color: #666;">هذا الرمز صالح لمدة 10 دقائق فقط.</p>
        <p style="color: #666;">إذا لم تطلب إعادة تعيين كلمة المرور، يرجى تجاهل هذا البريد الإلكتروني.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">شكراً لك،<br>فريق Bookati</p>
      </div>
    `
    : `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb;">Password Reset OTP Code</h2>
        <p>Hello,</p>
        <p>You have requested to reset your password. Use the following code to verify:</p>
        <div style="background-color: #f0f0f0; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; border-radius: 8px; border: 2px solid #2563eb;">
          ${otp}
        </div>
        <p style="color: #666;">This code is valid for 10 minutes only.</p>
        <p style="color: #666;">If you did not request a password reset, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">Thank you,<br>The Bookati Team</p>
      </div>
    `;

  const fromEmail = await getSenderEmail(tenantId);
  
  const emailOptions: SendEmailOptions = {
    from: `"Bookati" <${fromEmail}>`,
    to: email,
    subject,
    html,
  };

  const result = await sendEmail(tenantId, emailOptions);
  
  if (!result.success) {
    console.error(`[EmailService] ❌ Failed to send OTP email to ${email}`);
    console.error(`   Error: ${result.error}`);
    console.error(`   Provider: ${result.provider || 'unknown'}`);
    
    // In development, log OTP to console
    if (process.env.NODE_ENV !== 'production') {
      console.log(`   [DEV] OTP for ${email}: ${otp}`);
    }
  }

  return {
    success: result.success,
    error: result.error,
  };
}

/**
 * Send booking ticket PDF via email
 * Uses production-ready email API service (SendGrid API > SMTP)
 */
export async function sendBookingTicketEmail(
  email: string,
  pdfBuffer: Buffer,
  bookingId: string,
  tenantId: string,
  bookingDetails: {
    service_name: string;
    service_name_ar?: string;
    slot_date: string;
    start_time: string;
    end_time: string;
    tenant_name?: string;
    tenant_name_ar?: string;
  },
  language: 'en' | 'ar' = 'en',
  allTicketBuffers?: Buffer[] // Optional: Array of all ticket PDFs for multiple attachments
): Promise<{ success: boolean; error?: string }> {
  const subject = language === 'ar' 
    ? 'تذكرة الحجز - Booking Ticket'
    : 'Booking Ticket';
  
  const html = language === 'ar'
    ? `
      <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb;">تم تأكيد حجزك!</h2>
        <p>شكراً لك على حجزك. يرجى الاطلاع على التذكرة المرفقة.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p><strong>تفاصيل الحجز:</strong></p>
        <ul>
          <li>رقم الحجز: ${bookingId}</li>
          <li>الخدمة: ${bookingDetails.service_name_ar || bookingDetails.service_name}</li>
          <li>التاريخ: ${bookingDetails.slot_date}</li>
          <li>الوقت: ${bookingDetails.start_time} - ${bookingDetails.end_time}</li>
        </ul>
        <p>يرجى إحضار هذه التذكرة عند الوصول.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">شكراً لك،<br>${bookingDetails.tenant_name_ar || bookingDetails.tenant_name || 'فريق Bookati'}</p>
      </div>
    `
    : `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb;">Your booking is confirmed!</h2>
        <p>Thank you for your booking. Please find your ticket attached.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p><strong>Booking Details:</strong></p>
        <ul>
          <li>Booking ID: ${bookingId}</li>
          <li>Service: ${bookingDetails.service_name_ar || bookingDetails.service_name}</li>
          <li>Date: ${bookingDetails.slot_date}</li>
          <li>Time: ${bookingDetails.start_time} - ${bookingDetails.end_time}</li>
        </ul>
        <p>Please bring this ticket upon arrival.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">Thank you,<br>${bookingDetails.tenant_name || 'The Bookati Team'}</p>
      </div>
    `;

  const fromEmail = await getSenderEmail(tenantId);
  
  // Prepare attachments
  const attachments: EmailAttachment[] = allTicketBuffers && allTicketBuffers.length > 1
    ? allTicketBuffers.map((buffer, index) => ({
        filename: `booking_ticket_${bookingId}_${index + 1}of${allTicketBuffers.length}.pdf`,
        content: buffer,
        contentType: 'application/pdf',
      }))
    : [{
        filename: `booking_ticket_${bookingId}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }];

  const emailOptions: SendEmailOptions = {
    from: `"${bookingDetails.tenant_name || 'Bookati'}" <${fromEmail}>`,
    to: email,
    subject,
    html,
    attachments,
  };

  console.log(`[EmailService] 📧 Attempting to send booking ticket email:`);
  console.log(`   To: ${email}`);
  console.log(`   Subject: ${subject}`);
  console.log(`   Attachments: ${attachments.length} ticket(s)`);
  attachments.forEach((att, idx) => {
    const size = Buffer.isBuffer(att.content) 
      ? (att.content.length / 1024).toFixed(2)
      : 'unknown';
    console.log(`     ${idx + 1}. ${att.filename} (${size} KB)`);
  });

  const result = await sendEmail(tenantId, emailOptions);
  
  if (!result.success) {
    console.error(`[EmailService] ❌ Failed to send booking ticket email to ${email}`);
    console.error(`   Error: ${result.error}`);
    console.error(`   Provider: ${result.provider || 'unknown'}`);
  } else {
    console.log(`[EmailService] ✅ Booking ticket email sent successfully`);
    console.log(`   Message ID: ${result.messageId}`);
    console.log(`   Provider: ${result.provider || 'unknown'}`);
  }

  return {
    success: result.success,
    error: result.error,
  };
}

/**
 * Test email connection for a tenant
 * Exported for use in API endpoints
 */
export async function testEmailService(tenantId: string) {
  return await testEmailConnection(tenantId);
}

