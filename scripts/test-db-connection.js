#!/usr/bin/env node

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../server/.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function test() {
  console.log('Testing database connection...');
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');
  
  try {
    const client = await pool.connect();
    console.log('✅ Connected to database');
    
    const result = await client.query('SELECT COUNT(*) FROM services');
    console.log(`Found ${result.rows[0].count} services`);
    
    const shiftsResult = await client.query('SELECT COUNT(*) FROM shifts');
    console.log(`Found ${shiftsResult.rows[0].count} shifts`);
    
    client.release();
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

test();


