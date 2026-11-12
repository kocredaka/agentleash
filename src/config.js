// Shared config. Reads .env with a tiny hand-rolled parser (no extra deps).
// Never prints secret values: only account IDs and public keys leave this module.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv(envPath = join(ROOT, '.env')) {
  const env = { ...process.env };
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in env)) env[key] = value;
    }
  }
  return env;
}

export function getConfig(env = loadEnv()) {
  return {
    root: ROOT,
    rpcUrl: env.NEAR_RPC_URL || 'https://rpc.testnet.near.org',
    nearblocksBase: env.NEARBLOCKS_BASE_URL || 'https://api-testnet.nearblocks.io',
    explorerTx: (hash) => `https://explorer.testnet.near.org/transactions/${hash}`,
    agentAccountId: env.AGENT_ACCOUNT_ID || '',
    fullPrivateKey: env.AGENT_FULL_PRIVATE_KEY || '',
    fcPrivateKey: env.AGENT_FUNCTION_CALL_PRIVATE_KEY || '',
    fcPublicKey: env.AGENT_FUNCTION_CALL_PUBLIC_KEY || '',
    vendorAccountId: env.VENDOR_ACCOUNT_ID || '',
    scopedContractId: env.SCOPED_CONTRACT_ID || 'guestbook.near-examples.testnet',
    scopedMethods: (env.SCOPED_METHODS || 'add_message').split(',').map((s) => s.trim()).filter(Boolean),
    fcAllowanceNear: env.FC_ALLOWANCE_NEAR || '0.1',
    blocklistPath: join(ROOT, 'data', 'blocklist.json'),
  };
}

export const EMPTY_CODE_HASH = '11111111111111111111111111111111';
