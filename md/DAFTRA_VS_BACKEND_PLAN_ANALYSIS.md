# Daftra vs. Backend Project Plan — Feature Comparison & Gap Analysis

**Document type:** Senior software architect / product analyst review  
**Scope:** Daftra platform (public features) vs. this project’s backend (codebase + TASK_IMPLEMENTATION_PLAN + docs)  
**Focus:** Backend architecture, system capabilities, and prioritized recommendations.

---

## Step 1 — Feature Research: Daftra Platform

### 1.1 Publicly Available Features (Web + Mobile)

Research sources: Daftra marketing site, features pages, knowledge base, API docs, industry pages.

#### Authentication & User Management


| Feature                                        | Web                  | Mobile / Notes                |
| ---------------------------------------------- | -------------------- | ----------------------------- |
| Login / Sign up                                | Yes                  | —                             |
| Multi-user / team                              | Yes                  | —                             |
| Role-based access                              | Yes                  | —                             |
| Employee self-service (ESS)                    | Yes                  | ESS app: attendance, requests |
| Client portal (invoices, quotes, appointments) | Yes                  | —                             |
| API key / OAuth2 for integrations              | Yes (Settings → API) | —                             |


#### Accounting


| Feature                             | Description                               |
| ----------------------------------- | ----------------------------------------- |
| General ledger / chart of accounts  | Full CoA, auto GL mirroring               |
| Income & expense management         | Income, journal entries, expense tracking |
| Cost centers                        | Cost center management                    |
| Cheque cycle                        | Full cheque lifecycle                     |
| Assets management                   | Fixed assets                              |
| P&L, income statements, tax reports | Standard financial reports                |
| Cash flow tracking                  | Cash flow views                           |
| Multi-currency & tax settings       | Multiple reporting currency, tax config   |


#### Invoicing & Payments


| Feature                          | Description                                    |
| -------------------------------- | ---------------------------------------------- |
| Billing & invoicing              | Invoicing module, templates                    |
| E-invoicing (KSA, Egypt, Jordan) | ZATCA Phase 2, regional compliance             |
| Installments management          | Payment plans / installments                   |
| POS (online & offline)           | Web + POS mobile app, sync                     |
| Payment tracking                 | Payment status, client statements              |
| Invoice currency per document    | Multi-currency per invoice                     |
| QR on invoices                   | QR code on e-invoices                          |
| Auto sending rules               | Automate document delivery (e.g. invoice send) |


#### CRM / Clients


| Feature                        | Description                           |
| ------------------------------ | ------------------------------------- |
| Client database                | History, preferences, communication   |
| Lead management & follow-up    | Pipeline, follow-up rules             |
| Client portal                  | Invoices, quotes, appointments        |
| Service booking / appointments | Online scheduling                     |
| Unified comms                  | Reminders, email, call, SMS, WhatsApp |
| Memberships                    | Membership plans                      |
| Points & credits               | Loyalty points, credits               |
| Client follow-up               | Structured follow-up workflows        |


#### Inventory / Products


| Feature                                 | Description                                              |
| --------------------------------------- | -------------------------------------------------------- |
| Product management                      | Catalog, categories, pricing, stock                      |
| Purchase management                     | Purchase orders, receiving                               |
| Supplier management                     | Supplier master data                                     |
| Requisitions                            | Internal requisition workflow                            |
| Stocktaking                             | Sessions, barcode, offline/online sync (Stocktaking app) |
| Manufacturing                           | BOM, production                                          |
| Bundles, serial/lot/expiry              | Product variants, tracking                               |
| Multiple price lists, reorder reminders | Pricing & replenishment                                  |


#### HRM


| Feature                  | Description                       |
| ------------------------ | --------------------------------- |
| Organizational structure | Departments, hierarchy            |
| Contracts                | Employee contracts                |
| Attendance & leave       | Attendance, leave management      |
| Payroll                  | Payroll processing                |
| Requests                 | Leave/request workflow (e.g. ESS) |


#### Operations


| Feature                  | Description                                |
| ------------------------ | ------------------------------------------ |
| Work orders              | Job/work order management                  |
| Booking                  | Appointments / booking (industry-specific) |
| Time tracking            | Project/time tracking                      |
| Rental & unit management | Units, rentals (e.g. real estate)          |


#### Reports & Analytics


| Feature                 | Description                         |
| ----------------------- | ----------------------------------- |
| P&L, income statements  | Standard financial                  |
| Tax reports             | Tax reporting                       |
| Cash flow               | Cash flow reports                   |
| Custom / sector reports | By industry (retail, medical, etc.) |


#### Notifications


| Feature        | Description                             |
| -------------- | --------------------------------------- |
| Email          | Transactional email                     |
| SMS / WhatsApp | Integrated messaging                    |
| Reminders      | Automated reminders (e.g. appointments) |


#### Integrations


| Feature                          | Description                        |
| -------------------------------- | ---------------------------------- |
| REST API                         | docs.daftara.dev, API key / OAuth2 |
| Zapier                           | Webhooks, 8000+ apps               |
| ZATCA (KSA e-invoicing)          | Phase 2 integration                |
| Payment (Tabby, Tamara, Neoleap) | BNPL / payment gateways            |


#### Automation


| Feature                                | Description                         |
| -------------------------------------- | ----------------------------------- |
| Auto sending rules                     | e.g. auto-send invoice when created |
| Zapier triggers (e.g. credit note, PO) | Event-driven automation             |


#### Security


| Feature              | Description             |
| -------------------- | ----------------------- |
| Cloud, GDPR-oriented | Hosted, privacy-focused |
| API auth             | API key + OAuth2        |
| Role-based access    | By module/feature       |


#### Admin / Permissions


| Feature              | Description                           |
| -------------------- | ------------------------------------- |
| Module activation    | Enable/disable modules per tenant     |
| User/role management | Users and roles                       |
| Industry templates   | 50+ industries, sector-specific setup |


#### API / Developer


| Feature               | Description                               |
| --------------------- | ----------------------------------------- |
| Developer portal      | developers.daftra.com                     |
| REST API docs         | docs.daftara.dev, cURL, Python, Node, PHP |
| API key generation    | Settings → API                            |
| Webhooks (via Zapier) | Event webhooks to external systems        |


#### Other


| Feature                     | Description                               |
| --------------------------- | ----------------------------------------- |
| Sales commissions & targets | Commissions, targets                      |
| Offers & discounts          | Promotions, discount rules                |
| Insurance management        | Insurance-related tracking                |
| Mobile apps                 | Business app, POS app, ESS, Stocktaking   |
| Multi-industry              | Retail, medical, fitness, logistics, etc. |


---

## Step 2 — Compare With My Backend Plan

**Backend plan inferred from:**  
`TASK_IMPLEMENTATION_PLAN.md`, `BACKEND_ROUTES_SOLUTION_OWNER.md`, `BACKEND_AUDIT_REPORT.md`, `server/src` (routes, permissions, jobs), migrations.

**Your system (Bookati):** Multi-tenant booking/appointments SaaS — tenants, branches, services, employees, bookings (single + bulk), packages/subscriptions, customers, Zoho invoicing, SMTP/WhatsApp, RBAC, support tickets, visitors, reviews. No full accounting, no POS, no inventory, no HRM/payroll, no manufacturing.

Comparison table (by product area):


| Feature Category            | Feature Name                                | In Daftra | In My Backend Plan                  | Notes / Complexity       |     |                   |
| --------------------------- | ------------------------------------------- | --------- | ----------------------------------- | ------------------------ | --- | ----------------- |
| **Auth & users**            | Login / signup                              | Yes       | Yes                                 | Low                      |     |                   |
|                             | JWT / session auth                          | Yes       | Yes                                 | Low                      |     |                   |
|                             | Role-based access                           | Yes       | Yes (RBAC, permissions)             | Low                      |     |                   |
|                             | Forgot password / reset                     | Yes       | Yes                                 | Low                      |     |                   |
|                             | OTP (SMS/WhatsApp/email)                    | Yes       | Yes                                 | Low                      |     |                   |
|                             | Solution owner (multi-tenant admin)         | Yes       | Yes                                 | Low                      |     |                   |
|                             | Impersonation                               | —         | Yes (solution owner)                | —                        |     |                   |
|                             | Client/customer portal (bookings, invoices) | Yes       | Yes (customer bookings, invoices)   | Low                      |     |                   |
|                             | Employee self-service app                   | Yes       | No                                  | Missing ESS; Medium      |     |                   |
|                             | Public API key / OAuth2 for third parties   | Yes       | No (internal JWT only)              | Missing; Medium          |     |                   |
| **Accounting**              | Chart of accounts / GL                      | Yes       | No                                  | Not in plan; High        |     |                   |
|                             | Income/expense, journal entries             | Yes       | No                                  | Not in plan; High        |     |                   |
|                             | Cost centers                                | Yes       | No                                  | Not in plan; High        |     |                   |
|                             | Cheque cycle                                | Yes       | No                                  | Not in plan; Medium      |     |                   |
|                             |                                             |           |                                     | Not in plan; High        |     |                   |
|                             | Assets management                           | Yes       | No                                  |                          |     |                   |
| P&L, tax reports, cash flow | Yes                                         | No        |                                     |                          |     | Not in plan; High |
|                             | Multi-currency (reporting)                  | Yes       | Partial (tenant currency)           | Medium                   |     |                   |
| **Invoicing & payments**    | Invoicing (create/send)                     | Yes       | Yes (via Zoho)                      | Low                      |     |                   |
|                             | E-invoicing / ZATCA                         | Yes       | No (Zoho may cover per tenant)      | Depends on Zoho; Medium  |     |                   |
|                             | Installments / payment plans                | Yes       | No                                  | Not in plan; Medium      |     |                   |
|                             | POS (web + mobile, offline)                 | Yes       | No                                  | Not in plan; High        |     |                   |
|                             | Payment tracking per client                 | Yes       | Partial (booking payment status)    | Medium                   |     |                   |
|                             | Auto sending rules (e.g. invoice)           | Yes       | No                                  | Not in plan; Low–Medium  |     |                   |
|                             | Invoice QR code                             | Yes       | Yes (ticket PDF)                    | Low                      |     |                   |
| **CRM / clients**           | Client database                             | Yes       | Yes (customers)                     | Low                      |     |                   |
|                             | Lead management / pipeline                  | Yes       | No                                  | Not in plan; Medium      |     |                   |
|                             | Client follow-up rules                      | Yes       | No                                  | Not in plan; Medium      |     |                   |
|                             | Memberships                                 | Yes       | Yes (packages)                      | Low                      |     |                   |
|                             | Points & credits / loyalty                  | Yes       | No                                  | Not in plan; Medium      |     |                   |
|                             | Unified comms (email, SMS, WhatsApp)        | Yes       | Yes (SMTP, WhatsApp)                | Low                      |     |                   |
| **Inventory / products**    | Product catalog                             | Yes       | No (services only)                  | Different domain; High   |     |                   |
|                             | Purchase / suppliers                        | Yes       | No                                  | Not in plan; High        |     |                   |
|                             | Stocktaking / barcode                       | Yes       | No                                  | Not in plan; High        |     |                   |
|                             | Manufacturing                               | Yes       | No                                  | Not in plan; High        |     |                   |
| **HRM**                     | Org structure                               | Yes       | No                                  | Not in plan; Medium      |     |                   |
|                             | Contracts                                   | Yes       | No                                  | Not in plan; Medium      |     |                   |
|                             | Attendance & leave                          | Yes       | No                                  | Not in plan; Medium      |     |                   |
|                             | Payroll                                     | Yes       | No                                  | Not in plan; High        |     |                   |
|                             | Requests (leave, etc.)                      | Yes       | No                                  | Not in plan; Medium      |     |                   |
| **Operations**              | Work orders                                 | Yes       | No                                  | Not in plan; Medium      |     |                   |
|                             | Booking / appointments                      | Yes       | Yes (core)                          | Low                      |     |                   |
|                             | Time tracking                               | Yes       | No                                  | Not in plan; Medium      |     |                   |
|                             | Rental / unit management                    | Yes       | No                                  | Not in plan; High        |     |                   |
| **Reports & analytics**     | Financial reports (P&L, etc.)               | Yes       | No                                  | Not in plan; High        |     |                   |
|                             | Custom / export reports                     | Yes       | Partial (visitor export, query API) | Medium                   |     |                   |
| **Notifications**           | Email                                       | Yes       | Yes (SMTP)                          | Low                      |     |                   |
|                             | SMS / WhatsApp                              | Yes       | Yes (WhatsApp)                      | Low                      |     |                   |
|                             | Reminders (e.g. booking)                    | Yes       | Partial (ticket/notifications)      | Medium                   |     |                   |
| **Integrations**            | REST API (public)                           | Yes       | Partial (query/insert/update/rpc)   | Medium                   |     |                   |
|                             | Zapier / webhooks                           | Yes       | No                                  | Not in plan; Medium      |     |                   |
|                             | ZATCA / e-invoicing                         | Yes       | Via Zoho only                       | Low if Zoho covers       |     |                   |
|                             | Payment gateways (Tabby, etc.)              | Yes       | No                                  | Not in plan; Medium      |     |                   |
| **Automation**              | Auto sending rules                          | Yes       | No                                  | Not in plan; Low–Medium  |     |                   |
|                             | Event webhooks                              | Yes       | No                                  | Not in plan; Medium      |     |                   |
| **Security**                | Tenant isolation                            | Yes       | Yes (tenant_id)                     | Low                      |     |                   |
|                             | RBAC                                        | Yes       | Yes                                 | Low                      |     |                   |
| **Admin / permissions**     | Module on/off per tenant                    | Yes       | No                                  | Not in plan; Medium      |     |                   |
|                             | Fine-grained permissions                    | Yes       | Yes (permission IDs)                | Low                      |     |                   |
| **API / developer**         | Developer portal                            | Yes       | No                                  | Not in plan; Low–Medium  |     |                   |
|                             | Documented public API                       | Yes       | No                                  | Not in plan; Medium      |     |                   |
|                             | API keys for partners                       | Yes       | No                                  | Not in plan; Medium      |     |                   |
| **Other**                   | Sales commissions / targets                 | Yes       | No                                  | Not in plan; Medium      |     |                   |
|                             | Offers / discounts                          | Yes       | Partial (packages, offers in Zoho)  | Medium                   |     |                   |
|                             | Insurance management                        | Yes       | No                                  | Not in plan; Low–Medium  |     |                   |
|                             | Support tickets                             | —         | Yes                                 | Your differentiator      |     |                   |
|                             | Visitors / check-in                         | —         | Yes                                 | Your differentiator      |     |                   |
|                             | Package capacity / subscriptions            | —         | Yes                                 | Aligned with memberships |     |                   |


---

## Step 3 — Missing Features (In Daftra, Not in Your Plan)

Only features that **exist in Daftra** and are **missing or weak** in your backend plan are listed.


| #   | Feature name                             | Short description                                     | Why it matters                                   | Suggested backend components                                  | Complexity |
| --- | ---------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- | ---------- |
| 1   | **Lead management & pipeline**           | Leads, stages, follow-up rules                        | Sales pipeline for services; conversion tracking | `leads` table, `pipeline_stages`, follow-up rules engine, API | Medium     |
| 2   | **Client follow-up rules**               | Automated follow-up by segment/event                  | Retention and rebooking                          | Rules engine, scheduler job, actions (email/WhatsApp)         | Medium     |
| 3   | **Points & credits / loyalty**           | Earn/spend points or credits per client               | Retention, upsell                                | `customer_points`, `credits`, ledger, redemption API          | Medium     |
| 4   | **Installments / payment plans**         | Split invoice into scheduled payments                 | Higher AOV, flexibility                          | Installment plans, schedule, payment tracking, reminders      | Medium     |
| 5   | **Auto sending rules**                   | e.g. auto-send invoice on create/status               | Less manual work, consistency                    | Rules table, job that evaluates rules, action executor        | Low–Medium |
| 6   | **Public REST API + API keys**           | Third-party access with API key or OAuth2             | Integrations, marketplace, white-label           | API key table, scope/rate limits, public API versioning       | Medium     |
| 7   | **Webhooks / event notifications**       | HTTP callbacks on events (booking, invoice)           | Zapier, internal automation, BI                  | Webhook endpoints table, event bus, retry/backoff             | Medium     |
| 8   | **Module activation per tenant**         | Turn features on/off per tenant                       | Packaging, simpler onboarding                    | `tenant_modules` or flags, feature checks in middleware       | Medium     |
| 9   | **Developer portal & API docs**          | Self-serve docs and key management                    | Adoption by partners/devs                        | Docs site, OpenAPI spec, key management UI                    | Low–Medium |
| 10  | **Sales commissions & targets**          | Commission rules and targets per user/period          | Sales performance                                | Commission rules, targets table, aggregation job, reports     | Medium     |
| 11  | **Employee self-service (ESS)**          | Employees view schedules, submit requests, attendance | Reduces admin load, mobile-first                 | ESS API, request workflow, optional attendance linkage        | Medium     |
| 12  | **Financial accounting (GL, CoA, P&L)**  | Full double-entry, reports                            | Required if you sell “accounting”                | CoA, journals, ledgers, reporting views; large scope          | High       |
| 13  | **POS (online/offline)**                 | Checkout and payments, sync                           | Retail + services hybrid                         | POS API, offline queue, sync worker, payment capture          | High       |
| 14  | **Inventory / products / stock**         | Catalog, stock, stocktaking                           | If you add retail/product sales                  | Products, stock, movements, stocktaking API                   | High       |
| 15  | **Payroll & HR (contracts, attendance)** | Payroll, contracts, attendance                        | If you target “full HR”                          | Payroll engine, contracts, attendance; large scope            | High       |


---

## Step 4 — Advanced Features (Not in Daftra, High Value for Your System)

Suggestions that go **beyond** Daftra and focus on **backend** impact.


| #   | Feature                                           | Value                                                          | Backend architecture impact                                                                          |
| --- | ------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | **Event-sourced audit log**                       | Compliance, debugging, “who changed what when”                 | Append-only event store, event types per entity, replay/export; no change to core domain models.     |
| 2   | **Workflow engine (booking lifecycle)**           | Consistent states (e.g. confirm → remind → complete → invoice) | State machine or workflow engine, persisted state, hooks for notifications and integrations.         |
| 3   | **AI-assisted analytics API**                     | Anomaly detection, forecasting, next-best-action               | Analytics service consuming event/booking data, optional ML pipeline; read-heavy, cache-friendly.    |
| 4   | **GraphQL or tuned read API for dashboards**      | Fewer round-trips, flexible mobile/web queries                 | GraphQL layer or aggregated read endpoints, careful auth and tenant scoping.                         |
| 5   | **Extensibility / custom fields and actions**     | Tenant-specific fields and behaviors without code deploy       | Metadata store (e.g. JSON schema), validation at API layer, optional serverless actions or webhooks. |
| 6   | **Multi-tenant data pipeline (BI export)**        | Safe analytics/warehouse without direct DB access              | ETL job per tenant (or batched), anonymization/aggregation, export to S3/GCS or warehouse API.       |
| 7   | **Caching and read replicas**                     | Scale reads (bookings, calendar, reports)                      | Cache layer (e.g. Redis) for hot data, read replicas for reporting; tenant-aware cache keys.         |
| 8   | **Advanced permissions (ABAC or resource-level)** | “Can edit only own branch” or “only future bookings”           | Policy engine (e.g. ABAC), attributes on user/resource; integrate with existing RBAC.                |
| 9   | **Idempotent public API**                         | Safe retries for partners and POS                              | Idempotency key table (key + TTL), request dedup in middleware; apply to create/update endpoints.    |
| 10  | **Backpressure and rate limiting per tenant**     | Fair usage, abuse protection                                   | Per-tenant limits (and optional per API key), queue or reject with 429; tenant in context.           |


---

## Step 5 — Technical Gap Analysis

### 5.1 Major Backend Capabilities Missing

- **No double-entry accounting:** Invoicing is delegated to Zoho; there is no internal GL, CoA, or P&L. If the product position stays “booking + invoicing” (not “accounting”), this is acceptable; otherwise it’s a large gap.
- **No product/inventory layer:** Only services and packages. Adding retail or product-based sales would require products, stock, and possibly warehouses.
- **No POS or offline-first sales:** All flows assume online API. Offline POS would need sync, conflict resolution, and possibly local-first design.
- **No public API product:** The generic query/insert/update/rpc API is powerful but not a documented, versioned, key-based product for third parties. No webhooks or event subscription.
- **Limited automation:** No configurable rules (e.g. “when booking confirmed, send X”) or workflow engine; logic is mostly in code.

### 5.2 Scalability Considerations

- **Tenant isolation:** Already tenant-scoped; ensure all queries and jobs are tenant-filtered and that RLS (or equivalent) is consistent.
- **Read scaling:** Calendar and booking search can become hot paths; consider read replicas and caching (e.g. slot availability, booking lists).
- **Background jobs:** Zoho token refresh and receipt worker are a good start; more jobs (reminders, auto-send rules, webhooks) will need a job queue (e.g. BullMQ) and observability.
- **Payload size:** 250MB limit is high; consider separate upload pipeline (e.g. presigned URLs) to avoid overloading the app layer.

### 5.3 Architecture Improvements

- **Event bus:** Introduce a small event bus (e.g. booking.created, invoice.sent) for notifications, webhooks, and future automation without coupling.
- **API versioning:** Plan `/v1/` (or similar) for any public API to allow breaking changes later.
- **Feature flags / tenant modules:** Backend support for toggling features per tenant (or globally) to support packaging and gradual rollout.
- **Structured logging and tracing:** Request/tenant/user IDs in logs and optional tracing for debugging and SLA analysis.

### 5.4 Data Model Considerations

- **Customer 360:** If you add leads, follow-up, and loyalty, consider a unified customer profile (or clear linkage between customers and leads) and a single place for “last activity” and segments.
- **Idempotency:** For booking create, payment, and invoice actions, idempotency keys will reduce duplicates when clients retry.
- **Soft deletes and history:** For bookings and critical entities, soft deletes and/or history tables improve audit and “undo”.

### 5.5 Security Improvements

- **API key storage:** If you add API keys, hash them (e.g. SHA-256), store hashes only, and enforce scopes and rate limits.
- **Audit log:** Sensitive actions (role change, tenant settings, impersonation) should be written to an audit log with actor and tenant.
- **Secrets:** Ensure Zoho, SMTP, WhatsApp secrets are only in env/secret manager and never logged; rotate support.

---

## Step 6 — Prioritized Recommendations

### Critical (do first)


| Priority | Item                                             | Rationale                                                                |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| Critical | **Idempotency for booking create (and payment)** | Prevents double bookings and double charges on retries.                  |
| Critical | **Audit log for sensitive actions**              | Needed for compliance and support (roles, tenant config, impersonation). |
| Critical | **Strict tenant isolation review**               | Ensure every query and job is tenant-scoped and RLS is correct.          |


### High value (next)


| Priority | Item                                          | Rationale                                                           |
| -------- | --------------------------------------------- | ------------------------------------------------------------------- |
| High     | **Auto sending rules (e.g. invoice on paid)** | High impact, low–medium effort; reduces manual work.                |
| High     | **Public API + API keys + webhooks**          | Enables integrations and ecosystem without custom code per partner. |
| High     | **Event bus + webhook delivery**              | Foundation for automation and third-party integrations.             |
| High     | **Module/feature flags per tenant**           | Enables packaging and A/B rollout.                                  |
| High     | **Developer portal + OpenAPI**                | Low–medium effort; improves adoption of public API.                 |


### Nice to have


| Priority     | Item                                 | Rationale                                     |
| ------------ | ------------------------------------ | --------------------------------------------- |
| Nice to have | **Points & credits / loyalty**       | Differentiation in loyalty for services.      |
| Nice to have | **Installments / payment plans**     | Supports higher-ticket services and packages. |
| Nice to have | **Lead pipeline + follow-up rules**  | Useful if you target sales-heavy teams.       |
| Nice to have | **ESS (employee self-service) API**  | Reduces admin and supports mobile workforce.  |
| Nice to have | **Caching (e.g. slot availability)** | Improves performance at scale.                |


### Future / advanced


| Priority | Item                                      | Rationale                                          |
| -------- | ----------------------------------------- | -------------------------------------------------- |
| Future   | **Workflow engine for booking lifecycle** | Clean state transitions and extensible automation. |
| Future   | **AI-assisted analytics API**             | Differentiation and premium tier.                  |
| Future   | **Full accounting (GL, P&L)**             | Only if product strategy includes “accounting”.    |
| Future   | **POS + offline sync**                    | Only if you add in-person/retail.                  |
| Future   | **Inventory / products**                  | Only if you add product sales.                     |


---

## Summary

- **Daftra** is a full ERP (accounting, inventory, HR, POS, CRM, operations). Your backend is a **focused booking + services + packages + invoicing (Zoho) + comms** system with multi-tenant and RBAC.
- **Largest gaps** vs Daftra: no accounting, no POS, no inventory, no HR/payroll, no public API product (keys + webhooks + docs), no configurable automation.
- **Recommended focus** for your backend: **reliability and extensibility** (idempotency, audit, tenant isolation), then **API product** (public API, keys, webhooks, docs), then **automation** (auto-send rules, event bus), then optional **loyalty, installments, ESS** depending on product strategy.  
- **Advanced differentiators** (event audit, workflow engine, AI analytics, extensibility, multi-tenant BI pipeline) can be phased in after core gaps are addressed.

If you specify a target segment (e.g. “salons only” or “enterprise multi-location”), the roadmap can be narrowed and re-prioritized accordingly.