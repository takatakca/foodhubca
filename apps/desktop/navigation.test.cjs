const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isHubUrl } = require('./navigation.cjs');

test('accepts HTTPS routes on the production Food Hub origin', () => {
  assert(isHubUrl('https://foodhub.on2go.ca/orders'));
  assert(isHubUrl('https://foodhub.on2go.ca/login?next=%2Fkitchen'));
});

test('rejects other origins, schemes, credentials and malformed URLs', () => {
  for (const value of [
    'https://foodhub.on2go.ca.example.com/',
    'http://foodhub.on2go.ca/',
    'https://foodhub.on2go.ca:9443/',
    'https://user@foodhub.on2go.ca/',
    'blob:https://foodhub.on2go.ca/id',
    'file:///etc/passwd',
    '/login',
  ]) assert.equal(isHubUrl(value), false, value);
});
