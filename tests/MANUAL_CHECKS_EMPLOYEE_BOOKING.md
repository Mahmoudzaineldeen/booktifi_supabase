# Manual checks: Employee-based booking & reception display

Run these in the app (reception + admin) after deploying the latest changes.

---

## 1. Employee-based mode: only employee slots

**Steps:**

1. **Admin → Settings** (or Tenant Features): set **Scheduling mode** to **Employee based**. Save.
2. **Admin → Employees**: ensure at least one employee has **Work schedule** (shift days + time range, e.g. Mon–Fri 09:00–18:00). Assign that employee to a service.
3. **Reception** (or public booking): select that service and a date when the employee works.
4. **Expected:** Only time slots that come from that employee’s shift appear. No slots from service-defined shifts.
5. **Admin → Settings**: set **Scheduling mode** back to **Service based**. Save.
6. **Reception**: same service and date.
7. **Expected:** Service-defined slots appear again (if the service has shifts/slots configured).

**Pass:** Employee-based shows only employee slots; switching back shows service slots.

---

## 2. Reception: booking details show employee name

**Steps:**

1. Create a **new booking** in reception with an **assigned employee** (employee-based mode, or a service that assigns an employee).
2. In the **bookings list** (card view): open the booking card.
3. **Expected:** “Employee: [Name]” (e.g. “Ahmed Ali”), not “N/A”. If no employee, “—”.
4. Open **booking details** (e.g. click to open the detail modal).
5. **Expected:** Same: “Employee: [Name]” or “—”.

**Pass:** Employee name appears in list and detail; “—” when no employee.

---

## 3. No double-booking / rotation still works

**Steps:**

1. Keep **Employee based** mode and **Auto assign** (or **Manual**).
2. Create a booking for a given service, date, and time (e.g. 10:00–11:00). Note the assigned employee.
3. Create another booking for the **same** service, date, and time.
4. **Expected:** A different employee is assigned (rotation), or the same employee is not offered again for that slot (no double-booking).
5. If **Manual**: choose an employee from the dropdown, complete booking. **Expected:** Only employees who are free at that time appear.

**Pass:** No double-booking per employee; rotation or manual assignment behaves correctly.

---

## Automated tests (already run)

- **Unit:** `getBookingEmployees` and employee-based availability logic → **18 unit tests passed** (including 7 in `employee-booking-display.test.ts`).
- **Integration:** Booking, invoice, dashboard, Zoho → **35 integration tests passed**.

Run again: `npm run test:unit` and `npm run test:integration`.
