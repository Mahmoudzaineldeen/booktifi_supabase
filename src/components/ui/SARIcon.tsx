/**
 * SAR Icon Component
 * 
 * Displays the Saudi Riyal icon with proper error handling
 */

import React, { useState } from 'react';

interface SARIconProps {
  size?: number;
  className?: string;
}

const SAR_ICON_PATH = '/assets/currency/sar-icon.png';

export function SARIcon({ size = 18, className = '' }: SARIconProps) {
  const [imageError, setImageError] = useState(false);

  if (imageError) {
    // Fallback to text if image fails
    return (
      <span className={className} style={{ fontSize: size }}>
        ر.س
      </span>
    );
  }

  return (
    <img
      src={SAR_ICON_PATH}
      alt="SAR"
      className={className}
      style={{
        width: size,
        height: size,
        display: 'inline-block',
        verticalAlign: 'middle',
        objectFit: 'contain',
        imageRendering: 'crisp-edges'
      }}
      onError={(e) => {
        console.error('[SARIcon] Failed to load icon from:', SAR_ICON_PATH);
        console.error('[SARIcon] Error event:', e);
        setImageError(true);
      }}
      onLoad={() => {
        console.log('[SARIcon] ✅ Icon loaded successfully from:', SAR_ICON_PATH);
      }}
      loading="eager"
    />
  );
}
