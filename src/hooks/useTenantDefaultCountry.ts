import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/db';
import { useParams } from 'react-router-dom';

// Module-level flag to track if we've determined the column doesn't exist
// This prevents repeated queries that will fail
let columnExistsCache: boolean | null = null;

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
  const hasCheckedColumnRef = useRef(false);

  useEffect(() => {
    async function fetchDefaultCountryCode() {
      let tenantId: string | null = null;

      // Try to get tenant ID from auth context first
      if (tenant?.id) {
        tenantId = tenant.id;
      } else if (tenantSlug) {
        // Fetch tenant by slug using only 'id' so we never request missing default_country_code (avoids 42703)
        try {
          const { data: slugData, error: slugError } = await db
            .from('tenants')
            .select('id')
            .eq('slug', tenantSlug)
            .maybeSingle();

          if (slugError) {
            console.warn('[useTenantDefaultCountry] Error fetching tenant by slug:', slugError);
            return;
          }
          if (slugData?.id) {
            tenantId = slugData.id;
          }
          // Then try to fetch default_country_code in a separate query (column may not exist yet)
          if (tenantId && (columnExistsCache === null || columnExistsCache === true)) {
            const { data: codeData, error: codeError } = await db
              .from('tenants')
              .select('default_country_code')
              .eq('id', tenantId)
              .maybeSingle();

            const isMissingColumn = codeError && (
              codeError.code === '42703' || (codeError as any)?.code === 42703 ||
              String(codeError.message || '').toLowerCase().includes('column') ||
              String(codeError.message || '').toLowerCase().includes('does not exist')
            );
            if (isMissingColumn) {
              columnExistsCache = false;
              if (!hasCheckedColumnRef.current) {
                hasCheckedColumnRef.current = true;
              }
              return; // Use default '+966'
            }
            if (!codeError && codeData?.default_country_code) {
              columnExistsCache = true;
              hasCheckedColumnRef.current = true;
              setDefaultCountryCode(codeData.default_country_code);
            }
          }
        } catch (err: any) {
          console.warn('[useTenantDefaultCountry] Error fetching tenant:', err);
        }
      }

      // If we have tenant ID from auth context, fetch default_country_code
      if (tenantId && tenant?.id === tenantId) {
        // If tenant object already has default_country_code, use it
        if ((tenant as any).default_country_code) {
          setDefaultCountryCode((tenant as any).default_country_code);
          columnExistsCache = true; // Column exists if we got it from tenant object
          return;
        }

        // Skip query if we've already determined the column doesn't exist
        if (columnExistsCache === false) {
          return; // Use default '+966'
        }

        // Only query if we haven't checked yet or if we know the column exists
        if (columnExistsCache === null || columnExistsCache === true) {
          try {
            const { data, error } = await db
              .from('tenants')
              .select('default_country_code')
              .eq('id', tenantId)
              .maybeSingle();
            
            // Check if error indicates missing column (PostgreSQL error code 42703 = undefined column)
            const errorMessage = String(error?.message || '');
            const errorCode = error?.code || (error as any)?.code;
            const isMissingColumnError = error && (
              errorCode === '42703' || 
              errorCode === 42703 ||
              errorMessage.toLowerCase().includes('column') || 
              errorMessage.toLowerCase().includes('does not exist') || 
              errorMessage.toLowerCase().includes('invalid column name') ||
              errorMessage.toLowerCase().includes('column not found') ||
              errorMessage.toLowerCase().includes('invalid column') ||
              (error as any)?.status === 400 && errorMessage.toLowerCase().includes('column')
            );
            
            if (isMissingColumnError) {
              columnExistsCache = false; // Remember that column doesn't exist
              // Don't log warning on every render, only once
              if (!hasCheckedColumnRef.current) {
                console.warn('[useTenantDefaultCountry] default_country_code column does not exist yet, using default +966');
                hasCheckedColumnRef.current = true;
              }
              return; // Use default '+966'
            }
            
            if (error) {
              console.error('[useTenantDefaultCountry] Error fetching default country code:', error);
              return; // Use default '+966'
            }
            
            // Success - column exists
            columnExistsCache = true;
            hasCheckedColumnRef.current = true;
            
            if (data?.default_country_code) {
              setDefaultCountryCode(data.default_country_code);
            }
          } catch (err: any) {
            // Handle missing column in catch block too
            const errMessage = String(err?.message || '');
            const errCode = err?.code || (err as any)?.code;
            const isMissingColumnError = errCode === '42703' || 
                errCode === 42703 ||
                errMessage.toLowerCase().includes('column') || 
                errMessage.toLowerCase().includes('does not exist') || 
                errMessage.toLowerCase().includes('invalid column name') ||
                errMessage.toLowerCase().includes('column not found') ||
                errMessage.toLowerCase().includes('invalid column') ||
                (err as any)?.status === 400 && errMessage.toLowerCase().includes('column');
                
            if (isMissingColumnError) {
              columnExistsCache = false; // Remember that column doesn't exist
              // Don't log warning on every render, only once
              if (!hasCheckedColumnRef.current) {
                console.warn('[useTenantDefaultCountry] default_country_code column does not exist yet, using default +966');
                hasCheckedColumnRef.current = true;
              }
              return; // Use default '+966'
            }
            console.error('[useTenantDefaultCountry] Error fetching default country code:', err);
          }
        }
      }
    }

    fetchDefaultCountryCode();
  }, [tenant, tenantSlug]);

  return defaultCountryCode;
}
