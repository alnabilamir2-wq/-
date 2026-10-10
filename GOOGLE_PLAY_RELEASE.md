# واصل — حزمة Google Play

## ملف النشر

- Application ID: `com.app.waselmobile`
- Version name: `1.2.0`
- Version code: `1`
- Artifact: `android/app/build/outputs/bundle/release/app-release.aab`
- Build type: Release، موقّع بـ Keystore إنتاجي

## قبل الرفع

1. افتح Google Play Console وأنشئ التطبيق باستخدام Application ID نفسه.
2. ارفع ملف `app-release.aab` إلى مسار Internal testing أولًا.
3. أضف بيانات المتجر: الاسم، الوصف، الأيقونة، لقطات الشاشة، تصنيف المحتوى، وسياسة الخصوصية.
4. راجع صلاحيات الميكروفون والإشعارات في صفحة Data safety.
5. لا ترفع ملف Keystore أو كلمة المرور إلى مستودع عام.

## مفتاح التوقيع

يوجد ملف JKS وملف بيانات التوقيع بشكل منفصل. احتفظ بنسخة احتياطية منهما في مدير أسرار آمن؛ فقدان المفتاح قد يمنع نشر تحديثات لاحقة.

## إعداد الخادم

هذه الحزمة مبنية دون عنوان API إنتاجي نهائي. قبل النشر العام، أعد البناء مع:

```bash
EXPO_PUBLIC_API_BASE_URL=https://YOUR_DOMAIN ./gradlew bundleRelease
```

ويجب أن يدعم الخادم `HTTPS` و`WSS` للمصادقة والمكالمات.
