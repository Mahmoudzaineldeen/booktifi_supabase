/**
 * Ensures user lamia@ht.com exists and can log in with password "lamia123".
 * Run from project root: npx tsx server/scripts/ensure-lamia-user.ts
 * Or from server: npx tsx scripts/ensure-lamia-user.ts
 */
import { supabase } from '../src/db';
import bcrypt from 'bcryptjs';

const EMAIL = 'lamia@ht.com';
const PASSWORD = 'lamia123';
const FULL_NAME = 'Lamia';

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const { data: existing } = await supabase
    .from('users')
    .select('id, email, full_name, role, tenant_id')
    .eq('email', EMAIL)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('users')
      .update({ password_hash: passwordHash, is_active: true })
      .eq('id', existing.id);

    if (error) {
      console.error('Failed to update password:', error.message);
      process.exit(1);
    }
    console.log('User already exists. Password set to:', PASSWORD);
    console.log('  Email:', EMAIL);
    console.log('  Role:', existing.role);
    console.log('  Tenant ID:', existing.tenant_id ?? 'null');
    return;
  }

  // Get first tenant so the user can log in as tenant_admin
  const { data: firstTenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      id: crypto.randomUUID(),
      email: EMAIL,
      username: EMAIL.split('@')[0],
      full_name: FULL_NAME,
      role: firstTenant ? 'tenant_admin' : 'solution_owner',
      tenant_id: firstTenant?.id ?? null,
      password_hash: passwordHash,
      is_active: true,
    })
    .select('id, email, role, tenant_id')
    .single();

  if (error) {
    console.error('Failed to create user:', error.message);
    process.exit(1);
  }

  console.log('User created. You can log in with:');
  console.log('  Email:', EMAIL);
  console.log('  Password:', PASSWORD);
  console.log('  Role:', newUser.role);
  console.log('  Tenant ID:', newUser.tenant_id ?? 'null');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
