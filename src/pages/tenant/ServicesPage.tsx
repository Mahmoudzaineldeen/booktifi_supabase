import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { useTenantFeatures } from '../../hooks/useTenantFeatures';
import { db } from '../../lib/db';
import { getApiUrl } from '../../lib/apiUrl';
import { apiFetch, getAuthHeaders } from '../../lib/apiClient';
import { showNotification } from '../../contexts/NotificationContext';
import { showConfirm } from '../../contexts/ConfirmContext';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Plus, Edit, Trash2, Briefcase, FolderOpen, Clock, X, Upload, Gift, Search } from 'lucide-react';
import { formatTimeTo12Hour } from '../../lib/timeFormat';
import heic2any from 'heic2any';

interface Category {
  id: string;
  name: string;
  name_ar: string;
  description?: string;
  description_ar?: string;
}

interface Service {
  id: string;
  name: string;
  name_ar: string;
  description: string;
  description_ar: string;
  duration_minutes: number;
  base_price: number;
  original_price?: number | null;
  discount_percentage?: number | null;
  capacity_per_slot: number;
  is_public: boolean;
  is_active: boolean;
  category_id: string | null;
  service_categories?: Category;
  capacity_mode?: 'employee_based' | 'service_based';
  service_duration_minutes?: number;
  service_capacity_per_slot?: number | null;
  scheduling_type?: 'slot_based' | 'employee_based';
  assignment_mode?: 'auto_assign' | 'manual_assign' | null;
}

interface Shift {
  id: string;
  service_id: string;
  days_of_week: number[];
  start_time_utc: string;
  end_time_utc: string;
  is_active: boolean;
}

export function ServicesPage() {
  const { t, i18n } = useTranslation();
  const { userProfile } = useAuth();
  const { features: tenantFeatures } = useTenantFeatures(userProfile?.tenant_id);
  const { formatPrice, formatPriceString } = useCurrency();
  const globalSchedulingMode = tenantFeatures?.scheduling_mode ?? 'service_slot_based';
  const hideServiceSlots = globalSchedulingMode === 'employee_based';
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isOffersModalOpen, setIsOffersModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [selectedServiceForSchedule, setSelectedServiceForSchedule] = useState<Service | null>(null);
  const [selectedServiceForOffers, setSelectedServiceForOffers] = useState<Service | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [offers, setOffers] = useState<any[]>([]);
  const [editingOffer, setEditingOffer] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [serviceForm, setServiceForm] = useState({
    name: '',
    name_ar: '',
    description: '',
    description_ar: '',
    duration_minutes: 60,
    base_price: 0,
    original_price: null as number | null,
    discount_percentage: null as number | null,
    capacity_per_slot: 1,
    capacity_mode: 'service_based' as 'employee_based' | 'service_based',
    service_duration_minutes: 60,
    service_capacity_per_slot: null as number | null,
    is_public: true,
    is_active: true,
    category_id: '',
    image_url: '',
    gallery_urls: [] as string[],
    is_combo: false,
    combo_services: [] as string[],
    scheduling_type: 'slot_based' as 'slot_based' | 'employee_based',
    assignment_mode: null as 'auto_assign' | 'manual_assign' | null,
    branch_ids: [] as string[],
  });

  const [branches, setBranches] = useState<Array<{ id: string; name: string; location: string | null }>>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  const [categoryForm, setCategoryForm] = useState({
    name: '',
    name_ar: '',
    description: '',
    description_ar: ''
  });

  const [shiftForm, setShiftForm] = useState({
    days_of_week: [] as number[],
    start_time: '09:00',
    end_time: '17:00',
    is_active: true
  });

  const fetchBranches = useCallback(async () => {
    try {
      setLoadingBranches(true);
      const res = await apiFetch('/branches', { headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load branches');
      setBranches(data.data || []);
    } catch (e: any) {
      setBranches([]);
      showNotification('error', e.message || 'Failed to load branches');
    } finally {
      setLoadingBranches(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
    fetchServices();
    fetchBranches();
  }, [userProfile, fetchBranches]);

  async function fetchCategories() {
    if (!userProfile?.tenant_id) return;
    try {
      const { data, error } = await db
        .from('service_categories')
        .select('*')
        .eq('tenant_id', userProfile.tenant_id)
        .order('name');
      
      if (error) {
        console.error('Error fetching categories:', error);
        return;
      }
      setCategories(data || []);
    } catch (error: any) {
      console.error('Error fetching categories:', error);
    }
  }

  async function fetchOffers(serviceId: string) {
    if (!userProfile?.tenant_id) return;
    try {
      const { data, error } = await db
        .from('service_offers')
        .select('*')
        .eq('service_id', serviceId)
        .eq('tenant_id', userProfile.tenant_id)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Error fetching offers:', error);
        return;
      }
      setOffers(data || []);
    } catch (error: any) {
      console.error('Error fetching offers:', error);
    }
  }

  async function fetchServices() {
    if (!userProfile?.tenant_id) return;
    try {
      const { data, error } = await db
        .from('services')
        .select('*, service_categories(id, name, name_ar)')
        .eq('tenant_id', userProfile.tenant_id)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Error fetching services:', error);
        setLoading(false);
        return;
      }
      setServices(data || []);
      setLoading(false);
    } catch (error: any) {
      console.error('Error fetching services:', error);
      setLoading(false);
    }
  }

  async function handleServiceSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userProfile?.tenant_id) return;

    try {
      // Check for duplicate service name (case-insensitive, trimmed)
      const serviceName = serviceForm.name.trim();
      if (!serviceName) {
        showNotification('warning', t('service.pleaseEnterServiceName'));
        return;
      }
      if (!serviceForm.branch_ids?.length) {
        showNotification('warning', t('service.selectAtLeastOneBranch'));
        return;
      }

      if (!editingService) {
        // Check for duplicates when creating new service
        const { data: existingServices, error: checkError } = await db
          .from('services')
          .select('id, name')
          .eq('tenant_id', userProfile.tenant_id);

        if (checkError) {
          console.warn('Error checking for duplicate services:', checkError);
        } else if (existingServices && existingServices.length > 0) {
          // Check if it's an exact match (case-insensitive, trimmed)
          const exactMatch = existingServices.find(
            s => s.name && s.name.trim().toLowerCase() === serviceName.toLowerCase()
          );
          
          if (exactMatch) {
            showNotification('warning', t('service.serviceWithSameNameExists', { name: exactMatch.name }));
            return;
          }
        }
      } else {
        // If editing, check for duplicates excluding the current service
        const { data: existingServices, error: checkError } = await db
          .from('services')
          .select('id, name')
          .eq('tenant_id', userProfile.tenant_id)
          .neq('id', editingService.id);

        if (checkError) {
          console.warn('Error checking for duplicate services:', checkError);
        } else if (existingServices && existingServices.length > 0) {
          const exactMatch = existingServices.find(
            s => s.name && s.name.trim().toLowerCase() === serviceName.toLowerCase()
          );
          
          if (exactMatch) {
            showNotification('warning', t('service.serviceWithSameNameExists', { name: exactMatch.name }));
            return;
          }
        }
      }

      // ARCHIVED: Always use service_based values since employee_based is archived
      // Prepare gallery_urls - ensure it's a valid array
      let galleryUrls: string[] = [];
      if (serviceForm.gallery_urls && Array.isArray(serviceForm.gallery_urls) && serviceForm.gallery_urls.length > 0) {
        galleryUrls = serviceForm.gallery_urls;
      } else if (serviceForm.image_url) {
        galleryUrls = [serviceForm.image_url];
      }
      
      // Ensure service_capacity_per_slot is a valid integer (not null, not undefined, not empty string, not NaN)
      const serviceCapacity = serviceForm.service_capacity_per_slot;
      console.log(`[Service Save] STEP 1 - service_capacity_per_slot from form:`, {
        value: serviceCapacity,
        type: typeof serviceCapacity,
        isNull: serviceCapacity === null,
        isUndefined: serviceCapacity === undefined,
        isString: typeof serviceCapacity === 'string',
        stringValue: typeof serviceCapacity === 'string' ? `"${serviceCapacity}"` : 'N/A'
      });
      
      const isEmployeeBasedScheduling = serviceForm.scheduling_type === 'employee_based' || hideServiceSlots;
      let validCapacity: number | null;

      if (isEmployeeBasedScheduling) {
        validCapacity = 1; // Not used for availability; keep DB constraint satisfied
      } else if (serviceCapacity === null || serviceCapacity === undefined || serviceCapacity === '' || isNaN(Number(serviceCapacity))) {
        validCapacity = 1;
        console.warn('[Service Save] STEP 2 - service_capacity_per_slot is invalid, using default value of 1');
      } else {
        const parsed = parseInt(String(serviceCapacity), 10);
        console.log(`[Service Save] STEP 2 - Parsed value:`, { parsed, isNaN: isNaN(parsed), isPositive: parsed > 0 });
        if (isNaN(parsed) || parsed <= 0) {
          validCapacity = 1;
          console.warn(`[Service Save] STEP 2 - service_capacity_per_slot parsed value is invalid (${parsed}), using default value of 1`);
        } else {
          validCapacity = parsed;
        }
      }

      console.log(`[Service Save] STEP 3 - Final validCapacity:`, { validCapacity, isEmployeeBasedScheduling });

      const payload: any = {
        name: serviceForm.name,
        name_ar: serviceForm.name_ar,
        description: serviceForm.description || null,
        description_ar: serviceForm.description_ar || null,
        category_id: serviceForm.category_id || null,
        tenant_id: userProfile.tenant_id,
        capacity_mode: serviceForm.scheduling_type === 'employee_based' ? 'employee_based' : 'service_based',
        scheduling_type: serviceForm.scheduling_type,
        assignment_mode: serviceForm.scheduling_type === 'employee_based' ? (serviceForm.assignment_mode || 'manual_assign') : null,
        service_capacity_per_slot: validCapacity,
        duration_minutes: parseInt(String(serviceForm.service_duration_minutes || 60), 10),
        service_duration_minutes: parseInt(String(serviceForm.service_duration_minutes || 60), 10),
        capacity_per_slot: validCapacity ?? 1,
        base_price: parseFloat(String(serviceForm.base_price || 0)),
        gallery_urls: galleryUrls.length > 0 ? galleryUrls : null,
        image_url: serviceForm.image_url || null,
        is_public: serviceForm.is_public,
        is_active: serviceForm.is_active
      };
      
      // Calculate discount_percentage automatically if original_price exists and is greater than base_price
      let finalDiscountPercentage = serviceForm.discount_percentage;
      const basePrice = typeof serviceForm.base_price === 'number' ? serviceForm.base_price : parseFloat(String(serviceForm.base_price || 0));
      const originalPrice = typeof serviceForm.original_price === 'number' ? serviceForm.original_price : (serviceForm.original_price ? parseFloat(String(serviceForm.original_price)) : null);
      if (originalPrice && originalPrice > basePrice && !finalDiscountPercentage) {
        finalDiscountPercentage = Math.round(((originalPrice - basePrice) / originalPrice) * 100);
      }
      
      // Only add discount fields if they have values (to avoid errors if columns don't exist)
      // Ensure original_price is a valid number or null (not string "NULL")
      if (serviceForm.original_price !== null && serviceForm.original_price !== undefined && serviceForm.original_price !== '' && serviceForm.original_price > 0) {
        payload.original_price = parseFloat(String(serviceForm.original_price));
      } else {
        // Explicitly set to null if not provided (don't include in payload if column doesn't exist)
        // Only set to null if we're updating and want to clear the field
        if (editingService) {
          payload.original_price = null;
        }
      }
      
      // Ensure discount_percentage is a valid integer or null
      if (serviceForm.discount_percentage !== null && serviceForm.discount_percentage !== undefined && serviceForm.discount_percentage !== '' && serviceForm.discount_percentage > 0) {
        payload.discount_percentage = parseInt(String(serviceForm.discount_percentage), 10);
      } else if (finalDiscountPercentage && finalDiscountPercentage > 0) {
        // Auto-calculate discount_percentage if not provided but original_price exists
        payload.discount_percentage = finalDiscountPercentage;
      } else if (editingService) {
        // Explicitly set to null if not provided and we're updating
        payload.discount_percentage = null;
      }
      
      // Remove undefined values and convert string "NULL" to actual null
      // Also ensure all numeric fields are properly typed
      Object.keys(payload).forEach(key => {
        const value = payload[key];
        
        if (value === undefined) {
          delete payload[key];
        } else if (value === 'NULL' || value === 'null' || value === '') {
          // For integer fields, don't set to null if they're required
          const integerFields = ['service_capacity_per_slot', 'capacity_per_slot', 'duration_minutes', 'service_duration_minutes'];
          if (integerFields.includes(key)) {
            // These fields should have default values, not null
            delete payload[key]; // Let the database use default or existing value
          } else {
            payload[key] = null;
          }
        } else {
          // Ensure integer fields are properly converted (not strings)
          const integerFields = ['service_capacity_per_slot', 'capacity_per_slot', 'duration_minutes', 'service_duration_minutes', 'discount_percentage'];
          if (integerFields.includes(key) && value !== null) {
            const parsed = parseInt(String(value), 10);
            if (!isNaN(parsed)) {
              payload[key] = parsed;
            } else {
              console.warn(`Invalid integer value for ${key}: ${value}`);
              delete payload[key];
            }
          }
          
          // Ensure decimal fields are properly converted
          const decimalFields = ['base_price', 'original_price'];
          if (decimalFields.includes(key) && value !== null) {
            const parsed = parseFloat(String(value));
            if (!isNaN(parsed)) {
              payload[key] = parsed;
            } else {
              console.warn(`Invalid decimal value for ${key}: ${value}`);
              delete payload[key];
            }
          }
        }
      });
      
      // Final cleanup: Remove any fields that might cause issues
      // Don't send null for integer fields that are required
      const finalPayload: any = {};
      Object.keys(payload).forEach(key => {
        let value = payload[key];
        
        // Convert string "NULL" to actual null first
        if (value === 'NULL' || value === 'null' || (typeof value === 'string' && value.trim().toUpperCase() === 'NULL')) {
          value = null;
        }
        
        // Skip null values for integer fields that are required
        const requiredIntegerFields = ['service_capacity_per_slot', 'capacity_per_slot', 'duration_minutes', 'service_duration_minutes'];
        if (requiredIntegerFields.includes(key) && (value === null || value === undefined || value === '')) {
          console.warn(`Skipping ${key} because it's null/undefined/empty and required`);
          return;
        }
        
        // For integer fields, ensure they're numbers, not strings
        if (requiredIntegerFields.includes(key) && value !== null && value !== undefined) {
          const numValue = typeof value === 'string' ? parseInt(value.trim(), 10) : Number(value);
          if (isNaN(numValue)) {
            console.warn(`Skipping ${key} because it's not a valid number: ${value}`);
            return;
          }
          value = numValue;
        }
        
        // Skip if value is still string "NULL" after processing
        if (typeof value === 'string' && value.trim().toUpperCase() === 'NULL') {
          console.warn(`Skipping ${key} because it's still string "NULL" after processing`);
          return;
        }
        
        finalPayload[key] = value;
      });
      
      console.log('🔍 [Service Save] STEP 4 - Final payload:', JSON.stringify(finalPayload, null, 2));
      console.log('🔍 [Service Save] STEP 4 - Payload types:', Object.keys(finalPayload).reduce((acc, key) => {
        acc[key] = typeof finalPayload[key];
        return acc;
      }, {} as Record<string, string>));
      console.log('🔍 [Service Save] STEP 4 - service_capacity_per_slot in finalPayload:', {
        value: finalPayload.service_capacity_per_slot,
        type: typeof finalPayload.service_capacity_per_slot,
        isNull: finalPayload.service_capacity_per_slot === null,
        isUndefined: finalPayload.service_capacity_per_slot === undefined,
        stringValue: typeof finalPayload.service_capacity_per_slot === 'string' ? `"${finalPayload.service_capacity_per_slot}"` : 'N/A',
        jsonStringified: JSON.stringify(finalPayload.service_capacity_per_slot)
      });
      console.log('🔍 [Service Save] STEP 4 - Discount fields:', {
        original_price: finalPayload.original_price,
        discount_percentage: finalPayload.discount_percentage,
        base_price: finalPayload.base_price,
      });

      let savedServiceId: string | null = null;
      if (editingService) {
        const result = await db.from('services').update(finalPayload).eq('id', editingService.id).then();
        if (result.error) {
          const errorMessage = result.error?.message || result.error?.error || JSON.stringify(result.error) || 'Unknown error';
          console.error('Error updating service:', result.error);
          showNotification('error', `Error updating service: ${errorMessage}`);
          return;
        }
        savedServiceId = editingService.id;
      } else {
        const result = await db.from('services').insert(finalPayload).select().single();
        if (result.error) {
          const errorMessage = result.error?.message || result.error?.error || JSON.stringify(result.error) || 'Unknown error';
          console.error('Error creating service:', result.error);
          showNotification('error', `Error creating service: ${errorMessage}`);
          return;
        }
        savedServiceId = result.data?.id ?? null;
        
        // Auto-create default shift only for slot_based services (employee_based use employee shifts)
        if (result.data && userProfile?.tenant_id && serviceForm.scheduling_type === 'slot_based') {
          try {
            const newServiceId = result.data.id;
            const defaultShift = {
              tenant_id: userProfile.tenant_id,
              service_id: newServiceId,
              days_of_week: [1, 2, 3, 4, 5], // Monday to Friday
              start_time_utc: '09:00:00',
              end_time_utc: '18:00:00',
              is_active: true
            };
            
            const shiftResult = await db.from('shifts').insert(defaultShift).select().single();
            
            if (shiftResult.error) {
              console.warn('Failed to create default shift:', shiftResult.error);
            } else if (shiftResult.data) {
              console.log('✓ Created default shift for new slot_based service');
              
              // Auto-generate slots for the next 60 days
              try {
                const today = new Date();
                const endDate = new Date();
                endDate.setDate(endDate.getDate() + 60);
                
                const todayStr = today.toISOString().split('T')[0];
                const endDateStr = endDate.toISOString().split('T')[0];
                
                const slotsResult = await db.rpc('generate_slots_for_shift', {
                  p_shift_id: shiftResult.data.id,
                  p_start_date: todayStr,
                  p_end_date: endDateStr
                });
                
                if (slotsResult.error) {
                  console.warn('Failed to generate slots:', slotsResult.error);
                } else {
                  console.log(`✓ Generated ${slotsResult.data} slots for new service`);
                }
              } catch (slotError) {
                console.warn('Error generating slots:', slotError);
              }
            }
          } catch (shiftError) {
            console.warn('Error creating default shift:', shiftError);
          }
        }
      }

      if (savedServiceId != null) {
        try {
          const putRes = await apiFetch(`/branches/by-service/${savedServiceId}/branches`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ branch_ids: serviceForm.branch_ids || [] }),
          });
          if (!putRes.ok) {
            const err = await putRes.json().catch(() => ({}));
            showNotification('error', (err as any).error || t('service.failedToAssignBranches'));
          }
        } catch {
          showNotification('error', t('service.failedToAssignBranches'));
        }
      }

      setIsServiceModalOpen(false);
      setEditingService(null);
      resetServiceForm();
      await fetchServices();
    } catch (error: any) {
      console.error('Service submit error:', error);
      showNotification('error', `Error: ${error.message || 'Failed to save service'}`);
    }
  }

  async function handleCategorySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userProfile?.tenant_id) return;

    try {
      const payload = { ...categoryForm, tenant_id: userProfile.tenant_id };

      if (editingCategory) {
        const result = await db.from('service_categories').update(payload).eq('id', editingCategory.id).then();
        if (result.error) {
          showNotification('error', `Error updating category: ${result.error.message}`);
          return;
        }
      } else {
        const result = await db.from('service_categories').insert(payload).then();
        if (result.error) {
          showNotification('error', `Error creating category: ${result.error.message}`);
          return;
        }
      }

      setIsCategoryModalOpen(false);
      setEditingCategory(null);
      resetCategoryForm();
      await fetchCategories();
    } catch (error: any) {
      console.error('Category submit error:', error);
      showNotification('error', t('service.errorSavingCategory', { message: error.message || t('common.error') }));
    }
  }

  async function deleteService(id: string) {
    if (!userProfile?.tenant_id) return;
    
    try {
      // First, find all packages that contain this service
      const { data: packageServices, error: packageServicesError } = await db
        .from('package_services')
        .select('package_id')
        .eq('service_id', id);

      if (packageServicesError) {
        console.error('Error fetching packages for service:', packageServicesError);
      }

      const packageIds = (packageServices || []).map((ps: any) => ps.package_id);
      
      // Fetch package details for warning message
      let affectedPackages: any[] = [];
      if (packageIds.length > 0) {
        const { data: packagesData, error: packagesError } = await db
          .from('service_packages')
          .select('id, name, name_ar')
          .in('id', packageIds);

        if (!packagesError && packagesData) {
          affectedPackages = packagesData;
        }
      }
      
      // Warn user about packages that will be deleted
      if (affectedPackages.length > 0) {
        const packageNames = affectedPackages.map((pkg: any) => 
          i18n.language === 'ar' ? (pkg.name_ar || pkg.name) : (pkg.name || pkg.name_ar)
        ).join(', ');
        
        const confirmMessage = i18n.language === 'ar'
          ? `هذه الخدمة موجودة في ${affectedPackages.length} حزمة(ات): ${packageNames}\n\nسيتم حذف هذه الحزم أيضاً. هل أنت متأكد من الحذف؟`
          : `This service is included in ${affectedPackages.length} package(s): ${packageNames}\n\nThese packages will also be deleted. Are you sure you want to delete?`;
        
        const ok = await showConfirm({
          title: t('common.confirm'),
          description: confirmMessage,
          destructive: true,
          confirmText: t('common.delete'),
          cancelText: t('common.cancel'),
        });
        if (!ok) return;
      } else {
        const ok = await showConfirm({
          title: t('common.confirm'),
          description: t('service.deleteService'),
          destructive: true,
          confirmText: t('common.delete'),
          cancelText: t('common.cancel'),
        });
        if (!ok) return;
      }

      // Delete all packages that contain this service
      if (packageIds.length > 0) {
        
        for (const packageId of packageIds) {
          try {
            // Delete package subscription usage records first
            const { data: subscriptions } = await db
              .from('package_subscriptions')
              .select('id')
              .eq('package_id', packageId);

            if (subscriptions && subscriptions.length > 0) {
              const subscriptionIds = subscriptions.map(sub => sub.id);
              for (const subscriptionId of subscriptionIds) {
                await db
                  .from('package_subscription_usage')
                  .delete()
                  .eq('subscription_id', subscriptionId);
              }
            }

            // Delete package subscriptions
            await db
              .from('package_subscriptions')
              .delete()
              .eq('package_id', packageId);

            // Delete package services (will be cascaded, but explicit for clarity)
            await db
              .from('package_services')
              .delete()
              .eq('package_id', packageId);

            // Delete the package itself
            const { error: packageDeleteError } = await db
              .from('service_packages')
              .delete()
              .eq('id', packageId);

            if (packageDeleteError) {
              console.error(`Error deleting package ${packageId}:`, packageDeleteError);
              // Continue with other deletions
            }
          } catch (packageError: any) {
            console.error(`Error deleting package ${packageId}:`, packageError);
            // Continue with other deletions
          }
        }
      }

      // Now delete the service (this will cascade delete package_services entries)
      const { data: deletedService, error: deleteError } = await db
        .from('services')
        .delete()
        .eq('id', id)
        .select();

      if (deleteError) {
        // Check if error has a user-friendly message from backend
        const errorMessage = deleteError.message || deleteError.error || t('service.errorDeletingService');
        console.error('[Delete Service] Database error:', deleteError);
        showNotification('error', `Error deleting service: ${errorMessage}`);
        return;
      }

      // VERIFY DELETION: Ensure at least one row was actually deleted
      if (!deletedService || deletedService.length === 0) {
        console.warn('[Delete Service] ⚠️ No rows deleted! Service may not exist or deletion was blocked:', id);
        
        // Double-check: Query to see if service still exists
        const { data: stillExists, error: checkError } = await db
          .from('services')
          .select('id, name')
          .eq('id', id)
          .single();

        if (!checkError && stillExists) {
          console.error('[Delete Service] ❌ Service still exists after delete attempt!', stillExists);
          showNotification('error', t('service.failedToDeleteServiceStillExists'));
          await fetchServices();
          return;
        } else if (checkError && checkError.code === 'PGRST116') {
          // PGRST116 = no rows returned (service doesn't exist)
          console.log('[Delete Service] ✅ Service does not exist (may have been deleted by another process)');
          // Continue to show success message (idempotent operation)
        } else {
          console.error('[Delete Service] ❌ Unexpected error checking service existence:', checkError);
          showNotification('error', t('service.failedToVerifyServiceDeletion'));
          await fetchServices();
          return;
        }
      } else {
        console.log(`[Delete Service] ✅ Successfully deleted service ${id}. Deleted ${deletedService.length} row(s).`);
      }

      // Show success message
      if (affectedPackages.length > 0) {
        showNotification('success', t('service.serviceAndPackagesDeletedSuccessfully', { count: affectedPackages.length }));
      }

      await fetchServices();
    } catch (error: any) {
      console.error('Delete service error:', error);
      // Check if error has structured response
      if (error.message) {
        showNotification('error', error.message || t('common.failedToDeleteService'));
      } else {
        showNotification('error', t('common.failedToDeleteService'));
      }
    }
  }

  async function deleteCategory(id: string) {
    const ok = await showConfirm({
      title: t('common.confirm'),
      description: t('service.deleteCategory'),
      destructive: true,
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
    });
    if (!ok) return;

    try {
      const { data: deletedCategory, error: deleteError } = await db
        .from('service_categories')
        .delete()
        .eq('id', id)
        .select();

      if (deleteError) {
        showNotification('error', t('service.errorDeletingCategory', { message: deleteError.message || deleteError.error || t('common.error') }));
        return;
      }

      if (!deletedCategory || deletedCategory.length === 0) {
        showNotification('warning', t('service.categoryNotFoundOrAlreadyDeleted'));
        await fetchCategories();
        return;
      }
      await fetchCategories();
      await fetchServices();
    } catch (error: any) {
      console.error('Delete category error:', error);
      showNotification('error', t('service.errorDeletingCategory', { message: error.message || t('common.error') }));
    }
  }

  function openEditService(service: Service) {
    setEditingService(service);
    const serviceData = service as any;
    let galleryUrls: string[] = [];
    if (serviceData.gallery_urls) {
      if (Array.isArray(serviceData.gallery_urls)) {
        galleryUrls = serviceData.gallery_urls.filter((img: any) => img && typeof img === 'string');
      }
    }
    const schedulingType = serviceData.scheduling_type || 'slot_based';
    setServiceForm({
      name: service.name,
      name_ar: service.name_ar,
      description: service.description,
      description_ar: service.description_ar,
      duration_minutes: service.duration_minutes,
      base_price: service.base_price,
      original_price: serviceData.original_price || null,
      discount_percentage: serviceData.discount_percentage || null,
      capacity_per_slot: service.capacity_per_slot,
      capacity_mode: schedulingType === 'employee_based' ? 'employee_based' : 'service_based',
      service_duration_minutes: serviceData.service_duration_minutes || service.duration_minutes,
      service_capacity_per_slot: serviceData.service_capacity_per_slot || null,
      is_public: service.is_public,
      is_active: service.is_active,
      category_id: service.category_id || '',
      image_url: serviceData.image_url || '',
      gallery_urls: galleryUrls.length > 0 ? galleryUrls : (serviceData.image_url ? [serviceData.image_url] : []),
      is_combo: false,
      combo_services: [],
      scheduling_type: schedulingType,
      assignment_mode: serviceData.assignment_mode || (schedulingType === 'employee_based' ? 'manual_assign' : null),
      branch_ids: [],
    });
    setIsServiceModalOpen(true);
    (async () => {
      try {
        const res = await apiFetch(`/branches/by-service/${service.id}/branches`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (res.ok && data.data?.branch_ids) {
          setServiceForm(prev => ({ ...prev, branch_ids: data.data.branch_ids }));
        }
      } catch {
        // ignore
      }
    })();
  }

  function openEditCategory(cat: Category) {
    setEditingCategory(cat);
    setCategoryForm({
      name: cat.name,
      name_ar: cat.name_ar,
      description: cat.description || '',
      description_ar: cat.description_ar || ''
    });
    setIsCategoryModalOpen(true);
  }

  function resetServiceForm() {
    setServiceForm({
      name: '',
      name_ar: '',
      description: '',
      description_ar: '',
      duration_minutes: 60,
      base_price: 0,
      original_price: null,
      discount_percentage: null,
      capacity_per_slot: 1,
      capacity_mode: 'service_based',
      service_duration_minutes: 60,
      service_capacity_per_slot: null,
      is_public: true,
      is_active: true,
      category_id: '',
      image_url: '',
      gallery_urls: [],
      is_combo: false,
      combo_services: [],
      scheduling_type: 'slot_based',
      assignment_mode: null,
      branch_ids: [],
    });
  }

  function resetCategoryForm() {
    setCategoryForm({
      name: '',
      name_ar: '',
      description: '',
      description_ar: ''
    });
  }

  async function openScheduleModal(service: Service) {
    setSelectedServiceForSchedule(service);
    await fetchShifts(service.id);
    setIsScheduleModalOpen(true);
  }

  async function fetchShifts(serviceId: string) {
    try {
      const { data, error } = await db
        .from('shifts')
        .select('*')
        .eq('service_id', serviceId)
        .order('created_at');
      
      if (error) {
        console.error('Error fetching shifts:', error);
        return;
      }
      setShifts(data || []);
    } catch (error: any) {
      console.error('Error fetching shifts:', error);
    }
  }

  async function handleShiftSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedServiceForSchedule || !userProfile?.tenant_id) return;

    if (shiftForm.days_of_week.length === 0) {
      showNotification('warning', t('service.pleaseSelectDayOfWeek'));
      return;
    }

    try {
      const payload = {
        service_id: selectedServiceForSchedule.id,
        tenant_id: userProfile.tenant_id,
        days_of_week: shiftForm.days_of_week,
        start_time_utc: shiftForm.start_time,
        end_time_utc: shiftForm.end_time,
        is_active: shiftForm.is_active
      };

      let shiftId: string;

      if (editingShift) {
        const result = await db.from('shifts').update(payload).eq('id', editingShift.id).then();
        if (result.error) {
          showNotification('error', `Error updating shift: ${result.error.message}`);
          return;
        }
        shiftId = editingShift.id;
      } else {
        const result = await db.from('shifts').insert(payload).select().single();
        if (result.error) {
          showNotification('error', `Error creating shift: ${result.error.message}`);
          return;
        }
        if (!result.data) {
          showNotification('error', t('service.failedToCreateShift'));
          return;
        }
        shiftId = result.data.id;
      }

      setEditingShift(null);
      resetShiftForm();
      await fetchShifts(selectedServiceForSchedule.id);

      // Auto-regenerate slots for the next 30 days
      if (shiftId) {
        await regenerateSlots(shiftId, true);
      }
    } catch (error: any) {
      console.error('Shift submit error:', error);
      showNotification('error', t('service.errorSavingShift', { message: error.message || t('common.error') }));
    }
  }

  async function deleteShift(id: string) {
    const ok = await showConfirm({
      title: t('common.confirm'),
      description: t('service.deleteShiftConfirm'),
      destructive: true,
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
    });
    if (!ok) return;

    try {
      const { data: deletedShift, error: deleteError } = await db
        .from('shifts')
        .delete()
        .eq('id', id)
        .select();

      if (deleteError) {
        showNotification('error', t('service.errorDeletingShift', { message: deleteError.message || deleteError.error || t('common.error') }));
        return;
      }

      if (!deletedShift || deletedShift.length === 0) {
        showNotification('warning', t('service.shiftNotFoundOrAlreadyDeleted'));
        if (selectedServiceForSchedule?.id) {
          await fetchShifts(selectedServiceForSchedule.id);
        }
        return;
      }
      if (selectedServiceForSchedule) {
        await fetchShifts(selectedServiceForSchedule.id);
      }
    } catch (error: any) {
      console.error('Delete shift error:', error);
      showNotification('error', t('service.errorDeletingShift', { message: error.message || t('common.error') }));
    }
  }

  async function regenerateSlots(shiftId: string, silent = false) {
    if (!silent) {
      const ok = await showConfirm({
        title: t('common.confirm'),
        description: t('service.regenerateSlotsConfirm'),
        destructive: false,
        confirmText: t('common.confirm'),
        cancelText: t('common.cancel'),
      });
      if (!ok) return;
    }

    try {
      const today = new Date();
      const endDate = new Date();
      endDate.setDate(today.getDate() + 30);

      // Use db.rpc instead of direct fetch
      const { data, error } = await db.rpc('generate_slots_for_shift', {
        p_shift_id: shiftId,
        p_start_date: today.toISOString().split('T')[0],
        p_end_date: endDate.toISOString().split('T')[0],
      });

      if (error) {
        console.error('Slot generation error:', error);
        if (!silent) {
          showNotification('error', t('service.errorGeneratingSlots', { message: error.message || t('common.error') }));
        }
        return;
      }

      if (!silent) {
        const slotsGenerated = data?.[0]?.slots_generated || data?.slots_generated || 0;
        showNotification('success', `Success! ${slotsGenerated} slots generated.`);
      }
    } catch (error: any) {
      console.error('Slot generation error:', error);
      if (!silent) {
        showNotification('error', t('service.errorGeneratingSlots', { message: error.message || t('common.error') }));
      }
    }
  }

  function openEditShift(shift: Shift) {
    setEditingShift(shift);
    setShiftForm({
      days_of_week: shift.days_of_week,
      start_time: shift.start_time_utc,
      end_time: shift.end_time_utc,
      is_active: shift.is_active
    });
  }

  function resetShiftForm() {
    setShiftForm({
      days_of_week: [],
      start_time: '09:00',
      end_time: '17:00',
      is_active: true
    });
  }

  function toggleDay(day: number) {
    setShiftForm(prev => ({
      ...prev,
      days_of_week: prev.days_of_week.includes(day)
        ? prev.days_of_week.filter(d => d !== day)
        : [...prev.days_of_week, day].sort()
    }));
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayNamesAr = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('service.services', 'Services')}</h1>
          <p className="text-sm md:text-base text-gray-600 mt-1">{t('service.manageServices', 'Manage your services and categories')}</p>
        </div>
        <div className="flex gap-3">
          <Button
            onClick={() => setIsCategoryModalOpen(true)}
            variant="secondary"
            icon={<FolderOpen className="w-4 h-4" />}
          >
            {t('service.categories', 'Categories')}
          </Button>
          <Button
            onClick={() => setIsServiceModalOpen(true)}
            icon={<Plus className="w-4 h-4" />}
          >
            {t('service.addService', 'Add Service')}
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      {services.length > 0 && (
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <Input
              type="text"
              placeholder={i18n.language === 'ar' ? 'ابحث عن خدمة...' : 'Search services...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 w-full"
            />
          </div>
        </div>
      )}

      {/* Filtered Services */}
      {(() => {
        const filteredServices = services.filter(service => {
          if (!searchQuery.trim()) return true;
          const query = searchQuery.toLowerCase().trim();
          const name = (service.name || '').toLowerCase();
          const nameAr = (service.name_ar || '').toLowerCase();
          const description = (service.description || '').toLowerCase();
          const descriptionAr = (service.description_ar || '').toLowerCase();
          return name.includes(query) || nameAr.includes(query) || 
                 description.includes(query) || descriptionAr.includes(query);
        });

        if (filteredServices.length === 0 && services.length > 0) {
          return (
            <Card>
              <CardContent className="py-12 text-center">
                <Search className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {t('common.noResultsFound')}
                </h3>
                <p className="text-gray-600 mb-6">
                  {i18n.language === 'ar' 
                    ? `لم يتم العثور على خدمات تطابق "${searchQuery}"`
                    : `No services found matching "${searchQuery}"`}
                </p>
                <Button onClick={() => setSearchQuery('')} variant="secondary">
                  {t('common.clearSearch')}
                </Button>
              </CardContent>
            </Card>
          );
        }

        if (filteredServices.length === 0) {
          return (
            <Card>
              <CardContent className="py-12 text-center">
                <Briefcase className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">{t('service.noServicesYet', 'No services yet')}</h3>
                <p className="text-gray-600 mb-6">{t('service.getStarted', 'Get started by adding your first service')}</p>
                <Button onClick={() => setIsServiceModalOpen(true)} icon={<Plus className="w-4 h-4" />}>
                  {t('service.addService', 'Add Service')}
                </Button>
              </CardContent>
            </Card>
          );
        }

        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredServices.map((service) => (
            <Card key={service.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="truncate">
                    {i18n.language === 'ar' ? (service.name_ar || service.name) : service.name}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded ${
                    service.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {service.is_active ? t('service.active', 'Active') : t('employee.inactive', 'Inactive')}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {service.service_categories && (
                  <p className="text-xs text-gray-500 mb-2">
                    {i18n.language === 'ar' ? service.service_categories.name_ar : service.service_categories.name}
                  </p>
                )}
                <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                  {i18n.language === 'ar' ? (service.description_ar || service.description) : service.description}
                </p>
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">{t('service.duration', 'Duration')}</span>
                    <span className="font-medium">
                      {service.duration_minutes} min
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">{t('service.price', 'Price')}</span>
                    <span className="font-medium">{formatPrice(service.base_price)}</span>
                  </div>
                  {!(hideServiceSlots || service.scheduling_type === 'employee_based') && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">{t('service.capacity', 'Capacity')}</span>
                    <span className="font-medium">
                      {service.capacity_per_slot}
                    </span>
                  </div>
                  )}
                </div>
                <div className="space-y-2">
                  {(hideServiceSlots || service.scheduling_type === 'employee_based') ? (
                    <p className="text-xs text-gray-500 italic">
                      {t('service.employeeBasedNoShifts', 'Uses employee shifts. Configure in Employees.')}
                    </p>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      onClick={() => openScheduleModal(service)}
                      icon={<Clock className="w-4 h-4" />}
                    >
                      Schedule
                    </Button>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      onClick={() => openEditService(service)}
                      icon={<Edit className="w-4 h-4" />}
                    >
                      {t('common.edit')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSelectedServiceForOffers(service);
                        fetchOffers(service.id);
                        setIsOffersModalOpen(true);
                      }}
                      icon={<Gift className="w-4 h-4" />}
                      title={t('service.manageOffers', 'Manage Offers')}
                    />
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => deleteService(service.id)}
                      icon={<Trash2 className="w-4 h-4" />}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
            ))}
          </div>
        );
      })()}

      <Modal
        isOpen={isServiceModalOpen}
        onClose={() => {
          setIsServiceModalOpen(false);
          setEditingService(null);
          resetServiceForm();
        }}
        title={editingService ? t('service.editService', 'Edit Service') : t('service.addService', 'Add Service')}
      >
        <form onSubmit={handleServiceSubmit} className="space-y-4">
          <Input
            label={t('service.nameEnglish', 'Service Name (English)')}
            value={serviceForm.name}
            onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}
            required
            placeholder={t('service.serviceNameEnglishPlaceholder')}
          />

          <Input
            label={t('service.nameArabic')}
            value={serviceForm.name_ar}
            onChange={(e) => setServiceForm({ ...serviceForm, name_ar: e.target.value })}
            required
            dir="rtl"
            placeholder="اسم الخدمة بالعربية"
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('service.descriptionEnglish')}
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
              value={serviceForm.description}
              onChange={(e) => setServiceForm({ ...serviceForm, description: e.target.value })}
              placeholder={t('service.serviceDescriptionEnglishPlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('service.descriptionArabic')}
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
              value={serviceForm.description_ar}
              onChange={(e) => setServiceForm({ ...serviceForm, description_ar: e.target.value })}
              dir="rtl"
              placeholder="وصف الخدمة بالعربية"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('service.assignToBranches')}
            </label>
            {loadingBranches ? (
              <p className="text-sm text-gray-500">{t('common.loading')}</p>
            ) : branches.length === 0 ? (
              <p className="text-sm text-gray-500">{t('service.noBranchesYet')}</p>
            ) : (
              <div className="border border-gray-300 rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                {(branches.filter((b) => (b as { is_active?: boolean }).is_active !== false)).map((branch) => (
                  <label key={branch.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={serviceForm.branch_ids.includes(branch.id)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setServiceForm(prev => ({
                          ...prev,
                          branch_ids: checked
                            ? [...prev.branch_ids, branch.id]
                            : prev.branch_ids.filter(id => id !== branch.id),
                        }));
                      }}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-900">{branch.name}</span>
                    {branch.location && (
                      <span className="text-xs text-gray-500">({branch.location})</span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Scheduling Type: only shown when global mode is service_slot_based. When employee_based, global setting controls behavior. */}
          {hideServiceSlots ? (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">{t('service.schedulingType', 'Scheduling Type')}</h4>
              <p className="text-sm text-gray-600">
                {t('service.globalSchedulingEmployeeBased', 'Scheduling is set to Employee based in Settings. Availability comes from employee shifts. Configure in Settings → Employees.')}
              </p>
            </div>
          ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">{t('service.schedulingType', 'Scheduling Type')}</h4>
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="scheduling_type"
                  value="slot_based"
                  checked={serviceForm.scheduling_type === 'slot_based'}
                  onChange={() => setServiceForm({
                    ...serviceForm,
                    scheduling_type: 'slot_based',
                    assignment_mode: null,
                  })}
                  className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                />
                <div className="flex-1">
                  <span className="font-medium text-gray-900">{t('service.slotBased', 'Slot-based')}</span>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {t('service.slotBasedHelp', 'Service has its own time slots. No employee assignment.')}
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="scheduling_type"
                  value="employee_based"
                  checked={serviceForm.scheduling_type === 'employee_based'}
                  onChange={() => setServiceForm({
                    ...serviceForm,
                    scheduling_type: 'employee_based',
                    assignment_mode: serviceForm.assignment_mode || 'manual_assign',
                  })}
                  className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                />
                <div className="flex-1">
                  <span className="font-medium text-gray-900">{t('service.employeeBased', 'Employee-based')}</span>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {t('service.employeeBasedHelp', 'Availability comes from employees assigned to this service.')}
                  </p>
                </div>
              </label>
            </div>
            {serviceForm.scheduling_type === 'employee_based' && (
              <div className="mt-4 pl-7 border-l-2 border-blue-200">
                <h5 className="text-xs font-semibold text-gray-700 mb-2">{t('service.assignmentMode', 'Assignment Mode')}</h5>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="assignment_mode"
                      value="auto_assign"
                      checked={serviceForm.assignment_mode === 'auto_assign'}
                      onChange={() => setServiceForm({ ...serviceForm, assignment_mode: 'auto_assign' })}
                      className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-sm">{t('service.autoAssign', 'Auto-assign (fair rotation)')}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="assignment_mode"
                      value="manual_assign"
                      checked={serviceForm.assignment_mode === 'manual_assign'}
                      onChange={() => setServiceForm({ ...serviceForm, assignment_mode: 'manual_assign' })}
                      className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-sm">{t('service.manualAssign', 'Manual (reception picks employee)')}</span>
                  </label>
                </div>
              </div>
            )}
          </div>
          )}

          {/* ARCHIVED: Capacity Model selection - Now always service_based */}
          {/* <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Capacity Model <span className="text-red-500">*</span>
            </label>
            <div className="space-y-3 bg-gray-50 p-4 rounded-lg border border-gray-200">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="capacity_mode"
                  value="employee_based"
                  checked={serviceForm.capacity_mode === 'employee_based'}
                  onChange={(e) => setServiceForm({
                    ...serviceForm,
                    capacity_mode: 'employee_based',
                    service_capacity_per_slot: null
                  })}
                  className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">Employee-Based Capacity</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Capacity is pooled from assigned employees. Use for services where staff availability determines capacity (salons, clinics, consulting).
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="capacity_mode"
                  value="service_based"
                  checked={serviceForm.capacity_mode === 'service_based'}
                  onChange={(e) => setServiceForm({
                    ...serviceForm,
                    capacity_mode: 'service_based',
                    service_capacity_per_slot: 1
                  })}
                  className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">Service-Based Capacity</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Fixed capacity per time slot. Use for resources with fixed limits (rooms, equipment, class sizes).
                  </div>
                </div>
              </label>
            </div>
          </div> */}

          {/* ARCHIVED: Always show service-based fields since employee-based is archived */}
          <div className="grid grid-cols-2 gap-4">
            <Input
              type="number"
              label={t('service.durationMinutesRequired', 'Duration (minutes) *')}
              value={serviceForm.service_duration_minutes}
              onChange={(e) => {
                const minutes = parseInt(e.target.value);
                setServiceForm({
                  ...serviceForm,
                  duration_minutes: minutes,
                  service_duration_minutes: minutes
                });
              }}
              required
              min="1"
              helperText={t('service.fixedDurationForAllSlots')}
            />
            <Input
              type="number"
              label={t('service.basePriceRequired', 'Base Price *')}
              value={serviceForm.base_price}
              onChange={(e) => setServiceForm({ ...serviceForm, base_price: parseFloat(e.target.value) })}
              required
              min="0"
              step="0.01"
              helperText={(() => {
                const basePrice = typeof serviceForm.base_price === 'number' ? serviceForm.base_price : parseFloat(String(serviceForm.base_price || 0));
                return basePrice > 0 ? `Current price: ${formatPriceString(basePrice)}` : '';
              })()}
            />
          </div>


          {/* Discount Options */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">{t('service.discountOptionsOptional', 'Discount Options (Optional)')}</h4>
            <div className="grid grid-cols-2 gap-4">
              <Input
                type="number"
                label={t('service.originalPriceBeforeDiscount', 'Original Price (before discount)')}
                value={serviceForm.original_price || ''}
                onChange={(e) => {
                  const originalPrice = e.target.value ? parseFloat(e.target.value) : null;
                  let discount = null;
                  const basePrice = typeof serviceForm.base_price === 'number' ? serviceForm.base_price : parseFloat(String(serviceForm.base_price || 0));
                  if (originalPrice && basePrice > 0) {
                    discount = Math.round(((originalPrice - basePrice) / originalPrice) * 100);
                  }
                  setServiceForm({
                    ...serviceForm,
                    original_price: originalPrice,
                    discount_percentage: discount
                  });
                }}
                min="0"
                step="0.01"
                placeholder={t('service.originalPricePlaceholder', 'e.g., 200')}
              />
              <Input
                type="number"
                label={t('service.discountPercentageLabel', 'Discount Percentage (%)')}
                value={serviceForm.discount_percentage || ''}
                onChange={(e) => {
                  const discount = e.target.value ? parseInt(e.target.value) : null;
                  setServiceForm({
                    ...serviceForm,
                    discount_percentage: discount,
                    // Auto-calculate base_price if original_price exists
                    base_price: serviceForm.original_price && discount
                      ? Math.round(serviceForm.original_price * (1 - discount / 100) * 100) / 100
                      : serviceForm.base_price,
                  });
                }}
                min="0"
                max="100"
                placeholder={t('service.discountPercentagePlaceholder', 'e.g., 16')}
              />
            </div>
            {(() => {
              const basePrice = typeof serviceForm.base_price === 'number' ? serviceForm.base_price : parseFloat(String(serviceForm.base_price || 0));
              const originalPrice = typeof serviceForm.original_price === 'number' ? serviceForm.original_price : (serviceForm.original_price ? parseFloat(String(serviceForm.original_price)) : null);
              if (originalPrice && originalPrice > basePrice) {
                const discount = serviceForm.discount_percentage || Math.round(((originalPrice - basePrice) / originalPrice) * 100);
                return (
                  <p className="text-xs text-gray-600 mt-2">
                    {t('service.currentPriceSave', 'Current price: {{price}} (Save {{percent}}%)', { price: formatPrice(basePrice), percent: discount })}
                  </p>
                );
              }
              return null;
            })()}
          </div>

          {!hideServiceSlots && serviceForm.scheduling_type !== 'employee_based' && (
          <Input
            type="number"
            label={t('service.serviceCapacityPerSlotRequired', 'Service Capacity per Slot *')}
            value={serviceForm.service_capacity_per_slot || ''}
            onChange={(e) => {
              const value = e.target.value;
              if (value === '' || value === null || value === undefined) {
                setServiceForm({
                  ...serviceForm,
                  service_capacity_per_slot: null,
                  capacity_per_slot: null
                });
              } else {
                const parsed = parseInt(value, 10);
                if (!isNaN(parsed) && parsed > 0) {
                  setServiceForm({
                    ...serviceForm,
                    service_capacity_per_slot: parsed,
                    capacity_per_slot: parsed
                  });
                } else {
                  setServiceForm({
                    ...serviceForm,
                    service_capacity_per_slot: null,
                    capacity_per_slot: null
                  });
                }
              }
            }}
            required
            min="1"
            helperText={t('service.fixedCustomersPerSlot')}
          />
          )}

          {/* Multiple Images Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('service.serviceImagesMultiple', 'Service Images (Multiple)')}
            </label>
            <div className="space-y-2">
              <input
                type="file"
                multiple
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,image/svg+xml,image/bmp,image/x-icon,image/vnd.microsoft.icon,image/heic,image/heif,.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp,.ico,.heic,.heif"
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length === 0) return;
                  
                  // Validate file sizes (200MB limit per file)
                  const maxSizePerFile = 200 * 1024 * 1024; // 200MB
                  const invalidFiles = files.filter(file => file.size > maxSizePerFile);
                  if (invalidFiles.length > 0) {
                    showNotification('warning', `One or more files exceed the 200MB limit. Please select smaller files.`);
                    return;
                  }
                  
                  // Validate file extensions
                  const validImageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.heic', '.heif'];
                  const invalidExtensions = files.filter(file => {
                    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
                    return !validImageExtensions.includes(fileExtension) && !file.type.startsWith('image/');
                  });
                  if (invalidExtensions.length > 0) {
                    showNotification('warning', t('common.pleaseSelectValidImageFiles'));
                    return;
                  }
                  
                  // Helper function to convert HEIC to JPEG
                  const convertHeicToJpeg = async (file: File): Promise<File> => {
                    try {
                      const fileExtension = file.name.split('.').pop()?.toLowerCase();
                      if (fileExtension === 'heic' || fileExtension === 'heif' || file.type === 'image/heic' || file.type === 'image/heif') {
                        const convertedBlob = await heic2any({
                          blob: file,
                          toType: 'image/jpeg',
                          quality: 0.9,
                        });
                        const convertedFile = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
                        return new File([convertedFile], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
                      }
                      return file;
                    } catch (error) {
                      console.error('Error converting HEIC:', error);
                      throw new Error('Failed to convert HEIC file. Please try converting it to JPEG first.');
                    }
                  };

                  // Compress images before adding
                  const compressImage = async (file: File): Promise<string> => {
                    // Convert HEIC to JPEG first if needed
                    const processedFile = await convertHeicToJpeg(file);
                    
                    return new Promise((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = (e) => {
                        const img = new Image();
                        img.onload = () => {
                          const canvas = document.createElement('canvas');
                          let width = img.width;
                          let height = img.height;

                          // Calculate new dimensions (max 1200x1200 for service images)
                          const maxDimension = 1200;
                          if (width > height) {
                            if (width > maxDimension) {
                              height = (height * maxDimension) / width;
                              width = maxDimension;
                            }
                          } else {
                            if (height > maxDimension) {
                              width = (width * maxDimension) / height;
                              height = maxDimension;
                            }
                          }

                          canvas.width = width;
                          canvas.height = height;

                          const ctx = canvas.getContext('2d');
                          if (!ctx) {
                            reject(new Error('Could not get canvas context'));
                            return;
                          }

                          ctx.drawImage(img, 0, 0, width, height);
                          // Compress to JPEG with 0.75 quality for smaller file size
                          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.75);
                          resolve(compressedBase64);
                        };
                        img.onerror = (error) => {
                          console.error('Image load error:', error);
                          reject(new Error('Failed to load image. Please ensure it is a valid image file.'));
                        };
                        img.src = e.target?.result as string;
                      };
                      reader.onerror = reject;
                      reader.readAsDataURL(processedFile);
                    });
                  };
                  
                  const newImages: string[] = [];
                  for (const file of files) {
                    try {
                      const compressedDataUrl = await compressImage(file);
                      newImages.push(compressedDataUrl);
                    } catch (error) {
                      console.error('Error compressing file:', error);
                      // Fallback: use original file if compression fails
                      try {
                        const reader = new FileReader();
                        const dataUrl = await new Promise<string>((resolve, reject) => {
                          reader.onload = (e) => resolve(e.target?.result as string);
                          reader.onerror = reject;
                          reader.readAsDataURL(file);
                        });
                        newImages.push(dataUrl);
                      } catch (fallbackError) {
                        console.error('Error reading file:', fallbackError);
                      }
                    }
                  }
                  
                  if (newImages.length > 0) {
                    setServiceForm({
                      ...serviceForm,
                      gallery_urls: [...serviceForm.gallery_urls, ...newImages],
                      image_url: serviceForm.image_url || newImages[0] || ''
                    });
                  }
                }}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              {/* Display existing images */}
              {serviceForm.gallery_urls.length > 0 && (
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {serviceForm.gallery_urls.map((url, idx) => (
                    <div key={idx} className="relative group">
                      <img 
                        src={url} 
                        alt={`Service image ${idx + 1}`} 
                        className="w-full h-20 object-cover rounded border border-gray-200" 
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const newUrls = serviceForm.gallery_urls.filter((_, i) => i !== idx);
                          setServiceForm({
                            ...serviceForm,
                            gallery_urls: newUrls,
                            image_url: newUrls[0] || ''
                          });
                        }}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={serviceForm.is_public}
                onChange={(e) => setServiceForm({ ...serviceForm, is_public: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">{t('service.public')}</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={serviceForm.is_active}
                onChange={(e) => setServiceForm({ ...serviceForm, is_active: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">{t('service.active')}</span>
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="submit" fullWidth>
              {editingService ? t('common.save') : t('common.add')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              fullWidth
              onClick={() => {
                setIsServiceModalOpen(false);
                setEditingService(null);
                resetServiceForm();
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isCategoryModalOpen}
        onClose={() => {
          setIsCategoryModalOpen(false);
          setEditingCategory(null);
          resetCategoryForm();
        }}
        title={editingCategory ? t('service.editCategory') : t('service.categories')}
      >
        <div className="space-y-4">
          {!editingCategory && categories.length > 0 && (
            <div className="mb-6">
              <h4 className="font-medium mb-3">{t('service.categories')}</h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {categories.map((cat) => (
                  <div key={cat.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="font-medium">
                        {i18n.language === 'ar' ? cat.name_ar : cat.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {i18n.language === 'ar' ? cat.name : cat.name_ar}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openEditCategory(cat)}
                        icon={<Edit className="w-3 h-3" />}
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => deleteCategory(cat.id)}
                        icon={<Trash2 className="w-3 h-3" />}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium mb-3">{t('service.addCategory')}</h4>
              </div>
            </div>
          )}

          <form onSubmit={handleCategorySubmit} className="space-y-4">
            <Input
              label={t('service.categoryNameEnglish')}
              value={categoryForm.name}
              onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
              required
              placeholder={t('service.categoryNameEnglishPlaceholder')}
            />

            <Input
              label={t('service.categoryNameArabic')}
              value={categoryForm.name_ar}
              onChange={(e) => setCategoryForm({ ...categoryForm, name_ar: e.target.value })}
              required
              dir="rtl"
              placeholder="اسم الفئة بالعربية"
            />

            <div className="flex gap-3 pt-4">
              <Button type="submit" fullWidth>
                {editingCategory ? t('common.save') : t('common.add')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                fullWidth
                onClick={() => {
                  setIsCategoryModalOpen(false);
                  setEditingCategory(null);
                  resetCategoryForm();
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setSelectedServiceForSchedule(null);
          setEditingShift(null);
          resetShiftForm();
        }}
        title={`Schedule: ${selectedServiceForSchedule ? (i18n.language === 'ar' ? selectedServiceForSchedule.name_ar : selectedServiceForSchedule.name) : ''}`}
      >
        <div className="space-y-4">
          {(hideServiceSlots || selectedServiceForSchedule?.scheduling_type === 'employee_based') ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
              {t('service.employeeBasedScheduleMessage', 'This service is employee-based. Availability is determined by the working shifts of employees assigned to this service. Configure employee shifts in Settings → Employees.')}
            </div>
          ) : shifts.length > 0 && !editingShift ? (
            <div className="mb-6">
              <h4 className="font-medium mb-3">Existing Shifts</h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {shifts.map((shift) => (
                  <div key={shift.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{formatTimeTo12Hour(shift.start_time_utc)} - {formatTimeTo12Hour(shift.end_time_utc)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          shift.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {shift.is_active ? t('service.active') : t('service.inactive')}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600">
                        {shift.days_of_week.sort().map(day =>
                          i18n.language === 'ar' ? dayNamesAr[day] : dayNames[day]
                        ).join(', ')}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => regenerateSlots(shift.id)}
                        icon={<Clock className="w-3 h-3" />}
                        title={t('service.regenerateTimeSlots')}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openEditShift(shift)}
                        icon={<Edit className="w-3 h-3" />}
                      />
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => deleteShift(shift.id)}
                        icon={<Trash2 className="w-3 h-3" />}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium mb-3">{editingShift ? t('service.editShift') : t('service.addNewShift')}</h4>
              </div>
            </div>
          ) : null}

          {!hideServiceSlots && selectedServiceForSchedule?.scheduling_type !== 'employee_based' && (
          <form onSubmit={handleShiftSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('service.daysOfWeek')} *
              </label>
              <div className="grid grid-cols-2 gap-2">
                {dayNames.map((day, index) => (
                  <label key={index} className="flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={shiftForm.days_of_week.includes(index)}
                      onChange={() => toggleDay(index)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm">
                      {i18n.language === 'ar' ? dayNamesAr[index] : day}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                type="time"
                label="Start Time *"
                value={shiftForm.start_time}
                onChange={(e) => setShiftForm({ ...shiftForm, start_time: e.target.value })}
                required
              />
              <Input
                type="time"
                label="End Time *"
                value={shiftForm.end_time}
                onChange={(e) => setShiftForm({ ...shiftForm, end_time: e.target.value })}
                required
              />
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={shiftForm.is_active}
                onChange={(e) => setShiftForm({ ...shiftForm, is_active: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Active</span>
            </label>

            <div className="flex gap-3 pt-4">
              <Button type="submit" fullWidth disabled={shiftForm.days_of_week.length === 0}>
                {editingShift ? t('service.updateShift') : t('service.addShift')}
              </Button>
              {editingShift && (
                <Button
                  type="button"
                  variant="secondary"
                  fullWidth
                  onClick={() => {
                    setEditingShift(null);
                    resetShiftForm();
                  }}
                >
                  Cancel Edit
                </Button>
              )}
            </div>
          </form>
          )}
        </div>
      </Modal>
    </div>
  );
}
