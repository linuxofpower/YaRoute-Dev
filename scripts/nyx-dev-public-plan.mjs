#!/usr/bin/env node
/**
 * OFFLINE, read-only Dev public-pilot planning from a sanitized Heroku audit.
 * Does not invoke Heroku, connect to Pro, read credential values, or change
 * runtime configuration. It never certifies live two-user security.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REQUIRED_SCHEMA = 'nyx.heroku-two-app-audit.v1';
const DEV_NAME = 'dev-nest-nyx';

/** Only previously sanitized audit booleans/feature flags are examined. */
export function analyzeDevAudit(audit) {
  if (!audit || audit.schema !== REQUIRED_SCHEMA ||
      !audit.dev || audit.dev.name !== DEV_NAME ||
      typeof audit.dev.flags !== 'object' || !audit.dev.flags ||
      typeof audit.dev.hasLegacyPrivateRcloneConfig !== 'boolean' ||
      typeof audit.dev.hasEncryptedDatabase !== 'boolean' ||
      typeof audit.dev.databaseHostMatchesPublicNeon !== 'boolean' ||
      typeof audit.dev.publicUrlMatchesHeroku !== 'boolean') {
    throw new Error('INVALID_SANITIZED_AUDIT');
  }
  const dev = audit.dev;
  const f = dev.flags;
  const checks = {
    modePublic: f.NYX_DEPLOYMENT_MODE === 'public',
    publicConnectorsEnabled: f.NYX_PUBLIC_CONNECTORS_ENABLED === 'true',
    tenantRcloneEnabled: f.NYX_MULTIUSER_RCLONE_ENABLED === 'true',
    driveAndMegaEnabled: f.NYX_PUBLIC_TENANT_GOOGLE_MULTI_ENABLED === 'true' &&
      f.NYX_PUBLIC_TENANT_MEGA_ONLY === 'false',
    legacyPrivateRemotesAbsent: !dev.hasLegacyPrivateRcloneConfig,
    encryptedTenantDatabasePresent: dev.hasEncryptedDatabase,
    publicNeonHostMatched: dev.databaseHostMatchesPublicNeon,
    publicOriginMatched: dev.publicUrlMatchesHeroku,
  };
  const explanations = {
    modePublic: 'Existing Dev must be explicitly in public mode',
    publicConnectorsEnabled: 'Enable public connector-only routing',
    tenantRcloneEnabled: 'Enable owner-scoped Rclone connections',
    driveAndMegaEnabled: 'Enable Google Drive and MEGA, not MEGA-only mode',
    legacyPrivateRemotesAbsent: 'Remove inherited private Rclone/owner configuration from Dev after a verified private backup',
    encryptedTenantDatabasePresent: 'Configure Dev-only encrypted tenant database and key through protected settings',
    publicNeonHostMatched: 'Point Dev to its existing separate free nestnyx-public Neon endpoint',
    publicOriginMatched: 'Verify Dev HTTPS origin against its configured public URL',
  };
  const blockers = Object.entries(checks).filter(([,passed]) => !passed)
    .map(([id]) => ({id, action: explanations[id]}));
  return {
    schema: 'nyx.dev-public-plan.v1',
    source: 'sanitized-audit-file',
    changesApplied: false,
    herokuCalls: 0,
    proCalls: 0,
    proMutation: false,
    protectedBranchMutation: false,
    proDeferred: true,
    checks,
    blockers,
    devConfigurationPrepared: blockers.length === 0,
    // A sanitized audit cannot prove authorization, deployed feature exposure,
    // encryption separation from Pro, or provider consent for two real users.
    liveTwoUserSecurityVerified: false,
    inviteSecondUser: false,
    next: blockers.length ?
      'Continue Dev/Tester fixes and prepare operator-only Dev cutover; do not invite a second user' :
      'Perform separate authenticated runtime, secret-isolation and two-user acceptance tests before inviting a second user',
  };
}

function main() {
  const args=process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--audit-file')
    throw new Error('USAGE');
  // Operator-provided audit must contain only the sanitized JSON from
  // scripts/nyx-heroku-two-app-audit.mjs, never raw Heroku configuration.
  const audit = JSON.parse(readFileSync(args[1], 'utf8'));
  const plan=analyzeDevAudit(audit);
  process.stdout.write(JSON.stringify(plan,null,2)+'\n');
  if (!plan.devConfigurationPrepared) process.exitCode=2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); }
  catch { process.stderr.write('NYX_DEV_PUBLIC_PLAN_INPUT_INVALID\n'); process.exitCode=3; }
}
