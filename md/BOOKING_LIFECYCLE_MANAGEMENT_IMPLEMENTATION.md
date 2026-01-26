# Booking Lifecycle Management & Billing Synchronization

## Implementation Summary

This document describes the comprehensive booking lifecycle management system that allows Service Providers (Tenant Owners) to fully control their bookings, including updates, deletions, and payment status changes with automatic Zoho Invoice synchronization.

## ✅ Completed Features

### 1. Authorization & Security

**Strict Role-Based Access Control:**
- Created `authenticateTenantAdminOnly` middleware that **only** allows `tenant_admin` (Service Provider) role
- All booking management endpoints are protected with this middleware
- Employees, receptionists, and customers are explicitly blocked from these operations
- Tenant isolation enforced - Service Providers can only manage bookings within their own tenant

**Location:** `server/src/routes/bookings.ts` (lines 123-165)

### 2. Booking Update Endpoint

**Endpoint:** `PATCH /api/bookings/:id`

**Capabilities:**
- Update booking details: customer name, email, visitor count, total price, status, notes
- Server-side validation for all fields
- Tenant ownership verification
- Audit logging for all changes

**Allowed Fields:**
- `customer_name`
- `customer_email`
- `customer_phone`
- `visitor_count`
- `adult_count`
- `child_count`
- `total_price`
- `status` (pending, confirmed, checked_in, completed, cancelled)
- `notes`
- `employee_id`

**Location:** `server/src/routes/bookings.ts` (lines 1052-1127)

### 3. Booking Deletion Endpoint

**Endpoint:** `DELETE /api/bookings/:id`

**Features:**
- Soft delete implementation (marks booking as canceled)
- Prevents deletion of paid bookings (unless `allowDeletePaid=true` query parameter)
- Adds deletion timestamp to notes for audit trail
- Tenant ownership verification
- Audit logging

**Location:** `server/src/routes/bookings.ts` (lines 1129-1195)

### 4. Payment Status Management

**Endpoint:** `PATCH /api/bookings/:id/payment-status`

**Payment Statuses Supported:**
- `unpaid`
- `awaiting_payment`
- `paid`
- `paid_manual`
- `refunded`

**Note:** `partially_paid` and `canceled` are not supported by the database enum. Use `awaiting_payment` for partial payments and `cancelled` (with double 'l') for booking status.

**State Transition Validation:**
- Prevents invalid transitions (e.g., `refunded` → `paid`)
- Terminal states (`refunded`, `canceled`) cannot transition to other states
- Once `paid`, can only transition to `refunded` or `canceled`

**Location:** `server/src/routes/bookings.ts` (lines 1197-1303)

### 5. Zoho Invoice Synchronization (Critical)

**Automatic Synchronization:**
- When payment status is updated, the linked Zoho Invoice is automatically updated
- Status mapping:
  - `paid` / `paid_manual` → Zoho status: `paid`
  - `partially_paid` → Zoho status: `sent` (partial payments tracked separately)
  - `unpaid` / `awaiting_payment` → Zoho status: `sent`
  - `refunded` / `canceled` → Zoho status: `void`

**Zoho Service Methods:**
- `updateInvoiceStatus()` - Updates invoice status in Zoho
- `getInvoice()` - Retrieves invoice details from Zoho
- Multiple fallback methods for status updates (PUT, mark-as-paid, void endpoints)

**Error Handling:**
- Zoho sync failures are logged but don't block booking updates
- Sync status is returned in API response for frontend display
- Clear error messages for debugging

**Location:** 
- `server/src/services/zohoService.ts` (lines 1367-1470)
- `server/src/routes/bookings.ts` (lines 1270-1295)

### 6. Audit Logging

**Comprehensive Audit Trail:**
- All booking changes are logged to `audit_logs` table
- Logs include:
  - Action type (update, delete, payment_status_update)
  - Old and new values
  - User ID and tenant ID
  - IP address and user agent
  - Timestamp

**Location:** `server/src/routes/bookings.ts` (lines 167-192)

### 7. Frontend Integration

**BookingsPage Enhancements:**
- **Edit Button** - Opens modal to edit booking details
- **Delete Button** - Deletes booking with confirmation
- **Payment Status Dropdown** - Change payment status with real-time Zoho sync
- **Zoho Sync Status Indicator** - Shows success/failure of Zoho synchronization
- **Real-time Updates** - Booking list refreshes after all operations

**Features:**
- Edit modal with form fields for all updatable booking properties
- Confirmation dialog for deletions
- Loading states for all async operations
- Error handling with user-friendly messages
- Bilingual support (English/Arabic)

**Location:** `src/pages/tenant/BookingsPage.tsx`

## API Endpoints

### Update Booking
```http
PATCH /api/bookings/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "customer_name": "Updated Name",
  "customer_email": "updated@example.com",
  "visitor_count": 2,
  "total_price": 150.00,
  "status": "confirmed",
  "notes": "Updated notes"
}
```

### Delete Booking
```http
DELETE /api/bookings/:id?allowDeletePaid=true
Authorization: Bearer <token>
```

### Update Payment Status
```http
PATCH /api/bookings/:id/payment-status
Authorization: Bearer <token>
Content-Type: application/json

{
  "payment_status": "paid"
}
```

**Response includes Zoho sync status:**
```json
{
  "success": true,
  "booking": { ... },
  "zoho_sync": {
    "success": true
  },
  "message": "Payment status updated. Zoho invoice synced."
}
```

## Security Features

1. **Role Restriction:** Only `tenant_admin` can perform these operations
2. **Tenant Isolation:** Service Providers can only manage their own tenant's bookings
3. **JWT Validation:** All requests require valid JWT tokens
4. **State Validation:** Invalid payment status transitions are blocked
5. **Audit Trail:** All changes are logged for compliance

## Data Integrity

1. **State Transitions:** Validated to prevent invalid booking states
2. **Payment Status:** Synchronized with Zoho invoices automatically
3. **Soft Deletes:** Bookings are marked as canceled, not hard-deleted
4. **Related Records:** Invoice, ticket, and notification records are handled safely

## Error Handling

1. **Zoho Sync Failures:** Logged but don't block booking updates
2. **Invalid Transitions:** Clear error messages explaining allowed transitions
3. **Missing Invoices:** Gracefully handles bookings without Zoho invoices
4. **Network Errors:** Retry logic and fallback methods for Zoho API calls

## Testing Recommendations

1. **Update Booking:**
   - Test updating all fields
   - Verify tenant isolation (cannot update other tenant's bookings)
   - Verify audit logs are created

2. **Delete Booking:**
   - Test deletion of unpaid bookings
   - Test deletion of paid bookings (should require `allowDeletePaid=true`)
   - Verify soft delete (status becomes 'canceled')

3. **Payment Status:**
   - Test all valid transitions
   - Test invalid transitions (should be blocked)
   - Verify Zoho invoice sync for each status change
   - Test with missing Zoho invoice (should not fail)

4. **Zoho Synchronization:**
   - Test with valid Zoho connection
   - Test with invalid/expired Zoho tokens
   - Test with missing invoice ID
   - Verify error messages are clear

5. **Authorization:**
   - Test with `tenant_admin` (should succeed)
   - Test with `receptionist` (should fail with 403)
   - Test with `customer` (should fail with 403)
   - Test with invalid token (should fail with 401)

## Files Modified

1. `server/src/routes/bookings.ts` - Added booking management endpoints
2. `server/src/services/zohoService.ts` - Added invoice status update methods
3. `src/pages/tenant/BookingsPage.tsx` - Added UI for booking management

## Next Steps

1. **Testing:** Run comprehensive tests for all endpoints
2. **Documentation:** Update API documentation
3. **Monitoring:** Add metrics for Zoho sync success rates
4. **Notifications:** Consider adding email/WhatsApp notifications for status changes
5. **Bulk Operations:** Consider adding bulk update/delete capabilities

## Notes

- All changes are backward compatible
- Existing booking creation and retrieval endpoints remain unchanged
- Zoho synchronization is non-blocking (booking updates succeed even if Zoho sync fails)
- Audit logs provide full traceability for compliance
