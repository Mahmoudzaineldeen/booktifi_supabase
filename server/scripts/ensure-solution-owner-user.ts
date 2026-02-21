/**
 * Ensures solution owner super@gmail.com exists and can log in with password "111111".
 * Run from project root: npx tsx server/scripts/ensure-solution-owner-user.ts
 * Or from server: npx tsx scripts/ensure-solution-owner-user.ts
 */
import { supabase } from '../src/db';
import bcrypt from 'bcryptjs';

const EMAIL = 'super@gmail.com';
const PASSWORD = '111111';
const FULL_NAME = 'Solution Owner';

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
      .update({
        password_hash: passwordHash,
        is_active: true,
        role: 'solution_owner',
        tenant_id: null,
        full_name: FULL_NAME,
      })
      .eq('id', existing.id);

    if (error) {
      console.error('Failed to update user:', error.message);
      process.exit(1);
    }
    console.log('User already exists. Updated to solution_owner with password:', PASSWORD);
    console.log('  Email:', EMAIL);
    console.log('  Role: solution_owner');
    return;
  }

  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      id: crypto.randomUUID(),
      email: EMAIL,
      username: EMAIL.split('@')[0],
      full_name: FULL_NAME,
      role: 'solution_owner',
      tenant_id: null,
      password_hash: passwordHash,
      is_active: true,
    })
    .select('id, email, role, tenant_id')
    .single();

  if (error) {
    console.error('Failed to create user:', error.message);
    process.exit(1);
  }

  console.log('Solution owner created. You can log in with:');
  console.log('  Email:', EMAIL);
  console.log('  Password:', PASSWORD);
  console.log('  Role:', newUser.role);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
