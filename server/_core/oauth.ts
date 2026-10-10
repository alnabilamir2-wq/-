import { randomBytes, timingSafeEqual } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const.js";
import { getUserByOpenId, upsertUser } from "../db";
import { getOAuthStateCookieOptions, getSessionCookieOptions, isManusHosted } from "./cookies";
import { ENV } from "./env";
import { assertOAuthProjectScope } from "./oauth-scope";
import { sdk } from "./sdk";

const OAUTH_NONCE_COOKIE = "wasel_oauth_nonce";

type OAuthState = { redirectUri: string; nonce: string };

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function decodeOAuthState(value: string): OAuthState | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as Partial<OAuthState>;
    if (typeof parsed.redirectUri !== "string" || typeof parsed.nonce !== "string") return null;

    const callback = new URL(parsed.redirectUri);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname);
    if (
      callback.pathname !== "/api/oauth/callback" ||
      callback.search ||
      callback.hash ||
      callback.username ||
      callback.password ||
      (callback.protocol !== "https:" && !(local && callback.protocol === "http:")) ||
      !/^[a-f0-9]{64}$/.test(parsed.nonce)
    ) return null;

    return { redirectUri: callback.toString(), nonce: parsed.nonce };
  } catch {
    return null;
  }
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAllowedOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (
      url.origin === value &&
      !url.username &&
      !url.password &&
      (url.protocol === "https:" || (local && url.protocol === "http:"))
    );
  } catch {
    return false;
  }
}

function matchesBrowserOrigin(req: Request, expectedOrigin: string): boolean {
  if (req.get("origin") === expectedOrigin) return true;
  const referer = req.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin === expectedOrigin) return true;
    } catch {
      // Continue to the trusted Preview forwarding headers.
    }
  }

  if (!isManusHosted()) return false;
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (!forwardedHost || !forwardedProto || !["http", "https"].includes(forwardedProto)) return false;
  const publicOrigin = `${forwardedProto}://${forwardedHost}`;
  return isAllowedOrigin(publicOrigin) && publicOrigin === expectedOrigin;
}

function clearOAuthNonce(res: Response) {
  const options = getOAuthStateCookieOptions();
  res.clearCookie(OAUTH_NONCE_COOKIE, {
    httpOnly: options.httpOnly,
    path: options.path,
    sameSite: options.sameSite,
    secure: options.secure,
  });
}

async function syncUser(userInfo: {
  openId?: string | null;
  projectId?: string | null;
  name?: string | null;
  email?: string | null;
  loginMethod?: string | null;
  platform?: string | null;
}) {
  if (!userInfo.openId) throw new Error("openId missing from user info");
  assertOAuthProjectScope(userInfo.projectId, ENV.appId);

  const lastSignedIn = new Date();
  await upsertUser({
    openId: userInfo.openId,
    name: userInfo.name || null,
    email: userInfo.email ?? null,
    loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
    lastSignedIn,
  });
  const saved = await getUserByOpenId(userInfo.openId);
  if (!saved) throw new Error("OAuth user was not persisted to the project database");
  return saved;
}

function buildUserResponse(
  user:
    | Awaited<ReturnType<typeof getUserByOpenId>>
    | {
        openId: string;
        name?: string | null;
        email?: string | null;
        loginMethod?: string | null;
        lastSignedIn?: Date | null;
      },
) {
  return {
    id: (user as any)?.id ?? null,
    openId: user?.openId ?? null,
    name: user?.name ?? null,
    email: user?.email ?? null,
    loginMethod: user?.loginMethod ?? null,
    lastSignedIn: (user?.lastSignedIn ?? new Date()).toISOString(),
  };
}

export function registerOAuthRoutes(app: Express) {
  app.post("/api/oauth/start", (req: Request, res: Response) => {
    const origin = req.body?.origin;
    if (!ENV.appId || !ENV.oAuthPortalUrl || typeof origin !== "string") {
      res.status(503).json({ error: "إعدادات تسجيل الدخول غير مكتملة على الخادم." });
      return;
    }
    if (!isAllowedOrigin(origin) || !matchesBrowserOrigin(req, origin)) {
      res.status(400).json({ error: "تعذر التحقق من مصدر طلب تسجيل الدخول." });
      return;
    }

    const nonce = randomBytes(32).toString("hex");
    const redirectUri = new URL("/api/oauth/callback", origin).toString();
    const state = Buffer.from(JSON.stringify({ redirectUri, nonce }), "utf8").toString("base64");
    const authorizationUrl = new URL("app-auth", `${ENV.oAuthPortalUrl.replace(/\/+$/, "")}/`);
    authorizationUrl.searchParams.set("appId", ENV.appId);
    authorizationUrl.searchParams.set("redirectUri", redirectUri);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("responseType", "code");

    res.cookie(OAUTH_NONCE_COOKIE, nonce, getOAuthStateCookieOptions());
    res.json({ authorizationUrl: authorizationUrl.toString() });
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const stateValue = getQueryParam(req, "state");
    const state = stateValue ? decodeOAuthState(stateValue) : null;
    const cookies = req.headers.cookie ? parseCookieHeader(req.headers.cookie) : {};
    const nonce = cookies[OAUTH_NONCE_COOKIE];
    clearOAuthNonce(res);

    if (!code || !state || typeof nonce !== "string" || !sameSecret(state.nonce, nonce)) {
      res.status(400).send("تعذر التحقق من طلب تسجيل الدخول؛ ابدأ المحاولة من جديد.");
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state.redirectUri);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      await syncUser(userInfo);
      const sessionToken = await sdk.createSessionToken(userInfo.openId!, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      res.cookie(COOKIE_NAME, sessionToken, {
        ...getSessionCookieOptions(),
        maxAge: ONE_YEAR_MS,
      });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).send("تعذر إكمال تسجيل الدخول؛ حاول مرة أخرى.");
    }
  });

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(), maxAge: -1 });
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      res.json({ user: buildUserResponse(user) });
    } catch {
      res.status(401).json({ error: "Not authenticated", user: null });
    }
  });

  app.post("/api/auth/session", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
        res.status(400).json({ error: "Bearer token required" });
        return;
      }
      const token = authHeader.slice("Bearer ".length).trim();
      res.cookie(COOKIE_NAME, token, {
        ...getSessionCookieOptions(),
        maxAge: ONE_YEAR_MS,
      });
      res.json({ success: true, user: buildUserResponse(user) });
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });
}
