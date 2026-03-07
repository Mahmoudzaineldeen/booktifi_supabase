# RBAC Test Scenarios

Run these manually or automate against a running server and seeded DB.

**Full test plan:** See [RBAC_COMPREHENSIVE_TEST_PLAN.md](./RBAC_COMPREHENSIVE_TEST_PLAN.md) for the complete 10-step test plan (permissions load, single/negative permission tests, category validation, role lifecycle, branch isolation, module compatibility, API security, performance).

**Automated API tests:** `npm run test:rbac` (or `npx vitest run tests/rbac`) runs `tests/rbac/rbac-api.test.ts` against a live backend. Set `TEST_ADMIN_EMAIL` and `TEST_ADMIN_PASSWORD` (or use test@gmail.com / 111111) and ensure the API is running at `API_BASE_URL` or `http://localhost:3001`.

---

## Core rule: one category per role

A role must be either **Admin** or **Employee**; it cannot mix permissions from both categories. The system enforces this in the UI, API, and database.

---

## Category enforcement tests

### Test 1: Create Admin role → only Admin permissions visible

1. Go to Role Management → Create role.
2. Select **Category: Admin Role**.
3. Verify only **Admin permissions** are shown (Manage branches, Manage services, Manage roles, etc.).
4. Create the role with some admin permissions. Save.
5. Edit the role: category should still be Admin and only admin permissions listed.

### Test 2: Create Employee role → only Employee permissions visible

1. Create role, select **Category: Employee Role**.
2. Verify only **Employee permissions** are shown (Create booking, Edit booking, Sell packages, etc.).
3. Create the role and assign to an employee. Confirm the employee can only have Receptionist/Cashier/Coordinator/Employee user types (not Admin types).

### Test 3: Mixing Admin + Employee permissions via API → rejected

1. Obtain a valid JWT (e.g. tenant_admin).
2. `POST /api/roles` with body: `{ "name": "Mixed", "category": "admin", "permission_ids": ["manage_branches", "create_booking"] }` (one admin + one employee permission).
3. Expect **400** with error: `Invalid role configuration. A role cannot include both Admin and Employee permissions.`
4. Same for `PUT /api/roles/:id` if you try to set permission_ids that span both categories.

### Test 4: Assign Admin role to employee user type → blocked

1. Create a custom role with **Category: Admin** and assign only admin permissions.
2. In Employees, try to create/update a user and assign this admin role but set **user type** to Receptionist (or any employee-type).
3. Expect **400** with message that admin roles can only be assigned to Admin/Manager/Supervisor user types (tenant_admin, admin_user, customer_admin).

### Test 5: Assign Employee role to receptionist → allowed

1. Create or use a role with **Category: Employee** (e.g. built-in Receptionist or a custom employee role).
2. Create/update an employee, assign this role, and set user type to Receptionist (or Cashier, Coordinator, Employee).
3. Expect **200** and the user is saved with that role and legacy role.

### Test 6: Edit role and attempt cross-category permission → blocked

1. Create an Admin role with some admin permissions. Save.
2. Call `PUT /api/roles/:id` with the same role id and `permission_ids` that include an employee permission (e.g. `create_booking`).
3. Expect **400** with error: `Invalid role configuration. A role cannot include both Admin and Employee permissions.`
4. In the UI: try to change **Category** from Admin to Employee (or vice versa) while the role has permissions. The category dropdown should be **disabled** and show: "Remove all permissions first to change category."
5. Clear all permissions, then change category; save. Then add permissions for the new category. Should succeed.

---

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
