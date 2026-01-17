/**
 * Get Runtime URL
 * This script simulates getting the runtime URL that would be available in the browser
 */

// In a browser environment, this would be:
// const runtimeUrl = window.location.origin;

// For server/Node environment, we'll show what it would be:
console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║              RUNTIME URL INFORMATION                       ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('📍 In Browser Environment:');
console.log('   window.location.origin will return the current origin\n');

console.log('🌐 Expected Runtime URLs:');
console.log('   Development:  http://localhost:5173');
console.log('   Production:   https://bolt.new/~/github-7dhabv8k\n');

console.log('💡 To get the actual runtime URL, open the browser console and run:');
console.log('   console.log(window.location.origin);\n');

console.log('📋 Or add this to any React component:');
console.log('   useEffect(() => {');
console.log('     console.log("Runtime URL:", window.location.origin);');
console.log('   }, []);\n');

// Try to determine from environment
const isDev = process.env.NODE_ENV === 'development';
const likelyUrl = isDev ? 'http://localhost:5173' : 'https://bolt.new/~/github-7dhabv8k';

console.log(`🎯 Current Environment: ${process.env.NODE_ENV || 'production'}`);
console.log(`📌 Likely Runtime URL: ${likelyUrl}\n`);
