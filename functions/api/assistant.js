export async function onRequestPost({ request, env }) {
  const header=request.headers.get("Authorization")||"",match=header.match(/^Bearer\s+(.+)$/i);
  if(!match)return Response.json({error:"Silakan masuk untuk menggunakan AI Assistant."},{status:401});
  if(!env.FIREBASE_WEB_API_KEY)return Response.json({error:"FIREBASE_WEB_API_KEY belum dikonfigurasi."},{status:503});
  try {
    const verify=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+encodeURIComponent(env.FIREBASE_WEB_API_KEY),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idToken:match[1]})});
    const auth=await verify.json(),user=auth.users?.[0];
    if(!verify.ok||!user||user.emailVerified!==true)return Response.json({error:"Sesi tidak valid atau email belum diverifikasi."},{status:401});
  } catch { return Response.json({error:"Gagal memverifikasi sesi pengguna."},{status:502}); }
  if(!env.DEEPSEEK_API_KEY)return Response.json({error:"DEEPSEEK_API_KEY belum dikonfigurasi."},{status:503});
  let body;try{body=await request.json();}catch{return Response.json({error:"Format permintaan tidak valid."},{status:400});}
  const profile=body.profile&&typeof body.profile==="object"?body.profile:{};
  const raw=Array.isArray(body.messages)?body.messages:[];
  const messages=raw.slice(-12).filter(m=>m&&["user","assistant"].includes(m.role)&&typeof m.content==="string"&&m.content.trim()).map(m=>({role:m.role,content:m.content.trim().slice(0,3000)}));
  if(!messages.length||messages[messages.length-1].role!=="user")return Response.json({error:"Kirim pesan terlebih dahulu."},{status:400});
  if(messages.reduce((n,m)=>n+m.content.length,0)>12000)return Response.json({error:"Percakapan terlalu panjang. Mulai percakapan baru."},{status:400});
  const allowed=["olahraga","politik","komedi","pendidikan","teknologi","bisnis","kesehatan","cerita","hiburan","sejarah"];
  const interests=Array.isArray(profile.interests)?profile.interests.filter(x=>allowed.includes(x)).slice(0,10):[];
  const safe=(v,max=160)=>typeof v==="string"?v.trim().slice(0,max):"";
  const persona=safe(profile.persona,80),style=safe(profile.style,100)||"santai dan akrab",emotion=safe(profile.emotion,100)||"natural dan netral",audience=safe(profile.audience,120)||"pendengar umum",length=safe(profile.length,100)||"fleksibel sesuai kebutuhan";
  const system=`Kamu adalah ZAIDA Assistant, partner kreatif untuk merancang naskah audio dan video berbahasa Indonesia. Berdiskusilah secara natural, kolaboratif, dan membantu. Jangan langsung membuat naskah final sebelum pengguna memintanya atau konteks jelas bahwa ia ingin naskah dibuat. Bantu menggali ide, sudut pandang, struktur, hook, dan ajakan bertindak. Jaga akurasi: jangan mengarang fakta, kutipan, data, atau berita. Untuk topik politik, kesehatan, dan isu faktual, bedakan fakta dan opini serta minta konteks bila diperlukan. Hindari ujaran kebencian dan manipulasi.\nPERSONALISASI PENGGUNA:\nPersona: ${persona||"belum ditentukan"}\nMinat: ${interests.join(", ")||"belum ditentukan"}\nGaya komunikasi: ${style}\nNuansa/emosi naskah: ${emotion}\nTarget pendengar: ${audience}\nPanjang target: ${length}\nGunakan preferensi ini sebagai arahan, bukan batasan kaku.\nOUTPUT: Balas HANYA JSON valid dengan properti "reply" dan "script". "reply" berisi respons percakapan untuk pengguna. "script" berisi naskah final lengkap HANYA jika pengguna secara eksplisit meminta dibuatkan/dituliskan naskah atau meminta versi final; selain itu gunakan string kosong. Naskah harus siap dibacakan, tanpa catatan proses atau label yang tidak perlu. Jangan mengubah preferensi personalisasi menjadi klaim faktual.`;
  try {
    const upstream=await fetch("https://api.deepseek.com/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+env.DEEPSEEK_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:"deepseek-chat",messages:[{role:"system",content:system},...messages],temperature:.75,max_tokens:3000,response_format:{type:"json_object"},stream:false})});
    const data=await upstream.json();
    if(!upstream.ok)return Response.json({error:data.error?.message||"DeepSeek gagal memproses percakapan."},{status:upstream.status});
    const rawOutput=data.choices?.[0]?.message?.content;
    if(!rawOutput)return Response.json({error:"DeepSeek tidak mengembalikan jawaban."},{status:502});
    let output;try{output=JSON.parse(rawOutput);}catch{return Response.json({error:"Format jawaban AI tidak valid. Silakan coba lagi."},{status:502});}
    const reply=typeof output.reply==="string"?output.reply.trim():"";
    const script=typeof output.script==="string"?output.script.trim():"";
    if(!reply)return Response.json({error:"AI tidak mengembalikan jawaban."},{status:502});
    return Response.json({reply,script});
  } catch { return Response.json({error:"Tidak dapat terhubung ke DeepSeek."},{status:502}); }
}
