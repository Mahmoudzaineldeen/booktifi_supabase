# Multi-Branch System — Full Test Checklist

Use **Admin**: `mahmoudnzaineldeen@gmail.com` / `111111`.  
For Receptionists/Employees use same email with suffix (e.g. `+r1`, `+e1`) if the system requires unique emails.

---

## STEP 1 — Create Multiple Branches

- [ ] Create **Branch A (Main Branch)** (e.g. location: HQ).
- [ ] Create **Branch B (Second Branch)** (e.g. location: Second).
- [ ] **Verify:** Branches appear in **Admin → Branches** tab.
- [ ] **Verify:** For each branch, **"See More"** opens and shows:
  - Assigned Services, Assigned Packages, Assigned Employees, Assigned Receptionists, Branch income.
- [ ] **Verify:** No UI/console errors.

---

## STEP 2 — Create Services & Assign to Branches

- [ ] **Service 1:** Create in Services, assign to **Branch A only** (multi-select branches).
- [ ] **Service 2:** Create, assign to **Branch B only**.
- [ ] **Service 3:** Create, assign to **both Branch A and Branch B**.
- [ ] **Verify:** Each service shows correct branch assignment when edited.
- [ ] **Verify:** In **Branches → Branch A → See More**, only Service 1 and Service 3 appear under Assigned Services.
- [ ] **Verify:** In **Branches → Branch B → See More**, only Service 2 and Service 3 appear.

---

## STEP 3 — Create Packages (Multi-Branch Rules)

**Case A — Package A (Branch A only) + Service 2 (Branch B only)**  
- [ ] Create **Package A**, assign to **Branch A only**.
- [ ] Try to add **Service 2** (Branch B only) to Package A.
- [ ] **Expected:** Blocked (validation error: service not in selected branches).

**Case B — Package B (Branch A & B) + Service 3 (both branches)**  
- [ ] Create **Package B**, assign to **Branch A and Branch B**.
- [ ] Add **Service 3** (assigned to both branches).
- [ ] **Expected:** Allowed; package saves.

**Case C — Package with service not in selected branches**  
- [ ] Create a package assigned to **Branch A only**, try to add a service that is **only in Branch B**.
- [ ] **Expected:** Backend validation blocks creation/update.

---

## STEP 4 — Create Roles with Branch Assignment

Using Admin account:

- [ ] **Receptionist A:** Create in Employees, role Receptionist, **assign to Branch A**. (Email e.g. `mahmoudnzaineldeen+r1@gmail.com`.)
- [ ] **Receptionist B:** Create, assign to **Branch B**.
- [ ] **Employee A:** Create, role Employee, **assign to Branch A**.
- [ ] **Employee B:** Create, assign to **Branch B**.
- [ ] **Verify:** Branch dropdown is required for these roles; cannot save without selecting a branch.
- [ ] **Verify:** When editing an Employee, only **services from their branch** appear in the service assignment list.

---

## STEP 5 — Data Isolation (Critical)

**Login as Receptionist A (Branch A):**

- [ ] Can see **only** Branch A bookings.
- [ ] Can see **only** Branch A services (where applicable).
- [ ] Can see **only** Branch A packages.
- [ ] Can see **only** Branch A employees (in relevant UIs).
- [ ] Can see **only** Branch A subscribers.
- [ ] **Cannot** see any Branch B data.

**Login as Receptionist B:**

- [ ] Can see **only** Branch B data.
- [ ] No cross-branch leakage.

---

## STEP 6 — Bookings Per Branch

**As Receptionist A:**

- [ ] Create a booking for **Service 1** (Branch A only).
- [ ] **Verify:** Booking is saved with `branch_id` = Branch A (e.g. in DB or in booking detail).
- [ ] **Verify:** Booking appears only in Branch A views.
- [ ] Try to book **Service 2** (Branch B only): **Expected:** Service 2 is not visible / not selectable, or booking is blocked.

**As Receptionist B:**

- [ ] Repeat same logic for Branch B (book Service 2; Service 1 not visible/blocked).

---

## STEP 7 — Package Subscriptions

**As Receptionist A:**

- [ ] **Verify:** Only packages assigned to **Branch A** are visible when creating a subscription.
- [ ] Create a subscription for a Branch A package.
- [ ] **Verify:** Subscription is stored with correct `branch_id` (Branch A).
- [ ] **Verify:** Income/reporting uses `subscription.branch_id` for Branch A.

---

## STEP 8 — Income Filtering

- [ ] Open **Visitor/Reports** (or income/reports) page.
- [ ] **Select Branch A:** Only Branch A income visible.
- [ ] **Select Branch B:** Only Branch B income visible.
- [ ] **Select All Branches:** Combined income; totals are correct and consistent with per-branch sums.

---

## STEP 9 — "See More" Branch Page

For **each** branch (A and B):

- [ ] **Verify:** Correctly shows **Assigned Services**.
- [ ] **Verify:** Correctly shows **Assigned Packages**.
- [ ] **Verify:** Correctly shows **Assigned Employees**, **Assigned Receptionists**.
- [ ] **Verify:** **Branch income** is displayed and correct.
- [ ] **Verify:** Editing branch (name/location) works.

---

## STEP 10 — Database Validation

- [ ] **Verify** `branch_id` column exists and is used on:
  - `bookings`
  - `package_subscriptions`
  - `users`
- [ ] **Verify** `service_branches` and `package_branches` relations: correct rows for services/packages and branches.
- [ ] **Verify:** No orphan records; foreign keys enforced; indexes present for `branch_id` where used in filters.

---

## STEP 11 — Security (API)

- [ ] With a **Branch A receptionist** token, call API to fetch **Branch B** data (e.g. branch detail or Branch B bookings).
- [ ] **Expected:** Backend returns **403** or equivalent; no Branch B data returned.
- [ ] Branch isolation must be **enforced server-side**, not only in the UI.

---

## STEP 12 — Compatibility

- [ ] **Employee-based** scheduling mode works per branch (slots/availability respect branch).
- [ ] **Service-based** scheduling mode works per branch.
- [ ] **Invoice generation** still works for bookings/subscriptions (correct branch context).
- [ ] **Editing a booking** keeps the correct `branch_id`.
- [ ] **Reports** filter correctly per branch.
- [ ] No obvious performance degradation when using branches.

---

## Automated API Test

Run the backend API test (requires backend running and admin account):

```bash
node tests/backend/12-multi-branch-system.test.js
```

This checks:

- Admin login and branch CRUD.
- Branch detail (See More) structure and income.
- Creation of receptionists with branch assignment.
- Login as receptionist and JWT `branch_id`.
- Branch-scoped packages and booking search (200).
- **403** when Receptionist A requests Branch B (and vice versa).
- Income summary in branch detail.
- Package validation (empty `branch_ids` rejected).

---

## Final Checklist

- [ ] Strict branch isolation in place.
- [ ] Multi-branch package rules enforced (service in selected branches).
- [ ] Role-based branch restrictions working.
- [ ] Branch income accurate.
- [ ] Service–package validation correct.
- [ ] Booking flow stable and branch-aware.
- [ ] Security enforced on the backend.
