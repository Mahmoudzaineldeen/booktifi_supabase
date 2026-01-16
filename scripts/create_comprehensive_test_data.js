/**
 * Comprehensive Test Data Creation Script
 * 
 * This script creates a complete set of test data for comprehensive system testing:
 * - Multiple services with different categories
 * - Multiple offers for each service
 * - Multiple packages with various combinations
 * - Test schedules for all services
 * - Images for services and packages
 * 
 * Usage: node scripts/create_comprehensive_test_data.js
 */

import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key';
const DB_CONNECTION_STRING = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres';

// Initialize clients
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const pool = new Pool({ connectionString: DB_CONNECTION_STRING });

// Test data definitions
const TEST_SERVICES = [
  {
    name: 'Burj Khalifa At The Top',
    name_ar: 'برج خليفة في القمة',
    description: 'Experience the world\'s tallest building',
    description_ar: 'اختبر أطول مبنى في العالم',
    base_price: 150,
    duration_minutes: 120,
    category: 'Attractions'
  },
  {
    name: 'Dubai Aquarium & Underwater Zoo',
    name_ar: 'دبي أكواريوم وحديقة الحيوانات المائية',
    description: 'Explore the underwater world',
    description_ar: 'استكشف العالم تحت الماء',
    base_price: 100,
    duration_minutes: 90,
    category: 'Attractions'
  },
  {
    name: 'Desert Safari Adventure',
    name_ar: 'مغامرة رحلة الصحراء',
    description: 'Experience the beauty of the desert',
    description_ar: 'اختبر جمال الصحراء',
    base_price: 200,
    duration_minutes: 180,
    category: 'Adventures'
  },
  {
    name: 'Dubai Marina Cruise',
    name_ar: 'رحلة بحرية في مارينا دبي',
    description: 'Enjoy a cruise along Dubai Marina',
    description_ar: 'استمتع برحلة بحرية على طول مارينا دبي',
    base_price: 120,
    duration_minutes: 90,
    category: 'Tours'
  },
  {
    name: 'Dubai Museum',
    name_ar: 'متحف دبي',
    description: 'Learn about Dubai\'s history',
    description_ar: 'تعرف على تاريخ دبي',
    base_price: 50,
    duration_minutes: 60,
    category: 'Culture'
  },
  {
    name: 'Dubai Fountain Show',
    name_ar: 'عرض نافورة دبي',
    description: 'Watch the spectacular fountain show',
    description_ar: 'شاهد العرض المذهل للنافورة',
    base_price: 30,
    duration_minutes: 30,
    category: 'Entertainment'
  },
  {
    name: 'Dubai Frame',
    name_ar: 'إطار دبي',
    description: 'Visit the iconic Dubai Frame',
    description_ar: 'زر الإطار الأيقوني لدبي',
    base_price: 80,
    duration_minutes: 60,
    category: 'Attractions'
  },
  {
    name: 'Dubai Miracle Garden',
    name_ar: 'حديقة دبي المعجزة',
    description: 'Explore the beautiful flower garden',
    description_ar: 'استكشف حديقة الزهور الجميلة',
    base_price: 70,
    duration_minutes: 90,
    category: 'Nature'
  },
  {
    name: 'Dubai Mall Shopping',
    name_ar: 'تسوق في دبي مول',
    description: 'Shop at the world\'s largest mall',
    description_ar: 'تسوق في أكبر مول في العالم',
    base_price: 0,
    duration_minutes: 240,
    category: 'Shopping'
  },
  {
    name: 'Dubai Gold Souk',
    name_ar: 'سوق الذهب في دبي',
    description: 'Explore the traditional gold market',
    description_ar: 'استكشف سوق الذهب التقليدي',
    base_price: 0,
    duration_minutes: 120,
    category: 'Shopping'
  }
];

const OFFER_TEMPLATES = [
  {
    name: 'Standard',
    name_ar: 'قياسي',
    description: 'Standard experience with all basic features',
    description_ar: 'تجربة قياسية مع جميع الميزات الأساسية',
    discount_percentage: 0,
    badge: 'Best Value',
    badge_ar: 'أفضل قيمة',
    perks: ['Skip the line', 'Audio guide included', 'Free cancellation'],
    perks_ar: ['تخطي الطابور', 'دليل صوتي مشمول', 'إلغاء مجاني']
  },
  {
    name: 'Premium',
    name_ar: 'مميز',
    description: 'Enhanced experience with premium features',
    description_ar: 'تجربة محسّنة مع ميزات مميزة',
    discount_percentage: 10,
    badge: 'Most Popular',
    badge_ar: 'الأكثر شعبية',
    perks: ['Fast track entry', 'VIP access', 'Professional guide', 'Refreshments included'],
    perks_ar: ['دخول سريع', 'وصول VIP', 'مرشد محترف', 'مشروبات مشمولة']
  },
  {
    name: 'VIP',
    name_ar: 'VIP',
    description: 'Ultimate luxury experience',
    description_ar: 'تجربة فاخرة نهائية',
    discount_percentage: 20,
    badge: 'Luxury',
    badge_ar: 'فاخر',
    perks: ['Private tour', 'Luxury transportation', 'Personal guide', 'Premium dining', 'Exclusive access'],
    perks_ar: ['جولة خاصة', 'نقل فاخر', 'مرشد شخصي', 'طعام مميز', 'وصول حصري']
  }
];

const PACKAGE_COMBINATIONS = [
  {
    name: 'Dubai Essentials',
    name_ar: 'أساسيات دبي',
    description: 'Must-see attractions in Dubai',
    description_ar: 'معالم يجب رؤيتها في دبي',
    services: ['Burj Khalifa At The Top', 'Dubai Aquarium & Underwater Zoo', 'Dubai Fountain Show'],
    discount_percentage: 15
  },
  {
    name: 'Dubai Adventure',
    name_ar: 'مغامرة دبي',
    description: 'Thrilling adventures in Dubai',
    description_ar: 'مغامرات مثيرة في دبي',
    services: ['Desert Safari Adventure', 'Dubai Marina Cruise', 'Dubai Frame'],
    discount_percentage: 20
  },
  {
    name: 'Dubai Complete',
    name_ar: 'دبي الكاملة',
    description: 'Complete Dubai experience',
    description_ar: 'تجربة دبي الكاملة',
    services: ['Burj Khalifa At The Top', 'Dubai Aquarium & Underwater Zoo', 'Desert Safari Adventure', 'Dubai Marina Cruise'],
    discount_percentage: 25
  },
  {
    name: 'Dubai Culture',
    name_ar: 'ثقافة دبي',
    description: 'Explore Dubai\'s culture and history',
    description_ar: 'استكشف ثقافة وتاريخ دبي',
    services: ['Dubai Museum', 'Dubai Gold Souk', 'Dubai Frame'],
    discount_percentage: 10
  }
];

// Helper functions
async function getTenantId(email) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT tenant_id FROM users WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) {
      throw new Error(`User not found: ${email}`);
    }
    return result.rows[0].tenant_id;
  } finally {
    client.release();
  }
}

async function getOrCreateCategory(name, tenantId) {
  const client = await pool.connect();
  try {
    // Check if category exists
    let result = await client.query(
      'SELECT id FROM service_categories WHERE tenant_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2))',
      [tenantId, name]
    );
    
    if (result.rows.length > 0) {
      return result.rows[0].id;
    }
    
    // Create category
    result = await client.query(
      'INSERT INTO service_categories (tenant_id, name, name_ar) VALUES ($1, $2, $3) RETURNING id',
      [tenantId, name, name]
    );
    
    return result.rows[0].id;
  } finally {
    client.release();
  }
}

async function getRandomImage() {
  try {
    const assetsPath = join(__dirname, '..', 'assets');
    const files = await readdir(assetsPath);
    const imageFiles = files.filter(f => 
      f.match(/\.(jpg|jpeg|png|gif|webp)$/i)
    );
    
    if (imageFiles.length === 0) {
      return null;
    }
    
    const randomFile = imageFiles[Math.floor(Math.random() * imageFiles.length)];
    return `/assets/${randomFile}`;
  } catch (error) {
    console.warn('Could not get random image:', error.message);
    return null;
  }
}

async function createService(serviceData, categoryId, tenantId) {
  const client = await pool.connect();
  try {
    const imageUrl = await getRandomImage();
    const galleryUrls = [];
    
    // Add 3-5 random images to gallery
    for (let i = 0; i < Math.floor(Math.random() * 3) + 3; i++) {
      const img = await getRandomImage();
      if (img) galleryUrls.push(img);
    }
    
    const result = await client.query(
      `INSERT INTO services (
        tenant_id, category_id, name, name_ar, description, description_ar,
        base_price, duration_minutes, image_url, gallery_urls, is_active, is_public
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, name`,
      [
        tenantId,
        categoryId,
        serviceData.name,
        serviceData.name_ar,
        serviceData.description,
        serviceData.description_ar,
        serviceData.base_price,
        serviceData.duration_minutes,
        imageUrl,
        JSON.stringify(galleryUrls),
        true,
        true
      ]
    );
    
    const service = result.rows[0];
    console.log(`✓ Created service: ${service.name} (ID: ${service.id})`);
    return service;
  } catch (error) {
    console.error(`Error creating service ${serviceData.name}:`, error.message);
    return null;
  } finally {
    client.release();
  }
}

async function createOffer(service, template, tenantId) {
  const client = await pool.connect();
  try {
    const basePrice = parseFloat(service.base_price) || 0;
    const originalPrice = basePrice;
    const discountAmount = (basePrice * template.discount_percentage) / 100;
    const finalPrice = basePrice - discountAmount;
    
    const result = await client.query(
      `INSERT INTO service_offers (
        service_id, tenant_id, name, name_ar, description, description_ar,
        price, original_price, discount_percentage, duration_minutes,
        perks, perks_ar, badge, badge_ar, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id, name, price`,
      [
        service.id,
        tenantId,
        `${service.name} - ${template.name}`,
        `${service.name_ar} - ${template.name_ar}`,
        template.description,
        template.description_ar,
        Math.round(finalPrice * 100) / 100,
        template.discount_percentage > 0 ? originalPrice : null,
        template.discount_percentage > 0 ? template.discount_percentage : null,
        service.duration_minutes || 60,
        JSON.stringify(template.perks),
        JSON.stringify(template.perks_ar),
        template.badge,
        template.badge_ar,
        true
      ]
    );
    
    const offer = result.rows[0];
    console.log(`  ✓ Created offer: ${offer.name} (Price: ${offer.price} SAR)`);
    return offer;
  } catch (error) {
    console.error(`Error creating offer for ${service.name}:`, error.message);
    return null;
  } finally {
    client.release();
  }
}

async function createSchedule(serviceId, tenantId) {
  const client = await pool.connect();
  try {
    // Create a schedule for all days of the week (0-6, Sunday-Saturday)
    const daysOfWeek = [0, 1, 2, 3, 4, 5, 6];
    const startTime = '09:00:00';
    const endTime = '18:00:00';
    
    const result = await client.query(
      `INSERT INTO shifts (
        tenant_id, service_id, days_of_week, start_time_utc, end_time_utc, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`,
      [
        tenantId,
        serviceId,
        daysOfWeek,
        startTime,
        endTime,
        true
      ]
    );
    
    console.log(`  ✓ Created schedule for service`);
    return result.rows[0].id;
  } catch (error) {
    console.error(`Error creating schedule:`, error.message);
    return null;
  } finally {
    client.release();
  }
}

async function createPackage(packageData, serviceIds, tenantId) {
  const client = await pool.connect();
  try {
    // Calculate original price
    const originalPrice = serviceIds.reduce((sum, serviceId) => {
      const service = TEST_SERVICES.find(s => 
        serviceIds.includes(serviceIds.indexOf(s))
      );
      return sum + (service?.base_price || 0);
    }, 0);
    
    // Calculate total price with discount
    const discountAmount = (originalPrice * packageData.discount_percentage) / 100;
    const totalPrice = originalPrice - discountAmount;
    
    const imageUrl = await getRandomImage();
    const galleryUrls = [];
    for (let i = 0; i < Math.floor(Math.random() * 3) + 2; i++) {
      const img = await getRandomImage();
      if (img) galleryUrls.push(img);
    }
    
    // Create package
    const packageResult = await client.query(
      `INSERT INTO service_packages (
        tenant_id, name, name_ar, description, description_ar,
        total_price, original_price, discount_percentage,
        image_url, gallery_urls, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, name`,
      [
        tenantId,
        packageData.name,
        packageData.name_ar,
        packageData.description,
        packageData.description_ar,
        Math.round(totalPrice * 100) / 100,
        originalPrice,
        packageData.discount_percentage,
        imageUrl,
        JSON.stringify(galleryUrls),
        true
      ]
    );
    
    const pkg = packageResult.rows[0];
    
    // Add services to package
    for (const serviceId of serviceIds) {
      await client.query(
        `INSERT INTO package_services (package_id, service_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (package_id, service_id) DO NOTHING`,
        [pkg.id, serviceId, 1]
      );
    }
    
    console.log(`✓ Created package: ${pkg.name} (Price: ${totalPrice} SAR, Save: ${packageData.discount_percentage}%)`);
    return pkg;
  } catch (error) {
    console.error(`Error creating package ${packageData.name}:`, error.message);
    return null;
  } finally {
    client.release();
  }
}

async function main() {
  console.log('🚀 Starting comprehensive test data creation...\n');
  
  try {
    // Get tenant ID
    const tenantId = await getTenantId('zain@gmail.com');
    console.log(`✓ Found tenant ID: ${tenantId}\n`);
    
    // Step 1: Create categories
    console.log('📁 Creating categories...');
    const categories = {};
    for (const service of TEST_SERVICES) {
      if (!categories[service.category]) {
        const categoryId = await getOrCreateCategory(service.category, tenantId);
        categories[service.category] = categoryId;
        console.log(`  ✓ Category: ${service.category}`);
      }
    }
    console.log('');
    
    // Step 2: Create services
    console.log('🎯 Creating services...');
    const createdServices = [];
    for (const serviceData of TEST_SERVICES) {
      const categoryId = categories[serviceData.category];
      const service = await createService(serviceData, categoryId, tenantId);
      if (service) {
        createdServices.push({ ...serviceData, id: service.id, base_price: serviceData.base_price });
        // Create schedule for each service
        await createSchedule(service.id, tenantId);
      }
    }
    console.log(`\n✓ Created ${createdServices.length} services\n`);
    
    // Step 3: Create offers for each service
    console.log('🎁 Creating offers...');
    let offersCount = 0;
    for (const service of createdServices) {
      for (const template of OFFER_TEMPLATES) {
        const offer = await createOffer(service, template, tenantId);
        if (offer) offersCount++;
      }
    }
    console.log(`\n✓ Created ${offersCount} offers\n`);
    
    // Step 4: Create packages
    console.log('📦 Creating packages...');
    const createdPackages = [];
    for (const packageData of PACKAGE_COMBINATIONS) {
      // Find service IDs by name
      const serviceIds = packageData.services
        .map(serviceName => {
          const service = createdServices.find(s => s.name === serviceName);
          return service?.id;
        })
        .filter(id => id);
      
      if (serviceIds.length >= 2) {
        const pkg = await createPackage(packageData, serviceIds, tenantId);
        if (pkg) createdPackages.push(pkg);
      }
    }
    console.log(`\n✓ Created ${createdPackages.length} packages\n`);
    
    // Summary
    console.log('='.repeat(50));
    console.log('✅ Test Data Creation Complete!');
    console.log('='.repeat(50));
    console.log(`📊 Summary:`);
    console.log(`   - Services: ${createdServices.length}`);
    console.log(`   - Offers: ${offersCount}`);
    console.log(`   - Packages: ${createdPackages.length}`);
    console.log(`   - Categories: ${Object.keys(categories).length}`);
    console.log('');
    console.log('🎉 You can now test the system with this comprehensive data!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script
main();



