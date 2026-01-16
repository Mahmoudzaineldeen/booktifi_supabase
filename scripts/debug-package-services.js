import dotenv from 'dotenv';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

dotenv.config({ path: './server/.env' });

const { query } = await import('../server/src/db.ts');

async function debugPackageServices() {
  try {
    console.log('🔍 Debugging Package Services Issue\n');
    console.log('='.repeat(60));

    // 1. Find the "Test" package
    console.log('\n1️⃣ Finding "Test" package...');
    const packageResult = await query(
      `SELECT id, name, name_ar, total_price, original_price 
       FROM service_packages 
       WHERE name ILIKE '%Test%' OR name_ar ILIKE '%Test%'
       ORDER BY created_at DESC 
       LIMIT 1`
    );

    if (packageResult.rows.length === 0) {
      console.error('❌ No package named "Test" found');
      return;
    }

    const pkg = packageResult.rows[0];
    console.log(`✅ Found package: ${pkg.name} (${pkg.id})`);
    console.log(`   Total Price: ${pkg.total_price} SAR`);
    console.log(`   Original Price: ${pkg.original_price || 'N/A'} SAR`);

    // 2. Check package_services directly
    console.log('\n2️⃣ Checking package_services table directly...');
    const directResult = await query(
      `SELECT ps.id, ps.package_id, ps.service_id, ps.quantity,
              s.id as service_id_full, s.name, s.name_ar, s.base_price
       FROM package_services ps
       JOIN services s ON ps.service_id = s.id
       WHERE ps.package_id = $1
       ORDER BY s.name`,
      [pkg.id]
    );

    console.log(`✅ Found ${directResult.rows.length} services in package_services:`);
    directResult.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.name} (${row.service_id}) - Quantity: ${row.quantity}, Price: ${row.base_price} SAR`);
    });

    if (directResult.rows.length !== 2) {
      console.error(`❌ EXPECTED 2 SERVICES BUT FOUND ${directResult.rows.length}!`);
      console.error('   This indicates the bulk insert did not work correctly.');
    }

    // 3. Test the query endpoint format (like frontend uses)
    console.log('\n3️⃣ Testing query endpoint format...');
    const queryFormatResult = await query(
      `SELECT 
        ps.id,
        ps.package_id,
        ps.service_id,
        ps.quantity,
        s.id as services_rel_id,
        s.name as services_rel_name,
        s.name_ar as services_rel_name_ar
       FROM package_services ps
       LEFT JOIN services s ON ps.service_id = s.id
       WHERE ps.package_id = $1
       ORDER BY s.name`,
      [pkg.id]
    );

    console.log(`✅ Query format returned ${queryFormatResult.rows.length} rows:`);
    queryFormatResult.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. Service ID: ${row.service_id}, Name: ${row.services_rel_name || 'NULL'}`);
    });

    // 4. Check if there are duplicate service_ids
    console.log('\n4️⃣ Checking for duplicate service_ids...');
    const duplicateCheck = await query(
      `SELECT service_id, COUNT(*) as count
       FROM package_services
       WHERE package_id = $1
       GROUP BY service_id
       HAVING COUNT(*) > 1`,
      [pkg.id]
    );

    if (duplicateCheck.rows.length > 0) {
      console.warn(`⚠️  Found duplicate service_ids:`);
      duplicateCheck.rows.forEach(row => {
        console.warn(`   Service ${row.service_id} appears ${row.count} times`);
      });
    } else {
      console.log('✅ No duplicate service_ids found');
    }

    // 5. Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`Package: ${pkg.name}`);
    console.log(`Services in database: ${directResult.rows.length}`);
    console.log(`Expected: 2 (Sky View + VIP Lounge)`);
    
    if (directResult.rows.length === 2) {
      console.log('✅ Database has correct number of services');
      console.log('   Issue is likely in query endpoint or frontend display');
    } else {
      console.log('❌ Database is missing services!');
      console.log('   Issue is in the insert operation');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error('Stack:', error.stack);
  }
}

debugPackageServices();

    console.log(`Expected: 2 (Sky View + VIP Lounge)`);
    
    if (directResult.rows.length === 2) {
      console.log('✅ Database has correct number of services');
      console.log('   Issue is likely in query endpoint or frontend display');
    } else {
      console.log('❌ Database is missing services!');
      console.log('   Issue is in the insert operation');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error('Stack:', error.stack);
  }
}

debugPackageServices();
