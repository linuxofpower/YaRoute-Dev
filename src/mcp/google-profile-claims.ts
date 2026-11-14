import type { JwtPayload } from 'jsonwebtoken';

export type SignedGoogleProfile = {
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

/**
 * Profile metadata is optional: an OAuth ACCESS token commonly does not contain
 * the ID token's picture/name/email. Accept only claims in an already verified
 * issuer JWT; never fetch arbitrary profile URLs or accept a URL from the UI.
 * The Auth0 login Action may attach public-origin-namespaced claims.
 */
export function trustedGoogleAvatarUrl(candidate: unknown): string | null {
  if (typeof candidate !== 'string' || candidate.length > 2048) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' ||
        parsed.hostname !== 'lh3.googleusercontent.com' ||
        parsed.username || parsed.password || parsed.port || parsed.hash) return null;
    if (!parsed.pathname.startsWith('/') || parsed.pathname.length < 2) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function googleProfileFromVerifiedJwt(
  payload: JwtPayload, publicOrigin: string,
): SignedGoogleProfile {
  const namespace = publicOrigin.replace(/\/+$/, '') + '/claims/';
  // Namespaced claims avoid conflicts with standard JWT claim serialization.
  const verified = payload.email_verified === true ||
    payload[namespace + 'email_verified'] === true;
  const rawEmail = typeof payload[namespace + 'email'] === 'string'
    ? payload[namespace + 'email'] : payload.email;
  const email = verified && typeof rawEmail === 'string' &&
    /^[^\s@\x00-\x1f]{1,100}@[^\s@\x00-\x1f]{1,150}$/.test(rawEmail)
      ? rawEmail : null;
  const rawName = typeof payload[namespace + 'name'] === 'string'
    ? payload[namespace + 'name'] : payload.name;
  const name = typeof rawName === 'string' && rawName.trim().length > 0 &&
    rawName.length <= 120 && !/[\x00-\x1f\x7f]/.test(rawName)
      ? rawName.trim() : null;
  const rawPicture = payload[namespace + 'picture'] ?? payload.picture;
  return {email,name,avatarUrl:trustedGoogleAvatarUrl(rawPicture)};
}
