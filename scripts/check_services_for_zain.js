/**
 * Script to check all services for zain@gmail.com account
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function checkServicesForZain() {
  try {
    // Get tenant_id for zain@gmail.com
    const userResult = await pool.query(
      'SELECT id, tenant_id, email FROM users WHERE email = $1',
      ['zain@gmail.com']
    );

    if (userResult.rows.length === 0) {
      console.log('❌ User zain@gmail.com not found');
      return;
    }

    const tenantId = userResult.rows[0].tenant_id;
    console.log(`✅ Found tenant_id: ${tenantId} for zain@gmail.com\n`);

    // Get all services for this tenant
    const servicesResult = await pool.query(
      `SELECT id, name, name_ar, created_at, is_active
       FROM services 
       WHERE tenant_id = $1 
       ORDER BY LOWER(TRIM(name)), created_at`,
      [tenantId]
    );

    console.log(`📋 Total services: ${servicesResult.rows.length}\n`);

    if (servicesResult.rows.length === 0) {
      console.log('No services found for this tenant.');
      return;
    }

    // Group by normalized name to find duplicates
    const servicesByName = new Map();
    servicesResult.rows.forEach(service => {
      const normalizedName = service.name ? service.name.trim().toLowerCase() : '';
      if (!servicesByName.has(normalizedName)) {
        servicesByName.set(normalizedName, []);
      }
      servicesByName.get(normalizedName).push(service);
    });

    // Find duplicates
    const duplicates = [];
    servicesByName.forEach((services, normalizedName) => {
      if (services.length > 1) {
        duplicates.push({ name: normalizedName, services });
      }
    });

    if (duplicates.length > 0) {
      console.log(`⚠️  Found ${duplicates.length} duplicate service name(s):\n`);
      duplicates.forEach((dup, index) => {
        console.log(`${index + 1}. "${dup.services[0].name}" (${dup.services.length} copies):`);
        dup.services.forEach((svc, svcIndex) => {
          console.log(`   ${svcIndex + 1}. ID: ${svc.id}`);
          console.log(`      Created: ${new Date(svc.created_at).toLocaleString()}`);
          console.log(`      Active: ${svc.is_active}`);
          console.log('');
        });
      });

      // Show delete query
      console.log('\n🗑️  To delete duplicates (keeping the oldest), run this SQL:\n');
      console.log(`
WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, LOWER(TRIM(name)) 
      ORDER BY created_at ASC
    ) as row_num
  FROM services
  WHERE tenant_id = '${tenantId}'
)
DELETE FROM services
WHERE id IN (
  SELECT id FROM duplicates WHERE row_num > 1
)
AND tenant_id = '${tenantId}'
RETURNING id, name;
      `);
    } else {
      console.log('✅ No duplicate services found! All service names are unique.\n');
    }

    // Show all services
    console.log('\n📋 All services for this tenant:');
    servicesResult.rows.forEach((svc, index) => {
      console.log(`${index + 1}. ${svc.name}${svc.name_ar ? ` (${svc.name_ar})` : ''} - ID: ${svc.id} - Created: ${new Date(svc.created_at).toLocaleString()}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

checkServicesForZain().catch(console.error);



