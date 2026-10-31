import type { NyxBootstrapService } from './bootstrap.service';
import type { NyxCliRegistryService } from './cli-registry.service';
import type { NyxExecutionProfileService } from './execution-profile.service';
import type { NyxHeadLibraryService } from './head-library.service';

type Inspect = NyxExecutionProfileService['inspect'];

/**
 * Head status is read-only diagnostic traffic. An unavailable bootstrap must
 * not make this endpoint opaque or imply that a command may execute.
 * Mutating command routes still fail closed in NyxBootstrapService.
 */
export async function headStatusReport(
  bootstrap: Pick<NyxBootstrapService, 'locate'>,
  registry: Pick<NyxCliRegistryService, 'current'>,
  inspect: Inspect,
  head: Pick<NyxHeadLibraryService, 'snapshot'>,
) {
  const unavailable = (stage: 'bootstrap' | 'canonical_cli') => ({
    status: 'NOT_READY' as const,
    severity: 'HARD_BLOCK' as const,
    blockedScope: 'canonical_nyx_commands',
    diagnostic: stage === 'bootstrap'
      ? 'BOOTSTRAP_INVALID_OR_UNAVAILABLE'
      : 'CANONICAL_CLI_INVALID_OR_UNAVAILABLE',
    allowedIndependentWork: ['read_only_connector_diagnostics'],
    warningDisposition: 'DEFERRED_REPAIR_REQUIRES_REVIEW',
    mutation: 'none',
    canonicalVerified: false,
  });

  let locator: Awaited<ReturnType<NyxBootstrapService['locate']>>;
  try { locator = await bootstrap.locate(); }
  catch { return unavailable('bootstrap'); }

  let current: Awaited<ReturnType<NyxCliRegistryService['current']>>;
  try { current = await registry.current(locator); }
  catch { return unavailable('canonical_cli'); }

  const { cli, hash } = current;
  let preflight: Awaited<ReturnType<Inspect>>;
  try { preflight = await inspect(locator, hash); }
  catch { preflight = { ready: false, configured: true, error: 'EXECUTION_PROFILE_INVALID_OR_UNAVAILABLE', keys: [] }; }

  const keys = 'keys' in preflight && Array.isArray(preflight.keys) ? preflight.keys : [];
  const issues = keys.filter(key => key.status !== 'verified').map(key => ({
    key: key.key,
    severity: key.mode === 'observe' ? 'DEFERRED_WARNING' : 'HARD_BLOCK',
    status: key.status,
  }));
  const canExecute = preflight.ready;
  const drift = 'driftDetected' in preflight && preflight.driftDetected;
  return {
    status: canExecute ? (drift ? 'BOOTSTRAP_VERIFIED_WITH_WARNINGS' : 'BOOTSTRAP_VERIFIED') : 'NOT_READY',
    role: 'constitution-library',
    canonical: locator.canonical,
    canonical_freshness: 'bootstrap-pointer-only; newest Footer not independently checked',
    canonicalVerified: true,
    preflight,
    issues,
    ...(issues.some(issue => issue.severity === 'HARD_BLOCK') || !canExecute
      ? { blockedScope: 'canonical_nyx_commands' } : {}),
    cli: { version: cli.version, sha256: hash },
    library: head.snapshot(),
    source_of_truth: 'canonical Head bundle',
    mutation: 'read-only runtime cache; canonical Head lifecycle remains separate',
  };
}
