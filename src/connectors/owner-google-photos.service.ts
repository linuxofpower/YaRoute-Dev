import { Injectable } from '@nestjs/common';
import { RcloneService } from '../storage/rclone.service';
import { assertOwnerGooglePhotos, googlePhotosRelativePath } from './owner-google-photos.policy';

type PhotosEntry = { Path?: unknown; IsDir?: unknown; Size?: unknown; ModTime?: unknown };

/**
 * Owner-only, read-only diagnostics for a pre-existing private gphotos_yaro.
 * Does not accept credentials, configure a remote, download or upload files.
 * This is NOT a route for the public multi-tenant Rclone service.
 */
@Injectable()
export class OwnerGooglePhotosService {
  constructor(private readonly rclone: RcloneService) {}

  private check(ownerId: string) {
    assertOwnerGooglePhotos(ownerId);
    if (!this.rclone.isGooglePhotosRemoteReadOnly('gphotos_yaro')) {
      throw new Error('GPHOTOS_READONLY_REMOTE_REQUIRED');
    }
  }

  async probe(ownerId: string) {
    this.check(ownerId);
    const connectivity = await this.rclone.probeRemoteRead('gphotos_yaro');
    return { schema: 'nyx.gphotos.owner.v1', remote: 'gphotos_yaro',
      connectivity, readOnly: true, uploadsAllowed: false };
  }

  async list(ownerId: string, relativePath = '') {
    // Authorize before accessing the Rclone config or creating a subprocess.
    assertOwnerGooglePhotos(ownerId);
    const path = googlePhotosRelativePath(relativePath);
    this.check(ownerId);
    let raw: unknown;
    try {
      const result = await this.rclone.run(['lsjson', 'gphotos_yaro:' + path,
        '--max-depth', '1'], 512 * 1024, 25000);
      raw = JSON.parse(result.stdout);
    } catch {
      // Never send provider stderr or raw rclone output back to an MCP caller.
      throw new Error('GPHOTOS_LIST_FAILED');
    }
    if (!Array.isArray(raw) || raw.length > 10000) {
      throw new Error('GPHOTOS_LIST_INVALID');
    }
    const entries = (raw as PhotosEntry[]).map(entry => {
      if (!entry || typeof entry.Path !== 'string' ||
          entry.Path.length > 1024 || typeof entry.IsDir !== 'boolean') {
        throw new Error('GPHOTOS_LIST_INVALID');
      }
      return {
        path: entry.Path,
        isDir: entry.IsDir,
        size: typeof entry.Size === 'number' && Number.isSafeInteger(entry.Size) &&
          entry.Size >= 0 ? entry.Size : null,
        captureDateCandidate: typeof entry.ModTime === 'string' &&
          /^\d{4}-\d{2}-\d{2}T/.test(entry.ModTime) ? entry.ModTime : null,
      };
    });
    return { schema: 'nyx.gphotos.owner.v1', remote: 'gphotos_yaro',
      path, entries: entries.slice(0, 100), truncated: entries.length > 100,
      readOnly: true, uploadsAllowed: false,
      notice: 'Metadata date is not yet independently verified as original capture time.' };
  }
}
