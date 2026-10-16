const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('existing DevNestNyx manifest retains isolated account resources', () => {
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'app.json'), 'utf8'));
  assert.equal(config.name, 'DevNestNyx');
  assert.ok(config.repository.startsWith('https://github.com/'));
  assert.ok(config.repository.endsWith('/YaRoute-Dev'));
  for (const key of ['NYX_PUBLIC_URL', 'NYX_OAUTH_AUDIENCE', 'NYX_PRIVATE_OAUTH_SUBJECTS',
                    'NYX_STORAGE_ENCRYPTION_KEY', 'DATABASE_URL', 'RCLONE_CONFIG_B64',
                    'NYX_SHARED_ROOTS_JSON']) {
    assert.equal(config.env[key]?.required, true, key);
  }
  assert.equal(config.env.NYX_DEPLOYMENT_MODE.value, 'private');
  assert.equal(config.env.NYX_PUBLIC_CONNECTORS_ENABLED.value, 'false');
  assert.equal(config.env.NYX_SERVICE_NAME.value, 'DevNestNyx');
});

test('both read-only introspection surfaces use instance-specific identity', () => {
  const read = (path) => fs.readFileSync(path, 'utf8');
  assert.match(read('src/health.controller.ts'), /NYX_SERVICE_NAME/);
  assert.match(read('src/mcp/mcp-auth.service.ts'), /NYX_SERVICE_NAME/);
});
