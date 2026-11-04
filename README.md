# ZAIDA Voice

AI Voice Studio by ZAIDA Labs.

## Stack
- Static frontend: HTML, CSS, JavaScript
- Cloudflare Pages Functions: secure API proxy
- DeepSeek API: script refinement
- ElevenLabs API: voice catalog and text-to-speech

## Deploy
1. Connect this repository to Cloudflare Pages.
2. Leave the build command empty and set the build output directory to `.` (repository root).
3. Add the following environment variables in Cloudflare Pages > Settings > Environment variables:
   - `ELEVENLABS_API_KEY`
   - `DEEPSEEK_API_KEY`
4. Deploy the project.

Never put API keys in frontend files or commit them to Git.

## API routes
- `GET /api/voices`
- `POST /api/tts`
- `POST /api/script`

The initial beta stores generated audio history in the current browser session only. Add authentication, usage limits, billing, and persistent history before opening the service publicly.