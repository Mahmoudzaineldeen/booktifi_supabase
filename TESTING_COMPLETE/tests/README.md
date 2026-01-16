# Bookati Test Suite

This directory contains test utilities, scripts, and automated tests for the Bookati platform.

## Structure

```
tests/
├── unit/              # Unit tests
├── integration/       # Integration tests
├── e2e/              # End-to-end tests
├── performance/       # Performance/load tests
├── fixtures/         # Test data fixtures
├── utils/            # Test utilities
└── scripts/          # Test setup scripts
```

## Running Tests

### Unit Tests
```bash
npm run test:unit
```

### Integration Tests
```bash
npm run test:integration
```

### E2E Tests
```bash
npm run test:e2e
```

### Performance Tests
```bash
npm run test:performance
```

### All Tests
```bash
npm run test
```

## Test Data Setup

Before running tests, set up test data:

```bash
node tests/scripts/setup-test-data.js
```

## Test Coverage

Generate coverage report:

```bash
npm run test:coverage
```

## Writing Tests

### Unit Test Example
```typescript
import { describe, it, expect } from 'vitest';
import { normalizePhoneNumber } from '../src/lib/countryCodes';

describe('Phone Number Normalization', () => {
  it('should normalize Saudi phone numbers', () => {
    expect(normalizePhoneNumber('0501234567')).toBe('+966501234567');
  });
});
```

### Integration Test Example
```typescript
import { describe, it, expect } from 'vitest';
import { createBooking } from '../src/lib/bookings';

describe('Booking Creation', () => {
  it('should create booking successfully', async () => {
    const booking = await createBooking({
      serviceId: 'test-service-id',
      slotId: 'test-slot-id',
      customerName: 'Test Customer',
      customerPhone: '+966501234567'
    });
    
    expect(booking.id).toBeDefined();
    expect(booking.status).toBe('pending');
  });
});
```

## Test Environment

Tests use a separate test database. Configure in `.env.test`:

```
VITE_SUPABASE_URL=your-test-supabase-url
VITE_SUPABASE_ANON_KEY=your-test-anon-key
DATABASE_URL=your-test-database-url
```

