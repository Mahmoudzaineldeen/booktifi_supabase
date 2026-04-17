import { supabase } from '../db';
import { logger } from '../utils/logger';

const DEFAULT_INTERVAL_MS = 60_000;

let intervalRef: NodeJS.Timeout | null = null;

export function startExpireTenantTrialsJob() {
  if (intervalRef) return;

  const raw = process.env.TENANT_TRIAL_EXPIRY_INTERVAL_MS;
  const intervalMs = raw ? Math.max(10_000, parseInt(raw, 10) || DEFAULT_INTERVAL_MS) : DEFAULT_INTERVAL_MS;

  logger.info('Starting tenant trial expiry job', undefined, { intervalMs });

  void runExpireOnce();

  intervalRef = setInterval(() => {
    void runExpireOnce();
  }, intervalMs);
}

export function stopExpireTenantTrialsJob() {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = null;
    logger.info('Stopped tenant trial expiry job');
  }
}

async function runExpireOnce() {
  try {
    const { data, error } = await supabase.rpc('expire_due_tenant_trials');
    if (error) {
      if (!String(error.message || '').includes('fetch failed')) {
        logger.error('expire_due_tenant_trials RPC failed', error);
      }
      return;
    }
    const n = typeof data === 'number' ? data : Number(data);
    if (Number.isFinite(n) && n > 0) {
      logger.info('Expired tenant trials', undefined, { count: n });
    }
  } catch (e: any) {
    if (!String(e?.message || '').includes('fetch failed')) {
      logger.error('expire_due_tenant_trials exception', e);
    }
  }
}
