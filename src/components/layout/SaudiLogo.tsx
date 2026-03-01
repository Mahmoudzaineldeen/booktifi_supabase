import React from 'react';
import { useTranslation } from 'react-i18next';

export interface SaudiLogoProps {
  /** Height in pixels (width scales to preserve aspect ratio). Default 32. */
  className?: string;
  /** Optional alt text override. */
  alt?: string;
}

/**
 * Shows the Saudi Made / Saudi Tech logo beside Bookati.
 * Arabic mode: صناعة سعودية (Saudi Made) logo.
 * English mode: SAUDI TECH logo (green icon + text on white background).
 */
export function SaudiLogo({ className = 'h-8', alt }: SaudiLogoProps) {
  const { i18n } = useTranslation();
  const isArabic = i18n.language === 'ar';
  const src = isArabic ? '/logos/saudi-made-ar.png' : '/logos/saudi-tech-en.png';
  const defaultAlt = isArabic ? 'صناعة سعودية' : 'Saudi Tech';

  return (
    <img
      src={src}
      alt={alt ?? defaultAlt}
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}
