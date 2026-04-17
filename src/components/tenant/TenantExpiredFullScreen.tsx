import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/Button';
import { LogOut } from 'lucide-react';

export function TenantExpiredFullScreen() {
  const { t } = useTranslation();
  const { signOut } = useAuth();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 px-4">
      <div className="max-w-md w-full bg-white shadow-lg rounded-2xl border border-gray-200 p-8 text-center">
        <div className="text-4xl mb-4" aria-hidden>
          🚫
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          {t('trial.expiredTitle', 'Your trial has expired')}
        </h1>
        <p className="text-gray-600 text-sm leading-relaxed mb-6">
          {t(
            'trial.expiredBody',
            'Please contact support to continue using the system.'
          )}
        </p>
        <Button
          fullWidth
          variant="secondary"
          icon={<LogOut className="w-4 h-4" />}
          onClick={() => signOut()}
        >
          {t('auth.logout')}
        </Button>
      </div>
    </div>
  );
}
