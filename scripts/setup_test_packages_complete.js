/**
 * Complete setup script for test packages
 * - Runs migration to create services and packages
 * - Adds random images to services
 * - Creates schedules for services
 * - Verifies everything works
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase client
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const supabase = createClient(supabaseUrl, supabaseKey);

// Database connection for running SQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

// Get all image files from assets folder
function getRandomImages(count) {
  const assetsPath = path.join(__dirname, '../../assets');
  if (!fs.existsSync(assetsPath)) {
    console.warn('Assets folder not found, skipping images');
    return [];
  }

  const imageFiles = fs.readdirSync(assetsPath)
    .filter(file => /\.(jpg|jpeg|png)$/i.test(file))
    .map(file => path.join(assetsPath, file));

  // Shuffle and return random images
  const shuffled = imageFiles.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

// Convert image to base64
function imageToBase64(imagePath) {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    const base64 = imageBuffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error(`Error reading image ${imagePath}:`, error);
    return null;
  }
}

async function runDiscountMigration() {
  const client = await pool.connect();
  try {
    console.log('📦 Running discount fields migration...\n');
    
    const migrationPath = path.join(__dirname, '../supabase/migrations/20251201000000_add_package_discount_fields.sql');
    if (fs.existsSync(migrationPath)) {
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      await client.query(migrationSQL);
      console.log('✅ Discount fields migration completed\n');
    } else {
      console.log('⚠️  Discount migration file not found, trying to add columns directly...\n');
      // Try to add columns directly
      try {
        await client.query(`
          ALTER TABLE service_packages
            ADD COLUMN IF NOT EXISTS original_price numeric(10, 2) CHECK (original_price >= 0),
            ADD COLUMN IF NOT EXISTS discount_percentage integer CHECK (discount_percentage >= 0 AND discount_percentage <= 100);
        `);
        console.log('✅ Discount fields added\n');
      } catch (err) {
        console.log('⚠️  Columns may already exist\n');
      }
    }
    return true;
  } catch (error) {
    console.error('❌ Discount migration failed:', error.message);
    // Continue anyway - columns might already exist
    return true;
  } finally {
    client.release();
  }
}

async function runImageMigration() {
  const client = await pool.connect();
  try {
    console.log('📦 Running image fields migration...\n');
    
    const migrationPath = path.join(__dirname, '../supabase/migrations/20251201000001_add_package_images.sql');
    if (fs.existsSync(migrationPath)) {
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      await client.query(migrationSQL);
      console.log('✅ Image fields migration completed\n');
    } else {
      console.log('⚠️  Image migration file not found, trying to add columns directly...\n');
      try {
        await client.query(`
          ALTER TABLE service_packages
            ADD COLUMN IF NOT EXISTS image_url text,
            ADD COLUMN IF NOT EXISTS gallery_urls jsonb DEFAULT '[]'::jsonb;
        `);
        console.log('✅ Image fields added\n');
      } catch (err) {
        console.log('⚠️  Columns may already exist\n');
      }
    }
    return true;
  } catch (error) {
    console.error('❌ Image migration failed:', error.message);
    return true; // Continue anyway
  } finally {
    client.release();
  }
}

async function runMigration(tenantId) {
  const client = await pool.connect();
  try {
    console.log('📦 Creating test services and packages...\n');
    
    await client.query('BEGIN');

    // Service names
    const serviceNames = [
      'Burj Khalifa Observation Deck',
      'Dubai Aquarium & Underwater Zoo',
      'Desert Safari Adventure',
      'Dubai Marina Cruise',
      'Dubai Frame Experience',
      'IMG Worlds of Adventure',
      'Dubai Museum & Al Fahidi Fort',
      'Dubai Garden Glow',
      'Dubai Miracle Garden',
      'Dubai Gold Souk Tour'
    ];

    const serviceData = [
      { name: serviceNames[0], name_ar: 'سطح المراقبة في برج خليفة', price: 150, duration: 60, capacity: 20 },
      { name: serviceNames[1], name_ar: 'دبي أكواريوم وحديقة الحيوانات المائية', price: 120, duration: 90, capacity: 30 },
      { name: serviceNames[2], name_ar: 'مغامرة رحلة الصحراء', price: 200, duration: 240, capacity: 15 },
      { name: serviceNames[3], name_ar: 'رحلة بحرية في مارينا دبي', price: 80, duration: 90, capacity: 40 },
      { name: serviceNames[4], name_ar: 'تجربة إطار دبي', price: 60, duration: 60, capacity: 25 },
      { name: serviceNames[5], name_ar: 'عوالم إم جي للمغامرات', price: 250, duration: 360, capacity: 50 },
      { name: serviceNames[6], name_ar: 'متحف دبي وقلعة الفهيدي', price: 30, duration: 90, capacity: 35 },
      { name: serviceNames[7], name_ar: 'حديقة دبي المضيئة', price: 70, duration: 120, capacity: 40 },
      { name: serviceNames[8], name_ar: 'حديقة دبي المعجزة', price: 55, duration: 120, capacity: 45 },
      { name: serviceNames[9], name_ar: 'جولة سوق الذهب في دبي', price: 40, duration: 60, capacity: 20 }
    ];

    const serviceIds = [];

    // Create or get services
    for (const service of serviceData) {
      const result = await client.query(
        `INSERT INTO services (
          tenant_id, name, name_ar, description, description_ar,
          base_price, duration_minutes, capacity_per_slot, service_capacity_per_slot,
          service_duration_minutes, capacity_mode, is_public, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT DO NOTHING
        RETURNING id`,
        [
          tenantId, service.name, service.name_ar, 
          `Description for ${service.name}`, `وصف ${service.name_ar}`,
          service.price, service.duration, service.capacity, service.capacity,
          service.duration, 'service_based', true, true
        ]
      );

      if (result.rows.length > 0) {
        serviceIds.push(result.rows[0].id);
        console.log(`✓ Created service: ${service.name}`);
      } else {
        // Service already exists, get its ID
        const existing = await client.query(
          `SELECT id FROM services WHERE tenant_id = $1 AND name = $2`,
          [tenantId, service.name]
        );
        if (existing.rows.length > 0) {
          serviceIds.push(existing.rows[0].id);
          console.log(`✓ Service exists: ${service.name}`);
        }
      }
    }

    if (serviceIds.length < 10) {
      throw new Error(`Only created ${serviceIds.length} services, expected 10`);
    }

    // Create packages
    const packages = [
      {
        name: 'Dubai Essentials Package',
        name_ar: 'باقة أساسيات دبي',
        serviceIndices: [0, 1, 3],
        discount: 15
      },
      {
        name: 'Dubai Adventure Combo',
        name_ar: 'باقة مغامرات دبي',
        serviceIndices: [2, 5, 7],
        discount: 20
      },
      {
        name: 'Dubai Culture & Heritage',
        name_ar: 'باقة الثقافة والتراث في دبي',
        serviceIndices: [6, 9, 4],
        discount: 10
      },
      {
        name: 'Dubai Family Fun Package',
        name_ar: 'باقة المرح العائلي في دبي',
        serviceIndices: [1, 5, 8],
        discount: 18
      },
      {
        name: 'Dubai Premium Experience',
        name_ar: 'باقة التجربة المميزة في دبي',
        serviceIndices: [0, 2, 3, 5],
        discount: 25
      }
    ];

    for (const pkg of packages) {
      const selectedServiceIds = pkg.serviceIndices.map(idx => serviceIds[idx]).filter(Boolean);
      if (selectedServiceIds.length < 2) continue;

      // Calculate prices
      const priceResult = await client.query(
        `SELECT SUM(base_price) as total FROM services WHERE id = ANY($1)`,
        [selectedServiceIds]
      );
      const originalPrice = parseFloat(priceResult.rows[0].total);
      const totalPrice = originalPrice * (1 - pkg.discount / 100);

      // Create package
      const pkgResult = await client.query(
        `INSERT INTO service_packages (
          tenant_id, name, name_ar, description, description_ar,
          total_price, original_price, discount_percentage, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT DO NOTHING
        RETURNING id`,
        [
          tenantId, pkg.name, pkg.name_ar,
          `Description for ${pkg.name}`, `وصف ${pkg.name_ar}`,
          totalPrice, originalPrice, pkg.discount, true
        ]
      );

      if (pkgResult.rows.length > 0) {
        const packageId = pkgResult.rows[0].id;
        
        // Delete existing package services
        await client.query(`DELETE FROM package_services WHERE package_id = $1`, [packageId]);
        
        // Insert package services
        for (const serviceId of selectedServiceIds) {
          await client.query(
            `INSERT INTO package_services (package_id, service_id, quantity)
             VALUES ($1, $2, 1)`,
            [packageId, serviceId]
          );
        }
        console.log(`✓ Created package: ${pkg.name}`);
      } else {
        console.log(`✓ Package exists: ${pkg.name}`);
      }
    }

    await client.query('COMMIT');
    console.log('\n✅ Migration completed successfully!\n');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    return false;
  } finally {
    client.release();
  }
}

async function addImagesToServices(tenantId) {
  console.log('🖼️  Adding random images to services...\n');
  
  const client = await pool.connect();
  try {
    // Get all services for this tenant
    const result = await client.query(
      `SELECT id, name FROM services WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [tenantId]
    );

    if (result.rows.length === 0) {
      console.warn('No services found to add images to');
      return;
    }

    // Get random images
    const imagePaths = getRandomImages(result.rows.length);
    
    if (imagePaths.length === 0) {
      console.warn('No images found in assets folder');
      return;
    }

    // Add images to services
    for (let i = 0; i < result.rows.length; i++) {
      const service = result.rows[i];
      const imagePath = imagePaths[i % imagePaths.length];
      const base64Image = imageToBase64(imagePath);

      if (base64Image) {
        // Use multiple images for gallery
        const galleryUrls = [base64Image];
        // Add 2-3 more random images for gallery
        for (let j = 0; j < 2 && (i + j + 1) < imagePaths.length; j++) {
          const additionalImage = imageToBase64(imagePaths[(i + j + 1) % imagePaths.length]);
          if (additionalImage) galleryUrls.push(additionalImage);
        }

        await client.query(
          `UPDATE services 
           SET image_url = $1, gallery_urls = $2::jsonb
           WHERE id = $3`,
          [base64Image, JSON.stringify(galleryUrls), service.id]
        );

        console.log(`✓ Added images to: ${service.name}`);
      }
    }

    console.log('\n✅ Images added to services!\n');
  } catch (error) {
    console.error('Error adding images:', error);
  } finally {
    client.release();
  }
}

async function createSchedulesForServices(tenantId) {
  console.log('📅 Creating schedules for services...\n');
  
  const client = await pool.connect();
  try {
    // Get all services from database
    const servicesResult = await client.query(
      `SELECT id, name FROM services 
       WHERE tenant_id = $1 
       ORDER BY created_at DESC 
       LIMIT 10`,
      [tenantId]
    );

    if (servicesResult.rows.length === 0) {
      console.warn('No services found');
      return;
    }

    await client.query('BEGIN');

    for (const service of servicesResult.rows) {
      // Create a shift for each day of the week (0-6, Sunday-Saturday)
      // Most services available Monday-Friday (1-5)
      const daysOfWeek = [1, 2, 3, 4, 5]; // Monday to Friday
      const startTime = '09:00:00';
      const endTime = '18:00:00';

      // Check if shift already exists
      const checkResult = await client.query(
        `SELECT id FROM shifts WHERE service_id = $1 AND is_active = true LIMIT 1`,
        [service.id]
      );

      if (checkResult.rows.length > 0) {
        console.log(`✓ Schedule already exists for: ${service.name}`);
        continue;
      }

      // Get tenant_id from service
      const serviceResult = await client.query(
        `SELECT tenant_id FROM services WHERE id = $1`,
        [service.id]
      );
      const serviceTenantId = serviceResult.rows[0]?.tenant_id || tenantId;

      // Create shift
      const shiftResult = await client.query(
        `INSERT INTO shifts (tenant_id, service_id, days_of_week, start_time_utc, end_time_utc, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id`,
        [serviceTenantId, service.id, daysOfWeek, startTime, endTime]
      );

      if (shiftResult.rows.length > 0) {
        console.log(`✓ Created schedule for: ${service.name}`);
      }
    }

    await client.query('COMMIT');
    console.log('\n✅ Schedules created for all services!\n');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error creating schedules:', error);
  } finally {
    client.release();
  }
}

async function verifySetup(tenantId) {
  console.log('🔍 Verifying setup...\n');

  const client = await pool.connect();
  try {
    // Check services
    const servicesResult = await client.query(
      `SELECT id, name, image_url FROM services 
       WHERE tenant_id = $1 
       ORDER BY created_at DESC LIMIT 10`,
      [tenantId]
    );

    console.log(`Services: ${servicesResult.rows.length} found`);
    const withImages = servicesResult.rows.filter(s => s.image_url).length;
    console.log(`  - ${withImages} with images`);

    // Check packages
    const packagesResult = await client.query(
      `SELECT id, name, total_price, original_price, discount_percentage 
       FROM service_packages 
       WHERE tenant_id = $1 AND is_active = true`,
      [tenantId]
    );

    console.log(`Packages: ${packagesResult.rows.length} found`);
    packagesResult.rows.forEach(pkg => {
      const savePercent = pkg.original_price && pkg.total_price
        ? Math.round(((pkg.original_price - pkg.total_price) / pkg.original_price) * 100)
        : 0;
      console.log(`  - ${pkg.name}: ${pkg.total_price} SAR (Save ${savePercent}%)`);
    });

    // Check schedules
    const scheduleResult = await client.query(
      `SELECT COUNT(*) as count FROM shifts s
       JOIN services sv ON s.service_id = sv.id
       WHERE sv.tenant_id = $1 AND s.is_active = true`,
      [tenantId]
    );
    console.log(`Schedules: ${scheduleResult.rows[0].count} found\n`);
  } finally {
    client.release();
  }

  console.log('✅ Verification complete!\n');
}

async function getTenantId() {
  const client = await pool.connect();
  try {
    // Try to get tenant_id from database directly
    const result = await client.query(
      `SELECT tenant_id FROM users WHERE email = $1 LIMIT 1`,
      ['zain@gmail.com']
    );

    if (result.rows.length > 0 && result.rows[0].tenant_id) {
      return result.rows[0].tenant_id;
    }

    // If not found, try to get any tenant
    const tenantResult = await client.query(
      `SELECT id FROM tenants LIMIT 1`
    );

    if (tenantResult.rows.length > 0) {
      console.log('⚠️  User not found, using first available tenant');
      return tenantResult.rows[0].id;
    }

    throw new Error('No tenant found. Please create a tenant first.');
  } finally {
    client.release();
  }
}

async function main() {
  try {
    console.log('🚀 Starting complete test packages setup...\n');

    // Get tenant ID
    const tenantId = await getTenantId();
    console.log(`✓ Using tenant ID: ${tenantId}\n`);

    // Step 0: Run prerequisite migrations
    await runDiscountMigration();
    await runImageMigration();

    // Step 1: Run migration
    const migrationSuccess = await runMigration(tenantId);
    if (!migrationSuccess) {
      console.error('Migration failed, aborting...');
      process.exit(1);
    }

    // Step 2: Add images to services
    await addImagesToServices(tenantId);

    // Step 3: Create schedules
    await createSchedulesForServices(tenantId);

    // Step 4: Verify everything
    await verifySetup(tenantId);

    console.log('🎉 Setup completed successfully!\n');
    console.log('📋 Next steps:');
    console.log('  1. Login as zain@gmail.com / 1111');
    console.log('  2. Go to Packages page to verify packages');
    console.log('  3. Go to Services page to verify images');
    console.log('  4. Test booking flow as customer\n');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

