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
        // If we have tenant slug but no tenant in context, fetch it
        try {
          // First try to get tenant with default_country_code
          const { data, error } = await db
            .from('tenants')
            .select('id, default_country_code')
            .eq('slug', tenantSlug)
            .maybeSingle();
          
          // Check if error indicates missing column (PostgreSQL error code 42703 = undefined column)
          // The API returns error with code property when column doesn't exist
          // Also check for 400 status which indicates client error (missing column)
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
              console.warn('[useTenantDefaultCountry] default_country_code column does not exist yet, trying id only');
              hasCheckedColumnRef.current = true;
            }
            // Try to get just the tenant ID without default_country_code
            // This should work even if default_country_code column doesn't exist
            try {
              const { data: tenantData, error: fallbackError } = await db
                .from('tenants')
                .select('id')
                .eq('slug', tenantSlug)
                .maybeSingle();
              
              // Check if fallback also failed due to missing column (shouldn't happen for 'id')
              const isFallbackColumnError = fallbackError && (
                fallbackError.code === '42703' || 
                (fallbackError as any).code === '42703' ||
                fallbackError.message?.includes('column') ||
                fallbackError.message?.includes('does not exist')
              );
              
              if (isFallbackColumnError) {
                console.warn('[useTenantDefaultCountry] Even id column query failed, column may not exist');
                return; // Use default '+966'
              }
              
              if (fallbackError) {
                console.warn('[useTenantDefaultCountry] Could not fetch tenant ID:', fallbackError);
                return; // Use default '+966'
              }
              
              if (tenantData?.id) {
                tenantId = tenantData.id;
                // Continue to use default '+966' since default_country_code doesn't exist
              }
            } catch (fallbackErr: any) {
              // Check if this is a column error
              const isFallbackColumnError = fallbackErr?.code === '42703' || 
                (fallbackErr as any).code === '42703' ||
                fallbackErr?.message?.includes('column') ||
                fallbackErr?.message?.includes('does not exist');
              
              if (isFallbackColumnError) {
                console.warn('[useTenantDefaultCountry] Column does not exist, using default +966');
              } else {
                console.warn('[useTenantDefaultCountry] Could not fetch tenant ID:', fallbackErr);
              }
            }
            return; // Use default '+966'
          }
          
          // Success - column exists
          if (!error && data) {
            columnExistsCache = true;
            hasCheckedColumnRef.current = true;
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
          console.error('[useTenantDefaultCountry] Error fetching tenant:', err);
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
