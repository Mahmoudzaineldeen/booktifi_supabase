import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../../../components/ui/Card';
import { Users, Receipt, Calendar } from 'lucide-react';

export function ReportsHubPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { t } = useTranslation();
  const base = `/${tenantSlug}/admin/reports`;

  const items = [
    {
      to: `${base}/visitors`,
      icon: Users,
      title: t('reports.nav.visitors', 'Visitors'),
      desc: t('reports.hub.visitorsDesc', 'Visitor list with serving staff, same filters as Visitors, exports'),
    },
    {
      to: `${base}/transactions`,
      icon: Receipt,
      title: t('reports.nav.transactions', 'Transactions'),
      desc: t('reports.hub.transactionsDesc', 'Booking payments and package purchases, filterable and exportable'),
    },
    {
      to: `${base}/bookings`,
      icon: Calendar,
      title: t('reports.nav.bookings', 'Bookings'),
      desc: t('reports.hub.bookingsDesc', 'Bookings report with employee and branch filters'),
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('reports.title', 'Reports')}</h1>
        <p className="text-sm text-gray-600 mt-1">{t('reports.subtitle', 'Analytics, exports, and filtered views')}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {items.map(({ to, icon: Icon, title, desc }) => (
        <Link key={to} to={to} className="block group">
          <Card className="h-full border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                  <Icon className="w-6 h-6" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 group-hover:text-blue-700">{title}</h2>
              </div>
              <p className="text-sm text-gray-600">{desc}</p>
            </CardContent>
          </Card>
        </Link>
      ))}
      </div>
    </div>
  );
}
