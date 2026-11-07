# ZAIDA Voice

AI Voice Studio by ZAIDA Labs.

## Stack
- Static frontend: HTML, CSS, JavaScript in `public/`
- Cloudflare Pages Functions: secure API proxy in root `functions/`
- Kiosapi API: primary AI script provider, with DeepSeek model fallback
- DeepSeek direct API: optional emergency fallback if the Kiosapi gateway itself is unavailable
- ElevenLabs API: voice catalog and text-to-speech

## Deploy with Cloudflare Pages
1. Connect this repository to Cloudflare Pages using the Pages Git integration.
2. Set Framework preset to **None**.
3. Leave the build command empty.
4. Set the build output directory to `public`.
5. Keep the project root directory as `/`.
6. Add these environment variables in Pages project settings:
   - `KIOSAPI_API_KEY` (required for the primary script provider)
   - `DEEPSEEK_API_KEY` (optional direct fallback if Kiosapi itself is unavailable)
   - `ZAIDA_AI_MARKUP` = `1.5` (provider cost + 50%)
   - `ELEVENLABS_API_KEY`
   - `MIDTRANS_SERVER_KEY` (Sandbox Server Key for payment testing)
   - Existing Firebase service-account variables
7. Optional model overrides:
   - `ZAIDA_KIOSAPI_PRIMARY_MODEL` (default: `openai/gpt-4o-mini`)
   - `ZAIDA_KIOSAPI_FALLBACK_MODEL` (default: `deepseek/deepseek-v4-flash`)
   - `ZAIDA_DIRECT_DEEPSEEK_MODEL` (default: `deepseek-chat`)
8. Deploy.

The `functions/` directory must remain at the repository root. Do not use `npx wrangler deploy` as the deploy command for this Pages project.

Never put API keys in frontend files or commit them to Git.

## AI Script provider flow
- Primary: Kiosapi using `POST https://api.kiosapi.id/v1/chat/completions`.
- Kiosapi model fallback: `openai/gpt-4o-mini` → `deepseek/deepseek-v4-flash` in one request. Kiosapi only bills the model that successfully responds.
- Emergency fallback: if the Kiosapi gateway request fails and `DEEPSEEK_API_KEY` is configured, the function tries the direct DeepSeek API.
- Credit reservation is made before provider calls, then settled using Kiosapi's reported `usage.cost_idr` (or cost header) with the configured 1.5x multiplier. Failed provider attempts release the reservation.
- DeepSeek direct fallback uses the existing token-based DeepSeek cost calculation.

## API routes
- `GET /api/voices`
- `POST /api/tts`
- `POST /api/script`

The TTS route remains on ElevenLabs. SRT subtitle generation is a separate feature and is not included in this script-provider change.


## Midtrans Sandbox credit top-ups
- Package prices and credit amounts are fixed server-side in `functions/api/payment/create.js`; never trust amounts supplied by the browser.
- `POST /api/payment/create` creates a Midtrans Snap checkout for an authenticated, email-verified user.
- `POST /api/payment/webhook` validates the Midtrans signature and independently checks transaction status with the Midtrans Sandbox API before crediting.
- `GET /api/payment/status?order_id=...` lets the signed-in buyer refresh their own payment status after returning from checkout.
- Credits are added atomically to the user's Firestore account with a unique payment ledger entry, preventing duplicate webhook notifications from crediting twice.
- Configure the Midtrans Sandbox Payment Notification URL as `https://voice.zaidalabs.com/api/payment/webhook`.
- This implementation currently uses Sandbox endpoints only. Replace with Production endpoints and the separate Production Server Key only after merchant activation and a successful Sandbox test.
