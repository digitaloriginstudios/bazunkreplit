# Bazunk Shorts on Cloudflare Stream

Set these variables on the Bazunk API service.

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_STREAM_ACCOUNT_ID` | Cloudflare account ID. |
| `CLOUDFLARE_STREAM_API_TOKEN` | Account-scoped Stream API token with read and edit access. |
| `CLOUDFLARE_STREAM_CUSTOMER_HOST` | Stream delivery hostname, for example `customer-example.cloudflarestream.com`. Supply the hostname without a scheme or path. |
| `CLOUDFLARE_STREAM_SIGNING_KEY_ID` | Optional Stream signing key ID. Set both signing key values to generate playback tokens locally. |
| `CLOUDFLARE_STREAM_SIGNING_KEY_BASE64` | Base64-encoded RSA private key in PEM format for the signing key. Keep this value secret. |

With the optional signing keys absent, the API uses Cloudflare's token endpoint. That endpoint is suitable for a limited rollout and counts against Cloudflare API limits. Locally signed playback tokens avoid a provider API call per open. Both flows issue tokens valid for five minutes.

In a test environment, enable **Bazunk Social** and **Bazunk Shorts and unboxings** under Feature Toggles. A member needs a Social profile to upload. The browser uploads directly to Stream. The API checks the encoded asset for portrait dimensions, duration, size when reported by Stream, and signed playback before adding the English WebVTT track and moving the video to review. The API service processes pending videos and retries source deletion after rejection or removal.

Review pending videos under **Content → Shorts moderation**. Approve a test Short, sign in as another account, watch it with captions, click a product and report it. Check the report in moderation and the unique engagement counts in **My videos**. Test an unboxing with a delivered live Stripe order owned by the viewer. Test-mode, refunded and unpaid orders are ineligible. Shorts can tag up to five listings. Unboxing clips use the order for verification and do not accept self-assigned product tags.

The flags default to off. Validate signed playback, captions, upload CORS and moderation against the configured Stream account before enabling customer access.
