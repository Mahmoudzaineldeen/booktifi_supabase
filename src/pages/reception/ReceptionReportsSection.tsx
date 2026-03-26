import type { ReactNode } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { ReportsHubPage } from '../tenant/reports/ReportsHubPage';
import { VisitorsPage } from '../tenant/VisitorsPage';
import { ReportsTransactionsPage } from '../tenant/reports/ReportsTransactionsPage';
import { ReportsBookingsPage } from '../tenant/reports/ReportsBookingsPage';

/**
 * Same report pages as admin, under /:tenantSlug/reception/reports/* (reception shell).
 */
export function ReceptionReportsSection() {
  const { pathname } = useLocation();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  if (!tenantSlug) return null;

  const base = `/${tenantSlug}/reception/reports`;
  const norm = pathname.replace(/\/$/, '');

  const shell = (child: ReactNode) => (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">{child}</div>
  );

  if (norm === base) {
    return shell(<ReportsHubPage />);
  }
  if (norm === `${base}/visitors`) {
    return shell(<VisitorsPage embeddedInReports />);
  }
  if (norm === `${base}/transactions`) {
    return shell(<ReportsTransactionsPage />);
  }
  if (norm === `${base}/bookings`) {
    return shell(<ReportsBookingsPage />);
  }

  return shell(<ReportsHubPage />);
}
