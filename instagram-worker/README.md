# FAMA Instagram DM Webhook

This is a separate Cloudflare Worker. It does not modify the existing FAMA voice app or TTS Worker.

## What it does

- Verifies Meta's webhook challenge at `/webhook`.
- Verifies incoming POST requests using `X-Hub-Signature-256` and the Meta App Secret.
- Accepts text DMs for an Instagram professional account.
- Sends the message to the existing FAMA chat endpoint and returns FAMA's `reply` through Instagram's Messaging API.
- Ignores echoes, non-text messages, and messages sent by the connected account.
- Optionally uses a Cloudflare KV binding named `FAMA_KV` to deduplicate Meta webhook retries and retain short per-customer conversation context (7 days). Without KV, replies are stateless.

## Cloudflare secrets

Set these as Worker secrets (never commit them to Git):

- `META_VERIFY_TOKEN`: a long random string you also enter in Meta's webhook Verify Token field.
- `META_APP_SECRET`: App Secret from the Meta developer app.
- `IG_ACCESS_TOKEN`: Instagram User Access Token with `instagram_business_manage_messages`.
- `IG_USER_ID`: Instagram professional account ID.

The Worker also supports vars `FAMA_CHAT_URL` and `GRAPH_API_VERSION`; defaults are in `wrangler.toml`.

## Meta setup still required

1. Use an Instagram Professional account (Business or Creator) and the current Instagram API with Instagram Login setup.
2. Add the messaging permission `instagram_business_manage_messages` (and the base account permission required by Meta's current setup).
3. Configure the callback URL as `https://YOUR-WORKER.workers.dev/webhook`.
4. Set the exact same `META_VERIFY_TOKEN` in Meta and Cloudflare.
5. Subscribe the app to the Instagram `messages` webhook field.
6. Ensure the app/account has the required roles and access. In Development mode, only app-role/tester accounts can generally exercise the integration; external customer access requires Meta's review/approval as applicable.

## Deploy

Create a new Cloudflare Worker named `fama-instagram-webhook` and deploy this folder using Wrangler or Cloudflare's Git integration. Add the four secrets above in Worker Settings > Variables and Secrets.

Optional: create a KV namespace and bind it as `FAMA_KV` for webhook event deduplication.

## Important limits

- This is a text-only first version. Images, voice notes, story replies, comments, handoff inbox, and multi-turn memory are not implemented yet.
- It only replies after a user initiates a conversation. It is not for unsolicited messages.
- Meta's messaging window and platform policies apply. Never use it for bulk or unsolicited outreach.
- No live customer messages are sent until the Worker is deployed, Meta is configured, and the account token is supplied.
- The existing FAMA chat endpoint is used as-is; voice and TTS files are not changed.
