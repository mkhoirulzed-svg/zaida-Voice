import {mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";

const owner="tabler", name="tabler-icons", branch="main";
const wanted=["activity","ambulance","bone","brain","dna","droplet","ear","eye","heart","heartbeat","hospital","lungs","medical-cross","microscope","pill","stethoscope","thermometer","virus"];
const out="assets/collected/tabler";
await mkdir(out,{recursive:true});
const headers={"User-Agent":"ZAIDA-Asset-Collector","Accept":"application/vnd.github+json"};
async function get(url){const r=await fetch(url,{headers});if(!r.ok)throw new Error(`GET ${url}: ${r.status} ${r.statusText}`);return r;}
const tree=await (await get(`https://api.github.com/repos/${owner}/${name}/git/trees/${branch}?recursive=1`)).json();
if(tree.truncated)throw new Error("GitHub tree response was truncated; refusing incomplete collection.");
const paths=new Set(tree.tree.filter(x=>x.type==="blob").map(x=>x.path));
const licensePath=["LICENSE","LICENSE.md","LICENSE.txt"].find(p=>paths.has(p));
if(!licensePath)throw new Error("Source repository license file was not found.");
const license=await (await get(`https://raw.githubusercontent.com/${owner}/${name}/${branch}/${licensePath}`)).text();
await writeFile(join(out,"LICENSE.txt"),license);
const assets=[];
for(const icon of wanted){
 const path=`icons/outline/${icon}.svg`;
 if(!paths.has(path)){console.warn("Missing icon:",path);continue;}
 const svg=await (await get(`https://raw.githubusercontent.com/${owner}/${name}/${branch}/${path}`)).text();
 if(!svg.includes("<svg"))throw new Error(`Invalid SVG received for ${icon}`);
 await writeFile(join(out,`${icon}.svg`),svg);
 assets.push({id:`tabler-${icon}`,file:`${icon}.svg`,category:"medical-and-health",format:"svg",source_repository:"https://github.com/tabler/tabler-icons",source_file:path,source_revision:branch,license:"MIT",license_file:"LICENSE.txt",attribution:"Tabler Icons"});
}
const manifest={schema_version:1,collection:"ZAIDA Medical Starter Pack",generated_at:new Date().toISOString(),source:{name:"Tabler Icons",repository:"https://github.com/tabler/tabler-icons",license:"MIT",license_file:"LICENSE.txt"},asset_count:assets.length,assets};
await writeFile(join(out,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
console.log(`Collected ${assets.length} SVG assets into ${out}`);
