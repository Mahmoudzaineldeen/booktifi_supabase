import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Input } from '../ui/Input';
import { Wrench } from 'lucide-react';
import { getApiUrl } from '../../lib/apiUrl';
import { showNotification } from '../../contexts/NotificationContext';

export function AssignFixingTicketForm() {
  const { t, i18n } = useTranslation();
  const { userProfile, tenant } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [branchName, setBranchName] = useState<string | null>(null);

  useEffect(() => {
    if (!userProfile?.branch_id) {
      setBranchName(null);
      return;
    }
    const apiUrl = getApiUrl().replace(/\/$/, '');
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (!token) return;
    fetch(`${apiUrl}/support-tickets/current-user-branch`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) return { branch_name: null };
        return res.json();
      })
      .then((data) => setBranchName(data?.branch_name ?? null))
      .catch(() => setBranchName(null));
  }, [userProfile?.branch_id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim() || !userProfile) return;
    setSubmitting(true);
    try {
      const apiUrl = getApiUrl().replace(/\/$/, '');
      const token = localStorage.getItem('auth_token');
      if (!token) {
        showNotification('error', t('auth.sessionExpired', 'Session expired. Please log in again.'));
        return;
      }
      const res = await fetch(`${apiUrl}/support-tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showNotification('error', data.error || 'Failed to submit ticket');
        return;
      }
      setTitle('');
      setDescription('');
      showNotification('success', t('support.ticketSubmittedSuccess', 'Ticket submitted successfully. The solution team has been notified.'));
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to submit ticket');
    } finally {
      setSubmitting(false);
    }
  }

  if (!userProfile) return null;

  const createdAt = new Date().toLocaleString(i18n.language === 'ar' ? 'ar-SA' : 'en-US');

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5" />
            {t('support.assignFixingTicket', 'Assign Fixing Ticket')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label={t('support.title', 'Title')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder={t('support.titlePlaceholder', 'Brief title for the issue')}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('support.problemDescription', 'Problem Description')} <span className="text-red-500">*</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={5}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t('support.descriptionPlaceholder', 'Describe the problem in detail...')}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
              <div>
                <span className="font-medium text-gray-700">{t('support.userName', 'User name')}:</span>{' '}
                {(userProfile?.full_name?.trim() || userProfile?.email || (userProfile as { username?: string })?.username || '—')}
              </div>
              <div>
                <span className="font-medium text-gray-700">{t('support.role', 'Role')}:</span>{' '}
                {userProfile?.role || '—'}
              </div>
              <div>
                <span className="font-medium text-gray-700">{t('support.branch', 'Branch')}:</span>{' '}
                {(branchName && branchName.trim()) ? branchName : t('support.notAssigned', 'Not assigned')}
              </div>
              <div>
                <span className="font-medium text-gray-700">{t('support.tenant', 'Tenant')}:</span>{' '}
                {tenant?.name || tenant?.slug || '—'}
              </div>
              <div className="sm:col-span-2">
                <span className="font-medium text-gray-700">{t('support.timestamp', 'Timestamp')}:</span>{' '}
                {createdAt}
              </div>
            </div>
            <p className="text-xs text-gray-500">
              {t('support.screenshotFuture', 'Optional screenshot upload will be available in a future update.')}
            </p>
            <Button type="submit" loading={submitting} disabled={!title.trim() || !description.trim()}>
              {t('support.submitTicket', 'Submit Ticket')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
