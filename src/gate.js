// The signing gate. Pure and unit-tested. This is the one place that decides
// whether a decision permits signing. A `block` can NEVER be overridden:
// --force / --yes / any flag is ignored, and the caller must not sign.
//
// Returns: { allowed: boolean, needsHuman: boolean, message: string }
export function gateDecision(decision, { yes = false, force = false } = {}) {
  if (decision === 'block') {
    return {
      allowed: false,
      needsHuman: false,
      message: force
        ? 'BLOCKED: refusing to sign. The --force flag was supplied and IGNORED: block decisions cannot be overridden.'
        : 'BLOCKED: refusing to sign.',
    };
  }
  if (decision === 'warn') {
    if (yes) {
      return { allowed: true, needsHuman: false, message: 'WARN acknowledged by explicit human confirmation (--yes). Proceeding.' };
    }
    return {
      allowed: false,
      needsHuman: true,
      message: 'WARN: human confirmation required. Re-run with --yes after reviewing the reasons, or abort.',
    };
  }
  return { allowed: true, needsHuman: false, message: 'ALLOW: proceeding.' };
}
