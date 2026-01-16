#!/usr/bin/env node

/**
 * Export Database Schema with Connection String
 * 
 * Uses the provided connection string to export schema via pg_dump
 */

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Connection string template
const CONNECTION_STRING_TEMPLATE = 'postgresql://postgres:[YOUR-PASSWORD]@db.pivmdulophbdciygvegx.supabase.co:5432/postgres';

async function exportSchema() {
  console.log('\n' + '='.repeat(70));
  console.log('DATABASE SCHEMA EXPORT');
  console.log('='.repeat(70) + '\n');
  
  // Get password from environment or prompt
  const password = process.env.SUPABASE_DB_PASSWORD || process.env.DATABASE_PASSWORD;
  
  if (!password) {
    console.log('⚠️  Password not found in environment variables');
    console.log('\nPlease set your database password:');
    console.log('  PowerShell: $env:SUPABASE_DB_PASSWORD = "your-password"');
    console.log('  CMD:        set SUPABASE_DB_PASSWORD=your-password');
    console.log('  Linux/Mac:  export SUPABASE_DB_PASSWORD=your-password');
    console.log('\nOr provide it as an argument:');
    console.log('  node database/export-schema-with-connection.js your-password\n');
    
    // Try to get from command line argument
    const args = process.argv.slice(2);
    if (args.length > 0) {
      const providedPassword = args[0];
      console.log('✅ Using password from command line argument\n');
      return runExport(providedPassword);
    }
    
    console.log('💡 Alternative: Use Supabase Dashboard');
    console.log('   1. Go to: https://supabase.com/dashboard');
    console.log('   2. Settings → Database');
    console.log('   3. Copy "Connection pooling" connection string (includes password)');
    console.log('   4. Use it directly with pg_dump\n');
    
    process.exit(1);
  }
  
  await runExport(password);
}

async function runExport(password) {
  const connectionString = CONNECTION_STRING_TEMPLATE.replace('[YOUR-PASSWORD]', password);
  
  // Mask password in logs
  const maskedConnection = connectionString.replace(/:[^:@]+@/, ':***@');
  console.log('📊 Connection:', maskedConnection);
  console.log('📊 Exporting schema...\n');
  
  // Check if pg_dump is available
  return new Promise((resolve, reject) => {
    const checkDump = spawn('pg_dump', ['--version'], { shell: true });
    
    checkDump.on('close', (code) => {
      if (code !== 0) {
        console.error('❌ pg_dump not found');
        console.log('\nPlease install PostgreSQL client tools:');
        console.log('  https://www.postgresql.org/download/windows/\n');
        console.log('Or use Supabase Dashboard method (see EXPORT_SCHEMA_INSTRUCTIONS.md)\n');
        reject(new Error('pg_dump not available'));
        return;
      }
      
      // Run pg_dump
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputPath = join(__dirname, 'complete_schema_' + timestamp + '.sql');
      
      console.log('Running pg_dump...');
      console.log('This may take a few moments...\n');
      
      const pgDump = spawn('pg_dump', [
        '--schema-only',
        '--no-owner',
        '--no-acl',
        '--clean',
        '--if-exists',
        connectionString
      ], {
        shell: true
      });
      
      let output = '';
      let errorOutput = '';
      
      pgDump.stdout.on('data', (data) => {
        output += data.toString();
        process.stdout.write('.');
      });
      
      pgDump.stderr.on('data', (data) => {
        const error = data.toString();
        errorOutput += error;
        // Only show non-warning errors
        if (!error.includes('WARNING') && !error.includes('NOTICE')) {
          process.stderr.write(error);
        }
      });
      
      pgDump.on('close', (code) => {
        console.log('\n');
        
        if (code === 0 && output.length > 0) {
          writeFileSync(outputPath, output, 'utf8');
          const fileSize = (output.length / 1024).toFixed(2);
          
          console.log('='.repeat(70));
          console.log('✅ SUCCESS: Schema exported!');
          console.log('='.repeat(70));
          console.log(`File: ${outputPath}`);
          console.log(`Size: ${fileSize} KB`);
          console.log('');
          resolve(true);
        } else {
          console.log('='.repeat(70));
          console.log('❌ Export failed');
          console.log('='.repeat(70));
          
          if (errorOutput) {
            console.log('\nError details:');
            console.log(errorOutput);
          }
          
          if (code !== 0) {
            console.log(`\nExit code: ${code}`);
          }
          
          if (output.length === 0) {
            console.log('\nNo output generated. Possible issues:');
            console.log('  - Incorrect password');
            console.log('  - Network connection issue');
            console.log('  - Database not accessible');
          }
          
          console.log('');
          reject(new Error('Export failed'));
        }
      });
    });
  });
}

exportSchema().catch(error => {
  console.error('\nFatal error:', error.message);
  process.exit(1);
});
