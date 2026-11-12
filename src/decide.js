// Pure decision logic: allow / warn / block. No network, no I/O, fully unit-tested.
// Signals come from src/signals.js (live RPC + NearBlocks indexer + local blocklist).
// `decide` never sees a private key and never signs anything.

/**
 * @param {object} s signals
 * @param {boolean} s.exists - account exists on chain (RPC view_account)
 * @param {boolean} s.isContract - code_hash differs from the empty-code hash
 * @param {number|null} s.ageDays - account age from indexer creation record, null = unknown
 * @param {number|null} s.txCount - txs returned in the recent indexer window, null = unknown
 * @param {number|null} s.lastDeployDays - days since last contract deploy, null = n/a or unknown
 * @param {boolean|null} s.priorInteraction - sender<->receiver tx found in recent window, null = unknown
 * @param {object|null} s.blocklistEntry - matching local blocklist entry or null
 * @param {boolean} s.historyAvailable - indexer queries succeeded
 * @param {object} opts { intent: 'transfer'|'call', amountNear: number }
 */
export function decide(s, opts = {}) {
  const intent = opts.intent || 'transfer';
  const amountNear = Number(opts.amountNear || 0);
  const reasons = [];
  let decision = 'allow';

  const warn = (r) => { if (decision === 'allow') decision = 'warn'; reasons.push(r); };
  const block = (r) => { decision = 'block'; reasons.push(r); };

  // 1. Shared/local blocklist wins over everything, even for nonexistent accounts.
  if (s.blocklistEntry) {
    block(`BLOCKLIST: ${s.receiver} is on the local blocklist: ${s.blocklistEntry.reason} (reported by ${s.blocklistEntry.reportedBy || 'unknown'}).`);
    return finish();
  }

  // 2. A function call needs a real contract at the receiver.
  if (intent === 'call') {
    if (!s.exists) { block(`Receiver ${s.receiver} does not exist on chain; a contract call has nowhere to go.`); return finish(); }
    if (!s.isContract) { block(`Receiver ${s.receiver} has no contract code (plain account); refusing a contract call.`); return finish(); }
  }

  // 3. Freshly redeployed contract code: the code the agent audited may be gone.
  if (s.lastDeployDays !== null && s.lastDeployDays !== undefined && s.lastDeployDays < 1) {
    warn(`Contract code was (re)deployed ${fmtAge(s.lastDeployDays)} ago (< 24h).`);
  }

  // 4. Brand-new account.
  if (s.ageDays !== null && s.ageDays !== undefined && s.ageDays < 1) {
    warn(`Account was created ${fmtAge(s.ageDays)} ago (< 24h).`);
  }

  // 5. Young account with no prior interaction with this agent.
  if (s.ageDays !== null && s.ageDays !== undefined && s.ageDays < 7 && s.priorInteraction !== true) {
    warn(`Account is ${fmtAge(s.ageDays)} old (< 7 days) with no prior interaction with the sender in the recent window.`);
  }

  // 6. Large amount to a counterparty with no established history.
  if (amountNear >= 1 && s.priorInteraction !== true) {
    warn(`Amount ${amountNear} NEAR is large (>= 1 NEAR) for a counterparty with no prior interaction.`);
  }

  // 7. Dormant account: indexer reachable but no transactions at all in the window.
  if (s.historyAvailable && s.txCount === 0) {
    warn('No transactions found for this account in the indexer window (dormant or fresh account).');
  }

  // 8. Indexer unreachable: RPC-only signals. Escalate only for non-trivial amounts.
  if (!s.historyAvailable && amountNear >= 0.05) {
    warn('History indexer unreachable; decision is based on RPC-only signals. Human confirmation required for this amount.');
  }

  // 9. Transfer to an account that does not exist yet would create it (typo risk).
  if (intent === 'transfer' && !s.exists) {
    warn(`Receiver ${s.receiver} does not exist yet; a transfer would create the account (check for typos).`);
  }

  // Factual summary lines (always included, so a human can audit the decision).
  if (s.exists) {
    reasons.push(`On-chain: account exists, ${s.isContract ? 'is a contract' : 'plain account (no code)'}.`);
  }
  if (s.ageDays !== null && s.ageDays !== undefined) reasons.push(`Account age: ${fmtAge(s.ageDays)}.`);
  if (s.priorInteraction === true) reasons.push('Prior interaction between sender and receiver found in the recent window.');
  if (s.priorInteraction === false) reasons.push('No prior interaction between sender and receiver in the recent window.');
  if (!s.historyAvailable) reasons.push('History signals unavailable (indexer unreachable or no sender given); RPC-only decision.');
  if (decision === 'allow') reasons.push('No blocking or warning signal fired.');

  return finish();

  function finish() {
    return { decision, reasons, receiver: s.receiver, intent, amountNear };
  }
}

function fmtAge(days) {
  if (days < 1) {
    const hours = days * 24;
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minute(s)`;
    return `${hours.toFixed(1)} hour(s)`;
  }
  if (days < 365) return `${days.toFixed(1)} day(s)`;
  return `${(days / 365).toFixed(1)} year(s)`;
}
