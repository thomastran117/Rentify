/**
 * Cache keys for an email change that has been requested but not yet confirmed.
 *
 * Two keys are kept per request, mirroring the pending-signup split: one by user
 * holding the record, and one by address holding the user id. The second is a
 * reservation — it is what stops two accounts racing to claim the same address
 * inside the ten-minute window, since neither has written a row yet.
 *
 * The address key is keyed by address rather than nested under the user because
 * the question it answers is "who is claiming this?", asked by a caller who
 * knows the address and not the user.
 *
 * These prefixes are deliberately distinct rather than sharing a root with a
 * discriminating segment, so a scan for one never matches the other.
 */

export const PENDING_EMAIL_CHANGE_CACHE_PREFIX = "auth:pending-email-change";
export const PENDING_EMAIL_CHANGE_ADDRESS_CACHE_PREFIX =
  "auth:pending-email-change-address";

export function getPendingEmailChangeKey(userId: string): string {
  return `${PENDING_EMAIL_CHANGE_CACHE_PREFIX}:${userId}`;
}

export function getPendingEmailChangeAddressKey(email: string): string {
  return `${PENDING_EMAIL_CHANGE_ADDRESS_CACHE_PREFIX}:${email
    .trim()
    .toLowerCase()}`;
}
