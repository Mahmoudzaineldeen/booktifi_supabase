/**
 * Subscription Confirmation Modal — Admin & Receptionist
 * Shown after successfully adding a package subscription. Matches booking confirmation styling.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrency } from '../../contexts/CurrencyContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { CheckCircle, Package, User, Phone, Calendar, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ar } from 'date-fns/locale';

export interface SubscriptionConfirmationData {
  subscriptionId: string;
  customerName: string;
  customerPhone?: string;
  packageName: string;
  packageNameAr?: string;
  subscribedAt: string;
  totalPrice?: number;
  invoiceCreated?: boolean;
  /** True when server is creating/sending invoice in background */
  invoicePending?: boolean;
  invoiceError?: string;
}

export interface SubscriptionConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: SubscriptionConfirmationData | null;
  onAddAnother: () => void;
  onViewSubscribers?: () => void;
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-500">{label}</p>
        <p className="font-semibold text-gray-900 truncate">{value}</p>
      </div>
    </div>
  );
}

export function SubscriptionConfirmationModal({
  isOpen,
  onClose,
  data,
  onAddAnother,
  onViewSubscribers,
}: SubscriptionConfirmationModalProps) {
  const { t, i18n } = useTranslation();
  const { formatPrice } = useCurrency();

  if (!data) return null;

  const packageDisplay = i18n.language === 'ar' && data.packageNameAr ? data.packageNameAr : data.packageName;
  const dateFormatted = (() => {
    try {
      return format(parseISO(data.subscribedAt), 'EEEE, MMMM d, yyyy', {
        locale: i18n.language === 'ar' ? ar : undefined,
      });
    } catch {
      return data.subscribedAt;
    }
  })();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" size="lg">
      <div className="p-2">
        <Card className="text-center border-0 shadow-none">
          <CardContent className="pt-4 pb-2">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center bg-green-100">
                <CheckCircle className="w-10 h-10 text-green-600" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {i18n.language === 'ar' ? 'تم إضافة الاشتراك بنجاح!' : 'Subscription Added Successfully!'}
            </h2>
            <p className="text-gray-600 text-sm mb-6">
              {i18n.language === 'ar'
                ? 'تم اشتراك العميل في الباقة. سيتم إرسال الفاتورة عبر الواتساب/البريد إن وُجد.'
                : 'The customer has been subscribed to the package. Invoice will be sent via WhatsApp/email if configured.'}
              {data.invoicePending && (
                <span className="block mt-1 text-gray-500">
                  {i18n.language === 'ar' ? 'جاري إنشاء الفاتورة وإرسالها...' : 'Invoice is being created and will be sent shortly.'}
                </span>
              )}
            </p>

            <div className="bg-gray-50 rounded-lg p-5 mb-6 text-left space-y-4">
              <Row
                icon={<FileText className="w-5 h-5 text-gray-500" />}
                label={i18n.language === 'ar' ? 'رقم الاشتراك' : 'Subscription ID'}
                value={data.subscriptionId}
              />
              <Row
                icon={<User className="w-5 h-5 text-gray-500" />}
                label={i18n.language === 'ar' ? 'اسم العميل' : 'Customer Name'}
                value={data.customerName || '—'}
              />
              {data.customerPhone && (
                <Row
                  icon={<Phone className="w-5 h-5 text-gray-500" />}
                  label={i18n.language === 'ar' ? 'رقم الهاتف' : 'Phone Number'}
                  value={data.customerPhone}
                />
              )}
              <Row
                icon={<Package className="w-5 h-5 text-gray-500" />}
                label={i18n.language === 'ar' ? 'الباقة' : 'Package'}
                value={packageDisplay || '—'}
              />
              <Row
                icon={<Calendar className="w-5 h-5 text-gray-500" />}
                label={i18n.language === 'ar' ? 'تاريخ الاشتراك' : 'Subscribed At'}
                value={dateFormatted}
              />
              {data.totalPrice != null && data.totalPrice > 0 && (
                <Row
                  icon={<FileText className="w-5 h-5 text-gray-500" />}
                  label={i18n.language === 'ar' ? 'المبلغ الإجمالي' : 'Total Amount'}
                  value={formatPrice(data.totalPrice)}
                />
              )}
            </div>

            {data.invoiceError && (
              <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg text-left">
                <p className="text-sm text-amber-800">
                  {i18n.language === 'ar' ? 'ملاحظة بخصوص الفاتورة: ' : 'Invoice note: '}
                  {data.invoiceError}
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button variant="secondary" onClick={onClose}>
                {t('common.close')}
              </Button>
              {onViewSubscribers && (
                <Button variant="outline" onClick={onViewSubscribers}>
                  {i18n.language === 'ar' ? 'عرض المشتركين' : 'View Subscribers'}
                </Button>
              )}
              <Button onClick={onAddAnother}>
                {i18n.language === 'ar' ? 'إضافة اشتراك آخر' : 'Add Another Subscription'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </Modal>
  );
}
