import {
  VESTRA_VERSION,
  assertSafeVersion,
  compareVersions,
} from "@vestra/shared";

export function buildUpdatesSource(): string {
  return `
  const assertSafeVersion = ${assertSafeVersion.toString()};
  const compareVersions = ${compareVersions.toString()};
  let updateRequest;
  let updateCache;
  async function checkGithubUpdate(force = false) {
    if (updateCache && Date.now() - updateCache.checkedAt < (force ? 10000 : 6*60*60*1000)) return updateCache;
    if (updateRequest) return updateRequest;
    updateRequest = (async()=>{
      const response = await fetch("https://api.github.com/repos/deAYS/Vestra/releases?per_page=100",{headers:{Accept:"application/vnd.github+json","User-Agent":"Vestra-Updater"},signal:AbortSignal.timeout(20000)});
      if(!response.ok) throw new Error("Could not check for updates (HTTP "+response.status+").");
      const text = await response.text();
      if(text.length > 4000000) throw new Error("Invalid release list.");
      const releases = JSON.parse(text);
      if(!Array.isArray(releases)) throw new Error("Invalid release list.");
      const current = ${JSON.stringify(VESTRA_VERSION)};
      const eligible = releases.filter(release=>{
        if(!release || release.draft || typeof release.tag_name !== "string" || !Array.isArray(release.assets)) return false;
        const version = release.tag_name.replace(/^v/, "");
        try{assertSafeVersion(version);}catch{return false;}
        if(!current.includes("-") && (release.prerelease || version.includes("-"))) return false;
        return compareVersions(version,current)>0 && ["Setup","Portable"].every(kind=>release.assets.some(asset=>asset.name==="Vestra-"+version+"-x64-"+kind+".exe" && /^sha256:[a-f0-9]{64}$/i.test(asset.digest||"")));
      }).sort((a,b)=>compareVersions(b.tag_name.replace(/^v/, ""),a.tag_name.replace(/^v/, "")));
      updateCache = {available:eligible.length>0,...(eligible.length?{version:eligible[0].tag_name.replace(/^v/, "")}:{}),checkedAt:Date.now()};
      return updateCache;
    })();
    try{return await updateRequest;}finally{updateRequest=undefined;}
  }
  async function openUpdateManager() {
    const home = path.join(app.getPath("appData"),"Vestra");
    let runtime;
    try {runtime=JSON.parse(await fs.promises.readFile(path.join(home,"maintenance.json"),"utf8")).runtime;} catch {}
    const localRoot = process.env.LOCALAPPDATA || path.join(app.getPath("home"),"AppData","Local");
    const root = path.resolve(localRoot,"Vestra","maintenance");
    if(typeof runtime!=="string" || !path.resolve(runtime).toLowerCase().startsWith(root.toLowerCase()+path.sep) || !/^vestra\\.exe$/i.test(path.basename(runtime)) || !fs.existsSync(runtime)) {
      await shell.openExternal("https://github.com/deAYS/Vestra/releases");
      return;
    }
    const child=require("child_process").spawn(runtime,["--updates"],{detached:true,stdio:"ignore",windowsHide:true});
    await new Promise((resolve,reject)=>{child.once("spawn",resolve);child.once("error",reject);});
    child.unref();
  }
`;
}
