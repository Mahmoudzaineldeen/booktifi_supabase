# RBAC Test Scenarios

Run these manually or automate against a running server and seeded DB.

## Prerequisites

- Migration `20260308000000_rbac_roles_and_permissions.sql` applied
- Server running (`npm run dev` in server/)
- At least one tenant and test users

## Test 1: Create role with booking permissions → user can book

1. As tenant_admin, go to Role Management and create a custom role "Booking Clerk" with permissions: `create_booking`, `edit_booking`, `view_schedules`.
2. Create or edit an employee and assign role "Booking Clerk".
3. Log in as that employee and open Bookings. Verify "Create booking" is available and that creating a booking succeeds (POST /api/bookings/create returns 200).

## Test 2: Create role without booking permission → booking blocked

1. Create a role "View Only" with only `view_schedules`, `view_reports` (no `create_booking`).
2. Assign "View Only" to an employee. Log in as that user.
3. Open Bookings: "Create booking" button should be hidden (UI).
4. Call POST /api/bookings/create with valid payload and that user's JWT: expect 403 and message "You do not have permission to create bookings."

## Test 3: Disable role → users automatically deactivated

1. Create a role "Temp Role" and assign it to a test user. Note user is active.
2. In Role Management, click "Disable" on "Temp Role". Confirm.
3. Verify: the role is inactive and the user's `is_active` is set to false (user cannot sign in).

## Test 4: Edit role permissions → users immediately updated

1. Assign a role "Editor" (with `edit_booking`) to user A. User A can edit bookings.
2. Edit role "Editor" and remove `edit_booking`. Save.
3. With user A's session, attempt an edit-booking operation: should be denied (403) if that endpoint checks permission; and UI should hide edit when permissions are refetched (e.g. after refresh or next permissions/me load).

## Test 5: Delete role with users → blocked

1. Create a custom role "To Delete" and assign it to at least one user.
2. In Role Management, click "Delete" on "To Delete". Expect error: "Cannot delete role while users are assigned. Remove or reassign users first."
3. Reassign the user to another role, then delete "To Delete": should succeed.

## Test 6: Branch restrictions still apply

1. As a receptionist (or role with `create_booking`) assigned to Branch A only, create a booking for a service at Branch A: success.
2. Attempt to create a booking for a service at Branch B (or pass branch_id B): should be rejected or scoped to Branch A only (branch isolation enforced by existing logic).

## Test 7: UI hides inaccessible features

1. Log in as a user with a role that has only `view_schedules` (e.g. Coordinator).
2. Verify: no "Create booking" button, no Settings, no Role Management, etc. Navigation and actions should reflect permissions (and legacy role checks where not yet replaced by hasPermission).

## Test 8: Backend prevents unauthorized API access

1. Obtain a JWT for a user whose role does not have `create_booking`.
2. POST /api/bookings/create with valid body and that JWT: expect 403.
3. GET /api/roles (list roles) with a user that has no manage_roles: may return 403 or only allowed subset depending on implementation; GET /api/roles/permissions/me should return 200 and list that user's permissions.
