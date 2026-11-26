import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

const gateway = "https://api-sg.aliexpress.com";
const renewBeforeMs = 5 * 60_000;
const intervalMs = 60_000;

export const aliExpressOAuthMigration = sql`
  CREATE TABLE IF NOT EXISTS bazunk_aliexpress_connection (
    id integer PRIMARY KEY CHECK (id = 1),
    access_token text,
    refresh_token text,
    expires_at timestamptz,
    refresh_expires_at timestamptz,
    connected_at timestamptz,
    renewed_at timestamptz,
    state_hash text,
    state_expires_at timestamptz
  )
`;

export function aliExpressCredentials() {
  const dsKey = process.env.ALIEXPRESS_DS_APP_KEY?.trim();
  const dsSecret = process.env.ALIEXPRESS_DS_APP_SECRET?.trim();
  if (dsKey && dsSecret) return { appKey: dsKey, secret: dsSecret };

  const appKey = process.env.ALIEXPRESS_APP_KEY?.trim();
  const secret = process.env.ALIEXPRESS_APP_SECRET?.trim();
  return appKey && secret ? { appKey, secret } : null;
}

function encryptionKey() {
  const key = process.env.BAZUNK_ALIEXPRESS_TOKEN_KEY;
  return key && /^[a-f0-9]{64}$/i.test(key) ? Buffer.from(key, "hex") : null;
}

function seal(value: string, purpose: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

function unseal(value: string, purpose: string, key: Buffer) {
  try {
    const data = Buffer.from(value, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new AliExpressConnectionError("Stored AliExpress credentials could not be decrypted. Reauthorise the connection.");
  }
}

export class AliExpressConnectionError extends Error {}

export function aliExpressRedirectUri() {
  const uri = new URL(process.env.ALIEXPRESS_REDIRECT_URI || "https://www.bazunk.com/api/integrations/aliexpress/callback");
  if (uri.protocol !== "https:" || uri.username || uri.password || uri.search || uri.hash ||
      uri.pathname !== "/api/integrations/aliexpress/callback") {
    throw new AliExpressConnectionError("Invalid AliExpress callback URL.");
  }
  return uri.toString();
}

const stateHash = (state: string) => createHash("sha256").update(state).digest("hex");

export async function beginAliExpressAuthorization() {
  const credentials = aliExpressCredentials();
  if (!credentials || !encryptionKey()) {
    throw new AliExpressConnectionError("Configure the AliExpress app credentials and token encryption key on the API service.");
  }
  const url = new URL("/oauth/authorize", gateway);
  const state = "bazunk." + randomBytes(32).toString("hex");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: credentials.appKey,
    redirect_uri: aliExpressRedirectUri(),
    state,
  }).toString();
  await db.execute(sql`
    INSERT INTO bazunk_aliexpress_connection (id, state_hash, state_expires_at)
    VALUES (1, ${stateHash(state)}, now() + interval '10 minutes')
    ON CONFLICT (id) DO UPDATE SET state_hash = excluded.state_hash, state_expires_at = excluded.state_expires_at
  `);
  return url.toString();
}

function expiry(seconds: unknown) {
  const duration = Number(seconds);
  if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 2_147_483_647) {
    throw new AliExpressConnectionError("AliExpress returned an invalid token lifetime.");
  }
  return new Date(Date.now() + duration * 1000);
}

async function requestTokens(path: "/auth/token/create" | "/auth/token/refresh", input: Record<string, string>) {
  const credentials = aliExpressCredentials();
  if (!credentials) throw new AliExpressConnectionError("AliExpress app credentials are missing.");
  const params: Record<string, string> = {
    app_key: credentials.appKey,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    ...input,
  };
  const signatureInput = path + Object.keys(params).sort().map(key => key + params[key]).join("");
  params.sign = createHmac("sha256", credentials.secret).update(signatureInput).digest("hex").toUpperCase();

  const response = await fetch(gateway + "/rest" + path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new AliExpressConnectionError("AliExpress token endpoint returned HTTP " + response.status + ".");
  const body = await response.json() as { gopResponseBody?: unknown; gopErrorCode?: unknown } | null;
  const nested = body?.gopResponseBody;
  const result = (typeof nested === "string" ? JSON.parse(nested) : nested ?? body) as {
    access_token?: unknown; refresh_token?: unknown; expires_in?: unknown;
    refresh_expires_in?: unknown; code?: unknown;
  } | null;
  if (typeof result?.access_token !== "string" || !result.access_token) {
    const code = String(result?.code ?? body?.gopErrorCode ?? "");
    const reference = /^[a-z0-9_.-]{1,48}$/i.test(code) ? " (" + code + ")" : "";
    throw new AliExpressConnectionError("AliExpress rejected the token request" + reference + ".");
  }
  return {
    access: result.access_token,
    refresh: typeof result.refresh_token === "string" ? result.refresh_token : "",
    expiresAt: expiry(result.expires_in),
    refreshExpiresAt: result.refresh_expires_in == null ? null : expiry(result.refresh_expires_in),
  };
}

export async function completeAliExpressAuthorization(state: string, code: string) {
  const key = encryptionKey();
  if (!key || !/^bazunk\.[a-f0-9]{64}$/.test(state)) return false;
  return db.transaction(async tx => {
    const stateClaim = await tx.execute(sql`
      UPDATE bazunk_aliexpress_connection SET state_hash = NULL, state_expires_at = NULL
      WHERE id = 1 AND state_hash = ${stateHash(state)} AND state_expires_at > now()
      RETURNING id
    `);
    if (!stateClaim.rows.length || !code || code.length > 1024) return false;
    try {
      const tokens = await requestTokens("/auth/token/create", { code });
      if (!tokens.refresh || !tokens.refreshExpiresAt) {
        throw new AliExpressConnectionError("AliExpress did not return renewable credentials.");
      }
      await tx.execute(sql`
        UPDATE bazunk_aliexpress_connection SET access_token = ${seal(tokens.access, "access", key)},
          refresh_token = ${seal(tokens.refresh, "refresh", key)}, expires_at = ${tokens.expiresAt},
          refresh_expires_at = ${tokens.refreshExpiresAt}, connected_at = now(), renewed_at = NULL
        WHERE id = 1
      `);
      return true;
    } catch (error) {
      logger.warn({ reason: aliExpressErrorMessage(error) }, "AliExpress authorization failed");
      return false;
    }
  });
}

export function aliExpressErrorMessage(error: unknown) {
  return error instanceof AliExpressConnectionError ? error.message : "AliExpress connection request failed. Please retry.";
}

export async function disconnectAliExpress() {
  await db.execute(sql`DELETE FROM bazunk_aliexpress_connection WHERE id = 1`);
}

export async function aliExpressConnectionStatus() {
  const { rows } = await db.execute<{
    expires_at: string | null; refresh_expires_at: string | null; connected_at: string | null; renewed_at: string | null;
  }>(sql`SELECT expires_at, refresh_expires_at, connected_at, renewed_at
         FROM bazunk_aliexpress_connection WHERE id = 1`);
  const row = rows[0];
  return {
    configured: Boolean(aliExpressCredentials() && encryptionKey()),
    redirectUri: aliExpressRedirectUri(),
    connectedAt: row?.connected_at ?? null,
    expiresAt: row?.expires_at ?? null,
    refreshExpiresAt: row?.refresh_expires_at ?? null,
    renewedAt: row?.renewed_at ?? null,
    needsAuthorization: Boolean(row?.connected_at && row.refresh_expires_at && row.expires_at &&
      Date.parse(row.refresh_expires_at) <= Date.now() && Date.parse(row.expires_at) <= Date.now()),
  };
}

export async function hasManagedAliExpressConnection() {
  if (!aliExpressCredentials() || !encryptionKey()) return false;
  const { rows } = await db.execute(sql`SELECT 1 FROM bazunk_aliexpress_connection WHERE id = 1 AND connected_at IS NOT NULL`);
  return rows.length > 0;
}

export async function managedAliExpressAccessToken(options: { force?: boolean; dueOnly?: boolean; rejectedToken?: string } = {}) {
  const key = encryptionKey();
  if (!key) return null;
  return db.transaction(async tx => {
    const { rows } = await tx.execute<{
      access_token: string; refresh_token: string; expires_at: string; refresh_expires_at: string;
    }>(sql`SELECT access_token, refresh_token, expires_at, refresh_expires_at
           FROM bazunk_aliexpress_connection WHERE id = 1 AND connected_at IS NOT NULL FOR UPDATE`);
    const row = rows[0];
    if (!row) return null;
    const now = Date.now();
    const expiresAt = Date.parse(row.expires_at);
    if (!options.force && !options.rejectedToken && expiresAt > now + renewBeforeMs) {
      return options.dueOnly ? null : unseal(row.access_token, "access", key);
    }
    if (options.rejectedToken && expiresAt > now + renewBeforeMs) {
      const token = unseal(row.access_token, "access", key);
      if (token !== options.rejectedToken) return token;
    }
    if (Date.parse(row.refresh_expires_at) <= now) {
      if (!options.force && !options.rejectedToken && expiresAt > now) {
        return options.dueOnly ? null : unseal(row.access_token, "access", key);
      }
      if (options.dueOnly) return null;
      throw new AliExpressConnectionError("AliExpress renewal permission has expired. Reauthorise the connection.");
    }

    const refreshToken = unseal(row.refresh_token, "refresh", key);
    const tokens = await requestTokens("/auth/token/refresh", { refresh_token: refreshToken }).catch(error => {
      if (options.force || options.dueOnly || options.rejectedToken || expiresAt <= Date.now()) throw error;
      return null;
    });
    if (!tokens) return unseal(row.access_token, "access", key);
    await tx.execute(sql`
      UPDATE bazunk_aliexpress_connection SET access_token = ${seal(tokens.access, "access", key)},
        refresh_token = ${seal(tokens.refresh || refreshToken, "refresh", key)}, expires_at = ${tokens.expiresAt},
        refresh_expires_at = ${tokens.refreshExpiresAt ?? row.refresh_expires_at}, renewed_at = now()
      WHERE id = 1
    `);
    return tokens.access;
  });
}

export function startAliExpressRenewal() {
  if (!encryptionKey() || !aliExpressCredentials()) return;
  const renew = () => {
    void managedAliExpressAccessToken({ dueOnly: true }).catch(error => {
      logger.warn({ reason: aliExpressErrorMessage(error) }, "AliExpress automatic renewal failed");
    });
  };
  renew();
  setInterval(renew, intervalMs).unref();
}
