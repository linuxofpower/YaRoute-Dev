const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
require('reflect-metadata');
const { cliSchema } = require('../dist/nyx/runtime.schema');
const { NyxCommandResolver } = require('../dist/nyx/command-resolver');

const profile = JSON.parse(readFileSync(path.join(__dirname, '..', 'config/nyx-runtime-profile.json'), 'utf8'));
const cli = cliSchema.parse({
  schema: 'nyx.yarocli.v1',
  version: 'test',
  commands: { ini: { execution: profile.commands.ini } },
});
const resolver = () => new NyxCommandResolver();
const plan = (args = [], more = {}) => resolver().resolve(cli, { command: 'ini', args, ...more });

test('bare INI defaults to local Normal and does not select an arbitrary resource', () => {
  const p = plan();
  assert.equal(p.name, 'ini');
  assert.deepEqual(p.targets, []);
  assert.equal(p.scope, 'local');
  assert.equal(p.depth, 'normal');
  assert.equal(p.modifier, 'oLN');
  assert.equal(p.contract.mutation, 'conversation-artifact');
  assert.equal(p.contract.verification.artifactReadback, true);
});

test('INI modifiers compose explicit local/global scopes and basic/normal/deep depths', () => {
  for (const [token, scope, depth] of [
    ['oLB','local','basic'],['oLN','local','normal'],['oLD','local','deep'],
    ['oGB','global','basic'],['oGN','global','normal'],['oGD','global','deep'],
  ]) {
    const p = plan(['Voice',token]);
    assert.equal(p.scope,scope,token);
    assert.equal(p.depth,depth,token);
    assert.equal(p.modifier,token,token);
    assert.deepEqual(p.targets,['Voice']);
    assert.equal(p.modifierSource,'explicit');
  }
});

test('INI accepts multiple targets and case-insensitive duplicates without adding unknown targets', () => {
  const p = plan(['Voice','NoteFlow','voice','oGN']);
  assert.deepEqual(p.targets,['Voice','NoteFlow']);
  assert.equal(p.modifier,'oGN');
});

test('modifier-only, conflicting, and mixed scope operations must fail closed', () => {
  const invalid = [
    [['oGN'],/MODIFIER_REQUIRES_TARGET/],
    [['Voice','oLN','oGN'],/MODIFIER_CONFLICT/],
    [['Voice','++'],/CONFIG_OPERATION_INVALID/],
    [['++','--'],/CONFIG_OPERATION_CONFLICT/],
    [['Voice','++','oGN'],/CONFIG_OPERATION_INVALID|MODIFIER_REQUIRES_TARGET/],
  ];
  for (const [tokens,error] of invalid) assert.throws(() => plan(tokens),error,tokens.join(' '));
  assert.throws(() => plan(['Voice','oGN'], { scope:'local' }),/MODIFIER_SCOPE_CONFLICT/);
  assert.throws(() => plan(['Voice','oGN'], { depth:'deep' }),/MODIFIER_DEPTH_CONFLICT/);
});

test('scope upgrade and downgrade require existing conversation and preserve their operator', () => {
  assert.throws(() => plan(['++']),/CONVERSATION_ID_REQUIRED/);
  assert.throws(() => plan(['--']),/CONVERSATION_ID_REQUIRED/);
  assert.equal(plan(['++'],{ conversationId:'known-session' }).scopeAction,'upgrade');
  assert.equal(plan(['--'],{ conversationId:'known-session' }).scopeAction,'downgrade');
});

test('invalid command arguments are rejected rather than parsed as resources', () => {
  for (const token of ['../Voice','../../config','.env','Voice;rm','Voice/../Other']) {
    assert.throws(() => plan([token]),/invalid command argument|ZodError/);
  }
  assert.throws(() => plan(Array.from({length:17},(_,i)=>'Area'+i)),/too_big|ZodError/);
});

test('explicit normal-profile sources are marked required and visible', () => {
  const p = plan(['Voice','oGN']);
  const sourceByKey = Object.fromEntries(p.contract.sources.normal.map(x=>[x.key,x]));
  for (const key of ['maps','nyxcli','todo','todo_10','toget']) {
    assert.equal(sourceByKey[key].required,true,key);
    assert.equal(sourceByKey[key].visible,true,key);
  }
  assert.equal(p.contract.pathsVisible,true);
});

test.todo('canonical H031: ambiguous Voice requires typed resource syntax such as area:Voice or core_skill:Voice');
test.todo('canonical H031: bare INI visible payload is only Basic paths.md and maps.md');
test.todo('canonical H031: Voice Normal includes complete current weekly/monthly planning files and today reconciliation');
test.todo('canonical H031: completion requires actual user-visible render acknowledgment and semantic-read receipts');
test.todo('canonical H031: all 18 typed resource paths/config/status gates must be resolved before READY');
