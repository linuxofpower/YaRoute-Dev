/**
 * Dev-only operator convenience CLI. The authoritative portable policy
 * compiles from src/runtime/public-mega-activation-preflight.ts and is
 * promoted with normal src/ files into Tester. No secrets are logged.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { publicMegaActivationPreflight } =
  require('../dist/runtime/public-mega-activation-preflight.js');
export { publicMegaActivationPreflight };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
// With Dev becoming public, the private reference is the existing Pro URL.
const oldPrivateOrigin = process.env.NYX_PRIVATE_PRO_URL || '';
const report = publicMegaActivationPreflight(process.env, {
  existingPrivateOrigin: oldPrivateOrigin,
});
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (report.status !== 'CONFIG_PREPARED_LIVE_TESTS_REQUIRED') process.exitCode = 2;
}
