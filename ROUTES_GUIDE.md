# Bookati Routes Guide

## Overview
This guide explains all routes in the Bookati booking system and how to access them.

## Route Structure

### Public Routes
- `/` - Home page
- `/signup` - Tenant registration
- `/login` - Login page (redirects based on user role)
- `/management` - Solution owner login

### Solution Owner Routes
- `/solution-admin` - Solution owner dashboard (manage all tenants)

### Tenant Admin Routes
Format: `/{company_slug}/admin/*`

- `/{company_slug}/admin` - Admin dashboard
- `/{company_slug}/admin/services` - Manage services
- `/{company_slug}/admin/bookings` - View and manage all bookings
- `/{company_slug}/admin/employees` - Manage employees and assign services
- `/{company_slug}/admin/landing` - Landing page builder (customize public booking page)
- `/{company_slug}/admin/settings` - Tenant settings

### Reception Routes
Format: `/{company_slug}/reception`

- `/{company_slug}/reception` - Reception desk interface
  - View today's bookings
  - View all bookings
  - Create new bookings for walk-in customers
  - Manage booking status (confirm, complete, cancel)

### Employee Routes
Format: `/{company_slug}/employee`

- `/{company_slug}/employee` - Employee interface
  - View today's assigned bookings
  - View upcoming bookings
  - View all assigned bookings
  - Mark bookings as completed

### Public Booking Routes
Format: `/{company_slug}/book`

- `/{company_slug}/book` - Public booking page for customers
  - Browse available services
  - Select date and time slot
  - Submit booking request
  - Customizable landing page with company branding

## User Roles

### 1. Solution Owner
- Access: `/solution-admin`
- Permissions: Manage all tenants, view system-wide analytics

### 2. Tenant Admin
- Access: `/{company_slug}/admin/*`
- Permissions: Full control over their tenant (services, bookings, employees, settings)
- Can customize landing page for public bookings

### 3. Receptionist
- Access: `/{company_slug}/reception`
- Permissions: Create bookings, view bookings, manage booking status
- Cannot modify services or employees

### 4. Employee
- Access: `/{company_slug}/employee`
- Permissions: View assigned bookings only, mark as completed
- Cannot create bookings or modify services

### 5. Customer (Public)
- Access: `/{company_slug}/book`
- Permissions: Browse services, submit booking requests
- No login required

## Login Flow

When users log in at `/login`, they are automatically redirected based on their role:

1. **Tenant Admin** → `/{company_slug}/admin`
2. **Receptionist** → `/{company_slug}/reception`
3. **Employee** → `/{company_slug}/employee`
4. **Solution Owner** → Use `/management` login instead

## Example Routes

If your company slug is "abc-services":

- Admin Dashboard: `/abc-services/admin`
- Reception Desk: `/abc-services/reception`
- Employee View: `/abc-services/employee`
- Public Booking: `/abc-services/book`
- Landing Page Builder: `/abc-services/admin/landing`

## Key Features by Route

### Landing Page Builder (`/admin/landing`)
Customize your public booking page:
- Hero section with title, subtitle, and image
- About section
- Primary and secondary colors
- Contact information (email, phone)
- Social media links
- Toggle sections on/off

### Public Booking Page (`/book`)
Customer-facing features:
- Responsive design with company branding
- Browse available services
- Calendar view for date selection
- Real-time slot availability
- Easy booking form
- Booking confirmation
- Multi-language support (English/Arabic)

### Reception Page (`/reception`)
Reception desk features:
- Today's bookings view
- All bookings view
- Quick booking creation
- Status management
- Customer contact display

### Employee Page (`/employee`)
Employee features:
- Today's assignments
- Upcoming bookings
- Customer contact information
- Complete booking action
- Clean, focused interface
