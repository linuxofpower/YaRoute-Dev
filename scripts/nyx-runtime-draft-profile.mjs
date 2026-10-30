/**
 * Exact, non-executable staging-draft profile reconciliation.
 * Preserves the target's recorded hashes; never changes trusted CLI authority.
 */
import { isDeepStrictEqual } from 'node:util';
const paths={
  temp_paths:'🪼👁️📡YaRoute/0_repository/3_template/staging/drafts/temp_paths.json',
  temp_nyxcli:'🪼👁️📡YaRoute/0_repository/3_template/staging/drafts/temp_nyxcli.json',
};
const fail=s=>{throw Error('NYX_DRAFT_PROFILE_'+s)};
const parse=s=>{
 let obj;
 try{obj=JSON.parse(s)}catch{fail('JSON_INVALID')}
 if(!obj||Array.isArray(obj)||typeof obj!=='object'||!Array.isArray(obj.keySources))fail('STRUCTURE_INVALID');
 return obj;
};
const fresh=x=>JSON.parse(JSON.stringify(x));
function pinList(profile){
 if(profile.keySources.length<3||profile.keySources.length>32)fail('KEY_INVENTORY_INVALID');
 const keys=new Set();
 for(const p of profile.keySources){
  if(typeof p.key!=='string'||keys.has(p.key))fail('DUPLICATE_KEY');
  keys.add(p.key);
 }
 for(const [key,path] of Object.entries(paths)){
  const p=profile.keySources.find(x=>x.key===key);
  if(!p||p.ref?.area!=='MAIN'||p.ref?.path!==path||
    !/^[a-f0-9]{64}$/.test(p.sha256??''))fail('DRAFT_IDENTITY_CHANGED');
 }
 return profile.keySources;
}
function upgraded(target){
 const copy=fresh(target);
 for(const key of Object.keys(paths)){
  const p=copy.keySources.find(x=>x.key===key);
  if(p.mode!==undefined&&p.mode!=='enforce'&&p.mode!=='observe')fail('DRAFT_MODE_INVALID');
  p.mode='observe';
 }
 return copy;
}
function untouchedAreEquivalent(base,candidate){
 const expected=upgraded(base);
 if(!isDeepStrictEqual(expected,candidate))fail('UNREVIEWED_PROFILE_CHANGE');
 return expected;
}
/** Approve only target-only mode upgrades, never hashes, refs or routing changes. */
export function validateTargetDraftModeUpgrade(targetText,candidateText){
 const base=parse(targetText),candidate=parse(candidateText);
 pinList(base);pinList(candidate);
 const expected=untouchedAreEquivalent(base,candidate);
 return {valid:true,changed:!isDeepStrictEqual(base,expected)};
}
/** Source may differ in the recorded hashes of the two observe-only drafts ONLY. */
export function reconcileObservedDraftProfile(sourceText,targetText){
 const source=parse(sourceText),target=parse(targetText);
 pinList(source);pinList(target);
 const proposed=upgraded(target),normalized=fresh(source);
 for(const key of Object.keys(paths)){
  const pin=normalized.keySources.find(x=>x.key===key);
  if(pin.mode!=='observe')fail('SOURCE_STILL_ENFORCES_DRAFT');
  pin.sha256=proposed.keySources.find(x=>x.key===key).sha256;
 }
 if(!isDeepStrictEqual(normalized,proposed))fail('PROFILE_AUTHORITY_OR_TRUSTED_PIN_DIFFERENCE');
 return {changed:!isDeepStrictEqual(target,proposed),
   content:JSON.stringify(proposed,null,2)+'\n',
   preservedHashes:Object.fromEntries(Object.keys(paths).map(key=>
    [key,proposed.keySources.find(x=>x.key===key).sha256]))};
}
