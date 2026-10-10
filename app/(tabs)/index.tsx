import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as Notifications from "expo-notifications";
import { ScreenContainer } from "@/components/screen-container";
import { createPeerConnection, getMicrophoneStream, getVoiceWebSocketUrl, playRemoteAudio, setAudioOutput, stopRemoteAudio, type VoiceSignal } from "@/lib/voice-call";
import { cancelIncomingCallNotifications, configureNotifications, getPushToken, registerPushToken, showIncomingCallNotification } from "@/lib/notifications";
import { useAuth } from "@/hooks/use-auth";
import { startOAuthLogin } from "@/constants/oauth";

const makePeerId = () => `peer-${Math.random().toString(36).slice(2, 10)}`;

export default function HomeScreen() {
  const { user, loading: authLoading, isAuthenticated, logout } = useAuth();
  const [authBusy, setAuthBusy] = useState(false);
  const [room, setRoom] = useState("WASEL1");
  const [status, setStatus] = useState("أدخل رمز الغرفة لبدء مكالمة ثنائية");
  const [connected, setConnected] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [otherPeerPresent, setOtherPeerPresent] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const ringtonePlayer = useAudioPlayer(require("@/assets/sounds/ringtone.wav"), {
    downloadFirst: true,
    keepAudioSessionActive: true,
  });
  const socketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<any>(null);
  const streamRef = useRef<any>(null);
  const remoteStreamRef = useRef<any>(null);
  const peerIdRef = useRef(makePeerId());
  const pushTokenRef = useRef<string | null>(null);
  const pendingIceRef = useRef<any[]>([]);
  const outgoingSignalsRef = useRef<object[]>([]);
  const roomRef = useRef(room);
  const startCallRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    ringtonePlayer.loop = true;
    ringtonePlayer.volume = 1;
  }, [ringtonePlayer]);

  // Keep native audio active when the screen is backgrounded.
  // A force-terminated app still requires a push notification to be reopened.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" || nextState === "background") {
        void setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
          allowsBackgroundRecording: true,
          shouldPlayInBackground: true,
          interruptionMode: "doNotMix",
          interruptionModeAndroid: "doNotMix",
        }).catch((error) => console.warn("[audio] background mode refresh failed", error));
        if (nextState === "active" && socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: "ping" }));
        }
      }
    });
    return () => subscription.remove();
  }, []);

  const startRingtone = () => {
    ringtonePlayer.loop = true;
    ringtonePlayer.volume = 1;
    // Play immediately so a user gesture can unlock browser audio; seek again
    // after loading so repeated call alerts always start at the beginning.
    ringtonePlayer.play();
    void ringtonePlayer.seekTo(0).catch(() => undefined);
  };

  const stopRingtone = () => {
    ringtonePlayer.pause();
    void ringtonePlayer.seekTo(0).catch(() => undefined);
  };

  const login = async () => {
    try {
      setAuthBusy(true);
      await startOAuthLogin();
    } catch {
      Alert.alert("تعذر تسجيل الدخول", "تحقق من إعدادات خادم المصادقة ثم حاول مرة أخرى.");
    } finally {
      setAuthBusy(false);
    }
  };

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    void configureNotifications().then(async () => {
      pushTokenRef.current = await getPushToken();
    });
    void setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
      allowsBackgroundRecording: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
      interruptionModeAndroid: "doNotMix",
    }).catch((error) => console.warn("[audio] mode setup failed", error));
    if (Platform.OS !== "web") {
      const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as { type?: string; room?: string };
        if (data.type !== "voice-call" || !data.room) return;
        if (response.actionIdentifier === "accept") {
          roomRef.current = String(data.room).toUpperCase();
          setRoom(roomRef.current);
          setTimeout(() => void startCallRef.current?.(), 0);
        } else if (response.actionIdentifier === "decline") {
          void cancelIncomingCallNotifications();
        }
      });
      return () => {
        responseSubscription.remove();
        stopRingtone();
        void cancelIncomingCallNotifications();
        hangup();
      };
    }
    return () => {
      stopRingtone();
      void cancelIncomingCallNotifications();
      hangup();
    };
  }, []);

  const signal = (message: object) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    } else {
      outgoingSignalsRef.current.push(message);
    }
  };

  const flushSignals = () => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    for (const message of outgoingSignalsRef.current.splice(0)) socket.send(JSON.stringify(message));
  };

  const setRemoteDescriptionAndFlushIce = async (pc: any, description: any) => {
    await pc.setRemoteDescription(description);
    const pendingCandidates = pendingIceRef.current.splice(0);
    for (const candidate of pendingCandidates) await pc.addIceCandidate(candidate);
  };

  const createOffer = async () => {
    if (!peerRef.current) return;
    const offer = await peerRef.current.createOffer({ offerToReceiveAudio: true });
    await peerRef.current.setLocalDescription(offer);
    signal({ type: "offer", payload: offer });
    setStatus("جارٍ الاتصال بالطرف الآخر…");
  };

  const callOtherParty = async () => {
    if (!peerRef.current || !otherPeerPresent) {
      setStatus("انتظر انضمام الطرف الآخر إلى الغرفة أولًا");
      return;
    }
    try {
      setCallActive(true);
      startRingtone();
      signal({ type: "call" });
      await createOffer();
    } catch {
      stopRingtone();
      setCallActive(false);
      setStatus("تعذر بدء الاتصال بالطرف الآخر");
    }
  };

  const handleSignal = async (message: VoiceSignal) => {
    const pc = peerRef.current;
    if (!pc) return;
    try {
      if (message.type === "joined") {
        setOtherPeerPresent((message.peers?.length ?? 0) > 0);
      } else if (message.type === "peer-joined") {
        setOtherPeerPresent(true);
        setStatus("الطرف الآخر متصل؛ اضغط «اتصال بالطرف الآخر» لبدء المكالمة");
      } else if (message.type === "call") {
        startRingtone();
        void showIncomingCallNotification(roomRef.current.trim().toUpperCase());
        setStatus("مكالمة واردة؛ جارٍ استقبال الاتصال…");
      } else if (message.type === "offer") {
        setCallActive(true);
        startRingtone();
        void cancelIncomingCallNotifications();
        await setRemoteDescriptionAndFlushIce(pc, message.payload);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signal({ type: "answer", payload: answer });
        stopRingtone();
        setStatus("تم قبول المكالمة، الصوت ثنائي الاتجاه");
      } else if (message.type === "answer") {
        setCallActive(true);
        stopRingtone();
        void cancelIncomingCallNotifications();
        await setRemoteDescriptionAndFlushIce(pc, message.payload);
        setStatus("المكالمة متصلة");
      } else if (message.type === "ice" && message.payload) {
        if (pc.remoteDescription) await pc.addIceCandidate(message.payload);
        else pendingIceRef.current.push(message.payload);
      } else if (message.type === "peer-left") {
        setOtherPeerPresent(false);
        setCallActive(false);
        stopRingtone();
        void cancelIncomingCallNotifications();
        stopRemoteAudio();
        remoteStreamRef.current = null;
        setAudioPlaybackBlocked(false);
        setStatus("غادر الطرف الآخر المكالمة");
        setConnected(false);
      }
    } catch {
      setStatus("تعذر إكمال اتصال الصوت؛ حاول إعادة الاتصال");
    }
  };

  const startCall = async () => {
    const wsUrl = getVoiceWebSocketUrl();
    if (!wsUrl) {
      Alert.alert("الخادم غير مضبوط", "أضف EXPO_PUBLIC_API_BASE_URL إلى إعدادات البناء، ثم أعد بناء التطبيق.");
      return;
    }
    try {
      const requestedRoom = roomRef.current.trim().toUpperCase();
      if (!/^[A-Z0-9-]{4,32}$/.test(requestedRoom)) {
        setStatus("رمز الغرفة يجب أن يحتوي على 4 إلى 32 حرفًا أو رقمًا");
        return;
      }
      if (Platform.OS === "web" && (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined")) {
        setStatus("المتصفح لا يدعم المكالمات الصوتية؛ استخدم Chrome أو Edge عبر HTTPS");
        return;
      }
      setStatus("جاري طلب إذن الميكروفون…");
      outgoingSignalsRef.current = [];
      if (!pushTokenRef.current) pushTokenRef.current = await getPushToken();
      void registerPushToken(roomRef.current, pushTokenRef.current);
      const stream = await getMicrophoneStream();
      streamRef.current = stream;
      const pc = createPeerConnection(
        (candidate) => signal({ type: "ice", payload: candidate }),
        (stream) => {
          remoteStreamRef.current = stream;
          void playRemoteAudio(stream).then((playing) => {
            setAudioPlaybackBlocked(!playing);
            if (!playing) setStatus("تم الاتصال، اضغط تشغيل الصوت للسماح بسماع الطرف الآخر");
          });
          setCallActive(true);
          setStatus("المكالمة متصلة");
        },
      );
      if (!pc) return;
      peerRef.current = pc;
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setCallActive(true);
          stopRingtone();
          setStatus("المكالمة متصلة");
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setStatus("تعذر إنشاء اتصال صوتي مباشر؛ قد تتطلب الشبكة خادم TURN أو تجربة شبكة أخرى");
        }
      };
      stream.getTracks().forEach((track: any) => pc.addTrack(track, stream));
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;
      ws.onopen = () => {
        signal({ type: "join", room: requestedRoom, peerId: peerIdRef.current, pushToken: pushTokenRef.current });
        flushSignals();
        setConnected(true);
        setOtherPeerPresent(false);
        setCallActive(false);
        setStatus("تم دخول الغرفة؛ بانتظار الطرف الآخر…");
      };
      ws.onmessage = (event) => {
        try { void handleSignal(JSON.parse(event.data)); } catch { setStatus("تعذر قراءة إشارة الاتصال"); }
      };
      ws.onerror = () => setStatus("تعذر الوصول إلى خادم المكالمات؛ تحقق من اتصال الإنترنت");
      ws.onclose = () => {
        setConnected(false);
        setOtherPeerPresent(false);
        setCallActive(false);
        if (peerRef.current) setStatus("انقطع اتصال خادم المكالمات؛ اضغط بدء المحاولة مجددًا");
      };
      setAudioOutput(speaker);
    } catch (error: any) {
      const name = error?.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setStatus("تم رفض إذن الميكروفون؛ اسمح به من إعدادات المتصفح ثم أعد المحاولة");
      } else if (name === "NotFoundError") {
        setStatus("لم يتم العثور على ميكروفون متاح في هذا الجهاز");
      } else {
        setStatus("تعذر بدء المكالمة؛ تحقق من إذن الميكروفون ثم أعد المحاولة");
      }
      socketRef.current?.close();
      peerRef.current?.close();
      streamRef.current?.getTracks?.().forEach((track: any) => track.stop());
      socketRef.current = null;
      peerRef.current = null;
      streamRef.current = null;
      remoteStreamRef.current = null;
      setAudioPlaybackBlocked(false);
      stopRingtone();
    }
  };
  startCallRef.current = startCall;

  function hangup() {
    stopRingtone();
    void cancelIncomingCallNotifications();
    signal({ type: "leave" });
    outgoingSignalsRef.current = [];
    socketRef.current?.close();
    peerRef.current?.close();
    pendingIceRef.current = [];
    stopRemoteAudio();
    remoteStreamRef.current = null;
    setAudioPlaybackBlocked(false);
    streamRef.current?.getTracks?.().forEach((track: any) => track.stop());
    socketRef.current = null;
    peerRef.current = null;
    streamRef.current = null;
    setConnected(false);
    setOtherPeerPresent(false);
    setCallActive(false);
    setStatus("تم إنهاء المكالمة");
  }

  const toggleMute = () => {
    const next = !muted;
    streamRef.current?.getAudioTracks?.().forEach((track: any) => { track.enabled = !next; });
    setMuted(next);
  };

  const toggleSpeaker = () => {
    const next = !speaker;
    setAudioOutput(next);
    setSpeaker(next);
  };

  const enableRemoteAudio = async () => {
    const remoteStream = remoteStreamRef.current;
    if (!remoteStream) {
      setStatus("لم يصل مسار صوت الطرف الآخر بعد");
      return;
    }
    const playing = await playRemoteAudio(remoteStream);
    setAudioPlaybackBlocked(!playing);
    setStatus(playing ? "تم تشغيل صوت الطرف الآخر" : "تعذر تشغيل الصوت؛ تحقق من إعدادات صوت المتصفح");
  };

  return (
    <ScreenContainer containerClassName="bg-[#07131B]" className="px-5 py-8">
      <View style={styles.header}>
        <Text style={styles.brand}>واصل</Text>
        <Text style={styles.subtitle}>مكالمات صوتية ثنائية آمنة عبر WebRTC</Text>
      </View>
      <View style={styles.authCard}>
        {authLoading ? (
          <View style={styles.authRow}><ActivityIndicator color="#54E1B5" /><Text style={styles.authText}>جارٍ التحقق من تسجيل الدخول…</Text></View>
        ) : isAuthenticated ? (
          <View style={styles.authRow}>
            <Text style={styles.authText}>مرحبًا {user?.name || user?.email || "بك"}</Text>
            <Pressable onPress={() => void logout()} style={styles.authButton}><Text style={styles.authButtonText}>تسجيل الخروج</Text></Pressable>
          </View>
        ) : (
          <View style={styles.authRow}>
            <Text style={styles.authText}>سجّل الدخول لحفظ حسابك وإشعارات المكالمات.</Text>
            <Pressable disabled={authBusy} onPress={() => void login()} style={styles.authButton}><Text style={styles.authButtonText}>{authBusy ? "جارٍ الدخول…" : "تسجيل الدخول"}</Text></Pressable>
          </View>
        )}
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>رمز غرفة الاتصال</Text>
        <TextInput value={room} onChangeText={setRoom} autoCapitalize="characters" editable={!connected} style={styles.input} placeholder="مثال: WASEL1" placeholderTextColor="#6F8792" />
        <Text style={styles.hint}>استخدم الرمز نفسه على الجهازين للانضمام إلى المكالمة.</Text>
        <View style={[styles.status, connected && styles.statusConnected]}>
          {connected && <ActivityIndicator color="#54E1B5" size="small" />}
          <Text style={styles.statusText}>{status}</Text>
        </View>
      </View>
      {connected ? (
        <View style={styles.callPanel}>
          <View style={styles.avatar}><Text style={styles.avatarText}>و</Text></View>
          <Text style={styles.callTitle}>مكالمة غرفة {room.toUpperCase()}</Text>
          <Text style={styles.callSub}>{callActive ? "الصوت ثنائي الاتجاه مفعّل" : otherPeerPresent ? "الطرف الآخر جاهز للاتصال" : "بانتظار انضمام الطرف الآخر…"}</Text>
          {callActive ? (
            <View style={styles.controls}>
              <Pressable onPress={toggleMute} style={[styles.control, muted && styles.controlActive]}><Text style={styles.controlIcon}>{muted ? "🔇" : "🎙"}</Text><Text style={styles.controlText}>{muted ? "فتح الصوت" : "كتم"}</Text></Pressable>
              <Pressable onPress={toggleSpeaker} style={[styles.control, speaker && styles.controlActive]}><Text style={styles.controlIcon}>🔊</Text><Text style={styles.controlText}>{speaker ? "مكبر" : "سماعة"}</Text></Pressable>
              <Pressable onPress={hangup} style={styles.end}><Text style={styles.endIcon}>⌕</Text><Text style={styles.controlText}>إنهاء</Text></Pressable>
            </View>
          ) : (
            <Pressable disabled={!otherPeerPresent} onPress={() => void callOtherParty()} style={[styles.callButton, !otherPeerPresent && styles.callButtonDisabled]}>
              <Text style={[styles.callButtonText, !otherPeerPresent && styles.callButtonDisabledText]}>{otherPeerPresent ? "اتصال بالطرف الآخر" : "بانتظار الطرف الآخر"}</Text>
            </Pressable>
          )}
          {audioPlaybackBlocked && (
            <Pressable onPress={() => void enableRemoteAudio()} style={styles.audioButton}>
              <Text style={styles.audioButtonText}>اضغط لتشغيل صوت الطرف الآخر</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View>
          <Pressable onPress={startCall} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.8 }]}><Text style={styles.primaryText}>انضم إلى غرفة الاتصال</Text></Pressable>
          <Pressable disabled style={[styles.callButton, styles.callButtonDisabled]}>
            <Text style={[styles.callButtonText, styles.callButtonDisabledText]}>اتصال بالطرف الآخر بعد انضمام الطرفين</Text>
          </Pressable>
        </View>
      )}
      <Text style={styles.note}>على الجهازين أدخلا رمز الغرفة نفسه واضغطا «انضم إلى غرفة الاتصال»، ثم يضغط أحد الطرفين «اتصال بالطرف الآخر». إذا منع المتصفح الصوت فسيظهر زر لتشغيله يدويًا.</Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", marginTop: 28, marginBottom: 28 },
  authCard: { backgroundColor: "#0D2029", borderColor: "#1E3B47", borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 16 },
  authRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  authText: { color: "#C4D7DC", flex: 1, textAlign: "right", fontSize: 13, lineHeight: 19 },
  authButton: { backgroundColor: "#173F43", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  authButtonText: { color: "#54E1B5", fontWeight: "800", fontSize: 12 },
  brand: { color: "#54E1B5", fontSize: 42, fontWeight: "800" },
  subtitle: { color: "#A7BAC3", fontSize: 14, marginTop: 8, textAlign: "center" },
  card: { backgroundColor: "#10242E", borderColor: "#24414D", borderWidth: 1, borderRadius: 22, padding: 20 },
  label: { color: "#E7F1F4", fontSize: 15, fontWeight: "700", textAlign: "right", marginBottom: 10 },
  input: { backgroundColor: "#07131B", color: "#FFFFFF", borderRadius: 14, paddingHorizontal: 16, height: 52, fontSize: 18, letterSpacing: 2, textAlign: "center", borderWidth: 1, borderColor: "#315361" },
  hint: { color: "#8299A3", fontSize: 12, lineHeight: 18, textAlign: "right", marginTop: 10 },
  status: { marginTop: 18, borderRadius: 12, backgroundColor: "#172E39", padding: 12, flexDirection: "row", gap: 10, alignItems: "center" },
  statusConnected: { borderColor: "#276D5A", borderWidth: 1 },
  statusText: { color: "#BBD0D6", flex: 1, textAlign: "right", fontSize: 13 },
  primary: { marginTop: 24, backgroundColor: "#54E1B5", padding: 17, borderRadius: 16, alignItems: "center" },
  primaryText: { color: "#062018", fontSize: 16, fontWeight: "800" },
  callPanel: { alignItems: "center", paddingTop: 42 },
  avatar: { width: 104, height: 104, borderRadius: 52, backgroundColor: "#1B6F63", alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: "#54E1B5" },
  avatarText: { color: "#DFFFF3", fontSize: 46, fontWeight: "800" },
  callTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "800", marginTop: 20 },
  callSub: { color: "#75BBA8", fontSize: 14, marginTop: 8 },
  callButton: { marginTop: 30, backgroundColor: "#54E1B5", borderRadius: 16, paddingHorizontal: 28, paddingVertical: 16, minWidth: 230, alignItems: "center" },
  callButtonDisabled: { backgroundColor: "#31505A", borderWidth: 1, borderColor: "#547581" },
  callButtonText: { color: "#062018", fontSize: 15, fontWeight: "800" },
  callButtonDisabledText: { color: "#E7F1F4" },
  audioButton: { marginTop: 18, backgroundColor: "#173F43", borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: "#54E1B5" },
  audioButtonText: { color: "#54E1B5", fontSize: 14, fontWeight: "800" },
  controls: { flexDirection: "row", gap: 16, marginTop: 46, alignItems: "center" },
  control: { backgroundColor: "#173440", width: 86, height: 76, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  controlActive: { backgroundColor: "#245347" },
  controlIcon: { fontSize: 23 },
  controlText: { color: "#D5E4E7", fontSize: 11, marginTop: 5 },
  end: { backgroundColor: "#D85062", width: 86, height: 76, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  endIcon: { color: "#FFFFFF", fontSize: 25, transform: [{ rotate: "135deg" }] },
  note: { color: "#6D8792", textAlign: "center", fontSize: 11, lineHeight: 17, marginTop: 28 },
});
