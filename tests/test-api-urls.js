/**
 * Test TASK 1: Railway Backend
 * Verifies all API calls use Railway backend
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function testRailwayBackend() {
  console.log('🧪 Testing Railway Backend Configuration (TASK 1)\n');

  // Test 1: Check apiUrl.ts
  console.log('Test 1: Checking src/lib/apiUrl.ts');
  const apiUrlPath = path.join(__dirname, '../src/lib/apiUrl.ts');
  if (fs.existsSync(apiUrlPath)) {
    const content = fs.readFileSync(apiUrlPath, 'utf8');
    const hasRailway = content.includes('booktifisupabase-production.up.railway.app');
    const hasLocalhost = content.includes('localhost:3001') && !content.includes('// Local development');
    
    if (hasRailway) {
      console.log('✅ Railway URL found in apiUrl.ts');
    } else {
      console.log('❌ Railway URL not found in apiUrl.ts');
    }

    if (!hasLocalhost) {
      console.log('✅ No localhost:3001 in production code');
    } else {
      console.log('⚠️  localhost:3001 found (may be in comments)');
    }
  } else {
    console.log('❌ apiUrl.ts not found');
  }

  // Test 2: Check for hardcoded localhost in src files
  console.log('\nTest 2: Checking for hardcoded localhost in src/');
  const srcPath = path.join(__dirname, '../src');
  const files = getAllFiles(srcPath);
  let foundLocalhost = false;

  files.forEach(file => {
    if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
      const content = fs.readFileSync(file, 'utf8');
      // Check for localhost:3001 (excluding comments and test files)
      if (content.includes('localhost:3001') && !file.includes('test') && !file.includes('Test')) {
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          if (line.includes('localhost:3001') && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
            console.log(`⚠️  Found localhost:3001 in ${file}:${index + 1}`);
            foundLocalhost = true;
          }
        });
      }
    }
  });

  if (!foundLocalhost) {
    console.log('✅ No hardcoded localhost:3001 found in src/');
  }

  // Test 3: Verify getApiUrl function
  console.log('\nTest 3: Verifying getApiUrl function structure');
  const apiUrlContent = fs.readFileSync(apiUrlPath, 'utf8');
  if (apiUrlContent.includes('export function getApiUrl()')) {
    console.log('✅ getApiUrl function exists');
  } else {
    console.log('❌ getApiUrl function not found');
  }

  if (apiUrlContent.includes('VITE_API_URL')) {
    console.log('✅ VITE_API_URL environment variable support');
  } else {
    console.log('⚠️  VITE_API_URL not found');
  }

  console.log('\n✅ Railway Backend Tests Complete\n');
}

function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach(file => {
    const filePath = path.join(dirPath, file);
    if (fs.statSync(filePath).isDirectory()) {
      arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
    } else {
      arrayOfFiles.push(filePath);
    }
  });

  return arrayOfFiles;
}

// Run tests
testRailwayBackend();
