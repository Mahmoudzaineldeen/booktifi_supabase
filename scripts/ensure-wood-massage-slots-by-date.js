/**
 * Call POST /bookings/ensure-employee-based-slots for Wood Massage and print slot times.
 *
 * Usage:
 *   node scripts/ensure-wood-massage-slots-by-date.js [YYYY-MM-DD]
 * Default date: 2026-04-01
 *
 * Requires:
 *   VITE_API_URL or API_URL — e.g. https://…/api or http://localhost:3001/api
 *
 * Tenant + service IDs (pick one):
 *   1) Set TENANT_ID and SERVICE_ID in .env (recommended if no DB URL), or
 *   2) Set DATABASE_URL — script resolves tenant by healingtouches_sa@hotmail.com + service "Wood Massage", or
 *   3) If neither: uses built-in defaults from project backup (Healing Touch tenant / Wood Massage).
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

const TENANT_EMAIL = 'healingtouches_sa@hotmail.com';
const SERVICE_NAME = 'Wood Massage';

/** Fallback when DATABASE_URL and TENANT_ID/SERVICE_ID are not set (from backups/tenant-backup-healingtouch-*.json) */
const DEFAULT_TENANT_ID = 'dc09d588-c179-417a-b1bb-7f4c7d25145b';
const DEFAULT_SERVICE_ID = 'b8725228-63ee-40f1-a8a3-2060b4ef0303';

function getApiBase() {
  const url = process.env.VITE_API_URL || process.env.API_URL || '';
  if (!url) return '';
  return url.endsWith('/api') ? url : `${url.replace(/\/$/, '')}/api`;
}

async function resolveTenantAndServiceId() {
  const fromEnv =
    process.env.TENANT_ID ||
    process.env.WOOD_MASSAGE_TENANT_ID ||
    process.env.HEALINGTOUCHES_TENANT_ID;
  const svcFromEnv = process.env.SERVICE_ID || process.env.WOOD_MASSAGE_SERVICE_ID;
  if (fromEnv && svcFromEnv) {
    console.log('Using TENANT_ID / SERVICE_ID from environment.');
    return { tenantId: fromEnv, serviceId: svcFromEnv, tenantName: null, serviceMeta: null };
  }

  const cs = process.env.DATABASE_URL;
  if (cs) {
    const pool = new Pool({
      connectionString: cs,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
    const client = await pool.connect();
    try {
      const t = await client.query(`SELECT id, name FROM tenants WHERE contact_email = $1 LIMIT 1`, [
        TENANT_EMAIL,
      ]);
      if (t.rows.length === 0) {
        console.error('No tenant for contact_email:', TENANT_EMAIL);
        process.exit(1);
      }
      const tenantId = t.rows[0].id;
      const s = await client.query(
        `SELECT id, name, service_duration_minutes, duration_minutes FROM services
         WHERE tenant_id = $1 AND name ILIKE $2 LIMIT 1`,
        [tenantId, SERVICE_NAME]
      );
      if (s.rows.length === 0) {
        console.error('No service named like:', SERVICE_NAME);
        process.exit(1);
      }
      return {
        tenantId,
        serviceId: s.rows[0].id,
        tenantName: t.rows[0].name,
        serviceMeta: s.rows[0],
      };
    } finally {
      client.release();
      await pool.end();
    }
  }

  console.log(
    'No DATABASE_URL and no TENANT_ID+SERVICE_ID — using default Healing Touch / Wood Massage UUIDs from repo backup.'
  );
  console.log('Set TENANT_ID and SERVICE_ID in .env if this is the wrong tenant.\n');
  return {
    tenantId: DEFAULT_TENANT_ID,
    serviceId: DEFAULT_SERVICE_ID,
    tenantName: null,
    serviceMeta: null,
  };
}

async function main() {
  const dateStr = process.argv[2] || '2026-04-01';
  const base = getApiBase();
  if (!base) {
    console.error('Set VITE_API_URL or API_URL (e.g. http://localhost:3001/api).');
    process.exit(1);
  }

  const resolved = await resolveTenantAndServiceId();
  const { tenantId, serviceId } = resolved;
  if (resolved.tenantName) console.log('Tenant:', resolved.tenantName);
  console.log('tenantId:', tenantId);
  console.log('serviceId:', serviceId);
  if (resolved.serviceMeta) {
    console.log('Service:', resolved.serviceMeta.name);
    console.log(
      'Duration (min):',
      resolved.serviceMeta.service_duration_minutes ??
        resolved.serviceMeta.duration_minutes ??
        '(default)'
    );
  }

  console.log('\nDate:', dateStr);
  console.log('POST', `${base}/bookings/ensure-employee-based-slots\n`);

  const res = await fetch(`${base}/bookings/ensure-employee-based-slots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId, serviceId, date: dateStr }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    console.error('Non-JSON response', res.status, text.slice(0, 500));
    process.exit(1);
  }

  if (!res.ok) {
    console.error('HTTP', res.status, body);
    process.exit(1);
  }

  const slots = body.slots || [];
  const employees = body.employees || [];
  console.log('shiftIds:', body.shiftIds);
  console.log('Total slots in response:', slots.length);
  if (employees.length > 0) {
    for (const e of employees) {
      const list = e.available_slots || [];
      console.log(`\n--- ${e.name || e.id} (${list.length} slots) ---`);
      list.forEach((sl, i) => {
        console.log(`  ${i + 1}. ${String(sl.start_time).slice(0, 8)} – ${String(sl.end_time).slice(0, 8)}`);
      });
    }
  } else {
    slots.forEach((sl, i) => {
      console.log(
        `  ${i + 1}. ${String(sl.start_time).slice(0, 8)} – ${String(sl.end_time).slice(0, 8)} id=${sl.id}`
      );
    });
  }
  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
