import { Module } from '@nestjs/common';
import { StorageConnectionsService } from './storage-connections.service';
import { TenantRcloneService } from './tenant-rclone.service';
import { GoogleDriveOAuthController } from './google-drive-oauth.controller';
import { MegaConnectController } from './mega-connect.controller';
import { JobStoreService } from './job-store.service';
import { JobWorkerService } from './job-worker.service';
import { RcloneService } from './rclone.service';
import { SharedRootsService } from './shared-roots.service';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

@Module({
  controllers: [StorageController, GoogleDriveOAuthController, MegaConnectController],
  providers: [TenantRcloneService, StorageConnectionsService, RcloneService, SharedRootsService, StorageService, JobStoreService, JobWorkerService],
  exports: [TenantRcloneService, StorageConnectionsService, RcloneService, SharedRootsService, StorageService, JobStoreService],
})
export class StorageModule {}
