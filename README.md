# Bookati - Multi-Tenant Booking & Authorization SaaS Platform

## Overview

Bookati is a comprehensive multi-tenant booking management platform designed for service businesses across Saudi Arabia. Built with **performance, scalability, and security** as top priorities.

## Phase 1 MVP - What's Implemented

### ✅ Completed Foundation

#### 1. Database Architecture (PostgreSQL/Supabase)
- **Multi-tenant schema** with row-level security (RLS)
- Complete table structure for tenants, users, services, shifts, time_slots, bookings
- **Booking lock mechanism** for concurrent booking protection
- **Audit logging** infrastructure for compliance
- **Timezone enforcement** (UTC storage, tenant-specific display)
- Future-ready tables for Phase 2: payments, OTP, SMS logs, queue jobs
- Performance indexes on all critical columns
- See `supabase/setup.sql` for complete schema

#### 2. Authentication & Authorization
- JWT-based authentication using Supabase Auth
- Role-based access control (RBAC): Solution Owner, Tenant Admin, Receptionist, Cashier, Employee
- Auth context with session management
- Protected route infrastructure

#### 3. Internationalization (i18n)
- Full bilingual support: English & Arabic
- RTL layout switching for Arabic
- Translation files in `/src/locales/`
- Language toggle component with persistent storage

#### 4. Timezone Management
- Utility functions for UTC ↔ Tenant timezone conversion
- Asia/Riyadh default with customizable tenant timezone
- Date formatting in tenant's local timezone
- See `/src/lib/timezone.ts`

#### 5. QR Code System
- JWT-based QR token generation with signatures
- Payload includes: booking_id, tenant_id, customer_name, timestamps
- Verification with expiration checking
- 48-hour validity after booking time
- See `/src/lib/qr.ts`

#### 6. UI Component Library
- **Button** - Multiple variants (primary, secondary, danger, ghost) with loading states
- **Input** - Form inputs with labels, errors, helper text
- **Card** - Container components with headers and content areas
- **Modal** - Accessible modals with keyboard support
- **LanguageToggle** - Bilingual switching with RTL support
- All components are RTL-compatible

#### 7. Project Structure
```
src/
├── components/
│   ├── ui/              # Reusable UI components
│   ├── layout/          # Layout components (headers, footers)
│   ├── booking/         # Booking-specific components (to be added)
│   ├── admin/           # Admin panel components (to be added)
│   └── public/          # Public-facing components (to be added)
├── contexts/
│   └── AuthContext.tsx  # Authentication state management
├── hooks/               # Custom React hooks (to be added)
├── lib/
│   ├── supabase.ts      # Supabase client configuration
│   ├── i18n.ts          # i18n setup
│   ├── timezone.ts      # Timezone utilities
│   └── qr.ts            # QR token generation/verification
├── locales/
│   ├── en.json          # English translations
│   └── ar.json          # Arabic translations
├── pages/
│   ├── HomePage.tsx     # Landing page
│   ├── auth/
│   │   └── LoginPage.tsx # Login page
│   ├── admin/           # Admin pages (to be added)
│   ├── tenant/          # Tenant-specific pages (to be added)
│   └── employee/        # Employee pages (to be added)
├── types/
│   └── index.ts         # TypeScript type definitions
└── App.tsx              # Main app with routing
```

## Technology Stack

### Frontend
- **React 18** with TypeScript
- **Vite** for build tooling
- **TailwindCSS** for styling
- **React Router** for routing
- **i18next** for internationalization
- **date-fns** & **date-fns-tz** for timezone handling
- **lucide-react** for icons
- **qrcode.react** for QR code generation
- **jwt-simple** for QR token signing

### Backend/Database
- **Supabase** (PostgreSQL + Auth + Storage)
- Row Level Security (RLS) for multi-tenancy
- PostgreSQL triggers and functions
- Full-text search capabilities

## Critical Security Features

### 1. Tenant Isolation
- Every table includes `tenant_id` column
- RLS policies enforce tenant-scoped queries
- No tenant can access another tenant's data
- Solution Owners have cross-tenant visibility

### 2. Booking Lock Mechanism
- Prevents double-booking under high traffic
- Uses PostgreSQL `SELECT FOR UPDATE`
- 10-minute lock duration during checkout
- Automatic lock expiration cleanup

### 3. Pre-Validation Layer
- Checks slot capacity before booking
- Verifies employee availability
- Confirms service is public/private as appropriate
- Validates tenant is active and not in maintenance mode
- Verifies shift is valid for selected date/time

### 4. Audit Logging
- Records all state changes (who, what, when)
- Tracks booking creation, modifications, cancellations
- Stores old_values and new_values (JSONB)
- IP address and user agent tracking
- Minimum 2-year retention for compliance

### 5. Maintenance Mode
- Per-tenant toggle for operational flexibility
- Disables public booking without deactivating subscription
- Admin and receptionist access remains functional
- Useful for schedule changes or emergencies

## Environment Variables

Create a `.env` file with:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_QR_SECRET=your_secret_key_for_qr_signing
```

## Database Setup

1. **Connect to your Supabase project**
2. **Run the schema setup** from SQL Editor:
   ```sql
   -- Copy contents of supabase/setup.sql and execute
   ```
3. **Verify tables created**:
   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public';
   ```

## Installation & Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type checking
npm run typecheck

# Linting
npm run lint
```

## What's Next (Remaining Phase 1 Work)

### High Priority
1. **API Layer** - Create REST endpoints for all CRUD operations
   - Public API (`/public/api/`) for customer bookings
   - Admin API (`/admin/api/`) for management operations
   - Implement slot generation function
   - Pre-validation endpoint for booking checks

2. **Solution Owner Console**
   - Tenant creation form
   - Tenant management dashboard
   - Subscription date management
   - Platform-wide analytics

3. **Tenant Admin Dashboard**
   - Service & category management (CRUD)
   - Employee management
   - Shift scheduler with slot auto-generation
   - Booking management with filters
   - Tenant settings (theme, timezone, maintenance mode)
   - Activity logs viewer

4. **Receptionist Interface**
   - Quick booking form
   - Customer search/add modal
   - Real-time slot availability
   - Manual payment marking
   - QR ticket generation and download

5. **Public Tenant Landing Page**
   - Hero section with tenant branding
   - Service cards grid
   - Theme application (dynamic colors)
   - Service detail page with tabs
   - Responsive design (mobile-first)

6. **Customer Booking Flow**
   - Date picker with availability
   - Time slot selector with capacity badges
   - Visitor count input
   - Booking summary and confirmation
   - QR ticket display and download

7. **QR Check-in Interface**
   - Camera-based QR scanner
   - Token verification
   - Check-in action with timestamp
   - Manual search fallback

8. **Employee Portal**
   - Schedule viewer
   - Booking details
   - Basic profile page

### Medium Priority
- Booking state machine enforcement
- Slot generation automation from shifts
- PDF ticket generation
- Email notifications (non-SMS)
- Performance optimizations
- Error boundaries and fallbacks

### Phase 2 Features (Deferred)
- SMS/OTP integration
- Payment gateway integration (Stripe, PayTabs)
- Review approval system
- Advanced analytics and reporting
- Authorization workflows (Phase 3)

## Key Design Decisions

### 1. UTC Storage, Local Display
All timestamps stored as UTC in database, converted to tenant's timezone only for display. This ensures consistency across different regions.

### 2. Booking Lock Strategy
Uses database-level locking (SELECT FOR UPDATE) rather than application-level locks. This is more reliable for distributed systems and prevents race conditions.

### 3. Separate API Namespaces
Public API and Admin API are separated for security and scalability:
- Public API has rate limiting and caching
- Admin API requires authentication and role verification

### 4. QR Token Design
Uses JWT with cryptographic signature rather than random codes. This allows stateless verification without database lookups for every scan.

### 5. Audit Log Structure
Uses JSONB for flexibility in storing old/new values. This allows for schema changes without breaking audit history.

## Performance Considerations

### Database Indexes
- Composite indexes on (tenant_id, created_at) for fast tenant-scoped queries
- Partial indexes on `is_available = true` for slot queries
- Index on booking status for dashboard queries

### Caching Strategy (To Implement)
- Public services list cached per tenant
- Slot availability cached with 5-minute TTL
- Tenant configuration cached

### Optimization Tips
- Use `SELECT FOR UPDATE SKIP LOCKED` for concurrent booking handling
- Batch slot generation in background jobs
- Use Supabase realtime for live slot updates
- Implement pagination for all list views

## Common Issues & Solutions

### Issue: Double Booking
**Solution**: Booking lock mechanism with SELECT FOR UPDATE ensures only one transaction can modify slot capacity at a time.

### Issue: Timezone Confusion
**Solution**: Always store UTC, display in tenant timezone. Use utility functions consistently.

### Issue: Slow Slot Queries
**Solution**: Indexes on (tenant_id, start_time_utc, is_available). Consider slot pre-generation for next 90 days.

### Issue: Audit Log Size
**Solution**: Partition audit_logs table by month. Archive old logs to cold storage.

## Deployment

### Prerequisites
- Node.js 18+ and npm
- Supabase project with PostgreSQL database
- Production environment variables

### Steps
1. Run database schema setup in Supabase
2. Configure environment variables
3. Build production bundle: `npm run build`
4. Deploy `/dist` folder to hosting provider (Vercel, Netlify, etc.)
5. Set up Supabase edge functions for webhooks (Phase 2)

## Support & Documentation

- **Database Schema**: See `supabase/setup.sql`
- **API Documentation**: To be generated from endpoints
- **Type Definitions**: See `src/types/index.ts`
- **Translations**: Add new keys to `src/locales/*.json`

## License

Proprietary - All Rights Reserved

## Project Status

**Phase 1 MVP**: ~40% Complete
- ✅ Foundation (Database, Auth, i18n, Utilities)
- 🚧 Admin Interfaces
- 🚧 Booking Flows
- 🚧 QR System Integration
- ⏳ Testing & Validation

**Estimated Completion**: 4-6 weeks with focused development

---

**Built with performance, scalability, and security as top priorities.**
