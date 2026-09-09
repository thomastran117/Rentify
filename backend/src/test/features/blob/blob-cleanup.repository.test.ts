import { BlobCleanupRepository } from "@/features/blob/blob-cleanup.repository";

describe("BlobCleanupRepository", () => {
  it("collects every direct and restorable audit blob reference", async () => {
    const database = {
      profile: {
        findMany: jest.fn(async () => [
          { avatarBlobName: "profiles/user/avatar.png" },
        ]),
      },
      organization: {
        findMany: jest.fn(async () => [
          { logoBlobName: " organizations/user/logo.png " },
        ]),
      },
      organizationBlogPost: {
        findMany: jest.fn(async () => [
          { coverImageBlobName: "organizations/user/blog/cover.jpg" },
        ]),
      },
      postingPhoto: {
        findMany: jest.fn(async () => [
          {
            blobName: "postings/user/photo.jpg",
            thumbnailBlobName: "postings/user/thumbnails/photo.webp",
          },
          {
            blobName: "postings/user/photo.jpg",
            thumbnailBlobName: null,
          },
        ]),
      },
      organizationAuditLog: {
        findMany: jest.fn(async () => [
          {
            beforeSnapshot: { logoBlobName: "organizations/user/old.png" },
            afterSnapshot: { logoBlobName: "" },
          },
          { beforeSnapshot: null, afterSnapshot: [] },
        ]),
      },
    };
    const repository = new BlobCleanupRepository(database as never);

    const result = await repository.loadReferences();

    expect(result.blobNames).toEqual(
      new Set([
        "profiles/user/avatar.png",
        "organizations/user/logo.png",
        "organizations/user/blog/cover.jpg",
        "postings/user/photo.jpg",
        "postings/user/thumbnails/photo.webp",
        "organizations/user/old.png",
      ]),
    );
    expect(result.sourceCounts).toEqual({
      profiles: 1,
      organizations: 1,
      blogPosts: 1,
      postingPhotos: 2,
      auditSnapshots: 2,
    });
    expect(database.organizationAuditLog.findMany).toHaveBeenCalledWith({
      where: { resourceType: "organization", restorable: true },
      select: { beforeSnapshot: true, afterSnapshot: true },
    });
  });
});
