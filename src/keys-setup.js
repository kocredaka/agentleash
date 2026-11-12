// Creates the scoped function-call access key with the owner's full-access key.
// The new key can ONLY call `methodNames` on `receiverId`, with a gas allowance.
// Its private key is written to .env (mode 600) by the caller-facing scripts;
// this module returns the public key + tx hash and never prints the secret.
import { KeyPair, PublicKey, Account, JsonRpcProvider, actions, nearToYocto } from 'near-api-js';

export async function createFunctionCallKey({ config, allowanceNear }) {
  const provider = new JsonRpcProvider({ url: config.rpcUrl });
  const owner = new Account(config.agentAccountId, provider, config.fullPrivateKey);
  const keyPair = KeyPair.fromRandom('ed25519');
  const publicKey = keyPair.getPublicKey();
  const allowance = nearToYocto(String(allowanceNear));
  const response = await owner.signAndSendTransaction({
    receiverId: config.agentAccountId,
    actions: [actions.addFunctionCallAccessKey(publicKey, config.scopedContractId, config.scopedMethods, allowance)],
    throwOnFailure: false,
  });
  const txHash = response?.transaction?.hash || null;
  const ok = JSON.stringify(response?.status || {}).includes('SuccessValue');
  if (!ok) {
    throw new Error(`addFunctionCallAccessKey failed: ${JSON.stringify(response?.status || {}).slice(0, 300)}`);
  }
  return {
    privateKey: keyPair.toString(),
    publicKey: publicKey.toString(),
    txHash,
    receiverId: config.scopedContractId,
    methodNames: config.scopedMethods,
    allowanceYocto: allowance.toString(),
  };
}

export async function listAccessKeys({ config }) {
  const provider = new JsonRpcProvider({ url: config.rpcUrl });
  const account = new Account(config.agentAccountId, provider);
  const list = await account.getAccessKeyList({ limit: 100 });
  return list.keys || list;
}

export { PublicKey };
