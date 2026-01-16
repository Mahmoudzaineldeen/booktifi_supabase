/**
 * Script to create test data for packages feature
 * - Creates 10 test services with images
 * - Creates test packages
 * - Creates a test user account
 * 
 * Run with: node scripts/create_test_packages.js
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase client
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const supabase = createClient(supabaseUrl, supabaseKey);

// Test services data
const testServices = [
  {
    name: 'Burj Khalifa Observation Deck',
    name_ar: 'سطح المراقبة في برج خليفة',
    description: 'Experience breathtaking views from the world\'s tallest building',
    description_ar: 'استمتع بإطلالات خلابة من أطول مبنى في العالم',
    base_price: 150,
    duration_minutes: 60,
    capacity_per_slot: 20
  },
  {
    name: 'Dubai Aquarium & Underwater Zoo',
    name_ar: 'دبي أكواريوم وحديقة الحيوانات المائية',
    description: 'Explore the underwater world with thousands of marine animals',
    description_ar: 'استكشف العالم تحت الماء مع آلاف الحيوانات البحرية',
    base_price: 120,
    duration_minutes: 90,
    capacity_per_slot: 30
  },
  {
    name: 'Desert Safari Adventure',
    name_ar: 'مغامرة رحلة الصحراء',
    description: 'Thrilling dune bashing, camel rides, and traditional dinner',
    description_ar: 'ركوب الكثبان الرملية المثيرة، ركوب الجمال، والعشاء التقليدي',
    base_price: 200,
    duration_minutes: 240,
    capacity_per_slot: 15
  },
  {
    name: 'Dubai Marina Cruise',
    name_ar: 'رحلة بحرية في مارينا دبي',
    description: 'Scenic boat tour through Dubai Marina and Palm Jumeirah',
    description_ar: 'جولة بحرية خلابة عبر مارينا دبي وجزيرة النخيل',
    base_price: 80,
    duration_minutes: 90,
    capacity_per_slot: 40
  },
  {
    name: 'Dubai Frame Experience',
    name_ar: 'تجربة إطار دبي',
    description: 'Visit the iconic Dubai Frame with panoramic city views',
    description_ar: 'زيارة إطار دبي الأيقوني مع إطلالات بانورامية على المدينة',
    base_price: 60,
    duration_minutes: 60,
    capacity_per_slot: 25
  },
  {
    name: 'IMG Worlds of Adventure',
    name_ar: 'عوالم إم جي للمغامرات',
    description: 'Largest indoor theme park in the world',
    description_ar: 'أكبر حديقة ألعاب مغلقة في العالم',
    base_price: 250,
    duration_minutes: 360,
    capacity_per_slot: 50
  },
  {
    name: 'Dubai Museum & Al Fahidi Fort',
    name_ar: 'متحف دبي وقلعة الفهيدي',
    description: 'Discover Dubai\'s rich history and heritage',
    description_ar: 'اكتشف تاريخ دبي الغني وتراثها',
    base_price: 30,
    duration_minutes: 90,
    capacity_per_slot: 35
  },
  {
    name: 'Dubai Garden Glow',
    name_ar: 'حديقة دبي المضيئة',
    description: 'Magical illuminated garden with art installations',
    description_ar: 'حديقة مضيئة سحرية مع منحوتات فنية',
    base_price: 70,
    duration_minutes: 120,
    capacity_per_slot: 40
  },
  {
    name: 'Dubai Miracle Garden',
    name_ar: 'حديقة دبي المعجزة',
    description: 'World\'s largest natural flower garden',
    description_ar: 'أكبر حديقة زهور طبيعية في العالم',
    base_price: 55,
    duration_minutes: 120,
    capacity_per_slot: 45
  },
  {
    name: 'Dubai Gold Souk Tour',
    name_ar: 'جولة سوق الذهب في دبي',
    description: 'Explore the traditional gold market with expert guide',
    description_ar: 'استكشف سوق الذهب التقليدي مع مرشد خبير',
    base_price: 40,
    duration_minutes: 60,
    capacity_per_slot: 20
  }
];

// Test packages data
const testPackages = [
  {
    name: 'Dubai Essentials Package',
    name_ar: 'باقة أساسيات دبي',
    description: 'Perfect introduction to Dubai\'s top attractions',
    description_ar: 'مقدمة مثالية لأهم معالم دبي',
    serviceIndices: [0, 1, 3], // Burj Khalifa, Aquarium, Marina Cruise
    discount_percentage: 15
  },
  {
    name: 'Dubai Adventure Combo',
    name_ar: 'باقة مغامرات دبي',
    description: 'Thrilling experiences for adventure seekers',
    description_ar: 'تجارب مثيرة لعشاق المغامرات',
    serviceIndices: [2, 5, 7], // Desert Safari, IMG Worlds, Garden Glow
    discount_percentage: 20
  },
  {
    name: 'Dubai Culture & Heritage',
    name_ar: 'باقة الثقافة والتراث في دبي',
    description: 'Explore Dubai\'s rich history and culture',
    description_ar: 'استكشف تاريخ دبي وثقافتها الغنية',
    serviceIndices: [6, 9, 4], // Museum, Gold Souk, Dubai Frame
    discount_percentage: 10
  },
  {
    name: 'Dubai Family Fun Package',
    name_ar: 'باقة المرح العائلي في دبي',
    description: 'Family-friendly attractions and activities',
    description_ar: 'معالم وأنشطة مناسبة للعائلات',
    serviceIndices: [1, 5, 8], // Aquarium, IMG Worlds, Miracle Garden
    discount_percentage: 18
  },
  {
    name: 'Dubai Premium Experience',
    name_ar: 'باقة التجربة المميزة في دبي',
    description: 'Ultimate Dubai experience with top attractions',
    description_ar: 'تجربة دبي المثالية مع أهم المعالم',
    serviceIndices: [0, 2, 3, 5], // Burj Khalifa, Desert Safari, Marina, IMG Worlds
    discount_percentage: 25
  }
];

async function getTenantId(email) {
  // Try to find user by email
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('email', email)
    .maybeSingle();

  if (userError) {
    console.error('Error querying users:', userError);
  }

  if (userData && userData.tenant_id) {
    return userData.tenant_id;
  }

  // If user not found, try to get any tenant for testing
  const { data: tenantsData } = await supabase
    .from('tenants')
    .select('id')
    .limit(1)
    .single();

  if (tenantsData) {
    console.log(`User ${email} not found, using first available tenant: ${tenantsData.id}`);
    return tenantsData.id;
  }

  throw new Error(`Could not find tenant. Please ensure user ${email} exists or create a tenant first.`);
}

async function createService(tenantId, serviceData, imagePath) {
  // Read image file if exists
  let imageUrl = null;
  if (imagePath && fs.existsSync(imagePath)) {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    imageUrl = `data:image/jpeg;base64,${base64Image}`;
  }

  const servicePayload = {
    tenant_id: tenantId,
    name: serviceData.name,
    name_ar: serviceData.name_ar,
    description: serviceData.description,
    description_ar: serviceData.description_ar,
    base_price: serviceData.base_price,
    duration_minutes: serviceData.duration_minutes,
    capacity_per_slot: serviceData.capacity_per_slot,
    service_capacity_per_slot: serviceData.capacity_per_slot,
    service_duration_minutes: serviceData.duration_minutes,
    capacity_mode: 'service_based',
    is_public: true,
    is_active: true,
    image_url: imageUrl,
    gallery_urls: imageUrl ? [imageUrl] : null
  };

  const { data, error } = await supabase
    .from('services')
    .insert(servicePayload)
    .select()
    .single();

  if (error) {
    console.error(`Error creating service ${serviceData.name}:`, error);
    return null;
  }

  console.log(`✓ Created service: ${serviceData.name} (ID: ${data.id})`);
  return data.id;
}

async function createPackage(tenantId, packageData, serviceIds) {
  // Calculate prices
  const selectedServices = packageData.serviceIndices.map(idx => serviceIds[idx]).filter(Boolean);
  if (selectedServices.length < 2) {
    console.warn(`Skipping package ${packageData.name} - not enough services`);
    return null;
  }

  // Get service prices
  const { data: servicesData } = await supabase
    .from('services')
    .select('base_price')
    .in('id', selectedServices);

  const originalPrice = servicesData?.reduce((sum, s) => sum + parseFloat(s.base_price), 0) || 0;
  const discountAmount = (originalPrice * packageData.discount_percentage) / 100;
  const totalPrice = originalPrice - discountAmount;

  const packagePayload = {
    tenant_id: tenantId,
    name: packageData.name,
    name_ar: packageData.name_ar,
    description: packageData.description,
    description_ar: packageData.description_ar,
    total_price: totalPrice,
    original_price: originalPrice,
    discount_percentage: packageData.discount_percentage,
    is_active: true
  };

  const { data: packageResult, error: packageError } = await supabase
    .from('service_packages')
    .insert(packagePayload)
    .select()
    .single();

  if (packageError) {
    console.error(`Error creating package ${packageData.name}:`, packageError);
    return null;
  }

  // Create package_services entries
  const packageServices = selectedServices.map(serviceId => ({
    package_id: packageResult.id,
    service_id: serviceId,
    quantity: 1
  }));

  const { error: packageServicesError } = await supabase
    .from('package_services')
    .insert(packageServices);

  if (packageServicesError) {
    console.error(`Error creating package services for ${packageData.name}:`, packageServicesError);
    return null;
  }

  console.log(`✓ Created package: ${packageData.name} (ID: ${packageResult.id})`);
  return packageResult.id;
}

async function createTestUser(tenantId) {
  const testUserEmail = 'testuser@example.com';
  const testUserPassword = 'TestUser123!';

  // Check if user already exists
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('email', testUserEmail)
    .single();

  if (existingUser) {
    console.log(`✓ Test user already exists: ${testUserEmail}`);
    return existingUser.id;
  }

  // Create user (you may need to use auth API for this)
  console.log(`Note: Test user creation may require auth API. Email: ${testUserEmail}, Password: ${testUserPassword}`);
  return null;
}

async function main() {
  try {
    console.log('Starting test data creation...\n');

    // Get tenant ID for zain@gmail.com
    const tenantId = await getTenantId('zain@gmail.com');
    console.log(`✓ Found tenant ID: ${tenantId}\n`);

    // Create services
    console.log('Creating test services...');
    const serviceIds = [];
    const assetsPath = path.join(__dirname, '../assets');
    
    for (let i = 0; i < testServices.length; i++) {
      const service = testServices[i];
      // Try to find image in assets folder
      const imagePath = path.join(assetsPath, `service${i + 1}.jpg`);
      const serviceId = await createService(tenantId, service, imagePath);
      if (serviceId) {
        serviceIds.push(serviceId);
      }
    }

    console.log(`\n✓ Created ${serviceIds.length} services\n`);

    // Create packages
    console.log('Creating test packages...');
    const packageIds = [];
    for (const packageData of testPackages) {
      const packageId = await createPackage(tenantId, packageData, serviceIds);
      if (packageId) {
        packageIds.push(packageId);
      }
    }

    console.log(`\n✓ Created ${packageIds.length} packages\n`);

    // Create test user
    console.log('Creating test user...');
    await createTestUser(tenantId);

    console.log('\n✅ Test data creation completed!');
    console.log('\nTest User Credentials:');
    console.log('Email: testuser@example.com');
    console.log('Password: TestUser123!');
    console.log('\nService Provider Credentials:');
    console.log('Email: zain@gmail.com');
    console.log('Password: 1111');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();

