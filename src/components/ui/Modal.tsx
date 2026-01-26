import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    console.log('[Modal] isOpen changed:', isOpen, 'Title:', title);
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, title]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) {
    console.log('[Modal] Not rendering - isOpen is false');
    return null;
  }

  console.log('[Modal] Rendering modal with title:', title);

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
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
          className={`relative bg-white rounded-lg shadow-xl w-full ${sizeClasses[size]} max-h-[90vh] overflow-y-auto`}
          style={{ zIndex: 10000 }}
        >
          {title && (
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          )}
          <div className="p-6">{children}</div>
        </div>
      </div>
    </div>
  );

  // Render modal in a portal to avoid parent container clipping
  if (typeof window !== 'undefined') {
    const portalTarget = document.body;
    console.log('[Modal] Rendering to portal, target:', portalTarget);
    const portal = createPortal(modalContent, portalTarget);
    console.log('[Modal] Portal created:', portal);
    return portal;
  }

  console.log('[Modal] Window not available, returning modalContent directly');
  return modalContent;
}
