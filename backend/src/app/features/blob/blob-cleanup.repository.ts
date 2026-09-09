import { BaseRepository } from "@/features/base/base.repository";
import { toAuditSnapshotRecord } from "@/features/organizations/audit/audit.model";

export interface BlobReferenceSourceCounts {
  profiles: number;
  organizations: number;
  blogPosts: number;
  postingPhotos: number;
  auditSnapshots: number;
}

export interface BlobReferenceSnapshot {
  blobNames: Set<string>;
  sourceCounts: BlobReferenceSourceCounts;
}

export class BlobCleanupRepository extends BaseRepository {
  async loadReferences(): Promise<BlobReferenceSnapshot> {
    return this.executeAsync(
      async () => {
        const [profiles, organizations, blogPosts, postingPhotos, auditLogs] =
          await Promise.all([
            this.prisma.profile.findMany({
              where: { avatarBlobName: { not: null } },
              select: { avatarBlobName: true },
            }),
            this.prisma.organization.findMany({
              where: { logoBlobName: { not: null } },
              select: { logoBlobName: true },
            }),
            this.prisma.organizationBlogPost.findMany({
              where: { coverImageBlobName: { not: null } },
              select: { coverImageBlobName: true },
            }),
            this.prisma.postingPhoto.findMany({
              select: { blobName: true, thumbnailBlobName: true },
            }),
            this.prisma.organizationAuditLog.findMany({
              where: {
                resourceType: "organization",
                restorable: true,
              },
              select: { beforeSnapshot: true, afterSnapshot: true },
            }),
          ]);

        const blobNames = new Set<string>();
        const add = (value: unknown): void => {
          if (typeof value !== "string") {
            return;
          }

          const normalized = value.trim();
          if (normalized) {
            blobNames.add(normalized);
          }
        };

        profiles.forEach((row) => add(row.avatarBlobName));
        organizations.forEach((row) => add(row.logoBlobName));
        blogPosts.forEach((row) => add(row.coverImageBlobName));
        postingPhotos.forEach((row) => {
          add(row.blobName);
          add(row.thumbnailBlobName);
        });
        auditLogs.forEach((row) => {
          add(toAuditSnapshotRecord(row.beforeSnapshot).logoBlobName);
          add(toAuditSnapshotRecord(row.afterSnapshot).logoBlobName);
        });

        return {
          blobNames,
          sourceCounts: {
            profiles: profiles.length,
            organizations: organizations.length,
            blogPosts: blogPosts.length,
            postingPhotos: postingPhotos.length,
            auditSnapshots: auditLogs.length,
          },
        };
      },
      { operationName: "loadReferences" },
    );
  }
}
