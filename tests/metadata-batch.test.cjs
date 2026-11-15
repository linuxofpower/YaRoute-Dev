const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareAuthorizedMetadataBatch } = require('../dist/indexing/metadata-batch.js');

const scope = Object.freeze({
  ownerId: 'oauth:auth0|primary-test',
  connectionId: '4dc262bd-f27a-43b5-8e2d-d5fa761cb88f',
  provider: 'mega', rootId: 'MEGA_ROOT', relativePath: 'Documents',
});
const listing = (items, truncated = false) => ({readOnly: true, items, truncated});
const item = (path, isDir = false, size = 20) => ({path, isDir, size});

test('read-only one-directory sample preserves exact owner scope and sorted metadata', () => {
  const result = prepareAuthorizedMetadataBatch(scope, listing([
    item('z.txt'), item('Subdir', true, 0), item('a.txt', false, null),
  ]));
  assert.equal(result.schema, 'nyx.tenant-metadata-batch.v1');
  assert.equal(result.scope.ownerId, scope.ownerId);
  assert.equal(result.scope.connectionId, scope.connectionId);
  assert.deepEqual(result.entries, [
    {path: 'Documents/Subdir', type: 'directory', sizeBytes: null},
    {path: 'Documents/a.txt', type: 'file', sizeBytes: null},
    {path: 'Documents/z.txt', type: 'file', sizeBytes: 20},
  ]);
  assert.equal(result.directoryComplete, true);
  assert.equal(result.mayDeleteMissing, false);
  assert.equal(result.readOnly, true);
});

test('a truncated source is PARTIAL and never authorizes deleting absent entries', () => {
  const result = prepareAuthorizedMetadataBatch(scope, listing([item('a')], true));
  assert.equal(result.directoryComplete, false);
  assert.equal(result.mayDeleteMissing, false);
});

test('identical names in different OAuth owners yield distinct scope keys', () => {
  const a = prepareAuthorizedMetadataBatch(scope, listing([item('same.txt')]));
  const b = prepareAuthorizedMetadataBatch({...scope, ownerId: 'oauth:auth0|foreign'},
    listing([item('same.txt')]));
  assert.notEqual(a.scopeKey, b.scopeKey);
  assert.notDeepEqual(a.scope, b.scope);
});

test('no anonymous or malformed scope is accepted', () => {
  for (const ownerId of ['', 'foreign-user-id', 'oauth:', 'oauth:bad\nsubject']) {
    assert.throws(() => prepareAuthorizedMetadataBatch(
      {...scope, ownerId}, listing([])), /INDEX_OWNER_INVALID/);
  }
  assert.throws(() => prepareAuthorizedMetadataBatch(
    {...scope, connectionId: 'external-id'}, listing([])), /INDEX_CONNECTION_INVALID/);
  assert.throws(() => prepareAuthorizedMetadataBatch(
    {...scope, rootId: ''}, listing([])), /INDEX_ROOT_INVALID/);
  assert.throws(() => prepareAuthorizedMetadataBatch(
    {...scope, provider: 'private-global-rclone'}, listing([])), /INDEX_PROVIDER_INVALID/);
});

test('path traversal, escape, duplicates and malformed sizes fail closed', () => {
  for (const path of ['../secret', '/absolute', 'a/../other', 'a//b', 'a\\b', 'a\n.txt']) {
    assert.throws(() => prepareAuthorizedMetadataBatch(
      scope, listing([item(path)])), /INDEX_PATH_INVALID/);
  }
  assert.throws(() => prepareAuthorizedMetadataBatch(
    {...scope, relativePath: '../outside'}, listing([])), /INDEX_PATH_INVALID/);
  assert.throws(() => prepareAuthorizedMetadataBatch(
    scope, listing([item('same'), item('same')])), /INDEX_DUPLICATE_ENTRY/);
  for (const size of [NaN, -1, Infinity, 1.2, '123']) {
    assert.throws(() => prepareAuthorizedMetadataBatch(
      scope, listing([item('x', false, size)])), /INDEX_SIZE_INVALID/);
  }
});

test('read-only provenance and bounded 100-result contract are mandatory', () => {
  assert.throws(() => prepareAuthorizedMetadataBatch(scope,
    {readOnly: false, truncated: false, items: []}), /INDEX_SOURCE_UNTRUSTED/);
  assert.throws(() => prepareAuthorizedMetadataBatch(scope, listing(
    Array.from({length: 101}, (_, i) => item('f' + i)))), /INDEX_SOURCE_UNTRUSTED/);
  assert.throws(() => prepareAuthorizedMetadataBatch(scope,
    {readOnly: true, items: [item('a')]}), /INDEX_SOURCE_UNTRUSTED/);
});

test('one scoped batch never reads providers, networks, secrets or mutates storage', () => {
  const batch = prepareAuthorizedMetadataBatch(scope, listing([item('safe.txt')]));
  assert.deepEqual(Object.keys(batch).sort(), [
    'directoryComplete','entries','mayDeleteMissing','readOnly','schema','scope','scopeKey',
  ].sort());
  assert.deepEqual(Object.keys(batch.entries[0]).sort(), [
    'path','sizeBytes','type',
  ]);
});
