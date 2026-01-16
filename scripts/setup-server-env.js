#!/usr/bin/env node
/**
 * Cross-platform script to copy .env to server/.env
 * Works on Windows, Linux, and macOS
 */

const fs = require('fs');
const path = require('path');

const rootEnvPath = path.join(__dirname, '..', '.env');
const serverEnvPath = path.join(__dirname, '..', 'server', '.env');

try {
  // Check if root .env exists
  if (fs.existsSync(rootEnvPath)) {
    // Copy .env to server/.env
    fs.copyFileSync(rootEnvPath, serverEnvPath);
    console.log('✅ Copied .env to server/.env');
  } else {
    console.log('ℹ️  .env file not found in root, skipping copy');
    console.log('   Server will use its own .env file if it exists');
  }
} catch (error) {
  // Don't fail the build if .env doesn't exist or copy fails
  console.warn('⚠️  Could not copy .env file:', error.message);
  console.log('   Continuing anyway - server may use its own .env');
}
