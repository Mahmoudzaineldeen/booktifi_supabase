import dotenv from 'dotenv';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load environment variables
dotenv.config({ path: './server/.env' });

// Import database connection
const { query } = await import('../server/src/db.ts');

async function testPackageFullFlow() {
  console.log('🧪 Testing Package Creation and Retrieval Flow\n');
  console.log('='.repeat(60));

  try {
    // Step 1: Get a tenant
    console.log('\n1️⃣ Getting a tenant...');
    const tenantResult = await query('SELECT id, name FROM tenants LIMIT 1');
    if (tenantResult.rows.length === 0) {
      console.error('❌ No tenants found');
      return;
    }
    const tenant = tenantResult.rows[0];
    console.log(`✅ Using tenant: ${tenant.name} (${tenant.id})`);

    // Step 2: Get services for the package
    console.log('\n2️⃣ Getting services...');
    const servicesResult = await query(
      `SELECT id, name, base_price 
       FROM services 
       WHERE tenant_id = $1 AND is_active = true 
       ORDER BY name 
       LIMIT 5`,
      [tenant.id]
    );

    if (servicesResult.rows.length < 2) {
      console.error('❌ Need at least 2 services, found:', servicesResult.rows.length);
      return;
    }

    const services = servicesResult.rows;
    console.log(`✅ Found ${services.length} services:`);
    services.forEach((s, i) => {
      console.log(`   ${i + 1}. ${s.name} - ${s.base_price} SAR`);
    });

    // Step 3: Calculate package prices
    console.log('\n3️⃣ Calculating package prices...');
    const originalPrice = services.reduce((sum, s) => sum + parseFloat(s.base_price), 0);
    const discountPercentage = 15;
    const totalPrice = originalPrice * (1 - discountPercentage / 100);

    console.log(`   Original Price: ${originalPrice.toFixed(2)} SAR`);
    console.log(`   Discount: ${discountPercentage}%`);
    console.log(`   Total Price: ${totalPrice.toFixed(2)} SAR`);

    // Step 4: Create package
    console.log('\n4️⃣ Creating package...');
    const packageData = {
      tenant_id: tenant.id,
      name: 'Test Package ' + Date.now(),
      name_ar: 'حزمة تجريبية ' + Date.now(),
      description: 'Test package description',
      description_ar: 'وصف الحزمة التجريبية',
      total_price: totalPrice,
      original_price: originalPrice,
      discount_percentage: discountPercentage,
      image_url: null,
      gallery_urls: [],
      is_active: true
    };

    const insertPackageResult = await query(
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

    const newPackage = insertPackageResult.rows[0];
    console.log(`✅ Package created: ${newPackage.name} (${newPackage.id})`);

    // Step 5: Insert package services (BULK INSERT)
    console.log('\n5️⃣ Inserting package services (BULK)...');
    const packageServices = services.map(s => ({
      package_id: newPackage.id,
      service_id: s.id,
      quantity: 1
    }));

    console.log(`   Preparing to insert ${packageServices.length} services:`);
    packageServices.forEach((ps, i) => {
      console.log(`   ${i + 1}. Service ID: ${ps.service_id}, Quantity: ${ps.quantity}`);
    });

    // Build bulk insert
    const values = packageServices.map((ps, idx) => {
      const base = idx * 3;
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    }).join(', ');

    const flatParams = packageServices.flatMap(ps => [
      ps.package_id,
      ps.service_id,
      ps.quantity
    ]);

    const bulkInsertSQL = `
      INSERT INTO package_services (package_id, service_id, quantity)
      VALUES ${values}
      ON CONFLICT (package_id, service_id) DO NOTHING
      RETURNING id, package_id, service_id, quantity
    `;

    console.log(`   Executing bulk insert for ${packageServices.length} records...`);
    const bulkInsertResult = await query(bulkInsertSQL, flatParams);
    
    console.log(`✅ Inserted ${bulkInsertResult.rows.length} package services`);
    if (bulkInsertResult.rows.length !== packageServices.length) {
      console.warn(`⚠️  Expected ${packageServices.length} but got ${bulkInsertResult.rows.length}`);
    }

    // Step 6: Verify all services were inserted
    console.log('\n6️⃣ Verifying inserted services...');
    const verifyResult = await query(
      `SELECT ps.id, ps.package_id, ps.service_id, ps.quantity,
              s.name, s.name_ar, s.base_price
       FROM package_services ps
       JOIN services s ON ps.service_id = s.id
       WHERE ps.package_id = $1
       ORDER BY s.name`,
      [newPackage.id]
    );

    console.log(`✅ Found ${verifyResult.rows.length} services in package:`);
    verifyResult.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.name} (${row.service_id}) - Quantity: ${row.quantity}`);
    });

    if (verifyResult.rows.length !== services.length) {
      console.error(`❌ MISMATCH: Expected ${services.length} services, found ${verifyResult.rows.length}`);
      console.error('   This indicates the bulk insert did not work correctly!');
    } else {
      console.log('✅ All services correctly inserted!');
    }

    // Step 7: Test query with nested relation (like frontend does)
    console.log('\n7️⃣ Testing query with nested relation (services)...');
    const nestedQueryResult = await query(
      `SELECT 
        ps.id,
        ps.package_id,
        ps.service_id,
        ps.quantity,
        s.id as service_id_full,
        s.name as service_name,
        s.name_ar as service_name_ar,
        s.base_price
       FROM package_services ps
       JOIN services s ON ps.service_id = s.id
       WHERE ps.package_id = $1
       ORDER BY s.name`,
      [newPackage.id]
    );

    console.log(`✅ Nested query returned ${nestedQueryResult.rows.length} results:`);
    nestedQueryResult.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.service_name} (${row.service_id})`);
    });

    // Step 8: Test fetching package with services (like PublicBookingPage does)
    console.log('\n8️⃣ Testing package fetch with services (PublicBookingPage style)...');
    const packageWithServicesResult = await query(
      `SELECT 
        sp.id,
        sp.name,
        sp.name_ar,
        sp.total_price,
        sp.original_price,
        sp.discount_percentage,
        json_agg(
          json_build_object(
            'service_id', ps.service_id,
            'quantity', ps.quantity,
            'service_name', s.name,
            'service_name_ar', s.name_ar
          )
        ) as services
       FROM service_packages sp
       LEFT JOIN package_services ps ON sp.id = ps.package_id
       LEFT JOIN services s ON ps.service_id = s.id
       WHERE sp.id = $1
       GROUP BY sp.id, sp.name, sp.name_ar, sp.total_price, sp.original_price, sp.discount_percentage`,
      [newPackage.id]
    );

    if (packageWithServicesResult.rows.length > 0) {
      const pkg = packageWithServicesResult.rows[0];
      const servicesArray = pkg.services.filter(s => s.service_id !== null);
      console.log(`✅ Package fetched with ${servicesArray.length} services:`);
      servicesArray.forEach((s, i) => {
        console.log(`   ${i + 1}. ${s.service_name} (${s.service_id})`);
      });

      if (servicesArray.length !== services.length) {
        console.error(`❌ MISMATCH: Expected ${services.length} services, found ${servicesArray.length}`);
      }
    }

    // Step 9: Cleanup
    console.log('\n9️⃣ Cleaning up test data...');
    await query('DELETE FROM package_services WHERE package_id = $1', [newPackage.id]);
    await query('DELETE FROM service_packages WHERE id = $1', [newPackage.id]);
    console.log('✅ Test package deleted');

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Package created: ${newPackage.name}`);
    console.log(`✅ Services inserted: ${verifyResult.rows.length}/${services.length}`);
    console.log(`✅ Nested query works: ${nestedQueryResult.rows.length === services.length ? 'YES' : 'NO'}`);
    console.log(`✅ Package fetch works: ${packageWithServicesResult.rows.length > 0 ? 'YES' : 'NO'}`);
    
    if (verifyResult.rows.length === services.length && 
        nestedQueryResult.rows.length === services.length) {
      console.log('\n✅ ALL TESTS PASSED!');
    } else {
      console.log('\n❌ SOME TESTS FAILED!');
      console.log('   Check the output above for details.');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error('Stack:', error.stack);
  }
}

testPackageFullFlow();

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load environment variables
dotenv.config({ path: './server/.env' });

// Import database connection
const { query } = await import('../server/src/db.ts');

async function testPackageFullFlow() {
  console.log('🧪 Testing Package Creation and Retrieval Flow\n');
  console.log('='.repeat(60));

  try {
    // Step 1: Get a tenant
    console.log('\n1️⃣ Getting a tenant...');
    const tenantResult = await query('SELECT id, name FROM tenants LIMIT 1');
    if (tenantResult.rows.length === 0) {
      console.error('❌ No tenants found');
      return;
    }
    const tenant = tenantResult.rows[0];
    console.log(`✅ Using tenant: ${tenant.name} (${tenant.id})`);

    // Step 2: Get services for the package
    console.log('\n2️⃣ Getting services...');
    const servicesResult = await query(
      `SELECT id, name, base_price 
       FROM services 
       WHERE tenant_id = $1 AND is_active = true 
       ORDER BY name 
       LIMIT 5`,
      [tenant.id]
    );

    if (servicesResult.rows.length < 2) {
      console.error('❌ Need at least 2 services, found:', servicesResult.rows.length);
      return;
    }

    const services = servicesResult.rows;
    console.log(`✅ Found ${services.length} services:`);
    services.forEach((s, i) => {
      console.log(`   ${i + 1}. ${s.name} - ${s.base_price} SAR`);
    });

    // Step 3: Calculate package prices
    console.log('\n3️⃣ Calculating package prices...');
    const originalPrice = services.reduce((sum, s) => sum + parseFloat(s.base_price), 0);
    const discountPercentage = 15;
    const totalPrice = originalPrice * (1 - discountPercentage / 100);

    console.log(`   Original Price: ${originalPrice.toFixed(2)} SAR`);
    console.log(`   Discount: ${discountPercentage}%`);
    console.log(`   Total Price: ${totalPrice.toFixed(2)} SAR`);

    // Step 4: Create package
    console.log('\n4️⃣ Creating package...');
    const packageData = {
      tenant_id: tenant.id,
      name: 'Test Package ' + Date.now(),
      name_ar: 'حزمة تجريبية ' + Date.now(),
      description: 'Test package description',
      description_ar: 'وصف الحزمة التجريبية',
      total_price: totalPrice,
      original_price: originalPrice,
      discount_percentage: discountPercentage,
      image_url: null,
      gallery_urls: [],
      is_active: true
    };

    const insertPackageResult = await query(
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

    const newPackage = insertPackageResult.rows[0];
    console.log(`✅ Package created: ${newPackage.name} (${newPackage.id})`);

    // Step 5: Insert package services (BULK INSERT)
    console.log('\n5️⃣ Inserting package services (BULK)...');
    const packageServices = services.map(s => ({
      package_id: newPackage.id,
      service_id: s.id,
      quantity: 1
    }));

    console.log(`   Preparing to insert ${packageServices.length} services:`);
    packageServices.forEach((ps, i) => {
      console.log(`   ${i + 1}. Service ID: ${ps.service_id}, Quantity: ${ps.quantity}`);
    });

    // Build bulk insert
    const values = packageServices.map((ps, idx) => {
      const base = idx * 3;
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    }).join(', ');

    const flatParams = packageServices.flatMap(ps => [
      ps.package_id,
      ps.service_id,
      ps.quantity
    ]);

    const bulkInsertSQL = `
      INSERT INTO package_services (package_id, service_id, quantity)
      VALUES ${values}
      ON CONFLICT (package_id, service_id) DO NOTHING
      RETURNING id, package_id, service_id, quantity
    `;

    console.log(`   Executing bulk insert for ${packageServices.length} records...`);
    const bulkInsertResult = await query(bulkInsertSQL, flatParams);
    
    console.log(`✅ Inserted ${bulkInsertResult.rows.length} package services`);
    if (bulkInsertResult.rows.length !== packageServices.length) {
      console.warn(`⚠️  Expected ${packageServices.length} but got ${bulkInsertResult.rows.length}`);
    }

    // Step 6: Verify all services were inserted
    console.log('\n6️⃣ Verifying inserted services...');
    const verifyResult = await query(
      `SELECT ps.id, ps.package_id, ps.service_id, ps.quantity,
              s.name, s.name_ar, s.base_price
       FROM package_services ps
       JOIN services s ON ps.service_id = s.id
       WHERE ps.package_id = $1
       ORDER BY s.name`,
      [newPackage.id]
    );

    console.log(`✅ Found ${verifyResult.rows.length} services in package:`);
    verifyResult.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.name} (${row.service_id}) - Quantity: ${row.quantity}`);
    });

    if (verifyResult.rows.length !== services.length) {
      console.error(`❌ MISMATCH: Expected ${services.length} services, found ${verifyResult.rows.length}`);
      console.error('   This indicates the bulk insert did not work correctly!');
    } else {
      console.log('✅ All services correctly inserted!');
    }

    // Step 7: Test query with nested relation (like frontend does)
    console.log('\n7️⃣ Testing query with nested relation (services)...');
    const nestedQueryResult = await query(
      `SELECT 
        ps.id,
        ps.package_id,
        ps.service_id,
        ps.quantity,
        s.id as service_id_full,
        s.name as service_name,
        s.name_ar as service_name_ar,
        s.base_price
       FROM package_services ps
       JOIN services s ON ps.service_id = s.id
       WHERE ps.package_id = $1
       ORDER BY s.name`,
      [newPackage.id]
    );

    console.log(`✅ Nested query returned ${nestedQueryResult.rows.length} results:`);
    nestedQueryResult.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.service_name} (${row.service_id})`);
    });

    // Step 8: Test fetching package with services (like PublicBookingPage does)
    console.log('\n8️⃣ Testing package fetch with services (PublicBookingPage style)...');
    const packageWithServicesResult = await query(
      `SELECT 
        sp.id,
        sp.name,
        sp.name_ar,
        sp.total_price,
        sp.original_price,
        sp.discount_percentage,
        json_agg(
          json_build_object(
            'service_id', ps.service_id,
            'quantity', ps.quantity,
            'service_name', s.name,
            'service_name_ar', s.name_ar
          )
        ) as services
       FROM service_packages sp
       LEFT JOIN package_services ps ON sp.id = ps.package_id
       LEFT JOIN services s ON ps.service_id = s.id
       WHERE sp.id = $1
       GROUP BY sp.id, sp.name, sp.name_ar, sp.total_price, sp.original_price, sp.discount_percentage`,
      [newPackage.id]
    );

    if (packageWithServicesResult.rows.length > 0) {
      const pkg = packageWithServicesResult.rows[0];
      const servicesArray = pkg.services.filter(s => s.service_id !== null);
      console.log(`✅ Package fetched with ${servicesArray.length} services:`);
      servicesArray.forEach((s, i) => {
        console.log(`   ${i + 1}. ${s.service_name} (${s.service_id})`);
      });

      if (servicesArray.length !== services.length) {
        console.error(`❌ MISMATCH: Expected ${services.length} services, found ${servicesArray.length}`);
      }
    }

    // Step 9: Cleanup
    console.log('\n9️⃣ Cleaning up test data...');
    await query('DELETE FROM package_services WHERE package_id = $1', [newPackage.id]);
    await query('DELETE FROM service_packages WHERE id = $1', [newPackage.id]);
    console.log('✅ Test package deleted');

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Package created: ${newPackage.name}`);
    console.log(`✅ Services inserted: ${verifyResult.rows.length}/${services.length}`);
    console.log(`✅ Nested query works: ${nestedQueryResult.rows.length === services.length ? 'YES' : 'NO'}`);
    console.log(`✅ Package fetch works: ${packageWithServicesResult.rows.length > 0 ? 'YES' : 'NO'}`);
    
    if (verifyResult.rows.length === services.length && 
        nestedQueryResult.rows.length === services.length) {
      console.log('\n✅ ALL TESTS PASSED!');
    } else {
      console.log('\n❌ SOME TESTS FAILED!');
      console.log('   Check the output above for details.');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error('Stack:', error.stack);
  }
}

testPackageFullFlow();


