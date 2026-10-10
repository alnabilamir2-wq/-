import type { CookieOptions } from "express";

/**
 * Webdev Preview and production provide a project ID and are browser-facing HTTPS,
 * even when the application receives its proxied request over plain HTTP.
 * Local HTTP development remains separate and never relies on req.secure or NODE_ENV.
 */
export function isManusHosted(): boolean {
  return Boolean(process.env.MANUS_PROJECT_ID);
}

export function getSessionCookieOptions(): Pick<
  CookieOptions,
  "httpOnly" | "path" | "sameSite" | "secure"
> {
  const hosted = isManusHosted();
  return {
    httpOnly: true,
    path: "/",
    sameSite: hosted ? "none" : "lax",
    secure: hosted,
  };
}

export function getOAuthStateCookieOptions(): Pick<
  CookieOptions,
  "httpOnly" | "maxAge" | "path" | "sameSite" | "secure"
> {
  const hosted = isManusHosted();
  return {
    httpOnly: true,
    maxAge: 5 * 60 * 1000,
    path: "/api/oauth",
    sameSite: hosted ? "none" : "lax",
    secure: hosted,
  };
}
