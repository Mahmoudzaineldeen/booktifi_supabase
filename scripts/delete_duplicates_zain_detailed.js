/**
 * Detailed script to find and delete duplicate services for zain@gmail.com
 * Checks for exact matches and near-matches
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function deleteDuplicatesForZain() {
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

    // Find duplicates using multiple methods
    console.log('🔍 Checking for duplicates...\n');

    // Method 1: Exact match (case-insensitive, trimmed)
    const exactDuplicatesQuery = `
      WITH duplicates AS (
        SELECT 
          id,
          name,
          name_ar,
          created_at,
          ROW_NUMBER() OVER (
            PARTITION BY tenant_id, LOWER(TRIM(name)) 
            ORDER BY created_at ASC
          ) as row_num
        FROM services
        WHERE tenant_id = $1
      )
      SELECT id, name, name_ar, created_at
      FROM duplicates
      WHERE row_num > 1
      ORDER BY name, created_at;
    `;

    const exactResult = await pool.query(exactDuplicatesQuery, [tenantId]);
    const exactDuplicates = exactResult.rows;

    if (exactDuplicates.length === 0) {
      console.log('✅ No exact duplicate services found!\n');
      
      // Check for similar names (might have extra spaces or slight variations)
      const allServicesQuery = `
        SELECT id, name, name_ar, created_at
        FROM services
        WHERE tenant_id = $1
        ORDER BY LOWER(TRIM(name));
      `;
      
      const allServicesResult = await pool.query(allServicesQuery, [tenantId]);
      const allServices = allServicesResult.rows;
      
      console.log(`📋 Checking ${allServices.length} services for similar names...\n`);
      
      // Find similar names (normalize and compare)
      const similarGroups = [];
      const processed = new Set();
      
      for (let i = 0; i < allServices.length; i++) {
        if (processed.has(i)) continue;
        
        const service1 = allServices[i];
        const normalized1 = (service1.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const group = [service1];
        
        for (let j = i + 1; j < allServices.length; j++) {
          if (processed.has(j)) continue;
          
          const service2 = allServices[j];
          const normalized2 = (service2.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
          
          if (normalized1 === normalized2) {
            group.push(service2);
            processed.add(j);
          }
        }
        
        if (group.length > 1) {
          similarGroups.push(group);
        }
        processed.add(i);
      }
      
      if (similarGroups.length > 0) {
        console.log(`⚠️  Found ${similarGroups.length} groups of similar service names:\n`);
        similarGroups.forEach((group, index) => {
          console.log(`${index + 1}. Similar names (${group.length} services):`);
          group.forEach((svc, svcIndex) => {
            console.log(`   ${svcIndex + 1}. "${svc.name}" - ID: ${svc.id} - Created: ${new Date(svc.created_at).toLocaleString()}`);
          });
          console.log('');
        });
        
        // Delete duplicates (keep the oldest)
        console.log('🗑️  Deleting duplicate services (keeping the oldest)...\n');
        
        const deleteQuery = `
          WITH duplicates AS (
            SELECT 
              id,
              ROW_NUMBER() OVER (
                PARTITION BY tenant_id, LOWER(TRIM(REGEXP_REPLACE(name, '\\s+', ' ', 'g'))) 
                ORDER BY created_at ASC
              ) as row_num
            FROM services
            WHERE tenant_id = $1
          )
          DELETE FROM services
          WHERE id IN (
            SELECT id FROM duplicates WHERE row_num > 1
          )
          AND tenant_id = $1
          RETURNING id, name, name_ar;
        `;
        
        const deleteResult = await pool.query(deleteQuery, [tenantId]);
        
        if (deleteResult.rows.length > 0) {
          console.log(`✅ Deleted ${deleteResult.rows.length} duplicate services:\n`);
          deleteResult.rows.forEach((deleted, index) => {
            console.log(`   ${index + 1}. ${deleted.name}${deleted.name_ar ? ` (${deleted.name_ar})` : ''} (ID: ${deleted.id})`);
          });
        } else {
          console.log('⚠️  No services were deleted.');
        }
      } else {
        console.log('✅ No similar service names found. All services are unique.\n');
      }
      
    } else {
      console.log(`⚠️  Found ${exactDuplicates.length} exact duplicate services:\n`);
      exactDuplicates.forEach((dup, index) => {
        console.log(`${index + 1}. "${dup.name}" - ID: ${dup.id} - Created: ${new Date(dup.created_at).toLocaleString()}`);
      });
      
      console.log('\n🗑️  Deleting duplicate services (keeping the oldest)...\n');
      
      const deleteQuery = `
        WITH duplicates AS (
          SELECT 
            id,
            ROW_NUMBER() OVER (
              PARTITION BY tenant_id, LOWER(TRIM(name)) 
              ORDER BY created_at ASC
            ) as row_num
          FROM services
          WHERE tenant_id = $1
        )
        DELETE FROM services
        WHERE id IN (
          SELECT id FROM duplicates WHERE row_num > 1
        )
        AND tenant_id = $1
        RETURNING id, name, name_ar;
      `;
      
      const deleteResult = await pool.query(deleteQuery, [tenantId]);
      
      if (deleteResult.rows.length > 0) {
        console.log(`✅ Deleted ${deleteResult.rows.length} duplicate services:\n`);
        deleteResult.rows.forEach((deleted, index) => {
          console.log(`   ${index + 1}. ${deleted.name}${deleted.name_ar ? ` (${deleted.name_ar})` : ''} (ID: ${deleted.id})`);
        });
      }
    }

    // Show remaining services
    const remainingQuery = `
      SELECT id, name, name_ar, created_at
      FROM services
      WHERE tenant_id = $1
      ORDER BY LOWER(TRIM(name));
    `;
    const remainingResult = await pool.query(remainingQuery, [tenantId]);
    console.log(`\n📋 Remaining services (${remainingResult.rows.length}):`);
    remainingResult.rows.forEach((svc, index) => {
      console.log(`   ${index + 1}. ${svc.name}${svc.name_ar ? ` (${svc.name_ar})` : ''}`);
    });

    console.log('\n✨ Process completed!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

deleteDuplicatesForZain().catch(console.error);



