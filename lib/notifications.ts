import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { getApiBaseUrl } from "@/constants/oauth";

export const VOICE_CHANNEL_ID = "wasel-voice-calls";
export const VOICE_CATEGORY_ID = "wasel-incoming-call";
let browserNotification: Notification | null = null;

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function configureNotifications() {
  if (Platform.OS === "web") {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    return (await Notification.requestPermission()) === "granted";
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(VOICE_CHANNEL_ID, {
      name: "مكالمات واصل",
      description: "تنبيهات المكالمات الصوتية الواردة",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 300, 150, 300, 150, 500],
      sound: "ringtone.wav",
      lightColor: "#54E1B5",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  await Notifications.setNotificationCategoryAsync(VOICE_CATEGORY_ID, [
    { identifier: "accept", buttonTitle: "قبول", options: { opensAppToForeground: true } },
    { identifier: "decline", buttonTitle: "رفض", options: { isDestructive: true } },
  ]);

  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return requested.granted;
}

export async function getPushToken(): Promise<string | null> {
  if (Platform.OS === "web" || !Constants.isDevice) return null;
  try {
    const projectId =
      process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) return null;
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (error) {
    console.warn("[notifications] Push token unavailable", error);
    return null;
  }
}

export async function registerPushToken(room: string, token: string | null) {
  if (!token) return;
  const apiBase = getApiBaseUrl();
  if (!apiBase) return;
  try {
    await fetch(`${apiBase}/api/push/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: room.trim().toUpperCase(), token }),
    });
  } catch (error) {
    console.warn("[notifications] Push token registration failed", error);
  }
}

export async function showIncomingCallNotification(room: string) {
  if (Platform.OS === "web") {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return null;
    browserNotification?.close();
    browserNotification = new Notification("مكالمة واردة في واصل", {
      body: `يوجد طرف آخر في غرفة الاتصال ${room}`,
      tag: "wasel-voice-call",
    });
    return null;
  }
  return Notifications.scheduleNotificationAsync({
    content: {
      title: "مكالمة واردة في واصل",
      body: `يوجد طرف آخر في غرفة الاتصال ${room}`,
      sound: "ringtone.wav",
      categoryIdentifier: VOICE_CATEGORY_ID,
      data: { type: "voice-call", room },
      ...(Platform.OS === "android" ? { channelId: VOICE_CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}

export async function cancelIncomingCallNotifications() {
  if (Platform.OS === "web") {
    browserNotification?.close();
    browserNotification = null;
    return;
  }
  await Notifications.dismissAllNotificationsAsync();
}
