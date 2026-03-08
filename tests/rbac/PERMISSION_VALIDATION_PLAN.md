# RBAC Permission Validation Plan

This document defines how to validate that every permission in the system works exactly as expected: each permission grants only the intended capability, all other actions remain blocked, backend APIs enforce correctly, and frontend UI hides restricted features.

## Test Account

- **Email:** test@gmail.com  
- **Password:** 111111  

This account must be **tenant_admin** (or have manage_roles) for the automated script to create roles and assign them. The same account is then used as the principal whose permissions are tested.

---

## Step 1 — Load Permission List

**Goal:** Ensure the system exposes all permissions with correct structure.

1. **Fetch permissions** (authenticated):
   - `GET /api/roles/permissions`
2. **Validate each permission has:**
   - `id` (e.g. `cancel_booking`, `manage_services`)
   - `name`
   - `category` (`admin` | `employee`)
   - `description` (optional)

**Automated:** `scripts/validate-rbac-permissions.js` Step 1.

---

## Step 2 — Single-Permission Test (per permission)

For **each** permission in the system:

1. **Create role** with only that permission:
   - Name: e.g. `test_cancel_booking`
   - Category: same as permission
   - `permission_ids`: `[cancel_booking]`
2. **Assign role** to test user (test@gmail.com).
3. **Login** as test user (or use same token; backend resolves from DB).
4. **Verify allowed:**
   - `GET /api/roles/permissions/me` → returns exactly `[cancel_booking]`.
5. **Verify blocked:** Call endpoints that require **other** permissions; expect **403**:
   - e.g. without `create_booking` → `POST /api/bookings` → 403
   - without `manage_employees` → `GET /api/employees/list` → 403
   - without `manage_roles` → `POST /api/roles` → 403
   - without `manage_branches` → `GET /api/branches` → 403

**Automated:** `scripts/validate-rbac-permissions.js` Step 2. Use `RUN_ALL=1` to test every permission.

---

## Step 3 — Negative Permission Test

For at least one permission (e.g. `cancel_booking`):

1. Create role with **all permissions except** that one (e.g. all except `cancel_booking`).
2. Assign to test user.
3. Attempt the restricted action (e.g. cancel a booking).
4. **Expected:** 403 (or 400 if request invalid).

**Automated:** Step 3 in `validate-rbac-permissions.js`.

---

## Step 4 — Frontend UI Validation

When a permission is **missing**, the UI must hide:

- Buttons (e.g. Create Booking, Manage Roles)
- Menu items (Bookings, Employees, Settings, etc.)
- Navigation links to restricted pages

**Manual checks (examples):**

| Missing permission   | Must NOT see / use                                      |
|----------------------|---------------------------------------------------------|
| `create_booking`     | Create Booking button, create booking flow             |
| `manage_roles`       | Roles menu, create/edit role                            |
| `manage_employees`   | Employees menu, add/edit employee                        |
| `manage_services`    | Services menu                                           |
| `manage_branches`    | Branches menu                                           |
| `manage_packages`    | Packages menu                                           |
| `edit_system_settings` | System/tenant settings (restricted section)          |

**Reference:** `TenantLayout.tsx` and page-level `hasPermission()` drive visibility. Permissions come from `GET /api/roles/permissions/me` (resolved from DB per request).

---

## Step 5 — Backend Security Validation

Even if the UI hides features, the backend must enforce permissions. Direct API calls without the required permission must return **403 Forbidden**.

**Examples:**

| Action              | Endpoint / method        | Required permission(s)     |
|---------------------|--------------------------|----------------------------|
| Create booking      | POST /api/bookings       | create_booking, manage_bookings |
| Edit booking        | PATCH /api/bookings/:id  | edit_booking, manage_bookings   |
| Cancel booking      | PATCH /api/bookings/:id (status=cancelled) | cancel_booking, manage_bookings |
| List employees      | GET /api/employees/list  | manage_employees           |
| Create/update role  | POST/PUT /api/roles      | manage_roles               |
| List branches       | GET /api/branches        | manage_branches            |
| Sell packages       | Package/subscription APIs| sell_packages              |
| Update payment      | PATCH payment status     | issue_invoices             |

**Automated:** Step 2 and Step 3 in `validate-rbac-permissions.js` call these endpoints with a token that has only one (or limited) permissions and assert 403 where appropriate.

---

## Step 6 — Role Switch Test

1. Assign role A (e.g. only `cancel_booking`) to test user.
2. Login (or refresh permissions); verify permissions = [role A perms].
3. Assign role B (e.g. only `create_booking`) to the same user.
4. **Without re-login**, call `GET /api/roles/permissions/me` again (backend uses `resolveUserFromDb`).
5. **Expected:** Permissions now reflect role B only; no carryover from role A.

**Automated:** Step 6 in `validate-rbac-permissions.js`.

---

## Step 7 — Category Validation

- **Attempt:** Create a role with mixed permissions, e.g.:
  - `cancel_booking` (employee)
  - `manage_services` (admin)
- **Expected:** Role creation **rejected** (400) with message that permissions must match role category.

**Automated:** Step 7 in `validate-rbac-permissions.js`.

---

## Step 8 — Built-in Role Safety

Verify built-in roles still behave as designed:

- **Receptionist** (built-in): has create_booking, edit_booking, cancel_booking, sell_packages, register_visitors, view_schedules, process_payments, issue_invoices, view_reports.
- **Cashier**, **Coordinator**, **Employee**, **Admin**, **Solution Owner**: unchanged.

**Automated:** Step 8 assigns test user to built-in Receptionist and checks `GET /api/roles/permissions/me` returns the expected set.

---

## Performance Validation

- Permission checks must **not** add noticeable API latency.
- Permissions are resolved **once per request** (via `resolveUserFromDb` or `getPermissionsForUserByUserId`), not per middleware or per permission check.
- No repeated DB queries for the same user in a single request.

**Manual:** Run the validation script and confirm total run time is acceptable; monitor server logs for duplicate user/permission queries if needed.

---

## Running the Automated Suite

**Requirement:** The **admin** account (used to create roles and assign them) must be **tenant_admin** or have **manage_roles**. If you use a single account (test@gmail.com) for both admin and test user, ensure that account is tenant_admin before running (e.g. set `role = 'tenant_admin'` and `role_id = NULL` in DB if it was left as a custom role).

```bash
# From project root; API server must be running (e.g. cd server && npm run dev)
node scripts/validate-rbac-permissions.js

# Two accounts: admin never has role changed, test user gets roles assigned
TENANT_ADMIN_EMAIL=admin@example.com TENANT_ADMIN_PASSWORD=xxx TEST_EMAIL=test@gmail.com TEST_PASSWORD=111111 node scripts/validate-rbac-permissions.js

# Test all permissions (not just a sample)
RUN_ALL=1 node scripts/validate-rbac-permissions.js

# Custom API URL
API_BASE_URL=http://localhost:3001 node scripts/validate-rbac-permissions.js
```

**Expected:** All steps pass; script exits 0. Any failure exits 1 and reports which check failed.

---

## Permission ↔ Capability Reference

| Permission ID           | Category  | Intended capability                    |
|-------------------------|-----------|----------------------------------------|
| manage_branches         | admin     | Create, edit, delete branches           |
| manage_services         | admin     | Create, edit, delete services           |
| manage_packages         | admin     | Manage packages                         |
| manage_employees        | admin     | Create, edit, delete employees         |
| manage_shifts           | admin     | Manage employee shifts                  |
| manage_bookings         | admin     | Full booking management                |
| view_reports            | admin     | Access reports and analytics           |
| manage_roles            | admin     | Create, edit, disable, delete roles    |
| view_income             | admin     | View income and financial data         |
| access_support_tickets  | admin     | View and manage support tickets        |
| edit_system_settings    | admin     | Edit tenant/system settings            |
| create_booking         | employee  | Create new bookings                    |
| edit_booking           | employee  | Edit existing bookings                 |
| cancel_booking         | employee  | Cancel bookings                        |
| sell_packages          | employee  | Sell packages to customers             |
| register_visitors      | employee  | Register and manage visitors           |
| view_schedules         | employee  | View schedules                         |
| process_payments        | employee  | Process payments                       |
| issue_invoices         | employee  | Update payment status / issue invoices |

This plan ensures each permission grants only the intended capability, all other actions remain blocked, backend and frontend stay in sync, and role switching and category rules behave correctly.
