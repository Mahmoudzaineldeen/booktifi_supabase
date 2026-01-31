/**
 * Landing page settings normalization.
 *
 * Stored data is always flat (no nested landingPage object). This helper
 * supports backward compatibility: if old format is detected
 * (data.landingPage?.title, etc.), it is safely mapped to flat (data.title, etc.)
 * so existing saved content continues to work.
 */

export type LandingPageSettingsRaw = unknown;

/**
 * Normalizes landing_page_settings from DB/API into a flat object.
 * - If value is null/undefined: returns {}.
 * - If value is a string: parses as JSON then normalizes.
 * - If value has nested "landingPage" (old format): unwraps to flat object.
 * - Otherwise: returns value as-is (already flat).
 */
export function normalizeLandingPageSettings(raw: LandingPageSettingsRaw): Record<string, unknown> {
  if (raw == null) return {};

  let obj: Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  } else if (typeof raw === 'object' && raw !== null) {
    obj = raw as Record<string, unknown>;
  } else {
    return {};
  }

  // Backward compatibility: old format had { landingPage: { title, subtitle, ... } }
  if (obj && typeof obj.landingPage === 'object' && obj.landingPage !== null) {
    const nested = obj.landingPage as Record<string, unknown>;
    return { ...nested };
  }

  return { ...obj };
}
