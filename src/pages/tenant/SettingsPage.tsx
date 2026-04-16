import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/db';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Settings, Save, Building2, Lock, Eye, EyeOff, Mail, CheckCircle, XCircle, MessageCircle, FileText, ExternalLink, DollarSign, Clock, User, Image as ImageLucide } from 'lucide-react';

import { getApiUrl } from '../../lib/apiUrl';
import { useTenantFeatures } from '../../hooks/useTenantFeatures';
import { createTimeoutSignal } from '../../lib/requestTimeout';
import { useCurrency } from '../../contexts/CurrencyContext';
import { showNotification } from '../../contexts/NotificationContext';
import { showConfirm } from '../../contexts/ConfirmContext';
import { getAvailableCurrencies } from '../../lib/currency';
import { isValidSettingsSection, normalizeAppManagerTab } from './settingsSections';

export function SettingsPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const { userProfile, tenant, user, signOut, loading: authLoading, refreshSessionFromStorage } = useAuth();
  const { tenantSlug, section } = useParams<{ tenantSlug: string; section: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const appTab = normalizeAppManagerTab(searchParams.get('tab'));
  const { features: tenantFeatures, reload: reloadTenantFeatures } = useTenantFeatures(userProfile?.tenant_id);
  const [loading, setLoading] = useState(false);
  const [schedulingModeSaving, setSchedulingModeSaving] = useState(false);
  const [schedulingModeMessage, setSchedulingModeMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    name_ar: string;
    contact_email: string;
    tenant_time_zone: string;
  }>({
    name: '',
    name_ar: '',
    contact_email: '',
    tenant_time_zone: 'Asia/Riyadh',
  });
  const [smtpSettings, setSmtpSettings] = useState({
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_user: '',
    smtp_password: '',
  });
  const [smtpLoading, setSmtpLoading] = useState(false);
  const [smtpTestLoading, setSmtpTestLoading] = useState(false);
  const [smtpMessage, setSmtpMessage] = useState<{ type: 'success' | 'error'; text: string; hint?: string } | null>(null);
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  
  // WhatsApp settings state
  const [whatsappSettings, setWhatsappSettings] = useState({
    provider: 'meta' as 'meta' | 'twilio' | 'wati',
    api_url: '',
    api_key: '',
    phone_number_id: '',
    access_token: '',
    account_sid: '',
    auth_token: '',
    from: '',
  });
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [whatsappTestLoading, setWhatsappTestLoading] = useState(false);
  const [whatsappMessage, setWhatsappMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showWhatsappToken, setShowWhatsappToken] = useState(false);

  // Zoho settings state
  const [zohoSettings, setZohoSettings] = useState({
    client_id: '',
    client_secret: '',
    redirect_uri: '',
    region: 'com',
    zoho_organization_id: '',
  });
  const [zohoLoading, setZohoLoading] = useState(false);
  const [zohoTestLoading, setZohoTestLoading] = useState(false);
  const [zohoMessage, setZohoMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [showZohoSecret, setShowZohoSecret] = useState(false);
  const [zohoStatus, setZohoStatus] = useState<{
    has_config: boolean;
    has_tokens: boolean;
    connection_status: 'not_connected' | 'connected' | 'expired';
    token_expires_at: string | null;
  } | null>(null);

  const [invoiceProvider, setInvoiceProvider] = useState<'zoho' | 'daftra'>('zoho');
  const [daftraForm, setDaftraForm] = useState({
    subdomain: '',
    store_id: '',
    default_product_id: '',
    invoice_layout_id: '',
    vat_percentage: '15',
    vat_registration_number: '',
    api_token: '',
    country_code: 'SA',
    fallback_to_zoho: false,
  });
  const [daftraTokenSet, setDaftraTokenSet] = useState(false);
  const [invoiceProviderLoading, setInvoiceProviderLoading] = useState(false);
  const [invoiceProviderMessage, setInvoiceProviderMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Currency settings state
  const { currencyCode: currentCurrencyCode, refreshCurrency } = useCurrency();
  const [selectedCurrencyCode, setSelectedCurrencyCode] = useState<string>('SAR');
  const [currencyLoading, setCurrencyLoading] = useState(false);
  const [currencyMessage, setCurrencyMessage] = useState<{ type: 'success' | 'error'; text: string; warning?: string } | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [logoUploading, setLogoUploading] = useState(false);

  // Access control: Redirect customers and unauthorized users
  useEffect(() => {
    if (authLoading) return; // Wait for auth to load

    if (!userProfile) {
      // Not logged in - redirect to login
      navigate('/login');
      return;
    }

    // Block customers - they should use customer dashboard
    if (userProfile.role === 'customer') {
      console.warn('[SettingsPage] Customer attempted to access admin settings, redirecting to customer dashboard');
      if (tenantSlug) {
        navigate(`/${tenantSlug}/customer/dashboard`);
      } else {
        navigate('/');
      }
      return;
    }

    // SECURITY: Solution Owner should access /solution-admin, not tenant settings
    if (userProfile.role === 'solution_owner') {
      console.warn('[SettingsPage] Solution Owner attempted to access tenant settings, redirecting to solution-admin', { role: userProfile.role });
      navigate('/solution-admin');
      return;
    }

    // Block customer_admin and admin_user from settings
    if (userProfile.role === 'customer_admin' || userProfile.role === 'admin_user') {
      console.warn('[SettingsPage] Restricted role attempted to access settings', { role: userProfile.role });
      navigate(`/${tenantSlug}/admin/bookings`);
      return;
    }

    // Only allow tenant_admin, receptionist, and cashier
    const allowedRoles = ['tenant_admin', 'receptionist', 'cashier'];
    if (!allowedRoles.includes(userProfile.role)) {
      console.warn('[SettingsPage] Unauthorized role attempted to access settings', { role: userProfile.role });
      navigate('/');
      return;
    }
  }, [userProfile, authLoading, navigate, tenantSlug]);

  useEffect(() => {
    if (tenant) {
      setFormData({
        name: tenant.name || '',
        name_ar: tenant.name_ar || '',
        contact_email: tenant.contact_email || '',
        tenant_time_zone: tenant.tenant_time_zone || 'Asia/Riyadh',
      });
      setLogoUrl(tenant.logo_url || '');
    }
  }, [tenant]);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const compressImageToDataUrl = async (file: File): Promise<string> => {
    const dataUrl = await fileToDataUrl(file);
    return await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 900;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(image.width * scale));
        canvas.height = Math.max(1, Math.floor(image.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  };

  const saveLogoUrl = async (nextLogoUrl: string | null) => {
    setLogoUploading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const API_URL = getApiUrl();
      const response = await fetch(`${API_URL}/tenants/branding`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ logo_url: nextLogoUrl || null }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || t('common.error'));
      }

      setLogoUrl(nextLogoUrl || '');
      await refreshSessionFromStorage();
      showNotification('success', t('common.saved', 'Saved'));
    } catch (error: any) {
      showNotification('error', error.message || t('common.error'));
    } finally {
      setLogoUploading(false);
    }
  };

  // Load currency settings - use CurrencyContext as primary source
  useEffect(() => {
    // Use currency from CurrencyContext (which already handles loading)
    if (currentCurrencyCode) {
      setSelectedCurrencyCode(currentCurrencyCode);
    } else {
      // Fallback to API only if context doesn't have it yet
      async function loadCurrencyFromAPI() {
        if (!userProfile?.tenant_id) return;
        
        try {
          const token = localStorage.getItem('auth_token');
          if (token) {
            const API_URL = getApiUrl();
            const response = await fetch(`${API_URL}/tenants/currency`, {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            });

            if (response.ok) {
              const data = await response.json();
              setSelectedCurrencyCode(data.currency_code || 'SAR');
            } else {
              // Silently fallback to default - API might not be available
              setSelectedCurrencyCode('SAR');
            }
          } else {
            setSelectedCurrencyCode('SAR');
          }
        } catch (err) {
          // Silently handle errors - use default currency
          console.warn('Could not load currency from API, using default:', err);
          setSelectedCurrencyCode('SAR');
        }
      }
      
      loadCurrencyFromAPI();
    }
  }, [currentCurrencyCode, userProfile?.tenant_id]);

  // Load SMTP settings
  useEffect(() => {
    async function loadSmtpSettings() {
      if (!tenant?.id) return;
      
      try {
        const token = localStorage.getItem('auth_token');
        const API_URL = getApiUrl();
        const response = await fetch(`${API_URL}/tenants/smtp-settings`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.smtp_settings) {
            setSmtpSettings({
              smtp_host: data.smtp_settings.smtp_host || 'smtp.gmail.com',
              smtp_port: data.smtp_settings.smtp_port || 587,
              smtp_user: data.smtp_settings.smtp_user || '',
              smtp_password: '', // Don't load password from server
            });
          }
        }
      } catch (err) {
        console.error('Error loading SMTP settings:', err);
      }
    }

    loadSmtpSettings();
  }, [tenant]);

  // Load WhatsApp settings
  useEffect(() => {
    async function loadWhatsappSettings() {
      if (!tenant?.id) return;
      
      try {
        const token = localStorage.getItem('auth_token');
        const API_URL = getApiUrl();
        const response = await fetch(`${API_URL}/tenants/whatsapp-settings`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.whatsapp_settings) {
            setWhatsappSettings({
              provider: data.whatsapp_settings.provider || 'meta',
              api_url: data.whatsapp_settings.api_url || '',
              api_key: data.whatsapp_settings.api_key || '',
              phone_number_id: data.whatsapp_settings.phone_number_id || '',
              access_token: '', // Don't load token from server
              account_sid: data.whatsapp_settings.account_sid || '',
              auth_token: '', // Don't load token from server
              from: data.whatsapp_settings.from || '',
            });
          }
        }
      } catch (err) {
        console.error('Error loading WhatsApp settings:', err);
      }
    }

    loadWhatsappSettings();
  }, [tenant]);

  // Load Zoho settings
  useEffect(() => {
    async function loadZohoSettings() {
      if (!tenant?.id) return;
      
      try {
        const token = localStorage.getItem('auth_token');
        const API_URL = getApiUrl();
        
        // Load config
        const configResponse = await fetch(`${API_URL}/tenants/zoho-config`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (configResponse.ok) {
          const data = await configResponse.json();
          if (data.zoho_config) {
            setZohoSettings({
              client_id: data.zoho_config.client_id || '',
              client_secret: '', // Don't load secret from server
              redirect_uri: data.zoho_config.redirect_uri || `${window.location.origin}/api/zoho/callback`,
              region: data.zoho_config.region || 'com',
              zoho_organization_id: data.zoho_config.zoho_organization_id ?? '',
            });
          }
        } else if (configResponse.status === 403) {
          const errorData = await configResponse.json();
          console.error('Access denied loading Zoho config:', errorData);
        }

        // Load status
        const statusResponse = await fetch(`${API_URL}/tenants/zoho-status`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          setZohoStatus(statusData);
        } else if (statusResponse.status === 403) {
          const errorData = await statusResponse.json();
          console.error('Access denied loading Zoho status:', errorData);
          setZohoMessage({ 
            type: 'error', 
            text: errorData.error || 'Access denied. You do not have permission to view Zoho settings.' 
          });
        }
      } catch (err) {
        console.error('Error loading Zoho settings:', err);
      }
    }

    loadZohoSettings();
  }, [tenant]);

  useEffect(() => {
    async function loadInvoiceProviderSettings() {
      if (!tenant?.id) return;
      try {
        const token = localStorage.getItem('auth_token');
        const API_URL = getApiUrl();
        const res = await fetch(`${API_URL}/tenants/invoice-provider-settings`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.invoice_provider === 'daftra' || data.invoice_provider === 'zoho') {
          setInvoiceProvider(data.invoice_provider);
        }
        if (data.daftra_settings) {
          setDaftraForm((f) => ({
            ...f,
            subdomain: String(data.daftra_settings.subdomain || ''),
            store_id: data.daftra_settings.store_id !== '' && data.daftra_settings.store_id != null
              ? String(data.daftra_settings.store_id)
              : '',
            default_product_id:
              data.daftra_settings.default_product_id !== '' && data.daftra_settings.default_product_id != null
                ? String(data.daftra_settings.default_product_id)
                : '',
            invoice_layout_id:
              data.daftra_settings.invoice_layout_id !== '' && data.daftra_settings.invoice_layout_id != null
                ? String(data.daftra_settings.invoice_layout_id)
                : '',
            vat_percentage:
              data.daftra_settings.vat_percentage !== '' && data.daftra_settings.vat_percentage != null
                ? String(data.daftra_settings.vat_percentage)
                : '15',
            vat_registration_number:
              typeof data.daftra_settings.vat_registration_number === 'string'
                ? data.daftra_settings.vat_registration_number
                : '',
            country_code: String(data.daftra_settings.country_code || 'SA'),
            fallback_to_zoho: !!data.daftra_settings.fallback_to_zoho,
            api_token: '',
          }));
          setDaftraTokenSet(!!data.daftra_settings.api_token_set);
        }
      } catch (e) {
        console.error('Error loading invoice provider settings:', e);
      }
    }
    loadInvoiceProviderSettings();
  }, [tenant]);

  async function handleSmtpSave(e: React.FormEvent) {
    e.preventDefault();
    setSmtpMessage(null);
    setSmtpLoading(true);

    // Wait for auth to load
    if (authLoading) {
      setSmtpMessage({ 
        type: 'error', 
        text: t('settings.smtp.pleaseWaitAuthLoading')
      });
      setSmtpLoading(false);
      return;
    }

    // Use userProfile.tenant_id instead of tenant?.id for more reliable tenant ID
    if (!userProfile?.tenant_id) {
      console.error('[SMTP Save] Missing tenant_id:', { 
        hasUserProfile: !!userProfile, 
        userProfile,
        tenantId: userProfile?.tenant_id 
      });
      setSmtpMessage({ 
        type: 'error', 
        text: t('settings.smtp.tenantInfoNotAvailable'),
        hint: t('settings.smtp.sessionExpiredHint')
      });
      setSmtpLoading(false);
      return;
    }

    if (!smtpSettings.smtp_user || !smtpSettings.smtp_password) {
      setSmtpMessage({ type: 'error', text: t('settings.smtp.emailAndAppPasswordRequired') });
      setSmtpLoading(false);
      return;
    }

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        throw new Error('Authentication token not found. Please log in again.');
      }

      const API_URL = getApiUrl();
      console.log('[SMTP Save] Making request to:', `${API_URL}/tenants/smtp-settings`);
      console.log('[SMTP Save] Tenant ID:', userProfile.tenant_id);
      
      const response = await fetch(`${API_URL}/tenants/smtp-settings`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(smtpSettings),
        signal: createTimeoutSignal(`${API_URL}/tenants/smtp-settings`, !API_URL.startsWith('http')),
      });

      console.log('[SMTP Save] Response status:', response.status);

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
        }
        
        // Handle 404 specifically
        if (response.status === 404) {
          throw new Error(
            errorData.error || 
            t('settings.smtp.smtpSettingsEndpointNotFound')
          );
        }
        
        throw new Error(errorData.error || errorData.hint || t('settings.smtp.failedToSaveSmtpSettings'));
      }

      const data = await response.json();
      setSmtpMessage({ type: 'success', text: data.message || t('settings.smtp.saved') });
    } catch (err: any) {
      console.error('[SMTP Save] Error:', err);
      setSmtpMessage({ 
        type: 'error', 
        text: err.message || t('settings.smtp.failedToSaveSmtpSettings'),
        hint: err.hint || (err.message?.includes('404') 
          ? t('settings.smtp.endpointNotAvailable')
          : t('common.error'))
      });
    } finally {
      setSmtpLoading(false);
    }
  }

  async function handleSmtpTest() {
    setSmtpMessage(null);
    setSmtpTestLoading(true);

    // Use userProfile.tenant_id instead of tenant?.id for more reliable tenant ID
    if (!userProfile?.tenant_id) {
      setSmtpMessage({ 
        type: 'error', 
        text: t('settings.smtp.tenantNotFound')
      });
      setSmtpTestLoading(false);
      return;
    }

    if (!smtpSettings.smtp_user || !smtpSettings.smtp_password) {
      setSmtpMessage({ type: 'error', text: t('settings.smtp.pleaseSaveSmtpSettingsFirst') });
      setSmtpTestLoading(false);
      return;
    }

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        throw new Error('Authentication token not found. Please log in again.');
      }

      const API_URL = getApiUrl();
      console.log('[SMTP Test] Making request to:', `${API_URL}/tenants/smtp-settings/test`);
      console.log('[SMTP Test] Note: SMTP connection test may take up to 60 seconds');
      
      // Show initial message to indicate the test is in progress
      setSmtpMessage({ 
        type: 'success', 
        text: t('settings.smtp.testingSmtpConnection'),
      });
      
      const response = await fetch(`${API_URL}/tenants/smtp-settings/test`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(smtpSettings),
        signal: createTimeoutSignal(`${API_URL}/tenants/smtp-settings/test`, !API_URL.startsWith('http')),
      });

      console.log('[SMTP Test] Response status:', response.status);

      // Handle non-JSON responses
      const contentType = response.headers.get('content-type');
      let data;
      
      if (contentType && contentType.includes('application/json')) {
        try {
          data = await response.json();
          console.log('[SMTP Test] Response data:', data);
        } catch (jsonError) {
          console.error('[SMTP Test] Failed to parse JSON response:', jsonError);
          throw new Error(`Server returned invalid response (${response.status}). The server may have encountered an error.`);
        }
      } else {
        const text = await response.text();
        console.error('[SMTP Test] Non-JSON response:', text);
        throw new Error(`Server returned unexpected response format (${response.status}): ${text.substring(0, 100)}`);
      }
      
      // Log the full error if status is not OK
      if (!response.ok) {
        console.error('[SMTP Test] ❌ Server returned error:', {
          status: response.status,
          error: data.error,
          hint: data.hint,
          code: data.code,
          provider: data.provider
        });
      }

      if (!response.ok) {
        // Include hint from API response if available
        const error = new Error(data.error || data.message || 'SMTP connection test failed');
        (error as any).hint = data.hint;
        (error as any).data = data;
        throw error;
      }

      setSmtpMessage({ 
        type: 'success', 
        text: data.message || t('settings.smtp.connectionTestSuccessful', { email: data.testEmail || t('common.email') }),
        hint: data.hint
      });
    } catch (err: any) {
      console.error('[SMTP Test] Error:', err);
      
      // Handle different error types
      let errorMessage = t('settings.smtp.connectionTestFailed');
      let errorHint = t('common.error');
      
      if (err.name === 'AbortError' || err.message?.includes('timeout')) {
        errorMessage = t('settings.smtp.requestTimedOut');
        errorHint = t('settings.smtp.timeoutHint');
      } else if (err.message?.includes('Failed to fetch') || err.message?.includes('ERR_CONNECTION_RESET')) {
        errorMessage = t('settings.smtp.connectionFailed');
        errorHint = t('settings.smtp.connectionFailedHint');
      } else if (err.message) {
        errorMessage = err.message;
        errorHint = err.hint || err.data?.hint || errorHint;
      }
      
      setSmtpMessage({ 
        type: 'error', 
        text: errorMessage,
        hint: errorHint
      });
    } finally {
      setSmtpTestLoading(false);
    }
  }

  async function handleWhatsappSave(e: React.FormEvent) {
    e.preventDefault();
    setWhatsappMessage(null);
    setWhatsappLoading(true);

    if (!tenant?.id) {
      setWhatsappMessage({ type: 'error', text: t('settings.whatsapp.tenantNotFound') });
      setWhatsappLoading(false);
      return;
    }

    // Validate required fields based on provider
    if (whatsappSettings.provider === 'meta') {
      if (!whatsappSettings.phone_number_id || !whatsappSettings.access_token) {
        setWhatsappMessage({ 
          type: 'error', 
          text: t('settings.whatsapp.phoneNumberIdAndTokenRequired')
        });
        setWhatsappLoading(false);
        return;
      }
    } else if (whatsappSettings.provider === 'twilio') {
      if (!whatsappSettings.account_sid || !whatsappSettings.auth_token) {
        setWhatsappMessage({ 
          type: 'error', 
          text: t('settings.whatsapp.accountSidAndAuthTokenRequired')
        });
        setWhatsappLoading(false);
        return;
      }
    } else if (whatsappSettings.provider === 'wati') {
      if (!whatsappSettings.api_key) {
        setWhatsappMessage({ 
          type: 'error', 
          text: t('settings.whatsapp.apiKeyRequired')
        });
        setWhatsappLoading(false);
        return;
      }
    }

    try {
      const token = localStorage.getItem('auth_token');
      const API_URL = getApiUrl();
      const response = await fetch(`${API_URL}/tenants/whatsapp-settings`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(whatsappSettings),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save WhatsApp settings');
      }

      setWhatsappMessage({ type: 'success', text: t('settings.whatsapp.saved') });
    } catch (err: any) {
      console.error('Error saving WhatsApp settings:', err);
      setWhatsappMessage({ type: 'error', text: err.message || t('settings.whatsapp.saved') });
    } finally {
      setWhatsappLoading(false);
    }
  }

  async function handleWhatsappTest() {
    setWhatsappMessage(null);
    setWhatsappTestLoading(true);

    if (!tenant?.id) {
      setWhatsappMessage({ type: 'error', text: t('settings.whatsapp.tenantNotFound') });
      setWhatsappTestLoading(false);
      return;
    }

    // Validate required fields based on provider
    if (whatsappSettings.provider === 'meta') {
      if (!whatsappSettings.phone_number_id || !whatsappSettings.access_token) {
        setWhatsappMessage({ 
          type: 'error', 
          text: t('settings.whatsapp.fillPhoneNumberIdAndToken')
        });
        setWhatsappTestLoading(false);
        return;
      }
    } else if (whatsappSettings.provider === 'twilio') {
      if (!whatsappSettings.account_sid || !whatsappSettings.auth_token) {
        setWhatsappMessage({ 
          type: 'error', 
          text: t('settings.whatsapp.fillAccountSidAndAuthToken')
        });
        setWhatsappTestLoading(false);
        return;
      }
    } else if (whatsappSettings.provider === 'wati') {
      if (!whatsappSettings.api_key) {
        setWhatsappMessage({ 
          type: 'error', 
          text: t('settings.whatsapp.fillApiKey')
        });
        setWhatsappTestLoading(false);
        return;
      }
    }

    try {
      const token = localStorage.getItem('auth_token');
      const API_URL = getApiUrl();
      const response = await fetch(`${API_URL}/tenants/whatsapp-settings/test`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(whatsappSettings),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'WhatsApp connection test failed');
      }

      setWhatsappMessage({ 
        type: 'success', 
        text: t('settings.whatsapp.connectionTestSuccessful', { provider: whatsappSettings.provider })
      });
    } catch (err: any) {
      console.error('WhatsApp test error:', err);
      setWhatsappMessage({ 
        type: 'error', 
        text: err.message || t('settings.whatsapp.connectionTestFailed')
      });
    } finally {
      setWhatsappTestLoading(false);
    }
  }

  async function handleZohoSave(e: React.FormEvent) {
    e.preventDefault();
    setZohoMessage(null);
    setZohoLoading(true);

    if (!tenant?.id) {
      setZohoMessage({ type: 'error', text: t('settings.zoho.tenantNotFound') });
      setZohoLoading(false);
      return;
    }

    if (!zohoSettings.client_id || !zohoSettings.client_secret) {
      setZohoMessage({ type: 'error', text: t('settings.zoho.clientIdAndSecretRequired') });
      setZohoLoading(false);
      return;
    }

    // Ensure redirect_uri is set (use default if not provided)
    if (!zohoSettings.redirect_uri || zohoSettings.redirect_uri.trim() === '') {
      const defaultUri = `${window.location.origin}/api/zoho/callback`;
      setZohoSettings({ ...zohoSettings, redirect_uri: defaultUri });
      console.log(`[SettingsPage] Using default redirect URI: ${defaultUri}`);
    }

    try {
      const token = localStorage.getItem('auth_token');
      const API_URL = getApiUrl();
      const response = await fetch(`${API_URL}/tenants/zoho-config`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(zohoSettings),
      });

      const data = await response.json();

      if (!response.ok) {
        // Provide more helpful error message for access denied
        if (response.status === 403) {
          const errorMsg = data.error || 'Access denied';
          const hint = data.hint || '';
          throw new Error(`${errorMsg}${hint ? ' ' + hint : ''}`);
        }
        throw new Error(data.error || 'Failed to save Zoho configuration');
      }

      setZohoMessage({ type: 'success', text: t('settings.zoho.saved') });
      
      // Reload status
      await loadZohoStatus();
    } catch (err: any) {
      console.error('Error saving Zoho settings:', err);
      setZohoMessage({ type: 'error', text: err.message || t('settings.zoho.failedToSave') });
    } finally {
      setZohoLoading(false);
    }
  }

  async function handleInvoiceProviderSave(e: React.FormEvent) {
    e.preventDefault();
    setInvoiceProviderMessage(null);
    if (!tenant?.id) {
      setInvoiceProviderMessage({ type: 'error', text: t('settings.zoho.tenantNotFound') });
      return;
    }
    if (invoiceProvider === 'daftra') {
      if (!daftraForm.subdomain.trim()) {
        setInvoiceProviderMessage({ type: 'error', text: t('settings.invoiceProvider.subdomainRequired') });
        return;
      }
      const sid = parseInt(daftraForm.store_id, 10);
      const pid = parseInt(daftraForm.default_product_id, 10);
      if (!Number.isFinite(sid) || !Number.isFinite(pid)) {
        setInvoiceProviderMessage({ type: 'error', text: t('settings.invoiceProvider.idsRequired') });
        return;
      }
      if (!daftraTokenSet && !daftraForm.api_token.trim()) {
        setInvoiceProviderMessage({ type: 'error', text: t('settings.invoiceProvider.tokenRequired') });
        return;
      }
      const vatPercentage = parseFloat(daftraForm.vat_percentage);
      if (!Number.isFinite(vatPercentage) || vatPercentage < 0 || vatPercentage > 100) {
        setInvoiceProviderMessage({
          type: 'error',
          text: t('settings.invoiceProvider.vatInvalid', 'VAT percentage must be between 0 and 100'),
        });
        return;
      }
      if (daftraForm.invoice_layout_id.trim()) {
        const layoutId = parseInt(daftraForm.invoice_layout_id, 10);
        if (!Number.isFinite(layoutId)) {
          setInvoiceProviderMessage({
            type: 'error',
            text: t('settings.invoiceProvider.layoutIdInvalid', 'Invoice layout ID must be a valid number'),
          });
          return;
        }
      }
    }
    setInvoiceProviderLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const API_URL = getApiUrl();
      const body: Record<string, unknown> = { invoice_provider: invoiceProvider };
      if (invoiceProvider === 'daftra') {
        body.daftra_settings = {
          subdomain: daftraForm.subdomain.trim(),
          store_id: parseInt(daftraForm.store_id, 10),
          default_product_id: parseInt(daftraForm.default_product_id, 10),
          ...(daftraForm.invoice_layout_id.trim()
            ? { invoice_layout_id: parseInt(daftraForm.invoice_layout_id, 10) }
            : {}),
          vat_percentage: parseFloat(daftraForm.vat_percentage || '15'),
          vat_registration_number: daftraForm.vat_registration_number.trim().slice(0, 64),
          country_code: (daftraForm.country_code || 'SA').trim(),
          fallback_to_zoho: daftraForm.fallback_to_zoho,
          ...(daftraForm.api_token.trim() ? { api_token: daftraForm.api_token.trim() } : {}),
        };
      }
      const response = await fetch(`${API_URL}/tenants/invoice-provider-settings`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setInvoiceProviderMessage({ type: 'success', text: t('settings.invoiceProvider.saved') });
      setDaftraForm((f) => ({
        ...f,
        api_token: '',
      }));
      if (data.daftra_settings?.api_token_set) setDaftraTokenSet(true);
    } catch (err: any) {
      setInvoiceProviderMessage({ type: 'error', text: err.message || t('settings.invoiceProvider.saveFailed') });
    } finally {
      setInvoiceProviderLoading(false);
    }
  }

  async function handleZohoTest() {
    setZohoMessage(null);
    setZohoTestLoading(true);

    if (!tenant?.id) {
      setZohoMessage({ type: 'error', text: t('settings.zoho.tenantNotFound') });
      setZohoTestLoading(false);
      return;
    }

    try {
      const token = localStorage.getItem('auth_token');
      const API_URL = getApiUrl();
      const response = await fetch(`${API_URL}/tenants/zoho-config/test`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        // Provide more helpful error message for access denied
        if (response.status === 403) {
          const errorMsg = data.error || 'Access denied';
          const hint = data.hint || '';
          throw new Error(`${errorMsg}${hint ? ' ' + hint : ''}`);
        }
        throw new Error(data.error || 'Zoho connection test failed');
      }

      setZohoMessage({ 
        type: 'success', 
        text: data.message || t('settings.zoho.connectionTestSuccessful')
      });
    } catch (err: any) {
      console.error('Zoho test error:', err);
      setZohoMessage({ 
        type: 'error', 
        text: err.message || t('settings.zoho.connectionTestFailed')
      });
    } finally {
      setZohoTestLoading(false);
    }
  }

  async function handleZohoDisconnect() {
    if (!tenant?.id) {
      setZohoMessage({ type: 'error', text: 'Tenant not found' });
      return;
    }

    const ok = await showConfirm({
      title: t('common.confirm'),
      description: t('settings.zoho.disconnectConfirm') || 'Are you sure you want to disconnect Zoho integration? This will remove all stored tokens.',
      destructive: true,
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
    });
    if (!ok) return;

    setZohoLoading(true);
    setZohoMessage(null);

    try {
      const API_URL = getApiUrl();
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_URL}/zoho/disconnect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ tenant_id: tenant.id }),
        signal: createTimeoutSignal(`${API_URL}/zoho/disconnect`, !API_URL.startsWith('http')),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to disconnect Zoho');
      }

      const result = await response.json();
      
      if (result.success) {
        setZohoMessage({ type: 'success', text: t('settings.zoho.zohoIntegrationDisconnectedSuccessfully') });
        // Refresh status to reflect disconnection
        setTimeout(() => {
          loadZohoStatus();
        }, 1000);
      } else {
        throw new Error(result.error || 'Failed to disconnect');
      }
    } catch (error: any) {
      console.error('Error disconnecting Zoho:', error);
      setZohoMessage({ 
        type: 'error', 
        text: error.message || t('settings.zoho.failedToDisconnect')
      });
    } finally {
      setZohoLoading(false);
    }
  }

  async function handleZohoConnect() {
    if (!tenant?.id) {
      setZohoMessage({ type: 'error', text: t('settings.zoho.tenantNotFound') });
      return;
    }

    if (!zohoSettings.client_id || !zohoSettings.client_secret) {
      setZohoMessage({ type: 'error', text: t('settings.zoho.pleaseSaveCredentials') });
      return;
    }

    // Check if backend server is running first
    setZohoMessage({ type: 'info', text: t('settings.zoho.checkingServerConnection') });
    
    try {
      const API_URL = getApiUrl();
      // For relative URLs (Bolt), use relative path; otherwise extract base URL
      const healthCheckUrl = API_URL.startsWith('/') 
        ? '' // Relative URL - Vite proxy will handle it
        : API_URL.replace('/api', '') || 'https://booktifisupabase-production.up.railway.app';
      
      // Health check can use shorter timeout, but allow for cold starts
      const healthCheck = await fetch(`${healthCheckUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(15000), // 15 seconds for health check (allows for cold starts)
      });

      if (!healthCheck.ok) {
        throw new Error('Server health check failed');
      }
    } catch (error: any) {
      const isBolt = window.location.hostname.includes('bolt') || window.location.hostname.includes('webcontainer');
      
      // Check for specific connection refused error
      const isConnectionRefused = 
        error.message?.includes('ERR_CONNECTION_REFUSED') ||
        error.message?.includes('Failed to fetch') ||
        error.message?.includes('network') ||
        error.name === 'TypeError' ||
        error.name === 'AbortError';
      
      let errorMessage: string;
      
      if (isBolt) {
        if (isConnectionRefused) {
          errorMessage = '❌ Backend server is not running!\n\n' +
            'The error "ERR_CONNECTION_REFUSED" means the backend server is not accessible.\n\n' +
            'In Bolt, verify:\n' +
            '1. Railway backend is running: https://booktifisupabase-production.up.railway.app/health\n' +
            '2. VITE_API_URL is set correctly in Bolt environment variables\n' +
            '3. The Railway backend is deployed and accessible\n' +
            '4. Then try "Connect to Zoho" again\n\n' +
            '⚠️ Note: The redirect URI must match what is configured in Zoho Developer Console.';
        } else {
          errorMessage = 'Backend server is not running. In Bolt, you must keep the server terminal open.\n\n' +
            'To fix:\n' +
            '1. Check the terminal where you ran "npm run dev"\n' +
            '2. Make sure the server is still running\n' +
            '3. If closed, restart with: npm run dev\n' +
            '4. Wait for "🚀 API Server running" message';
        }
      } else {
        if (isConnectionRefused) {
          errorMessage = '❌ Backend server is not running!\n\n' +
            'The error "ERR_CONNECTION_REFUSED" means the backend server is not accessible.\n\n' +
            'To fix:\n' +
            '1. Verify Railway backend is running: https://booktifisupabase-production.up.railway.app/health\n' +
            '2. Check that VITE_API_URL is set correctly in your environment\n' +
            '3. Ensure the Railway backend is deployed and accessible\n' +
            '4. Then try "Connect to Zoho" again';
        } else {
          errorMessage = 'Backend server is not running. Please start the server:\n\n' +
            '1. Open terminal\n' +
            '2. cd to project/server\n' +
            '3. Run: npm run dev\n\n' +
            'Or double-click start-server.bat';
        }
      }
      
      setZohoMessage({ 
        type: 'error', 
        text: errorMessage 
      });
      return;
    }

    // HYBRID APPROACH: Pass origin to backend for dynamic redirect URI
    // Get current origin (works for both local and Bolt)
    let currentOrigin = window.location.origin;
    
    // For Netlify: ALWAYS use production domain for Zoho redirect URI
    // Preview URLs change with each deploy, causing Zoho redirect URI mismatches
    // Production domain remains constant, so use it for Zoho OAuth
    if (currentOrigin.includes('netlify.app')) {
      // Always use production domain for Zoho redirect, regardless of preview URL
      const productionDomain = 'bookati.netlify.app'; // Your production domain
      if (productionDomain && currentOrigin.includes('--')) {
        // This is a preview URL, switch to production domain
        console.log('[Zoho Connect] ⚠️  Preview URL detected, using production domain for Zoho redirect');
        console.log('[Zoho Connect]    Preview URL:', currentOrigin);
        console.log('[Zoho Connect]    Production URL:', `https://${productionDomain}`);
        currentOrigin = `https://${productionDomain}`;
      } else if (!currentOrigin.includes('--')) {
        // Already using production domain, keep it
        console.log('[Zoho Connect] ✅ Using production domain for Zoho redirect:', currentOrigin);
      }
    }
    
    const isBolt = window.location.hostname.includes('bolt') || window.location.hostname.includes('webcontainer');
    
    // Construct auth URL with origin parameter
    // Use getApiUrl() which automatically detects Bolt environment
    const API_URL = getApiUrl();
    
    const authUrl = `${API_URL}/zoho/auth?tenant_id=${tenant.id}&origin=${encodeURIComponent(currentOrigin)}`;
    
    console.log('[Zoho Connect] ========================================');
    console.log('[Zoho Connect] Environment Detection:');
    console.log('[Zoho Connect] Window Location:', {
      origin: window.location.origin,
      hostname: window.location.hostname,
      href: window.location.href
    });
    console.log('[Zoho Connect] Current Origin:', currentOrigin);
    console.log('[Zoho Connect] Is Bolt:', isBolt);
    console.log('[Zoho Connect] API URL:', API_URL);
    console.log('[Zoho Connect] Auth URL:', authUrl);
    console.log('[Zoho Connect] Passing origin to backend:', currentOrigin);
    console.log('[Zoho Connect] ⚠️  Expected redirect URI:', `${currentOrigin}/api/zoho/callback`);
    console.log('[Zoho Connect] ========================================');
    
    // Open OAuth flow in popup window
    const popup = window.open(
      authUrl,
      'Zoho OAuth',
      'width=600,height=700,scrollbars=yes,resizable=yes'
    );

    // Listen for OAuth completion message
    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === 'ZOHO_OAUTH_SUCCESS' && event.data.tenantId === tenant?.id) {
        // OAuth completed successfully, refresh status
        window.removeEventListener('message', messageHandler);
        setZohoMessage({ type: 'success', text: t('settings.zoho.zohoAccountConnectedSuccessfully') });
        
        // Reload status after a short delay
        setTimeout(() => {
          loadZohoStatus();
        }, 1000);
      }
    };

    window.addEventListener('message', messageHandler);

    // Check if popup was blocked
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      setZohoMessage({ type: 'error', text: t('settings.zoho.popupBlocked') });
    }
  }

  async function loadZohoStatus() {
    if (!tenant?.id) return;
    
    try {
      const token = localStorage.getItem('auth_token');
      const API_URL = getApiUrl();
      const statusResponse = await fetch(`${API_URL}/tenants/zoho-status`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        setZohoStatus(statusData);
      }
    } catch (err) {
      console.error('Error loading Zoho status:', err);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!tenant?.id) return;

    setLoading(true);
    try {
      // Use backend API endpoint instead of direct database update
      const { getApiUrl } = await import('../../lib/apiUrl');
      const API_URL = getApiUrl();
      const session = await db.auth.getSession();
      const token = session.data.session?.access_token;

      const response = await fetch(`${API_URL}/tenants/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          name: formData.name,
          name_ar: formData.name_ar,
          contact_email: formData.contact_email,
          tenant_time_zone: formData.tenant_time_zone,
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to update settings' }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      // Update formData with the actual persisted values from the response
      if (result.tenant) {
        setFormData((prev) => ({
          ...prev,
          name: result.tenant.name || prev.name,
          name_ar: result.tenant.name_ar || prev.name_ar,
          contact_email: result.tenant.contact_email || prev.contact_email,
          tenant_time_zone: result.tenant.tenant_time_zone || prev.tenant_time_zone,
        }));
      }

      showNotification('success', t('settings.settingsSavedSuccessfully'));
    } catch (err: any) {
      console.error('Error saving settings:', err);
      const errorMessage = err.message || t('settings.errorSavingSettings');
      showNotification('error', errorMessage);
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMessage(null);

    // Validate passwords
      if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordMessage({ type: 'error', text: t('settings.security.newPasswordsDoNotMatch') });
      return;
    }

    if (passwordData.newPassword.length < 6) {
      setPasswordMessage({ type: 'error', text: t('settings.security.passwordMinLength') });
      return;
    }

    setPasswordLoading(true);
    try {
      // First verify current password by attempting to re-authenticate
      // Pass forCustomer: false since this is admin/service provider/employee settings page
      const { error: signInError } = await db.auth.signInWithPassword({
        email: user?.email || '',
        password: passwordData.currentPassword,
        forCustomer: false,
      });

      if (signInError) {
        setPasswordMessage({ type: 'error', text: t('settings.security.currentPasswordIncorrect') });
        setPasswordLoading(false);
        return;
      }

      // Update password
      const { error: updateError } = await db.auth.updateUser({
        password: passwordData.newPassword,
      });

      if (updateError) throw updateError;

      setPasswordMessage({ type: 'success', text: t('settings.security.passwordUpdatedSuccessfully') });
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });

      // Log out after 3 seconds to ensure new password takes effect
      setTimeout(async () => {
        await signOut();
        navigate('/login');
      }, 3000);
    } catch (err) {
      console.error('Error updating password:', err);
      setPasswordMessage({ type: 'error', text: t('settings.security.errorUpdatingPassword') });
    } finally {
      setPasswordLoading(false);
    }
  }

  // Show loading state if tenant is not loaded yet
  if (!tenant) {
    return (
      <div className="p-4 md:p-8">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">{t('settings.loading')}</p>
        </div>
      </div>
    );
  }

  if (!isValidSettingsSection(section, userProfile?.role)) {
    return <Navigate to={`/${tenantSlug}/admin/settings/account`} replace />;
  }

  if (section === 'whatsapp' && tenantSlug) {
    return <Navigate to={`/${tenantSlug}/admin/settings/app-manager?tab=whatsapp`} replace />;
  }
  if (section === 'integrations' && tenantSlug) {
    return <Navigate to={`/${tenantSlug}/admin/settings/app-manager?tab=smtp`} replace />;
  }

  return (
    <div className="max-w-3xl">
      <div className="space-y-6">
        {section === 'account' && (
          <div className="space-y-6">
            <section className="scroll-mt-24">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5" />
                    {t('settings.accountCardTitle')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-gray-500">{t('settings.accountCardHint')}</p>
                  <div>
                    <p className="text-sm font-medium text-gray-700">{userProfile?.full_name || '—'}</p>
                    <p className="text-sm text-gray-600">{user?.email || '—'}</p>
                  </div>
                </CardContent>
              </Card>
            </section>

            <form onSubmit={handleSubmit} className="space-y-6">
              <section className="scroll-mt-24">
                <Card className="shadow-sm border border-gray-200/80">
                  <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-t-xl">
                    <CardTitle className="flex items-center gap-2 text-xl">
                      <Building2 className="w-6 h-6 text-blue-600" />
                      {t('tenant.businessInformation')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
                    <Input
                      label={t('tenant.businessNameEnglish')}
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                      placeholder={t('tenant.businessNameEnglishPlaceholder')}
                    />

                    <Input
                      label={t('tenant.businessNameArabic')}
                      value={formData.name_ar || ''}
                      onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                      dir="rtl"
                      placeholder={t('tenant.businessNameArabicPlaceholder')}
                    />

                    <Input
                      type="email"
                      label={t('tenant.contactEmail')}
                      value={formData.contact_email || ''}
                      onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                      required
                      placeholder={t('settings.contactEmailPlaceholder')}
                    />

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t('tenant.timezone')}
                      </label>
                      <select
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        value={formData.tenant_time_zone}
                        onChange={(e) => setFormData({ ...formData, tenant_time_zone: e.target.value })}
                        required
                      >
                        <option value="Asia/Riyadh">Asia/Riyadh (Saudi Arabia)</option>
                        <option value="Asia/Dubai">Asia/Dubai (UAE)</option>
                        <option value="Asia/Kuwait">Asia/Kuwait</option>
                        <option value="Asia/Bahrain">Asia/Bahrain</option>
                        <option value="Asia/Qatar">Asia/Qatar</option>
                      </select>
                    </div>
                  </CardContent>
                </Card>
              </section>
              <div className="flex justify-end gap-3">
                <Button
                  type="submit"
                  loading={loading}
                  icon={<Save className="w-4 h-4" />}
                  style={{
                    background: `linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%)`,
                  }}
                >
                  {t('tenant.saveSettings')}
                </Button>
              </div>
            </form>

            {userProfile?.role === 'tenant_admin' && (
              <section className="scroll-mt-24">
                <Card>
                  <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
                    <CardTitle className="flex items-center gap-2 text-xl">
                      <DollarSign className="w-6 h-6 text-green-600" />
                      {t('settings.currency.title')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
                    <p className="text-sm text-gray-600">
                      {t('settings.currency.description')}
                    </p>

                    {currencyMessage && (
                      <div className={`p-3 rounded-lg text-sm ${
                        currencyMessage.type === 'success'
                          ? 'bg-green-50 border border-green-200 text-green-700'
                          : 'bg-red-50 border border-red-200 text-red-700'
                      }`}>
                        <div className="flex items-center gap-2">
                          {currencyMessage.type === 'success' ? (
                            <CheckCircle className="w-4 h-4" />
                          ) : (
                            <XCircle className="w-4 h-4" />
                          )}
                          {currencyMessage.text}
                        </div>
                        {currencyMessage.warning && (
                          <div className="mt-2 pt-2 border-t border-yellow-300 text-yellow-700 text-xs">
                            {currencyMessage.warning}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        {t('settings.currency.selectCurrency') || 'Select Currency'}
                      </label>
                      <select
                        value={selectedCurrencyCode}
                        onChange={(e) => setSelectedCurrencyCode(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={currencyLoading}
                      >
                        {getAvailableCurrencies().map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.symbol} - {currency.name} ({currency.code})
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500">
                        {t('settings.currency.hint')}
                      </p>
                    </div>

                    <div className="flex justify-end pt-2">
                      <Button
                        onClick={async () => {
                          if (!userProfile?.tenant_id) {
                            setCurrencyMessage({ type: 'error', text: t('settings.currency.tenantIdNotFound') });
                            return;
                          }

                          if (selectedCurrencyCode === currentCurrencyCode) {
                            setCurrencyMessage({ type: 'error', text: t('settings.currency.currencyAlreadySet') });
                            return;
                          }

                          setCurrencyLoading(true);
                          setCurrencyMessage(null);

                          try {
                            const token = localStorage.getItem('auth_token');
                            const API_URL = getApiUrl();
                            const response = await fetch(`${API_URL}/tenants/currency`, {
                              method: 'PUT',
                              headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({ currency_code: selectedCurrencyCode }),
                            });

                            if (!response.ok) {
                              const error = await response.json();
                              throw new Error(error.error || 'Failed to update currency');
                            }

                            const result = await response.json();
                            setCurrencyMessage({
                              type: 'success',
                              text: t('settings.currency.currencyUpdatedTo', { code: selectedCurrencyCode }),
                              warning: result.warning,
                            });

                            await refreshCurrency();
                          } catch (err: any) {
                            console.error('Error updating currency:', err);
                            setCurrencyMessage({
                              type: 'error',
                              text: err.message || t('settings.currency.updateFailed'),
                            });
                          } finally {
                            setCurrencyLoading(false);
                          }
                        }}
                        loading={currencyLoading}
                        icon={<DollarSign className="w-4 h-4" />}
                      >
                        {t('settings.currency.save')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}

            <section className="scroll-mt-24">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lock className="w-5 h-5" />
                    {t('settings.security.title')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handlePasswordChange} className="space-y-4">
                    {passwordMessage && (
                      <div className={`p-3 rounded-lg text-sm ${
                        passwordMessage.type === 'success'
                          ? 'bg-green-50 border border-green-200 text-green-700'
                          : 'bg-red-50 border border-red-200 text-red-700'
                      }`}>
                        {passwordMessage.text}
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        {t('settings.security.accountEmail')}
                      </label>
                      <Input
                        type="text"
                        value={user?.email || ''}
                        disabled
                        className="bg-gray-50"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        {t('settings.security.currentPassword')}
                      </label>
                      <div className="relative">
                        <Input
                          type={showCurrentPassword ? 'text' : 'password'}
                          value={passwordData.currentPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                          placeholder={t('settings.security.enterCurrentPassword')}
                          required
                          className={isRtl ? 'pl-10' : 'pr-10'}
                        />
                        <button
                          type="button"
                          onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                          className={`absolute top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 ${isRtl ? 'left-3' : 'right-3'}`}
                        >
                          {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        {t('settings.security.newPassword')}
                      </label>
                      <div className="relative">
                        <Input
                          type={showNewPassword ? 'text' : 'password'}
                          value={passwordData.newPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                          placeholder={t('settings.security.enterNewPassword')}
                          required
                          minLength={6}
                          className={isRtl ? 'pl-10' : 'pr-10'}
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          className={`absolute top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 ${isRtl ? 'left-3' : 'right-3'}`}
                        >
                          {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        {t('settings.security.confirmPassword')}
                      </label>
                      <div className="relative">
                        <Input
                          type={showConfirmPassword ? 'text' : 'password'}
                          value={passwordData.confirmPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                          placeholder={t('settings.security.confirmNewPassword')}
                          required
                          minLength={6}
                          className={isRtl ? 'pl-10' : 'pr-10'}
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className={`absolute top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 ${isRtl ? 'left-3' : 'right-3'}`}
                        >
                          {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex justify-end pt-2">
                      <Button
                        type="submit"
                        loading={passwordLoading}
                        icon={<Lock className="w-4 h-4" />}
                      >
                        {t('settings.security.updatePassword')}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </section>
          </div>
        )}

        {section === 'scheduling' && (
          <section className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5" />
                {t('settings.schedulingConfiguration', 'Scheduling Configuration')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                {t('settings.schedulingModeDescription', 'This setting controls how the entire booking system behaves. Changing the mode updates availability source and UI across Admin and Receptionist panels.')}
              </p>
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-gray-200 hover:bg-gray-50">
                  <input
                    type="radio"
                    name="scheduling_mode"
                    value="service_slot_based"
                    checked={(tenantFeatures?.scheduling_mode ?? 'service_slot_based') === 'service_slot_based'}
                    onChange={async () => {
                      if (!userProfile?.tenant_id) return;
                      const ok = await showConfirm({
                        title: t('settings.schedulingConfirmServiceSlotTitle', 'Switch to service slot based?'),
                        description: t(
                          'settings.schedulingConfirmServiceSlotDescription',
                          'This will change scheduling for your whole business. Available booking slots will follow each service’s slot setup instead of employee shifts. Shift-based availability will stop driving open times, which can change what customers and reception see. Confirm only if you are ready for this impact on shifts and slots.',
                        ),
                        confirmText: t('common.confirm'),
                        cancelText: t('common.cancel'),
                      });
                      if (!ok) return;
                      setSchedulingModeMessage(null);
                      setSchedulingModeSaving(true);
                      try {
                        const { error } = await db.from('tenant_features').update({ scheduling_mode: 'service_slot_based' }).eq('tenant_id', userProfile.tenant_id);
                        if (error) throw error;
                        setSchedulingModeMessage({ type: 'success', text: t('settings.schedulingModeSaved', 'Scheduling mode updated. Service slots are now used for availability.') });
                        await reloadTenantFeatures();
                      } catch (err: any) {
                        setSchedulingModeMessage({ type: 'error', text: err.message || t('common.error') });
                      } finally {
                        setSchedulingModeSaving(false);
                      }
                    }}
                    disabled={schedulingModeSaving}
                    className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <div>
                    <span className="font-medium text-gray-900">{t('settings.serviceSlotBased', 'Service slot based')}</span>
                    <p className="text-xs text-gray-500 mt-0.5">{t('settings.serviceSlotBasedHelp', 'Availability from service-defined slots. Add/Edit/Delete slots per service. No employee assignment required.')}</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-gray-200 hover:bg-gray-50">
                  <input
                    type="radio"
                    name="scheduling_mode"
                    value="employee_based"
                    checked={(tenantFeatures?.scheduling_mode ?? 'service_slot_based') === 'employee_based'}
                    onChange={async () => {
                      if (!userProfile?.tenant_id) return;
                      const ok = await showConfirm({
                        title: t('settings.schedulingConfirmEmployeeTitle', 'Switch to employee based?'),
                        description: t(
                          'settings.schedulingConfirmEmployeeDescription',
                          'This will change scheduling for your whole business. Available slots will follow employee working shifts instead of service-defined slots. Service slot management will be hidden in the admin UI. How employees appear on the calendar and how many slots show can change. Confirm only if shifts are configured the way you want.',
                        ),
                        confirmText: t('common.confirm'),
                        cancelText: t('common.cancel'),
                      });
                      if (!ok) return;
                      setSchedulingModeMessage(null);
                      setSchedulingModeSaving(true);
                      try {
                        const { error } = await db.from('tenant_features').update({ scheduling_mode: 'employee_based' }).eq('tenant_id', userProfile.tenant_id);
                        if (error) throw error;
                        setSchedulingModeMessage({ type: 'success', text: t('settings.schedulingModeSavedEmployee', 'Scheduling mode updated. Employee shifts are now used for availability.') });
                        await reloadTenantFeatures();
                      } catch (err: any) {
                        setSchedulingModeMessage({ type: 'error', text: err.message || t('common.error') });
                      } finally {
                        setSchedulingModeSaving(false);
                      }
                    }}
                    disabled={schedulingModeSaving}
                    className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <div>
                    <span className="font-medium text-gray-900">{t('settings.employeeBased', 'Employee based')}</span>
                    <p className="text-xs text-gray-500 mt-0.5">{t('settings.employeeBasedHelp', 'Availability from employee working shifts. Service slot management is hidden. Bookings are linked to employees (auto or manual assign).')}</p>
                  </div>
                </label>

                {/* Assignment mode: only when Employee based is selected */}
                {(tenantFeatures?.scheduling_mode ?? 'service_slot_based') === 'employee_based' && (
                  <div className="ml-6 mt-3 pl-4 border-l-2 border-blue-200 space-y-2">
                    <p className="text-sm font-medium text-gray-700">{t('settings.assignmentMode', 'Assignment mode')}</p>
                    <p className="text-xs text-gray-500">{t('settings.assignmentModeHelp', 'Who assigns the employee to the booking.')}</p>
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="employee_assignment_mode"
                          value="automatic"
                          checked={(tenantFeatures as any)?.employee_assignment_mode === 'automatic'}
                          onChange={async () => {
                            if (!userProfile?.tenant_id) return;
                            const ok = await showConfirm({
                              title: t('settings.schedulingConfirmAutoAssignTitle', 'Set assignment to automatic?'),
                              description: t(
                                'settings.schedulingConfirmAutoAssignDescription',
                                'Employees will be assigned to new bookings automatically when the system can match them. This can change how bookings line up with shifts and which time slots stay open or get blocked. Reception may see different suggested staff than with manual assignment.',
                              ),
                              confirmText: t('common.confirm'),
                              cancelText: t('common.cancel'),
                            });
                            if (!ok) return;
                            setSchedulingModeMessage(null);
                            setSchedulingModeSaving(true);
                            try {
                              const { error } = await db.from('tenant_features').update({ employee_assignment_mode: 'automatic' }).eq('tenant_id', userProfile.tenant_id);
                              if (error) throw error;
                              setSchedulingModeMessage({ type: 'success', text: t('settings.assignmentModeSaved', 'Assignment mode set to Auto assign.') });
                              await reloadTenantFeatures();
                            } catch (err: any) {
                              setSchedulingModeMessage({ type: 'error', text: err.message || t('common.error') });
                            } finally {
                              setSchedulingModeSaving(false);
                            }
                          }}
                          disabled={schedulingModeSaving}
                          className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                        />
                        <span className="text-sm">{t('settings.autoAssign', 'Auto assign')}</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="employee_assignment_mode"
                          value="manual"
                          checked={(tenantFeatures as any)?.employee_assignment_mode === 'manual'}
                          onChange={async () => {
                            if (!userProfile?.tenant_id) return;
                            const ok = await showConfirm({
                              title: t('settings.schedulingConfirmManualAssignTitle', 'Set assignment to manual?'),
                              description: t(
                                'settings.schedulingConfirmManualAssignDescription',
                                'Reception (or admins) will choose the employee for each booking. That can change how quickly slots fill and how bookings align with shift coverage. Available slots still follow employee shifts, but staffing choices are no longer automatic.',
                              ),
                              confirmText: t('common.confirm'),
                              cancelText: t('common.cancel'),
                            });
                            if (!ok) return;
                            setSchedulingModeMessage(null);
                            setSchedulingModeSaving(true);
                            try {
                              const { error } = await db.from('tenant_features').update({ employee_assignment_mode: 'manual' }).eq('tenant_id', userProfile.tenant_id);
                              if (error) throw error;
                              setSchedulingModeMessage({ type: 'success', text: t('settings.assignmentModeSavedManual', 'Assignment mode set to Manual.') });
                              await reloadTenantFeatures();
                            } catch (err: any) {
                              setSchedulingModeMessage({ type: 'error', text: err.message || t('common.error') });
                            } finally {
                              setSchedulingModeSaving(false);
                            }
                          }}
                          disabled={schedulingModeSaving}
                          className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                        />
                        <span className="text-sm">{t('settings.manualAssign', 'Manual')}</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
              {schedulingModeMessage && (
                <div className={`p-3 rounded-lg text-sm ${schedulingModeMessage.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                  {schedulingModeMessage.text}
                </div>
              )}
            </CardContent>
          </Card>
          </section>
        )}

        {section === 'currency' && userProfile?.role === 'tenant_admin' && (
            <section className="scroll-mt-24">
            <Card>
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <DollarSign className="w-6 h-6 text-green-600" />
                  {t('settings.currency.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                <p className="text-sm text-gray-600">
                  {t('settings.currency.description')}
                </p>

                {currencyMessage && (
                  <div className={`p-3 rounded-lg text-sm ${
                    currencyMessage.type === 'success'
                      ? 'bg-green-50 border border-green-200 text-green-700'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}>
                    <div className="flex items-center gap-2">
                      {currencyMessage.type === 'success' ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : (
                        <XCircle className="w-4 h-4" />
                      )}
                      {currencyMessage.text}
                    </div>
                    {currencyMessage.warning && (
                      <div className="mt-2 pt-2 border-t border-yellow-300 text-yellow-700 text-xs">
                        ⚠️ {currencyMessage.warning}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    {t('settings.currency.selectCurrency') || 'Select Currency'}
                  </label>
                  <select
                    value={selectedCurrencyCode}
                    onChange={(e) => setSelectedCurrencyCode(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    disabled={currencyLoading}
                  >
                    {getAvailableCurrencies().map((currency) => (
                      <option key={currency.code} value={currency.code}>
                        {currency.symbol} - {currency.name} ({currency.code})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500">
                    {t('settings.currency.hint')}
                  </p>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={async () => {
                      if (!userProfile?.tenant_id) {
                        setCurrencyMessage({ type: 'error', text: t('settings.currency.tenantIdNotFound') });
                        return;
                      }

                      if (selectedCurrencyCode === currentCurrencyCode) {
                        setCurrencyMessage({ type: 'error', text: t('settings.currency.currencyAlreadySet') });
                        return;
                      }

                      setCurrencyLoading(true);
                      setCurrencyMessage(null);

                      try {
                        const token = localStorage.getItem('auth_token');
                        const API_URL = getApiUrl();
                        const response = await fetch(`${API_URL}/tenants/currency`, {
                          method: 'PUT',
                          headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify({ currency_code: selectedCurrencyCode }),
                        });

                        if (!response.ok) {
                          const error = await response.json();
                          throw new Error(error.error || 'Failed to update currency');
                        }

                        const result = await response.json();
                        setCurrencyMessage({
                          type: 'success',
                          text: t('settings.currency.currencyUpdatedTo', { code: selectedCurrencyCode }),
                          warning: result.warning,
                        });

                        // Refresh currency context
                        await refreshCurrency();
                      } catch (err: any) {
                        console.error('Error updating currency:', err);
                        setCurrencyMessage({
                          type: 'error',
                          text: err.message || t('settings.currency.updateFailed'),
                        });
                      } finally {
                        setCurrencyLoading(false);
                      }
                    }}
                    loading={currencyLoading}
                    icon={<DollarSign className="w-4 h-4" />}
                  >
                    {t('settings.currency.save')}
                  </Button>
                </div>
              </CardContent>
            </Card>
            </section>
          )}

        {section === 'logos' && (
          <section className="scroll-mt-24">
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageLucide className="w-5 h-5" />
                  {t('settings.logosCardTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-gray-600">{t('settings.logosCardDescription')}</p>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <p className="text-sm font-medium text-gray-900">
                    {t('settings.logoUploadTitle', 'Main Logo')}
                  </p>
                  <p className="text-xs text-gray-600">
                    {t('settings.logoUploadHint', 'This logo appears on admin and customer pages.')}
                  </p>

                  <div className="h-20 w-20 rounded-xl border border-gray-200 bg-white flex items-center justify-center overflow-hidden">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Tenant logo" className="h-full w-full object-contain" />
                    ) : (
                      <ImageLucide className="w-6 h-6 text-gray-400" />
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const compressed = await compressImageToDataUrl(file);
                          await saveLogoUrl(compressed);
                        } finally {
                          e.currentTarget.value = '';
                        }
                      }}
                      disabled={logoUploading}
                      className="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-sm"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void saveLogoUrl(null)}
                      disabled={logoUploading || !logoUrl}
                    >
                      {t('common.remove', 'Remove')}
                    </Button>
                  </div>
                </div>
                {tenantSlug ? (
                  <Link
                    to={`/${tenantSlug}/admin/landing`}
                    className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-base font-medium bg-gray-200 text-gray-900 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                  >
                    <ExternalLink className="w-4 h-4 shrink-0" aria-hidden />
                    {t('settings.openLandingBuilder')}
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          </section>
        )}

        {section === 'app-manager' && (
          <section className="scroll-mt-24 space-y-6">
            <p className="text-sm text-gray-600">{t('settings.appManagerCardDescription')}</p>
            <div
              className="grid grid-cols-1 sm:grid-cols-3 gap-3"
              role="tablist"
              aria-label={t('settings.appManagerIntegrations', 'Integrations')}
            >
              {(
                [
                  {
                    id: 'smtp' as const,
                    label: t('settings.appManagerTabSmtp', 'SMTP / Email'),
                    logo: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/gmail.svg',
                    alt: 'SMTP',
                  },
                  {
                    id: 'whatsapp' as const,
                    label: t('settings.appManagerTabWhatsapp', 'WhatsApp'),
                    logo: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/whatsapp.svg',
                    alt: 'WhatsApp',
                  },
                  {
                    id: 'invoices' as const,
                    label: t('settings.appManagerTabInvoices', 'Invoices'),
                    logo: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/zoho.svg',
                    alt: 'Invoices',
                  },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={appTab === item.id}
                  onClick={() => setSearchParams({ tab: item.id }, { replace: true })}
                  className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all ${
                    appTab === item.id
                      ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <img src={item.logo} alt="" className="h-10 w-10 object-contain" aria-hidden />
                  <span className="text-sm font-medium text-gray-900">{item.label}</span>
                </button>
              ))}
            </div>

            {appTab === 'whatsapp' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5" />
                {t('settings.whatsapp.title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {whatsappMessage && (
                  <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
                    whatsappMessage.type === 'success'
                      ? 'bg-green-50 border border-green-200 text-green-700'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}>
                    {whatsappMessage.type === 'success' ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                    {whatsappMessage.text}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    {t('settings.whatsapp.provider')}
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    value={whatsappSettings.provider}
                    onChange={(e) => setWhatsappSettings({ ...whatsappSettings, provider: e.target.value as any })}
                    required
                  >
                    <option value="meta">{t('settings.whatsapp.providerMeta')}</option>
                    <option value="twilio">{t('settings.whatsapp.providerTwilio')}</option>
                    <option value="wati">{t('settings.whatsapp.providerWati')}</option>
                  </select>
                  <p className="text-xs text-gray-500">{t('settings.whatsapp.providerHint')}</p>
                </div>

                {/* Meta Cloud API Settings */}
                {whatsappSettings.provider === 'meta' && (
                  <>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        {t('settings.whatsapp.phoneNumberIdRequired')}
                      </label>
                      <Input
                        type="text"
                        value={whatsappSettings.phone_number_id}
                        onChange={(e) => setWhatsappSettings({ ...whatsappSettings, phone_number_id: e.target.value })}
                        placeholder={t('settings.whatsapp.phoneNumberIdPlaceholder')}
                        required
                      />
                      <p className="text-xs text-gray-500">{t('settings.whatsapp.phoneNumberIdHint')}</p>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        {t('settings.whatsapp.accessTokenRequired')}
                      </label>
                      <div className="relative">
                        <Input
                          type={showWhatsappToken ? 'text' : 'password'}
                          value={whatsappSettings.access_token}
                          onChange={(e) => setWhatsappSettings({ ...whatsappSettings, access_token: e.target.value })}
                          placeholder={t('settings.whatsapp.accessTokenPlaceholder')}
                          required
                          className={isRtl ? 'pl-10' : 'pr-10'}
                        />
                        <button
                          type="button"
                          onClick={() => setShowWhatsappToken(!showWhatsappToken)}
                          className={`absolute top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 ${isRtl ? 'left-3' : 'right-3'}`}
                        >
                          {showWhatsappToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="text-xs text-gray-500">{t('settings.whatsapp.accessTokenHint')}</p>
                    </div>
                  </>
                )}

                {/* Twilio Settings */}
                {whatsappSettings.provider === 'twilio' && (
                  <>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        {t('settings.whatsapp.accountSidLabel')}
                      </label>
                      <Input
                        type="text"
                        value={whatsappSettings.account_sid}
                        onChange={(e) => setWhatsappSettings({ ...whatsappSettings, account_sid: e.target.value })}
                        placeholder={t('settings.whatsapp.accountSidPlaceholder')}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        {t('settings.whatsapp.authTokenLabel')}
                      </label>
                      <div className="relative">
                        <Input
                          type={showWhatsappToken ? 'text' : 'password'}
                          value={whatsappSettings.auth_token}
                          onChange={(e) => setWhatsappSettings({ ...whatsappSettings, auth_token: e.target.value })}
                          placeholder={t('settings.whatsapp.authTokenPlaceholder')}
                          required
                          className={isRtl ? 'pl-10' : 'pr-10'}
                        />
                        <button
                          type="button"
                          onClick={() => setShowWhatsappToken(!showWhatsappToken)}
                          className={`absolute top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 ${isRtl ? 'left-3' : 'right-3'}`}
                        >
                          {showWhatsappToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        {t('settings.whatsapp.fromLabel')}
                      </label>
                      <Input
                        type="text"
                        value={whatsappSettings.from}
                        onChange={(e) => setWhatsappSettings({ ...whatsappSettings, from: e.target.value })}
                        placeholder={t('settings.whatsapp.fromPlaceholder')}
                      />
                      <p className="text-xs text-gray-500">{t('settings.whatsapp.fromFormat')}</p>
                    </div>
                  </>
                )}

                {/* WATI Settings */}
                {whatsappSettings.provider === 'wati' && (
                  <>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        {t('settings.whatsapp.apiUrlLabel')}
                      </label>
                      <Input
                        type="text"
                        value={whatsappSettings.api_url}
                        onChange={(e) => setWhatsappSettings({ ...whatsappSettings, api_url: e.target.value })}
                        placeholder={t('settings.whatsapp.apiUrlPlaceholder')}
                      />
                      <p className="text-xs text-gray-500">{t('settings.whatsapp.apiUrlDefault')}</p>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        {t('settings.whatsapp.apiKeyLabel')}
                      </label>
                      <div className="relative">
                        <Input
                          type={showWhatsappToken ? 'text' : 'password'}
                          value={whatsappSettings.api_key}
                          onChange={(e) => setWhatsappSettings({ ...whatsappSettings, api_key: e.target.value })}
                          placeholder={t('settings.whatsapp.apiKeyPlaceholder')}
                          required
                          className={isRtl ? 'pl-10' : 'pr-10'}
                        />
                        <button
                          type="button"
                          onClick={() => setShowWhatsappToken(!showWhatsappToken)}
                          className={`absolute top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 ${isRtl ? 'left-3' : 'right-3'}`}
                        >
                          {showWhatsappToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    onClick={handleWhatsappTest}
                    loading={whatsappTestLoading}
                    variant="secondary"
                    icon={<MessageCircle className="w-4 h-4" />}
                  >
                    {t('settings.whatsapp.testConnection')}
                  </Button>
                  <Button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      handleWhatsappSave(e as any);
                    }}
                    loading={whatsappLoading}
                    icon={<Save className="w-4 h-4" />}
                  >
                    {t('settings.whatsapp.save')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {appTab === 'smtp' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5" />
                {t('settings.smtp.title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {smtpMessage && (
                  <div className={`p-3 rounded-lg text-sm ${
                    smtpMessage.type === 'success'
                      ? 'bg-green-50 border border-green-200 text-green-700'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}>
                    <div className="flex items-center gap-2">
                    {smtpMessage.type === 'success' ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                    {smtpMessage.text}
                    </div>
                    {smtpMessage.hint && (
                      <div className="mt-2 pt-2 border-t border-red-300 text-red-600 text-xs">
                        💡 {smtpMessage.hint}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    {t('settings.smtp.host')}
                  </label>
                  <Input
                    type="text"
                    value={smtpSettings.smtp_host}
                    onChange={(e) => setSmtpSettings({ ...smtpSettings, smtp_host: e.target.value })}
                    placeholder={t('settings.smtp.hostPlaceholder')}
                    required
                  />
                  <p className="text-xs text-gray-500">{t('settings.smtp.defaultHost')}</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    {t('settings.smtp.port')}
                  </label>
                  <Input
                    type="number"
                    value={smtpSettings.smtp_port}
                    onChange={(e) => setSmtpSettings({ ...smtpSettings, smtp_port: parseInt(e.target.value) || 587 })}
                    placeholder={t('settings.smtp.portPlaceholder')}
                    required
                  />
                  <p className="text-xs text-gray-500">
                    {t('settings.smtp.portHint')}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    {t('settings.smtp.user')}
                  </label>
                  <Input
                    type="email"
                    value={smtpSettings.smtp_user}
                    onChange={(e) => setSmtpSettings({ ...smtpSettings, smtp_user: e.target.value })}
                    placeholder={t('settings.smtp.userPlaceholder')}
                    required
                  />
                  <p className="text-xs text-gray-500">{t('settings.smtp.userHint')}</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    {t('settings.smtp.appPassword')}
                  </label>
                  <div className="relative">
                    <Input
                      type={showSmtpPassword ? 'text' : 'password'}
                      value={smtpSettings.smtp_password}
                      onChange={(e) => setSmtpSettings({ ...smtpSettings, smtp_password: e.target.value })}
                      placeholder={t('settings.smtp.appPasswordPlaceholder')}
                      required
                      className={isRtl ? 'pl-10' : 'pr-10'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                      className={`absolute top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 ${isRtl ? 'left-3' : 'right-3'}`}
                    >
                      {showSmtpPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-red-600 font-medium">
                    {t('settings.smtp.appPasswordWarning')}
                  </p>
                  <p className="text-xs text-gray-500">
                    {t('settings.smtp.generateAppPassword')}{" "}
                    <a 
                      href={t('settings.smtp.appPasswordLink')} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline font-medium"
                    >
                      {t('settings.smtp.appPasswordLink')}
                    </a>
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    onClick={handleSmtpTest}
                    loading={smtpTestLoading}
                    variant="secondary"
                    icon={<Mail className="w-4 h-4" />}
                  >
                    {t('settings.smtp.testEmail')}
                  </Button>
                  <Button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      handleSmtpSave(e as any);
                    }}
                    loading={smtpLoading}
                    icon={<Save className="w-4 h-4" />}
                  >
                    {t('settings.smtp.save')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {appTab === 'invoices' && (
          <>
          <Card>
            <CardHeader className="bg-gradient-to-r from-slate-600 to-slate-800 text-white rounded-t-lg">
              <CardTitle className="flex items-center gap-2 text-white">
                <Building2 className="w-5 h-5" />
                {t('settings.invoiceProvider.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 sm:p-8">
              <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">{t('settings.invoiceProvider.subtitle')}</p>
              {invoiceProviderMessage && (
                <div
                  className={`mt-4 p-3 rounded-lg text-sm ${
                    invoiceProviderMessage.type === 'success'
                      ? 'bg-green-50 border border-green-200 text-green-800'
                      : 'bg-red-50 border border-red-200 text-red-800'
                  }`}
                  role="status"
                >
                  {invoiceProviderMessage.text}
                </div>
              )}
              <form onSubmit={handleInvoiceProviderSave} className="mt-6 space-y-6">
                <div className="rounded-xl border border-slate-200/90 bg-slate-50/60 shadow-sm p-4 space-y-3">
                  <span className="text-sm font-semibold text-slate-800">{t('settings.invoiceProvider.activeLabel')}</span>
                  <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={t('settings.invoiceProvider.activeLabel')}>
                    <label className="flex items-center gap-2.5 cursor-pointer rounded-lg border border-transparent px-3 py-2 text-sm text-slate-700 hover:bg-white/80 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 has-[:focus-visible]:ring-offset-1">
                      <input
                        type="radio"
                        name="invoice_provider"
                        className="text-blue-600 focus:ring-blue-500"
                        checked={invoiceProvider === 'zoho'}
                        onChange={() => setInvoiceProvider('zoho')}
                      />
                      {t('settings.invoiceProvider.zoho')}
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer rounded-lg border border-transparent px-3 py-2 text-sm text-slate-700 hover:bg-white/80 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 has-[:focus-visible]:ring-offset-1">
                      <input
                        type="radio"
                        name="invoice_provider"
                        className="text-blue-600 focus:ring-blue-500"
                        checked={invoiceProvider === 'daftra'}
                        onChange={() => setInvoiceProvider('daftra')}
                      />
                      {t('settings.invoiceProvider.daftra')}
                    </label>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  <a
                    href="https://docs.daftara.dev/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium text-blue-700 hover:text-blue-900 hover:underline"
                  >
                    {t('settings.invoiceProvider.docsLink')}
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  </a>
                </p>
                {invoiceProvider === 'daftra' && (
                  <div className="space-y-4 pt-2 border-t border-slate-200">
                    <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm p-4 sm:p-5 space-y-3">
                      <Input
                        label={t('settings.invoiceProvider.daftraSubdomain')}
                        value={daftraForm.subdomain}
                        onChange={(e) => setDaftraForm({ ...daftraForm, subdomain: e.target.value })}
                        placeholder="mycompany"
                      />
                      <p className="text-xs text-slate-500 leading-relaxed">{t('settings.invoiceProvider.daftraSubdomainHint')}</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm p-4 sm:p-5 space-y-2">
                        <Input
                          label={t('settings.invoiceProvider.storeId')}
                          type="number"
                          value={daftraForm.store_id}
                          onChange={(e) => setDaftraForm({ ...daftraForm, store_id: e.target.value })}
                        />
                        <p className="text-xs text-slate-500 leading-relaxed">{t('settings.invoiceProvider.storeIdHint')}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm p-4 sm:p-5 space-y-2">
                        <Input
                          label={t('settings.invoiceProvider.productId')}
                          type="number"
                          value={daftraForm.default_product_id}
                          onChange={(e) => setDaftraForm({ ...daftraForm, default_product_id: e.target.value })}
                        />
                        <p className="text-xs text-slate-500 leading-relaxed">{t('settings.invoiceProvider.productIdHint')}</p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm p-4 sm:p-5 space-y-2">
                      <Input
                        label={t('settings.invoiceProvider.layoutId', 'Invoice Layout ID (optional)')}
                        type="number"
                        value={daftraForm.invoice_layout_id}
                        onChange={(e) => setDaftraForm({ ...daftraForm, invoice_layout_id: e.target.value })}
                      />
                      <p className="text-xs text-slate-500 leading-relaxed">
                        {t(
                          'settings.invoiceProvider.layoutIdHint',
                          'Force a specific Daftra template layout id for all created invoices.'
                        )}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm p-4 sm:p-5 space-y-2">
                      <Input
                        label={t('settings.invoiceProvider.vatPercentage', 'VAT Percentage (%)')}
                        type="number"
                        value={daftraForm.vat_percentage}
                        onChange={(e) => setDaftraForm({ ...daftraForm, vat_percentage: e.target.value })}
                        min="0"
                        max="100"
                        step="0.01"
                      />
                      <p className="text-xs text-slate-500 leading-relaxed">
                        {t('settings.invoiceProvider.vatPercentageHint', 'Default 15 for Saudi invoices. Set 0 to hide VAT row.')}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm p-4 sm:p-5 space-y-2">
                      <Input
                        label={t('settings.invoiceProvider.vatRegistrationNumber', 'VAT registration number (Tax ID)')}
                        value={daftraForm.vat_registration_number}
                        onChange={(e) =>
                          setDaftraForm({ ...daftraForm, vat_registration_number: e.target.value.slice(0, 64) })
                        }
                        maxLength={64}
                        placeholder="305002706700003"
                      />
                      <p className="text-xs text-slate-500 leading-relaxed">
                        {t(
                          'settings.invoiceProvider.vatRegistrationNumberHint',
                          'Shown on Daftra invoices (e.g. Saudi ZATCA: 15 digits). Leave empty if not applicable.'
                        )}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm p-4 sm:p-5 space-y-3">
                      <Input
                        label={t('settings.invoiceProvider.apiToken')}
                        type="password"
                        value={daftraForm.api_token}
                        onChange={(e) => setDaftraForm({ ...daftraForm, api_token: e.target.value })}
                        placeholder={daftraTokenSet ? '••••••••' : ''}
                      />
                      <p className="text-xs text-slate-500 leading-relaxed">{t('settings.invoiceProvider.apiTokenHint')}</p>
                      {daftraTokenSet && (
                        <p className="text-xs text-emerald-700 font-medium">{t('settings.invoiceProvider.tokenOnFile')}</p>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:items-end">
                        <Input
                          label={t('settings.invoiceProvider.countryCode')}
                          value={daftraForm.country_code}
                          onChange={(e) => setDaftraForm({ ...daftraForm, country_code: e.target.value })}
                          maxLength={3}
                        />
                        <label className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-3 md:mb-0.5">
                          <input
                            type="checkbox"
                            className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={daftraForm.fallback_to_zoho}
                            onChange={(e) => setDaftraForm({ ...daftraForm, fallback_to_zoho: e.target.checked })}
                          />
                          <span>{t('settings.invoiceProvider.fallbackZoho')}</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
                <Button type="submit" loading={invoiceProviderLoading} icon={<Save className="w-4 h-4" />}>
                  {t('settings.invoiceProvider.save')}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-700 text-white rounded-t-lg shadow-sm">
              <CardTitle className="flex items-center gap-2 text-white text-lg font-semibold tracking-tight">
                <FileText className="w-5 h-5 shrink-0 opacity-95" />
                {t('settings.zoho.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 sm:p-8">
              <div className="space-y-6">
                {zohoMessage && (
                  <div
                    className={`p-3.5 rounded-xl text-sm flex items-start gap-2.5 whitespace-pre-line shadow-sm ${
                      zohoMessage.type === 'success'
                        ? 'bg-emerald-50 border border-emerald-200/80 text-emerald-900'
                        : zohoMessage.type === 'info'
                        ? 'bg-sky-50 border border-sky-200/80 text-sky-900'
                        : 'bg-red-50 border border-red-200/80 text-red-900'
                    }`}
                    role="status"
                  >
                    {zohoMessage.type === 'success' ? (
                      <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                    ) : zohoMessage.type === 'info' ? (
                      <MessageCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                    ) : (
                      <XCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                    )}
                    {zohoMessage.text}
                  </div>
                )}

                {/* Connection Status */}
                {zohoStatus && (
                  <div className="p-4 sm:p-5 bg-slate-50/90 rounded-xl border border-slate-200/90 shadow-sm">
                    <h3 className="text-sm font-semibold text-slate-800 mb-3">{t('settings.zoho.connectionStatus')}</h3>
                    <div className="space-y-2 text-sm text-slate-700">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-slate-600">{t('settings.zoho.configuration')}:</span>
                        {zohoStatus.has_config ? (
                          <span className="text-emerald-700 font-medium">{t('settings.zoho.savedStatus')}</span>
                        ) : (
                          <span className="text-slate-400">{t('settings.zoho.notConfigured')}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-slate-600">{t('settings.zoho.zohoAccount')}:</span>
                        {zohoStatus.connection_status === 'connected' ? (
                          <span className="text-emerald-700 font-medium">{t('settings.zoho.connectedStatus')}</span>
                        ) : zohoStatus.connection_status === 'expired' ? (
                          <span className="text-amber-700 font-medium">{t('settings.zoho.expiredStatus')}</span>
                        ) : (
                          <span className="text-slate-400">{t('settings.zoho.notConnectedStatus')}</span>
                        )}
                      </div>
                      {zohoStatus.token_expires_at && (
                        <div className={`text-xs mt-1 ${
                          zohoStatus.connection_status === 'expired' 
                            ? 'text-amber-800 font-medium' 
                            : 'text-slate-500'
                        }`}>
                          {zohoStatus.connection_status === 'expired' ? (
                            <>{t('settings.zoho.tokenExpired')} {new Date(zohoStatus.token_expires_at).toLocaleString()}</>
                          ) : (
                            <>{t('settings.zoho.tokenExpires')} {new Date(zohoStatus.token_expires_at).toLocaleString()}</>
                          )}
                        </div>
                      )}
                      {zohoStatus.connection_status === 'expired' && (
                        <div className="mt-2 p-3 bg-amber-50 border border-amber-200/90 rounded-lg text-xs text-amber-950 leading-relaxed">
                          <strong className="font-semibold">{t('settings.zoho.tokenExpired')}:</strong>{' '}
                          {t('settings.zoho.tokenExpiredMessage')}
                        </div>
                      )}
                      {zohoStatus.has_config && zohoStatus.connection_status !== 'connected' && (
                        <div className="mt-2 p-3 bg-sky-50 border border-sky-200/90 rounded-lg text-xs text-sky-950 leading-relaxed">
                          {t('settings.zoho.connectHintWhenSaved')}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/90 via-white to-violet-50/50 p-4 sm:p-5 shadow-sm">
                  <h4 className="text-sm font-semibold text-indigo-950 mb-2">{t('settings.zoho.setupInstructions')}</h4>
                  <ol className="text-xs text-indigo-900/90 space-y-1.5 list-decimal list-inside leading-relaxed">
                    <li>
                      {t('settings.zoho.setupStep1')}{' '}
                      <a
                        href="https://api-console.zoho.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900"
                      >
                        Zoho Developer Console
                      </a>
                    </li>
                    <li>{t('settings.zoho.setupStep2')}</li>
                    <li>
                      <strong>{t('common.info')}:</strong> {t('settings.zoho.setupStep3')}{' '}
                      <code className="bg-indigo-100/80 px-1.5 py-0.5 rounded text-[0.8rem] font-mono text-indigo-950">
                        {zohoSettings.redirect_uri || `${window.location.origin}/api/zoho/callback`}
                      </code>
                    </li>
                    <li>{t('settings.zoho.setupStep4')}</li>
                    <li><strong>{t('common.info')}:</strong> {t('settings.zoho.setupStep5')}</li>
                    <li>{t('settings.zoho.setupStep6')}</li>
                    <li>{t('settings.zoho.setupStep7')}</li>
                  </ol>
                </div>

                <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm p-4 sm:p-5 space-y-2">
                  <label className="block text-sm font-semibold text-slate-800">
                    {t('settings.zoho.clientId')}
                  </label>
                  <Input
                    type="text"
                    value={zohoSettings.client_id}
                    onChange={(e) => setZohoSettings({ ...zohoSettings, client_id: e.target.value })}
                    placeholder={t('settings.zoho.clientIdPlaceholder')}
                    required
                  />
                  <p className="text-xs text-slate-500 leading-relaxed">{t('settings.zoho.clientIdHint')}</p>
                </div>

                <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm p-4 sm:p-5 space-y-2">
                  <label className="block text-sm font-semibold text-slate-800">
                    {t('settings.zoho.clientSecret')}
                  </label>
                  <div className="relative">
                    <Input
                      type={showZohoSecret ? 'text' : 'password'}
                      value={zohoSettings.client_secret}
                      onChange={(e) => setZohoSettings({ ...zohoSettings, client_secret: e.target.value })}
                      placeholder={t('settings.zoho.clientSecretPlaceholder')}
                      required
                      className={isRtl ? 'pl-10' : 'pr-10'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowZohoSecret(!showZohoSecret)}
                      className={`absolute top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 ${isRtl ? 'left-3' : 'right-3'}`}
                    >
                      {showZohoSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{t('settings.zoho.clientSecretHint')}</p>
                </div>

                <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm p-4 sm:p-5 space-y-2">
                  <label className="block text-sm font-semibold text-slate-800">
                    {t('settings.zoho.redirectUriRequired')}
                  </label>
                  <Input
                    type="text"
                    value={zohoSettings.redirect_uri}
                    onChange={(e) => setZohoSettings({ ...zohoSettings, redirect_uri: e.target.value })}
                    placeholder={t('settings.zoho.redirectUriPlaceholder', { origin: window.location.origin })}
                    required
                  />
                  <p className="text-xs text-slate-500 leading-relaxed">
                    <strong className="text-slate-700">{t('settings.zoho.redirectUriMustMatch')}</strong>{' '}
                    {t('settings.zoho.redirectUriDefault')}{' '}
                    <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[0.8rem] font-mono text-slate-800">
                      {window.location.origin}/api/zoho/callback
                    </code>
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const defaultUri = `${window.location.origin}/api/zoho/callback`;
                      setZohoSettings({ ...zohoSettings, redirect_uri: defaultUri });
                    }}
                    className="text-xs font-medium text-indigo-700 hover:text-indigo-900 underline decoration-indigo-300 underline-offset-2"
                  >
                    {t('settings.zoho.useDefault')} {window.location.origin}/api/zoho/callback
                  </button>
                  <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200/90">
                    <p className="text-xs font-semibold text-slate-800 mb-1.5">{t('settings.zoho.redirectUriThatWillBeUsed')}</p>
                    <code className="text-xs font-mono text-slate-900 break-all block">
                      {zohoSettings.redirect_uri || `${window.location.origin}/api/zoho/callback`}
                    </code>
                    <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                      {t('settings.zoho.copyExactUri')}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm p-4 sm:p-5 space-y-2">
                    <label className="block text-sm font-semibold text-slate-800">
                      {t('settings.zoho.regionLabel')}
                    </label>
                    <select
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      value={zohoSettings.region}
                      onChange={(e) => setZohoSettings({ ...zohoSettings, region: e.target.value })}
                    >
                      <option value="com">{t('settings.zoho.regionCom')}</option>
                      <option value="eu">{t('settings.zoho.regionEu')}</option>
                      <option value="in">{t('settings.zoho.regionIn')}</option>
                      <option value="au">{t('settings.zoho.regionAu')}</option>
                      <option value="jp">{t('settings.zoho.regionJp')}</option>
                    </select>
                    <p className="text-xs text-slate-500 leading-relaxed">{t('settings.zoho.regionHint')}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm p-4 sm:p-5 space-y-2">
                    <label className="block text-sm font-semibold text-slate-800">
                      {t('settings.zoho.organizationIdLabel', 'Zoho Organization ID')}
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="e.g. 123456789"
                      value={zohoSettings.zoho_organization_id ?? ''}
                      onChange={(e) => setZohoSettings({ ...zohoSettings, zoho_organization_id: e.target.value })}
                    />
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {t('settings.zoho.organizationIdHint', 'Required for recording payments (package/booking invoices). Find it in Zoho Invoice → Settings → Organization Profile.')}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-4 mt-1 border-t border-slate-200/80">
                  {zohoStatus?.connection_status === 'connected' && (
                    <Button
                      type="button"
                      onClick={handleZohoDisconnect}
                      variant="secondary"
                      icon={<XCircle className="w-4 h-4" />}
                    >
                      {t('settings.zoho.disconnect')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={handleZohoConnect}
                    variant="secondary"
                    icon={<ExternalLink className="w-4 h-4" />}
                    disabled={!zohoSettings.client_id || !zohoSettings.client_secret}
                  >
                    {zohoStatus?.connection_status === 'expired' || zohoStatus?.connection_status === 'not_connected' 
                      ? t('settings.zoho.reconnect')
                      : t('settings.zoho.connect')}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleZohoTest}
                    loading={zohoTestLoading}
                    variant="secondary"
                    icon={<CheckCircle className="w-4 h-4" />}
                  >
                    {t('settings.zoho.testConnection')}
                  </Button>
                  <Button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      handleZohoSave(e as any);
                    }}
                    loading={zohoLoading}
                    icon={<Save className="w-4 h-4" />}
                  >
                    {t('settings.zoho.save')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
          </>
        )}
          </section>
        )}
      </div>
    </div>
  );
}
