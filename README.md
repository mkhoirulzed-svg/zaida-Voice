# ZAIDA Voice

AI Voice Studio by ZAIDA Labs.

## Stack
- Static frontend: HTML, CSS, JavaScript in `public/`
- Cloudflare Pages Functions: secure API proxy in root `functions/`
- OpenRouter: primary AI gateway for script editing, assistant, storyboard generation, and storyboard images
- KiosAPI: optional fallback provider for text and image generation
- DeepSeek direct API: optional emergency fallback if gateway providers are unavailable
- ElevenLabs API: voice catalog and text-to-speech

## Deploy with Cloudflare Pages
1. Connect this repository to Cloudflare Pages using the Pages Git integration.
2. Set Framework preset to **None**.
3. Leave the build command empty.
4. Set the build output directory to `public`.
5. Keep the project root directory as `/`.
6. Add these environment variables in Pages project settings:
   - `OPENROUTER_API_KEY` (primary AI gateway for text, storyboard, and image generation)
   - `KIOSAPI_API_KEY` (optional fallback for text and image generation)
   - `DEEPSEEK_API_KEY` (optional direct text fallback)
   - `ZAIDA_AI_MARKUP` = `1.5` (provider cost + 50%)
   - `ELEVENLABS_API_KEY`
   - `MIDTRANS_SERVER_KEY` (Sandbox Server Key for payment testing)
   - Existing Firebase service-account variables
7. Optional model overrides:
   - `ZAIDA_OPENROUTER_TEXT_MODEL` (default: `google/gemini-3.1-flash-lite`)
   - `ZAIDA_OPENROUTER_STORYBOARD_MODEL` (default: `google/gemini-3.1-flash-lite`)
   - `ZAIDA_OPENROUTER_IMAGE_MODEL` and `ZAIDA_OPENROUTER_IMAGE_EDIT_MODEL` (default: `bytedance-seed/seedream-5-0-flash`)
   - `ZAIDA_USD_TO_IDR` (default: `18000`, used for OpenRouter cost conversion)
   - `ZAIDA_KIOSAPI_PRIMARY_MODEL` / `ZAIDA_KIOSAPI_FALLBACK_MODEL` (optional legacy KiosAPI overrides)
   - `ZAIDA_DIRECT_DEEPSEEK_MODEL` (default: `deepseek-chat`)
8. Deploy.

The `functions/` directory must remain at the repository root. Do not use `npx wrangler deploy` as the deploy command for this Pages project.

Never put API keys in frontend files or commit them to Git.

## AI provider flow
- Primary text gateway: OpenRouter using the OpenAI-compatible Chat Completions endpoint.
- Default text model: `google/gemini-3.1-flash-lite` for script editing, assistant chat, and storyboard JSON.
- Default image model: `bytedance-seed/seedream-5-0-flash` through OpenRouter Images API (listed from $0.018/image; actual usage cost is read from the API response when available).
- KiosAPI remains available as a fallback for storyboard/image workflows; direct DeepSeek remains an optional text fallback.
- OpenRouter usage cost in USD is converted to IDR using `ZAIDA_USD_TO_IDR`, then the existing `ZAIDA_AI_MARKUP` multiplier is applied.
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
