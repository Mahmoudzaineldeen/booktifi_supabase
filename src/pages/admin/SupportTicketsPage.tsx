import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Calendar, LogOut, Building2, Ticket, ChevronDown, ChevronUp, LogIn, Search } from 'lucide-react';
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
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [ticketsByTenant, setTicketsByTenant] = useState<Record<string, SupportTicket[]>>({});
  const [loadingTickets, setLoadingTickets] = useState<Record<string, boolean>>({});
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [loggingInAsUserId, setLoggingInAsUserId] = useState<string | null>(null);
  const [descriptionModalTicket, setDescriptionModalTicket] = useState<SupportTicket | null>(null);

  // Filters (search, branch, status, date range, sort) — visible when a tenant is selected
  const [searchQuery, setSearchQuery] = useState('');
  const [filterBranch, setFilterBranch] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortCreated, setSortCreated] = useState<'newest' | 'oldest'>('newest');

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
    setSelectedTenantId(tenantId);
    if (!ticketsByTenant[tenantId]) fetchTicketsForTenant(tenantId);
    setSearchQuery('');
    setFilterBranch('');
    setFilterStatus('');
    setDateFrom('');
    setDateTo('');
    setSortCreated('newest');
  }

  function selectTenantForSearch(tenantId: string) {
    setSelectedTenantId(tenantId || null);
    if (tenantId && !ticketsByTenant[tenantId]) fetchTicketsForTenant(tenantId);
    if (!tenantId) {
      setSearchQuery('');
      setFilterBranch('');
      setFilterStatus('');
      setDateFrom('');
      setDateTo('');
    }
  }

  function getFilteredTickets(tenantId: string): SupportTicket[] {
    const list = ticketsByTenant[tenantId] || [];
    const q = searchQuery.trim().toLowerCase();
    let filtered = list.filter((t) => {
      if (q) {
        const matchEmail = (t.created_by_email || '').toLowerCase().includes(q);
        const matchRole = (t.role || '').toLowerCase().includes(q);
        const matchTitle = (t.title || '').toLowerCase().includes(q);
        if (!matchEmail && !matchRole && !matchTitle) return false;
      }
      if (filterBranch) {
        const branchVal = t.branch_id ?? '__none__';
        if (branchVal !== filterBranch) return false;
      }
      if (filterStatus && t.status !== filterStatus) return false;
      const created = new Date(t.created_at).getTime();
      if (dateFrom && created < new Date(dateFrom + 'T00:00:00').getTime()) return false;
      if (dateTo && created > new Date(dateTo + 'T23:59:59').getTime()) return false;
      return true;
    });
    filtered = [...filtered].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortCreated === 'newest' ? tb - ta : ta - tb;
    });
    return filtered;
  }

  function getBranchOptions(tenantId: string): { value: string; label: string }[] {
    const list = ticketsByTenant[tenantId] || [];
    const seen = new Set<string>();
    const options: { value: string; label: string }[] = [{ value: '', label: t('support.allBranches', 'All branches') }];
    for (const t of list) {
      const id = t.branch_id ?? '__none__';
      const name = t.branch_name || '—';
      if (seen.has(id)) continue;
      seen.add(id);
      options.push({ value: id, label: name });
    }
    return options;
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
      showNotification(
        'success',
        data.deleted ? t('support.ticketResolvedAndRemoved', 'Ticket resolved and removed') : t('support.statusUpdated', 'Status updated')
      );
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
      // Redirect to reception for receptionist/cashier so they land on Reception Desk directly (no admin layout + loading then redirect)
      const role = data.user?.role;
      const path = slug
        ? (role === 'receptionist' || role === 'cashier' ? `/${slug}/reception` : `/${slug}/admin`)
        : '/';
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
              <div className="space-y-6">
                {/* Top-level: Select tenant then search/filter tickets */}
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('support.selectTenant', 'Select tenant')}
                  </label>
                  <select
                    value={selectedTenantId ?? ''}
                    onChange={(e) => selectTenantForSearch(e.target.value || null)}
                    className="w-full max-w-md text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
                  >
                    <option value="">{t('support.selectTenantPlaceholder', '— Select a tenant to search tickets —')}</option>
                    {overview.tenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {i18n.language === 'ar' && tenant.name_ar ? tenant.name_ar : tenant.name} ({tenant.open + tenant.in_progress + tenant.resolved} {t('support.tickets', 'tickets')})
                      </option>
                    ))}
                  </select>

                  {selectedTenantId && (
                    <>
                      <div className="flex flex-wrap items-center gap-3 mt-4 p-3 bg-white rounded-lg border border-gray-200">
                        <div className="flex items-center gap-2 min-w-[200px] flex-1">
                          <Search className="w-4 h-4 text-gray-500 shrink-0" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t('support.searchPlaceholder', 'Search by email, role or title…')}
                            className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <select
                          value={filterBranch}
                          onChange={(e) => setFilterBranch(e.target.value)}
                          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
                        >
                          {getBranchOptions(selectedTenantId).map((opt) => (
                            <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        <select
                          value={filterStatus}
                          onChange={(e) => setFilterStatus(e.target.value)}
                          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
                        >
                          <option value="">{t('support.allStatuses', 'All statuses')}</option>
                          <option value="open">{t('support.open', 'Open')}</option>
                          <option value="in_progress">{t('support.inProgress', 'In Progress')}</option>
                          <option value="resolved">{t('support.resolved', 'Resolved')}</option>
                        </select>
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="text-sm border border-gray-300 rounded-lg px-3 py-2"
                            title={t('support.fromDate', 'From date')}
                          />
                          <span className="text-gray-500">–</span>
                          <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="text-sm border border-gray-300 rounded-lg px-3 py-2"
                            title={t('support.toDate', 'To date')}
                          />
                        </div>
                        <select
                          value={sortCreated}
                          onChange={(e) => setSortCreated(e.target.value as 'newest' | 'oldest')}
                          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
                        >
                          <option value="newest">{t('support.newestFirst', 'Newest first')}</option>
                          <option value="oldest">{t('support.oldestFirst', 'Oldest first')}</option>
                        </select>
                      </div>

                      {loadingTickets[selectedTenantId] ? (
                        <div className="flex justify-center py-8">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                        </div>
                      ) : (() => {
                        const filtered = getFilteredTickets(selectedTenantId);
                        const total = (ticketsByTenant[selectedTenantId] || []).length;
                        if (total === 0) {
                          return <p className="text-sm text-gray-600 py-4">{t('support.noTicketsForTenant', 'No tickets for this tenant.')}</p>;
                        }
                        if (filtered.length === 0) {
                          return <p className="text-sm text-amber-700 py-4">{t('support.noTicketsMatchFilters', 'No tickets match your filters.')}</p>;
                        }
                        return (
                          <div className="mt-4 overflow-x-auto border border-gray-200 rounded-lg bg-white">
                            <p className="text-xs text-gray-600 px-3 py-2 border-b bg-gray-50">
                              {t('support.showingTickets', 'Showing {{count}} of {{total}} tickets', { count: filtered.length, total })}
                            </p>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-gray-600 border-b bg-gray-50">
                                  <th className="pb-2 pt-2 pr-4 pl-3">{t('support.ticketId', 'Ticket ID')}</th>
                                  <th className="pb-2 pt-2 pr-4">{t('support.branch', 'Branch')}</th>
                                  <th className="pb-2 pt-2 pr-4">{t('support.employeeName', 'Employee Name')}</th>
                                  <th className="pb-2 pt-2 pr-4">{t('support.role', 'Role')}</th>
                                  <th className="pb-2 pt-2 pr-4">{t('support.title', 'Title')}</th>
                                  <th className="pb-2 pt-2 pr-4">{t('support.description', 'Description')}</th>
                                  <th className="pb-2 pt-2 pr-4">{t('support.status', 'Status')}</th>
                                  <th className="pb-2 pt-2 pr-4">{t('support.createdAt', 'Created At')}</th>
                                  <th className="pb-2 pt-2 pl-3">{t('support.actions', 'Actions')}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {filtered.map((ticket) => (
                                  <tr key={ticket.id} className="hover:bg-gray-50">
                                    <td className="py-2 pr-4 pl-3 font-mono text-xs">{ticket.id.slice(0, 8)}…</td>
                                    <td className="py-2 pr-4">{ticket.branch_name || '—'}</td>
                                    <td className="py-2 pr-4">{ticket.created_by_name || '—'}</td>
                                    <td className="py-2 pr-4">{ticket.role}</td>
                                    <td className="py-2 pr-4 max-w-[180px] truncate" title={ticket.title}>{ticket.title}</td>
                                    <td className="py-2 pr-4 max-w-[220px]">
                                      <span className="line-clamp-2 text-gray-700">{ticket.description || '—'}</span>
                                      {ticket.description && (
                                        <button
                                          type="button"
                                          onClick={() => setDescriptionModalTicket(ticket)}
                                          className="text-blue-600 hover:text-blue-800 text-xs font-medium mt-1"
                                        >
                                          {t('support.showMore', 'Show more')}
                                        </button>
                                      )}
                                    </td>
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
                                    <td className="py-2 pl-3">
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
                        );
                      })()}
                    </>
                  )}
                </div>

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
                          <>
                            <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-white rounded-lg border border-gray-200">
                              <div className="flex items-center gap-2 min-w-[200px] flex-1">
                                <Search className="w-4 h-4 text-gray-500 shrink-0" />
                                <input
                                  type="text"
                                  value={searchQuery}
                                  onChange={(e) => setSearchQuery(e.target.value)}
                                  placeholder={t('support.searchPlaceholder', 'Search by email, role or title…')}
                                  className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <select
                                value={filterBranch}
                                onChange={(e) => setFilterBranch(e.target.value)}
                                className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
                              >
                                {getBranchOptions(tenant.id).map((opt) => (
                                  <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                              <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
                              >
                                <option value="">{t('support.allStatuses', 'All statuses')}</option>
                                <option value="open">{t('support.open', 'Open')}</option>
                                <option value="in_progress">{t('support.inProgress', 'In Progress')}</option>
                                <option value="resolved">{t('support.resolved', 'Resolved')}</option>
                              </select>
                              <div className="flex items-center gap-2 flex-wrap">
                                <input
                                  type="date"
                                  value={dateFrom}
                                  onChange={(e) => setDateFrom(e.target.value)}
                                  className="text-sm border border-gray-300 rounded-lg px-3 py-2"
                                  title={t('support.fromDate', 'From date')}
                                />
                                <span className="text-gray-500">–</span>
                                <input
                                  type="date"
                                  value={dateTo}
                                  onChange={(e) => setDateTo(e.target.value)}
                                  className="text-sm border border-gray-300 rounded-lg px-3 py-2"
                                  title={t('support.toDate', 'To date')}
                                />
                              </div>
                              <select
                                value={sortCreated}
                                onChange={(e) => setSortCreated(e.target.value as 'newest' | 'oldest')}
                                className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
                              >
                                <option value="newest">{t('support.newestFirst', 'Newest first')}</option>
                                <option value="oldest">{t('support.oldestFirst', 'Oldest first')}</option>
                              </select>
                            </div>
                            {(() => {
                              const filtered = getFilteredTickets(tenant.id);
                              const total = (ticketsByTenant[tenant.id] || []).length;
                              if (total === 0) {
                                return <p className="text-sm text-gray-600 py-2">{t('support.noTicketsForTenant', 'No tickets for this tenant.')}</p>;
                              }
                              if (filtered.length === 0) {
                                return <p className="text-sm text-amber-700 py-2">{t('support.noTicketsMatchFilters', 'No tickets match your filters.')}</p>;
                              }
                              return (
                                <>
                                  <p className="text-xs text-gray-600 mb-2">
                                    {t('support.showingTickets', 'Showing {{count}} of {{total}} tickets', { count: filtered.length, total })}
                                  </p>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="text-left text-gray-600 border-b">
                                          <th className="pb-2 pr-4">{t('support.ticketId', 'Ticket ID')}</th>
                                          <th className="pb-2 pr-4">{t('support.branch', 'Branch')}</th>
                                          <th className="pb-2 pr-4">{t('support.employeeName', 'Employee Name')}</th>
                                          <th className="pb-2 pr-4">{t('support.role', 'Role')}</th>
                                          <th className="pb-2 pr-4">{t('support.title', 'Title')}</th>
                                          <th className="pb-2 pr-4">{t('support.description', 'Description')}</th>
                                          <th className="pb-2 pr-4">{t('support.status', 'Status')}</th>
                                          <th className="pb-2 pr-4">{t('support.createdAt', 'Created At')}</th>
                                          <th className="pb-2">{t('support.actions', 'Actions')}</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y">
                                        {filtered.map((ticket) => (
                                  <tr key={ticket.id} className="hover:bg-white/50">
                                    <td className="py-2 pr-4 font-mono text-xs">{ticket.id.slice(0, 8)}…</td>
                                    <td className="py-2 pr-4">{ticket.branch_name || '—'}</td>
                                    <td className="py-2 pr-4">{ticket.created_by_name || '—'}</td>
                                    <td className="py-2 pr-4">{ticket.role}</td>
                                    <td className="py-2 pr-4 max-w-[180px] truncate" title={ticket.title}>{ticket.title}</td>
                                    <td className="py-2 pr-4 max-w-[220px]">
                                      <span className="line-clamp-2 text-gray-700">{ticket.description || '—'}</span>
                                      {ticket.description && (
                                        <button
                                          type="button"
                                          onClick={() => setDescriptionModalTicket(ticket)}
                                          className="text-blue-600 hover:text-blue-800 text-xs font-medium mt-1"
                                        >
                                          {t('support.showMore', 'Show more')}
                                        </button>
                                      )}
                                    </td>
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
                                </>
                              );
                            })()}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

      {/* Full description modal */}
      <Modal
        isOpen={!!descriptionModalTicket}
        onClose={() => setDescriptionModalTicket(null)}
        title={descriptionModalTicket ? descriptionModalTicket.title : ''}
        size="lg"
      >
        {descriptionModalTicket && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">{t('support.description', 'Description')}</p>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{descriptionModalTicket.description || '—'}</p>
            <Button variant="secondary" onClick={() => setDescriptionModalTicket(null)}>
              {t('common.close', 'Close')}
            </Button>
          </div>
        )}
      </Modal>
      </main>
    </div>
  );
}
