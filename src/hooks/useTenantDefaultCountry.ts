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
          const { data } = await db
            .from('tenants')
            .select('id, default_country_code')
            .eq('slug', tenantSlug)
            .maybeSingle();
          
          if (data) {
            tenantId = data.id;
            if (data.default_country_code) {
              setDefaultCountryCode(data.default_country_code);
              return;
            }
          }
        } catch (err) {
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
          const { data } = await db
            .from('tenants')
            .select('default_country_code')
            .eq('id', tenantId)
            .maybeSingle();
          
          if (data?.default_country_code) {
            setDefaultCountryCode(data.default_country_code);
          }
        } catch (err) {
          console.error('[useTenantDefaultCountry] Error fetching default country code:', err);
        }
      }
    }

    fetchDefaultCountryCode();
  }, [tenant, tenantSlug]);

  return defaultCountryCode;
}
