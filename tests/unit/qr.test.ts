/**
 * Unit Tests for QR Code System
 */

import { describe, it, expect } from 'vitest';
import { generateQRToken, verifyQRToken, QRTokenPayload } from '../../src/lib/qr';

describe('QR Code Generation', () => {
  const mockPayload: Omit<QRTokenPayload, 'generated_at_utc' | 'expires_at_utc'> = {
    booking_id: 'test-booking-id',
    tenant_id: 'test-tenant-id',
    customer_name: 'Test Customer',
    booking_date_utc: new Date().toISOString(),
  };

  it('should generate a valid QR token', () => {
    const token = generateQRToken(mockPayload);
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('should generate different tokens for different bookings', () => {
    const token1 = generateQRToken({ ...mockPayload, booking_id: 'booking-1' });
    const token2 = generateQRToken({ ...mockPayload, booking_id: 'booking-2' });
    expect(token1).not.toBe(token2);
  });

  it('should include expiration time in token', () => {
    const bookingDate = new Date();
    const token = generateQRToken({
      ...mockPayload,
      booking_date_utc: bookingDate.toISOString(),
    });
    
    const result = verifyQRToken(token);
    expect(result.valid).toBe(true);
    if (result.payload) {
      const expiresAt = new Date(result.payload.expires_at_utc);
      const expectedExpiresAt = new Date(bookingDate.getTime() + 48 * 60 * 60 * 1000);
      expect(expiresAt.getTime()).toBeCloseTo(expectedExpiresAt.getTime(), -3);
    }
  });
});

describe('QR Code Verification', () => {
  const mockPayload: Omit<QRTokenPayload, 'generated_at_utc' | 'expires_at_utc'> = {
    booking_id: 'test-booking-id',
    tenant_id: 'test-tenant-id',
    customer_name: 'Test Customer',
    booking_date_utc: new Date().toISOString(),
  };

  it('should verify a valid token', () => {
    const token = generateQRToken(mockPayload);
    const result = verifyQRToken(token);
    
    expect(result.valid).toBe(true);
    expect(result.payload).toBeDefined();
    if (result.payload) {
      expect(result.payload.booking_id).toBe(mockPayload.booking_id);
      expect(result.payload.tenant_id).toBe(mockPayload.tenant_id);
      expect(result.payload.customer_name).toBe(mockPayload.customer_name);
    }
  });

  it('should reject an invalid token', () => {
    const result = verifyQRToken('invalid-token');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should reject an expired token', () => {
    const expiredDate = new Date();
    expiredDate.setHours(expiredDate.getHours() - 49); // 49 hours ago
    
    const token = generateQRToken({
      ...mockPayload,
      booking_date_utc: expiredDate.toISOString(),
    });
    
    const result = verifyQRToken(token);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('should reject a tampered token', () => {
    const token = generateQRToken(mockPayload);
    const tamperedToken = token.slice(0, -5) + 'XXXXX';
    
    const result = verifyQRToken(tamperedToken);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});


