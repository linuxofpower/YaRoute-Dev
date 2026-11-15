/** A display-only label. The caller must supply only validated OAuth claims. */
export function signedProfileNickname(
  signed: { email: string | null; name: string | null } | undefined,
  fallback: string,
): string {
  return signed?.email || signed?.name || fallback;
}
