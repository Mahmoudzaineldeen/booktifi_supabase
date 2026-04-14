import { supabase } from '../src/db';

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) throw new Error('Usage: npx tsx scripts/inspect-tenant-daftra-settings.ts <tenantId>');
  const { data, error } = await supabase
    .from('tenants')
    .select('id,name,updated_at,daftra_settings')
    .eq('id', tenantId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message || 'Tenant not found');
  console.log(JSON.stringify(data, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
