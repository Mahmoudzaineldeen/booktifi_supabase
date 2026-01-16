import pg from 'pg';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function updateIMGChildPrice() {
  const client = await pool.connect();
  
  try {
    console.log('Updating IMG Worlds of Adventure child_price to 60...\n');
    
    // First, ensure child_price column exists
    console.log('Checking if child_price column exists...');
    const columnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'services' AND column_name = 'child_price'
    `);
    
    if (columnCheck.rows.length === 0) {
      console.log('child_price column does not exist. Adding it...');
      await client.query(`
        ALTER TABLE services ADD COLUMN child_price numeric(10, 2);
      `);
      console.log('✅ Added child_price column\n');
    } else {
      console.log('✅ child_price column already exists\n');
    }
    
    // Now find the service
    const findResult = await client.query(`
      SELECT id, name, base_price, child_price
      FROM services
      WHERE name = $1 OR name_ar LIKE $2
    `, ['IMG Worlds of Adventure', '%IMG Worlds of Adventure%']);

    if (findResult.rows.length === 0) {
      console.log('❌ Service "IMG Worlds of Adventure" not found');
      return;
    }

    const service = findResult.rows[0];
    console.log(`Found service: ${service.name}`);
    console.log(`Current base_price: ${service.base_price} SAR`);
    console.log(`Current child_price: ${service.child_price || 'NULL'}\n`);

    // Update child_price to 60
    const updateResult = await client.query(`
      UPDATE services
      SET child_price = $1
      WHERE id = $2
      RETURNING id, name, base_price, child_price
    `, [60, service.id]);

    if (updateResult.rows.length > 0) {
      const updated = updateResult.rows[0];
      console.log('✅ Successfully updated!');
      console.log(`   Service: ${updated.name}`);
      console.log(`   Base price (Adult): ${updated.base_price} SAR`);
      console.log(`   Child price: ${updated.child_price} SAR\n`);
    } else {
      console.log('❌ Failed to update service');
    }
    
  } catch (error) {
    console.error('❌ Error updating child price:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

updateIMGChildPrice().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

