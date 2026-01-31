import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  duration: number;
  createdAt: number;
}

interface NotificationContextType {
  showNotification: (type: NotificationType, message: string, options?: { duration?: number }) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

const DEFAULT_DURATION: Record<NotificationType, number> = {
  success: 5000,
  error: 7000,
  warning: 6000,
  info: 5000,
};

const TYPE_STYLES: Record<NotificationType, { bg: string; border: string; icon: string; Icon: React.ComponentType<{ className?: string }> }> = {
  success: { bg: 'bg-green-50', border: 'border-green-200', icon: 'text-green-600', Icon: CheckCircle },
  error: { bg: 'bg-red-50', border: 'border-red-200', icon: 'text-red-600', Icon: XCircle },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-600', Icon: AlertTriangle },
  info: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600', Icon: Info },
};

let globalShowNotification: ((type: NotificationType, message: string, options?: { duration?: number }) => void) | null = null;

export function showNotification(type: NotificationType, message: string, options?: { duration?: number }): void {
  if (globalShowNotification) {
    globalShowNotification(type, message, options);
  }
}

function ToastItem({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const style = TYPE_STYLES[notification.type];
  const { Icon } = style;

  React.useEffect(() => {
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    return () => cancelAnimationFrame(t);
  }, []);

  React.useEffect(() => {
    const duration = notification.duration;
    const timer = setTimeout(() => {
      setLeaving(true);
      const hideTimer = setTimeout(() => onDismiss(notification.id), 300);
      return () => clearTimeout(hideTimer);
    }, duration);
    return () => clearTimeout(timer);
  }, [notification.id, notification.duration, onDismiss]);

  const handleClose = () => {
    setLeaving(true);
    setTimeout(() => onDismiss(notification.id), 300);
  };

  return (
    <div
      role="alert"
      className={`
        flex items-start gap-3 p-4 rounded-lg shadow-lg border ${style.bg} ${style.border}
        min-w-[280px] max-w-[420px] transition-all duration-300 ease-out
        ${visible && !leaving ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full'}
      `}
      style={{ direction: 'ltr' }}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${style.icon}`} />
      <p className="flex-1 text-sm font-medium text-gray-800 break-words">{notification.message}</p>
      <button
        type="button"
        onClick={handleClose}
        className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-black/5 transition-colors"
        aria-label="Close"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const addRef = useRef<(type: NotificationType, message: string, options?: { duration?: number }) => void>();

  const addNotification = useCallback((type: NotificationType, message: string, options?: { duration?: number }) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const duration = options?.duration ?? DEFAULT_DURATION[type];
    setNotifications((prev) => [
      ...prev,
      { id, type, message, duration, createdAt: Date.now() },
    ]);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  addRef.current = addNotification;

  React.useEffect(() => {
    globalShowNotification = (type, message, options) => addRef.current?.(type, message, options);
    return () => {
      globalShowNotification = null;
    };
  }, []);

  const value: NotificationContextType = { showNotification: addNotification };

  const toastContainer = (
    <div
      className="fixed top-4 right-4 z-[10000] flex flex-col gap-3 pointer-events-none"
      style={{ direction: 'ltr' }}
    >
      <div className="flex flex-col gap-3 pointer-events-auto">
        {notifications.map((n) => (
          <ToastItem key={n.id} notification={n} onDismiss={removeNotification} />
        ))}
      </div>
    </div>
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' && createPortal(toastContainer, document.body)}
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (ctx === undefined) throw new Error('useNotification must be used within NotificationProvider');
  return ctx;
}
