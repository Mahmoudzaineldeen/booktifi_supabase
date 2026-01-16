/**
 * Script to create 2 offers for each service
 * - Fetches all active services for a tenant
 * - Creates 2 offers per service with realistic data
 * - Verifies offers are created correctly
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Initialize Supabase client
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const supabase = createClient(supabaseUrl, supabaseKey);

// Database connection for direct queries
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

// Offer templates with different types
const offerTemplates = [
  {
    name: 'Standard',
    name_ar: 'عادي',
    description: 'Standard service experience with all basic features included.',
    description_ar: 'تجربة خدمة عادية مع جميع الميزات الأساسية.',
    badge: 'Best Value',
    badge_ar: 'أفضل قيمة',
    discountPercentage: 0,
    perks: ['Basic features', 'Standard support', 'Regular access'],
    perks_ar: ['ميزات أساسية', 'دعم قياسي', 'وصول عادي'],
    displayOrder: 1
  },
  {
    name: 'Premium',
    name_ar: 'مميز',
    description: 'Enhanced experience with priority access and exclusive perks.',
    description_ar: 'تجربة محسّنة مع وصول ذي أولوية ومزايا حصرية.',
    badge: 'Most Popular',
    badge_ar: 'الأكثر شعبية',
    discountPercentage: 10,
    perks: ['Priority access', 'Fast-track entry', 'Exclusive perks', 'VIP support'],
    perks_ar: ['وصول ذو أولوية', 'دخول سريع', 'مزايا حصرية', 'دعم مميز'],
    displayOrder: 0
  }
];

async function getTenantId(email) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT tenant_id FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      console.error(`User not found: ${email}`);
      return null;
    }

    return result.rows[0].tenant_id;
  } catch (error) {
    console.error('Error in getTenantId:', error);
    return null;
  } finally {
    client.release();
  }
}

async function fetchServices(tenantId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT id, name, name_ar, base_price, duration_minutes FROM services WHERE tenant_id = $1 AND is_active = true',
      [tenantId]
    );

    return result.rows || [];
  } catch (error) {
    console.error('Error in fetchServices:', error);
    return [];
  } finally {
    client.release();
  }
}

async function createOffer(service, template, tenantId) {
  const client = await pool.connect();
  try {
    const basePrice = parseFloat(service.base_price) || 0;
    const originalPrice = basePrice;
    const discountAmount = (basePrice * template.discountPercentage) / 100;
    const finalPrice = basePrice - discountAmount;

    const result = await client.query(
      `INSERT INTO service_offers (
        service_id, tenant_id, name, name_ar, description, description_ar,
        price, original_price, discount_percentage, duration_minutes,
        perks, perks_ar, badge, badge_ar, display_order, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, name, price`,
      [
        service.id,
        tenantId,
        `${service.name} - ${template.name}`,
        `${service.name_ar || service.name} - ${template.name_ar}`,
        template.description,
        template.description_ar,
        Math.round(finalPrice * 100) / 100,
        template.discountPercentage > 0 ? originalPrice : null,
        template.discountPercentage > 0 ? template.discountPercentage : null,
        service.duration_minutes || 60,
        JSON.stringify(template.perks),
        JSON.stringify(template.perks_ar),
        template.badge,
        template.badge_ar,
        template.displayOrder,
        true
      ]
    );

    const offer = result.rows[0];
    console.log(`✓ Created offer: ${offer.name} (Price: ${offer.price} SAR)`);
    return offer;
  } catch (error) {
    console.error(`Error creating offer for ${service.name}:`, error);
    return null;
  } finally {
    client.release();
  }
}

async function verifyOffers(tenantId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT 
        so.id, so.name, so.service_id, so.price, so.is_active,
        s.name as service_name
      FROM service_offers so
      INNER JOIN services s ON so.service_id = s.id
      WHERE so.tenant_id = $1 AND so.is_active = true
      ORDER BY s.name, so.display_order`,
      [tenantId]
    );

    const offers = result.rows || [];
    console.log(`\n✅ Verification: Found ${offers.length} active offers`);
    
    // Group by service
    const offersByService = {};
    offers.forEach(offer => {
      const serviceName = offer.service_name || 'Unknown';
      if (!offersByService[serviceName]) {
        offersByService[serviceName] = [];
      }
      offersByService[serviceName].push(offer);
    });

    console.log('\n📊 Offers by Service:');
    Object.keys(offersByService).forEach(serviceName => {
      console.log(`  ${serviceName}: ${offersByService[serviceName].length} offer(s)`);
      offersByService[serviceName].forEach(offer => {
        console.log(`    - ${offer.name} (${offer.price} SAR)`);
      });
    });
  } catch (error) {
    console.error('Error in verifyOffers:', error);
  } finally {
    client.release();
  }
}

async function main() {
  console.log('🚀 Starting offer creation process...\n');

  // Get tenant ID for zain@gmail.com
  const email = 'zain@gmail.com';
  console.log(`📧 Fetching tenant for: ${email}`);
  const tenantId = await getTenantId(email);

  if (!tenantId) {
    console.error('❌ Failed to get tenant ID. Please ensure the user exists.');
    process.exit(1);
  }

  console.log(`✅ Found tenant ID: ${tenantId}\n`);

  // Fetch all services
  console.log('📦 Fetching services...');
  const services = await fetchServices(tenantId);

  if (services.length === 0) {
    console.error('❌ No active services found. Please create services first.');
    process.exit(1);
  }

  console.log(`✅ Found ${services.length} service(s)\n`);

  // Check for existing offers
  const client = await pool.connect();
  let servicesNeedingOffers = services;
  try {
    const existingResult = await client.query(
      'SELECT DISTINCT service_id FROM service_offers WHERE tenant_id = $1',
      [tenantId]
    );
    const servicesWithOffers = new Set((existingResult.rows || []).map(o => o.service_id));
    servicesNeedingOffers = services.filter(s => !servicesWithOffers.has(s.id));
  } catch (error) {
    console.error('Error checking existing offers:', error);
  } finally {
    client.release();
  }

  if (servicesNeedingOffers.length === 0) {
    console.log('⚠️  All services already have offers. Skipping creation.\n');
    await verifyOffers(tenantId);
    return;
  }

  console.log(`📝 Creating offers for ${servicesNeedingOffers.length} service(s)...\n`);

  // Create 2 offers for each service
  let successCount = 0;
  let failCount = 0;

  for (const service of servicesNeedingOffers) {
    console.log(`\n📌 Processing: ${service.name}`);
    
    for (const template of offerTemplates) {
      const offer = await createOffer(service, template, tenantId);
      if (offer) {
        successCount++;
      } else {
        failCount++;
      }
    }
  }

  console.log(`\n\n📊 Summary:`);
  console.log(`  ✅ Successfully created: ${successCount} offer(s)`);
  console.log(`  ❌ Failed: ${failCount} offer(s)`);
  console.log(`  📦 Total services processed: ${servicesNeedingOffers.length}`);

  // Verify offers
  console.log('\n🔍 Verifying offers...');
  await verifyOffers(tenantId);

  console.log('\n✅ Offer creation process completed!');
  
  // Close database connection
  await pool.end();
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

