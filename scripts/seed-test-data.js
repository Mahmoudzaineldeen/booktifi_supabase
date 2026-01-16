// Script to seed test data into the database
import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
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

async function seedData() {
  const client = await pool.connect();
  
  try {
    console.log('\n=== SEEDING TEST DATA INTO DATABASE ===\n');
    
    await client.query('BEGIN');

    // ============================================================================
    // STEP 1: CREATE TEST TENANT
    // ============================================================================
    
    let result = await client.query(`
      INSERT INTO tenants (
        id,
        name,
        name_ar,
        slug,
        industry,
        contact_email,
        contact_phone,
        address,
        is_active,
        public_page_enabled,
        landing_page_settings
      ) VALUES (
        gen_random_uuid(),
        'Test Beauty Salon',
        'صالون التجميل التجريبي',
        'test-beauty-salon',
        'beauty',
        'test@beautysalon.com',
        '+966501234567',
        '123 Main Street, Riyadh, Saudi Arabia',
        true,
        true,
        $1
      )
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        name_ar = EXCLUDED.name_ar,
        is_active = true,
        public_page_enabled = true
      RETURNING id
    `, [JSON.stringify({
      hero_title: 'Welcome to Test Beauty Salon',
      hero_title_ar: 'مرحباً بكم في صالون التجميل التجريبي',
      hero_subtitle: 'Book your appointment online easily',
      hero_subtitle_ar: 'احجز موعدك بسهولة عبر الإنترنت',
      about_title: 'About Us',
      about_title_ar: 'معلومات عنا',
      about_description: 'We provide quality beauty services with professional staff',
      about_description_ar: 'نقدم خدمات تجميل عالية الجودة مع فريق محترف',
      primary_color: '#2563eb',
      secondary_color: '#3b82f6',
      contact_email: 'test@beautysalon.com',
      contact_phone: '+966501234567',
      show_services: true
    })]);

    const tenantId = result.rows[0].id;
    console.log('✅ Created tenant: Test Beauty Salon');

    // ============================================================================
    // STEP 2: CREATE TEST USERS
    // ============================================================================

    const adminPassword = await bcrypt.hash('admin123', 10);
    const receptionPassword = await bcrypt.hash('reception123', 10);
    const customerPassword = await bcrypt.hash('customer123', 10);

    // Create Tenant Admin (check if exists first)
    let adminCheck = await client.query(`
      SELECT id FROM users WHERE email = 'admin@testbeautysalon.com' OR username = 'testadmin' LIMIT 1
    `);
    
    let adminId;
    if (adminCheck.rows.length > 0) {
      adminId = adminCheck.rows[0].id;
      await client.query(`
        UPDATE users SET
          tenant_id = $1,
          role = 'tenant_admin',
          password_hash = $2,
          is_active = true
        WHERE id = $3
      `, [tenantId, adminPassword, adminId]);
    } else {
      const adminResult = await client.query(`
        INSERT INTO users (
          id,
          tenant_id,
          email,
          username,
          full_name,
          full_name_ar,
          phone,
          role,
          password_hash,
          is_active
        ) VALUES (
          gen_random_uuid(),
          $1,
          'admin@testbeautysalon.com',
          'testadmin',
          'Test Admin',
          'مدير الاختبار',
          '+966501234567',
          'tenant_admin',
          $2,
          true
        )
        RETURNING id
      `, [tenantId, adminPassword]);
      adminId = adminResult.rows[0].id;
    }

    console.log('✅ Created tenant admin user');

    // Create Receptionist (check if exists first)
    let receptionCheck = await client.query(`
      SELECT id FROM users WHERE email = 'reception@testbeautysalon.com' OR username = 'testreception' LIMIT 1
    `);
    
    let receptionId;
    if (receptionCheck.rows.length > 0) {
      receptionId = receptionCheck.rows[0].id;
      await client.query(`
        UPDATE users SET
          tenant_id = $1,
          role = 'receptionist',
          password_hash = $2,
          is_active = true
        WHERE id = $3
      `, [tenantId, receptionPassword, receptionId]);
    } else {
      const receptionResult = await client.query(`
        INSERT INTO users (
          id,
          tenant_id,
          email,
          username,
          full_name,
          full_name_ar,
          phone,
          role,
          password_hash,
          is_active
        ) VALUES (
          gen_random_uuid(),
          $1,
          'reception@testbeautysalon.com',
          'testreception',
          'Test Receptionist',
          'موظف الاستقبال',
          '+966501234568',
          'receptionist',
          $2,
          true
        )
        RETURNING id
      `, [tenantId, receptionPassword]);
      receptionId = receptionResult.rows[0].id;
    }

    console.log('✅ Created receptionist user');

    // Create Test Customers (check if exists first)
    const customerEmails = ['customer1@test.com', 'customer2@test.com'];
    const customerUsernames = ['testcustomer1', 'testcustomer2'];
    const customerIds = [];
    
    for (let i = 0; i < 2; i++) {
      let customerCheck = await client.query(`
        SELECT id FROM users WHERE email = $1 OR username = $2 LIMIT 1
      `, [customerEmails[i], customerUsernames[i]]);
      
      let customerId;
      if (customerCheck.rows.length > 0) {
        customerId = customerCheck.rows[0].id;
        await client.query(`
          UPDATE users SET
            tenant_id = $1,
            role = 'customer',
            password_hash = $2,
            is_active = true
          WHERE id = $3
        `, [tenantId, customerPassword, customerId]);
      } else {
      const customerResult = await client.query(`
        INSERT INTO users (
          id,
          tenant_id,
          email,
          username,
          full_name,
          full_name_ar,
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
          $6,
          'customer',
          $7,
          true
        )
        RETURNING id
      `, [
        tenantId,
        customerEmails[i],
        customerUsernames[i],
        `Test Customer ${i + 1}`,
        `عميل تجريبي ${i + 1}`,
        `+96650111111${i + 1}`,
        customerPassword
      ]);
      customerId = customerResult.rows[0].id;
      }
      customerIds.push(customerId);
    }

    console.log('✅ Created test customer users');

    // ============================================================================
    // STEP 3: CREATE SERVICE CATEGORIES
    // ============================================================================

    const categoryResult = await client.query(`
      INSERT INTO service_categories (
        id,
        tenant_id,
        name,
        name_ar,
        description,
        description_ar,
        display_order
      ) VALUES 
      (
        gen_random_uuid(),
        $1,
        'Hair Services',
        'خدمات الشعر',
        'Professional hair cutting and styling services',
        'خدمات قص وتصفيف الشعر الاحترافية',
        1
      ),
      (
        gen_random_uuid(),
        $1,
        'Beauty Treatments',
        'علاجات التجميل',
        'Facial and beauty treatment services',
        'خدمات العناية بالبشرة والتجميل',
        2
      ),
      (
        gen_random_uuid(),
        $1,
        'Nail Services',
        'خدمات الأظافر',
        'Manicure and pedicure services',
        'خدمات العناية بالأظافر',
        3
      )
      RETURNING id, name
    `, [tenantId]);

    const categories = {};
    categoryResult.rows.forEach(row => {
      categories[row.name] = row.id;
    });
    console.log('✅ Created service categories');

    // ============================================================================
    // STEP 4: CREATE SERVICES
    // ============================================================================

    const services = [
      {
        category: 'Hair Services',
        name: 'Haircut',
        name_ar: 'قص الشعر',
        description: 'Professional haircut for men and women',
        description_ar: 'قص شعر احترافي للرجال والنساء',
        duration: 30,
        price: 50.00
      },
      {
        category: 'Hair Services',
        name: 'Hair Styling',
        name_ar: 'تصفيف الشعر',
        description: 'Professional hair styling and blow dry',
        description_ar: 'تصفيف وتجفيف الشعر الاحترافي',
        duration: 45,
        price: 80.00
      },
      {
        category: 'Hair Services',
        name: 'Hair Color',
        name_ar: 'صبغة الشعر',
        description: 'Full hair coloring service',
        description_ar: 'خدمة صبغة الشعر الكاملة',
        duration: 120,
        price: 200.00
      },
      {
        category: 'Beauty Treatments',
        name: 'Facial Treatment',
        name_ar: 'علاج الوجه',
        description: 'Deep cleansing facial treatment',
        description_ar: 'علاج تنظيف الوجه العميق',
        duration: 60,
        price: 150.00
      },
      {
        category: 'Beauty Treatments',
        name: 'Eyebrow Threading',
        name_ar: 'خيط الحواجب',
        description: 'Professional eyebrow threading',
        description_ar: 'خيط الحواجب الاحترافي',
        duration: 15,
        price: 30.00
      },
      {
        category: 'Nail Services',
        name: 'Manicure',
        name_ar: 'مانيكير',
        description: 'Professional manicure service',
        description_ar: 'خدمة مانيكير احترافية',
        duration: 45,
        price: 60.00
      },
      {
        category: 'Nail Services',
        name: 'Pedicure',
        name_ar: 'باديكير',
        description: 'Professional pedicure service',
        description_ar: 'خدمة باديكير احترافية',
        duration: 60,
        price: 80.00
      }
    ];

    const serviceIds = [];
    for (const service of services) {
        const serviceResult = await client.query(`
          INSERT INTO services (
          id,
          tenant_id,
          category_id,
          name,
          name_ar,
          description,
          description_ar,
          duration_minutes,
          base_price,
          capacity_per_slot,
          capacity_mode,
          service_duration_minutes,
          service_capacity_per_slot,
          is_public,
          is_active
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
          1,
          'service_based',
          $7,
          1,
          true,
          true
        )
        RETURNING id
      `, [
        tenantId,
        categories[service.category],
        service.name,
        service.name_ar,
        service.description,
        service.description_ar,
        service.duration,
        service.price
      ]);
      
      serviceIds.push(serviceResult.rows[0].id);
    }
    console.log(`✅ Created ${services.length} test services`);

    // ============================================================================
    // STEP 5: CREATE SHIFTS
    // ============================================================================

    // Create shifts for each service
    // Monday to Friday: 9 AM - 6 PM
    for (const serviceId of serviceIds) {
      await client.query(`
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
          $3,
          '09:00:00'::time,
          '18:00:00'::time,
          true
        )
        ON CONFLICT DO NOTHING
      `, [tenantId, serviceId, [1,2,3,4,5]]);

      // Saturday: 10 AM - 4 PM
      await client.query(`
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
          $3,
          '10:00:00'::time,
          '16:00:00'::time,
          true
        )
        ON CONFLICT DO NOTHING
      `, [tenantId, serviceId, [6]]);
    }
    console.log('✅ Created shifts for all services');

    // ============================================================================
    // STEP 6: CREATE MANUAL SLOTS FOR TESTING
    // ============================================================================

    // Get first shift for creating test slots
    const shiftResult = await client.query(`
      SELECT 
        sh.id as shift_id,
        srv.id as service_id,
        srv.duration_minutes,
        srv.service_capacity_per_slot
      FROM shifts sh
      JOIN services srv ON sh.service_id = srv.id
      WHERE sh.tenant_id = $1
      LIMIT 1
    `, [tenantId]);

    let totalSlots = 0;

    if (shiftResult.rows.length > 0) {
      const shift = shiftResult.rows[0];
      const capacity = shift.service_capacity_per_slot || 1;
      
      // Create slots for today and next 7 days, every 2 hours from 9 AM to 6 PM
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const slotDate = new Date();
        slotDate.setDate(slotDate.getDate() + dayOffset);
        const dateStr = slotDate.toISOString().split('T')[0];
        
        // Create slots from 9 AM to 6 PM, every 2 hours
        const timeSlots = ['09:00:00', '11:00:00', '13:00:00', '15:00:00', '17:00:00'];
        
        for (const startTime of timeSlots) {
          const [hours, minutes] = startTime.split(':').map(Number);
          const startDateTime = new Date(slotDate);
          startDateTime.setHours(hours, minutes, 0, 0);
          
          const endDateTime = new Date(startDateTime);
          endDateTime.setMinutes(endDateTime.getMinutes() + shift.duration_minutes);
          
          const startTimeStr = startTime;
          const endTimeStr = endDateTime.toTimeString().substring(0, 8);
          const startTimeUtc = startDateTime.toISOString();
          const endTimeUtc = endDateTime.toISOString();
          
          try {
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
              shift.shift_id,
              dateStr,
              startTimeStr,
              endTimeStr,
              startTimeUtc,
              endTimeUtc,
              capacity
            ]);
            totalSlots++;
          } catch (err) {
            // Ignore errors for now
            if (!err.message.includes('duplicate') && !err.message.includes('unique') && !err.message.includes('aborted')) {
              console.warn(`Warning creating slot:`, err.message);
            }
          }
        }
      }
    }
    console.log(`✅ Created ${totalSlots} test time slots for next 7 days`);

    // ============================================================================
    // STEP 7: CREATE TEST BOOKINGS
    // ============================================================================

    // Get available slots
    const slotQueryResult = await client.query(`
      SELECT s.id as slot_id, srv.id as service_id
      FROM slots s
      JOIN shifts sh ON s.shift_id = sh.id
      JOIN services srv ON sh.service_id = srv.id
      WHERE s.tenant_id = $1
        AND s.slot_date >= CURRENT_DATE
        AND s.available_capacity > 0
      ORDER BY s.slot_date, s.start_time
      LIMIT 10
    `, [tenantId]);

    const availableSlots = slotQueryResult.rows;
    let bookingsCreated = 0;

    for (let i = 0; i < Math.min(5, availableSlots.length); i++) {
      const slot = availableSlots[i];
      const customerId = i < 2 ? customerIds[0] : null; // First 2 bookings linked to customer

      await client.query(`
        INSERT INTO bookings (
          id,
          tenant_id,
          service_id,
          slot_id,
          customer_id,
          customer_name,
          customer_phone,
          customer_email,
          visitor_count,
          total_price,
          status,
          payment_status,
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
          1,
          (SELECT base_price FROM services WHERE id = $2),
          $8,
          $9,
          $10
        )
      `, [
        tenantId,
        slot.service_id,
        slot.slot_id,
        customerId,
        `Test Customer ${i + 1}`,
        `+96650111111${i + 1}`,
        `customer${i + 1}@test.com`,
        i === 0 ? 'confirmed' : i === 1 ? 'checked_in' : i === 2 ? 'completed' : 'pending',
        i === 2 || i === 4 ? 'paid' : 'unpaid',
        receptionId
      ]);

      // Update slot capacity
      await client.query(`
        UPDATE slots 
        SET booked_count = booked_count + 1,
            available_capacity = original_capacity - booked_count
        WHERE id = $1
      `, [slot.slot_id]);

      bookingsCreated++;
    }
    console.log(`✅ Created ${bookingsCreated} test bookings`);

    // ============================================================================
    // STEP 8: CREATE TEST REVIEWS
    // ============================================================================

    // Create a review for completed booking
    const reviewQueryResult = await client.query(`
      SELECT b.id, b.service_id, b.customer_id
      FROM bookings b
      WHERE b.tenant_id = $1
        AND b.status = 'completed'
        AND b.customer_id IS NOT NULL
      LIMIT 1
    `, [tenantId]);

    if (reviewQueryResult.rows.length > 0) {
      const booking = reviewQueryResult.rows[0];
      await client.query(`
        INSERT INTO reviews (
          id,
          tenant_id,
          service_id,
          booking_id,
          customer_id,
          rating,
          comment,
          comment_ar,
          is_approved,
          is_visible
        ) VALUES (
          gen_random_uuid(),
          $1,
          $2,
          $3,
          $4,
          5,
          'Great service! Very professional staff.',
          'خدمة رائعة! فريق محترف جداً.',
          true,
          true
        )
        ON CONFLICT DO NOTHING
      `, [tenantId, booking.service_id, booking.id, booking.customer_id]);
      console.log('✅ Created test review');
    }

    // ============================================================================
    // STEP 9: CREATE CUSTOMER RECORDS
    // ============================================================================

    await client.query(`
      INSERT INTO customers (
        id,
        tenant_id,
        phone,
        name,
        email,
        total_bookings,
        last_booking_at
      )
      SELECT 
        gen_random_uuid(),
        $1,
        customer_phone,
        customer_name,
        customer_email,
        1,
        created_at
      FROM bookings
      WHERE tenant_id = $1
        AND customer_phone IS NOT NULL
      ON CONFLICT (tenant_id, phone) DO UPDATE SET
        total_bookings = customers.total_bookings + 1,
        last_booking_at = EXCLUDED.last_booking_at
    `, [tenantId]);
    console.log('✅ Created customer records');

    await client.query('COMMIT');

    console.log('\n========================================');
    console.log('✅ TEST DATA SEEDING COMPLETE!');
    console.log('========================================\n');
    console.log('📋 Test Tenant:');
    console.log('   Slug: test-beauty-salon');
    console.log('   Name: Test Beauty Salon\n');
    console.log('👤 Test Users:');
    console.log('   Admin: admin@testbeautysalon.com / testadmin');
    console.log('   Password: admin123');
    console.log('   Reception: reception@testbeautysalon.com / testreception');
    console.log('   Password: reception123');
    console.log('   Customer 1: customer1@test.com / testcustomer1');
    console.log('   Password: customer123');
    console.log('   Customer 2: customer2@test.com / testcustomer2');
    console.log('   Password: customer123\n');
    console.log('🔗 Direct Links:');
    console.log('   Customer Landing: http://localhost:5173/test-beauty-salon/customer');
    console.log('   Booking Page: http://localhost:5173/test-beauty-salon/book');
    console.log('   Admin Dashboard: http://localhost:5173/test-beauty-salon/admin');
    console.log('   Reception: http://localhost:5173/test-beauty-salon/reception\n');
    console.log('📊 Created:');
    console.log('   - 1 Tenant');
    console.log('   - 4 Users (1 admin, 1 reception, 2 customers)');
    console.log('   - 3 Service Categories');
    console.log('   - 7 Services');
    console.log('   - Multiple Shifts');
    console.log('   - Slots for next 30 days');
    console.log(`   - ${bookingsCreated} Test Bookings`);
    console.log('   - 1 Review');
    console.log('   - Customer records\n');
    console.log('========================================\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error seeding data:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedData().catch(console.error);

