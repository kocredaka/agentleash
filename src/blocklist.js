// Local blocklist store. This is a LOCAL DEMO file, not a shared network:
// in production this would be a signed, shared feed with evidence per report.
// Entries carry a reason + evidence string so a human can judge the report.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function loadBlocklist(path) {
  if (!existsSync(path)) return { version: 1, entries: [] };
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(raw)) return { version: 1, entries: raw };
  return raw;
}

export function findEntry(blocklist, accountId) {
  const id = String(accountId).toLowerCase();
  return (blocklist.entries || []).find((e) => String(e.accountId).toLowerCase() === id) || null;
}

export function addReport(path, { accountId, reason, evidence, reportedBy }) {
  const list = loadBlocklist(path);
  const existing = findEntry(list, accountId);
  if (existing) {
    existing.reason = reason || existing.reason;
    existing.evidence = evidence || existing.evidence;
    existing.reportedBy = reportedBy || existing.reportedBy;
    existing.reportedAt = new Date().toISOString();
    existing.reports = (existing.reports || 1) + 1;
  } else {
    list.entries.push({
      accountId,
      reason: reason || 'Reported by an agent operator.',
      evidence: evidence || '',
      reportedBy: reportedBy || 'anonymous',
      reportedAt: new Date().toISOString(),
      reports: 1,
    });
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(list, null, 2) + '\n');
  return findEntry(list, accountId);
}
