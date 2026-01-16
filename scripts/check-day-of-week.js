#!/usr/bin/env node

const date = new Date('2026-01-05');
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayOfWeek = date.getDay();

console.log(`\n2026-01-05 is a ${dayNames[dayOfWeek]} (day ${dayOfWeek})\n`);

// Check the week
for (let i = 0; i < 7; i++) {
  const checkDate = new Date('2026-01-05');
  checkDate.setDate(checkDate.getDate() + i);
  const dow = checkDate.getDay();
  console.log(`${checkDate.toISOString().split('T')[0]} - ${dayNames[dow]} (day ${dow})`);
}

console.log('\nShift days_of_week: [0, 5] means Sunday and Friday');
console.log('January 5, 2026 is Monday (day 1) - NOT in shift days [0, 5]');
console.log('That\'s why there are no slots!\n');


