import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { LanguageToggle } from '../../components/layout/LanguageToggle';
import { Calendar, LogOut, User } from 'lucide-react';

export function EmployeePage() {
  const { t, i18n } = useTranslation();
  const { userProfile, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { tenantSlug } = useParams<{ tenantSlug?: string }>();
  const [initialAuthDone, setInitialAuthDone] = useState(false);
  const initialLoadRef = useRef(false);

  useEffect(() => {
    if (initialLoadRef.current || initialAuthDone) return;
    if (authLoading) return;

    if (!userProfile) {
      navigate('/login');
      return;
    }

    if (userProfile.role !== 'employee') {
      navigate('/');
      return;
    }

    initialLoadRef.current = true;
    setInitialAuthDone(true);
  }, [authLoading, userProfile, navigate, initialAuthDone]);

  useEffect(() => {
    if (!initialAuthDone || authLoading) return;
    if (!userProfile) {
      const timeoutId = setTimeout(() => navigate('/login'), 500);
      return () => clearTimeout(timeoutId);
    }
  }, [userProfile, authLoading, navigate, initialAuthDone]);

  if (authLoading || !initialAuthDone) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const displayName = i18n.language === 'ar' ? userProfile?.full_name_ar : userProfile?.full_name;

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 p-2.5 rounded-xl shrink-0">
                <Calendar className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-gray-900">
                  {t('employeePage.title', 'My Bookings')}
                </h1>
                <p className="text-xs md:text-sm text-slate-600">
                  {displayName || userProfile?.full_name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <LanguageToggle />
              <Button
                variant="secondary"
                size="sm"
                icon={<LogOut className="w-4 h-4" />}
                onClick={() => signOut()}
              >
                <span className="hidden sm:inline">{t('auth.logout')}</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <User className="w-16 h-16 text-blue-500 mx-auto mb-4 opacity-80" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              {t('employeePage.title', 'My Bookings')}
            </h2>
            <p className="text-gray-600 max-w-md mx-auto">
              {t('employeePage.assignedBookingsAppear', 'Your assigned bookings will appear here')}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
