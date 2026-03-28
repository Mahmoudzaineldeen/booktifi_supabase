/**
 * Provider-neutral invoice payload built from a booking (or booking group).
 * Zoho and Daftra adapters map this to their APIs; business rules live here.
 */

export interface UnifiedLineItem {
  name: string;
  description?: string;
  rate: number;
  quantity: number;
  unit?: string;
}

export interface UnifiedBookingInvoice {
  tenant_id: string;
  booking_id: string;
  customer_name: string;
  customer_email?: string;
  customer_phone?: string;
  line_items: UnifiedLineItem[];
  date: string;
  due_date: string;
  currency_code: string;
  notes: string;
  reference_number?: string;
  custom_fields: Record<string, unknown>;
  /** Rich context for Daftra notes / parity with Zoho PDF fields */
  context: {
    booking_id: string;
    package_id?: string | null;
    package_name?: string | null;
    package_subscription_id?: string | null;
    package_remaining_note?: string | null;
    slot_date?: string | null;
    slot_time_range?: string | null;
    duration_minutes?: number | null;
    employee_name?: string | null;
    branch_name?: string | null;
    branch_address?: string | null;
    tenant_name?: string | null;
    payment_summary: string;
    qr_data_json: string;
    offer_label?: string | null;
    internal_invoice_ref: string;
  };
}

export interface UnifiedBookingGroupInvoice {
  tenant_id: string;
  booking_group_id: string;
  primary_booking_id: string;
  customer_name: string;
  customer_email?: string;
  customer_phone?: string;
  line_items: UnifiedLineItem[];
  date: string;
  due_date: string;
  currency_code: string;
  notes: string;
  reference_number?: string;
  booking_count: number;
}
