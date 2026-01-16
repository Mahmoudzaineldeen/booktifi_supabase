/**
 * Script to remove duplicate services for a specific user
 * Keeps the first service and deletes duplicates based on name and tenant_id
 */

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
const { Pool } = pg;

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const supabase = createClient(supabaseUrl, supabaseKey);

// Database connection for running SQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function getTenantIdForUser(email) {
  console.log(`🔍 Finding tenant_id for user: ${email}...\n`);

  try {
    // Get user and tenant_id directly from database
    const query = `
      SELECT id, tenant_id, email
      FROM users
      WHERE email = $1
      LIMIT 1;
    `;

    const result = await pool.query(query, [email]);
    
    if (result.rows.length === 0) {
      console.error(`❌ User not found: ${email}`);
      return null;
    }

    const userData = result.rows[0];

    if (!userData.tenant_id) {
      console.error(`❌ User ${email} has no tenant_id`);
      return null;
    }

    console.log(`✅ Found user: ${email}`);
    console.log(`   User ID: ${userData.id}`);
    console.log(`   Tenant ID: ${userData.tenant_id}\n`);

    return userData.tenant_id;
  } catch (error) {
    console.error('Error getting tenant_id:', error);
    throw error;
  }
}

async function removeDuplicateServicesForTenant(tenantId) {
  console.log(`🔍 Finding duplicate services for tenant_id: ${tenantId}...\n`);

  try {
    // Find duplicate services grouped by tenant_id and name
    const query = `
      WITH duplicates AS (
        SELECT 
          id,
          tenant_id,
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
      SELECT id, tenant_id, name, name_ar, created_at
      FROM duplicates
      WHERE row_num > 1
      ORDER BY name, created_at;
    `;

    const result = await pool.query(query, [tenantId]);
    const duplicates = result.rows;

    if (duplicates.length === 0) {
      console.log('✅ No duplicate services found for this tenant!');
      return;
    }

    console.log(`Found ${duplicates.length} duplicate services:\n`);
    duplicates.forEach((dup, index) => {
      console.log(`${index + 1}. ID: ${dup.id}`);
      console.log(`   Name: ${dup.name}`);
      console.log(`   Name (AR): ${dup.name_ar || 'N/A'}`);
      console.log(`   Created: ${dup.created_at}`);
      console.log('');
    });

    console.log('🗑️  Deleting duplicate services...\n');

    // Delete duplicates (keep the first one based on created_at)
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
      RETURNING id, name, name_ar;
    `;

    const deleteResult = await pool.query(deleteQuery, [tenantId]);
    console.log(`✅ Deleted ${deleteResult.rows.length} duplicate services:`);
    deleteResult.rows.forEach((deleted, index) => {
      console.log(`   ${index + 1}. ${deleted.name}${deleted.name_ar ? ` (${deleted.name_ar})` : ''} (ID: ${deleted.id})`);
    });

    console.log('\n✨ Duplicate removal completed!');

  } catch (error) {
    console.error('❌ Error removing duplicates:', error);
    throw error;
  }
}

async function main() {
  const userEmail = process.argv[2] || 'zain@gmail.com';
  
  console.log('🚀 Starting duplicate service removal...\n');
  console.log(`Target user: ${userEmail}\n`);

  try {
    // Get tenant_id for the user
    const tenantId = await getTenantIdForUser(userEmail);
    
    if (!tenantId) {
      console.error('❌ Could not find tenant_id. Exiting.');
      process.exit(1);
    }

    // Remove duplicate services for this tenant
    await removeDuplicateServicesForTenant(tenantId);

  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script
main().catch(console.error);

