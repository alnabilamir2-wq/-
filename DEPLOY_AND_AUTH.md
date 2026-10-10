# واصل — الجلسة ونغمة الرنين

## تسجيل الدخول وحفظ الجلسة

- الويب يستخدم cookie آمنة طويلة الصلاحية من الخادم، وتبقى الجلسة بعد إعادة فتح المتصفح.
- Android يستخدم `expo-secure-store` لحفظ رمز الجلسة وبيانات المستخدم محليًا.
- عند بدء التطبيق يعرض التطبيق البيانات المحفوظة سريعًا ثم يتحقق من الجلسة مع الخادم.
- زر تسجيل الخروج يمسح cookie/رمز الجلسة وبيانات المستخدم المخزنة.

## نغمة الرنين

- الملف المصدر: `assets/sounds/ringtone.wav`.
- يبدأ الرنين عند دخول طرف ثانٍ أو وصول عرض اتصال WebRTC.
- يتوقف الرنين عند الرد، الاتصال، إنهاء المكالمة، أو مغادرة الطرف الآخر.
- Android يضمّن الملف في قناة إشعارات «مكالمات واصل» عبر `expo-notifications`.
- الإشعارات الفعلية في الخلفية تحتاج `EXPO_PUBLIC_EAS_PROJECT_ID` وExpo Push Token وخادمًا يعمل عبر HTTPS.

## بناء الويب

```bash
pnpm install --frozen-lockfile
EXPO_PUBLIC_API_BASE_URL=https://YOUR_DOMAIN npx expo export --platform web --output-dir web-dist
```

ارفع محتويات `web-dist/` إلى استضافة static مع HTTPS وfallback إلى `index.html`، وتأكد من أن `/ws` يعمل عبر WSS.
