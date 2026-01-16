/**
 * Script to remove duplicate services
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

async function removeDuplicateServices() {
  console.log('🔍 Finding duplicate services...\n');

  try {
    // Find duplicate services grouped by tenant_id and name
    const query = `
      WITH duplicates AS (
        SELECT 
          id,
          tenant_id,
          name,
          name_ar,
          ROW_NUMBER() OVER (
            PARTITION BY tenant_id, LOWER(TRIM(name)) 
            ORDER BY created_at ASC
          ) as row_num
        FROM services
      )
      SELECT id, tenant_id, name, name_ar
      FROM duplicates
      WHERE row_num > 1
      ORDER BY tenant_id, name;
    `;

    const result = await pool.query(query);
    const duplicates = result.rows;

    if (duplicates.length === 0) {
      console.log('✅ No duplicate services found!');
      return;
    }

    console.log(`Found ${duplicates.length} duplicate services:\n`);
    duplicates.forEach((dup, index) => {
      console.log(`${index + 1}. ID: ${dup.id}, Tenant: ${dup.tenant_id}, Name: ${dup.name}`);
    });

    console.log('\n🗑️  Deleting duplicate services...\n');

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
      )
      DELETE FROM services
      WHERE id IN (
        SELECT id FROM duplicates WHERE row_num > 1
      )
      RETURNING id, name;
    `;

    const deleteResult = await pool.query(deleteQuery);
    console.log(`✅ Deleted ${deleteResult.rows.length} duplicate services:`);
    deleteResult.rows.forEach((deleted, index) => {
      console.log(`   ${index + 1}. ${deleted.name} (ID: ${deleted.id})`);
    });

    console.log('\n✨ Duplicate removal completed!');

  } catch (error) {
    console.error('❌ Error removing duplicates:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the script
removeDuplicateServices().catch(console.error);



