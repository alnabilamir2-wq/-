import { Platform } from "react-native";
import { getApiBaseUrl } from "@/constants/oauth";

export type VoiceSignal = {
  type: string;
  peerId?: string;
  payload?: any;
  peers?: string[];
  room?: string;
};

let remoteAudioElement: HTMLAudioElement | null = null;

function getIceServers() {
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

export function getVoiceWebSocketUrl() {
  const base = getApiBaseUrl();
  if (!base && typeof window !== "undefined" && window.location) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }
  if (!base) return "";
  const url = base.replace(/^http/, "ws");
  return `${url}/ws`;
}

export function createPeerConnection(onIceCandidate: (candidate: any) => void, onTrack: (stream: any) => void) {
  const WebRTC = Platform.OS === "web" ? { RTCPeerConnection } : require("react-native-webrtc");
  const pc: any = new WebRTC.RTCPeerConnection({
    iceServers: getIceServers(),
  });
  pc.onicecandidate = (event: any) => {
    if (event.candidate) onIceCandidate(event.candidate);
  };
  pc.ontrack = (event: any) => {
    const stream = event.streams?.[0];
    if (stream) onTrack(stream);
  };
  return pc;
}

export async function playRemoteAudio(stream: any): Promise<boolean> {
  if (Platform.OS !== "web" || typeof document === "undefined") return true;
  if (!remoteAudioElement) {
    remoteAudioElement = document.createElement("audio");
    remoteAudioElement.autoplay = true;
    remoteAudioElement.muted = false;
    remoteAudioElement.volume = 1;
    remoteAudioElement.setAttribute("playsinline", "true");
    remoteAudioElement.setAttribute("aria-label", "صوت المكالمة");
    remoteAudioElement.style.display = "none";
    document.body.appendChild(remoteAudioElement);
  }
  remoteAudioElement.srcObject = stream;
  try {
    await remoteAudioElement.play();
    return true;
  } catch (error) {
    console.warn("[audio] browser blocked remote audio playback", error);
    return false;
  }
}

export function stopRemoteAudio() {
  if (!remoteAudioElement) return;
  remoteAudioElement.pause();
  remoteAudioElement.srcObject = null;
  remoteAudioElement.remove();
  remoteAudioElement = null;
}

export async function getMicrophoneStream(): Promise<any> {
  if (Platform.OS === "web") return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const WebRTC = require("react-native-webrtc") as typeof import("react-native-webrtc");
  return WebRTC.mediaDevices.getUserMedia({ audio: true, video: false });
}

export function setAudioOutput(speaker: boolean) {
  if (Platform.OS === "web") return;
  const WebRTC = require("react-native-webrtc") as typeof import("react-native-webrtc");
  WebRTC.RTCView;
  WebRTC.mediaDevices;
  const InCallManager = require("react-native-incall-manager");
  InCallManager.setForceSpeakerphoneOn(speaker);
}
