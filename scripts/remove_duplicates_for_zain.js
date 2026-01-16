/**
 * Script to remove duplicate services for zain@gmail.com account
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
    // First, get the user from auth.users (if accessible) or users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, tenant_id, email')
      .eq('email', email)
      .maybeSingle();

    if (userError) {
      console.error('Error fetching user:', userError);
      // Try direct SQL query
      const result = await pool.query(
        'SELECT id, tenant_id, email FROM users WHERE email = $1',
        [email]
      );
      if (result.rows.length > 0) {
        return result.rows[0].tenant_id;
      }
      throw new Error(`User not found: ${email}`);
    }

    if (!userData || !userData.tenant_id) {
      throw new Error(`User not found or has no tenant_id: ${email}`);
    }

    console.log(`✅ Found tenant_id: ${userData.tenant_id} for user: ${email}\n`);
    return userData.tenant_id;
  } catch (error) {
    console.error('Error getting tenant_id:', error);
    throw error;
  }
}

async function removeDuplicateServicesForTenant(tenantId) {
  console.log(`🔍 Finding duplicate services for tenant_id: ${tenantId}...\n`);

  try {
    // Find duplicate services grouped by name (case-insensitive, trimmed)
    const findQuery = `
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

    const findResult = await pool.query(findQuery, [tenantId]);
    const duplicates = findResult.rows;

    if (duplicates.length === 0) {
      console.log('✅ No duplicate services found for this tenant!');
      return;
    }

    console.log(`Found ${duplicates.length} duplicate services:\n`);
    duplicates.forEach((dup, index) => {
      console.log(`${index + 1}. ID: ${dup.id}`);
      console.log(`   Name: ${dup.name}`);
      console.log(`   Created: ${new Date(dup.created_at).toLocaleString()}`);
      console.log('');
    });

    console.log('🗑️  Deleting duplicate services (keeping the oldest one for each name)...\n');

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
      console.log('⚠️  No services were deleted. This might indicate an issue.');
    }

    console.log('\n✨ Duplicate removal completed!');

    // Show remaining services
    const remainingQuery = `
      SELECT id, name, name_ar, created_at
      FROM services
      WHERE tenant_id = $1
      ORDER BY name;
    `;
    const remainingResult = await pool.query(remainingQuery, [tenantId]);
    console.log(`\n📋 Remaining services (${remainingResult.rows.length}):`);
    remainingResult.rows.forEach((svc, index) => {
      console.log(`   ${index + 1}. ${svc.name}${svc.name_ar ? ` (${svc.name_ar})` : ''}`);
    });

  } catch (error) {
    console.error('❌ Error removing duplicates:', error);
    throw error;
  }
}

async function main() {
  const email = 'zain@gmail.com';
  
  try {
    const tenantId = await getTenantIdForUser(email);
    await removeDuplicateServicesForTenant(tenantId);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script
main().catch(console.error);



