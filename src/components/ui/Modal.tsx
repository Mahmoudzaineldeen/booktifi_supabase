import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** When set, applies to the dialog panel (header + body) for correct RTL layout. */
  dir?: 'ltr' | 'rtl';
}

export function Modal({ isOpen, onClose, title, children, size = 'md', dir }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    '2xl': 'max-w-5xl',
  };

  const modalContent = (
    <div 
      className="fixed inset-0 overflow-y-auto" 
      data-modal="subscribe-customer"
      style={{ 
        position: 'fixed', 
        zIndex: 9999,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'auto'
      }}
    >
      <div className="flex min-h-screen items-center justify-center p-4">
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" 
          style={{ 
            position: 'fixed',
            zIndex: 9998,
            top: 0,
            left: 0,
            right: 0,
            bottom: 0
          }}
          onClick={onClose} 
        />

        <div 
          className={`relative bg-white rounded-xl shadow-2xl w-full ${sizeClasses[size]} max-h-[90vh] overflow-y-auto flex flex-col`}
          style={{ zIndex: 10000 }}
          {...(dir ? { dir } : {})}
        >
          {title && (
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50/80 sticky top-0 z-10">
              <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          )}
          <div className="p-6 min-h-[200px] overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  );

  // Render modal in a portal to avoid parent container clipping
  if (typeof window !== 'undefined') {
    return createPortal(modalContent, document.body);
  }

  console.log('[Modal] Window not available, returning modalContent directly');
  return modalContent;
}
