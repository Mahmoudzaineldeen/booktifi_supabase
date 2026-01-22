# Task Implementation Plan

## Current Status Analysis

### TASK 1: Railway Backend ✅
- **Status**: Already implemented
- **Evidence**: `src/lib/apiUrl.ts` defaults to Railway backend
- **Action**: Verify no hardcoded localhost URLs in production code

### TASK 2: QR Code Structure ✅
- **Status**: Already correct
- **Evidence**: QR code contains only `bookingId` (line 66 in pdfService.ts)
- **Action**: Add validation to ensure booking_id format is correct

### TASK 3: External vs Internal QR Scanner
- **Status**: Needs implementation
- **Current**: Only internal scanner exists (manual input)
- **Action**: 
  - Create external QR scanner page (read-only booking details)
  - Ensure internal scanner modifies state correctly

### TASK 4: Camera API QR Scanner
- **Status**: Not implemented
- **Current**: Only manual text input
- **Action**: Implement camera-based QR scanning using Browser Camera API

### TASK 5: Role-Based Access
- **Status**: Partially implemented
- **Action**: Review and enforce all role restrictions

### TASK 6: Auto-fill by Phone
- **Status**: Needs verification/fix
- **Action**: Check existing auto-fill logic

### TASK 7: Invoice Access for Receptionist
- **Status**: Needs implementation
- **Action**: Add invoice download permission for receptionist

### TASK 8: Booking Time Editing
- **Status**: Needs implementation
- **Action**: Add time editing for tenant owner only

### TASK 9: Ticket Invalidation & Regeneration
- **Status**: Needs implementation
- **Action**: Invalidate old ticket, generate new one on time change

### TASK 10: Customer Notification
- **Status**: Needs implementation
- **Action**: Send notification when ticket is regenerated

### TASK 11: Payment Status Sync
- **Status**: Already implemented
- **Action**: Verify it works correctly
