#!/usr/bin/env node
// Add (or rotate with --rotate) the scoped function-call key for an existing
// .env account. Uses the full-access key once, then appends the new
// function-call key to .env (mode 600). The private key is never printed.
// Run: node src/create-fc-key.js [--rotate]
import { appendFileSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig, loadEnv } from './config.js';
import { createFunctionCallKey } from './keys-setup.js';

const rotate = process.argv.includes('--rotate');
const config = getConfig(loadEnv());
const envPath = join(config.root, '.env');
if (!config.agentAccountId || !config.fullPrivateKey) {
  console.error('Missing AGENT_ACCOUNT_ID / AGENT_FULL_PRIVATE_KEY in .env. Run npm run setup first.');
  process.exit(2);
}
if (config.fcPrivateKey && !rotate) {
  console.error('A function-call key is already configured. Re-run with --rotate to add a new one (the old key stays on chain until deleted by the owner).');
  process.exit(2);
}
const fc = await createFunctionCallKey({ config, allowanceNear: config.fcAllowanceNear });
let text = readFileSync(envPath, 'utf8');
text = text.split('\n').filter((l) => !l.startsWith('AGENT_FUNCTION_CALL_PRIVATE_KEY=') && !l.startsWith('AGENT_FUNCTION_CALL_PUBLIC_KEY=')).join('\n');
if (!text.endsWith('\n')) text += '\n';
text += `AGENT_FUNCTION_CALL_PRIVATE_KEY=${fc.privateKey}\nAGENT_FUNCTION_CALL_PUBLIC_KEY=${fc.publicKey}\n`;
writeFileSync(envPath, text, { mode: 0o600 });
chmodSync(envPath, 0o600);
console.log(`Function-call key added. publicKey=${fc.publicKey}`);
console.log(`receiver=${fc.receiverId} methods=${fc.methodNames.join(',')} allowance=${config.fcAllowanceNear} NEAR`);
console.log(`Add-key tx: ${config.explorerTx(fc.txHash)}`);
