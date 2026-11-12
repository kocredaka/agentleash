// Full counterparty check: blocklist + live RPC signals + live indexer history,
// then the pure decision in decide.js.
import { yoctoToNear } from 'near-api-js';
import { decide } from './decide.js';
import { loadBlocklist, findEntry } from './blocklist.js';
import { getRpcSignals, getHistorySignals, makeProvider } from './signals.js';

export async function checkReceiver({ receiver, from = null, amountNear = 0, intent = 'transfer', config }) {
  const provider = makeProvider(config.rpcUrl);
  const blocklist = loadBlocklist(config.blocklistPath);
  const blocklistEntry = findEntry(blocklist, receiver);

  const rpc = await getRpcSignals(provider, receiver);
  const history = await getHistorySignals({
    nearblocksBase: config.nearblocksBase,
    receiver,
    sender: from,
    isContract: rpc.isContract,
  });

  const signals = {
    receiver,
    exists: rpc.exists,
    isContract: rpc.isContract,
    codeHash: rpc.codeHash,
    balanceYocto: rpc.balanceYocto,
    balanceNear: rpc.balanceYocto !== null ? yoctoToNear(BigInt(rpc.balanceYocto)) : null,
    storageUsage: rpc.storageUsage,
    ageDays: history.ageDays,
    createdTxHash: history.createdTxHash || null,
    txCount: history.txCount,
    lastActivityDays: history.lastActivityDays,
    lastDeployDays: history.lastDeployDays,
    deployCount: history.deployCount ?? null,
    priorInteraction: history.priorInteraction,
    blocklistEntry,
    historyAvailable: history.historyAvailable,
    indexerError: history.indexerError,
  };

  const result = decide(signals, { intent, amountNear });
  return {
    ...result,
    signals,
    sources: {
      rpc: `view_account via ${config.rpcUrl}`,
      indexer: history.historyAvailable
        ? `NearBlocks API v3 (keyless) at ${config.nearblocksBase}`
        : `NearBlocks API v3 unreachable (${history.indexerError || 'unknown error'}); RPC-only decision`,
      blocklist: 'local file data/blocklist.json (demo; NOT a shared network)',
    },
  };
}
