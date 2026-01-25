import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/db';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Settings, Save, Building2, Lock, Eye, EyeOff, Mail, CheckCircle, XCircle, MessageCircle, FileText, ExternalLink, DollarSign } from 'lucide-react';

import { getApiUrl } from '../../lib/apiUrl';
import { createTimeoutSignal } from '../../lib/requestTimeout';
import { useCurrency } from '../../contexts/CurrencyContext';
import { getAvailableCurrencies } from '../../lib/currency';

export function SettingsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { userProfile, tenant, user, signOut, loading: authLoading } = useAuth();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [loading, setLoading] = useState(false);
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
  // Initialize formData with undefined for tickets_enabled to prevent false default
  // This ensures we wait for actual tenant data before setting the checkbox state
  const [formData, setFormData] = useState<{
    name: string;
    name_ar: string;
    contact_email: string;
    tenant_time_zone: string;
    maintenance_mode: boolean;
    tickets_enabled: boolean | undefined; // undefined until tenant data loads
  }>({
    name: '',
    name_ar: '',
    contact_email: '',
    tenant_time_zone: 'Asia/Riyadh',
    maintenance_mode: false,
    tickets_enabled: undefined, // undefined = not loaded yet, prevents false default
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

  // Currency settings state
  const { currencyCode: currentCurrencyCode, refreshCurrency } = useCurrency();
  const [selectedCurrencyCode, setSelectedCurrencyCode] = useState<string>('SAR');
  const [currencyLoading, setCurrencyLoading] = useState(false);
  const [currencyMessage, setCurrencyMessage] = useState<{ type: 'success' | 'error'; text: string; warning?: string } | null>(null);

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
      // CRITICAL: Only set tickets_enabled from tenant data, no default fallback
      // If tickets_enabled is undefined, it means the field doesn't exist (migration not run)
      // In that case, default to true for backward compatibility, but only if undefined
      const ticketsEnabled = tenant.tickets_enabled !== undefined 
        ? tenant.tickets_enabled 
        : true; // Default to true only if field doesn't exist (backward compatibility)
      
      setFormData({
        name: tenant.name || '',
        name_ar: tenant.name_ar || '',
        contact_email: tenant.contact_email || '',
        tenant_time_zone: tenant.tenant_time_zone || 'Asia/Riyadh',
        maintenance_mode: tenant.maintenance_mode || false,
        tickets_enabled: ticketsEnabled,
      });
    }
  }, [tenant]);

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

    if (!confirm(t('settings.zoho.disconnectConfirm') || 'Are you sure you want to disconnect Zoho integration? This will remove all stored tokens.')) {
      return;
    }

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
      // CRITICAL: Ensure tickets_enabled is a boolean, not undefined
      const ticketsEnabledValue = formData.tickets_enabled !== undefined 
        ? formData.tickets_enabled 
        : true; // Default to true if somehow undefined (shouldn't happen)

      const { error } = await db
        .from('tenants')
        .update({
          name: formData.name,
          name_ar: formData.name_ar,
          contact_email: formData.contact_email,
          tenant_time_zone: formData.tenant_time_zone,
          maintenance_mode: formData.maintenance_mode,
          tickets_enabled: ticketsEnabledValue,
        })
        .eq('id', tenant.id);

      if (error) throw error;

      // CRITICAL: Refresh tenant data from database to ensure UI is in sync
      // This ensures the checkbox reflects the actual persisted value after save
      const { data: refreshedTenant } = await db
        .from('tenants')
        .select('tickets_enabled')
        .eq('id', tenant.id)
        .single();
      
      if (refreshedTenant) {
        // Update formData with the actual persisted value from database
        setFormData(prev => ({
          ...prev,
          tickets_enabled: refreshedTenant.tickets_enabled !== undefined 
            ? refreshedTenant.tickets_enabled 
            : true // Fallback only if field doesn't exist (backward compatibility)
        }));
      }

      alert(t('settings.settingsSavedSuccessfully'));
    } catch (err) {
      console.error('Error saving settings:', err);
      alert(t('settings.errorSavingSettings'));
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

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('navigation.settings')}</h1>
        <p className="text-sm md:text-base text-gray-600 mt-1">{t('settings.manageSettings')}</p>
      </div>

      <div className="max-w-3xl">
        <div className="space-y-6">
          {/* Business Information Form */}
          <form onSubmit={handleSubmit}>
          <Card className="shadow-lg">
            <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50">
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
                placeholder={t('tenant.businessNameEnglish')}
              />

              <Input
                label={t('tenant.businessNameArabic')}
                value={formData.name_ar || ''}
                onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                dir="rtl"
                placeholder="أدخل اسم العمل بالعربية"
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                {t('tenant.operationalSettings')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.maintenance_mode}
                  onChange={(e) => setFormData({ ...formData, maintenance_mode: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">{t('tenant.maintenanceMode')}</span>
                  <p className="text-xs text-gray-500">{t('tenant.disablePublicBookings')}</p>
                </div>
              </label>
              
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.tickets_enabled === true} // Only checked if explicitly true
                  onChange={(e) => setFormData({ ...formData, tickets_enabled: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  disabled={formData.tickets_enabled === undefined} // Disable until loaded
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">Enable Tickets</span>
                  <p className="text-xs text-gray-500">
                    {formData.tickets_enabled === undefined 
                      ? 'Loading...' 
                      : 'When disabled, ticket generation and functionality will be completely inactive across the entire system'}
                  </p>
                </div>
              </label>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3 pt-4">
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
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
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
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
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
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
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

          {/* Currency Settings - Only for Tenant Provider */}
          {userProfile?.role === 'tenant_admin' && (
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
          )}

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
                    />
                    <button
                      type="button"
                      onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
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
                        />
                        <button
                          type="button"
                          onClick={() => setShowWhatsappToken(!showWhatsappToken)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
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
                        />
                        <button
                          type="button"
                          onClick={() => setShowWhatsappToken(!showWhatsappToken)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
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
                        />
                        <button
                          type="button"
                          onClick={() => setShowWhatsappToken(!showWhatsappToken)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
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

          <Card>
            <CardHeader className="bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-t-lg">
              <CardTitle className="flex items-center gap-2 text-white">
                <FileText className="w-5 h-5" />
                {t('settings.zoho.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                {zohoMessage && (
                  <div className={`p-3 rounded-lg text-sm flex items-center gap-2 whitespace-pre-line ${
                    zohoMessage.type === 'success'
                      ? 'bg-green-50 border border-green-200 text-green-700'
                      : zohoMessage.type === 'info'
                      ? 'bg-blue-50 border border-blue-200 text-blue-700'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}>
                    {zohoMessage.type === 'success' ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : zohoMessage.type === 'info' ? (
                      <MessageCircle className="w-4 h-4" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                    {zohoMessage.text}
                  </div>
                )}

                {/* Connection Status */}
                {zohoStatus && (
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('settings.zoho.connectionStatus')}</h3>
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-600">{t('settings.zoho.configuration')}:</span>
                        {zohoStatus.has_config ? (
                          <span className="text-green-600 font-medium">{t('settings.zoho.savedStatus')}</span>
                        ) : (
                          <span className="text-gray-400">{t('settings.zoho.notConfigured')}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-600">{t('settings.zoho.zohoAccount')}:</span>
                        {zohoStatus.connection_status === 'connected' ? (
                          <span className="text-green-600 font-medium">{t('settings.zoho.connectedStatus')}</span>
                        ) : zohoStatus.connection_status === 'expired' ? (
                          <span className="text-yellow-600 font-medium">{t('settings.zoho.expiredStatus')}</span>
                        ) : (
                          <span className="text-gray-400">{t('settings.zoho.notConnectedStatus')}</span>
                        )}
                      </div>
                      {zohoStatus.token_expires_at && (
                        <div className={`text-xs mt-2 ${
                          zohoStatus.connection_status === 'expired' 
                            ? 'text-yellow-600 font-medium' 
                            : 'text-gray-500'
                        }`}>
                          {zohoStatus.connection_status === 'expired' ? (
                            <>{t('settings.zoho.tokenExpired')} {new Date(zohoStatus.token_expires_at).toLocaleString()}</>
                          ) : (
                            <>{t('settings.zoho.tokenExpires')} {new Date(zohoStatus.token_expires_at).toLocaleString()}</>
                          )}
                        </div>
                      )}
                      {zohoStatus.connection_status === 'expired' && (
                        <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                          <strong>{t('settings.zoho.tokenExpired')}:</strong> {t('settings.zoho.tokenExpiredMessage')}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-blue-900 mb-2">{t('settings.zoho.setupInstructions')}</h4>
                  <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside">
                    <li>{t('settings.zoho.setupStep1')} <a href="https://api-console.zoho.com/" target="_blank" rel="noopener noreferrer" className="underline">Zoho Developer Console</a></li>
                    <li>{t('settings.zoho.setupStep2')}</li>
                    <li><strong>{t('common.info')}:</strong> {t('settings.zoho.setupStep3')} <code className="bg-blue-100 px-1 rounded font-mono">{zohoSettings.redirect_uri || `${window.location.origin}/api/zoho/callback`}</code></li>
                    <li>{t('settings.zoho.setupStep4')}</li>
                    <li><strong>{t('common.info')}:</strong> {t('settings.zoho.setupStep5')}</li>
                    <li>{t('settings.zoho.setupStep6')}</li>
                    <li>{t('settings.zoho.setupStep7')}</li>
                  </ol>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    {t('settings.zoho.clientId')}
                  </label>
                  <Input
                    type="text"
                    value={zohoSettings.client_id}
                    onChange={(e) => setZohoSettings({ ...zohoSettings, client_id: e.target.value })}
                    placeholder={t('settings.zoho.clientIdPlaceholder')}
                    required
                  />
                  <p className="text-xs text-gray-500">{t('settings.zoho.clientIdHint')}</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    {t('settings.zoho.clientSecret')}
                  </label>
                  <div className="relative">
                    <Input
                      type={showZohoSecret ? 'text' : 'password'}
                      value={zohoSettings.client_secret}
                      onChange={(e) => setZohoSettings({ ...zohoSettings, client_secret: e.target.value })}
                      placeholder={t('settings.zoho.clientSecretPlaceholder')}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowZohoSecret(!showZohoSecret)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    >
                      {showZohoSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">{t('settings.zoho.clientSecretHint')}</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    {t('settings.zoho.redirectUriRequired')}
                  </label>
                  <Input
                    type="text"
                    value={zohoSettings.redirect_uri}
                    onChange={(e) => setZohoSettings({ ...zohoSettings, redirect_uri: e.target.value })}
                    placeholder={t('settings.zoho.redirectUriPlaceholder', { origin: window.location.origin })}
                    required
                  />
                  <p className="text-xs text-gray-500">
                    <strong>{t('settings.zoho.redirectUriMustMatch')}</strong>
                    {t('settings.zoho.redirectUriDefault')} <code className="bg-gray-100 px-1 rounded font-mono">{window.location.origin}/api/zoho/callback</code>
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const defaultUri = `${window.location.origin}/api/zoho/callback`;
                      setZohoSettings({ ...zohoSettings, redirect_uri: defaultUri });
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    {t('settings.zoho.useDefault')} {window.location.origin}/api/zoho/callback
                  </button>
                  <div className="mt-2 p-2 bg-gray-100 rounded border border-gray-300">
                    <p className="text-xs font-semibold text-gray-700 mb-1">{t('settings.zoho.redirectUriThatWillBeUsed')}</p>
                    <code className="text-xs font-mono text-gray-800 break-all">
                      {zohoSettings.redirect_uri || `${window.location.origin}/api/zoho/callback`}
                    </code>
                    <p className="text-xs text-gray-600 mt-1">
                      {t('settings.zoho.copyExactUri')}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
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
                  <p className="text-xs text-gray-500">{t('settings.zoho.regionHint')}</p>
                </div>

                <div className="flex gap-3 pt-2">
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
        </div>
      </div>
    </div>
  );
}
