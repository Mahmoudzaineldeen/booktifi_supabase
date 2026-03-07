# RBAC Comprehensive Test Plan

**Test account:** `test@gmail.com` / `111111`  
Use this account to assign different roles during testing.

**Objectives:**
- Permissions work correctly when enabled and block when disabled
- Role category restrictions enforced (Admin vs Employee cannot mix)
- UI access matches backend access
- Existing features still work; branch isolation intact; no permission bypass

---

## Prerequisites

- [ ] Migrations applied: `20260308000000_rbac_roles_and_permissions.sql`, `20260308100000_rbac_role_permission_category_trigger.sql`
- [ ] Backend running (e.g. `npm run dev:backend` or `cd server && npm run dev`)
- [ ] Frontend running (e.g. `npm run dev:frontend`)
- [ ] At least one tenant; test user `test@gmail.com` exists and can be edited (e.g. by tenant_admin)
- [ ] One or more branches and services for booking/branch tests

---

## STEP 1 — Load Permissions

**Goal:** Verify the system exposes a complete, categorized list of permissions.

### 1.1 API

1. Log in as a user with access to Role Management (e.g. tenant_admin or user with `manage_roles`).
2. `GET /api/roles/permissions` with valid `Authorization: Bearer <token>`.
3. **Expected:** `200`, body `{ permissions: [...] }`.

### 1.2 Structure

For each permission object, verify:

| Field        | Type   | Required |
|-------------|--------|----------|
| `id`        | string | ✓        |
| `name`      | string | ✓        |
| `category`  | string | ✓        |
| `description` | string \| null | optional |

**Categories:** Every permission has `category` = `"admin"` or `"employee"`.

### 1.3 Expected permission IDs (reference)

**Admin:**  
`manage_branches`, `manage_services`, `manage_packages`, `manage_employees`, `manage_shifts`, `manage_bookings`, `view_reports`, `manage_roles`, `view_income`, `access_support_tickets`, `edit_system_settings`

**Employee:**  
`create_booking`, `edit_booking`, `cancel_booking`, `assign_employee_to_booking`, `sell_packages`, `create_subscriptions`, `register_visitors`, `view_schedules`, `process_payments`, `issue_invoices`

### Checklist

- [ ] Response is 200 and contains `permissions` array
- [ ] Each permission has `id`, `name`, `category`
- [ ] All admin permissions have `category: "admin"`
- [ ] All employee permissions have `category: "employee"`
- [ ] No permission has a category other than `admin` or `employee`

---

## STEP 2 — Single Permission Testing

**Goal:** For each permission, a role with **only** that permission allows the related action and blocks others.

### Process (repeat for each permission or a representative subset)

1. **Create role:** Name e.g. `test_<permission_id>`, category = permission’s category, **only** that permission enabled.
2. **Assign to test user:** In Employees, set test user (test@gmail.com) to this role and correct **User type** (e.g. Receptionist for employee roles).
3. **Log in as test@gmail.com.**
4. **Allowed:** Perform the action that matches the permission → **must succeed** (UI and API).
5. **Blocked:** Try other actions (e.g. other permissions’ features) → **must be blocked** (UI hidden or API 403).

### Example: `create_booking`

| Action            | Expected |
|-------------------|----------|
| Create booking    | ✔ Allowed |
| Edit booking      | ❌ Blocked |
| Cancel booking    | ❌ Blocked |
| Admin pages (roles, branches, etc.) | ❌ Blocked |

### Checklist (sample permissions)

- [ ] `create_booking` only → can create booking; cannot edit/cancel; no admin access
- [ ] `edit_booking` only → can edit booking; cannot create/cancel without create/cancel permission
- [ ] `manage_roles` only (admin) → can access Role Management; employee-only features blocked per backend
- [ ] `view_schedules` only → can view schedules; cannot create booking if that requires create_booking
- [ ] (Optional) Repeat for other permissions as needed

---

## STEP 3 — Negative Permission Test

**Goal:** A role that has **all permissions except one** must **not** allow that one action.

### Process (example: cancel_booking)

1. Create role e.g. `test_without_cancel_booking` (employee), add all employee permissions **except** `cancel_booking`.
2. Assign role to test@gmail.com (User type e.g. Receptionist).
3. Log in as test@gmail.com.
4. Try to cancel a booking (UI and/or API).

**Expected:** ❌ Cancel is blocked (button hidden or API 403).

### Checklist

- [ ] Role without `cancel_booking` → user cannot cancel bookings
- [ ] Role without `create_booking` → user cannot create bookings (and UI reflects it)
- [ ] Role without `manage_roles` → user cannot access Role Management
- [ ] (Optional) Repeat for other critical permissions

---

## STEP 4 — Random Role Combinations

**Goal:** Custom roles with multiple permissions from the **same** category behave correctly.

### Example roles

**Role A (employee):** `create_booking`, `edit_booking`, `view_schedules`  
**Role B (admin):** `view_reports`, `manage_services`  
**Role C (employee):** `create_booking`, `sell_packages`, `process_payments`

For each role:

1. Create the role with exactly those permissions.
2. Assign to test user (test@gmail.com), correct User type.
3. Log in as test user.
4. **Expected:** ✔ Allowed features work; ❌ Disallowed features blocked (UI and API).

### Checklist

- [ ] Role A: create/edit booking and view schedules work; cancel, admin features, etc. blocked
- [ ] Role B: view reports and manage services work; employee-only and other admin features as per permissions
- [ ] Role C: create booking, sell packages, process payments work; other actions blocked

---

## STEP 5 — Category Validation (Admin + Employee Cannot Mix)

**Goal:** No role may have both admin and employee permissions.

### 5.1 Frontend

1. Role Management → Create role.
2. Select **Admin** category, add an admin permission, save.
3. Edit role; try to change category to Employee while permissions exist → **Expected:** Category control disabled or change blocked; message e.g. “Remove all permissions first to change category.”
4. Create new role; select Admin; try to add an employee permission → **Expected:** Only admin permissions shown; employee permissions not available.

### 5.2 Direct API

1. Obtain JWT (e.g. tenant_admin).
2. `POST /api/roles` with body:
   - `name`: "MixedRole", `category`: "admin", `permission_ids`: `["manage_branches", "create_booking"]`.

**Expected:** `400` with error indicating invalid role configuration (admin and employee permissions cannot exist in the same role).

3. Create a valid admin role; then `PUT /api/roles/:id` with `permission_ids` including e.g. `create_booking` (employee).

**Expected:** `400` with same type of error.

### Checklist

- [ ] UI prevents mixing categories (only one category’s permissions shown; category change blocked when role has permissions)
- [ ] API rejects mixed permission_ids with 400 and clear message
- [ ] DB trigger rejects mixed insert/update if bypassing app (optional verification)

---

## STEP 6 — Role Lifecycle Testing

### 6.1 Create role

- [ ] Create role with selected permissions
- [ ] Role appears in list; permissions applied (e.g. user with that role has correct access)

### 6.2 Edit role

- [ ] Edit role: add permission → user gains access after refresh or next permission load
- [ ] Edit role: remove permission → user loses access (UI and API)
- [ ] Cannot change category while role has permissions (UI and/or API)

### 6.3 Disable role

- [ ] Disable role that has users assigned
- [ ] All users with that role become inactive (`is_active` = false or equivalent)
- [ ] Disabled user cannot log in

### 6.4 Delete role

- [ ] Delete role **with** users assigned → **blocked** with clear message (e.g. “Cannot delete role while users are assigned”)
- [ ] Reassign users to another role, then delete → **succeeds**
- [ ] Deleted role no longer in list; users’ `role_id` handled per schema (e.g. set to null)

---

## STEP 7 — Multi-Branch Compatibility

**Goal:** Role permissions do not override branch isolation.

1. Create receptionist (or role with `create_booking`) assigned to **Branch A** only.
2. Log in as that user.
3. **Expected:** ✔ Can create booking for Branch A (services at Branch A).
4. **Expected:** ❌ Cannot access or create bookings for Branch B (enforced by branch_id / scope).

### Checklist

- [ ] User restricted to Branch A cannot create/view bookings for Branch B
- [ ] Branch-scoped APIs (e.g. bookings, services) respect user’s branch
- [ ] Role/permission checks do not bypass branch checks

---

## STEP 8 — Module Compatibility Test

**Goal:** RBAC does not break existing modules; permissions control access.

Test access (as test user with a role that has only the relevant permission) to:

| Module           | Permission(s) to test     | Expected with permission | Expected without |
|------------------|---------------------------|---------------------------|------------------|
| Booking          | create_booking, edit_booking, cancel_booking | Allowed           | 403 / UI hidden  |
| Packages         | sell_packages, manage_packages              | Allowed           | 403 / UI hidden  |
| Services         | manage_services                             | Allowed           | 403 / UI hidden  |
| Branches         | manage_branches                             | Allowed           | 403 / UI hidden  |
| Employees        | manage_employees                            | Allowed           | 403 / UI hidden  |
| Shifts           | manage_shifts                               | Allowed           | 403 / UI hidden  |
| Reports          | view_reports                                | Allowed           | 403 / UI hidden  |
| Visitors         | register_visitors                           | Allowed           | 403 / UI hidden  |
| Support tickets  | access_support_tickets                      | Allowed           | 403 / UI hidden  |
| Role management  | manage_roles                                | Allowed           | 403 / UI hidden  |

### Checklist

- [ ] Booking system: create/edit/cancel and UI match permissions
- [ ] Packages: sell and manage access correct
- [ ] Services, Branches, Employees, Shifts: manage access correct
- [ ] Reports, Visitors, Support tickets, Role management: access correct
- [ ] No module is “open” regardless of role (no permission bypass)

---

## STEP 9 — API Security Test

**Goal:** Direct API requests without the required permission return 403.

1. Log in as test user with a role that **does not** have the permission (e.g. no `create_booking`).
2. Call the relevant API with that user’s JWT.

**Expected:** `403 Forbidden` (and no side effect).

### Endpoints to test (examples)

| Endpoint / action        | Permission typically required | Expected without permission |
|--------------------------|-------------------------------|-----------------------------|
| POST /api/bookings/create | create_booking               | 403                         |
| PUT /api/bookings/:id    | edit_booking                  | 403                         |
| POST /api/bookings/:id/cancel | cancel_booking           | 403                         |
| PUT /api/services/:id    | manage_services               | 403                         |
| DELETE /api/packages/:id or equivalent | manage_packages | 403                 |
| Reports endpoint         | view_reports                  | 403                         |
| GET/POST /api/roles*     | manage_roles                  | 403                         |

### Checklist

- [ ] Booking create/edit/cancel return 403 when permission missing
- [ ] Services, packages, roles, reports return 403 when permission missing
- [ ] No endpoint performs the action and returns 200 without the right permission

---

## STEP 10 — Performance Check

**Goal:** Permission checks do not slow the API; lookup is efficient.

- [ ] Permission or role lookup happens once per request (e.g. from JWT + one DB or cache lookup).
- [ ] No N+1: e.g. not loading permissions per action in a loop.
- [ ] Critical paths (e.g. booking create, login) respond in acceptable time under load (optional: measure with tools).

---

## Final Validation Checklist

- [ ] All permissions tested individually (or representative set) and behave correctly
- [ ] Random role combinations (same category) work as expected
- [ ] Admin and Employee permissions never mix (UI, API, DB)
- [ ] Role edit updates user access (add/remove permissions)
- [ ] Disabled role deactivates users; they cannot log in
- [ ] Delete role blocked when users assigned; allowed after reassign
- [ ] UI and backend permissions match (no UI-only or backend-only checks)
- [ ] Branch isolation still enforced alongside RBAC
- [ ] No API bypass (403 when permission missing)
- [ ] System stable across Booking, Packages, Services, Branches, Employees, Shifts, Reports, Visitors, Support, Role management

---

## Running Automated RBAC Tests

From project root, with backend running and env configured:

```bash
npm run test:rbac
```

Or run the RBAC test file directly:

```bash
npx vitest run tests/rbac/rbac-api.test.ts
```

See `tests/rbac/rbac-api.test.ts` for API-focused tests (permissions list, category validation, 403 behavior).
