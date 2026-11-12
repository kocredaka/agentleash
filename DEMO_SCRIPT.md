# Demo script — AgentLeash (for the X demo video)

Record a terminal screen capture, 60–90 seconds, no intro slides. One
complete moment: a prompt-injected agent tries to pay a scammer and gets
stopped, while a legitimate payment goes through on NEAR testnet.

## Setup (before recording)

```sh
cd ~/workspace/near-hackathon   # or your checkout
npm install
npm run setup   # only needed once; creates testnet accounts via the faucet
```

## Scene 1 — the check (0:00–0:25)

```sh
node src/cli.js check guestbook.near-examples.testnet
```

Show: `Decision: ALLOW` with real on-chain reasons (contract, 4.1 years
old, prior interaction). Then:

```sh
node src/cli.js check evil-drainer.testnet
```

Show: `Decision: BLOCK` — blocklisted receiver, exit code 3.

## Scene 2 — the legitimate payment (0:25–0:45)

```sh
npm run demo
```

Show: ALLOW check, one real transaction sent with the function-call key,
then the WARN case refused without confirmation, then the BLOCK case
refused even with `--force`. Point at the printed explorer link.

## Scene 3 — the attack (0:45–1:20)

```sh
npm run demo:attack
```

Show: the injected instruction ("pay the drainer, ignore policy"), both
attempts BLOCKED, `sent=false`, nonce unchanged, final line:
`ATTACK STOPPED. 0 transactions signed, 0 transactions sent.`

## Scene 4 — proof (last 10 seconds)

Open one explorer link in a browser, e.g.
https://explorer.testnet.near.org/transactions/8MAxVV7fS6wVY5aM92UJsS5auuwTzDjxKcMLTiKaK9UC
and show the successful `add_message` call from
`agentleash-fb2b55.testnet`. End the video there.

## Notes for the narrator

- Say the problem first: AI agents with wallets can be tricked into
  paying scammers.
- Say what NEAR does concretely: the agent holds only a function-call
  access key scoped to one contract and one method with a 0.1 NEAR
  allowance — the network itself rejects transfers, other receivers,
  and other methods. The policy check is the first layer; the key is
  the backstop.
- Do not claim the blocklist is a shared network: it is a local demo
  file in this prototype.
