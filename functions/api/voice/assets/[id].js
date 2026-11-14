import { verifyFirebaseUser } from "../../../lib/firebase.js";
export async function onRequestPut({ request, env, params }) {
  const auth=await verifyFirebaseUser(request,env);if(auth.error)return auth.error;
  if(!env.VIDEO_MEDIA)return Response.json({error:"Binding R2 VIDEO_MEDIA belum tersedia."},{status:503});
  const id=String(params.id||"");if(!/^[0-9a-f-]{36}$/i.test(id))return Response.json({error:"ID aset tidak valid."},{status:400});
  const mime=(request.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase();
  if(!mime.startsWith("audio/"))return Response.json({error:"Hanya file audio yang dapat disimpan."},{status:415});
  const bytes=await request.arrayBuffer();if(!bytes.byteLength)return Response.json({error:"File audio kosong."},{status:400});
  if(bytes.byteLength>100*1024*1024)return Response.json({error:"Ukuran audio maksimal 100 MB."},{status:413});
  await env.VIDEO_MEDIA.put(auth.user.uid+"/voice-"+id,bytes,{httpMetadata:{contentType:mime,cacheControl:"private, no-store"},customMetadata:{uid:auth.user.uid,project:"zaida-voice-studio",kind:"audio"}});
  return Response.json({ok:true,assetId:id,size:bytes.byteLength},{headers:{"Cache-Control":"no-store"}});
}
export async function onRequestGet({ request, env, params }) {
  const auth=await verifyFirebaseUser(request,env);if(auth.error)return auth.error;
  if(!env.VIDEO_MEDIA)return Response.json({error:"Binding R2 VIDEO_MEDIA belum tersedia."},{status:503});
  const id=String(params.id||"");if(!/^[0-9a-f-]{36}$/i.test(id))return Response.json({error:"ID aset tidak valid."},{status:400});
  const object=await env.VIDEO_MEDIA.get(auth.user.uid+"/voice-"+id);
  if(!object)return Response.json({error:"Audio proyek tidak ditemukan di penyimpanan."},{status:404});
  return new Response(object.body,{headers:{"Content-Type":object.httpMetadata?.contentType||"audio/mpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}