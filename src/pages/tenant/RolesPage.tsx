import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../lib/apiClient';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { showNotification } from '../../contexts/NotificationContext';
import { showConfirm } from '../../contexts/ConfirmContext';
import { Shield, Plus, Edit, Trash2, UserX, Loader2, KeyRound, Users, CheckSquare, Square } from 'lucide-react';

interface Permission {
  id: string;
  name: string;
  description: string | null;
  category: 'admin' | 'employee';
}

interface Role {
  id: string;
  tenant_id: string | null;
  name: string;
  description: string | null;
  category: 'admin' | 'employee';
  is_active: boolean;
  created_at: string;
  permission_ids?: string[];
}

export function RolesPage() {
  const { t } = useTranslation();
  const { userProfile, hasPermission } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', category: 'employee' as 'admin' | 'employee', permission_ids: [] as string[] });
  const permissionsScrollRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef(0);

  const canManage = userProfile?.role === 'solution_owner' || userProfile?.role === 'tenant_admin' || hasPermission('manage_roles');

  useEffect(() => {
    if (!canManage) return;
    loadPermissions();
    loadRoles();
  }, [canManage, userProfile?.tenant_id]);

  async function loadPermissions() {
    try {
      const res = await apiFetch('/roles/permissions');
      const data = await res.json();
      if (res.ok) setPermissions(data.permissions || []);
    } catch (_) {
      setPermissions([]);
    }
  }

  async function loadRoles() {
    try {
      setLoading(true);
      const tenantId = userProfile?.tenant_id ? `?tenant_id=${userProfile.tenant_id}` : '';
      const res = await apiFetch(`/roles${tenantId}`);
      const data = await res.json();
      if (res.ok) setRoles(data.roles || []);
    } catch (_) {
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditingRole(null);
    setForm({ name: '', description: '', category: 'employee', permission_ids: [] });
    setModalOpen(true);
  }

  async function openEdit(role: Role) {
    try {
      const res = await apiFetch(`/roles/${role.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load role');
      setEditingRole(data);
      const roleCategory = data.category as 'admin' | 'employee';
      const allPermIds = data.permission_ids || [];
      const permIdsSameCategory = permissions.length
        ? allPermIds.filter((pid: string) => {
            const p = permissions.find((x) => x.id === pid);
            return p && p.category === roleCategory;
          })
        : allPermIds;
      setForm({
        name: data.name,
        description: data.description || '',
        category: roleCategory,
        permission_ids: permIdsSameCategory,
      });
      setModalOpen(true);
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to load role');
    }
  }

  function savePermissionsScroll() {
    if (permissionsScrollRef.current) {
      savedScrollTop.current = permissionsScrollRef.current.scrollTop;
    }
  }

  function togglePermission(id: string) {
    savePermissionsScroll();
    const perm = permissions.find((p) => p.id === id);
    if (!perm || perm.category !== form.category) return; // only allow current category
    setForm((prev) => ({
      ...prev,
      permission_ids: prev.permission_ids.includes(id)
        ? prev.permission_ids.filter((p) => p !== id)
        : [...prev.permission_ids.filter((pid) => {
            const p = permissions.find((x) => x.id === pid);
            return !p || p.category === form.category;
          }), id],
    }));
  }

  function toggleAllInCategory(category: 'admin' | 'employee', checked: boolean) {
    if (category !== form.category) return; // only allow current category
    savePermissionsScroll();
    const ids = permissions.filter((p) => p.category === category).map((p) => p.id);
    setForm((prev) => ({
      ...prev,
      permission_ids: checked
        ? ids
        : prev.permission_ids.filter((id) => !ids.includes(id)),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      showNotification('error', 'Role name is required');
      return;
    }
    setSaving(true);
    try {
      const allowedIds = form.permission_ids.filter((id) => {
        const p = permissions.find((x) => x.id === id);
        return p && p.category === form.category;
      });
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category,
        permission_ids: allowedIds,
        tenant_id: userProfile?.tenant_id || null,
      };
      if (editingRole) {
        const res = await apiFetch(`/roles/${editingRole.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          const msg = data.details ? `${data.error || 'Failed to update role'}. ${data.details}` : (data.error || 'Failed to update role');
          throw new Error(msg);
        }
        showNotification('success', 'Role updated');
      } else {
        const res = await apiFetch('/roles', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          const msg = data.details ? `${data.error || 'Failed to create role'}. ${data.details}` : (data.error || 'Failed to create role');
          throw new Error(msg);
        }
        showNotification('success', 'Role created');
      }
      setModalOpen(false);
      loadRoles();
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to save role');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisable(role: Role) {
    const ok = await showConfirm({
      title: t('roleManagement.disableConfirmTitle'),
      description: t('roleManagement.disableConfirmDescription', { name: role.name }),
    });
    if (!ok) return;
    try {
      const res = await apiFetch(`/roles/${role.id}/disable`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to disable role');
      showNotification('success', data.message || 'Role disabled');
      loadRoles();
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to disable role');
    }
  }

  async function handleDelete(role: Role) {
    const ok = await showConfirm({
      title: t('roleManagement.deleteConfirmTitle'),
      description: t('roleManagement.deleteConfirmDescription', { name: role.name }),
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await apiFetch(`/roles/${role.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cannot delete role while users are assigned. Remove or reassign users first.');
      showNotification('success', 'Role deleted');
      loadRoles();
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to delete role');
    }
  }

  const adminPerms = permissions.filter((p) => p.category === 'admin');
  const employeePerms = permissions.filter((p) => p.category === 'employee');

  // Restore scroll position after checkbox toggle (browser often scrolls into view; we restore after)
  useLayoutEffect(() => {
    if (!permissionsScrollRef.current || !modalOpen) return;
    const el = permissionsScrollRef.current;
    const top = savedScrollTop.current;
    el.scrollTop = top;
    // Run again after paint so we override any scroll-into-view the browser did on focus
    const id = requestAnimationFrame(() => {
      el.scrollTop = top;
    });
    return () => cancelAnimationFrame(id);
  }, [form.permission_ids, modalOpen]);

  function PermissionMatrix({ perms, categoryLabel }: { perms: Permission[]; categoryLabel: string }) {
    if (perms.length === 0) return null;
    const allSelected = perms.every((p) => form.permission_ids.includes(p.id));
    const selectedCount = perms.filter((p) => form.permission_ids.includes(p.id)).length;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{categoryLabel}</span>
          <button
            type="button"
            onClick={() => toggleAllInCategory(perms[0].category, !allSelected)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300"
          >
            {allSelected ? <CheckSquare className="w-4 h-4 text-indigo-600" /> : <Square className="w-4 h-4 text-gray-400" />}
            {t('roleManagement.selectAll')} {selectedCount > 0 && <span className="text-gray-500">({selectedCount}/{perms.length})</span>}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {perms.map((p) => {
            const isChecked = form.permission_ids.includes(p.id);
            return (
              <div
                key={p.id}
                role="checkbox"
                tabIndex={0}
                onClick={() => togglePermission(p.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePermission(p.id); } }}
                className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer border-2 transition-all ${
                  isChecked
                    ? 'border-indigo-200 bg-indigo-50/80 hover:bg-indigo-50'
                    : 'border-transparent bg-white hover:bg-gray-50 hover:border-gray-100'
                }`}
                aria-checked={isChecked}
                aria-label={p.description ? `${p.name}: ${p.description}` : p.name}
              >
                <div
                  className={`mt-0.5 w-5 h-5 flex-shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${
                    isChecked ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300 bg-white'
                  }`}
                  aria-hidden
                >
                  {isChecked && (
                    <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 6l3 3 5-6" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className={`text-sm font-medium block ${isChecked ? 'text-indigo-900' : 'text-gray-900'}`}>{p.name}</span>
                  {p.description && <span className="block text-xs text-gray-500 mt-0.5">{p.description}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="p-6">
        <p className="text-gray-600">{t('roleManagement.noPermission')}</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-indigo-100 text-indigo-600">
            <Shield className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('roleManagement.title')}</h1>
            <p className="text-sm text-gray-500">{t('roleManagement.subtitle')}</p>
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" />
            {t('roleManagement.createRole')}
          </Button>
        </div>
      </div>

      {/* Roles list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
        </div>
      ) : (
        <Card className="overflow-hidden shadow-sm border border-gray-200">
          <CardHeader className="bg-gray-50/80 border-b border-gray-200">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="w-5 h-5 text-gray-600" />
              {t('roleManagement.roles')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {roles.map((role) => (
                <div
                  key={role.id}
                  className="flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 transition-colors"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                      <KeyRound className="w-5 h-5 text-gray-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{role.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
                          {role.category === 'admin' ? t('roleManagement.adminRole') : t('roleManagement.employeeRole')}
                        </span>
                        {!role.is_active && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{t('roleManagement.disabled')}</span>
                        )}
                        {role.tenant_id == null && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{t('roleManagement.builtIn')}</span>
                        )}
                      </div>
                      {role.description && (
                        <p className="text-sm text-gray-500 mt-0.5 truncate max-w-md">{role.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ms-4">
                    <Button variant="outline" size="sm" onClick={() => openEdit(role)} className="gap-1">
                      <Edit className="w-4 h-4" />
                      {t('roleManagement.edit')}
                    </Button>
                    {role.is_active && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDisable(role)}
                        title={t('roleManagement.disableTitle')}
                        className="text-amber-600 border-amber-200 hover:bg-amber-50"
                      >
                        <UserX className="w-4 h-4" />
                      </Button>
                    )}
                    {role.tenant_id != null && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(role)}
                        title={t('roleManagement.deleteTitle')}
                        className="text-red-600 border-red-200 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {roles.length === 0 && (
              <div className="px-6 py-12 text-center">
                <KeyRound className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">{t('roleManagement.noRoles')}</p>
                <p className="text-sm text-gray-400 mt-1">{t('roleManagement.noRolesHint')}</p>
                <Button onClick={openCreate} className="mt-4">
                  {t('roleManagement.createRole')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create / Edit modal — large, two-column, permission matrix */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingRole ? t('roleManagement.editRole') : t('roleManagement.createRole')}
        size="2xl"
      >
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 flex-1 min-h-0 grid-rows-[1fr] overflow-hidden">
            {/* Left: basic info */}
            <div className="lg:col-span-1 space-y-5 min-h-0 overflow-y-auto p-1 lg:pe-6 lg:border-e border-gray-200 bg-gray-50/30">
              <Input
                label={t('roleManagement.roleName')}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                placeholder={t('roleManagement.roleNamePlaceholder')}
                className="w-full"
              />
              <Input
                label={t('roleManagement.description')}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder={t('roleManagement.descriptionOptional')}
                className="w-full"
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('roleManagement.roleCategory')}</label>
                <p className="text-xs text-gray-500 mb-3">{t('roleManagement.roleCategoryHint')}</p>
                <div className="flex gap-3">
                  <label
                    className={`flex-1 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-3 py-4 cursor-pointer transition-all ${
                      form.category === 'employee'
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-800 shadow-sm'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50/50'
                    } ${!!editingRole && form.permission_ids.length > 0 ? 'opacity-60 pointer-events-none' : ''}`}
                  >
                    <input
                      type="radio"
                      name="role-category"
                      value="employee"
                      checked={form.category === 'employee'}
                      onChange={() => {
                        setForm((f) => ({
                          ...f,
                          category: 'employee',
                          permission_ids: f.permission_ids.filter((id) => {
                            const p = permissions.find((x) => x.id === id);
                            return p && p.category === 'employee';
                          }),
                        }));
                      }}
                      className="sr-only"
                    />
                    <Users className={`w-6 h-6 ${form.category === 'employee' ? 'text-indigo-600' : 'text-gray-400'}`} />
                    <span className="font-medium text-sm">{t('roleManagement.employeeRole')}</span>
                  </label>
                  <label
                    className={`flex-1 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-3 py-4 cursor-pointer transition-all ${
                      form.category === 'admin'
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-800 shadow-sm'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50/50'
                    } ${!!editingRole && form.permission_ids.length > 0 ? 'opacity-60 pointer-events-none' : ''}`}
                  >
                    <input
                      type="radio"
                      name="role-category"
                      value="admin"
                      checked={form.category === 'admin'}
                      onChange={() => {
                        setForm((f) => ({
                          ...f,
                          category: 'admin',
                          permission_ids: f.permission_ids.filter((id) => {
                            const p = permissions.find((x) => x.id === id);
                            return p && p.category === 'admin';
                          }),
                        }));
                      }}
                      className="sr-only"
                    />
                    <Shield className={`w-6 h-6 ${form.category === 'admin' ? 'text-indigo-600' : 'text-gray-400'}`} />
                    <span className="font-medium text-sm">{t('roleManagement.adminRole')}</span>
                  </label>
                </div>
                {editingRole && form.permission_ids.length > 0 && (
                  <p className="mt-2 text-xs text-amber-700 bg-amber-50 px-2 py-1.5 rounded-lg">
                    {t('roleManagement.removePermissionsToChangeCategory')}
                  </p>
                )}
              </div>
            </div>
            {/* Right: permissions matrix — only this area scrolls */}
            <div className="lg:col-span-2 flex flex-col min-h-0 overflow-hidden ps-1 lg:ps-6">
              <div className="flex items-center gap-2 flex-shrink-0 mb-3">
                <KeyRound className="w-5 h-5 text-gray-500" />
                <span className="text-sm font-semibold text-gray-800">{t('roleManagement.permissions')}</span>
                <span
                  className="text-xs px-2.5 py-1 rounded-full font-medium bg-indigo-100 text-indigo-800"
                  title={t('roleManagement.adminOnlyTitle')}
                >
                  {form.category === 'admin' ? t('roleManagement.adminOnly') : t('roleManagement.employeeOnly')}
                </span>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden flex-1 min-h-0 flex flex-col shadow-sm">
                <div
                  ref={permissionsScrollRef}
                  className="p-4 space-y-6 overflow-y-auto min-h-0 flex-1"
                  onScroll={(e) => { savedScrollTop.current = (e.target as HTMLDivElement).scrollTop; }}
                >
                  {form.category === 'admin' && (
                    <PermissionMatrix perms={adminPerms} categoryLabel={t('roleManagement.adminPermissions')} />
                  )}
                  {form.category === 'employee' && (
                    <PermissionMatrix perms={employeePerms} categoryLabel={t('roleManagement.employeePermissions')} />
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="flex-shrink-0 flex justify-end gap-3 pt-6 mt-6 border-t border-gray-200 bg-gray-50/80">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              {t('roleManagement.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin me-2" />
                  {t('roleManagement.saving')}
                </>
              ) : editingRole ? (
                t('roleManagement.updateRole')
              ) : (
                t('roleManagement.createRole')
              )}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
