/**
 * Dropdown under phone field: Name — Phone — Email.
 * Shown only when 1 <= suggestions.length <= 10. Mobile friendly.
 */

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomerSuggestion } from '../../hooks/useCustomerPhoneSearch';

interface CustomerPhoneSuggestionsDropdownProps {
  suggestions: CustomerSuggestion[];
  onSelect: (customer: CustomerSuggestion) => void;
  onClose: () => void;
  /** Ref for the container (phone field wrapper) to position dropdown and detect click outside */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Optional class for the dropdown list container */
  className?: string;
}

export function CustomerPhoneSuggestionsDropdown({
  suggestions,
  onSelect,
  onClose,
  containerRef,
  className = '',
}: CustomerPhoneSuggestionsDropdownProps) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language?.startsWith('ar') ?? false;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (suggestions.length === 0) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef?.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [suggestions.length, onClose, containerRef]);

  if (suggestions.length === 0) return null;

  return (
    <div
      ref={listRef}
      className={`absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-300 bg-white shadow-lg ${className}`}
      dir={isRTL ? 'rtl' : 'ltr'}
      role="listbox"
    >
      {suggestions.map((c) => (
        <button
          key={c.id}
          type="button"
          role="option"
          className={`w-full px-3 py-2.5 text-left text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none ${isRTL ? 'text-right' : 'text-left'}`}
          onClick={() => onSelect(c)}
        >
          <span className="font-medium text-gray-900">{c.name}</span>
          <span className="text-gray-500"> — </span>
          <span className="text-gray-600">{c.phone}</span>
          {c.email && (
            <>
              <span className="text-gray-500"> — </span>
              <span className="text-gray-600 truncate block sm:inline">{c.email}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
