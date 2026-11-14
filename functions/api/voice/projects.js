import { verifyFirebaseUser, listVoiceProjects, getVoiceProject, saveVoiceProject } from "../../lib/firebase.js";
export async function onRequestGet({ request, env }) {
  const auth=await verifyFirebaseUser(request,env);if(auth.error)return auth.error;
  const id=new URL(request.url).searchParams.get("id");
  try { if(id)return Response.json({project:await getVoiceProject(auth.user,env,id)},{headers:{"Cache-Control":"no-store"}}); return Response.json({projects:await listVoiceProjects(auth.user,env)},{headers:{"Cache-Control":"no-store"}}); }
  catch(error){return Response.json({error:error.message||"Gagal memuat proyek."},{status:error.status||500});}
}
export async function onRequestPost({ request, env }) {
  const auth=await verifyFirebaseUser(request,env);if(auth.error)return auth.error;
  let body;try{body=await request.json();}catch{return Response.json({error:"Format data tidak valid."},{status:400});}
  if(!body||typeof body!=="object"||!body.payload||typeof body.payload!=="object"||Array.isArray(body.payload))return Response.json({error:"Data proyek tidak valid."},{status:400});
  try{return Response.json({ok:true,project:await saveVoiceProject(auth.user,env,body)});}
  catch(error){return Response.json({error:error.message||"Gagal menyimpan proyek."},{status:error.status||500});}
}