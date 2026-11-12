#!/usr/bin/env node
// One-command testnet setup (reproducible from zero, no browser, no money):
// 1. Generate two keypairs, create agent + vendor accounts via the official
//    testnet helper faucet (POST https://helper.testnet.near.org/account).
// 2. Write .env (mode 600, gitignored) with the keys. Secrets are NEVER printed.
// 3. Add a scoped function-call key (allowance 0.1 NEAR, one contract, one method).
// 4. Seed one real prior interaction: agent -> vendor transfer (0.01 NEAR).
// Run: npm run setup [--force to overwrite an existing .env]
import { KeyPair, JsonRpcProvider, Account, actions, nearToYocto } from 'near-api-js';
import { writeFileSync, existsSync, chmodSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getConfig, loadEnv } from './config.js';
import { createFunctionCallKey, listAccessKeys } from './keys-setup.js';

const force = process.argv.includes('--force');
const config = getConfig(loadEnv());
const envPath = join(config.root, '.env');

if (existsSync(envPath) && config.agentAccountId && !force) {
  console.error('Refusing to overwrite an existing .env with an account already configured. Re-run with --force to create fresh accounts.');
  process.exit(2);
}

async function createViaHelper(accountId, publicKey) {
  const res = await fetch('https://helper.testnet.near.org/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`helper.testnet.near.org/account HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text.slice(0, 120);
}

async function waitForAccount(provider, accountId, tries = 10) {
  for (let i = 0; i < tries; i++) {
    try {
      const view = await provider.viewAccount({ accountId });
      return view.amount.toString();
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error(`Account ${accountId} did not appear on chain after polling.`);
}

const suffix = randomBytes(3).toString('hex');
const agentId = `agentleash-${suffix}.testnet`;
const vendorId = `al-vendor-${suffix}.testnet`;
const agentKp = KeyPair.fromRandom('ed25519');
const vendorKp = KeyPair.fromRandom('ed25519');

console.log(`Creating agent account ${agentId} via testnet helper faucet...`);
await createViaHelper(agentId, agentKp.getPublicKey().toString());
console.log(`Creating vendor account ${vendorId} via testnet helper faucet...`);
await createViaHelper(vendorId, vendorKp.getPublicKey().toString());

const provider = new JsonRpcProvider({ url: config.rpcUrl });
const agentBalance = await waitForAccount(provider, agentId);
await waitForAccount(provider, vendorId);
console.log(`Agent account funded: ${agentBalance} yoctoNEAR.`);

// Write .env BEFORE the key step so a later failure still leaves usable accounts.
const envLines = [
  '# AgentLeash testnet config. NEVER commit this file. Testnet keys only.',
  `AGENT_ACCOUNT_ID=${agentId}`,
  `AGENT_FULL_PRIVATE_KEY=${agentKp.toString()}`,
  `VENDOR_ACCOUNT_ID=${vendorId}`,
  `VENDOR_PRIVATE_KEY=${vendorKp.toString()}`,
  `SCOPED_CONTRACT_ID=guestbook.near-examples.testnet`,
  `SCOPED_METHODS=add_message`,
  `FC_ALLOWANCE_NEAR=0.1`,
  `NEAR_RPC_URL=${config.rpcUrl}`,
  `NEARBLOCKS_BASE_URL=${config.nearblocksBase}`,
  '',
].join('\n');
writeFileSync(envPath, envLines, { mode: 0o600 });
chmodSync(envPath, 0o600);
console.log('.env written (mode 600). Private keys are in .env only; they are not printed here.');

const fullConfig = getConfig(loadEnv());
console.log(`Adding scoped function-call key (receiver=${fullConfig.scopedContractId}, methods=${fullConfig.scopedMethods.join(',')}, allowance=${fullConfig.fcAllowanceNear} NEAR)...`);
const fc = await createFunctionCallKey({ config: fullConfig, allowanceNear: fullConfig.fcAllowanceNear });
appendFileSync(envPath, `AGENT_FUNCTION_CALL_PRIVATE_KEY=${fc.privateKey}\nAGENT_FUNCTION_CALL_PUBLIC_KEY=${fc.publicKey}\n`);
chmodSync(envPath, 0o600);
console.log(`Function-call key added. publicKey=${fc.publicKey}`);
console.log(`Add-key tx: ${fullConfig.explorerTx(fc.txHash)}`);

// Verify the key list shows exactly the intended permission.
const keys = await listAccessKeys({ config: fullConfig });
for (const k of keys) {
  const perm = k.access_key?.permission;
  console.log(`  key ${k.public_key}: ${perm === 'FullAccess' ? 'FullAccess' : `FunctionCall -> ${perm?.FunctionCall?.receiver_id} ${JSON.stringify(perm?.FunctionCall?.method_names)}`}`);
}

// Seed one real prior interaction (owner operation with the full-access key).
const owner = new Account(agentId, provider, agentKp.toString());
const seed = await owner.signAndSendTransaction({
  receiverId: vendorId,
  actions: [actions.transfer(nearToYocto('0.01'))],
  throwOnFailure: false,
});
console.log(`Seed transfer agent -> vendor (0.01 NEAR): ${fullConfig.explorerTx(seed?.transaction?.hash)}`);

console.log('\nSetup complete.');
console.log(`  agent:  ${agentId}`);
console.log(`  vendor: ${vendorId}`);
console.log('Next: npm test && npm run demo && npm run demo:attack');
