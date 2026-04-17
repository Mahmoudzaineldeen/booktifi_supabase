import { describe, it, expect } from 'vitest';
import { formatTrialCountdownDisplay, shouldShowTrialCountdownBanner, isTenantAccessLocked } from '../../src/lib/trialCountdown';
import type { Tenant } from '../../src/types';

function baseTenant(over: Partial<Tenant> = {}): Tenant {
  return {
    id: 't1',
    name: 'Test',
    name_ar: 'اختبار',
    slug: 'test',
    industry: 'salon',
    tenant_time_zone: 'Asia/Riyadh',
    announced_time_zone: 'Asia/Riyadh',
    subscription_start: '2026-01-01T00:00:00.000Z',
    is_active: true,
    public_page_enabled: true,
    maintenance_mode: false,
    theme_preset: 'blue-gold',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Tenant;
}

describe('trial countdown helpers', () => {
  it('shouldShowTrialCountdownBanner respects flags', () => {
    const end = new Date(Date.now() + 5 * 86_400_000).toISOString();
    expect(
      shouldShowTrialCountdownBanner(
        baseTenant({
          trial_ends_at: end,
          trial_status: 'active',
          trial_countdown_enabled: true,
          is_active: true,
        })
      )
    ).toBe(true);

    expect(
      shouldShowTrialCountdownBanner(
        baseTenant({
          trial_ends_at: end,
          trial_status: 'active',
          trial_countdown_enabled: false,
          is_active: true,
        })
      )
    ).toBe(false);

    expect(
      shouldShowTrialCountdownBanner(
        baseTenant({
          trial_ends_at: end,
          trial_status: 'ACTIVE',
          trial_countdown_enabled: 'true' as unknown as boolean,
          is_active: true,
        })
      )
    ).toBe(true);
  });

  it('isTenantAccessLocked is true when tenant inactive', () => {
    expect(isTenantAccessLocked(baseTenant({ is_active: false }))).toBe(true);
    expect(isTenantAccessLocked(baseTenant({ is_active: true }))).toBe(false);
  });

  it('formatTrialCountdownDisplay uses override when set', () => {
    const t = baseTenant({
      trial_ends_at: new Date(Date.now() + 86400000).toISOString(),
      trial_message_override: 'Custom headline',
    });
    expect(formatTrialCountdownDisplay(t, Date.now(), 'en')).toBe('Custom headline');
  });

  it('formatTrialCountdownDisplay shows days in English', () => {
    const now = new Date('2026-04-17T12:00:00.000Z').getTime();
    const end = new Date('2026-04-21T23:59:00.000Z').toISOString();
    const t = baseTenant({
      trial_ends_at: end,
      tenant_time_zone: 'UTC',
      announced_time_zone: 'UTC',
    });
    const s = formatTrialCountdownDisplay(t, now, 'en');
    expect(s).toContain('days');
    expect(s).toContain('—');
  });

  it('formatTrialCountdownDisplay uses Arabic for lang=ar', () => {
    const now = new Date('2026-04-17T12:00:00.000Z').getTime();
    const end = new Date('2026-04-21T23:59:00.000Z').toISOString();
    const t = baseTenant({
      trial_ends_at: end,
      tenant_time_zone: 'UTC',
      announced_time_zone: 'UTC',
    });
    const s = formatTrialCountdownDisplay(t, now, 'ar');
    expect(s).toMatch(/ينتهي|تجريبي/);
  });
});
