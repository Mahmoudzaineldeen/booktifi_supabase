# Bookati - Multi-Tenant Appointment Booking System

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![React](https://img.shields.io/badge/React-18.3.1-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)
![Supabase](https://img.shields.io/badge/Supabase-2.57.4-green.svg)

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [Features](#features)
3. [Technology Stack](#technology-stack)
4. [System Architecture](#system-architecture)
5. [Prerequisites](#prerequisites)
6. [Installation](#installation)
7. [Environment Configuration](#environment-configuration)
8. [Database Setup](#database-setup)
9. [Running the Project](#running-the-project)
10. [File Structure](#file-structure)
11. [Database Schema](#database-schema)
12. [API Endpoints](#api-endpoints)
13. [User Roles & Permissions](#user-roles--permissions)
14. [Key Features Explained](#key-features-explained)
15. [Deployment](#deployment)
16. [Developer Notes](#developer-notes)
17. [Troubleshooting](#troubleshooting)
18. [Contributing](#contributing)

---

## 🎯 Project Overview

**Bookati** is a comprehensive multi-tenant appointment booking and management system designed for service-based businesses such as salons, spas, clinics, and consulting firms. The platform enables businesses to manage their services, employees, bookings, and customers efficiently while providing a seamless booking experience for end-users.

### Project Name
**Bookati** (Arabic: بوكاتي) - derived from "Booking" combined with an Arabic suffix, representing a modern booking solution for Arabic and international markets.

### Use Cases
- Beauty Salons & Spas
- Medical Clinics & Healthcare
- Consulting & Professional Services
- Fitness & Wellness Centers
- Educational Tutoring Services
- Any appointment-based service business

---

## ✨ Features

### 🏢 Multi-Tenancy
- Complete tenant isolation with dedicated data spaces
- Custom branding per tenant (name, logo, colors)
- Unique booking URLs for each tenant
- Bilingual support (English & Arabic)

### 👥 Role-Based Access Control
- **Solution Owner**: Super admin with full system access
- **Tenant Admin**: Business owner managing their organization
- **Reception**: Staff handling day-to-day bookings
- **Employee**: Service providers viewing their schedules

### 📅 Advanced Booking System
- **Multiple Booking Modes**:
  - Single booking (one service, one employee)
  - Parallel booking (multiple employees simultaneously)
  - Consecutive booking (same employee, sequential times)
  - Mixed mode (parallel + extension for overflow)

- **Smart Slot Management**:
  - Automatic time slot generation based on shifts
  - Real-time capacity tracking
  - Employee-level capacity override
  - Conflict detection and prevention

- **Two-Step Confirmation**:
  - Preview booking details before confirmation
  - Edit capability before final submission
  - Comprehensive booking summary display

### 📦 Service Package System
- Create service packages with multiple included services
- Track package usage per customer
- Automatic package credit application
- Package expiration management
- Remaining quantity indicators

### 👤 Customer Management
- Customer database with booking history
- Phone number-based lookup
- Email and contact information
- Total bookings tracking
- Last booking date

### 🗓️ Calendar & Schedule Management
- Week view calendar for booking visualization
- Day-by-day slot availability
- Employee schedule management
- Shift-based time slot generation
- Timezone support

### 📱 Public Booking Interface
- QR code generation for each tenant
- Responsive mobile-first design
- Real-time availability checking
- Customer self-service booking

### 📊 Dashboard & Analytics
- Booking statistics and trends
- Revenue tracking
- Employee performance metrics
- Service popularity analysis
- Time-based filters (daily, weekly, monthly, yearly)

### 🌐 Internationalization (i18n)
- Full bilingual support (English/Arabic)
- RTL (Right-to-Left) layout for Arabic
- Dynamic language switching
- Localized date and time formats

---

## 🛠️ Technology Stack

### Frontend
- **React 18.3.1** - UI library
- **TypeScript 5.9.3** - Type safety
- **Vite 5.4.21** - Build tool and dev server
- **Tailwind CSS 3.4.1** - Utility-first CSS framework
- **React Router DOM 7.9.6** - Client-side routing
- **React i18next 16.3.5** - Internationalization
- **Lucide React 0.344.0** - Icon library
- **date-fns 4.1.0** - Date manipulation
- **QRCode.react 4.2.0** - QR code generation

### Backend & Database
- **Supabase 2.57.4** - Backend as a Service
  - PostgreSQL database
  - Row Level Security (RLS)
  - Authentication system
  - Edge Functions
  - Realtime subscriptions

### Development Tools
- **ESLint 9.9.1** - Code linting
- **PostCSS 8.4.35** - CSS processing
- **Autoprefixer 10.4.18** - CSS vendor prefixes

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React + TS)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Admin   │  │Reception │  │ Employee │  │  Public  │   │
│  │Dashboard │  │   Page   │  │   Page   │  │ Booking  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│         │              │              │            │         │
│         └──────────────┴──────────────┴────────────┘         │
│                           │                                   │
│                    ┌──────▼──────┐                           │
│                    │   Supabase  │                           │
│                    │   Client    │                           │
│                    └──────┬──────┘                           │
└───────────────────────────┼──────────────────────────────────┘
                            │
                ┌───────────▼───────────┐
                │   Supabase Backend    │
                │  ┌─────────────────┐  │
                │  │   PostgreSQL    │  │
                │  │    Database     │  │
                │  └─────────────────┘  │
                │  ┌─────────────────┐  │
                │  │  Row Level      │  │
                │  │   Security      │  │
                │  └─────────────────┘  │
                │  ┌─────────────────┐  │
                │  │  Edge Functions │  │
                │  │  - Slot Gen     │  │
                │  │  - Employee Ops │  │
                │  └─────────────────┘  │
                └───────────────────────┘
```

### Data Flow

1. **User Authentication**: Supabase Auth handles login/signup
2. **Authorization**: Row Level Security policies enforce access control
3. **Data Access**: React queries Supabase PostgreSQL via JS client
4. **Real-time Updates**: Supabase realtime subscriptions for live data
5. **Business Logic**: Edge Functions for complex operations (slot generation)

---

## 📋 Prerequisites

Before installing the project, ensure you have the following:

### Required Software
- **Node.js**: Version 18.x or higher
- **npm**: Version 9.x or higher (comes with Node.js)
- **Git**: For version control
- **Modern Web Browser**: Chrome, Firefox, Safari, or Edge (latest version)

### Required Accounts
- **Supabase Account**: Free tier available at [supabase.com](https://supabase.com)
  - You'll need to create a project
  - Note your project URL and anon key

### Knowledge Requirements
- Basic understanding of React and TypeScript
- Familiarity with SQL and database concepts
- Understanding of REST APIs
- Basic command line usage

---

## 🚀 Installation

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd bookati
```

### Step 2: Install Dependencies

```bash
npm install
```

This will install all required packages listed in `package.json`.

### Step 3: Set Up Supabase

1. **Create a Supabase Project**:
   - Go to [supabase.com](https://supabase.com)
   - Click "New Project"
   - Fill in project details
   - Wait for project initialization (2-3 minutes)

2. **Get API Keys**:
   - Navigate to Project Settings → API
   - Copy the `Project URL`
   - Copy the `anon/public` key

3. **Enable Email/Password Authentication**:
   - Go to Authentication → Providers
   - Enable Email provider
   - Disable email confirmation (optional for development)

### Step 4: Run Database Migrations

Execute all migration files in order from the `supabase/migrations` folder:

```sql
-- Run each migration file in Supabase SQL Editor
-- Files are numbered sequentially starting with:
-- 20251121155223_create_bookati_schema.sql
-- Follow the timestamp order
```

**Important**: Run migrations in timestamp order to ensure proper schema creation.

### Step 5: Deploy Edge Functions

Deploy the Edge Functions using the Supabase CLI or management interface:

```bash
# Install Supabase CLI (if not installed)
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref <your-project-ref>

# Deploy Edge Functions
supabase functions deploy generate-slots
supabase functions deploy create-employee
supabase functions deploy update-employee
```

---

## ⚙️ Environment Configuration

### Environment Variables

Create a `.env` file in the project root with the following variables:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# QR Code Secret (for secure QR generation)
VITE_QR_SECRET=your-random-secret-key-here
```

### Configuration Explanation

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `VITE_SUPABASE_URL` | Your Supabase project URL | Yes | `https://abc123.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Public anon key from Supabase | Yes | `eyJhbGciOiJIUzI1NiIsInR5cCI6...` |
| `VITE_QR_SECRET` | Secret key for QR code encryption | Yes | `bookati-qr-secret-2025` |

### Security Notes

- **Never commit `.env` file to Git** (already in `.gitignore`)
- Use different secrets for production vs development
- Rotate secrets periodically
- Keep `SUPABASE_ANON_KEY` public-facing only (use service role key in backend)

---

## 🗄️ Database Setup

### Database Tables Overview

The system uses 14 main tables:

#### 1. **tenants**
Stores tenant (business) information.

```sql
- id: uuid (PK)
- name: text (Business name in English)
- name_ar: text (Business name in Arabic)
- slug: text (Unique URL identifier)
- logo_url: text (Logo image)
- primary_color: text (Brand color)
- created_at: timestamptz
```

#### 2. **users**
User accounts with role-based access.

```sql
- id: uuid (PK)
- tenant_id: uuid (FK → tenants)
- username: text (Unique login)
- email: text (Optional)
- full_name: text
- full_name_ar: text
- role: enum (solution_owner, tenant_admin, reception, employee)
- password_hash: text
- is_active: boolean
- created_at: timestamptz
```

#### 3. **services**
Services offered by tenants.

```sql
- id: uuid (PK)
- tenant_id: uuid (FK → tenants)
- name: text
- name_ar: text
- description: text
- base_price: decimal
- default_duration_minutes: integer
- default_capacity: integer (per time slot)
- is_active: boolean
```

#### 4. **employees**
Service providers (links users to services).

```sql
- id: uuid (PK)
- user_id: uuid (FK → users)
- tenant_id: uuid (FK → tenants)
- hire_date: date
- is_active: boolean
```

#### 5. **employee_services**
Maps employees to services they can provide.

```sql
- id: uuid (PK)
- employee_id: uuid (FK → employees)
- service_id: uuid (FK → services)
- shift_id: uuid (FK → shifts)
- custom_duration_minutes: integer (override service default)
- custom_capacity: integer (override service default)
```

#### 6. **shifts**
Working hours for services.

```sql
- id: uuid (PK)
- tenant_id: uuid (FK → tenants)
- service_id: uuid (FK → services)
- name: text
- day_of_week: integer (0=Sunday, 6=Saturday)
- start_time: time
- end_time: time
- is_active: boolean
```

#### 7. **slots**
Time slots for bookings (auto-generated).

```sql
- id: uuid (PK)
- tenant_id: uuid (FK → tenants)
- shift_id: uuid (FK → shifts)
- employee_id: uuid (FK → employees)
- slot_date: date
- start_time: time
- end_time: time
- available_capacity: integer
- original_capacity: integer
- booked_count: integer
- is_available: boolean
```

#### 8. **customers**
Customer information.

```sql
- id: uuid (PK)
- tenant_id: uuid (FK → tenants)
- phone: text (Unique per tenant)
- name: text
- email: text
- total_bookings: integer
- last_booking_at: timestamptz
```

#### 9. **bookings**
Appointment bookings.

```sql
- id: uuid (PK)
- tenant_id: uuid (FK → tenants)
- service_id: uuid (FK → services)
- slot_id: uuid (FK → slots)
- employee_id: uuid (FK → employees)
- customer_id: uuid (FK → customers)
- customer_name: text
- customer_phone: text
- customer_email: text
- visitor_count: integer
- total_price: decimal
- status: enum (pending, confirmed, completed, cancelled)
- payment_status: enum (unpaid, paid, paid_manual, awaiting_payment, refunded)
- booking_group_id: uuid (groups parallel bookings)
- notes: text
- created_at: timestamptz
```

#### 10. **booking_locks**
Temporary locks during booking process.

```sql
- id: uuid (PK)
- slot_id: uuid (FK → slots)
- customer_id: uuid (FK → customers)
- locked_at: timestamptz
- expires_at: timestamptz
```

#### 11. **service_packages**
Service bundles for customers.

```sql
- id: uuid (PK)
- tenant_id: uuid (FK → tenants)
- name: text
- name_ar: text
- description: text
- total_price: decimal
- duration_days: integer (validity period)
- is_active: boolean
```

#### 12. **package_services**
Services included in packages.

```sql
- id: uuid (PK)
- package_id: uuid (FK → service_packages)
- service_id: uuid (FK → services)
- quantity: integer (included service count)
```

#### 13. **customer_subscriptions**
Customer package purchases.

```sql
- id: uuid (PK)
- customer_id: uuid (FK → customers)
- package_id: uuid (FK → service_packages)
- tenant_id: uuid (FK → tenants)
- purchased_at: timestamptz
- expires_at: timestamptz
- is_active: boolean
```

#### 14. **subscription_usage**
Tracks package service usage.

```sql
- id: uuid (PK)
- subscription_id: uuid (FK → customer_subscriptions)
- service_id: uuid (FK → services)
- original_quantity: integer
- remaining_quantity: integer
- booking_id: uuid (FK → bookings)
```

### Key Database Features

- **Row Level Security (RLS)**: All tables have RLS enabled with tenant-specific policies
- **Foreign Keys**: Ensure referential integrity
- **Triggers**: Auto-update capacities on booking changes
- **Functions**:
  - `generate_slots_for_shift()`: Creates time slots
  - `check_employee_availability()`: Validates double-booking
  - `restore_package_usage()`: Handles cancellations

---

## 🔌 API Endpoints

### Supabase Edge Functions

#### 1. Generate Slots
**Endpoint**: `/functions/v1/generate-slots`
**Method**: POST
**Purpose**: Generate time slots for employee shifts

**Request**:
```json
{
  "employee_id": "uuid",
  "shift_id": "uuid",
  "start_date": "2025-01-01",
  "end_date": "2025-01-31"
}
```

**Response**:
```json
{
  "success": true,
  "slots_created": 120,
  "message": "Slots generated successfully"
}
```

#### 2. Create Employee
**Endpoint**: `/functions/v1/create-employee`
**Method**: POST
**Purpose**: Create employee with user account

**Request**:
```json
{
  "tenant_id": "uuid",
  "username": "employee123",
  "full_name": "John Doe",
  "full_name_ar": "جون دو",
  "password": "securepass123"
}
```

**Response**:
```json
{
  "success": true,
  "user_id": "uuid",
  "employee_id": "uuid"
}
```

#### 3. Update Employee
**Endpoint**: `/functions/v1/update-employee`
**Method**: POST
**Purpose**: Update employee information

**Request**:
```json
{
  "employee_id": "uuid",
  "full_name": "John Smith",
  "is_active": true
}
```

### Supabase Client API (JavaScript)

All database operations use the Supabase JavaScript client:

```typescript
// Example: Fetch bookings
const { data, error } = await supabase
  .from('bookings')
  .select('*')
  .eq('tenant_id', tenantId)
  .order('created_at', { ascending: false });

// Example: Create booking
const { data, error } = await supabase
  .from('bookings')
  .insert({
    tenant_id: tenantId,
    service_id: serviceId,
    slot_id: slotId,
    customer_name: name,
    // ... other fields
  });
```

---

## 👥 User Roles & Permissions

### Solution Owner
**Access**: Full system access

**Capabilities**:
- View all tenants
- Create/manage tenants
- Access all tenant data
- System-wide analytics

**Default Login**:
```
Username: admin
Password: (set during first run)
```

### Tenant Admin
**Access**: Own tenant only

**Capabilities**:
- Manage services and packages
- Manage employees and schedules
- View all bookings
- Configure tenant settings
- Access dashboard analytics

**URL**: `/login` (tenant-specific)

### Reception
**Access**: Own tenant only

**Capabilities**:
- Create/manage bookings
- View customer information
- Search and lookup customers
- Process package subscriptions
- Manage daily operations

**URL**: `/login` (tenant-specific)

### Employee
**Access**: Own schedule only

**Capabilities**:
- View assigned bookings
- Update booking status
- View personal schedule
- Limited customer information

**URL**: `/employee` (after login)

---

## 🎨 Key Features Explained

### 1. Multi-Tenant Architecture

Each tenant operates independently with:
- Unique URL slug (e.g., `/book/salon-abc`)
- Isolated data (enforced by RLS)
- Custom branding
- Separate user base

**Technical Implementation**:
```typescript
// All queries filter by tenant_id
const { data } = await supabase
  .from('bookings')
  .select('*')
  .eq('tenant_id', userProfile.tenant_id);
```

### 2. Smart Booking Logic

#### Parallel Booking
Multiple employees serve one customer simultaneously.

**Example**: Hair coloring + styling by 2 stylists at same time

**Implementation**:
- Creates multiple booking records
- Same `booking_group_id`
- Same time slot
- Different employees

#### Consecutive Booking
Same employee, multiple sequential time slots.

**Example**: 3-hour spa package split into 3 one-hour slots

**Implementation**:
- Multiple booking records
- Same employee
- Sequential time slots
- Same `booking_group_id`

#### Mixed Mode (Parallel + Extension)
When not enough employees available for full parallel booking.

**Example**: Need 3 stylists but only 2 available
- 2 parallel at 10:00 AM
- 1 extension at 11:00 AM

### 3. Package System

**Workflow**:
1. Tenant creates package with included services
2. Customer purchases package
3. Reception books using package
4. System automatically deducts from package quantity
5. Remaining balance tracked in real-time

**Benefits**:
- Encourages upfront payment
- Customer loyalty
- Simplified pricing
- Automated tracking

### 4. Two-Step Booking Confirmation

**Why**:
- Reduces booking errors
- Allows review before submission
- Clear information display
- Better UX for receptionists

**Flow**:
1. User fills booking form
2. Clicks "Proceed"
3. Preview ticket shown
4. User reviews details
5. Either "Edit" or "Confirm"

### 5. Real-Time Slot Management

**Capacity Tracking**:
```
available_capacity = original_capacity - booked_count
```

**Auto-updates**:
- New booking: decrements capacity
- Cancellation: restores capacity
- Prevents overbooking

### 6. Employee Conflict Prevention

**Database Trigger**:
```sql
-- Prevents employee double-booking
CREATE TRIGGER prevent_employee_double_booking
  BEFORE INSERT ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_employee_availability();
```

---

## 🏃 Running the Project

### Development Mode

```bash
npm run dev
```

This starts the development server at `http://localhost:5173`

**Features**:
- Hot Module Replacement (HMR)
- Fast refresh
- Error overlay
- Source maps

### Production Build

```bash
npm run build
```

Creates optimized production build in `dist/` folder.

### Preview Production Build

```bash
npm run preview
```

Preview the production build locally at `http://localhost:4173`

### Type Checking

```bash
npm run typecheck
```

Runs TypeScript compiler without emitting files to check for type errors.

### Linting

```bash
npm run lint
```

Runs ESLint to check code quality and style.

---

## 📁 File Structure

```
bookati/
├── public/                      # Static assets
├── src/                         # Source code
│   ├── assets/                  # Images, fonts, etc.
│   ├── components/              # React components
│   │   ├── dashboard/           # Dashboard charts and stats
│   │   │   ├── ComparisonChart.tsx
│   │   │   ├── PerformanceChart.tsx
│   │   │   ├── PieChart.tsx
│   │   │   ├── StatCard.tsx
│   │   │   └── TimeFilter.tsx
│   │   ├── layout/              # Layout components
│   │   │   ├── LanguageToggle.tsx
│   │   │   └── TenantLayout.tsx
│   │   └── ui/                  # Reusable UI components
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       ├── Input.tsx
│   │       ├── Modal.tsx
│   │       └── WarningModal.tsx
│   ├── contexts/                # React Context providers
│   │   └── AuthContext.tsx     # Authentication state
│   ├── lib/                     # Utility libraries
│   │   ├── capacityUtils.ts    # Capacity calculation logic
│   │   ├── countryCodes.ts     # Phone country codes
│   │   ├── i18n.ts             # Internationalization config
│   │   ├── qr.ts               # QR code utilities
│   │   ├── supabase.ts         # Supabase client
│   │   ├── supabase-admin.ts   # Admin Supabase client
│   │   └── timezone.ts         # Timezone utilities
│   ├── locales/                 # Translation files
│   │   ├── ar.json              # Arabic translations
│   │   └── en.json              # English translations
│   ├── pages/                   # Page components
│   │   ├── admin/               # Admin pages
│   │   │   ├── ManagementLoginPage.tsx
│   │   │   └── SolutionOwnerDashboard.tsx
│   │   ├── auth/                # Authentication pages
│   │   │   ├── LoginPage.tsx
│   │   │   └── SignupPage.tsx
│   │   ├── employee/            # Employee pages
│   │   │   └── EmployeePage.tsx
│   │   ├── public/              # Public pages
│   │   │   └── PublicBookingPage.tsx
│   │   ├── reception/           # Reception pages
│   │   │   └── ReceptionPage.tsx
│   │   └── tenant/              # Tenant admin pages
│   │       ├── BookingsPage.tsx
│   │       ├── EmployeesPage.tsx
│   │       ├── LandingPageBuilder.tsx
│   │       ├── PackagesPage.tsx
│   │       ├── ServicesPage.tsx
│   │       ├── SettingsPage.tsx
│   │       └── TenantDashboard.tsx
│   ├── types/                   # TypeScript type definitions
│   │   └── index.ts
│   ├── App.tsx                  # Main App component
│   ├── main.tsx                 # Entry point
│   └── index.css                # Global styles
├── supabase/                    # Supabase configuration
│   ├── functions/               # Edge Functions
│   │   ├── create-employee/
│   │   │   └── index.ts
│   │   ├── generate-slots/
│   │   │   └── index.ts
│   │   └── update-employee/
│   │       └── index.ts
│   └── migrations/              # Database migrations (37 files)
│       ├── 20251121155223_create_bookati_schema.sql
│       ├── 20251121155318_add_rls_policies.sql
│       └── ... (35 more)
├── .env                         # Environment variables (gitignored)
├── .env.example                 # Environment template
├── .gitignore                   # Git ignore rules
├── eslint.config.js             # ESLint configuration
├── index.html                   # HTML template
├── package.json                 # Dependencies and scripts
├── package-lock.json            # Locked dependency versions
├── postcss.config.js            # PostCSS configuration
├── tailwind.config.js           # Tailwind CSS configuration
├── tsconfig.json                # TypeScript configuration
├── tsconfig.app.json            # App-specific TS config
├── tsconfig.node.json           # Node-specific TS config
├── vite.config.ts               # Vite configuration
├── README.md                    # Original README
└── NEW_README.md                # This comprehensive guide
```

### Key Directories Explained

#### `/src/components`
Reusable React components organized by feature:
- **dashboard/**: Charts and statistics visualization
- **layout/**: Page layouts and navigation
- **ui/**: Generic UI elements (buttons, modals, inputs)

#### `/src/pages`
Page-level components mapped to routes:
- **admin/**: Solution owner management
- **tenant/**: Business owner features
- **reception/**: Daily operations interface
- **employee/**: Staff schedule view
- **public/**: Customer-facing booking

#### `/src/lib`
Utility functions and configurations:
- **supabase.ts**: Database client initialization
- **i18n.ts**: Language switching logic
- **capacityUtils.ts**: Booking capacity calculations

#### `/supabase`
Backend logic and schema:
- **functions/**: Server-side operations
- **migrations/**: Database version control

---

## 🚀 Deployment

### Option 1: Vercel (Recommended)

1. **Install Vercel CLI**:
```bash
npm install -g vercel
```

2. **Login to Vercel**:
```bash
vercel login
```

3. **Deploy**:
```bash
npm run build
vercel --prod
```

4. **Set Environment Variables**:
In Vercel dashboard:
- Go to Project Settings → Environment Variables
- Add `VITE_SUPABASE_URL`
- Add `VITE_SUPABASE_ANON_KEY`
- Add `VITE_QR_SECRET`

### Option 2: Netlify

1. **Install Netlify CLI**:
```bash
npm install -g netlify-cli
```

2. **Login**:
```bash
netlify login
```

3. **Deploy**:
```bash
npm run build
netlify deploy --prod --dir=dist
```

4. **Set Environment Variables**:
In Netlify dashboard:
- Site Settings → Build & Deploy → Environment
- Add all `VITE_*` variables

### Option 3: Traditional Hosting (Apache/Nginx)

1. **Build**:
```bash
npm run build
```

2. **Upload**:
Upload contents of `dist/` folder to web server

3. **Configure Server**:
For single-page app routing:

**Nginx** (`/etc/nginx/sites-available/bookati`):
```nginx
server {
    listen 80;
    server_name bookati.com;
    root /var/www/bookati/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**Apache** (`.htaccess` in dist folder):
```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

### Production Checklist

- [ ] Set production environment variables
- [ ] Enable HTTPS/SSL
- [ ] Configure custom domain
- [ ] Set up CDN (optional)
- [ ] Enable error monitoring (Sentry, etc.)
- [ ] Configure analytics
- [ ] Test all user flows
- [ ] Backup database
- [ ] Document admin credentials

---

## 👨‍💻 Developer Notes

### Important Coding Practices

#### 1. Row Level Security (RLS)
**Always filter by tenant_id**:
```typescript
// ✅ Correct
const { data } = await supabase
  .from('services')
  .select('*')
  .eq('tenant_id', userProfile.tenant_id);

// ❌ Wrong - exposes all tenants' data
const { data } = await supabase
  .from('services')
  .select('*');
```

#### 2. Type Safety
Always define TypeScript interfaces:
```typescript
interface Service {
  id: string;
  tenant_id: string;
  name: string;
  name_ar: string;
  base_price: number;
  // ...
}
```

#### 3. Error Handling
Always handle Supabase errors:
```typescript
const { data, error } = await supabase.from('bookings').select('*');
if (error) {
  console.error('Error:', error);
  // Show user-friendly message
  return;
}
```

#### 4. Bilingual Support
Always provide both languages:
```typescript
// Display logic
const displayName = i18n.language === 'ar'
  ? service.name_ar
  : service.name;

// Database insert
await supabase.from('services').insert({
  name: 'Haircut',
  name_ar: 'قص شعر',
  // ...
});
```

### Common Pitfalls

1. **Forgetting tenant_id filter**: Always include in queries
2. **Not handling async operations**: Use async/await properly
3. **Ignoring time zones**: Use UTC in database, convert for display
4. **Hardcoding values**: Use environment variables
5. **Not testing both languages**: Always check Arabic (RTL) layout

### Performance Tips

1. **Limit query results**: Use `.limit()` for large datasets
2. **Select specific columns**: Don't use `select('*')` unnecessarily
3. **Use indexes**: Add database indexes for frequently queried columns
4. **Cache static data**: Services, employees rarely change
5. **Debounce search inputs**: Avoid excessive API calls

### Security Considerations

1. **Never expose service role key**: Use anon key in frontend
2. **Validate user input**: Sanitize before database operations
3. **Use RLS policies**: Don't rely on frontend checks alone
4. **Secure Edge Functions**: Verify JWT tokens
5. **Rotate secrets regularly**: Update QR secret and keys

### Debugging Tips

```typescript
// Enable detailed Supabase logs
const supabase = createClient(url, key, {
  auth: {
    debug: true
  }
});

// Check RLS policies
console.log('User profile:', userProfile);
console.log('Tenant ID:', userProfile?.tenant_id);

// Test queries in Supabase SQL Editor first
```

---

## 🔧 Troubleshooting

### Common Issues

#### 1. "No rows returned" error
**Cause**: RLS policy blocking access
**Solution**:
- Check user's tenant_id matches query
- Verify RLS policies in Supabase dashboard
- Test query with service role key

#### 2. "Invalid UUID" error
**Cause**: Missing or malformed ID
**Solution**:
```typescript
// Validate UUID before query
if (!tenantId || !isValidUUID(tenantId)) {
  console.error('Invalid tenant ID');
  return;
}
```

#### 3. Arabic text not displaying
**Cause**: Font or direction issues
**Solution**:
- Check `dir="rtl"` on body element
- Verify Arabic fonts loaded
- Test in i18n.language === 'ar' mode

#### 4. Slot generation not working
**Cause**: Edge Function not deployed or failing
**Solution**:
- Check Edge Function logs in Supabase
- Verify employee has shifts assigned
- Test function manually in Supabase

#### 5. Authentication not working
**Cause**: JWT token expired or invalid
**Solution**:
```typescript
// Refresh session
const { data, error } = await supabase.auth.refreshSession();
if (error) {
  // Redirect to login
}
```

### Database Issues

#### Reset RLS Policies
```sql
-- Disable RLS temporarily (development only)
ALTER TABLE bookings DISABLE ROW LEVEL SECURITY;

-- Re-enable after testing
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
```

#### Check Table Permissions
```sql
-- View current policies
SELECT * FROM pg_policies WHERE tablename = 'bookings';
```

#### Manual Slot Generation
```sql
-- Generate slots for specific shift
SELECT generate_slots_for_shift('shift-uuid', 'employee-uuid', '2025-01-01', '2025-01-31');
```

---

## 🤝 Contributing

### Development Workflow

1. **Create Feature Branch**:
```bash
git checkout -b feature/new-feature-name
```

2. **Make Changes**:
- Follow existing code style
- Add TypeScript types
- Update translations (en.json, ar.json)
- Test in both languages

3. **Test Thoroughly**:
```bash
npm run typecheck
npm run lint
npm run build
```

4. **Commit**:
```bash
git add .
git commit -m "feat: add new feature description"
```

5. **Push and Create PR**:
```bash
git push origin feature/new-feature-name
```

### Commit Message Convention

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation update
- `style:` Code style changes
- `refactor:` Code refactoring
- `test:` Test additions
- `chore:` Maintenance tasks

### Code Style Guide

- Use TypeScript strict mode
- 2-space indentation
- Single quotes for strings
- Semicolons required
- Meaningful variable names
- Comment complex logic

---

## 📝 Additional Resources

### Documentation Links
- [React Documentation](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Supabase Documentation](https://supabase.com/docs)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [Vite Guide](https://vitejs.dev/guide/)

### Useful Commands

```bash
# Development
npm run dev              # Start dev server
npm run build            # Production build
npm run preview          # Preview production build
npm run typecheck        # Check TypeScript
npm run lint             # Lint code

# Supabase
supabase start           # Start local Supabase
supabase db reset        # Reset local database
supabase functions deploy # Deploy Edge Functions
supabase gen types typescript # Generate TypeScript types

# Debugging
npm run dev -- --debug   # Verbose dev logs
npm run build -- --mode development  # Development build
```

---

## 📄 License

This project is licensed under the MIT License.

---

## 📞 Support

For issues, questions, or contributions:
- Create an issue on GitHub
- Contact: support@bookati.com
- Documentation: https://docs.bookati.com

---

## 🎉 Acknowledgments

Built with:
- React Team for amazing UI library
- Supabase Team for incredible backend platform
- Tailwind CSS for utility-first styling
- Open source community for countless tools

---

**Last Updated**: November 24, 2025
**Version**: 1.0.0
**Status**: Production Ready ✅
