# Package Testing Guide

## Testing Package Creation and Access Flow

### Prerequisites
- Service Provider Account: `zain1@gmail.com`
- Password: (use the correct password)
- At least 2 services created in the system

### Step 1: Login as Service Provider

1. Navigate to login page
2. Login with `zain1@gmail.com`
3. Navigate to Packages page: `/{tenantSlug}/admin/packages`

### Step 2: Check Existing Packages

1. Open browser Console (F12)
2. Check the console for:
   - "Fetching packages for tenant: [tenant_id]"
   - "Fetched packages: [count] [packages array]"
3. Verify packages are displayed in the list
4. Check each package has:
   - Name (English and Arabic)
   - Price
   - Services count
   - Active status

### Step 3: Create a New Package

1. Click "Add Package" button
2. Fill in the form:
   - **Package Name (English)**: Test Package 1
   - **Package Name (Arabic)**: حزمة تجريبية 1
   - **Description**: Test package description
   - **Description (Arabic)**: وصف الحزمة التجريبية
3. **Select Services**:
   - Click "Select Service" dropdown
   - Select at least 2 services
   - Verify "Total Price" is auto-calculated (read-only)
   - Verify "Original Price" shows the sum (read-only)
4. **Set Discount**:
   - Adjust "Final Price" to be less than "Original Price"
   - Verify "Discount Percentage" is auto-calculated
5. **Add Images** (optional):
   - Click "Choose Files"
   - Select one or more images
   - Verify images appear in preview
6. **Set Active Status**: Ensure "Active" is checked
7. Click "Save Package"
8. **Check Console** for:
   - "Creating new package with payload: {...}"
   - "Package created successfully: {...}"
   - "Inserting package services: [...]"
   - "Package services inserted successfully"
9. Verify package appears in the list

### Step 4: Edit an Existing Package

1. Find a package in the list
2. Click "Edit" button
3. **Check Console** for:
   - "Editing package: {...}"
   - "Package services: [...]"
   - "Calculated original price: [number]"
4. Verify form is populated with:
   - Package name (EN/AR)
   - Description (EN/AR)
   - Selected services
   - Prices
   - Images
5. Make a change (e.g., update name or price)
6. Click "Save Package"
7. **Check Console** for update confirmation
8. Verify changes are reflected in the list

### Step 5: Verify Package Data in Database

Open browser Console and run:
```javascript
// Check package was created with correct tenant_id
const { data } = await db
  .from('service_packages')
  .select('id, name, tenant_id, is_active')
  .order('created_at', { ascending: false })
  .limit(1);
console.log('Latest package:', data);

// Check package services
if (data && data[0]) {
  const { data: services } = await db
    .from('package_services')
    .select('service_id, quantity, services(name)')
    .eq('package_id', data[0].id);
  console.log('Package services:', services);
}
```

### Step 6: Access Package as User

1. **Get Tenant Slug**:
   - From service provider dashboard, note the URL: `/{tenantSlug}/admin/packages`
   - The `tenantSlug` is what you need

2. **Get Package ID**:
   - From console, get the package ID from the latest package query
   - Or from the package list, inspect the edit button to find the package ID

3. **Navigate to Package Schedule Page**:
   - URL format: `/{tenantSlug}/packages/{packageId}/schedule`
   - Example: `/tour/packages/abc-123-def-456/schedule`

4. **Verify Page Loads**:
   - Check Console for:
     - "Fetching data for package: {packageId, tenantSlug}"
     - "Fetching package: {packageId, tenantId: ...}"
     - "Package query result: {found: true, ...}"
   - Page should show:
     - Package name (formatted as "Combo (Save X%): Service1 + Service2")
     - Package description
     - Package price
     - List of services with schedule selection

### Step 7: Test Package Schedule Selection

1. For each service in the package:
   - Select a date from the calendar
   - Verify time slots appear
   - Select a time slot
   - Verify selection is confirmed (green checkmark)
2. Click "Continue" button
3. Verify navigation to checkout page
4. Verify checkout page shows package information

## Common Issues and Solutions

### Issue: "Package not found"
**Possible Causes:**
1. Package ID in URL is incorrect
2. Package belongs to different tenant
3. Package is inactive (`is_active = false`)
4. Package doesn't exist in database

**Debug Steps:**
1. Check Console for package query result
2. Verify package ID matches database
3. Check tenant_id matches current tenant
4. Verify `is_active = true` in database

### Issue: Package not appearing in list
**Possible Causes:**
1. Package created with wrong tenant_id
2. Fetch query has error
3. Package was deleted

**Debug Steps:**
1. Check Console for fetch error
2. Verify tenant_id in package matches user's tenant_id
3. Check database directly

### Issue: Services not loading in package
**Possible Causes:**
1. Package services not inserted
2. Services deleted or inactive
3. Query error

**Debug Steps:**
1. Check Console for package services query
2. Verify `package_services` table has entries
3. Check if services exist and are active

## Console Commands for Debugging

```javascript
// Get current user's tenant_id
const user = JSON.parse(localStorage.getItem('user_profile') || '{}');
console.log('User tenant_id:', user.tenant_id);

// List all packages for current tenant
const { data: packages } = await db
  .from('service_packages')
  .select('id, name, tenant_id, is_active, created_at')
  .eq('tenant_id', user.tenant_id)
  .order('created_at', { ascending: false });
console.table(packages);

// Check a specific package
const packageId = 'YOUR_PACKAGE_ID';
const { data: pkg } = await db
  .from('service_packages')
  .select('*')
  .eq('id', packageId)
  .single();
console.log('Package:', pkg);

// Check package services
const { data: pkgServices } = await db
  .from('package_services')
  .select('service_id, quantity, services(id, name, name_ar)')
  .eq('package_id', packageId);
console.log('Package services:', pkgServices);
```

## Expected Console Output

### When Creating Package:
```
Creating new package with payload: {
  tenant_id: "...",
  name: "Test Package 1",
  ...
}
Package created successfully: {id: "...", name: "Test Package 1", ...}
Inserting package services: [{package_id: "...", service_id: "...", quantity: 1}, ...]
Package services inserted successfully
```

### When Fetching Packages:
```
Fetching packages for tenant: [tenant_id]
Fetched packages: 5 [{...}, {...}, ...]
```

### When Accessing Package Schedule:
```
Fetching data for package: {packageId: "...", tenantSlug: "..."}
Fetching package: {packageId: "...", tenantId: "..."}
Package query result: {found: true, error: undefined, packageTenantId: "...", currentTenantId: "...", isActive: true}
```

## Testing Checklist

- [ ] Can login as service provider (zain1@gmail.com)
- [ ] Packages page loads and shows existing packages
- [ ] Can create new package with 2+ services
- [ ] Package appears in list after creation
- [ ] Can edit existing package
- [ ] Changes are saved correctly
- [ ] Package can be accessed via URL: `/{tenantSlug}/packages/{packageId}/schedule`
- [ ] Package schedule page loads correctly
- [ ] Services are listed with schedule selection
- [ ] Can select dates and times for all services
- [ ] Can proceed to checkout
- [ ] Checkout shows package information correctly



