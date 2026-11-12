#!/usr/bin/env node
// AgentLeash CLI.
//   node src/cli.js check <receiver> [--from <id>] [--amount <near>] [--intent transfer|call] [--json]
//   node src/cli.js report <receiver> --reason "..." [--evidence "..."] [--reporter ...]
//   node src/cli.js pay transfer <receiver> <amountNear> [--yes] [--force] [--key agent|full]
//   node src/cli.js pay call <contract> <method> '<json-args>' [--yes] [--force] [--key agent|full]
//   node src/cli.js keys
import { getConfig, loadEnv } from './config.js';
import { checkReceiver } from './check.js';
import { addReport, loadBlocklist } from './blocklist.js';
import { attemptPay } from './pay.js';
import { makeProvider } from './signals.js';
import { Account } from 'near-api-js';

const config = getConfig(loadEnv());

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const eq = key.indexOf('=');
      if (eq !== -1) flags[key.slice(0, eq)] = key.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
      else flags[key] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

function printCheck(result) {
  const s = result.signals;
  console.log(`\nDecision: ${result.decision.toUpperCase()}  (receiver: ${result.receiver}, intent: ${result.intent})`);
  for (const r of result.reasons) console.log(`  - ${r}`);
  console.log('Signals:');
  console.log(`  exists=${s.exists} isContract=${s.isContract} balance=${s.balanceNear ?? 'n/a'} NEAR`);
  console.log(`  codeHash=${s.codeHash ?? 'n/a'}`);
  console.log(`  ageDays=${s.ageDays ?? 'unknown'} txCount=${s.txCount ?? 'unknown'} lastActivityDays=${s.lastActivityDays ?? 'unknown'} lastDeployDays=${s.lastDeployDays ?? 'n/a'}`);
  console.log(`  priorInteraction=${s.priorInteraction} historyAvailable=${s.historyAvailable}`);
  console.log('Sources:');
  console.log(`  rpc: ${result.sources.rpc}`);
  console.log(`  indexer: ${result.sources.indexer}`);
  console.log(`  blocklist: ${result.sources.blocklist}`);
}

const [cmd, ...rest] = process.argv.slice(2);
const { flags, positional } = parseFlags(rest);

if (cmd === 'check') {
  const receiver = positional[0];
  if (!receiver) { console.error('Usage: check <receiver> [--from <id>] [--amount <near>] [--intent transfer|call] [--json]'); process.exit(2); }
  const result = await checkReceiver({
    receiver,
    from: flags.from || config.agentAccountId || null,
    amountNear: Number(flags.amount || 0),
    intent: flags.intent || 'transfer',
    config,
  });
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else printCheck(result);
  process.exit(result.decision === 'block' ? 3 : result.decision === 'warn' ? 2 : 0);
}

if (cmd === 'report') {
  const receiver = positional[0];
  if (!receiver || !flags.reason) { console.error('Usage: report <receiver> --reason "..." [--evidence "..."] [--reporter ...]'); process.exit(2); }
  const entry = addReport(config.blocklistPath, {
    accountId: receiver,
    reason: flags.reason,
    evidence: flags.evidence || '',
    reportedBy: flags.reporter || 'cli-user',
  });
  console.log(`Reported ${entry.accountId} to the LOCAL blocklist (demo file, not a shared network).`);
  console.log(JSON.stringify(entry, null, 2));
  process.exit(0);
}

if (cmd === 'pay') {
  const kind = positional[0];
  const receiver = positional[1];
  if (!kind || !receiver || !['transfer', 'call'].includes(kind)) {
    console.error('Usage: pay transfer <receiver> <amountNear> | pay call <contract> <method> \'<json-args>\' [--yes] [--force] [--key agent|full]');
    process.exit(2);
  }
  let outcome;
  if (kind === 'transfer') {
    const amountNear = Number(positional[2]);
    if (!Number.isFinite(amountNear) || amountNear <= 0) { console.error('Amount must be a positive number of NEAR.'); process.exit(2); }
    outcome = await attemptPay({ config, intent: 'transfer', receiver, amountNear, yes: Boolean(flags.yes), force: Boolean(flags.force), keyKind: flags.key || 'agent' });
  } else {
    const methodName = positional[2];
    let args = {};
    if (positional[3]) { try { args = JSON.parse(positional[3]); } catch { console.error('Args must be valid JSON.'); process.exit(2); } }
    outcome = await attemptPay({ config, intent: 'call', receiver, methodName, args, yes: Boolean(flags.yes), force: Boolean(flags.force), keyKind: flags.key || 'agent' });
  }
  console.log(`\nGate: ${outcome.gate}`);
  for (const r of outcome.check.reasons) console.log(`  - ${r}`);
  if (!outcome.sent) {
    console.log(`NOT SENT. ${outcome.refused || outcome.error || ''}`);
    process.exit(outcome.check.decision === 'block' ? 3 : 2);
  }
  console.log(`SENT. success=${outcome.success} tx=${outcome.txHash}`);
  if (outcome.explorerUrl) console.log(`Explorer: ${outcome.explorerUrl}`);
  if (!outcome.success) console.log(`On-chain status: ${outcome.rawStatus}`);
  process.exit(outcome.success ? 0 : 4);
}

if (cmd === 'keys') {
  if (!config.agentAccountId) { console.error('AGENT_ACCOUNT_ID not set. Run npm run setup first.'); process.exit(2); }
  const provider = makeProvider(config.rpcUrl);
  const account = new Account(config.agentAccountId, provider);
  const list = await account.getAccessKeyList({ limit: 100 });
  const keys = list.keys || list;
  console.log(`Access keys for ${config.agentAccountId}:`);
  for (const k of keys) {
    const perm = k.access_key?.permission;
    const desc = perm === 'FullAccess'
      ? 'FullAccess'
      : `FunctionCall receiver=${perm?.FunctionCall?.receiver_id} methods=${JSON.stringify(perm?.FunctionCall?.method_names)} allowance=${perm?.FunctionCall?.allowance ?? 'unlimited'}`;
    console.log(`  ${k.public_key} nonce=${k.access_key?.nonce} ${desc}`);
  }
  process.exit(0);
}

if (cmd === 'blocklist') {
  console.log(JSON.stringify(loadBlocklist(config.blocklistPath), null, 2));
  process.exit(0);
}

console.error('Unknown command. Commands: check | report | pay | keys | blocklist');
process.exit(2);
