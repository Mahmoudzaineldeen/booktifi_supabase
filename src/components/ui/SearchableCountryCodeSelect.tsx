import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { countryCodes } from '../../lib/countryCodes';

interface SearchableCountryCodeSelectProps {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  className?: string;
}

export function SearchableCountryCodeSelect({
  value,
  onChange,
  disabled = false,
  className = '',
}: SearchableCountryCodeSelectProps) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedCountry =
    countryCodes.find((c) => c.code === value) || countryCodes[0];

  useEffect(() => {
    const onOutsideClick = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };

    if (open) {
      document.addEventListener('mousedown', onOutsideClick);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }

    return () => {
      document.removeEventListener('mousedown', onOutsideClick);
    };
  }, [open]);

  const filteredCountries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countryCodes;
    return countryCodes.filter((country) => {
      const translatedName =
        isAr
          ? (t(`countries.${country.code.replace('+', '')}`) || country.name)
          : country.name;
      return (
        translatedName.toLowerCase().includes(q) ||
        country.name.toLowerCase().includes(q) ||
        country.code.includes(q) ||
        country.flag.includes(q)
      );
    });
  }, [query, t, isAr]);

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className="w-full border border-gray-300 rounded-lg px-2 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 flex items-center justify-between gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        aria-label={t('common.countryCode', 'Country code')}
      >
        <span className="flex items-center gap-1.5">
          <span>{selectedCountry.flag}</span>
          <span className="font-medium text-gray-700">{selectedCountry.code}</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-80 max-h-80 overflow-hidden bg-white border border-gray-300 rounded-lg shadow-lg z-40 flex flex-col">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('common.searchCountry')}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>
            </div>

            <div className="overflow-y-auto max-h-64">
              {filteredCountries.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-500 text-center">
                  {t('common.noCountriesFound')}
                </div>
              ) : (
                filteredCountries.map((country, idx) => (
                  <button
                    key={`${country.code}-${country.name}-${idx}`}
                    type="button"
                    onClick={() => {
                      onChange(country.code);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={`w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3 text-sm ${
                      selectedCountry.code === country.code ? 'bg-blue-50' : ''
                    }`}
                  >
                    <span>{country.flag}</span>
                    <span className="font-medium text-gray-700 flex-1">
                      {isAr ? (t(`countries.${country.code.replace('+', '')}`) || country.name) : country.name}
                    </span>
                    <span className="text-gray-500">{country.code}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
