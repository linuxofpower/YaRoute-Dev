// One-time, user-authorized Dev -> Tester runtime profile migration (2026-11-01).
// This is NOT a general approval to rewrite CLI authority or trusted key pins.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const reviewedProfileBlobs=Object.freeze({
  source:'eca448ad1d80cec4500c4ffa6468bcc86364d1e9',
  target:'f1f7ca30a6d883ffd29579e00a478b72a1b0e5b3',
  sourceSchema:'34d4ae191e498366381accded5cedc2b41b36926',
  targetSchema:'a2576382efaaa01d8a8e61cb935e26c337d62256',
});
const fail=reason=>{throw Error('NYX_REVIEWED_PROFILE_MIGRATION_'+reason)};
const blobHash=text=>createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));

/** Check both exact Git blobs and all ten reviewed leaf changes. */
export function reconcileReviewedProfileMigration(sourceText,targetText,blobs){
  if(!blobs||blobs.source!==reviewedProfileBlobs.source||
    blobs.target!==reviewedProfileBlobs.target)fail('UNREVIEWED_BLOB_PAIR');
  if(blobs.sourceSchema!==reviewedProfileBlobs.sourceSchema||
    blobs.targetSchema!==reviewedProfileBlobs.targetSchema)fail('SCHEMA_PAIR_CHANGED');
  if(blobHash(sourceText)!==blobs.source||blobHash(targetText)!==blobs.target)
    fail('BLOB_CONTENT_MISMATCH');
  let source,target;
  try{source=JSON.parse(sourceText);target=JSON.parse(targetText)}
  catch{fail('INVALID_JSON')}
  if(source?.cliSha256!=='090f31ab61ce4228148cb9b551299667072c8ce9c3151bab3c48ab81b7112a4f')
    fail('CLI_AUTHORITY_UNVERIFIED');
  const old=clone(source);
  old.cliSha256='70e8cd6a1e4c52c2a21145ab02cdccb36ceab5f1fcb0f368d32acaa4e8b6c1c4';
  const legacyNoteFlowPaths={
    todo_30:'Documents/Notepad/0_active/todo_30.md',
    todo_90:'Documents/Notepad/1_always/todo_90.md',
    togive:'Documents/Notepad/0_active/togive.md',
  };
  for(const [key,path] of Object.entries(legacyNoteFlowPaths)){
    const entry=old.commands?.ini?.sources?.normal?.find(x=>x.key===key&&x.forTarget==='NoteFlow');
    if(!entry||entry.ref?.area!=='MAIN')fail('NOTE_FLOW_BINDING_MISSING');
    entry.ref.path=path;
  }
  const oldPins={
    temp_paths:['🪼👁️📡YaRoute/0_repository/3_template/staging/drafts/temp_paths.json',
      'e2a39572d91c30d1bc5cb0736ad4ed9eda07696453339750c2daa7f63ff49d89'],
    temp_nyxcli:['🪼👁️📡YaRoute/0_repository/3_template/staging/drafts/temp_nyxcli.json',
      '766bbe091201ad466ecd35d103268ff5ceb9bef90e771d47c317e6a7431cc7ef'],
    active_key:['🪼👁️📡YaRoute/0_repository/3_template/staging/drafts/temp_files/temp_key_20260929_0605.json',
      '206c2c19e000ea5dc4969279e1d55e8afeb76d50c080dfc433f99f40dffe4c18'],
  };
  for(const [key,[path,digest]] of Object.entries(oldPins)){
    const pin=old.keySources?.find(x=>x.key===key);
    if(!pin||pin.ref?.area!=='MAIN'||(key==='active_key'?pin.mode==='observe':pin.mode!=='observe'))
      fail('PIN_MODE_OR_IDENTITY_UNVERIFIED');
    pin.ref.path=path;
    pin.sha256=digest;
  }
  if(!isDeepStrictEqual(old,target))fail('UNREVIEWED_PROFILE_DIFFERENCE');
  return {changed:true,content:sourceText,reviewId:'noteflow-profile-2026-11-01'};
}
