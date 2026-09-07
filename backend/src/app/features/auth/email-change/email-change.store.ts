import type { CacheService } from "@/features/cache/cache.service";
import {
  getPendingEmailChangeAddressKey,
  getPendingEmailChangeKey,
} from "@/features/auth/email-change/email-change-keys";

export interface PendingEmailChangeRecord {
  userId: string;
  /**
   * Snapshot of the address the account held when the request started. Confirm
   * compares it against the row it is about to overwrite, so a change that
   * landed from another session in the meantime is refused rather than silently
   * reverted.
   */
  currentEmail: string;
  newEmail: string;
  requestedAt: string;
}

const PENDING_EMAIL_CHANGE_CONFIRM_LOCK_PREFIX =
  "auth:pending-email-change-confirm";
const PENDING_EMAIL_CHANGE_CONFIRM_LOCK_TTL_IN_MS = 10_000;

/**
 * An email change lives in the cache until the code sent to the new address is
 * confirmed, for the same reason a signup does: an address nobody has proven
 * control of must not occupy the unique column.
 *
 * Nothing here needs cleaning up on abandonment — both keys carry the OTP's TTL,
 * so walking away from the form is indistinguishable from never starting.
 */
export class EmailChangeStore {
  constructor(private readonly cacheService: CacheService) {}

  async read(userId: string): Promise<PendingEmailChangeRecord | null> {
    return this.cacheService.getJson<PendingEmailChangeRecord>(
      getPendingEmailChangeKey(userId),
    );
  }

  async readTtlInSeconds(userId: string): Promise<number> {
    const ttl = await this.cacheService.ttl(getPendingEmailChangeKey(userId));
    return ttl > 0 ? ttl : 0;
  }

  async write(
    record: PendingEmailChangeRecord,
    ttlInSeconds: number,
  ): Promise<void> {
    await this.cacheService.setJson(
      getPendingEmailChangeKey(record.userId),
      record,
      ttlInSeconds,
    );
  }

  /**
   * Claims an address for a user, or confirms they already hold it.
   *
   * `setIfNotExists` is what makes this safe under a race: two requests for the
   * same address cannot both succeed, so the loser gets a clean conflict instead
   * of silently overwriting the winner and having both users believe the address
   * is theirs until one of them hits the unique constraint.
   *
   * Re-requesting an address you already hold refreshes the TTL rather than
   * failing, so a user who restarts their own request is not locked out by their
   * own reservation.
   */
  async reserveAddress(
    email: string,
    userId: string,
    ttlInSeconds: number,
  ): Promise<boolean> {
    const key = getPendingEmailChangeAddressKey(email);
    const claimed = await this.cacheService.setIfNotExists(
      key,
      userId,
      ttlInSeconds,
    );

    if (claimed) {
      return true;
    }

    const holder = await this.cacheService.get(key);

    if (holder === userId) {
      await this.cacheService.expire(key, ttlInSeconds);
      return true;
    }

    return false;
  }

  async readAddressHolder(email: string): Promise<string | null> {
    return this.cacheService.get(getPendingEmailChangeAddressKey(email));
  }

  /**
   * Releases only a reservation this user actually holds. Deleting
   * unconditionally would let a stale cleanup path drop the claim another user
   * has since made on the same address.
   */
  async releaseAddress(email: string, userId: string): Promise<void> {
    const key = getPendingEmailChangeAddressKey(email);
    const holder = await this.cacheService.get(key);

    if (holder === userId) {
      await this.cacheService.delete(key);
    }
  }

  /**
   * Held across confirmation so two submissions of the same code cannot both
   * pass the OTP check and rotate the token version twice. `OtpService.verify`
   * reads then deletes, which leaves a window where concurrent callers both see
   * a live code.
   */
  acquireConfirmLock(userId: string) {
    return this.cacheService.acquireLock(
      `${PENDING_EMAIL_CHANGE_CONFIRM_LOCK_PREFIX}:${userId}`,
      PENDING_EMAIL_CHANGE_CONFIRM_LOCK_TTL_IN_MS,
    );
  }

  async clear(userId: string): Promise<void> {
    const record = await this.read(userId);

    if (record) {
      await this.releaseAddress(record.newEmail, userId);
    }

    await this.cacheService.delete(getPendingEmailChangeKey(userId));
  }
}
