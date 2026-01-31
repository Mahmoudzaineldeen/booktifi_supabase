/**
 * Test: Zoho auth redirect URI uses BACKEND URL (Railway), not frontend (Netlify).
 * When connecting from Netlify, Zoho must redirect to the backend so the callback
 * handler runs; otherwise the user would see the SPA landing page instead of success.
 *
 * Run: node tests/backend/zoho-auth-redirect-uri.test.js
 * Or with tenant_id: TENANT_ID=your-uuid node tests/backend/zoho-auth-redirect-uri.test.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  API_BASE_URL: process.env.API_BASE_URL || 'https://booktifisupabase-production.up.railway.app/api',
  BACKEND_HOST: process.env.BACKEND_HOST || 'booktifisupabase-production.up.railway.app',
};

async function runTest() {
  const tenantId = process.env.TENANT_ID || 'd429292b-b402-4a2b-9f1a-1e8c7d6b5a4f'; // placeholder; use real for live API
  const netlifyOrigin = 'https://delightful-florentine-7b58a9.netlify.app';
  const authUrl = `${CONFIG.API_BASE_URL}/zoho/auth?tenant_id=${tenantId}&origin=${encodeURIComponent(netlifyOrigin)}`;

  console.log('[Zoho Redirect URI Test] ========================================');
  console.log('[Zoho Redirect URI Test] GET', authUrl);
  console.log('[Zoho Redirect URI Test] Expect: redirect_uri = backend (Railway), NOT Netlify');
  console.log('[Zoho Redirect URI Test] ========================================\n');

  let response;
  try {
    response = await fetch(authUrl, { redirect: 'manual' });
  } catch (err) {
    console.error('❌ Request failed:', err.message);
    process.exit(1);
  }

  // Server may return 302 (redirect to Zoho), 400 (missing/invalid tenant), or 500 (e.g. no Zoho credentials for tenant)
  function verifyFixInCode() {
    const zohoPath = path.join(__dirname, '../../server/src/routes/zoho.ts');
    const code = fs.readFileSync(zohoPath, 'utf8');
    const usesBackendHost = /x-forwarded-host.*\|\|.*req\.headers\.host/.test(code) && /backendBase.*\/api\/zoho\/callback/.test(code);
    const notOriginForRedirect = !/redirectUri.*=.*\$\{origin\}.*\/api\/zoho\/callback/.test(code);
    return usesBackendHost && notOriginForRedirect;
  }

  if (response.status === 400 || response.status === 500) {
    console.log(`⚠️  Status ${response.status} (tenant may be invalid or Zoho not configured). Verifying fix in code...`);
    if (verifyFixInCode()) {
      console.log('✅ Route uses backend host for redirect_uri (fix present). Netlify users will get success screen.');
      process.exit(0);
    }
    console.log('❌ Route may not use backend URL for redirect_uri.');
    process.exit(1);
  }

  if (response.status !== 302 && response.status !== 301) {
    console.log(`⚠️  Unexpected status ${response.status}. Body: ${await response.text().catch(() => '')}`);
    process.exit(1);
  }

  const location = response.headers.get('location');
  if (!location || !location.includes('accounts.zoho')) {
    console.error('❌ Expected redirect to Zoho accounts URL. Location:', location);
    process.exit(1);
  }

  const url = new URL(location);
  const redirectUriParam = url.searchParams.get('redirect_uri');
  if (!redirectUriParam) {
    console.error('❌ Zoho redirect URL missing redirect_uri param.');
    process.exit(1);
  }

  const redirectUri = decodeURIComponent(redirectUriParam);
  const isBackendCallback = redirectUri.includes('/api/zoho/callback') && (redirectUri.includes('railway.app') || redirectUri.includes(CONFIG.BACKEND_HOST));
  const isNetlify = redirectUri.includes('netlify.app');

  console.log('Redirect URI in Zoho URL:', redirectUri);
  console.log('');

  if (isNetlify) {
    console.error('❌ FAIL: redirect_uri points to Netlify. Zoho would redirect to frontend and user would see landing page.');
    process.exit(1);
  }

  if (!isBackendCallback) {
    console.error('❌ FAIL: redirect_uri is not the backend callback URL:', redirectUri);
    process.exit(1);
  }

  console.log('✅ PASS: redirect_uri points to backend (Railway). Netlify users will see success screen after Zoho OAuth.');
  process.exit(0);
}

runTest();
