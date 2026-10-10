const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export async function sendIncomingCallPush(token: string, room: string) {
  if (!token.startsWith("ExponentPushToken[")) return;
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: token,
        title: "مكالمة واردة في واصل",
        body: `يوجد طرف آخر في غرفة الاتصال ${room}`,
        sound: "ringtone.wav",
        channelId: "wasel-voice-calls",
        categoryId: "wasel-incoming-call",
        priority: "high",
        data: { type: "voice-call", room },
      }),
    });
    if (!response.ok) console.warn(`[push] Expo returned ${response.status}`);
  } catch (error) {
    console.warn("[push] Failed to send incoming call notification", error);
  }
}
