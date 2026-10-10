import * as Linking from "expo-linking";
import * as ReactNative from "react-native";

const bundleId = "com.app.waselmobile";
const timestamp = bundleId.split(".").pop()?.replace(/^t/, "") ?? "";
const schemeFromBundleId = `manus${timestamp}`;

const env = {
  portal: process.env.EXPO_PUBLIC_OAUTH_PORTAL_URL ?? "",
  appId: process.env.EXPO_PUBLIC_APP_ID ?? "",
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  deepLinkScheme: schemeFromBundleId,
};

export const OAUTH_PORTAL_URL = env.portal;
export const APP_ID = env.appId;
export const API_BASE_URL = env.apiBaseUrl;

/** Resolve API calls to the current website origin; only local Metro uses port 3000. */
export function getApiBaseUrl(): string {
  if (API_BASE_URL) return API_BASE_URL.replace(/\/$/, "");

  if (ReactNative.Platform.OS === "web" && typeof window !== "undefined") {
    const { protocol, hostname, origin, port } = window.location;
    if ((hostname === "localhost" || hostname === "127.0.0.1") && port === "8081") {
      return `${protocol}//${hostname}:3000`;
    }
    if (hostname.startsWith("8081-")) {
      return `${protocol}//${hostname.replace(/^8081-/, "3000-")}`;
    }
    return origin;
  }

  return API_BASE_URL.replace(/\/$/, "");
}

export const SESSION_TOKEN_KEY = "app_session_token";
export const USER_INFO_KEY = "manus-runtime-user-info";

export const getRedirectUri = () =>
  ReactNative.Platform.OS === "web"
    ? `${getApiBaseUrl()}/api/oauth/callback`
    : Linking.createURL("/oauth/callback", { scheme: env.deepLinkScheme });

/** Begin the server-bound OAuth flow; the server creates and binds a one-time state nonce. */
export async function startOAuthLogin(): Promise<string | null> {
  if (ReactNative.Platform.OS !== "web" || typeof window === "undefined") {
    throw new Error("تسجيل الدخول متاح عبر موقع واصل على الويب.");
  }

  const response = await fetch(`${getApiBaseUrl()}/api/oauth/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ origin: window.location.origin }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "تعذر بدء تسجيل الدخول؛ حاول مرة أخرى.");
  }

  const result = (await response.json()) as { authorizationUrl?: string };
  if (!result.authorizationUrl) throw new Error("لم يُرجع خادم المصادقة رابط الدخول.");
  window.location.assign(result.authorizationUrl);
  return null;
}
