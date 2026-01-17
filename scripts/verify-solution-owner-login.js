/**
 * Verify Solution Owner Login Credentials
 */

console.log('\n═══════════════════════════════════════');
console.log('🔐 Solution Owner Login Credentials');
console.log('═══════════════════════════════════════');
console.log('Username: Bookatiadmin');
console.log('Password: Book@king6722');
console.log('Login URL: /management');
console.log('═══════════════════════════════════════\n');

// Test the credentials
const testUsername = 'Bookatiadmin';
const testPassword = 'Book@king6722';

const expectedUsername = 'Bookatiadmin';
const expectedPassword = 'Book@king6722';

console.log('🧪 Testing Credentials:');
console.log('  Username Match:', testUsername === expectedUsername ? '✅ PASS' : '❌ FAIL');
console.log('  Password Match:', testPassword === expectedPassword ? '✅ PASS' : '❌ FAIL');
console.log('  Username Length:', testUsername.length, 'chars');
console.log('  Password Length:', testPassword.length, 'chars');

console.log('\n💡 Tips for Login:');
console.log('  1. Make sure there are no spaces before or after the username/password');
console.log('  2. Username is case-sensitive: "Bookatiadmin" (capital B)');
console.log('  3. Password includes special characters: @');
console.log('  4. Clear browser cache if you recently updated credentials');
console.log('  5. Try refreshing the page (Ctrl+Shift+R or Cmd+Shift+R)');
console.log('\n');
