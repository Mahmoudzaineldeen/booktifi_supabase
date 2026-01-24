import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/db';
import { useParams } from 'react-router-dom';

/**
 * Hook to get the default country code for the current tenant
 * Falls back to '+966' if tenant is not found or default_country_code is not set
 * 
 * @returns The default country code (e.g., '+966', '+971')
 */
export function useTenantDefaultCountry(): string {
  const { tenant } = useAuth();
  const { tenantSlug } = useParams<{ tenantSlug?: string }>();
  const [defaultCountryCode, setDefaultCountryCode] = useState<string>('+966');

  useEffect(() => {
    async function fetchDefaultCountryCode() {
      let tenantId: string | null = null;

      // Try to get tenant ID from auth context first
      if (tenant?.id) {
        tenantId = tenant.id;
      } else if (tenantSlug) {
        // If we have tenant slug but no tenant in context, fetch it
        try {
          // First try to get tenant with default_country_code
          const { data, error } = await db
            .from('tenants')
            .select('id, default_country_code')
            .eq('slug', tenantSlug)
            .maybeSingle();
          
          // Handle missing column gracefully (PostgreSQL error code 42703 = undefined column)
          // Also handle 400 errors from API that indicate missing column
          if (error && (
            error.code === '42703' || 
            error.message?.includes('column') || 
            error.message?.includes('does not exist') ||
            error.message?.includes('Invalid column name') ||
            (error as any).status === 400 ||
            String(error.message || '').includes('Invalid column name')
          )) {
            console.warn('[useTenantDefaultCountry] default_country_code column does not exist yet, trying id only');
            // Try to get just the tenant ID without default_country_code
            try {
              const { data: tenantData } = await db
                .from('tenants')
                .select('id')
                .eq('slug', tenantSlug)
                .maybeSingle();
              if (tenantData?.id) {
                tenantId = tenantData.id;
              }
            } catch (fallbackErr) {
              console.warn('[useTenantDefaultCountry] Could not fetch tenant ID:', fallbackErr);
            }
            return; // Use default '+966'
          }
          
          if (error) {
            console.error('[useTenantDefaultCountry] Error fetching tenant:', error);
            return; // Use default '+966'
          }
          
          if (data) {
            tenantId = data.id;
            if (data.default_country_code) {
              setDefaultCountryCode(data.default_country_code);
              return;
            }
          }
        } catch (err: any) {
          // Handle missing column in catch block too
          // Also handle 400 errors from API that indicate missing column
          if (err?.code === '42703' || 
              err?.message?.includes('column') || 
              err?.message?.includes('does not exist') ||
              err?.message?.includes('Invalid column name') ||
              err?.status === 400 ||
              String(err?.message || '').includes('Invalid column name')) {
            console.warn('[useTenantDefaultCountry] default_country_code column does not exist yet, using default +966');
            return; // Use default '+966'
          }
          console.error('[useTenantDefaultCountry] Error fetching tenant:', err);
        }
      }

      // If we have tenant ID from auth context, fetch default_country_code
      if (tenantId && tenant?.id === tenantId) {
        // If tenant object already has default_country_code, use it
        // Otherwise, fetch it
        if ((tenant as any).default_country_code) {
          setDefaultCountryCode((tenant as any).default_country_code);
          return;
        }

        try {
          const { data, error } = await db
            .from('tenants')
            .select('default_country_code')
            .eq('id', tenantId)
            .maybeSingle();
          
          // Handle missing column gracefully
          // Also handle 400 errors from API that indicate missing column
          if (error && (
            error.code === '42703' || 
            error.message?.includes('column') || 
            error.message?.includes('does not exist') || 
            error.message?.includes('Invalid column name') ||
            (error as any).status === 400
          )) {
            console.warn('[useTenantDefaultCountry] default_country_code column does not exist yet, using default +966');
            return; // Use default '+966'
          }
          
          if (error) {
            console.error('[useTenantDefaultCountry] Error fetching default country code:', error);
            return; // Use default '+966'
          }
          
          if (data?.default_country_code) {
            setDefaultCountryCode(data.default_country_code);
          }
        } catch (err: any) {
          // Handle missing column in catch block too
          // Also handle 400 errors from API that indicate missing column
          if (err?.code === '42703' || 
              err?.message?.includes('column') || 
              err?.message?.includes('does not exist') || 
              err?.message?.includes('Invalid column name') ||
              err?.status === 400) {
            console.warn('[useTenantDefaultCountry] default_country_code column does not exist yet, using default +966');
            return; // Use default '+966'
          }
          console.error('[useTenantDefaultCountry] Error fetching default country code:', err);
        }
      }
    }

    fetchDefaultCountryCode();
  }, [tenant, tenantSlug]);

  return defaultCountryCode;
}
