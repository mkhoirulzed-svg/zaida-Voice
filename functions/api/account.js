import { verifyFirebaseUser, getOrCreateAccount } from "../lib/firebase.js";
export async function onRequestGet({request,env}){
  const auth=await verifyFirebaseUser(request,env);if(auth.error)return auth.error;
  try{const account=await getOrCreateAccount(auth.user,env);return Response.json({uid:account.uid,email:account.email,role:account.role,credits:account.credits,plan:account.plan});}
  catch(e){return Response.json({error:e.message||"Tidak dapat memuat akun."},{status:e.status||503});}
}
