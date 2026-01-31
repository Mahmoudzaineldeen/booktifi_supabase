import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { countryCodes, CountryCode, validatePhoneNumberByCountry } from '../../lib/countryCodes';

export interface PhoneInputProps {
  value?: string;
  onChange?: (value: string) => void;
  onCountryChange?: (country: CountryCode) => void;
  onPhoneChange?: (phone: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
  defaultCountry?: string; // Country code like '+966'
  error?: string;
  disabled?: boolean;
  validate?: boolean;
  onValidationChange?: (isValid: boolean, error?: string) => void;
  language?: 'en' | 'ar';
}

export function PhoneInput({
  value = '',
  onChange,
  onCountryChange,
  onPhoneChange,
  label = 'Phone Number',
  placeholder,
  required = false,
  className = '',
  defaultCountry = '+966',
  error,
  disabled = false,
  validate = false,
  onValidationChange,
  language = 'en',
}: PhoneInputProps) {
  const { t, i18n } = useTranslation();
  const defaultLabel = label || t('common.phoneNumber');
  const currentLanguage = language === 'ar' || i18n.language === 'ar' ? 'ar' : 'en';
  const isRTL = currentLanguage === 'ar';
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(
    countryCodes.find(c => c.code === defaultCountry) || countryCodes[0]
  );
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastEmittedValueRef = useRef<string>('');

  // Initialize from value prop
  useEffect(() => {
    if (value === lastEmittedValueRef.current) {
      return;
    }

    lastEmittedValueRef.current = value || '';

    if (value) {
      // Try to extract country code and number from value
      let foundCountry: CountryCode | undefined;
      
      // Special handling for Egypt: check for both +20 and +2
      if (value.startsWith('+20')) {
        foundCountry = countryCodes.find(c => c.code === '+20');
        if (foundCountry) {
          setSelectedCountry(foundCountry);
          let number = value.replace(/^\+20/, '').trim();
          // Remove leading 0 if present (Egyptian numbers: +2001032560826 -> 1032560826)
          if (number.startsWith('0') && (number.length === 11 || number.length === 10)) {
            const withoutZero = number.substring(1);
            if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
              number = withoutZero;
            }
          }
          setPhoneNumber(number);
        }
      } else {
        // Check all other countries
        for (const country of countryCodes) {
          if (value.startsWith(country.code)) {
            foundCountry = country;
            setSelectedCountry(country);
            const number = value.replace(country.code, '').trim();
            setPhoneNumber(number.replace(/^\+/, '').trim());
            break;
          }
        }
      }
      
      if (!foundCountry) {
        // If no country code found, try to extract just the number
        const number = value.replace(/^\+/, '').trim();
        setPhoneNumber(number);
      }
    } else {
      setPhoneNumber('');
    }
  }, [value]);

  // Emit changes
  useEffect(() => {
    let fullNumber = selectedCountry.code + phoneNumber;
    
    // Special handling for Egypt: remove leading 0 after +20
    // +2001032560826 -> +201032560826
    if (selectedCountry.code === '+20' && phoneNumber.startsWith('0') && phoneNumber.length >= 10) {
      const withoutZero = phoneNumber.substring(1);
      // Validate it's a valid Egyptian mobile number (starts with 1, 2, or 5)
      if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
        fullNumber = selectedCountry.code + withoutZero;
        // Update phoneNumber state to remove the leading 0
        if (phoneNumber !== withoutZero) {
          setPhoneNumber(withoutZero);
          return; // Will trigger this effect again with corrected number
        }
      }
    }
    
    if (fullNumber !== lastEmittedValueRef.current) {
      lastEmittedValueRef.current = fullNumber;
      
      if (onChange) {
        onChange(fullNumber);
      }
      if (onCountryChange) {
        onCountryChange(selectedCountry);
      }
      if (onPhoneChange) {
        onPhoneChange(phoneNumber.startsWith('0') && selectedCountry.code === '+20' ? phoneNumber.substring(1) : phoneNumber);
      }
    }
  }, [selectedCountry, phoneNumber, onChange, onCountryChange, onPhoneChange]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
        setSearchQuery('');
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Focus search input when dropdown opens
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  // Get translated country name
  const getCountryName = (country: CountryCode): string => {
    if (currentLanguage === 'ar') {
      const translationKey = `countries.${country.code.replace('+', '')}`;
      const translated = t(translationKey);
      // If translation exists and is not the key itself, use it
      if (translated && translated !== translationKey) {
        return translated;
      }
    }
    return country.name;
  };

  // Filter countries based on search
  const filteredCountries = countryCodes.filter(country => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const countryName = getCountryName(country).toLowerCase();
    return (
      countryName.includes(query) ||
      country.name.toLowerCase().includes(query) || // Also search English name
      country.code.includes(query) ||
      country.flag.includes(query)
    );
  });

  const handleCountrySelect = (country: CountryCode) => {
    setSelectedCountry(country);
    setIsDropdownOpen(false);
    setSearchQuery('');
    if (onCountryChange) {
      onCountryChange(country);
    }
    
    // Re-validate phone number with new country code
    if (validate && phoneNumber.length > 0) {
      const validation = validatePhoneNumberByCountry(phoneNumber, country.code, language);
      if (onValidationChange) {
        onValidationChange(validation.valid, validation.error);
      }
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow digits
    let phone = e.target.value.replace(/[^\d]/g, '');
    
    // Special handling for Egypt: remove leading 0 if user types it
    // This prevents +2001032560826, ensures +201032560826
    if (selectedCountry.code === '+20' && phone.startsWith('0') && phone.length >= 10) {
      const withoutZero = phone.substring(1);
      // Validate it's a valid Egyptian mobile number (starts with 1, 2, or 5)
      if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
        phone = withoutZero;
      }
    }
    
    setPhoneNumber(phone);
    if (onPhoneChange) {
      onPhoneChange(phone);
    }
  };

  // Get placeholder based on country
  const getPlaceholder = () => {
    if (placeholder) return placeholder;
    if (selectedCountry.code === '+966') return '501234567';
    if (selectedCountry.code === '+20') return '1032560826';
    return '1234567890';
  };

  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {defaultLabel} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="flex gap-2">
        {/* Country Code Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => !disabled && setIsDropdownOpen(!isDropdownOpen)}
            disabled={disabled}
            dir={isRTL ? 'rtl' : 'ltr'}
            className={`w-32 px-3 py-2 border ${
              error ? 'border-red-500' : 'border-gray-300'
            } rounded-lg bg-white hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm flex items-center justify-between gap-2 ${
              disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            } ${isRTL ? 'flex-row-reverse' : ''}`}
          >
            <span className={`flex items-center gap-1.5 ${isRTL ? 'flex-row-reverse' : ''}`}>
              <span className="text-lg">{selectedCountry.flag}</span>
              <span className="font-medium text-gray-700">{selectedCountry.code}</span>
            </span>
            <ChevronDown 
              className={`w-4 h-4 text-gray-500 transition-transform ${
                isDropdownOpen ? 'rotate-180' : ''
              }`} 
            />
          </button>
          
          {isDropdownOpen && (
            <>
              <div 
                className="fixed inset-0 z-30" 
                onClick={() => setIsDropdownOpen(false)}
              />
              <div 
                className={`absolute top-full ${isRTL ? 'right-0' : 'left-0'} mt-1 w-80 max-h-80 overflow-hidden bg-white border border-gray-300 rounded-lg shadow-lg z-40 flex flex-col`}
                dir={isRTL ? 'rtl' : 'ltr'}
              >
                {/* Search Bar */}
                <div className="sticky top-0 bg-white border-b border-gray-200 p-2">
                  <div className="relative">
                    <Search className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400`} />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t('common.searchCountry')}
                      dir={isRTL ? 'rtl' : 'ltr'}
                      className={`w-full ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'} py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm`}
                    />
                  </div>
                </div>
                
                {/* Country List */}
                <div className="overflow-y-auto max-h-64">
                  {filteredCountries.length === 0 ? (
                    <div className={`px-4 py-3 text-sm text-gray-500 text-center ${isRTL ? 'text-right' : 'text-left'}`}>
                      {t('common.noCountriesFound')}
                    </div>
                  ) : (
                    filteredCountries.map((country, index) => (
                      <button
                        key={`${country.code}-${country.name}-${index}`}
                        type="button"
                        onClick={() => handleCountrySelect(country)}
                        className={`w-full px-4 py-2 ${isRTL ? 'text-right' : 'text-left'} hover:bg-gray-50 flex items-center gap-3 text-sm ${
                          selectedCountry.code === country.code ? 'bg-blue-50' : ''
                        }`}
                        dir={isRTL ? 'rtl' : 'ltr'}
                      >
                        <span className="text-lg">{country.flag}</span>
                        <span className={`font-medium text-gray-700 flex-1 ${isRTL ? 'text-right' : 'text-left'}`}>
                          {getCountryName(country)}
                        </span>
                        <span className="text-gray-500 text-sm">{country.code}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Phone Number Input */}
        <div className="flex-1 relative">
          <input
            type="tel"
            value={phoneNumber}
            onChange={handlePhoneChange}
            disabled={disabled}
            required={required}
            placeholder={getPlaceholder()}
            className={`w-full px-3 py-2 border ${
              error ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'
            } rounded-lg focus:ring-2 focus:border-transparent ${
              disabled ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          />
        </div>
      </div>
      
      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
      
      {/* Display full number for debugging (can be removed in production) */}
      {phoneNumber && process.env.NODE_ENV === 'development' && (
        <p className="mt-1 text-xs text-gray-500">
          Full number: {selectedCountry.code}{phoneNumber}
        </p>
      )}
    </div>
  );
}
