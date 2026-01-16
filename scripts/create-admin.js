// Script to create admin user
import bcrypt from 'bcryptjs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

async function createAdmin() {
  try {
    const email = 'mahmoudnzaineldeen@gmail.com';
    const username = 'mahmoudzaineldeen';
    const password = '1111';
    const fullName = 'mahmoudzaineldeen';
    const role = 'solution_owner';

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    console.log('Password hashed successfully');

    // Check if user already exists
    const checkUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (checkUser.rows.length > 0) {
      console.log('❌ User already exists with this email or username');
      process.exit(1);
    }

    // Insert user
    const result = await pool.query(
      `INSERT INTO users (
        id,
        email,
        username,
        full_name,
        role,
        tenant_id,
        password_hash,
        is_active
      )
      VALUES (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        $4,
        NULL,
        $5,
        true
      )
      RETURNING id, email, username, full_name, role`,
      [email, username, fullName, role, passwordHash]
    );

    const user = result.rows[0];
    console.log('\n✅ Admin user created successfully!');
    console.log('========================================');
    console.log('User ID:', user.id);
    console.log('Email:', user.email);
    console.log('Username:', user.username);
    console.log('Full Name:', user.full_name);
    console.log('Role:', user.role);
    console.log('========================================\n');

    await pool.end();
  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
    process.exit(1);
  }
}

createAdmin();

