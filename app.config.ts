import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

const bundleId = "com.app.waselmobile";
const scheme = "wasel";

const config: ExpoConfig & { logoUrl: string } = {
  name: "واصل",
  logoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663101001434/sNDdtnJWwXkeEJVJ.png",
  slug: "wasel-mobile",
  version: "1.2.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme,
  extra: {
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID },
  },
  userInterfaceStyle: "dark",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: bundleId,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSMicrophoneUsageDescription: "يحتاج واصل إلى الميكروفون لإجراء المكالمات الصوتية.",
      UIBackgroundModes: ["audio"],
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#07131B",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: bundleId,
    permissions: ["POST_NOTIFICATIONS", "RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS", "BLUETOOTH_CONNECT", "WAKE_LOCK", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_MICROPHONE"],
  },
  web: { bundler: "metro", output: "static", favicon: "./assets/images/favicon.png" },
  plugins: [
    "expo-router",
    "expo-asset",
    ["expo-audio", { microphonePermission: "يحتاج واصل إلى الميكروفون لإجراء المكالمات الصوتية." }],
    ["expo-notifications", { sounds: ["./assets/sounds/ringtone.wav"] }],
    ["@config-plugins/react-native-webrtc", { microphonePermission: "يحتاج واصل إلى الميكروفون لإجراء المكالمات الصوتية." }],
    ["expo-splash-screen", { image: "./assets/images/splash-icon.png", imageWidth: 200, resizeMode: "contain", backgroundColor: "#07131B" }],
    ["expo-build-properties", { android: { buildArchs: ["armeabi-v7a", "arm64-v8a"], minSdkVersion: 24 } }],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
