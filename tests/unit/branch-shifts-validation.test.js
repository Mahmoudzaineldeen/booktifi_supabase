/**
 * Unit test: branch shift time validation logic (no server required).
 * Ensures we allow overnight (end < start) and only reject when start === end.
 * Run: node tests/unit/branch-shifts-validation.test.js
 */

function shouldRejectShift(startTime, endTime) {
  const start = (startTime && String(startTime).trim()) || '09:00';
  const end = (endTime && String(endTime).trim()) || '17:00';
  const startNorm = start.length === 5 ? `${start}:00` : start.slice(0, 8);
  const endNorm = end.length === 5 ? `${end}:00` : end.slice(0, 8);
  return endNorm === startNorm;
}

let passed = 0;
let failed = 0;

function test(name, expectReject, start, end) {
  const reject = shouldRejectShift(start, end);
  const ok = reject === expectReject;
  if (ok) {
    passed++;
    console.log(`✅ ${name}`);
  } else {
    failed++;
    console.log(`❌ ${name}: expected reject=${expectReject}, got reject=${reject} (start=${start}, end=${end})`);
  }
}

console.log('\n========== Branch shift validation (unit) ==========\n');

test('9 PM to 12 AM (overnight) — allowed', false, '21:00', '00:00');
test('9 PM to 2 AM (overnight) — allowed', false, '21:00', '02:00');
test('9 PM to 2 AM with seconds — allowed', false, '21:00:00', '02:00:00');
test('9 AM to 5 PM (same-day) — allowed', false, '09:00', '17:00');
test('Same start and end 21:00–21:00 — rejected', true, '21:00', '21:00');
test('Same start and end 09:00–09:00 — rejected', true, '09:00', '09:00');
test('Midnight to 1 AM — allowed', false, '00:00', '01:00');

console.log(`\nPassed: ${passed} | Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
