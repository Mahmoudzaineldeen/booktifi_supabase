import React from 'react';
import { Search, X } from 'lucide-react';

/** Shared styles for search bar wrapper (use with any input/select) */
export const searchBarWrapperClass =
  'relative rounded-xl border border-gray-200 bg-white shadow-sm transition-all duration-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/20 hover:border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:hover:border-gray-500';

/** Shared styles for search type select (e.g. "Search By" dropdown) */
export const searchSelectClass =
  'w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white shadow-sm text-gray-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 hover:border-gray-300 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-gray-500';

export interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> {
  /** Optional className for the outer wrapper */
  wrapperClassName?: string;
  /** Optional className for the input element */
  inputClassName?: string;
  /** Show clear button when value is non-empty; onClick clears and calls onClear if provided */
  onClear?: () => void;
  /** Icon position for RTL (e.g. 'right' when isRTL) */
  iconPosition?: 'left' | 'right';
  /** Optional label above the search (not rendered inside the bar) */
  label?: React.ReactNode;
}

/**
 * Enhanced search input: icon, rounded bar, focus ring, optional clear button.
 * Use for consistent search bar UI across the app.
 */
export function SearchInput({
  wrapperClassName = '',
  inputClassName = '',
  onClear,
  iconPosition = 'left',
  label,
  value,
  disabled,
  ...inputProps
}: SearchInputProps) {
  const hasValue = value != null && String(value).trim().length > 0;
  const isLeft = iconPosition === 'left';

  const wrapper = (
    <div
      className={`
        ${searchBarWrapperClass}
        ${disabled ? 'opacity-60' : ''}
        ${wrapperClassName}
      `}
    >
      <Search
        className={`absolute w-5 h-5 text-gray-400 pointer-events-none ${
          isLeft ? 'left-3' : 'right-3'
        } top-1/2 -translate-y-1/2`}
        aria-hidden
      />
      <input
        type="text"
        value={value}
        disabled={disabled}
        className={`
          w-full bg-transparent border-0 focus:outline-none focus:ring-0
          py-2.5 text-gray-900 placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-400
          disabled:cursor-not-allowed
          ${isLeft ? 'pl-11' : 'pr-11'}
          ${hasValue && onClear !== undefined ? (isLeft ? 'pr-10' : 'pl-10') : (isLeft ? 'pr-4' : 'pl-4')}
          ${inputClassName}
        `}
        aria-label={typeof label === 'string' ? label : inputProps.placeholder as string}
        {...inputProps}
      />
      {hasValue && onClear !== undefined && (
        <button
          type="button"
          onClick={onClear}
          className={`absolute top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 rounded-full p-0.5 ${
            isLeft ? 'right-3' : 'left-3'
          }`}
          title="Clear"
          aria-label="Clear search"
        >
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  );

  if (label) {
    return (
      <div className="w-full">
        <label className="block text-sm font-medium text-gray-700 mb-1.5 dark:text-gray-300">{label}</label>
        {wrapper}
      </div>
    );
  }

  return wrapper;
}
