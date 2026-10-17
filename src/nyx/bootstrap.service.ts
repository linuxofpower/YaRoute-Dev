import { Injectable } from '@nestjs/common';
import { locatorSchema, Locator, parseJson, refSchema } from './runtime.schema';
import { NyxResourceStore } from './resource-store.service';

@Injectable()
export class NyxBootstrapService {
  constructor(private readonly store: NyxResourceStore) {}
  async locate(): Promise<Locator> {
    const configured = process.env.NYX_BOOTSTRAP_PATH;
    if (!configured) throw new Error('NYX_BOOTSTRAP_PATH_NOT_CONFIGURED');
    const area = process.env.NYX_INIT_AREA || 'MAIN';
    const ref = refSchema.parse({ area, path: configured });
    try {
      const located = locatorSchema.parse(parseJson(await this.store.read(ref, 64 * 1024)));
      const normal = located.paths.normal ?? this.configuredPath(process.env.NYX_NORMAL_PATHS_PATH, area);
      const deep = located.paths.deep ?? this.configuredPath(process.env.NYX_DEEP_PATHS_PATH, area) ?? (normal ? { ...normal, path: normal.path.replace(/n_paths\.json$/i, 'd_paths.json') } : undefined);
      const resolved = locatorSchema.parse({
        ...located,
        humanCli: located.humanCli ?? { area, path: process.env.NYX_CLI_MIRROR_PATH || 'Documents/Nyxpad/nyxcli.md' },
        paths: { ...located.paths, ...(normal ? { normal } : {}), ...(deep ? { deep } : {}) },
      });
      // Explicit expected CAN pointers are a release guard, not an alternative
      // Head authority. Reject stale private runtime configuration before INI.
      for (const [part, env] of [
        ['head', 'NYX_EXPECTED_CANONICAL_HEAD'],
        ['body', 'NYX_EXPECTED_CANONICAL_BODY'],
        ['footer', 'NYX_EXPECTED_CANONICAL_FOOTER'],
      ] as const) {
        const expected = process.env[env];
        if (expected && resolved.canonical[part] !== expected) {
          throw new Error('CANONICAL_POINTER_STALE:' + part);
        }
      }
      return resolved;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CANONICAL_POINTER_STALE:')) throw error;
      throw new Error('BOOTSTRAP_INVALID_OR_UNAVAILABLE');
    }
  }
  private configuredPath(value: string | undefined, area: string) {
    if (!value) return undefined;
    // Current public Heroku config uses repository-style `YaRoute/...` while MAIN stores the decorated root.
    const path = area === 'MAIN' && value.startsWith('YaRoute/') ? `🪼👁️📡${value}` : value;
    return refSchema.parse({ area, path });
  }
}
