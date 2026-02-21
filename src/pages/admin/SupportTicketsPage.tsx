import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Calendar, LogOut, Building2, Ticket, ChevronDown, ChevronUp, LogIn } from 'lucide-react';
import { LanguageToggle } from '../../components/layout/LanguageToggle';
import { getApiUrl } from '../../lib/apiUrl';
import { showNotification } from '../../contexts/NotificationContext';
import { SupportTicket } from '../../types';

type TenantWithCounts = {
  id: string;
  name: string;
  name_ar?: string;
  slug?: string;
  open: number;
  in_progress: number;
  resolved: number;
};

export function SupportTicketsPage() {
  const { userProfile, signOut, applyImpersonation, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [overview, setOverview] = useState<{ tenants: TenantWithCounts[] }>({ tenants: [] });
  const [loading, setLoading] = useState(true);
  const [expandedTenantId, setExpandedTenantId] = useState<string | null>(null);
  const [ticketsByTenant, setTicketsByTenant] = useState<Record<string, SupportTicket[]>>({});
  const [loadingTickets, setLoadingTickets] = useState<Record<string, boolean>>({});
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [loggingInAsUserId, setLoggingInAsUserId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!userProfile) {
      navigate('/login');
      return;
    }
    if (userProfile.role !== 'solution_owner') {
      navigate('/login');
      return;
    }
    fetchOverview();
  }, [authLoading, userProfile, navigate]);

  async function fetchOverview() {
    setLoading(true);
    try {
      const apiUrl = getApiUrl().replace(/\/$/, '');
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const res = await fetch(`${apiUrl}/support-tickets/overview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) setOverview({ tenants: data.tenants || [] });
      else showNotification('error', data.error || 'Failed to load overview');
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }

  async function fetchTicketsForTenant(tenantId: string) {
    setLoadingTickets((prev) => ({ ...prev, [tenantId]: true }));
    try {
      const apiUrl = getApiUrl().replace(/\/$/, '');
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const res = await fetch(`${apiUrl}/support-tickets/by-tenant/${tenantId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) setTicketsByTenant((prev) => ({ ...prev, [tenantId]: data.tickets || [] }));
      else showNotification('error', data.error || 'Failed to load tickets');
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to load tickets');
    } finally {
      setLoadingTickets((prev) => ({ ...prev, [tenantId]: false }));
    }
  }

  function toggleTenant(tenantId: string) {
    if (expandedTenantId === tenantId) {
      setExpandedTenantId(null);
      return;
    }
    setExpandedTenantId(tenantId);
    if (!ticketsByTenant[tenantId]) fetchTicketsForTenant(tenantId);
  }

  async function updateStatus(ticketId: string, status: string) {
    setUpdatingStatus(ticketId);
    try {
      const apiUrl = getApiUrl().replace(/\/$/, '');
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const res = await fetch(`${apiUrl}/support-tickets/${ticketId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) {
        showNotification('error', data.error || 'Failed to update status');
        return;
      }
      showNotification('success', t('support.statusUpdated', 'Status updated'));
      const tenantId = Object.keys(ticketsByTenant).find((tid) =>
        ticketsByTenant[tid].some((t) => t.id === ticketId)
      );
      if (tenantId) fetchTicketsForTenant(tenantId);
      fetchOverview();
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to update status');
    } finally {
      setUpdatingStatus(null);
    }
  }

  async function handleLoginAs(userId: string) {
    setLoggingInAsUserId(userId);
    try {
      const apiUrl = getApiUrl().replace(/\/$/, '');
      const token = localStorage.getItem('auth_token');
      if (!token) {
        showNotification('error', t('auth.sessionExpired', 'Session expired. Please log in again.'));
        setLoggingInAsUserId(null);
        return;
      }
      const originalSession = {
        access_token: token,
        userProfile: userProfile!,
        tenant: null as any,
      };
      const res = await fetch(`${apiUrl}/auth/admin/impersonate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showNotification('error', data.error || 'Impersonation failed');
        setLoggingInAsUserId(null);
        return;
      }
      applyImpersonation({
        user: data.user,
        tenant: data.tenant || null,
        session: data.session,
        impersonation_log_id: data.impersonation_log_id,
        originalSession,
      });
      showNotification('success', t('support.impersonationStarted', 'Logged in as employee. Use "Exit Impersonation" to return.'));
      const slug = data.tenant?.slug;
      // Full page redirect so the app bootstraps with the new token from localStorage
      // and avoids React state/navigate races that could send the user to login
      const path = slug ? `/${slug}/admin` : '/';
      window.location.href = `${window.location.origin}${path}`;
    } catch (e: any) {
      showNotification('error', e.message || 'Impersonation failed');
      setLoggingInAsUserId(null);
    }
  }

  async function handleLogout() {
    await signOut();
    navigate('/login');
  }

  if (authLoading || (userProfile && userProfile.role !== 'solution_owner')) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/solution-admin" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <Calendar className="w-8 h-8 text-blue-600" />
                <span className="text-2xl font-bold text-gray-900">Bookati</span>
              </Link>
              <span className="text-sm text-gray-500 border-l pl-4">{t('admin.solutionOwnerConsole')}</span>
              <Link
                to="/solution-admin"
                className="text-sm text-gray-600 hover:text-blue-600"
              >
                {t('support.tenants', 'Tenants')}
              </Link>
              <span className="text-sm font-medium text-blue-600">{t('support.supportTickets', 'Support Tickets')}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{userProfile?.full_name || 'Solution Owner'}</span>
              <LanguageToggle />
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="w-4 h-4 mr-2" />
                {t('auth.logout')}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ticket className="w-5 h-5" />
              {t('support.supportTickets', 'Support Tickets')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
              </div>
            ) : overview.tenants.length === 0 ? (
              <div className="text-center py-12 text-gray-600">
                <Building2 className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                {t('support.noTicketsYet', 'No support tickets yet.')}
              </div>
            ) : (
              <div className="space-y-3">
                {overview.tenants.map((tenant) => (
                  <div key={tenant.id} className="border border-gray-200 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleTenant(tenant.id)}
                      className="w-full flex items-center justify-between p-4 bg-white hover:bg-gray-50 text-left"
                    >
                      <div className="flex items-center gap-3">
                        <Building2 className="w-5 h-5 text-gray-500" />
                        <span className="font-medium text-gray-900">
                          {i18n.language === 'ar' && tenant.name_ar ? tenant.name_ar : tenant.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm text-amber-600 font-medium">{tenant.open} {t('support.open', 'Open')}</span>
                        <span className="text-sm text-blue-600 font-medium">{tenant.in_progress} {t('support.inProgress', 'In Progress')}</span>
                        <span className="text-sm text-green-600 font-medium">{tenant.resolved} {t('support.resolved', 'Resolved')}</span>
                        {expandedTenantId === tenant.id ? (
                          <ChevronUp className="w-5 h-5 text-gray-500" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-500" />
                        )}
                      </div>
                    </button>
                    {expandedTenantId === tenant.id && (
                      <div className="border-t border-gray-200 bg-gray-50 p-4">
                        {loadingTickets[tenant.id] ? (
                          <div className="flex justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-gray-600 border-b">
                                  <th className="pb-2 pr-4">{t('support.ticketId', 'Ticket ID')}</th>
                                  <th className="pb-2 pr-4">{t('support.branch', 'Branch')}</th>
                                  <th className="pb-2 pr-4">{t('support.employeeName', 'Employee Name')}</th>
                                  <th className="pb-2 pr-4">{t('support.role', 'Role')}</th>
                                  <th className="pb-2 pr-4">{t('support.title', 'Title')}</th>
                                  <th className="pb-2 pr-4">{t('support.status', 'Status')}</th>
                                  <th className="pb-2 pr-4">{t('support.createdAt', 'Created At')}</th>
                                  <th className="pb-2">{t('support.actions', 'Actions')}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {(ticketsByTenant[tenant.id] || []).map((ticket) => (
                                  <tr key={ticket.id} className="hover:bg-white/50">
                                    <td className="py-2 pr-4 font-mono text-xs">{ticket.id.slice(0, 8)}…</td>
                                    <td className="py-2 pr-4">{ticket.branch_name || '—'}</td>
                                    <td className="py-2 pr-4">{ticket.created_by_name || '—'}</td>
                                    <td className="py-2 pr-4">{ticket.role}</td>
                                    <td className="py-2 pr-4 max-w-[180px] truncate" title={ticket.title}>{ticket.title}</td>
                                    <td className="py-2 pr-4">
                                      <select
                                        value={ticket.status}
                                        onChange={(e) => updateStatus(ticket.id, e.target.value)}
                                        disabled={updatingStatus === ticket.id}
                                        className="text-xs border rounded px-2 py-1 bg-white"
                                      >
                                        <option value="open">{t('support.open', 'Open')}</option>
                                        <option value="in_progress">{t('support.inProgress', 'In Progress')}</option>
                                        <option value="resolved">{t('support.resolved', 'Resolved')}</option>
                                      </select>
                                    </td>
                                    <td className="py-2 pr-4 text-gray-600">
                                      {new Date(ticket.created_at).toLocaleString(i18n.language === 'ar' ? 'ar-SA' : 'en-US')}
                                    </td>
                                    <td className="py-2">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => handleLoginAs(ticket.created_by_user_id)}
                                        disabled={loggingInAsUserId !== null}
                                        loading={loggingInAsUserId === ticket.created_by_user_id}
                                        className="text-blue-600"
                                      >
                                        <LogIn className="w-4 h-4 mr-1" />
                                        {loggingInAsUserId === ticket.created_by_user_id
                                          ? t('support.loggingIn', 'Logging in…')
                                          : t('support.loginAs', 'Login As')}
                                      </Button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
