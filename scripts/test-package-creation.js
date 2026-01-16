import dotenv from 'dotenv';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Use dynamic import for TypeScript file
const dbModule = await import('../server/src/db.ts');
const { query } = dbModule;

dotenv.config({ path: './server/.env' });

async function testPackageCreation() {
  try {
    console.log('Testing package creation...\n');

    // 1. Check service_packages table structure
    console.log('1. Checking service_packages table structure...');
    const columnsResult = await query(
      `SELECT column_name, data_type, is_nullable 
       FROM information_schema.columns 
       WHERE table_name = 'service_packages' 
       ORDER BY ordinal_position`
    );
    
    console.log('Columns in service_packages:');
    columnsResult.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });

    // 2. Get a tenant_id for testing
    console.log('\n2. Getting a tenant for testing...');
    const tenantResult = await query('SELECT id FROM tenants LIMIT 1');
    if (tenantResult.rows.length === 0) {
      console.error('No tenants found in database');
      return;
    }
    const tenantId = tenantResult.rows[0].id;
    console.log(`Using tenant_id: ${tenantId}`);

    // 3. Get some services for the package
    console.log('\n3. Getting services for the package...');
    const servicesResult = await query(
      'SELECT id, name, base_price FROM services WHERE tenant_id = $1 AND is_active = true LIMIT 3',
      [tenantId]
    );
    
    if (servicesResult.rows.length < 2) {
      console.error('Not enough services found (need at least 2)');
      return;
    }
    
    console.log(`Found ${servicesResult.rows.length} services:`);
    servicesResult.rows.forEach(s => {
      console.log(`  - ${s.name}: ${s.base_price} SAR`);
    });

    // 4. Calculate package prices
    const originalPrice = servicesResult.rows.reduce((sum, s) => sum + parseFloat(s.base_price), 0);
    const discountPercentage = 15;
    const totalPrice = originalPrice * (1 - discountPercentage / 100);

    console.log('\n4. Package pricing:');
    console.log(`  - Original price: ${originalPrice} SAR`);
    console.log(`  - Discount: ${discountPercentage}%`);
    console.log(`  - Total price: ${totalPrice.toFixed(2)} SAR`);

    // 5. Test package creation
    console.log('\n5. Testing package creation...');
    const packageData = {
      tenant_id: tenantId,
      name: 'Test Package',
      name_ar: 'حزمة تجريبية',
      description: 'Test package description',
      description_ar: 'وصف الحزمة التجريبية',
      total_price: totalPrice,
      original_price: originalPrice,
      discount_percentage: discountPercentage,
      image_url: null,
      gallery_urls: [],
      is_active: true
    };

    console.log('Package data:', JSON.stringify(packageData, null, 2));

    const insertResult = await query(
      `INSERT INTO service_packages (
        tenant_id, name, name_ar, description, description_ar,
        total_price, original_price, discount_percentage,
        image_url, gallery_urls, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
      RETURNING id, name, total_price, original_price, discount_percentage`,
      [
        packageData.tenant_id,
        packageData.name,
        packageData.name_ar,
        packageData.description,
        packageData.description_ar,
        packageData.total_price,
        packageData.original_price,
        packageData.discount_percentage,
        packageData.image_url,
        JSON.stringify(packageData.gallery_urls),
        packageData.is_active
      ]
    );

    const newPackage = insertResult.rows[0];
    console.log('✓ Package created successfully!');
    console.log(`  Package ID: ${newPackage.id}`);
    console.log(`  Name: ${newPackage.name}`);
    console.log(`  Total Price: ${newPackage.total_price} SAR`);
    console.log(`  Original Price: ${newPackage.original_price} SAR`);
    console.log(`  Discount: ${newPackage.discount_percentage}%`);

    // 6. Test package_services insertion
    console.log('\n6. Testing package_services insertion...');
    const packageServices = servicesResult.rows.map(s => ({
      package_id: newPackage.id,
      service_id: s.id,
      quantity: 1
    }));

    for (const ps of packageServices) {
      await query(
        `INSERT INTO package_services (package_id, service_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (package_id, service_id) DO NOTHING`,
        [ps.package_id, ps.service_id, ps.quantity]
      );
    }

    console.log(`✓ Added ${packageServices.length} services to package`);

    // 7. Clean up - delete test package
    console.log('\n7. Cleaning up test package...');
    await query('DELETE FROM package_services WHERE package_id = $1', [newPackage.id]);
    await query('DELETE FROM service_packages WHERE id = $1', [newPackage.id]);
    console.log('✓ Test package deleted');

    console.log('\n✅ All tests passed! Package creation works correctly.');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

testPackageCreation();


const require = createRequire(import.meta.url);

// Use dynamic import for TypeScript file
const dbModule = await import('../server/src/db.ts');
const { query } = dbModule;

dotenv.config({ path: './server/.env' });

async function testPackageCreation() {
  try {
    console.log('Testing package creation...\n');

    // 1. Check service_packages table structure
    console.log('1. Checking service_packages table structure...');
    const columnsResult = await query(
      `SELECT column_name, data_type, is_nullable 
       FROM information_schema.columns 
       WHERE table_name = 'service_packages' 
       ORDER BY ordinal_position`
    );
    
    console.log('Columns in service_packages:');
    columnsResult.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });

    // 2. Get a tenant_id for testing
    console.log('\n2. Getting a tenant for testing...');
    const tenantResult = await query('SELECT id FROM tenants LIMIT 1');
    if (tenantResult.rows.length === 0) {
      console.error('No tenants found in database');
      return;
    }
    const tenantId = tenantResult.rows[0].id;
    console.log(`Using tenant_id: ${tenantId}`);

    // 3. Get some services for the package
    console.log('\n3. Getting services for the package...');
    const servicesResult = await query(
      'SELECT id, name, base_price FROM services WHERE tenant_id = $1 AND is_active = true LIMIT 3',
      [tenantId]
    );
    
    if (servicesResult.rows.length < 2) {
      console.error('Not enough services found (need at least 2)');
      return;
    }
    
    console.log(`Found ${servicesResult.rows.length} services:`);
    servicesResult.rows.forEach(s => {
      console.log(`  - ${s.name}: ${s.base_price} SAR`);
    });

    // 4. Calculate package prices
    const originalPrice = servicesResult.rows.reduce((sum, s) => sum + parseFloat(s.base_price), 0);
    const discountPercentage = 15;
    const totalPrice = originalPrice * (1 - discountPercentage / 100);

    console.log('\n4. Package pricing:');
    console.log(`  - Original price: ${originalPrice} SAR`);
    console.log(`  - Discount: ${discountPercentage}%`);
    console.log(`  - Total price: ${totalPrice.toFixed(2)} SAR`);

    // 5. Test package creation
    console.log('\n5. Testing package creation...');
    const packageData = {
      tenant_id: tenantId,
      name: 'Test Package',
      name_ar: 'حزمة تجريبية',
      description: 'Test package description',
      description_ar: 'وصف الحزمة التجريبية',
      total_price: totalPrice,
      original_price: originalPrice,
      discount_percentage: discountPercentage,
      image_url: null,
      gallery_urls: [],
      is_active: true
    };

    console.log('Package data:', JSON.stringify(packageData, null, 2));

    const insertResult = await query(
      `INSERT INTO service_packages (
        tenant_id, name, name_ar, description, description_ar,
        total_price, original_price, discount_percentage,
        image_url, gallery_urls, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
      RETURNING id, name, total_price, original_price, discount_percentage`,
      [
        packageData.tenant_id,
        packageData.name,
        packageData.name_ar,
        packageData.description,
        packageData.description_ar,
        packageData.total_price,
        packageData.original_price,
        packageData.discount_percentage,
        packageData.image_url,
        JSON.stringify(packageData.gallery_urls),
        packageData.is_active
      ]
    );

    const newPackage = insertResult.rows[0];
    console.log('✓ Package created successfully!');
    console.log(`  Package ID: ${newPackage.id}`);
    console.log(`  Name: ${newPackage.name}`);
    console.log(`  Total Price: ${newPackage.total_price} SAR`);
    console.log(`  Original Price: ${newPackage.original_price} SAR`);
    console.log(`  Discount: ${newPackage.discount_percentage}%`);

    // 6. Test package_services insertion
    console.log('\n6. Testing package_services insertion...');
    const packageServices = servicesResult.rows.map(s => ({
      package_id: newPackage.id,
      service_id: s.id,
      quantity: 1
    }));

    for (const ps of packageServices) {
      await query(
        `INSERT INTO package_services (package_id, service_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (package_id, service_id) DO NOTHING`,
        [ps.package_id, ps.service_id, ps.quantity]
      );
    }

    console.log(`✓ Added ${packageServices.length} services to package`);

    // 7. Clean up - delete test package
    console.log('\n7. Cleaning up test package...');
    await query('DELETE FROM package_services WHERE package_id = $1', [newPackage.id]);
    await query('DELETE FROM service_packages WHERE id = $1', [newPackage.id]);
    console.log('✓ Test package deleted');

    console.log('\n✅ All tests passed! Package creation works correctly.');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

testPackageCreation();

