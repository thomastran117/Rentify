import type { CacheService } from "@/features/cache/cache.service";
import { EmailChangeStore } from "@/features/auth/email-change/email-change.store";
import {
  getPendingEmailChangeAddressKey,
  getPendingEmailChangeKey,
} from "@/features/auth/email-change/email-change-keys";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9100, 100);
const OTHER_USER_ID = testUuid(9100, 200);
const NEW_EMAIL = "owner-one-new@rentify.local";

function createCache() {
  return {
    get: jest.fn(async () => null as string | null),
    getJson: jest.fn(async () => null as unknown),
    setJson: jest.fn(async () => undefined),
    setIfNotExists: jest.fn(async () => true),
    claimOrExtend: jest.fn(async () => true),
    deleteIfEquals: jest.fn(async () => true),
    expire: jest.fn(async () => true),
    delete: jest.fn(async () => true),
    ttl: jest.fn(async () => 600),
    acquireLock: jest.fn(async () => ({ release: jest.fn() })),
  };
}

function createStore() {
  const cache = createCache();
  return {
    cache,
    store: new EmailChangeStore(cache as unknown as CacheService),
  };
}

function createRecord() {
  return {
    userId: USER_ID,
    currentEmail: "owner1@rentify.local",
    newEmail: NEW_EMAIL,
    requestedAt: "2026-09-07T00:00:00.000Z",
  };
}

describe("EmailChangeStore reservations", () => {
  /**
   * Claim-or-refresh has to be one atomic step. Reading the holder and then
   * extending separately leaves a window where the reservation expires and
   * another user takes it, after which the extend renews *their* claim while
   * reporting success to the original caller.
   */
  it("claims an address through a single atomic call", async () => {
    const { store, cache } = createStore();

    await expect(store.reserveAddress(NEW_EMAIL, USER_ID, 600)).resolves.toBe(
      true,
    );
    expect(cache.claimOrExtend).toHaveBeenCalledWith(
      getPendingEmailChangeAddressKey(NEW_EMAIL),
      USER_ID,
      600,
    );
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.expire).not.toHaveBeenCalled();
    expect(cache.setIfNotExists).not.toHaveBeenCalled();
  });

  it("refuses an address another user is already claiming", async () => {
    const { store, cache } = createStore();
    cache.claimOrExtend.mockResolvedValue(false);

    await expect(store.reserveAddress(NEW_EMAIL, USER_ID, 600)).resolves.toBe(
      false,
    );
  });

  it("releases through a compare-and-delete rather than a bare delete", async () => {
    const { store, cache } = createStore();

    await store.releaseAddress(NEW_EMAIL, USER_ID);

    expect(cache.deleteIfEquals).toHaveBeenCalledWith(
      getPendingEmailChangeAddressKey(NEW_EMAIL),
      USER_ID,
    );
    expect(cache.delete).not.toHaveBeenCalled();
  });
});

describe("EmailChangeStore records", () => {
  it("writes the record under the user key with the given ttl", async () => {
    const { store, cache } = createStore();
    const record = createRecord();

    await store.write(record, 600);

    expect(cache.setJson).toHaveBeenCalledWith(
      getPendingEmailChangeKey(USER_ID),
      record,
      600,
    );
  });

  it("reports a floor of zero rather than redis's negative ttl sentinels", async () => {
    const { store, cache } = createStore();
    cache.ttl.mockResolvedValue(-2);

    await expect(store.readTtlInSeconds(USER_ID)).resolves.toBe(0);
  });

  it("clears both keys, releasing the address the record names", async () => {
    const { store, cache } = createStore();
    cache.getJson.mockResolvedValue(createRecord());

    await store.clear(USER_ID);

    expect(cache.deleteIfEquals).toHaveBeenCalledWith(
      getPendingEmailChangeAddressKey(NEW_EMAIL),
      USER_ID,
    );
    expect(cache.delete).toHaveBeenCalledWith(
      getPendingEmailChangeKey(USER_ID),
    );
  });

  it("still deletes the record key when nothing is pending", async () => {
    const { store, cache } = createStore();

    await store.clear(USER_ID);

    expect(cache.delete).toHaveBeenCalledTimes(1);
    expect(cache.deleteIfEquals).not.toHaveBeenCalled();
    expect(cache.delete).toHaveBeenCalledWith(
      getPendingEmailChangeKey(USER_ID),
    );
  });

  it("takes the confirm lock under a key of its own", async () => {
    const { store, cache } = createStore();

    await store.acquireConfirmLock(USER_ID);

    expect(cache.acquireLock).toHaveBeenCalledWith(
      `auth:pending-email-change-confirm:${USER_ID}`,
      10_000,
    );
  });
});
