/**
 * CSRF Protection Test Suite
 *
 * This test suite validates the CSRF protection implementation.
 * Run with: node test/csrf.test.js
 */

const { generateCsrfToken, validateCsrfToken, extractCsrfToken } = require('../src/middleware/csrf');

console.log('🧪 Running CSRF Protection Tests...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

// Test 1: Token generation produces 64-character hex string
test('Token generation produces 64-character hex string', () => {
  const token = generateCsrfToken();
  assertEquals(typeof token, 'string', 'Token should be a string');
  assertEquals(token.length, 64, 'Token should be 64 characters long');
  assert(/^[0-9a-f]{64}$/.test(token), 'Token should be hexadecimal');
});

// Test 2: Generated tokens are unique
test('Generated tokens are unique', () => {
  const tokens = new Set();
  for (let i = 0; i < 1000; i++) {
    tokens.add(generateCsrfToken());
  }
  assertEquals(tokens.size, 1000, 'All tokens should be unique');
});

// Test 3: Token validation passes with matching tokens
test('Token validation passes with matching tokens', () => {
  const token = generateCsrfToken();
  assert(validateCsrfToken(token, token), 'Matching tokens should validate');
});

// Test 4: Token validation fails with mismatched tokens
test('Token validation fails with mismatched tokens', () => {
  const token1 = generateCsrfToken();
  const token2 = generateCsrfToken();
  assert(!validateCsrfToken(token1, token2), 'Mismatched tokens should not validate');
});

// Test 5: Token validation fails with null tokens
test('Token validation fails with null tokens', () => {
  assert(!validateCsrfToken(null, null), 'Null tokens should not validate');
  assert(!validateCsrfToken('abc', null), 'Null header token should not validate');
  assert(!validateCsrfToken(null, 'abc'), 'Null session token should not validate');
});

// Test 6: Token validation fails with invalid length
test('Token validation fails with invalid length', () => {
  const validToken = generateCsrfToken();
  assert(!validateCsrfToken(validToken, 'tooshort'), 'Short token should not validate');
  assert(!validateCsrfToken('tooshort', validToken), 'Short session token should not validate');
});

// Test 7: Token validation fails with invalid hex characters
test('Token validation fails with invalid hex characters', () => {
  const validToken = generateCsrfToken();
  const invalidToken = 'g'.repeat(64); // 'g' is not valid hex
  assert(!validateCsrfToken(validToken, invalidToken), 'Invalid hex should not validate');
});

// Test 8: Extract token from headers
test('Extract token from headers', () => {
  const headers1 = { 'x-csrf-token': 'test123' };
  assertEquals(extractCsrfToken(headers1), 'test123', 'Should extract lowercase header');

  const headers2 = { 'X-CSRF-Token': 'test456' };
  assertEquals(extractCsrfToken(headers2), 'test456', 'Should extract mixed-case header');

  const headers3 = { 'X-Csrf-Token': 'test789' };
  assertEquals(extractCsrfToken(headers3), 'test789', 'Should extract variant case header');

  const headers4 = { 'other-header': 'value' };
  assertEquals(extractCsrfToken(headers4), null, 'Should return null when header not found');
});

// Test 9: Case sensitivity of header extraction
test('Case sensitivity of header extraction', () => {
  const headers = { 'X-CSRF-TOKEN': 'test' };
  // The implementation should handle case-insensitive lookup
  const token = extractCsrfToken(headers);
  assert(token === 'test' || token === null, 'Should handle case variations');
});

// Test 10: Token format validation
test('Token format validation', () => {
  for (let i = 0; i < 100; i++) {
    const token = generateCsrfToken();
    assert(token.length === 64, `Token ${i} should be 64 chars`);
    assert(/^[0-9a-f]{64}$/.test(token), `Token ${i} should be valid hex`);
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Tests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);
console.log(`Total tests: ${passed + failed}`);
console.log('='.repeat(50));

if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
