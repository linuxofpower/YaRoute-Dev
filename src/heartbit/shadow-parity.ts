/**
 * Read-only HeartBit parity gate for the first NestNyx shadow migration phase.
 *
 * Deliberately has no scheduler, network, database, worker or mutation imports.
 * Callers must supply fresh independent Ledger, ToBit and live-scheduler evidence.
 */
export const HEARTBIT_WORK_MODE_ALLOWED = false as const;
export const HEARTBIT_SHADOW_DISPATCH_ALLOWED = false as const;
const IDS = ['W1', 'W2', 'W3', 'W4'] as const;
export type HeartBitWorkerId = (typeof IDS)[number];
export type HeartBitWorkerState = 'available' | 'assigned' | 'running' | 'blocked';
export interface HeartBitWorkerSnapshot {
  id: HeartBitWorkerId;
  state: HeartBitWorkerState;
  taskInstanceId: string | null;
  schedulerEnabled: boolean;
}
export interface HeartBitAuthority {
  head: string;
  body: string;
  footer: string;
}
export interface HeartBitShadowSource {
  observedAtUtc: string;
  verifiedCycle: number;
  authority: HeartBitAuthority;
  /** Must be explicit false. Missing evidence is not interpreted as false. */
  workModeAllowed: boolean;
  workers: HeartBitWorkerSnapshot[];
}
export interface HeartBitLiveScheduler {
  observedAtUtc: string;
  coordinatorEnabled: boolean;
  workers: Record<HeartBitWorkerId, boolean>;
}
export interface HeartBitShadowInput {
  tobit: HeartBitShadowSource | null;
  ledger: HeartBitShadowSource | null;
  scheduler: HeartBitLiveScheduler | null;
  nowUtc: string;
  /** Evidence older than this cannot establish shadow parity. Default: 90 minutes. */
  maxEvidenceAgeMinutes?: number;
}
export interface HeartBitShadowDecision {
  status: 'MATCH' | 'DRIFT' | 'INSUFFICIENT_EVIDENCE';
  mode: 'SHADOW_ONLY';
  dispatchAllowed: false;
  workModeAllowed: false;
  verifiedCycle: number | null;
  reasons: string[];
}
const canonical = (a: HeartBitAuthority): string => a.head + '/' + a.body + '/' + a.footer;
const validCycle = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;
function isFresh(iso: string, now: number, maxMs: number): boolean {
  const instant = Date.parse(iso);
  return Number.isFinite(instant) && now - instant >= -120000 && now - instant <= maxMs;
}
function workerIndex(rows: HeartBitWorkerSnapshot[]): Map<string, HeartBitWorkerSnapshot> | null {
  if (rows.length !== IDS.length) return null;
  const index = new Map<string, HeartBitWorkerSnapshot>();
  for (const worker of rows) {
    if (!IDS.includes(worker.id) || index.has(worker.id)) return null;
    if (!['available', 'assigned', 'running', 'blocked'].includes(worker.state)) return null;
    if (worker.state === 'available' && worker.taskInstanceId !== null) return null;
    if (worker.state !== 'available' && !worker.taskInstanceId) return null;
    index.set(worker.id, worker);
  }
  return index.size === IDS.length ? index : null;
}
/** Fail closed: matching observations never authorize scheduling or dispatch. */
export function assessHeartBitShadow(input: HeartBitShadowInput): HeartBitShadowDecision {
  const reasons: string[] = [];
  const now = Date.parse(input.nowUtc);
  const age = input.maxEvidenceAgeMinutes ?? 90;
  if (!Number.isFinite(now) || !Number.isFinite(age) || age <= 0 || age > 1440) {
    return { status: 'INSUFFICIENT_EVIDENCE', mode: 'SHADOW_ONLY', dispatchAllowed: false,
      workModeAllowed: false, verifiedCycle: null, reasons: ['INVALID_TIME_OR_EVIDENCE_WINDOW'] };
  }
  if (!input.tobit || !input.ledger || !input.scheduler) {
    return { status: 'INSUFFICIENT_EVIDENCE', mode: 'SHADOW_ONLY', dispatchAllowed: false,
      workModeAllowed: false, verifiedCycle: null, reasons: ['MISSING_INDEPENDENT_OBSERVATION'] };
  }
  const { tobit, ledger, scheduler } = input;
  if (![tobit.observedAtUtc, ledger.observedAtUtc, scheduler.observedAtUtc]
    .every(t => isFresh(t, now, age * 60000))) reasons.push('MISSING_FRESH_EVIDENCE');
  if (!validCycle(tobit.verifiedCycle) || !validCycle(ledger.verifiedCycle)) reasons.push('INVALID_VERIFIED_CYCLE');
  if (tobit.workModeAllowed !== false || ledger.workModeAllowed !== false) reasons.push('WORK_MODE_NOT_FORBIDDEN');
  const tw = workerIndex(tobit.workers);
  const lw = workerIndex(ledger.workers);
  if (!tw || !lw) reasons.push('INVALID_WORKER_EVIDENCE');
  if (reasons.length) return { status: 'INSUFFICIENT_EVIDENCE', mode: 'SHADOW_ONLY',
    dispatchAllowed: false, workModeAllowed: false, verifiedCycle: null, reasons };
  if (tobit.verifiedCycle !== ledger.verifiedCycle) reasons.push('CYCLE_DRIFT');
  if (canonical(tobit.authority) !== canonical(ledger.authority)) reasons.push('AUTHORITY_DRIFT');
  if (!scheduler.coordinatorEnabled) reasons.push('COORDINATOR_DISABLED');
  for (const id of IDS) {
    const t = tw!.get(id)!;
    const l = lw!.get(id)!;
    if (t.state !== l.state || t.taskInstanceId !== l.taskInstanceId) reasons.push(id + '_LEASE_DRIFT');
    if (!scheduler.workers || typeof scheduler.workers[id] !== 'boolean' ||
      t.schedulerEnabled !== scheduler.workers[id] || l.schedulerEnabled !== scheduler.workers[id])
      reasons.push(id + '_SCHEDULER_DRIFT');
    if (scheduler.workers?.[id] === false) reasons.push(id + '_SCHEDULER_DISABLED');
  }
  return { status: reasons.length ? 'DRIFT' : 'MATCH', mode: 'SHADOW_ONLY',
    dispatchAllowed: false, workModeAllowed: false,
    verifiedCycle: tobit.verifiedCycle, reasons };
}
