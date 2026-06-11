/**
 * Auth token unit tests (Milestone #7, Phase A). Verify the per-client bearer
 * token round-trips, that tampering or a wrong secret is rejected, and that the
 * verifier fails closed on malformed input.
 *
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { signClientToken, verifyClientToken } from '../http/auth';

const SECRET = 'unit-secret';
const CLIENT = '11111111-1111-4111-8111-111111111111';

test('a signed client token verifies back to its client id', () => {
  const token = signClientToken(CLIENT, SECRET);
  assert.equal(verifyClientToken(token, SECRET), CLIENT);
});

test('a token signed with a different secret is rejected', () => {
  const token = signClientToken(CLIENT, SECRET);
  assert.equal(verifyClientToken(token, 'other-secret'), null);
});

test('a tampered client id (same signature) is rejected', () => {
  const token = signClientToken(CLIENT, SECRET);
  const sig = token.slice(token.lastIndexOf('.') + 1);
  const forged = `22222222-2222-4222-8222-222222222222.${sig}`;
  assert.equal(verifyClientToken(forged, SECRET), null);
});

test('malformed tokens and an empty secret fail closed', () => {
  assert.equal(verifyClientToken('', SECRET), null);
  assert.equal(verifyClientToken('no-dot', SECRET), null);
  assert.equal(verifyClientToken(`${CLIENT}.`, SECRET), null);
  assert.equal(verifyClientToken(`.deadbeef`, SECRET), null);
  assert.equal(verifyClientToken(signClientToken(CLIENT, SECRET), ''), null);
});
