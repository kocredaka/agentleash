// Signal gathering: LIVE on-chain/indexer data only. Nothing here is mocked.
// - RPC (near-api-js JsonRpcProvider): account existence, balance, code_hash.
// - NearBlocks API v3 (keyless, public): account creation time, recent txns,
//   contract deployments. Best-effort with a timeout; on failure the signals
//   degrade to RPC-only and the decision says so honestly.
// Timestamps from the indexer are nanosecond strings beyond Number precision,
// so age math uses BigInt.
import { JsonRpcProvider } from 'near-api-js';
import { EMPTY_CODE_HASH } from './config.js';

const NS_PER_MS = 1000000n;
const MS_PER_DAY = 86400000;

export function nsToDaysAgo(nsString) {
  if (nsString === null || nsString === undefined || nsString === '') return null;
  try {
    const nowNs = BigInt(Date.now()) * NS_PER_MS;
    const then = BigInt(nsString);
    const diffMs = Number((nowNs - then) / NS_PER_MS);
    if (!Number.isFinite(diffMs) || diffMs < 0) return 0;
    return diffMs / MS_PER_DAY;
  } catch {
    return null;
  }
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function getRpcSignals(provider, receiver) {
  try {
    const view = await provider.viewAccount({ accountId: receiver });
    return {
      exists: true,
      isContract: view.code_hash !== EMPTY_CODE_HASH,
      codeHash: view.code_hash,
      balanceYocto: view.amount != null ? view.amount.toString() : null,
      storageUsage: view.storage_usage != null ? view.storage_usage.toString() : null,
    };
  } catch (err) {
    const msg = String(err?.message || err);
    // near-api-js surfaces a missing account as an RPC query error.
    if (/does not exist|UnknownAccount|UNKNOWN_ACCOUNT|account .* not found/i.test(msg)) {
      return { exists: false, isContract: false, codeHash: null, balanceYocto: null, storageUsage: null };
    }
    throw err;
  }
}

export async function getHistorySignals({ nearblocksBase, receiver, sender, isContract }) {
  const base = nearblocksBase.replace(/\/$/, '');
  const out = {
    historyAvailable: false,
    indexerError: null,
    ageDays: null,
    txCount: null,
    lastActivityDays: null,
    lastDeployDays: null,
    priorInteraction: null,
  };
  try {
    const accountJson = await fetchJson(`${base}/v3/accounts/${encodeURIComponent(receiver)}`);
    const created = accountJson?.data?.created;
    if (created && created.block_timestamp) {
      out.ageDays = nsToDaysAgo(created.block_timestamp);
      out.createdTxHash = created.transaction_hash || null;
    }
    const txnsJson = await fetchJson(`${base}/v3/accounts/${encodeURIComponent(receiver)}/txns?limit=25`);
    const txns = Array.isArray(txnsJson?.data) ? txnsJson.data : [];
    out.txCount = txns.length;
    if (txns.length > 0 && txns[0].block_timestamp) {
      out.lastActivityDays = nsToDaysAgo(txns[0].block_timestamp);
    }
    if (sender) {
      const s = sender.toLowerCase();
      out.priorInteraction = txns.some((t) => {
        const signer = String(t.signer_account_id || '').toLowerCase();
        const recv = String(t.receiver_account_id || '').toLowerCase();
        const me = receiver.toLowerCase();
        return (signer === s && recv === me) || (signer === me && recv === s);
      });
    }
    if (isContract) {
      try {
        // Order is not guaranteed, so fetch several and take the NEWEST deploy.
        const depJson = await fetchJson(`${base}/v3/accounts/${encodeURIComponent(receiver)}/contract/deployments?limit=5`);
        const deps = Array.isArray(depJson?.data) ? depJson.data : [];
        const stamps = deps.map((d) => d.block?.block_timestamp).filter(Boolean);
        if (stamps.length > 0) {
          const newest = stamps.reduce((a, b) => (BigInt(a) > BigInt(b) ? a : b));
          out.lastDeployDays = nsToDaysAgo(newest);
          out.deployCount = deps.length;
        }
      } catch {
        // Deployments endpoint failing must not kill the whole history signal.
        out.lastDeployDays = null;
      }
    }
    out.historyAvailable = true;
  } catch (err) {
    out.indexerError = err?.name === 'AbortError' ? 'indexer request timed out' : String(err?.message || err);
    out.historyAvailable = false;
  }
  return out;
}

export function makeProvider(rpcUrl) {
  return new JsonRpcProvider({ url: rpcUrl });
}
