// The agent-side payment wrapper. EVERY outbound transaction goes through here:
// 1. Run the counterparty check. 2. Apply the gate (block can never be forced).
// 3. Only then sign, with the key the caller selected.
// The agent runtime is expected to hold ONLY the function-call key: it cannot
// transfer NEAR, add keys, or call other contracts even if the check is bypassed.
// The full-access key exists only for owner setup (see src/setup.js).
import { createInterface } from 'node:readline';
import { Account, JsonRpcProvider, actions, nearToYocto, teraToGas } from 'near-api-js';
import { checkReceiver } from './check.js';
import { gateDecision } from './gate.js';

async function askHuman(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

/**
 * Attempt a gated payment/call.
 * @returns {object} outcome; `sent === false` means NOTHING was signed or sent.
 */
export async function attemptPay({
  config,
  intent = 'transfer', // 'transfer' | 'call'
  receiver,
  amountNear = 0, // transfers only
  methodName = null, // calls only
  args = {},
  depositYocto = 0n,
  gas = teraToGas(30),
  yes = false,
  force = false,
  keyKind = 'agent', // 'agent' (function-call key) | 'full' (owner key, explicit only)
  interactive = true,
}) {
  const from = config.agentAccountId;
  const check = await checkReceiver({ receiver, from, amountNear, intent, config });
  const gate = gateDecision(check.decision, { yes, force });

  const base = { check, gate: gate.message, sent: false, txHash: null, explorerUrl: null };

  if (!gate.allowed) {
    if (gate.needsHuman && interactive && process.stdin.isTTY && !yes) {
      const answer = await askHuman('WARN decision. Type YES to confirm this payment, anything else to abort: ');
      if (answer.trim() !== 'YES') {
        return { ...base, refused: 'human declined at prompt' };
      }
    } else {
      return { ...base, refused: gate.needsHuman ? 'human confirmation required (re-run with --yes)' : 'blocked decision' };
    }
  }

  // Gate passed: sign with the selected key. Failures AFTER this point are
  // on-chain / RPC failures, and the tx hash (if any) is reported honestly.
  const privateKey = keyKind === 'full' ? config.fullPrivateKey : config.fcPrivateKey;
  if (!privateKey) {
    return { ...base, error: `No private key configured for keyKind='${keyKind}'. Run npm run setup first.` };
  }
  const provider = new JsonRpcProvider({ url: config.rpcUrl });
  const account = new Account(from, provider, privateKey);

  try {
    let response;
    if (intent === 'transfer') {
      response = await account.signAndSendTransaction({
        receiverId: receiver,
        actions: [actions.transfer(nearToYocto(String(amountNear)))],
        throwOnFailure: false,
      });
    } else {
      response = await account.signAndSendTransaction({
        receiverId: receiver,
        actions: [actions.functionCall(methodName, args, gas, BigInt(depositYocto))],
        throwOnFailure: false,
      });
    }
    const txHash = response?.transaction?.hash || null;
    const status = response?.status || response?.final_execution_status;
    const success = JSON.stringify(status).includes('SuccessValue') || status === 'EXECUTED' || status === 'EXECUTED_OPTIMISTIC';
    return {
      ...base,
      sent: true,
      success,
      txHash,
      explorerUrl: txHash ? config.explorerTx(txHash) : null,
      status: JSON.parse(JSON.stringify(status, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
      rawStatus: String(JSON.stringify(response?.status || {})).slice(0, 300),
    };
  } catch (err) {
    return { ...base, sent: false, error: String(err?.message || err).slice(0, 500), errorType: err?.type || null };
  }
}
