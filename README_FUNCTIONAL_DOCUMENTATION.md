# gobook — Functional Documentation for UI/UX Designers

**Purpose of this document:**  
This document describes the gobook platform in full: what it does, who uses it, every major feature, and where it appears in the system. It is the **main reference** for all functionalities.

---

## Table of Contents

1. Platform Overview
2. Business Categories the Platform Serves
3. Core System Modules
4. User Types
5. Booking Workflow
6. System Navigation — Where Features Exist
7. Why Each Feature Exists
8. Key System Workflows
9. Glossary (key terms)
10. Design considerations (UX patterns)
11. Document control

---

<a id="1-platform-overview"></a>
## 1. Platform Overview

### What Is gobook?

**gobook** is a **business management and appointment booking platform** for service-based businesses. It helps companies that offer appointments (such as haircuts, consultations, or treatments) to:

- Manage their **locations** (branches)
- Define **services** (what they sell, price, duration)
- Manage **staff** (employees who deliver services)
- Control **working hours** (shifts) per branch and per employee
- Let **customers book** appointments (by phone, in person, or online)
- Sell **packages** (bundles of services, e.g. “5 haircuts”)
- Track **payments** (on-site, bank transfer, invoices)
- See **reports** (revenue, bookings, performance)

In short: **gobook = booking + multi-branch + packages/subscriptions + staff scheduling + payments + reports + tickets/invoices + communications**, all in one place.

### The Problem It Solves

Many service businesses still:

- Use paper, spreadsheets, or multiple tools to manage appointments
- Lose track of availability when they have several staff or branches
- Struggle to sell packages and track how many sessions are left
- Have no clear view of revenue by branch, service, or employee

gobook solves this by providing **one platform** where:

- All appointments are in one calendar
- Availability is calculated from staff shifts and existing bookings
- Packages are sold once and usage is tracked automatically
- Payments and invoices can be recorded and (where integrated) sent
- Managers can see performance at a glance

### Who Uses the System?


| Who                                 | What they do                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Business owners / admins**        | Configure branches, services, employees, packages, and settings. View reports.                                 |
| **Receptionists**                   | Create and manage bookings, register visitors, sell packages, process payments.                                |
| **Cashiers**                        | Process payments, issue invoices, sell packages. May use QR scan to find a booking.                            |
| **Coordinators**                    | View schedules, register visitors, view reports. Limited compared to reception.                                |
| **Employees (service providers)**   | See their own schedule and mark bookings as completed.                                                         |
| **Customers**                       | Book online (or are booked by staff), buy packages, view their history (if customer accounts are used).        |
| **Platform owner (Solution Owner)** | Manages all businesses on the platform, handles support tickets, and can enable/disable features per business. |


### Main Value of the Platform

- **For the business:** One place to run appointments, staff, branches, packages, and payments; less double-booking and manual tracking; automated tickets and invoices; self-service tenant signup with trial.
- **For staff:** Clear schedules and simple screens (reception, cashier, employee) so they can focus on service; in-app notifications (toasts) for success and errors.
- **For customers:** Easy online booking (as guest with phone verification or as logged-in customer), optional package purchase, invoice history and download; consistent experience (including bilingual English/Arabic and RTL support, tenant currency and time zone).

### Language and RTL (localization)

The platform supports **two languages**, **English** and **Arabic**. Users can switch language via a **language toggle** (e.g. in the header or layout). When Arabic is selected, the interface uses **RTL (right-to-left)** layout so that text, navigation, and forms align correctly. Dates, numbers, and currency can be formatted according to locale. Designers should ensure that all key screens work in both directions and that the language switcher is easy to find (e.g. on public pages, in admin, and in customer area).

### Preview: viewing the public site

From the **tenant admin sidebar**, staff with the right permissions can open **“View Booking Page”** or **“View Customer Page”** (in a new tab) to see exactly what customers see on the public booking and customer landing pages. This is useful for checking branding, content, and maintenance mode. If maintenance mode is on, a warning may be shown when opening these links. Designers can treat these as the main “preview” entry points for the public experience.

---

<a id="2-business-categories-the-platform-serves"></a>
## 2. Business Categories the Platform Serves

When a business signs up, they choose an **industry**. The platform is flexible and can support many appointment-based industries. The following are the main categories the system is designed for:


| Category               | Typical use case                           | Why the platform fits                                                | Most relevant features                                  |
| ---------------------- | ------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------- |
| **Restaurant**         | Table reservations, private dining, events | Time slots, capacity, multiple branches                              | Branches, services, bookings, capacity                  |
| **Salon**              | Hair, beauty, nails                        | Multiple staff, different services, packages (e.g. 5 haircuts)       | Employees, services, packages, shifts, booking by staff |
| **Clinic**             | Medical or wellness appointments           | Appointments per practitioner, duration, possibly multiple locations | Branches, employees, services, bookings, reports        |
| **Parking**            | Reserved parking slots by time             | Time-based availability                                              | Services (as “slot types”), branches, bookings          |
| **Venue**              | Event spaces, halls, studios by time slot  | Capacity and time slots                                              | Branches, services, bookings, calendar                  |
| **Touristic venue**    | Tours, activities, timed entries           | Slots and capacity per branch                                        | Same as venue; multi-branch and reports                 |
| **Work space**         | Desk or room booking by time               | Slots and capacity                                                   | Services, branches, bookings                            |
| **Technical services** | Repairs, installations, consultations      | Appointment scheduling, possibly multiple technicians                | Employees, services, branches, bookings                 |
| **Other**              | Any appointment-based business             | Same core: services, time, staff, locations                          | All modules as needed                                   |


For **each category**, the business can:

- Create **branches** (locations)
- Define **services** (what is offered, price, duration)
- Assign **employees** to branches and services
- Set **shifts** (working hours) per branch or per employee
- Use **packages** if they sell bundles (e.g. “10 sessions”)
- Use **reports** to see revenue and performance

The UI/UX designer can treat these categories as **personas**: different industries may emphasize different parts of the app (e.g. salons → packages and employee selection; clinics → strict scheduling and reporting).

---

<a id="3-core-system-modules"></a>
## 3. Core System Modules

This section describes every major part of the system: what it is for, how it benefits the business, and where it appears in the product.

**Summary of all modules:**  
Branch Management · Service Management · Employee Management · Shift Management · Booking System · Package System · Customer Management · Payment & Cashier · Role & Permission System · Multi-Branch System · Ticket System (Support) · Reports & Analytics · Offers · Settings · Landing Page Builder · Reviews & Testimonials · Ticket & Invoice Delivery · Authentication, Verification & Communications · Currency & Time Zone

---

### 3.1 Branch Management

**Purpose:**  
Allow businesses with **multiple locations** to manage each location separately (services, staff, working hours, income).

**Why it exists:**  
Without branches, everything would be mixed. With branches, the business can:

- Offer different services per location
- Assign staff to specific locations
- Set different working hours per location
- Track income per branch in reports

**Where it appears:**

- **Admin:** “Branches” in the sidebar → list of branches and branch detail pages (e.g. `/{company}/admin/branches`, `/{company}/admin/branches/:branchId`).

**Key concepts:**

- **Branch** = one physical (or logical) location.
- Each branch can have: name, address, **branch shifts** (default working days and hours), and assignments of **services** and **packages**.
- Reports and filters (e.g. visitors, package subscribers) can often be filtered by branch.

**Impact on workflow:**  
When creating a service or package, the business assigns it to one or more branches. When creating a booking or selling a package, the branch context (e.g. which branch the receptionist is in) can restrict which services, packages, and employees appear.

---

### 3.2 Service Management

**Purpose:**  
Let the business **define what they offer**: name, price, duration, capacity, and where (which branches) the service is available.

**Why it exists:**  
Services are the “products” that get booked. Every appointment is for one or more services. Without a clear service list, booking and pricing would be inconsistent.

**Where it appears:**

- **Admin:** “Services” in the sidebar → Services page (e.g. `/{company}/admin/services`).

**Key concepts:**

- **Service:**** name (and Arabic name), optional description, **price**, **duration** (minutes), **capacity** (how many customers per time slot, e.g. for group classes).
- **Branch assignment:** A service can be offered at selected branches only.
- **Active/Inactive:** Services can be disabled without deleting them (e.g. seasonal offers).
- **Service badges (public booking):** On the public booking page, services can display optional **badges** (e.g. “Free cancellation,” “Instant confirmation,” “Flexible duration”) to highlight perks. These are visual only and help customers compare options.

**Impact on workflow:**  
When creating a booking, the user selects a service first; the system then shows only employees and time slots that can deliver that service at the chosen branch. Prices and duration come from the service.

---

### 3.3 Employee Management

**Purpose:**  
Manage **staff members** who deliver services: link them to a user account, assign them to branches and services, and (in employee-based scheduling) to shifts.

**Why it exists:**  
Bookings are assigned to employees. The business needs to define who can do what and where, so the system can show correct availability and prevent double-booking.

**Where it appears:**

- **Admin:** “Employees” in the sidebar → Employees page (e.g. `/{company}/admin/employees`).

**Key concepts:**

- **Employee:** Linked to a **user** (login account). Has branch assignment, **role**, and **service assignments** (which services this person can perform).
- **Service assignment:** Per employee, the business can override **duration** and **capacity** for a service (e.g. one stylist does 30-min haircuts, another 45).
- **Employee-based scheduling:** When the business uses “employee-based” scheduling, each employee has their own **shifts** (see Shift Management). The “Employee Shifts” page appears in admin.

**Impact on workflow:**  
Reception (or the public booking flow) selects a service and optionally an employee. The system only shows time slots where that employee (or any eligible employee in automatic mode) is available and has capacity.

---

### 3.4 Shift Management

**Purpose:**  
Define **working hours** so the system knows when appointments can be booked. Shifts can be defined at **branch** level (default hours) and, in employee-based mode, at **employee** level (custom hours per person).

**Why it exists:**  
Without shifts, the system would not know which time slots are valid. Shifts drive the generation or calculation of available slots.

**Where it appears:**

- **Admin – Branch detail:** Branch shifts (days of week + start/end time) are configured per branch.
- **Admin:** “Employee Shifts & Assignments” in the sidebar (e.g. `/{company}/admin/employee-shifts`) when the business uses **employee-based scheduling**. Here the business sets or edits each employee’s working days and times; branch default shifts can be used as a reference.

**Key concepts:**

- **Branch shifts:** For each branch, the business sets which **days of the week** and **start/end times** the branch is open. This is the default for “when we are available.”
- **Employee shifts (employee-based mode):** Each employee can have their own schedule (days + times). This allows part-time staff, different start/end times, etc. Slots are then based on employee availability.
- **Service-slot-based mode:** Some configurations may derive slots from service/branch configuration rather than per-employee shifts; in that case the “Employee Shifts” page may be hidden.

**Impact on workflow:**  
When a customer or receptionist picks a date and (optionally) an employee, the system only offers time slots that fall within the relevant shifts and are not fully booked.

---

### 3.5 Booking System

**Purpose:**  
Create, edit, and manage **customer appointments**. Supports single bookings, **parallel** bookings (multiple employees at the same time), **consecutive** bookings (same employee, back-to-back slots), and mixed scenarios.

**Why it exists:**  
Appointments are the core transaction: “Customer X has service Y at time Z with employee W.” The booking system ensures slots are reserved, capacity is updated, and (if used) package credits are deducted.

**Where it appears:**

- **Reception:** Main reception page (e.g. `/{company}/reception`) — primary place to create and manage bookings for the day.
- **Admin:** “Bookings” in the sidebar (e.g. `/{company}/admin/bookings`) — view and manage all bookings, filters, calendar.
- **Public:** `/{company}/book` and related flows (service selection → date → time → checkout) for customer self-service.
- **Employee:** Employee page shows the employee’s **assigned** bookings; they can mark them completed.

**Key concepts:**

- **Booking:** Links customer (or guest name/phone), service, employee, branch, date/time (slot), **status** (e.g. pending, confirmed, completed, cancelled), **payment status** (unpaid, paid on site, bank transfer).
- **Automatic vs manual employee assignment:** The business can set whether the system suggests an employee automatically or the user must choose. When both are allowed, reception can switch between “Automatic assignment” and “Manual assignment.”
- **Time slot logic:** Slots come from shifts and existing bookings. Once a booking is created, the slot’s available capacity is reduced (or the slot is marked unavailable) so the same slot is not overbooked.
- **Parallel bookings:** One customer, same time, multiple employees (e.g. two stylists at once). Created as multiple bookings grouped together.
- **Consecutive bookings:** Same customer, same employee, several slots in a row (e.g. 10:00, 10:30, 11:00). Also grouped.
- **Booking statuses:** Each booking has a **status** (e.g. pending, confirmed, completed, cancelled) and a **payment status** (Unpaid, Paid on site, Bank transfer). Staff can update these; “completed” is often set by the employee or reception when the service is done.
- **Reschedule (edit booking time):** Authorized staff can **change the date or time** of an existing booking (reschedule to another slot). The system validates the new slot and updates capacity; optionally a new ticket/invoice is generated.
- **Bulk booking creation:** Reception can create **multiple bookings in one action** (e.g. several parallel or consecutive slots). Useful for group appointments or multi-service bookings without repeating the flow for each slot.
- **Booking lock:** During public checkout (or when creating a booking), the system can place a **temporary lock** on the selected slot(s) so that another customer cannot take the same slot while the first is completing the form. Locks **expire** after a short time (e.g. minutes); a background job cleans up expired locks. If the user takes too long, they may see “Lock expired – please select another time.”

**Booking workflow (summary):**  
Select service (and optionally package) → Select date → Select time slot (and employee if manual) → Select or create customer → Set payment status → Preview → Confirm. (See [Section 5](#5-booking-workflow) for full flow.)

---

### 3.6 Package System

**Purpose:**  
Sell **bundles of services** (e.g. “5 haircuts” or “3 sessions of physiotherapy”) with a single price and validity period. The system tracks how many uses are left per service in the package.

**Why it exists:**  
Packages increase upfront revenue and customer commitment. Without a package system, the business would track usage manually. With it, selling and applying a package is integrated into booking and payments.

**Where it appears:**

- **Admin:** “Packages” (e.g. `/{company}/admin/packages`) — create/edit packages: name, price, validity (duration in days), which services are included and with what quantity.
- **Admin:** “Package Subscribers” (e.g. `/{company}/admin/package-subscribers`) — list of customers who bought packages; remaining usage; subscription state.
- **Reception / Cashier:** Sell packages to customers; when creating a booking, optionally “use” a package so one use is deducted.
- **Public:** On the public booking page, packages are listed; clicking one can lead to **Package schedule** (choose date/time for each service in the package) then checkout.

**Key concepts:**

- **Package:** Name, description, total price, **validity period** (e.g. 90 days). Can be **assigned to specific branches** (package not sold or used at other branches).
- **Package services:** Each package contains one or more **services** with a **quantity** (e.g. “Haircut × 5”, “Facial × 1”).
- **Package subscription:** When a customer **buys** a package, a subscription is created (customer, package, branch, purchase date, expiry). **Usage** is tracked per service: each booking that uses the package decrements the remaining quantity for that service.
- **Expiration:** After the validity period, the subscription expires and remaining uses may no longer be available (depending on business rules).
- **Subscription management:** Staff (reception/cashier/admin) can **cancel** a package subscription (e.g. refund case) and **update subscription payment status** (e.g. mark as paid). When a package is sold, an **invoice** can be created/sent (Zoho); the customer or staff can **download** the **subscription invoice** PDF from the package-subscriber flow or customer billing.

**Impact on workflow:**  
Reception/cashier can sell a package and then create bookings that “use” the package (no extra payment for that session). The designer should consider: package list, “remaining sessions” display, and the flow from “buy package” to “book using package.”

---

### 3.7 Customer Management

**Purpose:**  
Keep a **customer database**: contact info, booking history, package subscriptions, and visit tracking. Used when creating bookings, selling packages, and processing payments.

**Why it exists:**  
Repeated customers are identified by phone (or account). History helps staff see past visits and remaining package uses; it also supports reporting and marketing.

**Where it appears:**

- **Reception / Cashier:** Customer is selected or created when making a booking or selling a package (often by **phone lookup**).
- **Admin – Bookings / Package subscribers / Visitors:** Customer data appears in lists and filters.
- **Public – Customer area:** If the business enables customer accounts, customers can log in (e.g. `/{company}/customer/login`) and see **dashboard**, **billing**, and **profile** (e.g. `/{company}/customer/dashboard`, `/{company}/customer/billing`).

**Key concepts:**

- **Customer:** Name, phone (unique per tenant), email, and aggregated info such as total bookings and last booking date.
- **Customer profile:** Logged-in customers can **view and update** their profile (name, email, phone) via the API; the UI can expose this in a “Profile” or “Account” section.
- **Customer billing:** On the **Customer Billing** page (`/{company}/customer/billing`), the customer sees a **list of invoices** (linked to their bookings and Zoho). They can **search**, **paginate**, and **download** each invoice as PDF. Invoices show service name, date, time, amount, payment status. This gives customers a single place for all their receipts and invoices.
- **Visitor:** A “visit” or check-in can be recorded (e.g. for daily headcount or reports). Visitors may be linked to a customer or recorded as a standalone visit.
- **Phone lookup:** When staff enter a phone number, the system can find an existing customer so they don’t create duplicates.

**Impact on workflow:**  
Quick customer search (by phone) speeds up booking and package sales. The designer should consider: search bar, “new customer” vs “existing customer,” and where customer history is shown (booking form, package subscribers, visitors).

---

### 3.8 Payment & Cashier System

**Purpose:**  
Record **how a booking or package was paid** (unpaid, paid on site, bank transfer) and, where integrated, **generate or send invoices** (e.g. via Zoho).

**Why it exists:**  
Businesses need to know what is paid and what is not, and to issue invoices for accounting and compliance. The cashier screen is the main place to mark payments and trigger invoice generation.

**Where it appears:**

- **Reception:** When creating or editing a booking, staff can set **payment status** (Unpaid / Paid on site / Bank transfer). Permissions may allow “issue invoices” (update payment status).
- **Cashier:** Dedicated cashier page (e.g. `/{company}/cashier`). Staff can **scan a booking QR code** (or enter booking ID) to load the booking, then mark it as paid (on site or bank transfer, with optional reference). This can trigger invoice generation.
- **Admin – Bookings:** Payment status is visible and may be editable depending on permissions.

**Key concepts:**

- **Payment status:** Typically: **Unpaid**, **Paid on site**, **Bank transfer** (with optional reference). Display labels may be translated (e.g. “Paid on site”).
- **Invoice:** When a booking is marked paid, the system may create or send an invoice via an external system (e.g. Zoho). Invoice ID may be stored on the booking.
- **Subscription payments:** When a package is sold, the payment is recorded as part of the subscription; branch income reports can include package (subscription) revenue.

**Impact on workflow:**  
Reception and cashier need clear buttons or dropdowns for payment status; cashier needs an obvious “scan QR” or “enter booking ID” entry point and a simple “Mark as paid” flow. The designer should consider: QR scanner prominence, payment method selection, and success feedback.

---

### 3.9 Role & Permission System

**Purpose:**  
Let administrators **control what each user can see and do**: which pages, which actions (create booking, edit service, process payments, etc.). Supports both built-in roles (e.g. Admin, Receptionist, Cashier, Employee) and **custom roles** with a set of permissions.

**Why it exists:**  
Not everyone should access everything. A receptionist doesn’t need to change service prices; a cashier might only need payments and packages. Roles and permissions enforce security and simplify the UI (hide what the user cannot do).

**Where it appears:**

- **Admin:** “Role Management” or “Roles” in the sidebar (e.g. `/{company}/admin/roles`). Here admins create/edit roles, assign **permissions**, and set **category** (e.g. admin vs employee). Users are then assigned a role.
- **Entire app:** Menu items and screens are **shown or hidden** based on the logged-in user’s permissions (e.g. “Manage services,” “Manage bookings,” “View reports,” “Process payments,” “Register visitors”). Some roles (e.g. “admin_user” or “customer_admin”) have restricted access (e.g. no Settings or Landing page).

**Key concepts:**

- **Role:** Name, description, **category** (admin vs employee). Determines which permissions the user has.
- **Permissions:** Fine-grained actions such as: manage_services, manage_bookings, manage_employees, manage_branches, sell_packages, process_payments, issue_invoices (update payment status), register_visitors, view_reports, view_income, manage_roles, manage_shifts, edit_system_settings, create_booking, edit_booking, cancel_booking, access_support_tickets, etc.
- **Built-in vs custom:** The system has predefined roles (Solution Owner, Tenant Admin, Receptionist, Cashier, Coordinator, Employee). Custom roles can be created and assigned to users; the sidebar and API visibility follow the permission set.
- **Disable role:** A role can be **disabled** (deactivated) so that it is no longer assignable or effective; users who already have that role may keep it until an admin reassigns them. **Delete role** is only allowed when **no users** are assigned to that role.

**Impact on workflow:**  
The designer must assume that **the same screen might be visible to one role and hidden from another**. Design for permission-based visibility (e.g. don’t assume everyone sees “Settings” or “Package Subscribers”). Role management UI should make it easy to assign permissions by category and understand what each permission controls.

---

### 3.10 Multi-Branch System

**Purpose:**  
Support businesses with **multiple locations** so that each branch can have its own services, employees, shifts, and income tracking. Data can be isolated or filtered by branch.

**Why it exists:**  
A chain or multi-location business needs to see and manage each location separately. The multi-branch system ensures that configuration (services, employees, shifts) and operational data (bookings, visitors, package subscribers) can be scoped by branch.

**Where it appears:**

- **Admin – Branches:** List and detail pages (see Branch Management).
- **Admin – Services, Packages, Employees:** Branch assignment when creating/editing.
- **Admin – Reports / Dashboard:** Filters or breakdowns by branch (e.g. income per branch).
- **Reception / Cashier:** If the user or session is branch-scoped, only that branch’s services, packages, and employees may be shown.
- **Package subscribers / Visitors:** Often filterable by branch.

**Key concepts:**

- **Branch isolation:** Bookings, package subscriptions, and visitors are associated with a branch. Reports and lists can filter by branch.
- **Branch-specific configuration:** Services and packages are assigned to branches; employees are assigned to branches; shifts are defined per branch (and per employee within that context).

**Impact on workflow:**  
The designer should consider: branch selector at the top of reception/cashier, branch filter in reports and lists, and clear labeling (“Branch: Downtown”) so staff always know which location they are working in.

---

### 3.11 Ticket System (Support System)

**Purpose:**  
Allow **employees (or tenants)** to report **system issues** (bugs, errors, questions). The **Solution Owner** (platform owner) can review tickets, change status (e.g. open, in progress, resolved), and optionally **assign a “fixing” ticket** or **impersonate** the tenant user to debug.

**Why it exists:**  
When something goes wrong, the business needs a way to ask for help. The platform owner needs a single place to see and handle support requests and to reproduce issues in the tenant’s context.

**Where it appears:**

- **Tenant side:** “Assign Fixing Ticket” or similar (e.g. `/{company}/admin/assign-fixing-ticket`, or under reception/cashier). The user can create or link a support ticket so that when the Solution Owner helps, they know which ticket to update.
- **Solution Owner:** “Support Tickets” (e.g. `/solution-admin/support-tickets`). List of tickets per tenant; open, in progress, resolved; assign fixing ticket; impersonate tenant user.

**Key concepts:**

- **Ticket:** Problem description, tenant, status (e.g. open, in progress, resolved). Optionally linked to a “fixing” assignment (who is fixing it).
- **Impersonation:** Solution Owner can “log in as” a tenant user to see the same UI and data and debug issues.
- **Assign fixing ticket:** Links the current support context to a specific ticket so the platform team can track which issue they are working on.

**Impact on workflow:**  
Design a simple “Report a problem” or “Support” entry point for tenant users, and a clear support-ticket list and detail view for the Solution Owner (with status, assign, and “Login as this tenant” action).

---

### 3.12 Reports & Analytics

**Purpose:**  
Give the business **insight into performance**: revenue, number of bookings, package sales, service and employee performance, and trends over time. Filters (e.g. today, last week, last month, custom range) help focus on the right period.

**Why it exists:**  
Managers need to know what is selling, when they are busiest, and how each branch, service, or employee performs. Reports guide pricing, staffing, and promotions.

**Where it appears:**

- **Admin – Dashboard:** Main dashboard (e.g. `/{company}/admin`) shows summary **stats**: total bookings, revenue (booking revenue, package revenue, combined), completed bookings, average booking value. **Time filter:** today, yesterday, last week, last month, custom range. **Charts:** e.g. booking/revenue over time, revenue by service, revenue by employee. **Calendar** and **booking list** for the selected period.
- **Admin – Visitors:** Visitors page can export or filter visits (e.g. by branch, date) — “reports style” filter bar.
- **Reception / Cashier:** If the role has “view reports” permission, they may see a reports widget or link to the dashboard.

**Key concepts:**

- **Metrics:** Bookings count, revenue (from bookings, from packages, total), completed count, average value. Service performance (bookings + revenue per service). Employee performance (bookings + revenue per employee).
- **Time filters:** Predefined (today, yesterday, last week, last month) and custom date range. All main stats and charts respect the selected period.
- **Visualizations:** E.g. bar charts (bookings or revenue by service/employee), pie charts (revenue distribution), time series (daily data). Calendar view of bookings.

**Impact on workflow:**  
Dashboard should be the first thing an admin sees after login (when they land on `/{company}/admin`). Design clear time filters and ensure key numbers (revenue, bookings) are prominent. Consider mobile-friendly summary for managers on the go.

---

### 3.13 Offers (Promotions / Discounts)

**Purpose:**  
Allow the business to define **promotions or discounts** (e.g. percentage off, fixed discount) that can be applied to services or bookings. When creating a booking, the user may select an offer so the price is reduced.

**Why it exists:**  
Promotions drive demand. Having offers in the system keeps pricing consistent and avoids ad-hoc manual discounts.

**Where it appears:**

- **Admin:** “Offers” in the sidebar (e.g. `/{company}/admin/offers`) — create and manage offers.
- **Reception / Public booking:** When selecting a service or at checkout, an offer can be chosen; the price updates accordingly.

**Key concepts:**

- **Offer:** Name, type (e.g. percentage or fixed), value, possibly validity period or conditions. Linked to services or applied at booking time.
- **Application:** At booking creation or checkout, user selects an offer; the system calculates the final price (e.g. base price minus offer).

**Impact on workflow:**  
Design offer selection in the booking flow (dropdown or list) and clear display of “Price before / after offer” so staff and customers understand the discount.

---

### 3.14 Settings

**Purpose:** **Configure the tenant (business)**: time zone, currency, integrations (e.g. Zoho for invoices), maintenance mode, theme/branding, and other system-wide options.

**Why it exists:**  
Each business has different preferences and integrations. Settings centralize configuration so the platform behaves correctly for that tenant (e.g. correct time zone for slots, correct currency symbol, invoice integration).

**Where it appears:**

- **Admin:** “Settings” in the sidebar (e.g. `/{company}/admin/settings`). Not visible to restricted roles (e.g. some custom roles or “admin_user” / “customer_admin”).

**Key concepts:**

- **Tenant settings:** Time zone, currency, contact info, address.
- **Public page:** **public_page_enabled** — when off, the public booking page can be disabled so customers cannot book online.
- **Maintenance mode:** When enabled, the public booking or customer page shows a maintenance message. **maintenance_message** (optional) allows a custom message (e.g. “Back soon – reopening Monday”).
- **Theme / branding:** **theme_preset** (e.g. blue-gold) and optional **custom_theme_config** for tenant look and feel across the platform.
- **Integrations:**  
  - **Zoho:** Tenant connects via **OAuth** (connect/disconnect in Settings). When a booking or package subscription is marked paid, the system can **create and send** the invoice in Zoho; **token refresh** runs in the background so the connection stays valid. Customers and staff can **download** invoice PDFs (from customer billing or Zoho).  
  - **SMTP:** Tenant (or platform) SMTP for sending **emails** (tickets, OTP, forgot password, invoices).  
  - **WhatsApp (optional):** Tenant WhatsApp configuration to send **tickets**, **OTP**, or **invoices** to customers.

**Impact on workflow:**  
Settings is a secondary but important screen. Design clear sections (General, Integrations, Maintenance, etc.) and protect it so only users with “edit system settings” (or equivalent) can access it.

---

### 3.15 Landing Page Builder

**Purpose:** **Customize the public-facing booking page**: hero (title, subtitle, image), about section, colors (primary, secondary), contact info, social links, FAQs. The same branding can be used for the customer area and booking success pages.

**Why it exists:**  
Each business wants its own look and message. The landing page is what customers see first when they open the booking link; branding (including RTL and Arabic) builds trust.

**Where it appears:**

- **Admin:** “Landing” or “Landing Page Builder” in the sidebar (e.g. `/{company}/admin/landing`). Not visible to restricted roles.
- **Public:** The booking page (e.g. `/{company}/book`) and customer landing (e.g. `/{company}/customer`) use the saved content and colors. Generated PDFs (e.g. booking tickets) may also use tenant colors.

**Key concepts:**

- **Sections:** Hero, about, contact, social, FAQs. Each can be toggled on/off.
- **Branding:** Primary and secondary colors; optional logo. Used across the public pages and sometimes in PDFs.
- **Content:** Text and images per section; multilingual (e.g. English and Arabic) where supported.

**Impact on workflow:**  
Design the builder so non-technical staff can edit sections without breaking the layout. Preview “as customer would see” is valuable. Consider RTL and long text in Arabic.

---

### 3.16 Reviews & Testimonials

**Purpose:**  
Let **customers** leave **reviews** (rating, comment, optional images) for **completed** bookings, and display those reviews on the **public service page** and optionally on the **landing page** as testimonials. Admins can approve or hide reviews so only approved ones are shown.

**Why it exists:**  
Reviews build trust and help new customers choose services. Testimonials on the landing or service page improve conversion. Centralizing reviews in the platform keeps feedback tied to real bookings and services.

**Where it appears:**

- **Customer dashboard** (e.g. `/{company}/customer/dashboard`): For **completed** bookings without a review, the customer sees a **“Write Review”** action. After submitting, the review can show as “Reviewed” or “Pending” (if approval is required).
- **Public service booking flow** (e.g. `/{company}/book/:serviceId`): A **“Reviews”** tab (or section) shows approved/visible reviews for that service (rating, comment, images). Customers can open a **testimonial form** from here to submit a review (if logged in).
- **Landing page / marketing:** Testimonials or review carousels can be shown (e.g. ReviewsCarousel, ReviewImageStory) using approved reviews.
- **Admin (if exposed):** Review moderation (approve, hide, delete) so only appropriate reviews are visible. Permissions may restrict who can moderate.

**Key concepts:**

- **Review:** Linked to a **service** and optionally to a **booking**. Contains **rating** (e.g. 1–5), **comment** (and optional Arabic), and optional **images**. Only **customers** (authenticated with role “customer”) can create reviews.
- **Visibility and approval:** Reviews can have **is_visible** and **is_approved**. The public and service page typically show only visible (and optionally approved) reviews.
- **Testimonials:** In this system, “testimonial” often means the same as a customer review (submitted via TestimonialForm); they can be displayed as a carousel or story on the service or landing page.

**Impact on workflow:**  
Design a simple “Write Review” flow from the customer dashboard (after a completed booking) and a clear “Reviews” tab on the service page. Consider moderation (approve/pending) and image display (e.g. gallery or story) for the UI.

---

### 3.17 Ticket & Invoice Delivery

**Purpose:**  
After a booking is created (or when payment is recorded), the system can **generate a PDF ticket** and/or **create/send an invoice** (e.g. via Zoho). Tickets and invoices can be **sent by email** and/or **WhatsApp** (when the tenant has configured these). The PDF uses the tenant’s **branding** (e.g. colors from the landing page).

**Why it exists:**  
Customers need a confirmation (ticket) and businesses need invoices for accounting. Automating delivery (email/WhatsApp) reduces manual work and ensures the customer receives the document immediately.

**Where it appears:**

- **After booking creation (reception or public):** Once the booking is confirmed, the backend may trigger ticket generation and send it by email and/or WhatsApp to the customer’s email/phone.
- **After reschedule or payment update:** A new ticket or invoice may be generated and sent.
- **Customer billing page:** Customers can **download** their Zoho invoices (PDF).
- **Admin / tenant settings:** Tenant can enable or disable **tickets** (`tickets_enabled`). Integrations (Zoho, SMTP, WhatsApp) are configured in Settings.

**Key concepts:**

- **Ticket:** A PDF summarizing the booking (service, date, time, branch, employee, customer, QR code for the booking, etc.). Used for confirmation and for cashier QR scan.
- **Invoice:** When payment is recorded, the system can create an invoice in Zoho and optionally send it by email/WhatsApp. Invoice ID is stored on the booking.
- **Delivery:** Email uses tenant **SMTP** (or platform email); **WhatsApp** uses tenant WhatsApp configuration (if any). If tickets are disabled (`tickets_enabled` = false), ticket generation/sending is skipped.
- **Branding:** Ticket and invoice PDFs use the tenant’s primary/secondary colors (from landing page settings) and optional logo.
- **Unavailable state:** If the customer or staff tries to access a booking (e.g. via QR) and the slot or tickets are no longer available (e.g. expired lock, cancelled), the app can show a **“Tickets no longer available”** (or similar) message so the user understands the booking is invalid or expired.

**Impact on workflow:**  
Design clear “Booking confirmed” and “Ticket/Invoice sent” feedback. Customer billing page should offer “Download invoice” per invoice. Settings should expose “Tickets enabled” and integration toggles (Zoho, email, WhatsApp) where applicable.

---

### 3.18 Authentication, Verification & Communications

**Purpose:**  
Support **login** (password or OTP), **forgot password** (lookup by email/phone/username → OTP → reset), **guest verification** (phone + OTP for public booking), and **customer signup**. Send **OTPs** and **notifications** via **email** and/or **WhatsApp** when configured.

**Why it exists:**  
Users need secure access; customers and guests need to verify identity (e.g. phone) before completing a booking. Forgot-password and OTP flows reduce support burden and improve security.

**Where it appears:**

- **Login** (`/login`): Tenant users sign in with username/email and password; optional **login with OTP** (request OTP → enter code).
- **Forgot password** (`/forgot-password`): User enters **username, email, or phone** → system looks up and sends **OTP** (by email or WhatsApp) → user enters OTP and sets new password.
- **Customer login/signup** (`/{company}/customer/login`, `/{company}/customer/signup`): Customers create an account or log in to see dashboard and billing.
- **Customer forgot password** (`/{company}/customer/forgot-password`): Same flow as forgot password, scoped to customer role.
- **Phone entry (guest booking)** (`/{company}/book/phone-entry`): In the public booking flow, the customer may be asked to enter **phone** → receive **OTP** → enter **name** (and optional email) → proceed to checkout. This verifies the guest’s phone before completing the booking.
- **Communications:** Emails (tickets, OTP, forgot password, invoices) use **SMTP** (tenant or platform). **WhatsApp** (optional) can send OTP, tickets, or invoices when configured in tenant settings.

**Key concepts:**

- **OTP:** One-time password sent by email or WhatsApp. Used for: forgot password, guest phone verification, optional login-with-OTP.
- **Lookup:** Forgot-password supports lookup by **email**, **phone**, or **username** (and optionally tenant). User receives masked contact info and OTP to that channel.
- **Guest vs customer:** Guest completes booking with phone + OTP + name; no account. Customer has an account (email/password) and can see dashboard, bookings, invoices, and write reviews.

**Impact on workflow:**  
Design clear OTP entry screens (code input, resend cooldown). Phone entry page should flow: phone → OTP → name → continue to checkout. Forgot-password flow: identifier → send OTP → enter OTP + new password → success.

---

### 3.19 Currency & Time Zone

**Purpose:**  
Each **tenant** has a **currency** (e.g. SAR, USD) and a **time zone** (e.g. Asia/Riyadh). All prices are shown in the tenant’s currency; all dates and times (slots, bookings, reports) respect the tenant’s time zone so that staff and customers see correct local time.

**Why it exists:**  
Multi-tenant and international use require per-tenant currency and time zone. Wrong currency or time zone would confuse customers and break slot logic.

**Where it appears:**

- **Settings:** Admin sets **currency code** and **time zone** (and optionally **announced time zone** for display). Currency is loaded app-wide (e.g. via CurrencyContext) so every price uses the same symbol and format.
- **Entire app:** Prices displayed in lists, booking flow, checkout, reports, and invoices use the tenant currency. Dates/times in calendar, slots, and booking details use the tenant time zone.

**Key concepts:**

- **Currency:** Stored per tenant; default often SAR. Frontend formats amounts (e.g. with symbol, decimals) consistently. Invoices (Zoho) may use the same currency.
- **Time zone:** Used for slot generation, booking display, and report filters. **Announced time zone** can be shown on the public page so customers know which time zone the business uses.

**Impact on workflow:**  
No extra UI beyond Settings; ensure currency symbol and time zone are applied everywhere prices and times are shown (including PDFs and emails if applicable).

---

<a id="4-user-types"></a>
## 4. User Types

Understanding **who** uses the system helps design the right screens and flows.


| User type                | Who they are                               | What they do in the system                                                                                                                                                                                                                                 | Where they work                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Solution Owner**       | Platform administrator                     | Manage all tenants; view/create/edit tenants; handle support tickets; **impersonate** any tenant user (by email) to reproduce issues; end impersonation; enable/disable tenant features (e.g. packages, employees, landing, scheduling mode).                                                                       | `/management`, `/solution-admin`, `/solution-admin/support-tickets`, `/management/features`                                                                                                     |
| **Admin (Tenant Admin)** | Business owner or manager                  | Full access to their tenant: dashboard, services, branches, packages, package subscribers, offers, bookings, visitors, employees, roles, employee shifts (if enabled), landing, settings, assign fixing ticket.                                            | `/{company}/admin/`* (sidebar: Home, Services, Packages, Branches, Package Subscribers, Offers, Bookings, Visitors, Employees, Roles, Employee Shifts, Landing, Settings, Assign Fixing Ticket) |
| **Receptionist**         | Front-desk staff                           | Create, edit, cancel bookings; sell packages; register visitors; view schedules; process payments; issue invoices (if permitted); view reports. Primary place: Reception page.                                                                             | `/{company}/reception`, `/{company}/reception/visitors`, `/{company}/reception/assign-fixing-ticket`; may also see admin Bookings/Visitors if they have manage_bookings                         |
| **Cashier**              | Payment-focused staff                      | Sell packages; view schedules; process payments; update payment status (issue invoices); create/edit bookings; view reports. **Cannot** register visitors. Can use **QR scan** to load a booking and mark it paid.                                         | `/{company}/cashier`, `/{company}/cashier/assign-fixing-ticket`                                                                                                                                 |
| **Coordinator**          | Limited operational role                   | View schedules; register visitors; view reports. **Cannot** manage services or full booking list in admin; may be redirected to reception and only access Visitors in admin.                                                                               | Redirected to `/{company}/reception`; can access `/{company}/admin/visitors` only                                                                                                               |
| **Employee**             | Service provider (e.g. stylist, therapist) | View **own** schedule and assigned bookings; mark bookings as **completed**. No access to other employees’ schedules or admin configuration.                                                                                                               | `/{company}/employee`                                                                                                                                                                           |
| **Customer (public)**    | End customer                               | Use **public booking** (`/{company}/book`): browse services and packages, select date/time, checkout (as **guest** with phone+OTP or as **logged-in customer**). Optional: **customer login/signup**; **dashboard** (bookings, write review); **billing** (invoices list, download PDF); **profile** (view/edit name, email, phone). | `/{company}/book`, `/{company}/book/phone-entry`, `/{company}/packages/:id/schedule`, `/{company}/book/checkout`, `/{company}/customer`, `/{company}/customer/dashboard`, `/{company}/customer/billing`   |
| **Custom roles**         | Any role defined by admin                  | Permissions define what they see and do. **Admin category:** can see admin sidebar (limited by permissions). **Employee category:** employee-like access. **Restricted roles** (e.g. customer_admin, admin_user): no Settings or Landing; limited sidebar. | Same URLs as above; menu and actions filtered by permissions                                                                                                                                    |


Design implications:

- **Reception** and **Cashier** are the two main “daily operations” roles; Reception has more booking and visitor responsibilities; Cashier is payment- and QR-focused.
- **Employee** view should be minimal: “My schedule” and “Mark done.”
- **Admin** view is dense; use the sidebar and clear page titles so managers can jump to the right module.
- **Solution Owner** needs a clear list of tenants, support tickets, and actions (impersonate, assign fixing ticket, feature toggles).

---

<a id="5-booking-workflow"></a>
## 5. Booking Workflow

A complete booking can be created **by staff (reception)** or **by the customer (public)**. The steps below cover both, with emphasis on reception.

### 5.1 High-level steps

1. **Customer context** (reception: select or create customer, e.g. by phone; public: guest info or customer login).
2. **Service (and optionally package):** Choose what is being booked. If a package is used, one “use” will be deducted from the customer’s package subscription.
3. **Date:** Choose the day.
4. **Time slot (and employee):**
  - **Automatic employee assignment:** System suggests an employee and slot (e.g. first available). User can proceed without choosing a person.
  - **Manual employee assignment:** User selects an employee first, then sees that employee’s available slots and picks one.
  - If the tenant allows **both**, the reception UI can show a toggle: “Automatic assignment” vs “Manual assignment.”
5. **Payment status:** Unpaid / Paid on site / Bank transfer (and optional reference). For reception, this is set at creation or later; for public, it may be part of checkout.
6. **Preview:** Show a summary (customer, service, date, time, employee, price, payment status). User can **Edit** or **Confirm**.
7. **Confirm:** Booking is created; slot capacity is updated; if package was used, subscription usage is decremented.

### 5.2 Where the workflow happens

- **Reception:** Main flow on the Reception page: today’s bookings, “Create booking” (service → date → slot → customer → payment → preview → confirm). Optional: customer/phone lookup first; package selection.
- **Admin – Bookings:** Same creation flow may be available from the Bookings page (depending on permissions).
- **Public:** Service (or package) → date → time → checkout (customer/guest details, payment) → success. Package path: click package → Package schedule page (date/time per service) → checkout.

### 5.3 Automatic vs manual employee selection

- **Automatic:** System picks employee(s) and slot(s) based on availability (and possibly rotation or business rules). Best for “first available” or when the business doesn’t care which employee.
- **Manual:** User chooses the employee, then sees only that employee’s free slots. Best when the customer has a preferred provider.
- **Both:** Tenant setting allows either; the UI should make the mode clear (e.g. “Automatic assignment” vs “Manual assignment”) so staff know which behavior to expect.

### 5.4 Time slot logic

- Slots are derived from **shifts** (branch and/or employee) and **existing bookings**. A slot is available if:
  - It falls within the relevant shift(s),
  - There is enough **capacity** (e.g. not already fully booked for that slot),
  - The employee (if chosen) is not double-booked.
- When a booking is created, the slot’s available capacity is reduced (or the slot is marked unavailable). Cancelling a booking restores capacity.
- **Parallel bookings:** Same time, multiple employees — multiple slots (one per employee) at the same time. **Consecutive bookings:** Same employee, multiple consecutive slots — one booking per slot, grouped.

Design implications:  
The booking flow is the most critical user journey. Design clear steps (service → date → time → customer → payment → confirm), obvious feedback when a slot is no longer available, and a clear distinction between automatic and manual assignment where both exist.

---

<a id="6-system-navigation-where-features-exist"></a>
## 6. System Navigation — Where Features Exist

Below is a concise map of **where** each major functionality lives. Use this to ensure every feature has a clear place in the information architecture.


| Area               | Path (example)                                             | What the user can do                                                                                                     |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Public**         | `/`                                                        | Marketing/home page.                                                                                                     |
|                    | `/signup`                                                  | Business (tenant) sign-up.                                                                                               |
|                    | `/login`                                                   | Tenant user login (redirects by role).                                                                                   |
|                    | `/forgot-password`                                         | Password reset.                                                                                                          |
| **Solution Owner** | `/management`                                              | Solution Owner login.                                                                                                    |
|                    | `/solution-admin`                                          | Dashboard: tenants, create tenant, activate/deactivate, subscription.                                                    |
|                    | `/solution-admin/support-tickets`                          | List and manage support tickets; impersonate; assign fixing ticket.                                                      |
|                    | `/management/features`                                     | Tenant feature toggles (packages, employees, landing, scheduling mode, etc.).                                            |
| **Tenant Admin**   | `/{company}/admin`                                         | **Dashboard:** stats, time filter, charts, calendar, booking list.                                                       |
|                    | `/{company}/admin/services`                                | **Services:** list, create, edit, delete; branch assignment; price, duration, capacity.                                  |
|                    | `/{company}/admin/branches`                                | **Branches:** list; create; open branch detail.                                                                          |
|                    | `/{company}/admin/branches/:branchId`                      | **Branch detail:** branch shifts; assign services/packages; income summary.                                              |
|                    | `/{company}/admin/packages`                                | **Packages:** list, create, edit; services and quantities; price; validity; branch assignment.                           |
|                    | `/{company}/admin/package-subscribers`                     | **Package subscribers:** list; remaining usage; subscription state; branch filter.                                       |
|                    | `/{company}/admin/offers`                                  | **Offers:** create and manage promotions/discounts.                                                                      |
|                    | `/{company}/admin/bookings`                                | **Bookings:** list, filters, calendar; create, edit, cancel bookings.                                                    |
|                    | `/{company}/admin/visitors`                                | **Visitors:** list, export, branch filter (admin view).                                                                  |
|                    | `/{company}/admin/employees`                               | **Employees:** list, create, edit; link user; branch; role; service assignments.                                         |
|                    | `/{company}/admin/roles`                                   | **Role management:** list, create, edit roles; permissions; category.                                                    |
|                    | `/{company}/admin/employee-shifts`                         | **Employee shifts:** set/edit working days and times per employee (when employee-based scheduling is on).                |
|                    | `/{company}/admin/landing`                                 | **Landing page builder:** hero, about, colors, contact, social, FAQs.                                                    |
|                    | `/{company}/admin/settings`                                | **Settings:** tenant config, integrations, maintenance, theme.                                                           |
|                    | `/{company}/admin/assign-fixing-ticket`                    | **Assign fixing ticket:** link current context to a support ticket.                                                      |
| **Reception**      | `/{company}/reception`                                     | **Reception:** today’s bookings; create booking; automatic/manual assignment; payment status.                            |
|                    | `/{company}/reception/visitors`                            | **Visitors:** register visitors; list (reception view).                                                                  |
|                    | `/{company}/reception/assign-fixing-ticket`                | **Assign fixing ticket** from reception.                                                                                 |
| **Cashier**        | `/{company}/cashier`                                       | **Cashier:** QR scan or manual input to load booking; mark paid (on site / bank transfer); sell packages; view schedule. |
|                    | `/{company}/cashier/assign-fixing-ticket`                  | **Assign fixing ticket** from cashier.                                                                                   |
| **Employee**       | `/{company}/employee`                                      | **Employee:** view own schedule; view assigned bookings; mark booking completed.                                         |
| **Public booking** | `/{company}/book`                                          | **Public booking:** browse services and packages; start service or package flow.                                         |
|                    | `/{company}/book/:serviceId`                               | **Service booking flow:** date → time → checkout; **Reviews** tab for that service.                                       |
|                    | `/{company}/packages/:packageId/schedule`                  | **Package schedule:** for each service in package, choose date and time; then continue to checkout.                      |
|                    | `/{company}/book/phone-entry`                              | **Phone entry:** enter phone → OTP → name (guest verification before checkout).                                            |
|                    | `/{company}/book/checkout`                                 | **Checkout:** customer/guest details, payment, confirm. Blocked if **maintenance mode** is on.                           |
|                    | `/{company}/book/success`                                  | **Booking success:** confirmation and optional “Book another.”                                                           |
|                    | `/{company}/qr`                                            | **QR scanner:** e.g. customer scans to open booking or info.                                                             |
| **Customer**       | `/{company}/customer`                                      | **Customer landing** (if enabled).                                                                                       |
|                    | `/{company}/customer/signup`, `/login`, `/forgot-password` | Customer account sign-up and login.                                                                                      |
|                    | `/{company}/customer/dashboard`                            | **Customer dashboard:** bookings, history; **Write Review** for completed bookings.                                        |
|                    | `/{company}/customer/billing`                              | **Customer billing:** list invoices (Zoho); search, paginate, download PDF per invoice.                                   |


**Sidebar visibility:**  
The tenant admin sidebar (Home, Services, Packages, Branches, Package Subscribers, Offers, Bookings, Visitors, Employees, Roles, Employee Shifts, Landing, Settings, Assign Fixing Ticket) is filtered by:

- **Tenant features:** e.g. “Packages” and “Package Subscribers” only if packages are enabled; “Employees” only if employees are enabled; “Employee Shifts” only if scheduling mode is employee-based; “Landing” only if landing page is enabled.
- **User permissions:** Each item is shown only if the user has the required permission (e.g. manage_services, manage_bookings, view_reports). Restricted roles (e.g. admin_user, customer_admin) may not see Settings or Landing.

**Preview from admin:**  
- From the tenant admin sidebar (when the user has access), **“View Booking Page”** and **“View Customer Page”** open the public booking page and customer landing page in a new tab so staff can preview the customer-facing experience.

**Other / internal:**  
- **Debug / navigation test** (e.g. `/{company}/admin/debug/navigation`): Internal tool for development and QA; not part of the main user-facing navigation.

Design implications:  
Navigation should feel consistent: same sidebar for admin, same reception/cashier/employee entry points. Always consider “what does this role see?” so the designer doesn’t assume every user sees every item.

---

<a id="7-why-each-feature-exists"></a>
## 7. Why Each Feature Exists

This section ties each feature to **business problem**, **purpose**, and **impact**. Use it to prioritize design and explain value to stakeholders.


| Feature                            | Purpose                                                      | Business problem it solves                                                   | Impact on workflow                                                                       |
| ---------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Branches**                       | Manage multiple locations separately                         | Confusion when several locations share one system; no per-location reporting | Clear ownership of services, staff, and income per branch; filters and reports by branch |
| **Services**                       | Define what is sold (name, price, duration, capacity)        | Inconsistent offerings and pricing; no clear “product” for booking           | Every booking is tied to a service; availability and price come from here                |
| **Employees**                      | Define who delivers which services and where                 | Double-booking; wrong person assigned; no per-person performance             | Correct availability and assignment; reports per employee                                |
| **Shifts**                         | Define when the business and staff are available             | Slots at impossible times; overbooking when staff are off                    | Only valid time slots are offered; capacity is realistic                                 |
| **Bookings**                       | Create and manage appointments                               | Lost appointments; no single source of truth                                 | One place for all appointments; capacity and package usage stay in sync                  |
| **Automatic vs manual assignment** | Support both “first available” and “preferred provider”      | Either too rigid (only manual) or no control (only automatic)                | Reception can choose mode; public flow can follow tenant setting                         |
| **Packages**                       | Sell bundles and track usage                                 | Manual tracking of “sessions left”; errors and disputes                      | Sell once; system deducts uses on each booking; remaining balance visible                |
| **Package branch restriction**     | Limit where a package is sold/used                           | Packages valid only at certain locations                                     | Clear rules; no misuse at wrong branch                                                   |
| **Customers**                      | One record per customer; history and packages                | Duplicate customers; no history or package view                              | Fast lookup (e.g. by phone); accurate history and remaining package uses                 |
| **Visitors**                       | Record visits/check-ins                                      | No headcount or visit data for reports                                       | Daily/weekly visit reports; optional export                                              |
| **Payment status & cashier**       | Record how each booking was paid; trigger invoices           | Unpaid vs paid unclear; manual invoicing                                     | Clear status; optional automatic invoice (e.g. Zoho) when marked paid                    |
| **QR scan at cashier**             | Quickly find a booking to mark paid                          | Slow search by name or ID                                                    | Staff scan ticket/QR → booking loads → mark paid                                         |
| **Roles & permissions**            | Limit what each user can do and see                          | Security and compliance; simplified screens per role                         | Sidebar and actions match role; no “dangerous” options for front-desk                    |
| **Support tickets**                | Report and track system issues                               | No structured way to get help from platform owner                            | One place for support; Solution Owner can assign and impersonate to fix                  |
| **Reports & dashboard**            | See revenue, bookings, performance                           | Decisions based on guesswork                                                 | Time-filtered stats and charts; better staffing and pricing                              |
| **Offers**                         | Apply discounts in a controlled way                          | Ad-hoc discounts; inconsistent pricing                                       | Select offer at booking; price updates automatically                                     |
| **Settings**                       | Configure tenant and integrations                            | Wrong time zone, currency, or no invoices                                    | Correct behavior and optional invoice integration                                        |
| **Landing page builder**           | Customize public and customer-facing pages                   | Generic look; no branding                                                    | Trust and recognition; consistent look and RTL/Arabic support                            |
| **Public booking**                 | Let customers book without calling                           | Phone-only; missed calls; no 24/7 booking                                    | More bookings; less front-desk load                                                      |
| **Package schedule (public)**      | Let customers choose date/time for each service in a package | Confusion when package has multiple services                                 | Clear flow: select date/time per service → checkout                                      |
| **Employee view**                  | Let service providers see only their schedule                | Staff need to know their own appointments                                    | Simple “my schedule” and “mark done” screen                                              |
| **Multi-branch filters**           | Filter lists and reports by branch                           | Can’t see per-location performance or data                                   | Managers see branch-specific data where relevant                                         |
| **Reviews & testimonials**         | Customers rate and review completed bookings; show on service/landing | No structured feedback; no social proof on booking page                      | “Write Review” in customer dashboard; “Reviews” tab on service page; testimonials on landing |
| **Reschedule booking**            | Change date/time of an existing booking                      | Customer or staff need to move appointment without recreating it             | Edit booking → new slot → confirm; capacity and tickets updated                          |
| **Bulk booking creation**         | Create multiple bookings (e.g. parallel/consecutive) in one go | Repetitive flow when booking several slots at once                           | One form or flow for multiple slots; grouped bookings                                    |
| **Service badges**                 | Show badges on public service cards (e.g. free cancellation, instant confirmation) | No quick visual cues for service perks                                       | Badges on service tiles/cards on public booking page                                     |
| **Ticket & invoice delivery**      | Send PDF ticket and/or Zoho invoice by email/WhatsApp after booking or payment     | Manual sending; customers miss confirmations and receipts                    | Automatic send; customer billing for invoice download                                    |
| **Booking lock**                   | Temporary hold on slot during checkout                                             | Two customers booking same slot at once                                      | Lock reserves slot briefly; expiry and cleanup prevent stuck slots                       |
| **OTP & verification**             | Forgot password and guest booking via phone/email OTP                              | Weak recovery; no guest verification                                         | Secure reset; verified guest details before checkout                                     |
| **Currency & time zone**           | Per-tenant currency and time zone                                                   | Wrong currency or time in multi-tenant/international use                     | Consistent prices and local times across the app                                        |
| **Customer billing (invoices)**    | Customer sees and downloads invoices                                               | Customers ask “where’s my receipt?”                                          | One place for all invoices; download PDF                                                 |
| **Impersonation**                  | Solution Owner logs in as a tenant user                                            | Cannot reproduce tenant-specific bugs                                        | Debug and support without knowing tenant passwords                                       |
| **Tenant signup**                  | Business self-registers (name, industry, contact, trial)                           | Only platform owner can create tenants                                       | Self-service onboarding; trial period                                                    |
| **Role disable**                   | Deactivate role without deleting it                                                | Must delete role (fails if users assigned) or leave unused roles active      | Disable unused roles; delete only when no users assigned                                 |


---

<a id="8-key-system-workflows"></a>
## 8. Key System Workflows

These are the main **user journeys** the designer should support with clear flows and feedback.

### 8.1 Creating a booking (reception)

1. Staff opens **Reception**.
2. Clicks **Create booking** (or equivalent).
3. Optionally **searches customer by phone** or creates new customer.
4. Selects **service** (and optionally **package** to use one credit).
5. Selects **date**.
6. Chooses **Automatic** or **Manual** assignment:
  - **Automatic:** System suggests employee + slot; staff confirms or picks another slot.
  - **Manual:** Staff selects **employee**, then **time slot**.
7. Sets **payment status** (Unpaid / Paid on site / Bank transfer).
8. Reviews **preview** → **Edit** or **Confirm**.
9. **Confirm** → Booking created; success message; capacity and (if applicable) package usage updated.

Design: Clear steps, one primary path, visible feedback at each step and on confirm.

---

### 8.2 Rescheduling a booking (reception or admin)

1. Staff or admin opens **Reception** or **Admin → Bookings** and finds the booking.
2. Clicks **Edit** (or “Reschedule”).
3. Selects a **new date** and **new time slot** (and optionally a different employee if allowed). System checks availability and capacity.
4. Confirms → Booking is updated; old slot capacity is restored, new slot capacity is reduced. Optionally a new ticket or invoice is generated.

Design: Make “Edit” / “Reschedule” easy to find from the booking card or list; show clear feedback when the new slot is saved or when it’s invalid (e.g. slot no longer available).

---

### 8.3 Assigning employees (admin)

1. Admin opens **Employees**.
2. Creates or edits an **employee**: links to a **user**, assigns **branch**, **role**, and **services** (with optional duration/capacity overrides).
3. If **employee-based scheduling** is on, admin opens **Employee Shifts** and sets **working days and times** for that employee.
4. From then on, when creating a booking for that branch and service, this employee appears in the list (manual mode) or in the pool (automatic mode).

Design: Employee form should clearly show “Branch,” “Role,” “Services,” and link to “Employee Shifts” when that feature is on.

---

### 8.4 Selling and using packages

**Selling a package**

1. Reception or Cashier opens **Package Subscribers** or the package-sale flow (e.g. from reception/cashier).
2. Selects **customer** (or creates one).
3. Selects **package** and **branch** (if applicable).
4. Completes sale → **Package subscription** created; usage (e.g. 5 haircuts, 0 used) recorded.

**Using a package in a booking**

1. When creating a booking, staff selects **customer** (who has an active package).
2. Optionally selects **package** to use for this booking (one credit of the chosen service will be deducted).
3. Selects **service** (must match a service in the package with remaining quantity), date, slot, payment (often “already paid” via package).
4. Confirms → Booking created; **remaining quantity** for that service in the package is decreased by 1.

Design: “Remaining sessions” should be visible where staff select package or service; package sale flow should be simple (customer → package → confirm).

---

### 8.5 Handling customer visits (visitors)

1. Staff (reception or coordinator) opens **Visitors** (from reception or admin, depending on permissions).
2. **Registers a visit:** e.g. customer name or ID, branch, date/time. Optionally links to a customer record.
3. Visitors list and **reports** can show visit count, export, and branch filter.

Design: Quick “Add visit” action; list with filters and export for managers.

---

### 8.6 Managing shifts

1. **Branch shifts:** Admin opens **Branches** → selects branch → **Branch detail** → sets **default working days and times** (e.g. Mon–Fri 9:00–18:00).
2. **Employee shifts (if employee-based):** Admin opens **Employee Shifts** → selects employee → sets **days and times** (or copies from branch default). Saves.
3. System uses these to compute **available slots** for booking.

Design: Calendar or list of “days + start/end”; clear link from employee to their shifts.

---

### 8.7 Reporting a system issue (support ticket)

1. Tenant user (reception, cashier, admin) encounters a problem.
2. Goes to **Assign Fixing Ticket** (or support entry point).
3. Creates a **new ticket** (or selects existing) and adds description. Optionally **assigns** it as the “fixing” ticket.
4. Solution Owner opens **Support Tickets**, sees ticket, updates **status** (e.g. in progress, resolved). May **impersonate** the tenant user to reproduce the issue.
5. When fixed, marks ticket **resolved**. Tenant can see status if the UI exposes it.

Design: Simple “Report problem” form; Solution Owner list with status, assign, and “Login as” action.

---

### 8.8 Tenant signup (new business onboarding)

1. Business goes to **Signup** (`/signup`).
2. Enters **business name** (and optional Arabic name), **industry** (e.g. Salon, Clinic), **contact** (full name, email, phone), and **password**.
3. Submits → System creates **tenant**, **tenant features** (defaults), and first **user** as **tenant_admin**. Subscription/trial period may be set (e.g. 30 days).
4. User is redirected to **Login** (`/login`); signs in and is taken to the **admin dashboard** (`/{company}/admin`).

Design: Single signup form; clear industry dropdown; success message and redirect to login.

---

### 8.9 Impersonation (Solution Owner)

1. Solution Owner is on **Support Tickets** or tenant list and wants to see the app as a specific tenant user.
2. Clicks **Impersonate** (or “Login as”) and enters the user’s **email** (and optionally tenant).
3. System validates and returns a token as that user; frontend stores it and redirects to the tenant’s area (e.g. `/{company}/admin` or `/{company}/reception`).
4. Solution Owner uses the app exactly as that user (same sidebar, permissions, data). A visible **“End impersonation”** (or banner) restores the Solution Owner session and returns to `/solution-admin`.

Design: Clear “Impersonate” action; prominent “You are viewing as [user] – End impersonation” so it’s never confused with normal use.

---

### 8.10 Guest booking with phone verification (public)

1. Customer on **Public booking** selects service (and date/time) and proceeds to checkout.
2. Flow may redirect to **Phone entry** (`/{company}/book/phone-entry`): customer enters **phone number**.
3. System sends **OTP** (SMS or WhatsApp, if configured) to that phone. Customer enters **OTP**.
4. Customer enters **name** (and optional email). Optionally they can **sign up** as a customer account or continue as **guest**.
5. Customer continues to **Checkout** (`/{company}/book/checkout`), completes details, and confirms. Booking is created; ticket/invoice may be sent to the verified phone/email.

Design: Phone → OTP → name → checkout; resend OTP with cooldown; clear “Continue as guest” vs “Create account.”

---

### 8.11 Customer views and downloads invoices

1. Customer logs in and goes to **Customer Billing** (`/{company}/customer/billing`).
2. Sees **list of invoices** (paginated, optional search by date or service). Each row: date, service, amount, status, “Download” button.
3. Clicks **Download** → PDF invoice (from Zoho or system) is downloaded. List may show “Latest invoice” or refresh hint.

Design: Table or card list with download per row; loading state for PDF; empty state when no invoices.

---

## Glossary (key terms)

| Term | Meaning |
|------|--------|
| **Tenant** | A business (company) on the platform. Each tenant has its own data, settings, and users. |
| **Branch** | A physical or logical location of a tenant (e.g. one salon or clinic address). |
| **Service** | A bookable offering (e.g. haircut, consultation) with name, price, duration, and capacity. |
| **Slot** | A specific date and time window when a booking can be made (derived from shifts and capacity). |
| **Shift** | Working hours (days and times) for a branch or an employee. |
| **Booking** | An appointment: customer + service + date/time (slot) + employee + status + payment status. |
| **Package** | A bundle of services sold together (e.g. “5 haircuts”) with a validity period. |
| **Package subscription** | A customer’s purchase of a package; usage (remaining sessions) is tracked per service. |
| **Reception** | The staff interface for creating and managing bookings and visitors (receptionist/cashier). |
| **Cashier** | The staff interface focused on payments, QR scan, and marking bookings as paid. |
| **Solution Owner** | Platform administrator; manages all tenants, support tickets, and can impersonate tenant users. |
| **Guest** | A customer who books without an account; verified via phone + OTP. |
| **Ticket** | PDF confirmation sent after a booking (and optionally after reschedule); may be sent by email/WhatsApp. |
| **Invoice** | Document (e.g. via Zoho) for payment; created when a booking or package sale is marked paid. |

---

## Design considerations (UX patterns)

These patterns appear across the platform; designers should account for them consistently.

- **Empty states:** Lists and pages (bookings, services, visitors, package subscribers, invoices, etc.) can have **no data yet**. Use clear empty-state messages and, where relevant, a primary action (e.g. “Create your first booking”, “Add a service”).
- **Loading states:** Data is often loaded from the server (bookings, slots, dashboard stats). Show **loading indicators** or skeletons so users know the app is working; avoid blank screens during fetch.
- **Confirmations:** **Destructive or critical actions** (delete service, cancel booking, cancel subscription, disable role, etc.) should use a **confirmation dialog** (e.g. “Are you sure?”) to reduce mistakes. Keep copy and button placement consistent (e.g. Cancel / Confirm).
- **Sign out (logout):** Users can **sign out** from the tenant area (e.g. via a logout control in the sidebar or header). After logout they are redirected to the login or home page. Designers should place the logout control where it is visible but not prominent (e.g. bottom of sidebar or user menu).
- **Devices and contexts:** The app is used on different devices—reception or cashier on a tablet, public booking on a phone, admin on a desktop. Consider **responsive layout** and **touch-friendly targets** where relevant (e.g. public pages and reception).

---

## Document control

- **Audience:** UI/UX designers, product managers, stakeholders (non-technical).
- **Goal:** Single source of truth for what the system does, who uses it, where features live, and why they exist.
- **Use:** Information architecture, user flows, wireframes, and prioritization of design work.
- **Last updated:** Update this line when the document is revised so readers know how current it is.

If the product gains new modules or user types, this document should be updated so the design remains aligned with the full system.