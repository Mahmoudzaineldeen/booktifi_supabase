import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch, getAuthHeaders } from '../../lib/apiClient';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { showNotification } from '../../contexts/NotificationContext';
import { showConfirm } from '../../contexts/ConfirmContext';
import { Shield, Plus, Edit, Trash2, UserX, Loader2 } from 'lucide-react';

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
  const { userProfile, hasPermission } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', category: 'employee' as 'admin' | 'employee', permission_ids: [] as string[] });

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
      setForm({
        name: data.name,
        description: data.description || '',
        category: data.category,
        permission_ids: data.permission_ids || [],
      });
      setModalOpen(true);
    } catch (e: any) {
      showNotification('error', e.message || 'Failed to load role');
    }
  }

  function togglePermission(id: string) {
    setForm((prev) => ({
      ...prev,
      permission_ids: prev.permission_ids.includes(id)
        ? prev.permission_ids.filter((p) => p !== id)
        : [...prev.permission_ids, id],
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
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category,
        permission_ids: form.permission_ids,
        tenant_id: userProfile?.tenant_id || null,
      };
      if (editingRole) {
        const res = await apiFetch(`/roles/${editingRole.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update role');
        showNotification('success', 'Role updated');
      } else {
        const res = await apiFetch('/roles', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create role');
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
    const ok = await showConfirm(
      'Disable role?',
      `Users with role "${role.name}" will be deactivated. They will not be able to sign in until you assign a different role or reactivate.`
    );
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
    const ok = await showConfirm(
      'Delete role?',
      `This cannot be undone. The role "${role.name}" will be removed. Only roles with no assigned users can be deleted.`
    );
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

  if (!canManage) {
    return (
      <div className="p-6">
        <p className="text-gray-600">You do not have permission to manage roles.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Shield className="w-7 h-7" />
          Role Management
        </h1>
        <Button onClick={openCreate}>Create role</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {roles.map((role) => (
                <div
                  key={role.id}
                  className="flex items-center justify-between py-3 px-4 rounded-lg border border-gray-200 hover:bg-gray-50"
                >
                  <div>
                    <span className="font-medium">{role.name}</span>
                    {role.description && (
                      <span className="text-gray-500 text-sm ml-2">— {role.description}</span>
                    )}
                    <span className="ml-2 text-xs text-gray-400 capitalize">({role.category})</span>
                    {!role.is_active && (
                      <span className="ml-2 text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">Disabled</span>
                    )}
                    {role.tenant_id == null && (
                      <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">Built-in</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(role)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    {role.is_active && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDisable(role)}
                        title="Disable (users with this role will be deactivated)"
                      >
                        <UserX className="w-4 h-4" />
                      </Button>
                    )}
                    {role.tenant_id != null && (
                      <Button variant="outline" size="sm" onClick={() => handleDelete(role)} title="Delete (only if no users assigned)">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {roles.length === 0 && (
                <p className="text-gray-500 py-4">No roles yet. Create one to get started.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingRole ? 'Edit role' : 'Create role'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Role name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            placeholder="e.g. Front Desk Manager"
          />
          <Input
            label="Description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Optional"
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as 'admin' | 'employee' }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
            >
              <option value="employee">Employee Role</option>
              <option value="admin">Admin Role</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Permissions</label>
            <div className="space-y-4 max-h-64 overflow-y-auto border border-gray-200 rounded p-3">
              {adminPerms.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase mb-2">Admin</p>
                  <div className="space-y-1">
                    {adminPerms.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.permission_ids.includes(p.id)}
                          onChange={() => togglePermission(p.id)}
                        />
                        <span className="text-sm">{p.name}</span>
                        {p.description && <span className="text-gray-400 text-xs">— {p.description}</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {employeePerms.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase mb-2">Employee</p>
                  <div className="space-y-1">
                    {employeePerms.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.permission_ids.includes(p.id)}
                          onChange={() => togglePermission(p.id)}
                        />
                        <span className="text-sm">{p.name}</span>
                        {p.description && <span className="text-gray-400 text-xs">— {p.description}</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingRole ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
