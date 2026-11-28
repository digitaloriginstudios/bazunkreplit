import { createSign } from "node:crypto";

const uidPattern = /^[a-f0-9]{32}$/;
export const shortSeconds = 90;
export const uploadMinutes = 30;

function settings() {
  const account = process.env.CLOUDFLARE_STREAM_ACCOUNT_ID ?? "";
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  const host = process.env.CLOUDFLARE_STREAM_CUSTOMER_HOST ?? "";
  if (
    !uidPattern.test(account) ||
    !apiToken ||
    !/^customer-[a-z0-9]+\.cloudflarestream\.com$/.test(host)
  ) {
    throw new Error("Shorts video provider is unavailable.");
  }
  return { account, apiToken, host };
}

async function stream<T>(
  path: string,
  method = "GET",
  body?: object | FormData,
) {
  const { account, apiToken } = settings();
  const form = body instanceof FormData;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/stream${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        ...(body && !form ? { "Content-Type": "application/json" } : {}),
      },
      body: form ? body : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (method === "DELETE" && response.status === 404) return undefined as T;
  if (response.status === 204 && response.ok) return undefined as T;
  const payload = (await response.json()) as { success: boolean; result: T };
  if (!response.ok || !payload.success)
    throw new Error("Video provider request failed.");
  return payload.result;
}

function videoPath(uid: string) {
  if (!uidPattern.test(uid)) throw new Error("Invalid video identifier.");
  return `/${uid}`;
}

export async function createShortUpload() {
  const result = await stream<{ uid: string; uploadURL: string }>(
    "/direct_upload",
    "POST",
    {
      maxDurationSeconds: shortSeconds,
      expiry: new Date(Date.now() + uploadMinutes * 60_000).toISOString(),
      requireSignedURLs: true,
    },
  );
  const upload = new URL(result.uploadURL);
  videoPath(result.uid);
  if (upload.origin !== "https://upload.videodelivery.net")
    throw new Error("Invalid provider upload URL.");
  return result;
}

export function shortEncoding(uid: string) {
  return stream<{
    readyToStream: boolean;
    duration?: number;
    size?: number;
    requireSignedURLs?: boolean;
    status?: { state?: string };
    input?: { width?: number; height?: number };
  }>(videoPath(uid));
}

export function uploadShortCaptions(uid: string, caption: string) {
  const form = new FormData();
  form.set("file", new Blob([caption], { type: "text/vtt" }), "captions.vtt");
  return stream(`${videoPath(uid)}/captions/en`, "PUT", form);
}

export function deleteShortMedia(uid: string) {
  return stream(videoPath(uid), "DELETE");
}

export async function shortPlayback(uid: string) {
  const { host } = settings();
  const path = videoPath(uid);
  const exp = Math.floor(Date.now() / 1000) + 300;
  const kid = process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID;
  const encoded = process.env.CLOUDFLARE_STREAM_SIGNING_KEY_BASE64;
  let token: string;
  if (kid && encoded) {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({ sub: uid, kid, exp }),
    ).toString("base64url");
    const signature = createSign("RSA-SHA256")
      .update(`${header}.${payload}`)
      .sign(Buffer.from(encoded, "base64"))
      .toString("base64url");
    token = `${header}.${payload}.${signature}`;
  } else {
    ({ token } = await stream<{ token: string }>(`${path}/token`, "POST", {
      exp,
    }));
  }
  if (!/^[\w.-]+$/.test(token)) throw new Error("Invalid playback token.");
  const base = `https://${host}/${token}`;
  return {
    player: `${base}/iframe?defaultTextTrack=en&preload=metadata`,
    thumbnail: `${base}/thumbnails/thumbnail.jpg?height=720`,
    manifest: `${base}/manifest/video.m3u8`,
    expiresAt: exp * 1000,
  };
}
