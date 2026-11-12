// Minimal HTTP service wrapping the same check logic as the CLI (no framework).
//   GET  /health          -> { ok: true }
//   GET  /blocklist       -> local blocklist JSON (demo file)
//   POST /check           -> { receiver, from?, amountNear?, intent? } => full check result
// Run: npm run serve   (PORT env, default 3000)
import { createServer } from 'node:http';
import { getConfig, loadEnv } from './config.js';
import { checkReceiver } from './check.js';
import { loadBlocklist } from './blocklist.js';

const config = getConfig(loadEnv());
const PORT = Number(process.env.PORT || 3000);

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, service: 'agentleash', network: 'testnet' });
    if (req.method === 'GET' && req.url === '/blocklist') return send(res, 200, loadBlocklist(config.blocklistPath));
    if (req.method === 'GET' && req.url === '/') {
      return send(res, 200, {
        service: 'AgentLeash',
        usage: 'POST /check with JSON {receiver, from, amountNear, intent}',
        note: 'Testnet only. Blocklist is a local demo file, not a shared network.',
      });
    }
    if (req.method === 'POST' && req.url === '/check') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body || '{}');
      if (!parsed.receiver) return send(res, 400, { error: 'receiver is required' });
      const result = await checkReceiver({
        receiver: parsed.receiver,
        from: parsed.from || config.agentAccountId || null,
        amountNear: Number(parsed.amountNear || 0),
        intent: parsed.intent || 'transfer',
        config,
      });
      return send(res, 200, result);
    }
    return send(res, 404, { error: 'not found' });
  } catch (err) {
    return send(res, 500, { error: String(err?.message || err).slice(0, 300) });
  }
});

server.listen(PORT, () => console.log(`AgentLeash service listening on http://127.0.0.1:${PORT} (testnet)`));
