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
  const markup = Math.max(1, Number(env.ZAIDA_AI_MARKUP) || 1.5);
  const inputMissRate = Math.max(0, Number(env.DEEPSEEK_INPUT_USD_PER_MILLION) || 0.15);
  const inputHitRate = Math.max(0, Number(env.DEEPSEEK_CACHED_INPUT_USD_PER_MILLION) || 0.003);
  const outputRate = Math.max(0, Number(env.DEEPSEEK_OUTPUT_USD_PER_MILLION) || 0.60);
  const providerUsd = ((input - cached) * inputMissRate + cached * inputHitRate + output * outputRate) / 1000000;
  const providerCostIdr = Math.ceil(providerUsd * usdToIdr);
  return { inputTokens: input, cachedInputTokens: cached, outputTokens: output, providerUsd, providerCostIdr, credits: Math.max(1, Math.ceil(providerCostIdr * markup)) };
}
export function calculateKiosapiCharge(usage, env) {
  const input = Math.max(0, Number(usage?.prompt_tokens ?? usage?.input_tokens) || 0);
  const output = Math.max(0, Number(usage?.completion_tokens ?? usage?.output_tokens) || 0);
  const providerCostIdr = Math.max(0, Number(usage?.cost_idr) || 0);
  const markup = Math.max(1, Number(env.ZAIDA_AI_MARKUP) || 1.5);
  return { inputTokens: input, outputTokens: output, providerCostIdr, credits: Math.max(1, Math.ceil(providerCostIdr * markup)) };
}
export function estimateKiosapiCostIdr(usage, model, env) {
  const input = Math.max(0, Number(usage?.prompt_tokens ?? usage?.input_tokens) || 0);
  const output = Math.max(0, Number(usage?.completion_tokens ?? usage?.output_tokens) || 0);
  const isDeepSeek = String(model || "").startsWith("deepseek/");
  const inputRate = Math.max(0, Number(env.ZAIDA_KIOSAPI_INPUT_MAX_IDR_PER_MILLION) || (isDeepSeek ? 12000 : 6500));
  const outputRate = Math.max(0, Number(env.ZAIDA_KIOSAPI_OUTPUT_MAX_IDR_PER_MILLION) || (isDeepSeek ? 50000 : 25000));
  return ((input * inputRate) + (output * outputRate)) / 1000000;
}
export function estimateKiosapiReservation(inputCharacters, maxOutputTokens, env) {
  // Conservative upper bound: assume at most two characters per input token.
  // Uses the peak DeepSeek V4 Flash rate because it is the configured fallback.
  const promptTokens = Math.max(1, Math.ceil(Math.max(0, Number(inputCharacters) || 0) / 2) + 256);
  const outputTokens = Math.max(1, Math.ceil(Number(maxOutputTokens) || 1));
  const maxInputRate = Math.max(0, Number(env.ZAIDA_KIOSAPI_INPUT_MAX_IDR_PER_MILLION) || 12000);
  const maxOutputRate = Math.max(0, Number(env.ZAIDA_KIOSAPI_OUTPUT_MAX_IDR_PER_MILLION) || 50000);
  const providerCostIdr = ((promptTokens * maxInputRate) + (outputTokens * maxOutputRate)) / 1000000;
  const markup = Math.max(1, Number(env.ZAIDA_AI_MARKUP) || 1.5);
  return Math.max(1, Math.ceil(providerCostIdr * markup) + 1);
}
export function calculateTtsCharge(text, env) {
  const characters = String(text || "").length;
  const rate = Math.max(0, Number(env.ZAIDA_TTS_CREDITS_PER_CHARACTER) || 3);
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

export function estimateDeepSeekReservation(inputCharacters, maxOutputTokens, env) {
  // Conservative upper bound: assume at most two characters per input token, plus prompt overhead.
  const promptTokens = Math.max(1, Math.ceil(Math.max(0, Number(inputCharacters) || 0) / 2) + 256);
  const outputTokens = Math.max(1, Math.ceil(Number(maxOutputTokens) || 1));
  return calculateDeepSeekCharge({ prompt_tokens: promptTokens, completion_tokens: outputTokens }, env).credits;
}


// Per-user creative persona stored on the authenticated Firestore user document.
export async function getUserPersonaProfile(user, env) {
  const doc = await firestore(env, "/users/" + encodeURIComponent(user.uid));
  const raw = val(doc.fields?.personaProfile);
  if (!raw) return {};
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}
export async function saveUserPersonaProfile(user, env, profile) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = await firestore(env, "/users/" + encodeURIComponent(user.uid));
    const now = new Date().toISOString();
    try {
      await firestore(env, ":commit", { method: "POST", body: JSON.stringify({ writes: [{ update: { name: doc.name, fields: { personaProfile: str(JSON.stringify(profile)), updatedAt: str(now) } }, updateMask: { fieldPaths: ["personaProfile", "updatedAt"] }, currentDocument: { updateTime: doc.updateTime } }] }) });
      return profile;
    } catch (error) { if (!isFirestoreConflict(error)) throw error; }
  }
  const error = new Error("Persona sedang diperbarui. Coba simpan kembali."); error.status = 409; throw error;
}


export async function getUserStudioSettings(user, env) {
  const doc = await firestore(env, "/users/" + encodeURIComponent(user.uid));
  const raw = val(doc.fields?.studioSettings);
  if (!raw) return {};
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}
export async function saveUserStudioSettings(user, env, settings) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = await firestore(env, "/users/" + encodeURIComponent(user.uid));
    const now = new Date().toISOString();
    try {
      await firestore(env, ":commit", { method: "POST", body: JSON.stringify({ writes: [{ update: { name: doc.name, fields: { studioSettings: str(JSON.stringify(settings)), updatedAt: str(now) } }, updateMask: { fieldPaths: ["studioSettings", "updatedAt"] }, currentDocument: { updateTime: doc.updateTime } }] }) });
      return settings;
    } catch (error) { if (!isFirestoreConflict(error)) throw error; }
  }
  const error = new Error("Pengaturan sedang diperbarui. Coba simpan kembali."); error.status = 409; throw error;
}


// One private Instant Voice Clone record per Firebase UID.
function voiceCloneData(doc) {
  const f = doc?.fields || {};
  return {
    userId: val(f.userId),
    voiceId: val(f.voiceId),
    name: val(f.name),
    status: val(f.status),
    createdAt: val(f.createdAt),
    updatedAt: val(f.updatedAt)
  };
}
export async function getUserVoiceClone(user, env) {
  try {
    const doc = await firestore(env, "/user_voices/" + encodeURIComponent(user.uid));
    return voiceCloneData(doc);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}
export async function createUserVoiceClone(user, env, record) {
  const now = new Date().toISOString();
  const name = "projects/" + env.FIREBASE_PROJECT_ID + "/databases/(default)/documents/user_voices/" + user.uid;
  return firestore(env, ":commit", { method: "POST", body: JSON.stringify({ writes: [{
    update: { name, fields: {
      userId: str(user.uid), voiceId: str(record.voiceId || ""), name: str(record.name || ""),
      status: str(record.status || "creating"), createdAt: str(now), updatedAt: str(now)
    }},
    currentDocument: { exists: false }
  }]})});
}
export async function updateUserVoiceClone(user, env, record) {
  const path = "/user_voices/" + encodeURIComponent(user.uid);
  const doc = await firestore(env, path);
  const fields = { updatedAt: str(new Date().toISOString()) };
  for (const key of ["voiceId", "name", "status"]) if (record[key] !== undefined) fields[key] = str(record[key]);
  return firestore(env, ":commit", { method: "POST", body: JSON.stringify({ writes: [{
    update: { name: doc.name, fields }, updateMask: { fieldPaths: Object.keys(fields) },
    currentDocument: { updateTime: doc.updateTime }
  }]})});
}
export async function deleteUserVoiceCloneRecord(user, env) {
  const path = "/user_voices/" + encodeURIComponent(user.uid);
  try {
    const doc = await firestore(env, path);
    return firestore(env, ":commit", { method: "POST", body: JSON.stringify({ writes: [{
      delete: doc.name, currentDocument: { updateTime: doc.updateTime }
    }]})});
  } catch (error) { if (error.status === 404) return false; throw error; }
}


// Midtrans payment records and idempotent credit fulfillment.
export async function createPaymentRecord(env, payment) {
  const name = "projects/" + env.FIREBASE_PROJECT_ID + "/databases/(default)/documents/payments/" + payment.orderId;
  const now = new Date().toISOString();
  return firestore(env, ":commit", { method: "POST", body: JSON.stringify({ writes: [{
    update: { name, fields: {
      orderId: str(payment.orderId), uid: str(payment.uid), email: str(payment.email),
      packageId: str(payment.packageId), packageName: str(payment.packageName),
      amount: integer(payment.amount), credits: integer(payment.credits),
      status: str("pending"), createdAt: str(now), updatedAt: str(now)
    }},
    currentDocument: { exists: false }
  }]})});
}
export async function updatePaymentCheckout(env, orderId, checkout) {
  const path = "/payments/" + encodeURIComponent(orderId);
  const doc = await firestore(env, path);
  return firestore(env, ":commit", { method: "POST", body: JSON.stringify({ writes: [{
    update: { name: doc.name, fields: {
      snapToken: str(checkout.token || ""), redirectUrl: str(checkout.redirectUrl || ""),
      updatedAt: str(new Date().toISOString())
    }},
    updateMask: { fieldPaths: ["snapToken", "redirectUrl", "updatedAt"] },
    currentDocument: { updateTime: doc.updateTime }
  }]})});
}
export async function getPaymentRecord(env, orderId) {
  try {
    const doc = await firestore(env, "/payments/" + encodeURIComponent(orderId));
    const f = doc.fields || {};
    return {
      orderId: val(f.orderId), uid: val(f.uid), email: val(f.email),
      packageId: val(f.packageId), packageName: val(f.packageName),
      amount: val(f.amount), credits: val(f.credits), status: val(f.status),
      snapToken: val(f.snapToken), redirectUrl: val(f.redirectUrl)
    };
  } catch (error) { if (error.status === 404) return null; throw error; }
}
export async function fulfillPaymentCredits(env, orderId, confirmedAmount) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const paymentDoc = await firestore(env, "/payments/" + encodeURIComponent(orderId));
    const p = paymentDoc.fields || {};
    const uid = val(p.uid), amount = Number(val(p.amount)), credits = Number(val(p.credits));
    if (!uid || amount !== Number(confirmedAmount)) throw new Error("Nominal pembayaran tidak cocok dengan pesanan.");
    if (val(p.status) === "paid") {
      const account = docData(await firestore(env, "/users/" + encodeURIComponent(uid)));
      return { alreadyPaid: true, credits: account.credits };
    }
    if (val(p.status) !== "pending") throw new Error("Status pesanan tidak dapat diproses.");
    const accountDoc = await firestore(env, "/users/" + encodeURIComponent(uid));
    const account = docData(accountDoc);
    const next = account.credits + credits, now = new Date().toISOString();
    const ledgerId = "midtrans_" + orderId;
    const ledgerName = "projects/" + env.FIREBASE_PROJECT_ID + "/databases/(default)/documents/credit_ledger/" + ledgerId;
    try {
      await firestore(env, ":commit", { method: "POST", body: JSON.stringify({ writes: [
        { update: { name: accountDoc.name, fields: { credits: integer(next), updatedAt: str(now) } }, updateMask: { fieldPaths: ["credits", "updatedAt"] }, currentDocument: { updateTime: accountDoc.updateTime } },
        { update: { name: paymentDoc.name, fields: { status: str("paid"), paidAt: str(now), updatedAt: str(now) } }, updateMask: { fieldPaths: ["status", "paidAt", "updatedAt"] }, currentDocument: { updateTime: paymentDoc.updateTime } },
        { update: { name: ledgerName, fields: { uid: str(uid), type: str("topup"), amount: integer(credits), description: str("Top up " + val(p.packageName)), provider: str("midtrans"), orderId: str(orderId), createdAt: str(now) } }, currentDocument: { exists: false } }
      ]})});
      return { alreadyPaid: false, credits: next };
    } catch (error) {
      if (!isFirestoreConflict(error)) throw error;
      const latest = await getPaymentRecord(env, orderId);
      if (latest?.status === "paid") {
        const current = docData(await firestore(env, "/users/" + encodeURIComponent(uid)));
        return { alreadyPaid: true, credits: current.credits };
      }
    }
  }
  throw new Error("Pemrosesan kredit sedang bersamaan. Notifikasi dapat dikirim ulang.");
}


// Video Studio projects: private Firestore metadata, scoped to the verified Firebase UID.
const videoProjectFields = (doc) => {
  const f = doc?.fields || {};
  let payload = {};
  try { payload = JSON.parse(val(f.payload) || "{}"); } catch {}
  return { id: val(f.projectId), title: val(f.title) || "Proyek video", createdAt: val(f.createdAt), updatedAt: val(f.updatedAt), payload };
};
function voiceProjectFields(doc) {
  const fields=doc?.fields||{};
  let payload={};
  try{payload=JSON.parse(val(fields.payload)||"{}");}catch{}
  return {id:val(fields.projectId)||doc.name.split("/").pop(),title:val(fields.title)||"Proyek Voice Studio",payload,createdAt:val(fields.createdAt),updatedAt:val(fields.updatedAt)};
}
export async function listVoiceProjects(user, env) {
  const response=await firestore(env,":runQuery",{method:"POST",body:JSON.stringify({structuredQuery:{from:[{collectionId:"voice_projects"}],where:{fieldFilter:{field:{fieldPath:"uid"},op:"EQUAL",value:{stringValue:user.uid}}},limit:50}})});
  return (Array.isArray(response)?response:[]).filter(row=>row.document).map(row=>voiceProjectFields(row.document)).sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
}
export async function getVoiceProject(user,env,projectId) {
  if(!/^[a-zA-Z0-9_-]{8,80}$/.test(projectId)){const e=new Error("ID proyek tidak valid.");e.status=400;throw e;}
  const doc=await firestore(env,"/voice_projects/"+encodeURIComponent(projectId));
  if(val(doc.fields?.uid)!==user.uid){const e=new Error("Proyek tidak ditemukan.");e.status=404;throw e;}
  return voiceProjectFields(doc);
}
export async function saveVoiceProject(user,env,project) {
  const id=String(project.id||"");
  if(!/^[a-zA-Z0-9_-]{8,80}$/.test(id)){const e=new Error("ID proyek tidak valid.");e.status=400;throw e;}
  const payload=JSON.stringify(project.payload||{});
  if(payload.length>700000){const e=new Error("Data proyek terlalu besar. File audio harus disimpan terpisah.");e.status=413;throw e;}
  const path="/voice_projects/"+encodeURIComponent(id);let existing=null;
  try{existing=await firestore(env,path);}catch(error){if(error.status!==404)throw error;}
  if(existing&&val(existing.fields?.uid)!==user.uid){const e=new Error("ID proyek sudah digunakan.");e.status=409;throw e;}
  const now=new Date().toISOString(),createdAt=existing?val(existing.fields?.createdAt):now;
  const fields={uid:str(user.uid),projectId:str(id),title:str(String(project.title||"Proyek Voice Studio").slice(0,120)),payload:str(payload),createdAt:str(createdAt),updatedAt:str(now)};
  const write=existing?{update:{name:existing.name,fields},updateMask:{fieldPaths:Object.keys(fields)},currentDocument:{updateTime:existing.updateTime}}:{update:{name:"projects/"+env.FIREBASE_PROJECT_ID+"/databases/(default)/documents/voice_projects/"+id,fields},currentDocument:{exists:false}};
  await firestore(env,":commit",{method:"POST",body:JSON.stringify({writes:[write]})});
  return {id,title:fields.title.stringValue,createdAt,updatedAt:now};
}
export async function listVideoProjects(user, env) {
  const response = await firestore(env, ":runQuery", { method: "POST", body: JSON.stringify({
    structuredQuery: {
      from: [{ collectionId: "video_projects" }],
      where: { fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: { stringValue: user.uid } } },
      limit: 50
    }
  }) });
  return (Array.isArray(response) ? response : []).filter(row => row.document).map(row => videoProjectFields(row.document)).sort((a,b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}
export async function getVideoProject(user, env, projectId) {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(projectId)) { const e = new Error("ID proyek tidak valid."); e.status = 400; throw e; }
  try {
    const doc = await firestore(env, "/video_projects/" + encodeURIComponent(projectId));
    if (val(doc.fields?.uid) !== user.uid) { const e = new Error("Proyek tidak ditemukan."); e.status = 404; throw e; }
    return videoProjectFields(doc);
  } catch (error) { if (error.status === 404) throw error; throw error; }
}
export async function saveVideoProject(user, env, project) {
  const id = String(project.id || "");
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) { const e = new Error("ID proyek tidak valid."); e.status = 400; throw e; }
  const payload = JSON.stringify(project.payload || {});
  if (payload.length > 700000) { const e = new Error("Data proyek terlalu besar. File media harus disimpan terpisah."); e.status = 413; throw e; }
  const path = "/video_projects/" + encodeURIComponent(id);
  const now = new Date().toISOString();
  let existing = null;
  try { existing = await firestore(env, path); } catch (error) { if (error.status !== 404) throw error; }
  if (existing && val(existing.fields?.uid) !== user.uid) { const e = new Error("ID proyek sudah digunakan."); e.status = 409; throw e; }
  const createdAt = existing ? val(existing.fields?.createdAt) : now;
  const fields = {
    uid: str(user.uid), projectId: str(id),
    title: str(String(project.title || "Proyek video").slice(0, 120)),
    payload: str(payload), createdAt: str(createdAt), updatedAt: str(now)
  };
  const write = existing
    ? { update: { name: existing.name, fields }, updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { updateTime: existing.updateTime } }
    : { update: { name: "projects/" + env.FIREBASE_PROJECT_ID + "/databases/(default)/documents/video_projects/" + id, fields }, currentDocument: { exists: false } };
  await firestore(env, ":commit", { method: "POST", body: JSON.stringify({ writes: [write] }) });
  return { id, title: fields.title.stringValue, createdAt, updatedAt: now };
}
export async function deleteVideoProject(user, env, projectId) {
  const doc = await firestore(env, "/video_projects/" + encodeURIComponent(projectId));
  if (val(doc.fields?.uid) !== user.uid) { const e = new Error("Proyek tidak ditemukan."); e.status = 404; throw e; }
  await firestore(env, ":commit", { method: "POST", body: JSON.stringify({ writes: [{ delete: doc.name, currentDocument: { updateTime: doc.updateTime } }] }) });
  return true;
}
