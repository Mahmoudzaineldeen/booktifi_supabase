import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { safeTranslateNested } from '../../lib/safeTranslation';
import { db } from '../../lib/db';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { LanguageToggle } from '../../components/layout/LanguageToggle';
import { Building2, Users, Calendar, LogOut, Plus, Settings, Edit, Trash2, UserPlus, Shield, Search, ChevronLeft, ChevronRight, Ticket } from 'lucide-react';
import { Tenant } from '../../types';
import { getApiUrl } from '../../lib/apiUrl';
import { createTimeoutSignal } from '../../lib/requestTimeout';
import { showNotification } from '../../contexts/NotificationContext';

// Minimal columns for list view (smaller payload, faster load)
const TENANTS_LIST_SELECT = 'id,name,name_ar,industry,contact_email,contact_phone,address,is_active,subscription_end,created_at,updated_at,slug,tenant_time_zone,announced_time_zone,subscription_start,public_page_enabled,maintenance_mode,theme_preset';

const INDUSTRY_OPTIONS = ['restaurant', 'salon', 'clinic', 'parking', 'venue', 'other'] as const;
const MAIN_INDUSTRIES = ['restaurant', 'salon', 'clinic', 'parking', 'venue'];
function isOtherIndustry(industry: string | undefined): boolean {
  const ind = (industry || '').trim();
  return !ind || !MAIN_INDUSTRIES.includes(ind);
}
const PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 10;

export function SolutionOwnerDashboard() {
  const { userProfile, signOut, hasRole, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const tenantsFetchedRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showCreateSolutionOwnerModal, setShowCreateSolutionOwnerModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [deletingTenant, setDeletingTenant] = useState<Tenant | null>(null);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatingSolutionOwner, setCreatingSolutionOwner] = useState(false);
  const [error, setError] = useState('');

  const [newTenant, setNewTenant] = useState({
    name: '',
    name_ar: '',
    industry: 'restaurant',
    contact_email: '',
    contact_phone: '',
    address: '',
    admin_password: '',
  });

  const [newSolutionOwner, setNewSolutionOwner] = useState({
    email: '',
    password: '',
    full_name: '',
  });

  useEffect(() => {
    // Wait for auth to finish loading
    if (authLoading) {
      return;
    }

    // Check if user is authenticated as solution owner
    if (!userProfile) {
      // Check session in localStorage before redirecting
      const sessionStr = localStorage.getItem('auth_session');
      const token = localStorage.getItem('auth_token');
      
      if (sessionStr || token) {
        // Session exists, wait a bit for profile to load
        const timeout = setTimeout(() => {
          if (!userProfile) {
            console.log('[SolutionOwnerDashboard] No profile after wait, redirecting to login');
            navigate('/login');
          }
        }, 2000);
        return () => clearTimeout(timeout);
      } else {
        // No session, redirect immediately
        navigate('/login');
        return;
      }
    }

    // Check role after profile is loaded
    if (userProfile.role !== 'solution_owner') {
      console.log('[SolutionOwnerDashboard] User is not solution_owner, redirecting to login', {
        role: userProfile.role
      });
      navigate('/login');
      return;
    }

    // User is solution_owner, fetch tenants once
    if (!tenantsFetchedRef.current) {
      tenantsFetchedRef.current = true;
      fetchTenants();
    }
  }, [authLoading, userProfile, hasRole, navigate]);

  async function fetchTenants() {
    try {
      const client = db;
      const { data, error } = await client
        .from('tenants')
        .select(TENANTS_LIST_SELECT)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTenants(data || []);
    } catch (err) {
      console.error('Error fetching tenants:', err);
    } finally {
      setLoading(false);
    }
  }

  const filteredTenants = useMemo(() => {
    let list = tenants;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (tenant) =>
          (tenant.name || '').toLowerCase().includes(q) ||
          (tenant.name_ar || '').toLowerCase().includes(q) ||
          (tenant.contact_email || '').toLowerCase().includes(q) ||
          (tenant.contact_phone || '').toLowerCase().includes(q) ||
          (tenant.address || '').toLowerCase().includes(q) ||
          (tenant.industry || '').toLowerCase().includes(q) ||
          (q === 'other' && isOtherIndustry(tenant.industry))
      );
    }
    if (categoryFilter) {
      if (categoryFilter === 'other') {
        list = list.filter((tenant) => isOtherIndustry(tenant.industry));
      } else {
        list = list.filter((tenant) => (tenant.industry || '') === categoryFilter);
      }
    }
    return list;
  }, [tenants, searchQuery, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredTenants.length / pageSize));
  const paginatedTenants = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTenants.slice(start, start + pageSize);
  }, [filteredTenants, currentPage, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [currentPage, totalPages]);

  async function handleCreateTenant(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError('');

    try {
      const subscriptionEnd = new Date();
      subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);

      // Use regular client (solution owner uses regular auth)
      const client = db;

      // Step 1: Create the tenant
      const { data: tenantData, error: tenantError } = await client
        .from('tenants')
        .insert({
          name: newTenant.name,
          name_ar: newTenant.name_ar,
          industry: newTenant.industry,
          contact_email: newTenant.contact_email,
          contact_phone: newTenant.contact_phone,
          address: newTenant.address,
          subscription_end: subscriptionEnd.toISOString(),
          is_active: true,
          public_page_enabled: true,
        })
        .select()
        .single();

      if (tenantError) throw tenantError;

      // Step 2: Create Supabase auth account for tenant admin
      const { data: authData, error: authError } = await db.auth.signUp({
        email: newTenant.contact_email,
        password: newTenant.admin_password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            full_name: `${newTenant.name} Admin`,
            role: 'tenant_admin',
            tenant_id: tenantData.id,
          },
        },
      });

      if (authError) {
        // If auth creation fails, we should delete the tenant
        await client.from('tenants').delete().eq('id', tenantData.id);
        throw new Error(`Failed to create admin account: ${authError.message}`);
      }

      // Step 3: Create user profile in users table
      if (authData.user) {
        const { error: profileError } = await client
          .from('users')
          .insert({
            id: authData.user.id,
            tenant_id: tenantData.id,
            email: newTenant.contact_email,
            phone: newTenant.contact_phone,
            full_name: `${newTenant.name} Admin`,
            role: 'tenant_admin',
            is_active: true,
          });

        if (profileError) {
          console.error('Profile creation error:', profileError);
          // Continue anyway - the tenant is created
        }
      }

      setTenants([tenantData, ...tenants]);
      setShowCreateModal(false);
      setNewTenant({
        name: '',
        name_ar: '',
        industry: 'restaurant',
        contact_email: '',
        contact_phone: '',
        address: '',
        admin_password: '',
      });
    } catch (err: any) {
      setError(err.message || 'Failed to create tenant');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(tenant: Tenant) {
    try {
      // Use regular client (solution owner uses regular auth)
      const client = db;

      const { error } = await client
        .from('tenants')
        .update({ is_active: !tenant.is_active })
        .eq('id', tenant.id);

      if (error) throw error;
      fetchTenants();
    } catch (err) {
      console.error('Error toggling tenant:', err);
    }
  }

  async function handleEditTenant(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTenant) return;

    setUpdating(true);
    setError('');

    try {
      const client = db;

      const { error: updateError } = await client
        .from('tenants')
        .update({
          name: newTenant.name,
          name_ar: newTenant.name_ar,
          industry: newTenant.industry,
          contact_email: newTenant.contact_email,
          contact_phone: newTenant.contact_phone,
          address: newTenant.address,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingTenant.id);

      if (updateError) throw updateError;

      setShowEditModal(false);
      setEditingTenant(null);
      setNewTenant({
        name: '',
        name_ar: '',
        industry: 'restaurant',
        contact_email: '',
        contact_phone: '',
        address: '',
        admin_password: '',
      });
      fetchTenants();
    } catch (err: any) {
      setError(err.message || 'Failed to update tenant');
    } finally {
      setUpdating(false);
    }
  }

  async function handleDeleteTenant() {
    if (!deletingTenant) return;

    setDeleting(true);
    setError('');

    try {
      const client = db;

      // Delete tenant (cascade will handle related records)
      const { error: deleteError } = await client
        .from('tenants')
        .delete()
        .eq('id', deletingTenant.id);

      if (deleteError) throw deleteError;

      setShowDeleteModal(false);
      setDeletingTenant(null);
      fetchTenants();
    } catch (err: any) {
      setError(err.message || 'Failed to delete tenant');
    } finally {
      setDeleting(false);
    }
  }

  function openEditModal(tenant: Tenant) {
    setEditingTenant(tenant);
    setNewTenant({
      name: tenant.name || '',
      name_ar: tenant.name_ar || '',
      industry: tenant.industry || 'restaurant',
      contact_email: tenant.contact_email || '',
      contact_phone: tenant.contact_phone || '',
      address: tenant.address || '',
      admin_password: '', // Don't show password when editing
    });
    setError('');
    setShowEditModal(true);
  }

  function openDeleteModal(tenant: Tenant) {
    setDeletingTenant(tenant);
    setError('');
    setShowDeleteModal(true);
  }

  async function handleCreateSolutionOwner(e: React.FormEvent) {
    e.preventDefault();
    setCreatingSolutionOwner(true);
    setError('');

    try {
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');
      
      if (!token) {
        throw new Error('Authentication token not found. Please log in again.');
      }

      const baseUrl = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;
      const response = await fetch(`${baseUrl}/auth/create-solution-owner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: newSolutionOwner.email,
          password: newSolutionOwner.password,
          full_name: newSolutionOwner.full_name,
        }),
        signal: createTimeoutSignal('/auth/create-solution-owner', false),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create Solution Owner');
      }

      setShowCreateSolutionOwnerModal(false);
      setNewSolutionOwner({
        email: '',
        password: '',
        full_name: '',
      });
      
      // Show success message (you could add a toast notification here)
      showNotification('success', t('common.solutionOwnerCreatedSuccessfully'));
    } catch (err: any) {
      setError(err.message || 'Failed to create Solution Owner');
    } finally {
      setCreatingSolutionOwner(false);
    }
  }

  async function handleLogout() {
    // Sign out and redirect to login
    await signOut();
    navigate('/login');
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (userProfile && userProfile.role !== 'solution_owner') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <Calendar className="w-8 h-8 text-blue-600" />
                <span className="text-2xl font-bold text-gray-900">Bookati</span>
              </Link>
              <span className="text-sm text-gray-500 border-l pl-4">{t('admin.solutionOwnerConsole')}</span>
            </div>
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/management/features')}
              >
                <Settings className="w-4 h-4 mr-2" />
                Tenant Features
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/solution-admin/support-tickets')}
                className="text-blue-600 hover:text-blue-700"
              >
                <Ticket className="w-4 h-4 mr-2" />
                Support Tickets
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCreateSolutionOwnerModal(true)}
                className="text-blue-600 hover:text-blue-700"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Create Solution Owner
              </Button>
              <span className="text-sm text-gray-600">
                {userProfile?.full_name || 'Solution Owner'}
              </span>
              <LanguageToggle />
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="w-4 h-4 mr-2" />
                {t('auth.logout')}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Building2 className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">{t('admin.totalTenants')}</p>
                  <p className="text-2xl font-bold text-gray-900">{tenants.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-100 rounded-lg">
                  <Users className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">{t('admin.activeTenants')}</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {tenants.filter((t) => t.is_active).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-orange-100 rounded-lg">
                  <Calendar className="w-6 h-6 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">{t('admin.inactiveTenants')}</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {tenants.filter((t) => !t.is_active).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tenants List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t('admin.tenants')}</CardTitle>
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="w-4 h-4 mr-2" />
                {t('admin.createTenant')}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Search and category filter */}
            {!loading && tenants.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    type="text"
                    placeholder={t('admin.searchTenants', 'Search by name, email or industry...')}
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="pl-9"
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white min-w-[140px]"
                >
                  <option value="">{t('admin.allCategories', 'All categories')}</option>
                  {INDUSTRY_OPTIONS.map((ind) => (
                    <option key={ind} value={ind}>
                      {safeTranslateNested(t, 'admin.industries', ind, ind)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {loading && tenants.length === 0 ? (
              <div className="overflow-x-auto animate-pulse" dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
                <table className="w-full table-auto">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-start text-sm font-medium text-gray-600">{t('admin.tenantName')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium text-gray-600">{t('tenant.industry')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium text-gray-600">{t('admin.contact')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium text-gray-600">{t('admin.status')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium text-gray-600">{t('admin.subscription')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium text-gray-600">{t('admin.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <tr key={i} className="h-12">
                        <td className="px-4 py-3 text-start"><div className="h-4 bg-gray-200 rounded w-32" /></td>
                        <td className="px-4 py-3 text-start"><div className="h-4 bg-gray-200 rounded w-20" /></td>
                        <td className="px-4 py-3 text-start"><div className="h-4 bg-gray-200 rounded w-40" /></td>
                        <td className="px-4 py-3 text-start"><div className="h-5 bg-gray-200 rounded-full w-16" /></td>
                        <td className="px-4 py-3 text-start"><div className="h-4 bg-gray-200 rounded w-24" /></td>
                        <td className="px-4 py-3 text-start"><div className="h-8 bg-gray-200 rounded w-28" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : tenants.length === 0 ? (
              <div className="text-center py-12">
                <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-4">{t('admin.noTenantsYet')}</p>
                <Button onClick={() => setShowCreateModal(true)}>
                  {t('admin.createFirstTenant')}
                </Button>
              </div>
            ) : filteredTenants.length === 0 ? (
              <div className="text-center py-12">
                <Search className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-4">{t('admin.noTenantsMatchFilter', 'No tenants match your search or category.')}</p>
                <Button variant="secondary" onClick={() => { setSearchQuery(''); setCategoryFilter(''); setCurrentPage(1); }}>
                  {t('admin.clearFilters', 'Clear filters')}
                </Button>
              </div>
            ) : (
              <>
              <div className="overflow-x-auto" dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
                <table className="w-full table-auto">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-start text-sm font-medium text-gray-600">{t('admin.tenantName')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium text-gray-600">{t('tenant.industry')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium text-gray-600">{t('admin.contact')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium text-gray-600">{t('admin.status')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium text-gray-600">{t('admin.subscription')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium text-gray-600">{t('admin.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {paginatedTenants.map((tenant) => (
                      <tr key={tenant.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-start text-sm font-medium text-gray-900">
                          <div>{i18n.language === 'ar' && tenant.name_ar ? tenant.name_ar : tenant.name}</div>
                          {tenant.name_ar && <div className="text-xs text-gray-500">{i18n.language === 'ar' ? tenant.name : tenant.name_ar}</div>}
                        </td>
                        <td className="px-4 py-3 text-start text-sm text-gray-600 capitalize">
                          {safeTranslateNested(t, 'admin.industries', tenant.industry, tenant.industry)}
                        </td>
                        <td className="px-4 py-3 text-start text-sm text-gray-600">
                          {tenant.contact_email || tenant.contact_phone || '-'}
                        </td>
                        <td className="px-4 py-3 text-start">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                              tenant.is_active
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {tenant.is_active ? t('tenant.active') : t('tenant.inactive')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-start text-sm text-gray-600">
                          {tenant.subscription_end
                            ? new Date(tenant.subscription_end).toLocaleDateString(i18n.language === 'ar' ? 'ar-SA' : 'en-US')
                            : t('admin.noExpiry')}
                        </td>
                        <td className="px-4 py-3 text-start">
                          <div className="flex items-center gap-2 flex-wrap justify-start">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditModal(tenant)}
                              title={t('admin.editTenant')}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleToggleActive(tenant)}
                          >
                            {tenant.is_active ? t('admin.deactivate') : t('admin.activate')}
                          </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openDeleteModal(tenant)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              title={t('admin.deleteTenant')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              <div className="flex flex-wrap items-center justify-between gap-4 mt-4 pt-4 border-t border-gray-200">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-600">
                    {t('admin.showingTenants', 'Showing {{start}}–{{end}} of {{total}}', {
                      start: (currentPage - 1) * pageSize + 1,
                      end: Math.min(currentPage * pageSize, filteredTenants.length),
                      total: filteredTenants.length,
                    })}
                  </span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n} {t('admin.perPage', 'per page')}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm text-gray-600 px-2">
                    {t('admin.pageOf', 'Page {{current}} of {{total}}', { current: currentPage, total: totalPages })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Create Tenant Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title={t('admin.createNewTenant')}
        size="lg"
      >
        <form onSubmit={handleCreateTenant} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <Input
            label={t('admin.tenantName')}
            value={newTenant.name}
            onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
            required
            placeholder="e.g., Premium Salon"
          />

          <Input
            label={t('admin.tenantNameArabic')}
            value={newTenant.name_ar}
            onChange={(e) => setNewTenant({ ...newTenant, name_ar: e.target.value })}
            required
            placeholder="على سبيل المثال، صالون بريميوم"
            dir="rtl"
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('tenant.industry')} <span className="text-red-500">*</span>
            </label>
            <select
              value={newTenant.industry}
              onChange={(e) => setNewTenant({ ...newTenant, industry: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="restaurant">{t('admin.industries.restaurant')}</option>
              <option value="salon">{t('admin.industries.salon')}</option>
              <option value="clinic">{t('admin.industries.clinic')}</option>
              <option value="parking">{t('admin.industries.parking')}</option>
              <option value="venue">{t('admin.industries.venue')}</option>
              <option value="other">{t('admin.industries.other')}</option>
            </select>
          </div>

          <Input
            type="email"
            label={t('tenant.contactEmail')}
            value={newTenant.contact_email}
            onChange={(e) => setNewTenant({ ...newTenant, contact_email: e.target.value })}
            placeholder="contact@tenant.com"
            required
          />

          <Input
            type="password"
            label={t('admin.adminPassword')}
            value={newTenant.admin_password}
            onChange={(e) => setNewTenant({ ...newTenant, admin_password: e.target.value })}
            placeholder={t('admin.adminPasswordPlaceholder')}
            required
          />

          <Input
            type="tel"
            label={t('tenant.contactPhone')}
            value={newTenant.contact_phone}
            onChange={(e) => setNewTenant({ ...newTenant, contact_phone: e.target.value })}
            placeholder="+966501234567"
          />

          <Input
            label={t('tenant.address')}
            value={newTenant.address}
            onChange={(e) => setNewTenant({ ...newTenant, address: e.target.value })}
            placeholder="123 Main St, Riyadh"
          />

          <div className="flex gap-3 pt-4">
            <Button type="submit" fullWidth loading={creating}>
              {t('admin.createTenant')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              fullWidth
              onClick={() => setShowCreateModal(false)}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Tenant Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingTenant(null);
          setError('');
        }}
        title={t('admin.editTenant')}
        size="lg"
      >
        <form onSubmit={handleEditTenant} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <Input
            label={t('admin.tenantName')}
            value={newTenant.name}
            onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
            required
            placeholder="e.g., Premium Salon"
          />

          <Input
            label={t('admin.tenantNameArabic')}
            value={newTenant.name_ar}
            onChange={(e) => setNewTenant({ ...newTenant, name_ar: e.target.value })}
            required
            placeholder="على سبيل المثال، صالون بريميوم"
            dir="rtl"
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('tenant.industry')} <span className="text-red-500">*</span>
            </label>
            <select
              value={newTenant.industry}
              onChange={(e) => setNewTenant({ ...newTenant, industry: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="restaurant">{t('admin.industries.restaurant')}</option>
              <option value="salon">{t('admin.industries.salon')}</option>
              <option value="clinic">{t('admin.industries.clinic')}</option>
              <option value="parking">{t('admin.industries.parking')}</option>
              <option value="venue">{t('admin.industries.venue')}</option>
              <option value="other">{t('admin.industries.other')}</option>
            </select>
          </div>

          <Input
            type="email"
            label={t('tenant.contactEmail')}
            value={newTenant.contact_email}
            onChange={(e) => setNewTenant({ ...newTenant, contact_email: e.target.value })}
            placeholder="contact@tenant.com"
            required
          />

          <Input
            type="tel"
            label={t('tenant.contactPhone')}
            value={newTenant.contact_phone}
            onChange={(e) => setNewTenant({ ...newTenant, contact_phone: e.target.value })}
            placeholder="+966501234567"
          />

          <Input
            label={t('tenant.address')}
            value={newTenant.address}
            onChange={(e) => setNewTenant({ ...newTenant, address: e.target.value })}
            placeholder="123 Main St, Riyadh"
          />

          <div className="flex gap-3 pt-4">
            <Button type="submit" fullWidth loading={updating}>
              {t('settings.saveChanges')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              fullWidth
              onClick={() => {
                setShowEditModal(false);
                setEditingTenant(null);
                setError('');
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Tenant Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeletingTenant(null);
          setError('');
        }}
        title={t('admin.deleteTenant')}
        size="md"
      >
        <div className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-yellow-800 font-medium mb-2">
              ⚠️ Warning: This action cannot be undone
            </p>
            <p className="text-sm text-yellow-700">
              Deleting this tenant will permanently remove:
            </p>
            <ul className="list-disc list-inside text-sm text-yellow-700 mt-2 space-y-1">
              <li>The tenant and all its data</li>
              <li>All associated users, services, bookings, and related records</li>
              <li>All customer accounts linked to this tenant</li>
            </ul>
          </div>

          {deletingTenant && (
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-900 mb-1">{t('admin.tenantToDelete')}</p>
              <p className="text-lg font-semibold text-gray-900">
                {i18n.language === 'ar' && deletingTenant.name_ar ? deletingTenant.name_ar : deletingTenant.name}
              </p>
              <p className="text-sm text-gray-600 mt-1">
                {deletingTenant.contact_email || deletingTenant.contact_phone || t('admin.noContactInfo')}
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                setShowDeleteModal(false);
                setDeletingTenant(null);
                setError('');
              }}
              disabled={deleting}
            >
              {t('common.cancel')}
            </Button>
            <Button
              fullWidth
              onClick={handleDeleteTenant}
              loading={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {t('admin.deleteTenant')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create Solution Owner Modal */}
      <Modal
        isOpen={showCreateSolutionOwnerModal}
        onClose={() => {
          setShowCreateSolutionOwnerModal(false);
          setError('');
          setNewSolutionOwner({
            email: '',
            password: '',
            full_name: '',
          });
        }}
        title="Create Solution Owner"
        size="md"
      >
        <form onSubmit={handleCreateSolutionOwner} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-900 mb-1">
                  Solution Owner Account
                </p>
                <p className="text-xs text-blue-700">
                  This will create a new Solution Owner with system-wide access. The new account will have full administrative privileges.
                </p>
              </div>
            </div>
          </div>

          <Input
            type="email"
            label="Email"
            value={newSolutionOwner.email}
            onChange={(e) => setNewSolutionOwner({ ...newSolutionOwner, email: e.target.value })}
            required
            placeholder="solution.owner@example.com"
            autoComplete="email"
          />

          <Input
            type="text"
            label="Full Name"
            value={newSolutionOwner.full_name}
            onChange={(e) => setNewSolutionOwner({ ...newSolutionOwner, full_name: e.target.value })}
            required
            placeholder="John Doe"
          />

          <Input
            type="password"
            label="Password"
            value={newSolutionOwner.password}
            onChange={(e) => setNewSolutionOwner({ ...newSolutionOwner, password: e.target.value })}
            required
            placeholder="Minimum 8 characters"
            autoComplete="new-password"
            minLength={8}
          />

          <div className="text-xs text-gray-500">
            Password must be at least 8 characters long.
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="submit" fullWidth loading={creatingSolutionOwner}>
              <UserPlus className="w-4 h-4 mr-2" />
              Create Solution Owner
            </Button>
            <Button
              type="button"
              variant="secondary"
              fullWidth
              onClick={() => {
                setShowCreateSolutionOwnerModal(false);
                setError('');
                setNewSolutionOwner({
                  email: '',
                  password: '',
                  full_name: '',
                });
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
