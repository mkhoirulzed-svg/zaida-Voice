export async function verifyFirebaseUser(request, env) {
  const header=request.headers.get("Authorization")||"",match=header.match(/^Bearer\s+(.+)$/i);
  if(!match)return {error:Response.json({error:"Silakan masuk terlebih dahulu."},{status:401})};
  if(!env.FIREBASE_WEB_API_KEY)return {error:Response.json({error:"FIREBASE_WEB_API_KEY belum dikonfigurasi."},{status:503})};
  try{
    const response=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+encodeURIComponent(env.FIREBASE_WEB_API_KEY),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idToken:match[1]})});
    const data=await response.json(),u=data.users?.[0];
    if(!response.ok||!u||u.emailVerified!==true)return {error:Response.json({error:"Sesi tidak valid atau email belum diverifikasi."},{status:401})};
    return {user:{uid:u.localId,email:(u.email||"").toLowerCase()}};
  }catch{return {error:Response.json({error:"Gagal memverifikasi sesi."},{status:502})};}
}
const encoder = new TextEncoder();
function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function pemBytes(pem) {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return Uint8Array.from(atob(clean), c => c.charCodeAt(0));
}
async function serviceToken(env) {
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY || !env.FIREBASE_PROJECT_ID) throw new Error("Konfigurasi Firestore server belum lengkap.");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(encoder.encode(JSON.stringify({alg:"RS256",typ:"JWT"})));
  const claim = b64url(encoder.encode(JSON.stringify({iss:env.FIREBASE_CLIENT_EMAIL,sub:env.FIREBASE_CLIENT_EMAIL,aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600,scope:"https://www.googleapis.com/auth/datastore"})));
  const unsigned = header+"."+claim;
  const key = await crypto.subtle.importKey("pkcs8",pemBytes(env.FIREBASE_PRIVATE_KEY.replace(/\\n/g,"\n")),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,encoder.encode(unsigned));
  const assertion = unsigned+"."+b64url(new Uint8Array(signature));
  const response = await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
  const data = await response.json();
  if(!response.ok || !data.access_token) throw new Error("Gagal mengakses Firestore: "+(data.error_description||data.error||"OAuth gagal"));
  return data.access_token;
}
async function firestore(env,path,options={}) {
  const token = await serviceToken(env);
  const url = "https://firestore.googleapis.com/v1/projects/"+encodeURIComponent(env.FIREBASE_PROJECT_ID)+"/databases/(default)/documents"+path;
  const response = await fetch(url,{...options,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",...(options.headers||{})}});
  const data = await response.json().catch(()=>({}));
  if(!response.ok) { const e=new Error(data.error?.message||"Firestore request gagal.");e.status=response.status;throw e; }
  return data;
}
function val(v){ if(!v)return null; if(v.stringValue!==undefined)return v.stringValue;if(v.integerValue!==undefined)return Number(v.integerValue);if(v.booleanValue!==undefined)return v.booleanValue;return null; }
function docData(doc){const f=doc?.fields||{};return {uid:val(f.uid),email:val(f.email),role:val(f.role)||"user",credits:val(f.credits)||0,plan:val(f.plan)||"free",createdAt:val(f.createdAt),updatedAt:val(f.updatedAt)};}
const str = value=>({stringValue:String(value)});
const integer = value=>({integerValue:String(value)});
export async function getOrCreateAccount(user,env){
  const path="/users/"+encodeURIComponent(user.uid);
  let doc;
  try { doc=await firestore(env,path); }
  catch(e){ if(e.status!==404)throw e; }
  if(!doc){
    const now=new Date().toISOString();
    const admin=user.email?.toLowerCase()==="mkhoirulzed@gmail.com";
    const credits=Math.max(0,Math.min(10000,Number(env.WELCOME_CREDITS??50)||0));
    try{
      await firestore(env,":commit",{method:"POST",body:JSON.stringify({writes:[{update:{name:"projects/"+env.FIREBASE_PROJECT_ID+"/databases/(default)/documents/users/"+user.uid,fields:{uid:str(user.uid),email:str(user.email||""),role:str(admin?"admin":"user"),credits:integer(credits),plan:str("free"),createdAt:str(now),updatedAt:str(now)}},currentDocument:{exists:false}}]})});
    }catch(e){if(e.status!==409 && e.status!==400)throw e;}
    doc=await firestore(env,path);
  }
  const account=docData(doc);
  if(user.email?.toLowerCase()==="mkhoirulzed@gmail.com" && account.role!=="admin"){
    await firestore(env,":commit",{method:"POST",body:JSON.stringify({writes:[{update:{name:doc.name,fields:{role:str("admin"),email:str(user.email),updatedAt:str(new Date().toISOString())}},updateMask:{fieldPaths:["role","email","updatedAt"]},currentDocument:{updateTime:doc.updateTime}}]})});
    account.role="admin";
  }
  return account;
}
export async function chargeCredits(user,env,amount,description="text-to-speech"){
  for(let attempt=0;attempt<3;attempt++){
    const doc=await firestore(env,"/users/"+encodeURIComponent(user.uid));
    const account=docData(doc);
    if(account.credits<amount){const e=new Error("Kredit tidak mencukupi. Saldo kamu "+account.credits+" kredit.");e.status=402;throw e;}
    const next=account.credits-amount, now=new Date().toISOString();
    const ledgerId=crypto.randomUUID();
    const ledgerName="projects/"+env.FIREBASE_PROJECT_ID+"/databases/(default)/documents/credit_ledger/"+ledgerId;
    try{
      await firestore(env,":commit",{method:"POST",body:JSON.stringify({writes:[
        {update:{name:doc.name,fields:{credits:integer(next),updatedAt:str(now)}},updateMask:{fieldPaths:["credits","updatedAt"]},currentDocument:{updateTime:doc.updateTime}},
        {update:{name:ledgerName,fields:{uid:str(user.uid),type:str("usage"),amount:integer(-amount),description:str(description),createdAt:str(now)}},currentDocument:{exists:false}}
      ]})});
      return next;
    }catch(e){if(e.status!==409 && e.status!==400)throw e;}
  }
  const e=new Error("Saldo sedang diperbarui. Silakan coba kembali.");e.status=409;throw e;
}
