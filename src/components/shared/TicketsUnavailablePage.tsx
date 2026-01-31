/**
 * Shown when tickets feature is disabled (settings.tickets_enabled = false).
 * Used for: direct URL to success/QR, and any ticket-related customer access.
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { Button } from '../ui/Button';

interface TicketsUnavailablePageProps {
  /** Optional: show "Back to booking" button that navigates here */
  backToLabel?: string;
  backToPath?: string;
  /** Optional custom title/description (otherwise uses i18n) */
  title?: string;
  description?: string;
}

export function TicketsUnavailablePage({
  backToLabel,
  backToPath,
  title,
  description,
}: TicketsUnavailablePageProps) {
  const { t, i18n } = useTranslation();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const navigate = useNavigate();

  const displayTitle = title ?? t('reception.ticketsUnavailable');
  const displayDescription = description ?? t('reception.ticketsUnavailableContact');

  const goBack = () => {
    if (backToPath) {
      navigate(backToPath);
    } else if (tenantSlug) {
      navigate(`/${tenantSlug}/book`);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-gray-200 p-8 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
            <AlertCircle className="w-10 h-10 text-amber-600" />
          </div>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-3">
          {displayTitle}
        </h1>
        <p className="text-gray-600 mb-8">
          {displayDescription}
        </p>
        <Button
          onClick={goBack}
          variant="primary"
          fullWidth
        >
          {backToLabel ?? (tenantSlug ? (i18n.language === 'ar' ? 'العودة للحجز' : 'Back to booking') : (i18n.language === 'ar' ? 'العودة' : 'Go back'))}
        </Button>
      </div>
    </div>
  );
}
