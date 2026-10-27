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
