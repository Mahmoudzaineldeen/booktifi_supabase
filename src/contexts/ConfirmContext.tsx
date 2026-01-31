import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '../components/ui/Button';

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

interface ConfirmContextType {
  showConfirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve: (value: boolean) => void;
}

let globalShowConfirm: ((options: ConfirmOptions) => Promise<boolean>) | null = null;

export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  if (globalShowConfirm) return globalShowConfirm(options);
  return Promise.resolve(false);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ConfirmState | null>(null);
  const showConfirmRef = useRef<(options: ConfirmOptions) => Promise<boolean>>();

  const showConfirmImpl = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({
        ...options,
        open: true,
        resolve,
      });
    });
  }, []);

  showConfirmRef.current = showConfirmImpl;

  React.useEffect(() => {
    globalShowConfirm = (opts) => showConfirmRef.current?.(opts) ?? Promise.resolve(false);
    return () => {
      globalShowConfirm = null;
    };
  }, []);

  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
  }, [state]);

  const handleCancel = useCallback(() => {
    state?.resolve(false);
    setState(null);
  }, [state]);

  const value: ConfirmContextType = { showConfirm: showConfirmImpl };

  const modal =
    state?.open && state.resolve ? (
      <div className="fixed inset-0 z-[9999] overflow-y-auto" aria-modal="true" role="dialog">
        <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={handleCancel} />
        <div className="flex min-h-full items-center justify-center p-4">
          <div
            className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-4">
              <div
                className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                  state.destructive ? 'bg-red-100' : 'bg-amber-100'
                }`}
              >
                <AlertTriangle
                  className={`w-5 h-5 ${state.destructive ? 'text-red-600' : 'text-amber-600'}`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-gray-900">{state.title}</h3>
                <p className="mt-2 text-sm text-gray-600">{state.description}</p>
              </div>
              <button
                type="button"
                onClick={handleCancel}
                className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                aria-label={t('common.close')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-6 flex flex-row-reverse gap-3">
              <Button
                variant="primary"
                onClick={handleConfirm}
                className={
                  state.destructive
                    ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                    : undefined
                }
              >
                {state.confirmText ?? t('common.confirm')}
              </Button>
              <Button variant="secondary" onClick={handleCancel}>
                {state.cancelText ?? t('common.cancel')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    ) : null;

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' && modal && createPortal(modal, document.body)}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (ctx === undefined) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
