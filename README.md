# TTF Scaffolding Chatbot

Embeddable AI chat assistant for **ttfscaffolding.com**, built with Next.js 15
(App Router) + TypeScript + Tailwind + OpenAI streaming.

## Local development

```bash
cp .env.local.example .env.local
# add your OPENAI_API_KEY
npm install
npm run dev
```

Open http://localhost:3000

## Deploying

Deploy to Vercel (recommended). Add `OPENAI_API_KEY` to project env vars.

```bash
npx vercel
```

## Embedding on ttfscaffolding.com

The app is configured (in `next.config.ts`) to allow iframe embedding **only**
from `ttfscaffolding.com` and `www.ttfscaffolding.com` via the
`Content-Security-Policy: frame-ancestors` header.

### Floating bubble (recommended)

Paste this near the closing `</body>` tag of ttfscaffolding.com. Replace
`YOUR_DEPLOY_URL` with the deployed URL (e.g. `https://ttf-chatbot.vercel.app`):

```html
<!-- TTF Scaffolding chatbot -->
<style>
  #ttf-chat-toggle{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;background:#f59e0b;color:#fff;border:none;box-shadow:0 8px 20px rgba(0,0,0,.2);cursor:pointer;z-index:9999;display:flex;align-items:center;justify-content:center;transition:transform .15s}
  #ttf-chat-toggle:hover{transform:scale(1.05)}
  #ttf-chat-frame{position:fixed;right:20px;bottom:90px;width:380px;height:600px;max-height:calc(100vh - 110px);border:0;border-radius:16px;box-shadow:0 16px 40px rgba(0,0,0,.25);z-index:9999;background:#fff;display:none}
  #ttf-chat-frame.open{display:block}
  @media (max-width:480px){
    #ttf-chat-frame{right:0;bottom:0;width:100vw;height:100dvh;max-height:100dvh;border-radius:0}
    #ttf-chat-toggle{right:16px;bottom:16px}
  }
</style>
<button id="ttf-chat-toggle" aria-label="Open chat">
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
</button>
<iframe id="ttf-chat-frame" src="https://YOUR_DEPLOY_URL" title="TTF Scaffolding Assistant"></iframe>
<script>
  (function(){
    var btn=document.getElementById('ttf-chat-toggle');
    var frame=document.getElementById('ttf-chat-frame');
    btn.addEventListener('click',function(){frame.classList.toggle('open')});
  })();
</script>
```

### Plain inline embed

```html
<iframe
  src="https://YOUR_DEPLOY_URL"
  style="border:0;width:100%;max-width:480px;height:600px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.1)"
  title="TTF Scaffolding Assistant"
></iframe>
```

## Customizing

- **System prompt / persona:** edit `SYSTEM_PROMPT` in `app/api/chat/route.ts`.
- **Model:** change the `model` in the same file (`gpt-4o-mini` by default).
- **Colors / branding:** edit `app/Chat.tsx` (amber accents — swap for brand color).
- **Allowed embed domains:** edit `ALLOWED_FRAME_ANCESTORS` in `next.config.ts`.
