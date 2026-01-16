// Script to seed required data: 10 services, 110 users, bookings, and reviews
import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

// Helper function to convert image to base64 data URL
function imageToBase64DataUrl(imagePath) {
  try {
    const imageBuffer = readFileSync(imagePath);
    const ext = imagePath.split('.').pop().toLowerCase();
    const mimeType = ext === 'png' ? 'image/png' : 
                     ext === 'gif' ? 'image/gif' : 
                     'image/jpeg';
    const base64 = imageBuffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error(`Error reading image ${imagePath}:`, error.message);
    return null;
  }
}

async function seedData() {
  const client = await pool.connect();
  
  try {
    console.log('\n=== SEEDING REQUIRED DATA ===\n');
    
    await client.query('BEGIN');

    // ============================================================================
    // STEP 1: GET TENANT_ID FOR ZAIN@GMAIL.COM
    // ============================================================================
    console.log('Step 1: Getting tenant_id for zain@gmail.com...');
    
    const userResult = await client.query(
      'SELECT id, tenant_id FROM users WHERE email = $1',
      ['zain@gmail.com']
    );

    if (userResult.rows.length === 0) {
      throw new Error('User zain@gmail.com not found. Please create this user first.');
    }

    const serviceProvider = userResult.rows[0];
    const tenantId = serviceProvider.tenant_id;
    const serviceProviderId = serviceProvider.id;

    if (!tenantId) {
      throw new Error('User zain@gmail.com does not have a tenant_id. Please assign a tenant first.');
    }

    console.log(`✅ Found tenant_id: ${tenantId}`);
    console.log(`✅ Service provider user_id: ${serviceProviderId}\n`);

    // ============================================================================
    // STEP 2: GET AVAILABLE IMAGES FROM ASSETS FOLDER
    // ============================================================================
    console.log('Step 2: Reading images from assets folder...');
    
    const assetsPath = join(__dirname, '..', '..', 'assets');
    const imageFiles = readdirSync(assetsPath)
      .filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file))
      .map(file => join(assetsPath, file));

    if (imageFiles.length === 0) {
      throw new Error('No images found in assets folder');
    }

    console.log(`✅ Found ${imageFiles.length} images\n`);

    // ============================================================================
    // STEP 3: CREATE 10 SERVICES
    // ============================================================================
    console.log('Step 3: Creating 10 services...');
    
    const serviceNames = [
      { en: 'Burj Khalifa Observation Deck', ar: 'سطح المراقبة في برج خليفة' },
      { en: 'Sky Views Observatory', ar: 'مرصد سكاي فيوز' },
      { en: 'At The Top Experience', ar: 'تجربة في القمة' },
      { en: 'VIP Lounge Access', ar: 'وصول صالة VIP' },
      { en: 'Sunset Experience', ar: 'تجربة الغروب' },
      { en: 'Night Tour', ar: 'جولة ليلية' },
      { en: 'Photography Tour', ar: 'جولة التصوير' },
      { en: 'Family Package', ar: 'باقة العائلة' },
      { en: 'Group Tour', ar: 'جولة جماعية' },
      { en: 'Premium Experience', ar: 'تجربة مميزة' }
    ];

    const serviceDescriptions = [
      { en: 'Experience breathtaking views from the world\'s tallest building', ar: 'استمتع بإطلالات خلابة من أطول مبنى في العالم' },
      { en: '360-degree panoramic views of Dubai', ar: 'إطلالات بانورامية 360 درجة على دبي' },
      { en: 'Exclusive access to the top floors', ar: 'وصول حصري للطوابق العلوية' },
      { en: 'Luxury lounge with premium amenities', ar: 'صالة فاخرة مع وسائل راحة مميزة' },
      { en: 'Watch the sunset from the top', ar: 'شاهد غروب الشمس من القمة' },
      { en: 'Evening tour with city lights', ar: 'جولة مسائية مع أضواء المدينة' },
      { en: 'Professional photography session', ar: 'جلسة تصوير احترافية' },
      { en: 'Perfect for families with children', ar: 'مثالي للعائلات مع الأطفال' },
      { en: 'Group booking with special rates', ar: 'حجز جماعي بأسعار خاصة' },
      { en: 'Ultimate luxury experience', ar: 'تجربة فاخرة نهائية' }
    ];

    const prices = [150, 200, 180, 300, 220, 190, 250, 350, 120, 400];
    const serviceIds = [];
    const servicesWithDiscounts = [0, 2, 5, 8]; // Indices of services that will have discounts

    for (let i = 0; i < 10; i++) {
      const imageIndex = i % imageFiles.length;
      const imagePath = imageFiles[imageIndex];
      const imageUrl = imageToBase64DataUrl(imagePath);
      
      const basePrice = prices[i];
      let originalPrice = null;
      let discountPercentage = null;

      // Add discount for 4 services
      if (servicesWithDiscounts.includes(i)) {
        originalPrice = basePrice * 1.5; // 50% markup for original price
        discountPercentage = Math.round(((originalPrice - basePrice) / originalPrice) * 100);
      }

      // Check if discount columns exist (only check once)
      if (i === 0) {
        const columnCheck = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'services' 
          AND column_name IN ('original_price', 'discount_percentage')
        `);
        global.hasOriginalPrice = columnCheck.rows.some(r => r.column_name === 'original_price');
        global.hasDiscountPercentage = columnCheck.rows.some(r => r.column_name === 'discount_percentage');
      }

      // Build INSERT query
      const baseColumns = [
        'id', 'tenant_id', 'name', 'name_ar', 'description', 'description_ar',
        'duration_minutes', 'service_duration_minutes', 'base_price'
      ];
      const baseValues = [
        'gen_random_uuid()', '$1', '$2', '$3', '$4', '$5', '$6', '$6', '$7'
      ];
      const baseParams = [
        tenantId,
        serviceNames[i].en,
        serviceNames[i].ar,
        serviceDescriptions[i].en,
        serviceDescriptions[i].ar,
        60,
        basePrice
      ];

      let paramIndex = 8;
      if (global.hasOriginalPrice && originalPrice) {
        baseColumns.push('original_price');
        baseValues.push(`$${paramIndex}`);
        baseParams.push(originalPrice);
        paramIndex++;
      }
      if (global.hasDiscountPercentage && discountPercentage) {
        baseColumns.push('discount_percentage');
        baseValues.push(`$${paramIndex}`);
        baseParams.push(discountPercentage);
        paramIndex++;
      }

      baseColumns.push('capacity_per_slot', 'service_capacity_per_slot', 'capacity_mode', 'image_url', 'gallery_urls', 'is_public', 'is_active');
      baseValues.push('10', '10', "'service_based'", `$${paramIndex}`, `$${paramIndex + 1}`, 'true', 'true');
      baseParams.push(imageUrl, imageUrl ? JSON.stringify([imageUrl]) : null);

      const returnColumns = 'id, name, base_price' + 
        (global.hasOriginalPrice ? ', original_price' : '') +
        (global.hasDiscountPercentage ? ', discount_percentage' : '');

      const serviceResult = await client.query(`
        INSERT INTO services (${baseColumns.join(', ')})
        VALUES (${baseValues.join(', ')})
        RETURNING ${returnColumns}
      `, baseParams);

      const service = serviceResult.rows[0];
      serviceIds.push(service.id);
      
      if (originalPrice) {
        console.log(`  ✅ Service ${i + 1}: ${service.name} - Price: ${basePrice} SAR (Discount: ${discountPercentage}% from ${originalPrice} SAR)`);
      } else {
        console.log(`  ✅ Service ${i + 1}: ${service.name} - Price: ${basePrice} SAR`);
      }

      // Create a shift for this service (Monday to Sunday, 9 AM to 9 PM)
      const shiftResult = await client.query(`
        INSERT INTO shifts (
          id,
          tenant_id,
          service_id,
          days_of_week,
          start_time_utc,
          end_time_utc,
          is_active
        ) VALUES (
          gen_random_uuid(),
          $1,
          $2,
          ARRAY[0,1,2,3,4,5,6],
          '09:00:00',
          '21:00:00',
          true
        )
        RETURNING id
      `, [tenantId, service.id]);

      const shiftId = shiftResult.rows[0].id;

      // Create slots for the next 30 days
      const today = new Date();
      for (let day = 0; day < 30; day++) {
        const slotDate = new Date(today);
        slotDate.setDate(today.getDate() + day);
        const dateStr = slotDate.toISOString().split('T')[0];
        
        // Create slots every hour from 9 AM to 8 PM
        for (let hour = 9; hour < 21; hour++) {
          const startTime = new Date(slotDate);
          startTime.setHours(hour, 0, 0, 0);
          const endTime = new Date(slotDate);
          endTime.setHours(hour + 1, 0, 0, 0);

          const startTimeStr = startTime.toTimeString().substring(0, 8);
          const endTimeStr = endTime.toTimeString().substring(0, 8);
          const capacity = 10;

          await client.query(`
            INSERT INTO slots (
              id,
              tenant_id,
              shift_id,
              slot_date,
              start_time,
              end_time,
              start_time_utc,
              end_time_utc,
              original_capacity,
              available_capacity,
              booked_count,
              is_available
            ) VALUES (
              gen_random_uuid(),
              $1,
              $2,
              $3,
              $4,
              $5,
              $6::timestamptz,
              $7::timestamptz,
              $8,
              $8,
              0,
              true
            )
            ON CONFLICT DO NOTHING
          `, [
            tenantId,
            shiftId,
            dateStr,
            startTimeStr,
            endTimeStr,
            startTime.toISOString(),
            endTime.toISOString(),
            capacity
          ]);
        }
      }
    }

    console.log(`✅ Created ${serviceIds.length} services with shifts and time slots\n`);

    // ============================================================================
    // STEP 4: CREATE 110 USERS
    // ============================================================================
    console.log('Step 4: Creating 110 users...');
    
    const customerPassword = '11111';
    const hashedPassword = await bcrypt.hash(customerPassword, 10);
    const userIds = [];

    for (let i = 1; i <= 110; i++) {
      const email = `customer${i}@test.com`;
      const username = `customer${i}`;
      const fullName = `Customer ${i}`;
      const phone = `+966501234${String(i).padStart(4, '0')}`;

      // Check if user already exists
      const checkResult = await client.query(
        'SELECT id FROM users WHERE email = $1 OR username = $2',
        [email, username]
      );

      let userId;
      if (checkResult.rows.length > 0) {
        userId = checkResult.rows[0].id;
        // Update existing user
        await client.query(`
          UPDATE users SET
            tenant_id = $1,
            role = 'customer',
            password_hash = $2,
            is_active = true,
            full_name = $3,
            phone = $4
          WHERE id = $5
        `, [tenantId, hashedPassword, fullName, phone, userId]);
      } else {
        const userResult = await client.query(`
          INSERT INTO users (
            id,
            tenant_id,
            email,
            username,
            full_name,
            phone,
            role,
            password_hash,
            is_active
          ) VALUES (
            gen_random_uuid(),
            $1,
            $2,
            $3,
            $4,
            $5,
            'customer',
            $6,
            true
          )
          RETURNING id
        `, [tenantId, email, username, fullName, phone, hashedPassword]);

        userId = userResult.rows[0].id;
      }

      userIds.push(userId);
      
      if (i % 10 === 0) {
        console.log(`  ✅ Created ${i} users...`);
      }
    }

    console.log(`✅ Created ${userIds.length} users\n`);

    // ============================================================================
    // STEP 5: CREATE BOOKINGS AND REVIEWS (FOR EVERY 10 USERS)
    // ============================================================================
    console.log('Step 5: Creating bookings and reviews...');
    
    const bookingIds = [];
    const reviewIds = [];

    for (let group = 0; group < 11; group++) {
      const startIndex = group * 10;
      const endIndex = Math.min(startIndex + 10, userIds.length);
      
      console.log(`  Processing group ${group + 1} (users ${startIndex + 1}-${endIndex})...`);

      for (let i = startIndex; i < endIndex; i++) {
        const userId = userIds[i];
        const userEmail = `customer${i + 1}@test.com`;
        const userName = `Customer ${i + 1}`;
        const userPhone = `+966501234${String(i + 1).padStart(4, '0')}`;

        // Select a random service for this user
        const serviceIndex = i % serviceIds.length;
        const serviceId = serviceIds[serviceIndex];

        // Get a slot for this service
        const slotResult = await client.query(`
          SELECT s.id, s.start_time_utc, s.end_time_utc, s.available_capacity
          FROM slots s
          JOIN shifts sh ON s.shift_id = sh.id
          WHERE sh.service_id = $1
            AND s.is_available = true
            AND s.available_capacity > 0
            AND s.start_time_utc > NOW()
          ORDER BY s.start_time_utc
          LIMIT 1
        `, [serviceId]);

        if (slotResult.rows.length === 0) {
          console.log(`    ⚠️  No available slots for service ${serviceIndex + 1}, skipping user ${i + 1}`);
          continue;
        }

        const slot = slotResult.rows[0];

        // Get service price
        const servicePriceResult = await client.query(
          'SELECT base_price FROM services WHERE id = $1',
          [serviceId]
        );
        const servicePrice = parseFloat(servicePriceResult.rows[0].base_price);
        const visitorCount = 1;
        const totalPrice = servicePrice * visitorCount;

        // Create booking (using service provider account)
        const bookingResult = await client.query(`
          INSERT INTO bookings (
            id,
            tenant_id,
            service_id,
            slot_id,
            customer_name,
            customer_phone,
            customer_email,
            visitor_count,
            total_price,
            status,
            payment_status,
            customer_id,
            created_by_user_id
          ) VALUES (
            gen_random_uuid(),
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            'confirmed',
            'unpaid',
            $9,
            $10
          )
          RETURNING id
        `, [
          tenantId,
          serviceId,
          slot.id,
          userName,
          userPhone,
          userEmail,
          visitorCount,
          totalPrice,
          userId,
          serviceProviderId
        ]);

        const bookingId = bookingResult.rows[0].id;
        bookingIds.push(bookingId);

        // Update slot capacity
        await client.query(`
          UPDATE slots
          SET available_capacity = available_capacity - $1,
              booked_count = booked_count + $1
          WHERE id = $2
        `, [visitorCount, slot.id]);

        // Create review with image
        const reviewImageIndex = (i + group) % imageFiles.length;
        const reviewImagePath = imageFiles[reviewImageIndex];
        const reviewImageUrl = imageToBase64DataUrl(reviewImagePath);

        const rating = Math.floor(Math.random() * 3) + 3; // Rating between 3 and 5
        const comments = [
          'Great experience! Highly recommended.',
          'Amazing views and excellent service.',
          'Wonderful time, will come back again.',
          'Perfect for families, kids loved it.',
          'Professional staff and beautiful location.',
          'Best experience in Dubai!',
          'Exceeded expectations, worth every penny.',
          'Memorable experience, highly satisfied.',
          'Great value for money, excellent service.',
          'Fantastic views and great atmosphere.'
        ];
        const comment = comments[i % comments.length];
        const commentAr = `تجربة رائعة! أنصح بها بشدة.`;

        const reviewResult = await client.query(`
          INSERT INTO reviews (
            id,
            tenant_id,
            service_id,
            booking_id,
            customer_id,
            rating,
            comment,
            comment_ar,
            image_url,
            is_approved,
            is_visible
          ) VALUES (
            gen_random_uuid(),
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            true,
            true
          )
          RETURNING id
        `, [
          tenantId,
          serviceId,
          bookingId,
          userId,
          rating,
          comment,
          commentAr,
          reviewImageUrl
        ]);

        reviewIds.push(reviewResult.rows[0].id);
      }
    }

    console.log(`✅ Created ${bookingIds.length} bookings`);
    console.log(`✅ Created ${reviewIds.length} reviews\n`);

    await client.query('COMMIT');

    // ============================================================================
    // SUMMARY
    // ============================================================================
    console.log('\n=== SEEDING COMPLETE ===\n');
    console.log('SUMMARY:');
    console.log(`  ✅ Services created: ${serviceIds.length}`);
    console.log(`    - Services with discounts: ${servicesWithDiscounts.length}`);
    console.log(`  ✅ Users created: ${userIds.length}`);
    console.log(`  ✅ Bookings created: ${bookingIds.length}`);
    console.log(`  ✅ Reviews created: ${reviewIds.length}`);
    console.log('\nSERVICES WITH DISCOUNTS:');
    
    if (global.hasOriginalPrice && global.hasDiscountPercentage) {
      for (let i = 0; i < servicesWithDiscounts.length; i++) {
        const idx = servicesWithDiscounts[i];
        const serviceResult = await client.query(
          'SELECT name, base_price, original_price, discount_percentage FROM services WHERE id = $1',
          [serviceIds[idx]]
        );
        const service = serviceResult.rows[0];
        console.log(`  ${i + 1}. ${service.name}`);
        console.log(`     Original: ${service.original_price} SAR`);
        console.log(`     Current: ${service.base_price} SAR`);
        console.log(`     Discount: ${service.discount_percentage}%`);
      }
    } else {
      console.log('  (Discount columns not available in database)');
      for (let i = 0; i < servicesWithDiscounts.length; i++) {
        const idx = servicesWithDiscounts[i];
        const serviceResult = await client.query(
          'SELECT name, base_price FROM services WHERE id = $1',
          [serviceIds[idx]]
        );
        const service = serviceResult.rows[0];
        console.log(`  ${i + 1}. ${service.name} - Price: ${service.base_price} SAR`);
      }
    }

    console.log('\n✅ All data created successfully!\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error seeding data:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedData().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

