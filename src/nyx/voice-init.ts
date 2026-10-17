import path from 'node:path';
import { LoadedSource, ResourceRef, parseJson } from './runtime.schema';
import { NyxResourceStore, sha256 } from './resource-store.service';

/** Fail-closed Voice owner hydration. No synthetic Head data or implicit Area migration. */
export async function hydrateVoice(
  routes: Record<string, ResourceRef>,
  files: LoadedSource[],
  store: NyxResourceStore,
  checkScope: (ref: ResourceRef, key: string) => void,
): Promise<void> {
  const route = (key: string) => {
    const keys = Object.keys(routes).filter(k => k.toLowerCase() === key.toLowerCase());
    if (keys.length > 1) throw new Error('AMBIGUOUS_RESOURCE_ROUTE');
    return keys.length ? routes[keys[0]] : undefined;
  };
  const state = route('Voice.state');
  const config = route('Voice.config');
  if (!state || !config || state.area !== config.area) throw new Error('REQUIRED_SOURCE_UNAVAILABLE:Voice.routes');
  const root = path.posix.dirname(path.posix.dirname(state.path));
  if (path.posix.dirname(state.path) !== path.posix.join(root, '0_state') ||
      path.posix.dirname(config.path) !== path.posix.join(root, '0_state')) {
    throw new Error('VOICE_OWNER_ROUTE_INVALID');
  }
  const manifest = route('Voice.area_paths') ?? { area: state.area, path: path.posix.join(root, 'area_paths.json') };
  if (manifest.area !== state.area || manifest.path !== path.posix.join(root, 'area_paths.json')) {
    throw new Error('VOICE_OWNER_ROUTE_INVALID');
  }
  const required: Array<[string, ResourceRef]> = [
    ['Voice.area_paths', manifest], ['Voice.config', config], ['Voice.state', state],
  ];
  for (const [key, ref] of required) checkScope(ref, key);
  const read = async (key: string, ref: ResourceRef) => {
    let content: string;
    try { content = await store.read(ref); } catch { throw new Error('REQUIRED_SOURCE_UNAVAILABLE:' + key); }
    let parsed: Record<string, any>;
    try { parsed = parseJson(content) as Record<string, any>; }
    catch { throw new Error('VOICE_SOURCE_INVALID:' + key); }
    if (!parsed || parsed.area !== 'Voice') throw new Error('VOICE_SOURCE_INVALID:' + key);
    return { key, ref, content, parsed };
  };
  // The manifest determines owner file names; all three reads MUST succeed before a FIF is written.
  const m = await read(required[0][0], required[0][1]);
  if (path.posix.join(root, m.parsed?.config?.file ?? '') !== config.path ||
      path.posix.join(root, m.parsed?.central_mutable_state?.file ?? '') !== state.path) {
    throw new Error('VOICE_OWNER_ROUTE_MISMATCH');
  }
  // Validate ALL sources before changing the outgoing packet. A missing
  // state/config must not expose a partially hydrated Voice manifest.
  const verified = [m];
  for (const [key, ref] of required.slice(1)) verified.push(await read(key, ref));
  for (const source of verified) {
    const { key, ref } = source;
    const previous = files.find(f => f.ref.area === ref.area && f.ref.path === ref.path);
    if (previous) { previous.visible = true; continue; }
    files.push({
      key, ref, content: source.content, visible: true,
      bytes: Buffer.byteLength(source.content), sha256: sha256(source.content),
    });
  }
}
