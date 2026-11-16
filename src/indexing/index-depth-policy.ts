import { createHash } from 'node:crypto';
import {
  prepareAuthorizedMetadataBatch,
  type AuthorizedDirectoryListing,
  type MetadataBatch,
  type MetadataScope,
} from './metadata-batch';

/**
 * Phase B policy: bounded, resumable directory traversal ONLY.
 *
 * This module is not an OAuth validator, a provider adapter, a Postgres journal,
 * or a runnable worker. The caller MUST independently authenticate the user,
 * verify the currently active connection/root on EVERY run, and durably lease
 * the one user's job before invoking it.
 */
export type IndexDepth = 'shallow' | 'normal' | 'deep';

export type IndexBudget = Readonly<{
  maxDepth: number;
  maxDirectoriesPerRun: number;
  maxEntriesPerRun: number;
  maxRuntimeMs: number;
  maxPendingDirectories: number;
}>;

export const INDEX_BUDGETS: Readonly<Record<IndexDepth, IndexBudget>> = Object.freeze({
  shallow: Object.freeze({
    maxDepth: 1, maxDirectoriesPerRun: 1, maxEntriesPerRun: 100,
    maxRuntimeMs: 30_000, maxPendingDirectories: 1,
  }),
  normal: Object.freeze({
    maxDepth: 3, maxDirectoriesPerRun: 24, maxEntriesPerRun: 1_200,
    maxRuntimeMs: 90_000, maxPendingDirectories: 2_000,
  }),
  deep: Object.freeze({
    maxDepth: 64, maxDirectoriesPerRun: 48, maxEntriesPerRun: 4_000,
    maxRuntimeMs: 120_000, maxPendingDirectories: 4_000,
  }),
});

export type PendingDirectory = Readonly<{ path: string; depth: number }>;

export type IndexTraversal = Readonly<{
  schema: 'nyx.tenant-index-traversal.v1';
  scopeKey: string;
  mode: IndexDepth;
  pending: PendingDirectory[];
  visited: string[];
  processedDirectories: number;
  processedEntries: number;
}>;

export type AdvanceIndexResult = Readonly<{
  status: 'PROGRESSED' | 'COMPLETE' | 'PAUSED_BUDGET' | 'BLOCKED_TRUNCATED';
  traversal: IndexTraversal;
  batch: MetadataBatch | null;
  reason: string | null;
}>;

function rootKey(scope: MetadataScope): string {
  // Validation is reused here; this is a digest for separation/deduplication,
  // never an authorization token.
  const checked = prepareAuthorizedMetadataBatch(
    { ...scope, relativePath: '' }, { readOnly: true, truncated: false, items: [] },
  ).scope;
  return createHash('sha256').update(JSON.stringify([
    checked.ownerId, checked.connectionId, checked.provider, checked.rootId,
  ])).digest('hex');
}

function assertBudgetMode(mode: unknown): asserts mode is IndexDepth {
  if (mode !== 'shallow' && mode !== 'normal' && mode !== 'deep') {
    throw new Error('INDEX_DEPTH_INVALID');
  }
}

/** Start only after independent OAuth and authorized-root validation. */
export function startIndexTraversal(scope: MetadataScope, mode: IndexDepth): IndexTraversal {
  assertBudgetMode(mode);
  if (scope.relativePath !== '') throw new Error('INDEX_SCOPE_MUST_BE_ROOT');
  const scopeKey = rootKey(scope);
  return {
    schema: 'nyx.tenant-index-traversal.v1', scopeKey, mode,
    pending: [{ path: '', depth: 0 }], visited: [],
    processedDirectories: 0, processedEntries: 0,
  };
}

function assertTraversal(value: IndexTraversal): void {
  if (!value || value.schema !== 'nyx.tenant-index-traversal.v1') {
    throw new Error('INDEX_CHECKPOINT_INVALID');
  }
  assertBudgetMode(value.mode);
  const budget = INDEX_BUDGETS[value.mode];
  if (!/^[0-9a-f]{64}$/.test(value.scopeKey) ||
      !Array.isArray(value.pending) || !Array.isArray(value.visited) ||
      value.pending.length > budget.maxPendingDirectories ||
      value.visited.length > 250_000 ||
      !Number.isSafeInteger(value.processedDirectories) || value.processedDirectories < 0 ||
      !Number.isSafeInteger(value.processedEntries) || value.processedEntries < 0) {
    throw new Error('INDEX_CHECKPOINT_INVALID');
  }
  const seen = new Set<string>();
  for (const dir of value.pending) {
    if (!dir || typeof dir.path !== 'string' ||
        !Number.isSafeInteger(dir.depth) || dir.depth < 0 ||
        dir.depth >= budget.maxDepth ||
        dir.path.length > 2048 ||
        dir.path.startsWith('/') || dir.path.endsWith('/') ||
        dir.path.includes('\\') || /[\u0000-\u001f\u007f]/.test(dir.path) ||
        (dir.path && dir.path.split('/').some(v => !v || v === '.' || v === '..')) ||
        seen.has(dir.path)) {
      throw new Error('INDEX_CHECKPOINT_INVALID');
    }
    seen.add(dir.path);
  }
  for (const visited of value.visited) {
    if (typeof visited !== 'string' || visited.length > 2048 ||
        seen.has(visited)) throw new Error('INDEX_CHECKPOINT_INVALID');
    seen.add(visited);
  }
}

/**
 * Advance one directory. Partial provider listings NEVER advance/checkpoint:
 * there is currently no pagination in listAuthorizedRoot, which returns
 * at most 100 entries, so a truncated directory must block, not disappear.
 *
 * runDirectories/runEntries and elapsedMs are caller-observed bounded metrics
 * for the current one-off run; durable job state is separate from this planner.
 */
export function advanceIndexTraversal(
  scope: MetadataScope,
  traversal: IndexTraversal,
  listing: AuthorizedDirectoryListing,
  runDirectories: number,
  runEntries: number,
  elapsedMs: number,
): AdvanceIndexResult {
  assertTraversal(traversal);
  if (scope.relativePath !== '' || traversal.scopeKey !== rootKey(scope)) {
    throw new Error('INDEX_SCOPE_MISMATCH');
  }
  const limits = INDEX_BUDGETS[traversal.mode];
  for (const count of [runDirectories, runEntries, elapsedMs]) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('INDEX_BUDGET_INPUT_INVALID');
    }
  }
  if (traversal.pending.length === 0) {
    return { status: 'COMPLETE', traversal, batch: null, reason: null };
  }
  if (runDirectories >= limits.maxDirectoriesPerRun ||
      runEntries >= limits.maxEntriesPerRun ||
      elapsedMs >= limits.maxRuntimeMs) {
    return { status: 'PAUSED_BUDGET', traversal, batch: null, reason: 'INDEX_RUN_BUDGET' };
  }
  const current = traversal.pending[0];
  const dirScope: MetadataScope = { ...scope, relativePath: current.path };
  const batch = prepareAuthorizedMetadataBatch(dirScope, listing);

  if (!batch.directoryComplete) {
    return {
      status: 'BLOCKED_TRUNCATED', traversal, batch: null,
      reason: 'INDEX_DIRECTORY_PAGINATION_REQUIRED',
    };
  }
  if (runEntries + batch.entries.length > limits.maxEntriesPerRun) {
    return { status: 'PAUSED_BUDGET', traversal, batch: null, reason: 'INDEX_RUN_BUDGET' };
  }
  const next = traversal.pending.slice(1);
  const visitedSet = new Set(traversal.visited);
  const pendingSet = new Set(next.map(x => x.path));
  for (const entry of batch.entries) {
    const local = current.path ? entry.path.slice(current.path.length + 1) : entry.path;
    if (!local || local.includes('/') ||
        (current.path && !entry.path.startsWith(current.path + '/'))) {
      throw new Error('INDEX_ENTRY_NOT_IMMEDIATE_CHILD');
    }
    if (entry.type === 'directory' && current.depth + 1 < limits.maxDepth &&
        !visitedSet.has(entry.path) && !pendingSet.has(entry.path)) {
      if (next.length >= limits.maxPendingDirectories) {
        return {
          status: 'PAUSED_BUDGET', traversal, batch: null,
          reason: 'INDEX_PENDING_DIRECTORY_LIMIT',
        };
      }
      next.push({ path: entry.path, depth: current.depth + 1 });
      pendingSet.add(entry.path);
    }
  }
  const updated: IndexTraversal = {
    ...traversal, pending: next,
    visited: [...traversal.visited, current.path],
    processedDirectories: traversal.processedDirectories + 1,
    processedEntries: traversal.processedEntries + batch.entries.length,
  };
  return {
    status: next.length ? 'PROGRESSED' : 'COMPLETE',
    traversal: updated, batch, reason: null,
  };
}
