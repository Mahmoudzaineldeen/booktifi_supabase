// Script to update services with discounts
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function updateDiscounts() {
  const client = await pool.connect();
  
  try {
    console.log('Updating services with discounts...\n');
    
    // Services that should have discounts (based on the seed script)
    const servicesWithDiscounts = [
      { name: 'Burj Khalifa Observation Deck', basePrice: 150 },
      { name: 'At The Top Experience', basePrice: 180 },
      { name: 'Night Tour', basePrice: 190 },
      { name: 'Group Tour', basePrice: 120 }
    ];

    for (const service of servicesWithDiscounts) {
      const originalPrice = service.basePrice * 1.5;
      const discountPercentage = Math.round(((originalPrice - service.basePrice) / originalPrice) * 100);

      const result = await client.query(`
        UPDATE services
        SET original_price = $1,
            discount_percentage = $2
        WHERE name = $3
        RETURNING id, name, base_price, original_price, discount_percentage
      `, [originalPrice, discountPercentage, service.name]);

      if (result.rows.length > 0) {
        const s = result.rows[0];
        console.log(`✅ Updated: ${s.name}`);
        console.log(`   Original: ${s.original_price} SAR`);
        console.log(`   Current: ${s.base_price} SAR`);
        console.log(`   Discount: ${s.discount_percentage}%\n`);
      } else {
        console.log(`⚠️  Service not found: ${service.name}\n`);
      }
    }

    console.log('✅ All discounts updated!\n');
    
  } catch (error) {
    console.error('❌ Error updating discounts:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

updateDiscounts().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});





















