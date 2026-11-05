# ZAIDA Voice

AI Voice Studio by ZAIDA Labs.

## Stack
- Static frontend: HTML, CSS, JavaScript in `public/`
- Cloudflare Pages Functions: secure API proxy in root `functions/`
- DeepSeek API: script refinement
- ElevenLabs API: voice catalog and text-to-speech

## Deploy with Cloudflare Pages
1. Connect this repository to Cloudflare Pages using the Pages Git integration.
2. Set Framework preset to **None**.
3. Leave the build command empty.
4. Set the build output directory to `public`.
5. Keep the project root directory as `/`.
6. Add these environment variables in Pages project settings:
   - `ELEVENLABS_API_KEY`
   - `DEEPSEEK_API_KEY`
7. Deploy.

The `functions/` directory must remain at the repository root. Do not use `npx wrangler deploy` as the deploy command for this Pages project.

Never put API keys in frontend files or commit them to Git.

## API routes
- `GET /api/voices`
- `POST /api/tts`
- `POST /api/script`

The initial beta stores generated audio history in the current browser session only. Add authentication, usage limits, billing, and persistent history before opening the service publicly.
