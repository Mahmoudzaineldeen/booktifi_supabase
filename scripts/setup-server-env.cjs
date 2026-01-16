#!/usr/bin/env node
/**
 * Cross-platform script to merge .env to server/.env
 * Works on Windows, Linux, and macOS
 * Preserves SUPABASE_SERVICE_ROLE_KEY if it exists in server/.env
 */

const fs = require('fs');
const path = require('path');

const rootEnvPath = path.join(__dirname, '..', '.env');
const serverEnvPath = path.join(__dirname, '..', 'server', '.env');

try {
  let serverEnvContent = '';
  let preservedServiceRoleKey = '';
  
  // Read existing server/.env to preserve SUPABASE_SERVICE_ROLE_KEY
  if (fs.existsSync(serverEnvPath)) {
    serverEnvContent = fs.readFileSync(serverEnvPath, 'utf8');
    const serviceRoleMatch = serverEnvContent.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);
    if (serviceRoleMatch) {
      preservedServiceRoleKey = serviceRoleMatch[1];
    }
  }
  
  // Check if root .env exists
  if (fs.existsSync(rootEnvPath)) {
    let rootEnvContent = fs.readFileSync(rootEnvPath, 'utf8');
    
    // If we preserved a service role key, ensure it's in the merged content
    if (preservedServiceRoleKey) {
      // Remove any existing SUPABASE_SERVICE_ROLE_KEY from root content
      rootEnvContent = rootEnvContent.replace(/^SUPABASE_SERVICE_ROLE_KEY=.*$/gm, '');
      // Add the preserved one
      if (!rootEnvContent.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        rootEnvContent += `\nSUPABASE_SERVICE_ROLE_KEY=${preservedServiceRoleKey}\n`;
      }
    }
    
    // Write merged content to server/.env
    fs.writeFileSync(serverEnvPath, rootEnvContent, 'utf8');
    console.log('✅ Merged .env to server/.env' + (preservedServiceRoleKey ? ' (preserved SERVICE_ROLE_KEY)' : ''));
  } else {
    console.log('ℹ️  .env file not found in root, skipping copy');
    console.log('   Server will use its own .env file if it exists');
  }
} catch (error) {
  // Don't fail the build if .env doesn't exist or copy fails
  console.warn('⚠️  Could not copy .env file:', error.message);
  console.log('   Continuing anyway - server may use its own .env');
}

// Always exit successfully to not break the npm script chain
process.exit(0);