import fs from 'node:fs';

/** Only one independently authenticated tenant may supply credentials per invocation.
 * This check deliberately does not read config files or secret values. */
export const LEGACY_RCLONE_ENV_KEYS = [
  'RCLONE_CONFIG_B64',
  'RCLONE_CONFIG_PATH',
  'RCLONE_CONFIG',
  'NYX_SHARED_ROOTS_JSON',
] as const;

/**
 * Public tenant mode cannot coexist with the operator's private global Rclone
 * credential config. Call during application initialization, before accepting
 * any public user's request, even if tenant tools are feature-flagged off.
 * It does NOT remove, overwrite, export, or rotate credentials.
 */
export function assertPublicRcloneIsolation(
  env: Readonly<Record<string, string | undefined>> = process.env,
  exists: (path: string) => boolean = fs.existsSync,
): void {
  // Rclone also accepts individual remote credentials through
  // RCLONE_CONFIG_<REMOTE>_<OPTION> environment variables. Reject the entire
  // namespace, not only our historical RCLONE_CONFIG_B64 setting.
  if (Object.keys(env).some(key =>
    (key === 'RCLONE_CONFIG' || key.startsWith('RCLONE_CONFIG_') ||
     key === 'NYX_SHARED_ROOTS_JSON') && Boolean(env[key]?.trim()))) {
    throw new Error('PUBLIC_STORAGE_PRIVATE_CONFIG_PRESENT');
  }

  // Private RcloneService previously used /tmp/rclone.conf by default.
  // A stale copy must not remain readable in a public dyno.
  if (exists('/tmp/rclone.conf')) {
    throw new Error('PUBLIC_STORAGE_PRIVATE_CONFIG_FILE_PRESENT');
  }
}


/**
 * Explicitly opt-in to a public tenant backend while preserving the Heroku
 * *stored* private config values for rollback. In-memory env variables are
 * permanently removed from this Node process before Nest initializes.
 *
 * This is process-level credential quarantine, NOT equivalent to a distinct
 * OS/container security boundary. A leaked Heroku control-plane credential
 * can still reveal the stored values. Production public users should
 * eventually move to an app environment with no operator credentials at all.
 */
export function preparePublicRcloneEnvironment(
  env: Record<string, string | undefined> = process.env,
  exists: (filePath: string) => boolean = fs.existsSync,
): { publicMode: boolean; clearedCount: number } {
  if (env.NYX_DEPLOYMENT_MODE !== 'public') {
    return {publicMode:false,clearedCount:0};
  }
  if (env.NYX_PUBLIC_CONNECTORS_ENABLED !== 'true' ||
      env.NYX_MULTIUSER_RCLONE_ENABLED !== 'true') {
    throw new Error('PUBLIC_STORAGE_FEATURE_FLAGS_REQUIRED');
  }
  // Never start a public user-facing app while old private config material
  // remains accessible as an on-disk file, even if process.env is scrubbed.
  const configuredPaths = [
    '/tmp/rclone.conf', env.RCLONE_CONFIG_PATH, env.RCLONE_CONFIG,
  ].filter((value): value is string => !!value && value.startsWith('/'));
  if (configuredPaths.some(filePath => exists(filePath))) {
    throw new Error('PUBLIC_STORAGE_PRIVATE_CONFIG_FILE_PRESENT');
  }
  let clearedCount = 0;
  for (const key of Object.keys(env)) {
    if (key === 'RCLONE_CONFIG' || key.startsWith('RCLONE_CONFIG_') ||
        key === 'NYX_SHARED_ROOTS_JSON') {
      delete env[key];
      clearedCount++;
    }
  }
  // Strict post-condition before any Nest storage provider or MCP tools start.
  assertPublicRcloneIsolation(env, exists);
  return {publicMode:true,clearedCount};
}
