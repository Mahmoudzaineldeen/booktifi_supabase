#!/usr/bin/env node

/**
 * Update Supabase Environment Variables
 * 
 * This script updates .env files with the new Supabase credentials
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// New Supabase credentials
const SUPABASE_URL = 'https://pivmdulophbdciygvegx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpdm1kdWxvcGhiZGNpeWd2ZWd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1MTA4MzIsImV4cCI6MjA4NDA4NjgzMn0.M-WftT2tjG0cWYSMWgvbJGV9UWKc889kUJPm77PFjA0';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpdm1kdWxvcGhiZGNpeWd2ZWd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODUxMDgzMiwiZXhwIjoyMDg0MDg2ODMyfQ.HHoaJESYPmbbfA_g95WxcBkSzPzL9RG7Jp7CyNlmoZY';

function updateEnvFile(filePath, isServer = false) {
  let content = '';
  
  // Read existing file if it exists
  if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf8');
  }
  
  // Remove old Supabase/PostgreSQL variables
  const linesToRemove = [
    /^.*SUPABASE.*$/gm,
    /^.*VITE_SUPABASE.*$/gm,
    /^.*DATABASE_URL.*$/gm,
    /^.*POSTGRES.*$/gm,
    /^.*PG.*$/gm,
  ];
  
  linesToRemove.forEach(regex => {
    content = content.replace(regex, '');
  });
  
  // Remove empty lines (more than 2 consecutive)
  content = content.replace(/\n{3,}/g, '\n\n');
  
  // Add new Supabase configuration
  const newConfig = isServer ? `
# Supabase Configuration (Backend)
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}

# Server Configuration
PORT=3001
NODE_ENV=development
JWT_SECRET=${process.env.JWT_SECRET || 'change-this-in-production'}
APP_URL=http://localhost:5173

# API Configuration
VITE_API_URL=http://localhost:3001/api
` : `
# Supabase Configuration (Frontend)
VITE_SUPABASE_URL=${SUPABASE_URL}
VITE_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}

# Supabase Configuration (Backend - for server/.env copy)
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}

# API Configuration
VITE_API_URL=http://localhost:3001/api
`;

  // Append new config (remove leading newline)
  content = content.trim() + newConfig;
  
  // Write file
  writeFileSync(filePath, content.trim() + '\n', 'utf8');
  console.log(`✅ Updated: ${filePath}`);
}

// Update root .env
const rootEnvPath = join(rootDir, '.env');
updateEnvFile(rootEnvPath, false);

// Update server/.env
const serverEnvPath = join(rootDir, 'server', '.env');
updateEnvFile(serverEnvPath, true);

console.log('\n✅ Environment files updated successfully!');
console.log('\n📝 Next steps:');
console.log('   1. Run: npm install');
console.log('   2. Run: npm run dev');
console.log('   3. Verify both frontend and backend start successfully\n');
