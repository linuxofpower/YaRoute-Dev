/**
 * Fail-closed gate for the legacy gphotos_yaro remote. This policy receives an
 * MCP owner derived from a signature-verified JWT, never an email or identity
 * supplied in a tool argument. A Google-social subject is not proof of email:
 * the operator must verify the subject-to-email mapping before opting in.
 *
 * This feature is private-Dev/Tester only. Public tenants must never load the
 * process-wide Rclone configuration, even when the public user is the owner.
 */
export function assertOwnerGooglePhotos(
  ownerId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const subject = (env.NYX_GPHOTOS_OWNER_MCP_SUBJECT || '').trim();
  const entries = (env.NYX_PRIVATE_OAUTH_SUBJECTS || '').split(',');
  const approvedEmail = (env.NYX_PRIVATE_LEGACY_OWNER_GOOGLE_EMAIL || '').trim().toLowerCase();
  if (env.NYX_GPHOTOS_OWNER_READ_ENABLED !== 'true' ||
      env.NYX_DEPLOYMENT_MODE !== 'private' ||
      env.NYX_SERVICE_NAME === 'NestNyxPro' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approvedEmail) ||
      env.NYX_GPHOTOS_OWNER_GOOGLE_EMAIL?.trim().toLowerCase() !== approvedEmail ||
      typeof env.NYX_OAUTH_ISSUER !== 'string' ||
      !/^https:\/\/[A-Za-z0-9.-]+\/?$/.test(env.NYX_OAUTH_ISSUER) ||
      !/^google-oauth2\|[A-Za-z0-9_-]{8,128}$/.test(subject) ||
      entries.length !== 1 || entries[0] !== subject ||
      env.NYX_PRIVATE_LEGACY_OWNER_MCP_SUBJECT !== subject ||
      ownerId !== `oauth:${subject}`) {
    throw new Error('GPHOTOS_OWNER_ACCESS_DENIED');
  }
}

/** Restrict all calls to the existing remote, without alternate aliases. */
export function googlePhotosRelativePath(value: string): string {
  if (typeof value !== 'string' || value.length > 1024 ||
      value.startsWith('/') || /[:\\\x00-\x1f\x7f]/.test(value) ||
      value.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('GPHOTOS_PATH_INVALID');
  }
  return value;
}
