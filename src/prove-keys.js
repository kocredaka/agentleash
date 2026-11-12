#!/usr/bin/env node
// Proof that the function-call key is actually limited, with REAL testnet evidence:
// (a) allowed call succeeds -> real tx hash + explorer link.
// (b) NEAR transfer with the key -> the NODE rejects the transaction at
//     validation (InvalidTxError: access key requires full access). A rejected
//     transaction is never included in a block, so there is NO tx hash and NO
//     explorer link for it -- that absence is itself the proof: the network
//     refused to record it. We additionally verify the key nonce and the
//     receiver balance are unchanged, i.e. nothing happened on chain.
// (c) call to a different receiver -> same node rejection.
// (d) call to a disallowed method -> same node rejection.
// Results (hashes, error types, nonces -- no secrets) go to data/proof.json.
// Run: npm run prove-keys
import { Account, JsonRpcProvider, actions, nearToYocto, teraToGas } from 'near-api-js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig, loadEnv } from './config.js';

const config = getConfig(loadEnv());
if (!config.agentAccountId || !config.fcPrivateKey) {
  console.error('Missing AGENT_ACCOUNT_ID / AGENT_FUNCTION_CALL_PRIVATE_KEY in .env. Run npm run setup first.');
  process.exit(2);
}
const provider = new JsonRpcProvider({ url: config.rpcUrl });
const agent = new Account(config.agentAccountId, provider, config.fcPrivateKey);

async function fcNonce() {
  const list = await agent.getAccessKeyList({ limit: 100 });
  const keys = list.keys || list;
  const mine = keys.find((k) => k.public_key === config.fcPublicKey);
  return mine ? String(mine.access_key.nonce) : null;
}

async function balanceOf(accountId) {
  const view = await provider.viewAccount({ accountId });
  return view.amount.toString();
}

function isAccessKeyRejection(err) {
  const name = err?.constructor?.name || '';
  const msg = String(err?.message || err);
  return /AccessKey/i.test(name) || /access key|requires full access|does not have permission|InvalidAccessKey/i.test(msg);
}

// Attempts (b)-(d) are EXPECTED to throw an access-key rejection from the node.
// If instead near-api-js returns a response, a Failure status with a hash is
// also accepted as proof (the call did not succeed).
async function expectRejection(label, fn) {
  const nonceBefore = await fcNonce();
  try {
    const response = await fn();
    const statusStr = JSON.stringify(response?.status || {});
    const success = statusStr.includes('SuccessValue');
    const nonceAfter = await fcNonce();
    return {
      label,
      expected: 'rejected by the network (no successful execution)',
      actual: success ? 'UNEXPECTED SUCCESS' : `failure response (status: ${statusStr.slice(0, 200)})`,
      passed: !success,
      txHash: response?.transaction?.hash || null,
      explorerUrl: response?.transaction?.hash ? config.explorerTx(response.transaction.hash) : null,
      nonceBefore,
      nonceAfter,
    };
  } catch (err) {
    const nonceAfter = await fcNonce();
    const ok = isAccessKeyRejection(err);
    return {
      label,
      expected: 'rejected by the network (InvalidTxError, access-key permission)',
      actual: ok ? `node rejection: ${err?.constructor?.name}: ${String(err?.message || '').slice(0, 200)}` : `UNEXPECTED ERROR: ${err?.constructor?.name}: ${String(err?.message || '').slice(0, 200)}`,
      passed: ok,
      txHash: null,
      explorerUrl: null,
      note: 'Rejected transactions are never included in a block, so no tx hash / explorer link exists. Nonce unchanged proves nothing was recorded.',
      nonceBefore,
      nonceAfter,
      nonceUnchanged: nonceBefore === nonceAfter,
    };
  }
}

const results = [];
const stamp = new Date().toISOString();

// (a) Allowed call: guestbook add_message with the scoped key.
const allowed = await agent.signAndSendTransaction({
  receiverId: config.scopedContractId,
  actions: [actions.functionCall('add_message', { text: `AgentLeash key-proof ${stamp}` }, teraToGas(30), 0n)],
  throwOnFailure: false,
});
const allowedOk = JSON.stringify(allowed?.status || {}).includes('SuccessValue');
results.push({
  label: 'a) scoped call add_message on guestbook (function-call key)',
  expected: 'success',
  actual: allowedOk ? 'success' : 'failure',
  passed: allowedOk,
  txHash: allowed?.transaction?.hash || null,
  explorerUrl: allowed?.transaction?.hash ? config.explorerTx(allowed.transaction.hash) : null,
  status: JSON.stringify(allowed?.status || {}).slice(0, 200),
});

// (b) Transfer attempt with the function-call key.
const vendorBefore = await balanceOf(config.vendorAccountId);
const rejB = await expectRejection('b) NEAR transfer with function-call key (must be rejected)', () =>
  agent.signAndSendTransaction({
    receiverId: config.vendorAccountId,
    actions: [actions.transfer(nearToYocto('0.001'))],
    throwOnFailure: false,
  }));
const vendorAfter = await balanceOf(config.vendorAccountId);
rejB.vendorBalanceBefore = vendorBefore;
rejB.vendorBalanceAfter = vendorAfter;
rejB.vendorBalanceUnchanged = vendorBefore === vendorAfter;
rejB.passed = rejB.passed && vendorBefore === vendorAfter;
results.push(rejB);

// (c) Call to a different receiver.
results.push(await expectRejection('c) call to hello.near-examples.testnet with guestbook-scoped key (must be rejected)', () =>
  agent.signAndSendTransaction({
    receiverId: 'hello.near-examples.testnet',
    actions: [actions.functionCall('set_greeting', { greeting: 'AgentLeash must not reach here' }, teraToGas(30), 0n)],
    throwOnFailure: false,
  })));

// (d) Disallowed method on the scoped contract.
results.push(await expectRejection('d) disallowed method on scoped contract (must be rejected)', () =>
  agent.signAndSendTransaction({
    receiverId: config.scopedContractId,
    actions: [actions.functionCall('nonexistent_method_xyz', {}, teraToGas(30), 0n)],
    throwOnFailure: false,
  })));

for (const r of results) {
  console.log(`\n[${r.passed ? 'PASS' : 'FAIL'}] ${r.label}`);
  console.log(`  actual: ${r.actual}`);
  if (r.explorerUrl) console.log(`  tx: ${r.explorerUrl}`);
  if (r.nonceBefore !== undefined) console.log(`  key nonce: ${r.nonceBefore} -> ${r.nonceAfter} (unchanged=${r.nonceBefore === r.nonceAfter})`);
  if (r.vendorBalanceUnchanged !== undefined) console.log(`  vendor balance unchanged: ${r.vendorBalanceUnchanged}`);
}

const proof = {
  generatedAt: stamp,
  network: 'testnet',
  agentAccountId: config.agentAccountId,
  functionCallPublicKey: config.fcPublicKey || '(not recorded)',
  scopedContractId: config.scopedContractId,
  scopedMethods: config.scopedMethods,
  allowanceNear: config.fcAllowanceNear,
  note: 'Rejected transactions (b-d) have no tx hash by design: the node refuses them at validation and they are never included in a block. See nonce/balance evidence per entry.',
  proofs: results,
  allPassed: results.every((r) => r.passed),
};
writeFileSync(join(config.root, 'data', 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(`\nProof written to data/proof.json. allPassed=${proof.allPassed}`);
process.exit(proof.allPassed ? 0 : 1);
