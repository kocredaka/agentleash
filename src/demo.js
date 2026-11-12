#!/usr/bin/env node
// End-to-end demo (testnet, one real contract call; everything else is checks
// and refusals, so re-running is cheap and safe).
//   1. check the scoped contract  -> ALLOW (old, established, prior interaction)
//   2. allowed call via the scoped function-call key -> REAL tx, explorer link
//   3. check the young vendor     -> WARN, wrapper refuses without confirmation
//   4. injected payment to a blocklisted receiver -> BLOCKED even with --force
// Run: npm run demo
import { getConfig, loadEnv } from './config.js';
import { checkReceiver } from './check.js';
import { attemptPay } from './pay.js';

const config = getConfig(loadEnv());
if (!config.agentAccountId || !config.fcPrivateKey) {
  console.error('Missing .env config. Run npm run setup first.');
  process.exit(2);
}
const stamp = new Date().toISOString();
console.log('=== AgentLeash demo (NEAR testnet) ===');
console.log(`agent: ${config.agentAccountId}`);
console.log(`scoped contract: ${config.scopedContractId} methods=${config.scopedMethods.join(',')} allowance=${config.fcAllowanceNear} NEAR`);
console.log(`vendor: ${config.vendorAccountId}\n`);

console.log('--- 1. check scoped contract (call intent) ---');
const c1 = await checkReceiver({ receiver: config.scopedContractId, from: config.agentAccountId, amountNear: 0, intent: 'call', config });
console.log(`Decision: ${c1.decision.toUpperCase()}`);
for (const r of c1.reasons) console.log(`  - ${r}`);

console.log('\n--- 2. allowed call via scoped function-call key ---');
const call = await attemptPay({
  config, intent: 'call', receiver: config.scopedContractId,
  methodName: 'add_message', args: { text: `AgentLeash demo ${stamp}` },
  keyKind: 'agent', interactive: false,
});
console.log(`Gate: ${call.gate}`);
if (call.sent) {
  console.log(`REAL TX SENT. success=${call.success} hash=${call.txHash}`);
  console.log(`Explorer: ${call.explorerUrl}`);
} else {
  console.log(`NOT SENT: ${call.refused || call.error}`);
}

console.log('\n--- 3. check young vendor (transfer intent, 0.01 NEAR) ---');
const c3 = await checkReceiver({ receiver: config.vendorAccountId, from: config.agentAccountId, amountNear: 0.01, intent: 'transfer', config });
console.log(`Decision: ${c3.decision.toUpperCase()}`);
for (const r of c3.reasons) console.log(`  - ${r}`);
const warnPay = await attemptPay({
  config, intent: 'transfer', receiver: config.vendorAccountId, amountNear: 0.01,
  keyKind: 'agent', interactive: false,
});
console.log(`Wrapper without confirmation: sent=${warnPay.sent}. ${warnPay.refused || warnPay.error || ''}`);

console.log('\n--- 4. injected payment to blocklisted receiver (with --force) ---');
const blocked = await attemptPay({
  config, intent: 'transfer', receiver: 'evil-drainer.testnet', amountNear: 5,
  yes: true, force: true, keyKind: 'agent', interactive: false,
});
console.log(`Gate: ${blocked.gate}`);
console.log(`Wrapper: sent=${blocked.sent}. ${blocked.refused || ''} No transaction was signed or sent.`);
console.log('\n=== demo complete ===');
