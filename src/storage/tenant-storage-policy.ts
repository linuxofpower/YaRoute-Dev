/** Server-side tenant path policy. The MEGA credential itself is NOT folder-limited. */
export const TENANT_ACCOUNT_CAPS = { mega: 6, drive: 9 } as const;
export type TenantScopeMode = 'folder' | 'file' | 'unrestricted';
export type TenantScope = { mode: TenantScopeMode; root: string | null };

/** Strict POSIX-relative paths: no flags, traversal, URL escapes or separators. */
export function safeRelativePath(value: unknown, emptyOk = false): string {
  if (typeof value !== 'string' || value.length > 512 ||
      (!emptyOk && value.length === 0) ||
      value.startsWith('/') || value.endsWith('/') ||
      /[\\:%\x00-\x1f\x7f]/.test(value)) {
    throw new Error('STORAGE_SCOPE_PATH_INVALID');
  }
  if (value === '') return '';
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' ||
      part.startsWith('-'))) {
    throw new Error('STORAGE_SCOPE_PATH_INVALID');
  }
  return parts.join('/');
}

/** For file and folder mode the user MUST select an explicit root first. */
export function validateTenantScope(
  mode: unknown, root: unknown, confirmUnrestricted = false,
): TenantScope {
  if (mode !== 'file' && mode !== 'folder' && mode !== 'unrestricted') {
    throw new Error('STORAGE_SCOPE_MODE_INVALID');
  }
  if (mode === 'unrestricted') {
    if (root !== '' || !confirmUnrestricted) {
      throw new Error('STORAGE_UNRESTRICTED_CONFIRMATION_REQUIRED');
    }
    return { mode, root: '' };
  }
  return { mode, root: safeRelativePath(root) };
}

/** Reject unset folder defaults instead of silently exposing remote root. */
export function resolveTenantPath(
  scope: TenantScope, operation: 'list' | 'stat' | 'write', relative = '',
): string {
  if (!scope || !['file','folder','unrestricted'].includes(scope.mode)) {
    throw new Error('STORAGE_SCOPE_MODE_INVALID');
  }
  if (scope.root === null) {
    throw new Error('STORAGE_SCOPE_ROOT_NOT_SELECTED');
  }
  const requested = safeRelativePath(relative, true);
  if (scope.mode === 'unrestricted') {
    if (scope.root !== '') throw new Error('STORAGE_SCOPE_INVALID');
    return requested;
  }
  const root = safeRelativePath(scope.root);
  if (scope.mode === 'file') {
    if (operation === 'list' || requested) {
      throw new Error('STORAGE_FILE_SCOPE_DENIED');
    }
    return root;
  }
  return requested ? root + '/' + requested : root;
}
