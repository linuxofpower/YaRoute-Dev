/**
 * Bounded, explicitly invoked HeartBit SHADOW probe.
 *
 * A Heroku one-off command can invoke this program without creating another
 * always-on worker. It accepts a small local evidence file; future adapters
 * must supply independently verified live ToBit/Ledger/scheduler observations.
 * It has NO network, scheduler, database, or mutation capabilities.
 */
import { readFileSync, statSync } from 'node:fs';
import { assessHeartBitShadow } from './shadow-parity';
import type { HeartBitShadowInput } from './shadow-parity';

const MAX_EVIDENCE_BYTES = 64 * 1024;
type Result = {
  schema: 'nyx.heartbit.shadow-once.v1';
  status: string;
  mode: 'SHADOW_ONLY';
  execution: 'ON_DEMAND';
  workModeAllowed: false;
  dispatchAllowed: false;
  verifiedCycle: number | null;
  reasons: string[];
};

function output(result: Result): void {
  // Only aggregate status and reason codes; never print raw evidence or secrets.
  process.stdout.write(JSON.stringify(result) + '\n');
}

function status(status: string, reasons: string[] = [], verifiedCycle: number | null = null): Result {
  return { schema: 'nyx.heartbit.shadow-once.v1', status,
    mode: 'SHADOW_ONLY', execution: 'ON_DEMAND', workModeAllowed: false,
    dispatchAllowed: false, verifiedCycle, reasons };
}

export function runHeartBitShadowOnce(argv: string[], nowUtc: string = new Date().toISOString()): number {
  if (argv.length === 1 && argv[0] === '--self-check') {
    // Confirms only that the module is installed, NOT HeartBit runtime health.
    output(status('SELF_CHECK_ONLY', ['LIVE_EVIDENCE_NOT_LOADED']));
    return 0;
  }
  if (argv.length !== 2 || argv[0] !== '--input' || !argv[1] || argv[1].startsWith('-')) {
    output(status('INVALID_INVOCATION', ['USE_SELF_CHECK_OR_INPUT_FILE']));
    return 64;
  }
  try {
    const path = argv[1];
    const size = statSync(path).size;
    if (size <= 0 || size > MAX_EVIDENCE_BYTES) {
      output(status('INSUFFICIENT_EVIDENCE', ['EVIDENCE_SIZE_INVALID']));
      return 3;
    }
    const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<HeartBitShadowInput>;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      output(status('INSUFFICIENT_EVIDENCE', ['EVIDENCE_FORMAT_INVALID']));
      return 3;
    }
    // Do not trust a timestamp embedded in user/provider supplied evidence.
    const decision = assessHeartBitShadow({
      tobit: data.tobit ?? null,
      ledger: data.ledger ?? null,
      scheduler: data.scheduler ?? null,
      nowUtc,
      maxEvidenceAgeMinutes: 90,
    });
    output(status(decision.status, decision.reasons, decision.verifiedCycle));
    return decision.status === 'MATCH' ? 0 : decision.status === 'DRIFT' ? 2 : 3;
  } catch {
    // Fail closed, without logging potentially sensitive paths or JSON.
    output(status('INSUFFICIENT_EVIDENCE', ['EVIDENCE_READ_OR_VALIDATION_FAILED']));
    return 3;
  }
}

if (require.main === module) {
  process.exitCode = runHeartBitShadowOnce(process.argv.slice(2));
}
