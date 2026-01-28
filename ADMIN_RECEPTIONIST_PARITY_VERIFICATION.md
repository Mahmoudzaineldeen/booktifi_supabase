# Admin vs Receptionist Parity Verification Checklist

Use this checklist to confirm that **Admin Add Booking** and **Admin Add Subscription** mirror the Receptionist flows. **Receptionist pages must not be modified**—they are the source of truth.

---

## Prerequisites

1. Start the app: `npm run dev`
2. Log in as a user with **Receptionist** role (for Reception) and as **Admin / Tenant Admin** (for Admin)
3. Use the same tenant for both flows so data is comparable

---

## Test 1: Add Booking — Layout & Field Order

| # | Check | Receptionist (Reception → Add Booking) | Admin (Bookings → Add booking) | Pass |
|---|--------|----------------------------------------|---------------------------------|------|
| 1.1 | Modal title | "Create New Booking" | Same | ☐ |
| 1.2 | First field | Customer Phone (with country) | Same | ☐ |
| 1.3 | Second field | Customer Name * | Same | ☐ |
| 1.4 | Third field | Customer Email | Same | ☐ |
| 1.5 | Block after email | Package info (green box if customer has package) | Same | ☐ |
| 1.6 | Next | Select Service * (with package remaining 🎁) | Same | ☐ |
| 1.7 | Next | Select Offer (optional) if service has offers | Same | ☐ |
| 1.8 | Next | Visitor Count * + "per ticket" + package warnings | Same | ☐ |
| 1.9 | Next | Notes (textarea) | Same | ☐ |
| 1.10 | Next | Select Date * (8 days or full calendar) | Same | ☐ |
| 1.11 | Next | Available Slots * (grouped by time, "X spots left") | Same | ☐ |
| 1.12 | Next | Slot Selection box (required count, validation message) | Same | ☐ |
| 1.13 | If quantity > 1 | Booking Option (Parallel / Consecutive) | Same | ☐ |
| 1.14 | Buttons | Proceed | Cancel | Same | ☐ |

---

## Test 2: Add Booking — Preview Step

| # | Check | Receptionist | Admin | Pass |
|---|--------|--------------|-------|------|
| 2.1 | Click **Proceed** | Shows preview (Booking Summary) | Same | ☐ |
| 2.2 | Modal title in preview | "Booking Preview" | Same | ☐ |
| 2.3 | Preview sections | Customer info, Service details, Schedule, Notes, Total price | Same | ☐ |
| 2.4 | Package in preview | Shows "Package" / price when covered | Same | ☐ |
| 2.5 | Buttons | "Edit booking" \| "Confirm Booking" | Same | ☐ |
| 2.6 | Edit booking | Returns to form | Same | ☐ |
| 2.7 | Confirm Booking | Creates booking, success message, modal closes | Same | ☐ |

---

## Test 3: Add Booking — Validation & Behavior

| # | Check | Receptionist | Admin | Pass |
|---|--------|--------------|-------|------|
| 3.1 | Phone lookup | Typing phone ≥8 chars triggers lookup, name/email fill | Same | ☐ |
| 3.2 | Package display | If customer has active package, green box with usage | Same | ☐ |
| 3.3 | Partial package | Yellow warning when package covers some but not all tickets | Same | ☐ |
| 3.4 | Package used | Blue notice when package for service is fully used | Same | ☐ |
| 3.5 | Slot selection | Click slot to add; right-click/Ctrl+click to remove (qty>1) | Same | ☐ |
| 3.6 | Slot validation | Message "X more slot(s) required" or "All required slots selected" | Same | ☐ |
| 3.7 | Proceed disabled | Until phone, name, service, date, and valid slot selection | Same | ☐ |
| 3.8 | Single slot (qty=1) | One slot selected; create single booking | Same | ☐ |
| 3.9 | Multi slot (qty>1) | Multiple slots or one slot with enough capacity; create/bulk | Same | ☐ |

---

## Test 4: Add Subscription

| # | Check | Receptionist (Packages → Subscribe / Add subscription) | Admin (Package Subscribers → Add subscription) | Pass |
|---|--------|--------------------------------------------------------|-------------------------------------------------|------|
| 4.1 | Modal | Same modal component (ReceptionSubscribeModal) | Same | ☐ |
| 4.2 | Title | "Subscribe Customer to Package" (or t key) | Same | ☐ |
| 4.3 | Fields | Package select → Customer search → Selected customer → Subscribe \| Cancel | Same | ☐ |
| 4.4 | API | POST /packages/receptionist/subscriptions | Same | ☐ |
| 4.5 | Success | Alert + close + refresh list | Same | ☐ |

---

## Test 5: Receptionist Unchanged

| # | Check | Pass |
|---|--------|------|
| 5.1 | ReceptionPage.tsx — no edits in this task | ☐ |
| 5.2 | ReceptionPackagesPage.tsx — no edits in this task | ☐ |
| 5.3 | ReceptionSubscribeModal.tsx — no edits in this task | ☐ |

---

## Quick parity test (minimal)

1. **Receptionist Add Booking:** Open Reception → click "New" / "Create New Booking" → confirm field order: Phone, Name, Email, [Package], Service, Offer, Visitor count, Notes, Date, Slots, Proceed. Click Proceed → confirm Preview → Confirm Booking.
2. **Admin Add Booking:** Open Bookings (as admin) → "Add booking" → same field order and Preview step.
3. **Receptionist Add Subscription:** Reception Packages → "Subscribe Customer" or "Add subscription" → note modal layout.
4. **Admin Add Subscription:** Package Subscribers → "Add subscription" → same modal and behavior.

---

## Notes

- All changes were made **only in Admin code** (e.g. `BookingsPage.tsx`). Receptionist pages and `ReceptionSubscribeModal` were not modified.
- Admin Add Subscription already used `ReceptionSubscribeModal`, so it is the same UI and API as Receptionist.
- Admin Add Booking was updated to use the same layout, validation, preview step, and APIs (`/bookings/create`, `/bookings/create-bulk`) as Receptionist.
