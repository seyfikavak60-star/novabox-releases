// Public release tooling only. No app source, signing key or permanent token.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {open, mkdtemp, readFile, appendFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

export const REPO='seyfikavak60-star/novabox-releases';
export const CERT='56ad317b11ff0c587785a591c8394f67ebe35fce0d04a3ea5259b63239a1d948';
export const ABIS=['arm64-v8a','armeabi-v7a','x86','x86_64'];
const LIMIT=200*1024*1024;
function requireThat(ok,message){if(!ok)throw Error(message);}
export function tagParts(tag){
 const m=/^v(\d+\.\d+(?:\.\d+)?)-([1-9]\d{0,9})$/.exec(tag||'');
 requireThat(m&&Number(m[2])<=2147483647,'Tag must be vVERSION-CODE, for example v1.06-738');
 return {name:m[1],code:Number(m[2])};
}
export function selectAsset(release){
 requireThat(release&&!release.draft&&!release.prerelease,'Only a published stable release may update the feed');
 const version=tagParts(release.tag_name);
 const apks=(release.assets||[]).filter(a=>/\.apk$/i.test(a.name||''));
 requireThat(apks.length===1,'Attach exactly one official universal R8 APK to the release');
 const asset=apks[0];
 requireThat(Number.isSafeInteger(asset.id)&&asset.id>0&&asset.state==='uploaded','APK upload has not completed');
 requireThat(/^[A-Za-z0-9][A-Za-z0-9._-]{1,100}\.apk$/.test(asset.name),'APK filename has unsupported characters');
 requireThat(Number.isSafeInteger(asset.size)&&asset.size>0&&asset.size<=LIMIT,'APK size is outside the allowed limit');
 requireThat(/^sha256:[a-f0-9]{64}$/.test(asset.digest||''),'GitHub SHA-256 digest is missing');
 const expected=`https://github.com/${REPO}/releases/download/${release.tag_name}/${asset.name}`;
 requireThat(asset.browser_download_url===expected,'Unexpected APK download URL');
 return {asset,version,canonical:`novabox-${version.code}-${version.name}.apk`};
}
export function trustedCdn(url){
 try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&u.hostname==='release-assets.githubusercontent.com'&&
 /^\/github-production-release-asset\/1462964831\/[A-Za-z0-9-]{1,100}$/.test(u.pathname)&&u.search.length<=8193;}catch{return false;}
}
export function verifySigner(output){
 const certs=[...output.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})\r?$/gm)].map(m=>m[1].toLowerCase());
 requireThat(certs.length===1&&certs[0]===CERT,'APK is not signed by the official NovaBox upgrade certificate');
 requireThat(/Verified using v2 scheme[^\r\n]*true/.test(output),'APK v2 signature verification is required');
}
export function parseBadging(text,version){
 const pkg=/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m.exec(text);
 requireThat(pkg&&pkg[1]==='com.novabox.tv','APK package must be com.novabox.tv; test/box/other packages are rejected');
 requireThat(Number(pkg[2])===version.code&&pkg[3]===version.name,'APK version must match the release tag');
 requireThat(!/^application-debuggable\b/m.test(text),'Debug APKs must never be published');
 const min=Number(/^sdkVersion:'(\d+)'/m.exec(text)?.[1]);
 requireThat(Number.isInteger(min)&&min>=24&&min<=36,'Unsupported minimum Android SDK');
 const line=/^native-code: (.+)$/m.exec(text)?.[1]||'';
 const abis=[...line.matchAll(/'([^']+)'/g)].map(m=>m[1]);
 requireThat(abis.length===ABIS.length&&ABIS.every(a=>abis.includes(a)),'The universal phone/TV/Fire OS APK must include all four ABIs');
 return {minSdk:min,abis:ABIS};
}
export function buildFeed(version,asset,info){
 return {schema:1,available:true,packageName:'com.novabox.tv',versionCode:version.code,versionName:version.name,
 sizeBytes:asset.size,sha256:asset.digest.substring(7),url:`https://github.com/${REPO}/releases/download/v${version.name}-${version.code}/novabox-${version.code}-${version.name}.apk`,
 minSdk:info.minSdk,abis:info.abis,minimumVersionCode:version.code};
}
export function decision(current,next){
 requireThat(current?.schema===1&&typeof current.available==='boolean','Existing feed is not recognized; refusing to replace it');
 if(current.versionCode!==undefined){
  requireThat(current.packageName==='com.novabox.tv'&&Number.isSafeInteger(current.versionCode),'Existing feed identity is not recognized');
  if(next.versionCode<current.versionCode)return 'older';
  if(next.versionCode===current.versionCode){
   requireThat(current.sha256===next.sha256&&current.sizeBytes===next.sizeBytes&&current.versionName===next.versionName,'Same version code cannot point to a different APK');
   // Re-running a release must never undo a deliberate pause/minimum rollback.
   requireThat(current.available===true&&current.url===next.url&&current.minimumVersionCode===next.minimumVersionCode,'Same-version feed changed or paused; manual review is required');
   return 'same';
  }
 }
 return 'new';
}
function tool(name){const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;requireThat(sdk,'Android SDK path is required');return path.join(sdk,'build-tools','36.0.0',name+(process.platform==='win32'?'.exe':''));}
export function verifyApk(apk,version,expected){
 const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;
 const java=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java';
 const signer=execFileSync(java,['-jar',path.join(sdk,'build-tools','36.0.0','lib','apksigner.jar'),'verify','--verbose','--print-certs',apk],{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
 verifySigner(signer);
 const badging=execFileSync(tool('aapt'),['dump','badging',apk],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
 const info=parseBadging(badging,version);
 execFileSync(tool('zipalign'),['-c','-P','16','4',apk],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
 return info;
}
async function download(url,dest,asset){
 requireThat(url===asset.browser_download_url,'Download URL does not match verified release');
 let response;
 for(let n=0;n<4;n++){
  response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(60000),headers:{'User-Agent':'NovaBox-release-validator'}});
  if([301,302,303,307,308].includes(response.status)){
   const target=response.headers.get('location');requireThat(trustedCdn(target),'Unexpected public APK redirect');await response.body?.cancel();url=target;continue;
  }
  break;
 }
 requireThat(response?.ok&&response.body,'Public APK download failed');
 const hash=createHash('sha256');let bytes=0;const file=await open(dest,'wx');
 try{for await(const chunk of response.body){bytes+=chunk.length;requireThat(bytes<=asset.size&&bytes<=LIMIT,'Downloaded APK exceeds expected size');hash.update(chunk);await file.writeFile(chunk);}}
 finally{await file.close();}
 requireThat(bytes===asset.size&&`sha256:${hash.digest('hex')}`===asset.digest,'Downloaded APK does not match GitHub size/SHA-256');
}
async function api(endpoint,method='GET',data){
 requireThat(endpoint.startsWith(`/repos/${REPO}/`),'Unexpected API scope');
 const token=process.env.GH_TOKEN;requireThat(token,'Only the ephemeral workflow token may publish');
 const response=await fetch(`https://api.github.com${endpoint}`,{method,redirect:'error',signal:AbortSignal.timeout(30000),
 headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
 requireThat(response.ok,`GitHub API operation failed (HTTP ${response.status}); existing feed was not intentionally overwritten`);
 return await response.json();
}
async function currentFeed(){
 const blob=await api(`/repos/${REPO}/contents/member/latest.json?ref=main`);
 requireThat(blob.encoding==='base64'&&blob.size<=16384&&typeof blob.sha==='string','Unexpected feed blob');
 return {blob,content:JSON.parse(Buffer.from(blob.content,'base64').toString('utf8'))};
}
async function summary(text){console.log(text);if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,text+'\n');}
export async function main(){
 requireThat(process.env.GITHUB_REPOSITORY===REPO,'This workflow is restricted to the official release repository');
 const tag=process.env.RELEASE_TAG||'';if(tag)tagParts(tag);
 const release=await api(`/repos/${REPO}/releases/${tag?'tags/'+encodeURIComponent(tag):'latest'}`);
 let {asset,version,canonical}=selectAsset(release);
 const initial=await currentFeed();
 if(initial.content.versionCode>version.code){await summary('Older release ignored; the newer feed was kept.');return;}
 const dir=await mkdtemp(path.join(os.tmpdir(),'novabox-release-'));const apk=path.join(dir,'release.apk');
 await download(asset.browser_download_url,apk,asset);
 const info=verifyApk(apk,version);
 // Auto-correct the desktop filename only AFTER cryptographic/package checks.
 if(asset.name!==canonical){
  requireThat(!release.assets.some(a=>a.name===canonical),'Canonical APK filename already exists; refusing an ambiguous release');
  asset=await api(`/repos/${REPO}/releases/assets/${asset.id}`,'PATCH',{name:canonical});
  const again=selectAsset({...release,assets:[asset]});requireThat(again.canonical===canonical,'Renamed APK metadata did not match');
  await download(asset.browser_download_url,path.join(dir,'canonical.apk'),asset);
 }
 const next=buildFeed(version,asset,info);
 // Read immediately before CAS; concurrent manual changes are not silently lost.
 const current=await currentFeed();const action=decision(current.content,next);
 if(action!=='new'){await summary(action==='same'?'Verified APK is already current; no feed commit was needed.':'Newer feed preserved; old release ignored.');return;}
 const content=JSON.stringify(next,null,2)+'\n';
 await api(`/repos/${REPO}/contents/member/latest.json`,'PUT',{branch:'main',sha:current.blob.sha,message:`Publish verified NovaBox ${version.name} (${version.code}) update`,content:Buffer.from(content).toString('base64')});
 const verified=await currentFeed();requireThat(JSON.stringify(verified.content)===JSON.stringify(next),'Feed write read-back did not match');
 await summary(`Verified official APK and enabled NovaBox ${version.name} (${version.code}) update. SHA-256: ${next.sha256}`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv[2]==='--verify-local'){
   const apk=process.argv[3],version=tagParts(process.argv[4]);const info=verifyApk(apk,version);
   const bytes=await readFile(apk);console.log(JSON.stringify({version,...info,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},null,2));
  }else await main();
 }catch(error){console.error(error.message);process.exitCode=1;}
}
