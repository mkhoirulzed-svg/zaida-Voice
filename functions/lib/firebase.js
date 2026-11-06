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
  if(!response.ok) { const e=new Error(data.error?.message||"Firestore request gagal.");e.status=response.status;e.code=data.error?.status||data.error?.details?.[0]?.reason||"";throw e; }
  return data;
}
function val(v){ if(!v)return null; if(v.stringValue!==undefined)return v.stringValue;if(v.integerValue!==undefined)return Number(v.integerValue);if(v.booleanValue!==undefined)return v.booleanValue;return null; }
function docData(doc){const f=doc?.fields||{};return {uid:val(f.uid),email:val(f.email),role:val(f.role)||"user",credits:val(f.credits)||0,plan:val(f.plan)||"free",createdAt:val(f.createdAt),updatedAt:val(f.updatedAt)};}
const isFirestoreConflict = error => error?.status === 409 || ["ABORTED","FAILED_PRECONDITION","ALREADY_EXISTS"].includes(String(error?.code||"").toUpperCase());
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
    }catch(e){if(!isFirestoreConflict(e))throw e;}
    doc=await firestore(env,path);
  }
  const account=docData(doc);
  if(user.email?.toLowerCase()==="mkhoirulzed@gmail.com" && account.role!=="admin"){
    await firestore(env,":commit",{method:"POST",body:JSON.stringify({writes:[{update:{name:doc.name,fields:{role:str("admin"),email:str(user.email),updatedAt:str(new Date().toISOString())}},updateMask:{fieldPaths:["role","email","updatedAt"]},currentDocument:{updateTime:doc.updateTime}}]})});
    account.role="admin";
  }
  return account;
}
async function stableLedgerId(uid,requestId){
  const digest=await crypto.subtle.digest("SHA-256",encoder.encode(uid+":"+requestId));
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
export async function chargeCredits(user,env,amount,description="text-to-speech",metadata={}){
  const requestId=typeof metadata.requestId==="string"&&/^[0-9a-f-]{36}$/i.test(metadata.requestId)?metadata.requestId:null;
  const ledgerId=requestId?await stableLedgerId(user.uid,requestId):crypto.randomUUID();
  const ledgerPath="/credit_ledger/"+ledgerId;
  const ledgerName="projects/"+env.FIREBASE_PROJECT_ID+"/databases/(default)/documents/credit_ledger/"+ledgerId;
  for(let attempt=0;attempt<3;attempt++){
    if(requestId){
      try{
        await firestore(env,ledgerPath);
        const current=docData(await firestore(env,"/users/"+encodeURIComponent(user.uid)));
        return current.credits;
      }catch(e){if(e.status!==404)throw e;}
    }
    const doc=await firestore(env,"/users/"+encodeURIComponent(user.uid));
    const account=docData(doc);
    if(account.credits<amount){const e=new Error("Kredit tidak mencukupi. Saldo kamu "+account.credits+" kredit.");e.status=402;throw e;}
    const next=account.credits-amount, now=new Date().toISOString();
    try{
      await firestore(env,":commit",{method:"POST",body:JSON.stringify({writes:[
        {update:{name:doc.name,fields:{credits:integer(next),updatedAt:str(now)}},updateMask:{fieldPaths:["credits","updatedAt"]},currentDocument:{updateTime:doc.updateTime}},
        {update:{name:ledgerName,fields:{uid:str(user.uid),type:str("usage"),amount:integer(-amount),description:str(description),provider:str(metadata.provider||"unknown"),model:str(metadata.model||"unknown"),providerCostIdr:integer(Math.max(0,Number(metadata.providerCostIdr)||0)),providerCostUsd:str(Number(metadata.providerCostUsd||0).toFixed(8)),inputTokens:integer(Math.max(0,Number(metadata.inputTokens)||0)),outputTokens:integer(Math.max(0,Number(metadata.outputTokens)||0)),characters:integer(Math.max(0,Number(metadata.characters)||0)),requestId:str(requestId||""),createdAt:str(now)}},currentDocument:{exists:false}}
      ]})});
      return next;
    }catch(e){if(!isFirestoreConflict(e))throw e;}
  }
  const e=new Error("Saldo sedang diperbarui. Silakan coba kembali.");e.status=409;throw e;
}


// Provider-independent ZAIDA billing helpers.
// Rates are configurable in Cloudflare Pages environment variables.
export function calculateDeepSeekCharge(usage, env) {
  const input = Math.max(0, Number(usage?.prompt_tokens ?? usage?.input_tokens) || 0);
  const output = Math.max(0, Number(usage?.completion_tokens ?? usage?.output_tokens) || 0);
  const cached = Math.max(0, Math.min(input, Number(usage?.prompt_cache_hit_tokens ?? usage?.cached_tokens) || 0));
  const usdToIdr = Math.max(1, Number(env.ZAIDA_USD_TO_IDR) || 18000);
  const markup = Math.max(1, Number(env.ZAIDA_AI_MARKUP) || 2);
  const inputMissRate = Math.max(0, Number(env.DEEPSEEK_INPUT_USD_PER_MILLION) || 0.15);
  const inputHitRate = Math.max(0, Number(env.DEEPSEEK_CACHED_INPUT_USD_PER_MILLION) || 0.003);
  const outputRate = Math.max(0, Number(env.DEEPSEEK_OUTPUT_USD_PER_MILLION) || 0.60);
  const providerUsd = ((input - cached) * inputMissRate + cached * inputHitRate + output * outputRate) / 1000000;
  const providerCostIdr = Math.ceil(providerUsd * usdToIdr);
  return { inputTokens: input, cachedInputTokens: cached, outputTokens: output, providerUsd, providerCostIdr, credits: Math.max(1, Math.ceil(providerCostIdr * markup)) };
}
export function calculateTtsCharge(text, env) {
  const characters = String(text || "").length;
  const rate = Math.max(0, Number(env.ZAIDA_TTS_CREDITS_PER_CHARACTER) || 2);
  return { characters, credits: Math.max(1, Math.ceil(characters * rate)) };
}
export async function billUsage(user, env, credits, description, metadata = {}) {
  const remaining = await chargeCredits(user, env, credits, description, metadata);
  return { remaining, charged: credits };
}


// Credit reservation flow: reserve before calling a paid provider, then settle or release.
async function readReservation(env, reservationId) {
  try { return await firestore(env, "/credit_reservations/" + reservationId); }
  catch (e) { if (e.status === 404) return null; throw e; }
}
export async function reserveCredits(user, env, amount, description, metadata = {}) {
  const requestId = typeof metadata.requestId === "string" && /^[0-9a-f-]{36}$/i.test(metadata.requestId) ? metadata.requestId : null;
  if (!requestId) { const e = new Error("ID permintaan tidak valid."); e.status = 400; throw e; }
  const reserveAmount = Math.max(1, Math.ceil(Number(amount) || 0));
  const reservationId = await stableLedgerId(user.uid, requestId);
  const reservationName = "projects/" + env.FIREBASE_PROJECT_ID + "/databases/(default)/documents/credit_reservations/" + reservationId;
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await readReservation(env, reservationId);
    if (existing) {
      const e = new Error("Permintaan ini sudah diproses atau sedang berjalan. Jangan kirim ulang dengan ID yang sama.");
      e.status = 409;
      e.reservationStatus = val(existing.fields?.status);
      throw e;
    }
    const accountDoc = await firestore(env, "/users/" + encodeURIComponent(user.uid));
    const account = docData(accountDoc);
    if (account.credits < reserveAmount) {
      const e = new Error("Kredit tidak mencukupi. Saldo kamu " + account.credits + " kredit; reservasi yang dibutuhkan " + reserveAmount + " kredit.");
      e.status = 402;
      throw e;
    }
    const now = new Date().toISOString();
    try {
      await firestore(env, ":commit", { method: "POST", body: JSON.stringify({ writes: [
        { update: { name: accountDoc.name, fields: { credits: integer(account.credits - reserveAmount), updatedAt: str(now) } }, updateMask: { fieldPaths: ["credits", "updatedAt"] }, currentDocument: { updateTime: accountDoc.updateTime } },
        { update: { name: reservationName, fields: { uid: str(user.uid), requestId: str(requestId), status: str("reserved"), amount: integer(reserveAmount), description: str(description || "provider-usage"), provider: str(metadata.provider || "unknown"), model: str(metadata.model || "unknown"), createdAt: str(now), updatedAt: str(now) } }, currentDocument: { exists: false } }
      ] }) });
      return { reservationId, reserved: reserveAmount, remaining: account.credits - reserveAmount };
    } catch (e) {
      if (!isFirestoreConflict(e)) throw e;
      const raced = await readReservation(env, reservationId);
      if (raced) { const duplicate = new Error("Permintaan ini sudah diproses atau sedang berjalan."); duplicate.status = 409; throw duplicate; }
    }
  }
  const e = new Error("Saldo sedang diperbarui. Silakan coba kembali."); e.status = 409; throw e;
}
export async function releaseCredits(user, env, reservationId, reason = "provider-failed") {
  for (let attempt = 0; attempt < 3; attempt++) {
    const reservation = await readReservation(env, reservationId);
    if (!reservation) return false;
    const fields = reservation.fields || {};
    if (val(fields.uid) !== user.uid || val(fields.status) !== "reserved") return false;
    const amount = Math.max(0, Number(val(fields.amount)) || 0);
    const accountDoc = await firestore(env, "/users/" + encodeURIComponent(user.uid));
    const account = docData(accountDoc);
    const now = new Date().toISOString();
    try {
      await firestore(env, ":commit", { method: "POST", body: JSON.stringify({ writes: [
        { update: { name: accountDoc.name, fields: { credits: integer(account.credits + amount), updatedAt: str(now) } }, updateMask: { fieldPaths: ["credits", "updatedAt"] }, currentDocument: { updateTime: accountDoc.updateTime } },
        { update: { name: reservation.name, fields: { status: str("released"), releaseReason: str(reason), updatedAt: str(now) } }, updateMask: { fieldPaths: ["status", "releaseReason", "updatedAt"] }, currentDocument: { updateTime: reservation.updateTime } }
      ] }) });
      return true;
    } catch (e) { if (!isFirestoreConflict(e)) throw e; }
  }
  const e = new Error("Gagal melepaskan reservasi kredit."); e.status = 409; throw e;
}
export async function settleReservedCredits(user, env, reservationId, actualCredits, description, metadata = {}) {
  const actual = Math.max(1, Math.ceil(Number(actualCredits) || 0));
  const ledgerId = reservationId;
  const ledgerName = "projects/" + env.FIREBASE_PROJECT_ID + "/databases/(default)/documents/credit_ledger/" + ledgerId;
  for (let attempt = 0; attempt < 3; attempt++) {
    const reservation = await readReservation(env, reservationId);
    if (!reservation || val(reservation.fields?.uid) !== user.uid) { const e = new Error("Reservasi kredit tidak ditemukan."); e.status = 404; throw e; }
    const fields = reservation.fields || {};
    if (val(fields.status) === "settled") {
      const current = docData(await firestore(env, "/users/" + encodeURIComponent(user.uid)));
      return { charged: actual, remaining: current.credits };
    }
    if (val(fields.status) !== "reserved") { const e = new Error("Reservasi kredit tidak aktif."); e.status = 409; throw e; }
    const reserved = Math.max(0, Number(val(fields.amount)) || 0);
    if (actual > reserved) { const e = new Error("Biaya aktual melebihi batas reservasi. Transaksi ditahan untuk pemeriksaan."); e.status = 409; throw e; }
    const accountDoc = await firestore(env, "/users/" + encodeURIComponent(user.uid));
    const account = docData(accountDoc);
    const refund = reserved - actual, next = account.credits + refund, now = new Date().toISOString();
    try {
      await firestore(env, ":commit", { method: "POST", body: JSON.stringify({ writes: [
        { update: { name: accountDoc.name, fields: { credits: integer(next), updatedAt: str(now) } }, updateMask: { fieldPaths: ["credits", "updatedAt"] }, currentDocument: { updateTime: accountDoc.updateTime } },
        { update: { name: reservation.name, fields: { status: str("settled"), actualCredits: integer(actual), refundedCredits: integer(refund), updatedAt: str(now) } }, updateMask: { fieldPaths: ["status", "actualCredits", "refundedCredits", "updatedAt"] }, currentDocument: { updateTime: reservation.updateTime } },
        { update: { name: ledgerName, fields: { uid: str(user.uid), type: str("usage"), amount: integer(-actual), description: str(description || val(fields.description) || "provider-usage"), provider: str(metadata.provider || val(fields.provider) || "unknown"), model: str(metadata.model || val(fields.model) || "unknown"), providerCostIdr: integer(Math.max(0, Number(metadata.providerCostIdr) || 0)), providerCostUsd: str(Number(metadata.providerCostUsd || 0).toFixed(8)), inputTokens: integer(Math.max(0, Number(metadata.inputTokens) || 0)), outputTokens: integer(Math.max(0, Number(metadata.outputTokens) || 0)), characters: integer(Math.max(0, Number(metadata.characters) || 0)), requestId: str(val(fields.requestId) || ""), createdAt: str(now) } }, currentDocument: { exists: false } }
      ] }) });
      return { charged: actual, remaining: next, refunded: refund };
    } catch (e) {
      if (!isFirestoreConflict(e)) throw e;
      const latest = await readReservation(env, reservationId);
      if (latest && val(latest.fields?.status) === "settled") {
        const current = docData(await firestore(env, "/users/" + encodeURIComponent(user.uid)));
        return { charged: actual, remaining: current.credits };
      }
    }
  }
  const e = new Error("Gagal menyelesaikan tagihan. Reservasi tetap ditahan untuk pemeriksaan."); e.status = 409; throw e;
}
