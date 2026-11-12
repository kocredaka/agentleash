import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../src/decide.js';
import { gateDecision } from '../src/gate.js';
import { nsToDaysAgo } from '../src/signals.js';

const base = {
  receiver: 'someone.testnet',
  exists: true,
  isContract: false,
  ageDays: 400,
  txCount: 25,
  lastDeployDays: null,
  priorInteraction: true,
  blocklistEntry: null,
  historyAvailable: true,
};

test('blocklist entry blocks even for an old established account', () => {
  const r = decide({ ...base, blocklistEntry: { reason: 'reported drainer', reportedBy: 'alice' } }, { intent: 'transfer', amountNear: 0.01 });
  assert.equal(r.decision, 'block');
  assert.match(r.reasons.join(' '), /BLOCKLIST/);
});

test('contract call to a plain account blocks', () => {
  const r = decide({ ...base, isContract: false }, { intent: 'call', amountNear: 0 });
  assert.equal(r.decision, 'block');
});

test('contract call to a nonexistent account blocks', () => {
  const r = decide({ ...base, exists: false }, { intent: 'call', amountNear: 0 });
  assert.equal(r.decision, 'block');
});

test('transfer to a nonexistent account warns (typo risk), does not block', () => {
  const r = decide({ ...base, exists: false, ageDays: null, txCount: null, priorInteraction: null }, { intent: 'transfer', amountNear: 0.01 });
  assert.equal(r.decision, 'warn');
});

test('recently redeployed contract warns', () => {
  const r = decide({ ...base, isContract: true, lastDeployDays: 0.2 }, { intent: 'call', amountNear: 0 });
  assert.equal(r.decision, 'warn');
  assert.match(r.reasons.join(' '), /deployed/);
});

test('brand-new account warns', () => {
  const r = decide({ ...base, ageDays: 0.1, priorInteraction: false }, { intent: 'transfer', amountNear: 0.01 });
  assert.equal(r.decision, 'warn');
});

test('young account without prior interaction warns', () => {
  const r = decide({ ...base, ageDays: 3, priorInteraction: false }, { intent: 'transfer', amountNear: 0.01 });
  assert.equal(r.decision, 'warn');
});

test('old account with prior interaction allows', () => {
  const r = decide({ ...base }, { intent: 'transfer', amountNear: 0.01 });
  assert.equal(r.decision, 'allow');
});

test('large amount without prior interaction warns', () => {
  const r = decide({ ...base, priorInteraction: false }, { intent: 'transfer', amountNear: 5 });
  assert.equal(r.decision, 'warn');
});

test('dormant account (indexer ok, zero txns) warns', () => {
  const r = decide({ ...base, txCount: 0, priorInteraction: false }, { intent: 'transfer', amountNear: 0.01 });
  assert.equal(r.decision, 'warn');
});

test('indexer down: small amount allows with a note, larger amount warns', () => {
  const small = decide({ ...base, historyAvailable: false, ageDays: null, txCount: null, priorInteraction: null }, { intent: 'transfer', amountNear: 0.01 });
  assert.equal(small.decision, 'allow');
  const big = decide({ ...base, historyAvailable: false, ageDays: null, txCount: null, priorInteraction: null }, { intent: 'transfer', amountNear: 0.5 });
  assert.equal(big.decision, 'warn');
});

test('gate: block can never be forced', () => {
  assert.equal(gateDecision('block', { yes: true, force: true }).allowed, false);
  assert.equal(gateDecision('block', {}).allowed, false);
});

test('gate: warn needs explicit confirmation', () => {
  assert.equal(gateDecision('warn', {}).allowed, false);
  assert.equal(gateDecision('warn', {}).needsHuman, true);
  assert.equal(gateDecision('warn', { yes: true }).allowed, true);
});

test('gate: allow proceeds', () => {
  assert.equal(gateDecision('allow', {}).allowed, true);
});

test('nsToDaysAgo handles nanosecond timestamps beyond Number precision', () => {
  const nowNs = BigInt(Date.now()) * 1000000n;
  const twoDaysAgo = (nowNs - 2n * 86400000n * 1000000n).toString();
  const days = nsToDaysAgo(twoDaysAgo);
  assert.ok(days > 1.9 && days < 2.1, `expected ~2 days, got ${days}`);
  assert.equal(nsToDaysAgo(null), null);
  assert.equal(nsToDaysAgo(''), null);
});
