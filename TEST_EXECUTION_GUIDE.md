# Test Execution Guide

This guide provides step-by-step instructions for executing the comprehensive test suite for Bookati.

## Prerequisites

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Set Up Test Environment**
   - Create `.env.test` file with test database credentials
   - Configure test Supabase project
   - Set up test email/WhatsApp services (optional for some tests)

3. **Install Testing Tools**
   ```bash
   # For E2E testing (optional)
   npm install -g playwright
   # or
   npm install -g cypress
   
   # For load testing (optional)
   npm install -g k6
   ```

## Test Execution Order

### Phase 1: Unit Tests (5-10 minutes)
```bash
npm run test:unit
```
**Purpose**: Verify individual functions and utilities work correctly
**Expected**: All unit tests pass

### Phase 2: Integration Tests (15-20 minutes)
```bash
npm run test:integration
```
**Purpose**: Verify components work together
**Expected**: All integration tests pass

### Phase 3: Security Tests (10-15 minutes)
```bash
npm run test:security
```
**Purpose**: Verify security measures
**Expected**: All security tests pass

### Phase 4: Manual Testing (1-2 hours)

#### 4.1 Authentication Flow
- [ ] Tenant admin registration
- [ ] User login (all roles)
- [ ] Customer login (separate page)
- [ ] Password recovery
- [ ] Token expiration handling

#### 4.2 Booking Flow
- [ ] Public booking creation
- [ ] Parallel booking
- [ ] Consecutive booking
- [ ] Package booking
- [ ] Offer selection
- [ ] Booking cancellation
- [ ] Booking completion

#### 4.3 Admin Operations
- [ ] Service management (CRUD)
- [ ] Employee management (CRUD)
- [ ] Package management (CRUD)
- [ ] Offer management (CRUD)
- [ ] Booking management
- [ ] Settings configuration

#### 4.4 Edge Cases
- [ ] Invalid inputs
- [ ] Boundary values
- [ ] Concurrent operations
- [ ] State inconsistencies

### Phase 5: Performance Testing (30-60 minutes)

#### 5.1 Load Testing
```bash
# Using k6
k6 run tests/performance/load-test.js
```

#### 5.2 Stress Testing
- Test with 200+ concurrent users
- Monitor response times
- Check error rates
- Verify system stability

### Phase 6: Security Audit (1-2 hours)

#### 6.1 Authentication Bypass
- [ ] Token manipulation attempts
- [ ] Expired token usage
- [ ] Role privilege escalation

#### 6.2 Authorization Testing
- [ ] Tenant data isolation
- [ ] Role-based access control
- [ ] Direct API access attempts

#### 6.3 Input Validation
- [ ] SQL injection attempts
- [ ] XSS attempts
- [ ] Command injection attempts

## Test Results Documentation

After executing tests, document results:

1. **Create Test Report**
   - Date and time of testing
   - Tester name
   - Environment details
   - Test results summary

2. **Document Issues**
   - Issue description
   - Steps to reproduce
   - Expected vs actual behavior
   - Severity level
   - Screenshots/logs

3. **Update Test Coverage**
   - Mark completed tests
   - Note any skipped tests
   - Update coverage percentage

## Continuous Testing

### Pre-Commit Testing
Run quick tests before committing:
```bash
npm run test:unit
npm run typecheck
npm run lint
```

### Pre-Deployment Testing
Run full test suite before deployment:
```bash
npm run test
npm run test:coverage
# Manual testing checklist
# Performance testing
# Security audit
```

## Test Maintenance

1. **Update Tests Regularly**
   - When features change
   - When bugs are fixed
   - When new features are added

2. **Review Test Coverage**
   - Monthly coverage review
   - Identify gaps
   - Add missing tests

3. **Refactor Tests**
   - Remove obsolete tests
   - Improve test readability
   - Optimize slow tests

## Troubleshooting

### Common Issues

**Tests fail with database connection errors**
- Check `.env.test` configuration
- Verify test database is running
- Check network connectivity

**Tests fail with authentication errors**
- Verify test user credentials
- Check token expiration
- Verify auth service is running

**Performance tests timeout**
- Increase timeout values
- Check server resources
- Verify network latency

## Test Data Management

### Creating Test Data
```bash
npm run test:setup
```

### Cleaning Test Data
- Test data should be cleaned after each test run
- Use test fixtures for consistent data
- Isolate test data by tenant

## Reporting Issues

When reporting test failures:

1. Include test name and ID
2. Provide error messages and stack traces
3. Include environment details
4. Provide steps to reproduce
5. Include relevant logs

---

**Last Updated**: 2025-01-28
**Next Review**: After critical issues resolved


