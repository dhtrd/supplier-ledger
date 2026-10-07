# حسابات الموردين — supplier-ledger

برنامج ويب عربي لحسابات الموردين والعملاء، بديل «دفتر الحسابات»: فواتير ودفعات وملاحظات، كشف حساب بفترة ورصيد افتتاحي، سند دفعة يوقّعه المستلم عبر رابط واتساب مؤقت، طباعة A4، تصدير Excel وPDF.

- الحقائق والقرارات: [CLAUDE.md](CLAUDE.md) · [DECISIONS.md](DECISIONS.md) · [PROGRESS.md](PROGRESS.md)
- الأمان: كل الصلاحيات في [`firestore.rules`](firestore.rules) ومختبرة في [`tests/rules`](tests/rules).

## التطوير

```bash
npm ci
npm run lint && npm run typecheck && npm test
npm run test:rules   # يحتاج Java 21 (محاكي Firestore): القواعد + دوال البيانات الفعلية للتطبيق
```

تشغيل محلي كامل على المحاكيات (بلا مشروع حقيقي):

```bash
npx firebase emulators:start --only firestore,auth --project demo-supplier-ledger
# في نافذة أخرى:
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
node scripts/bootstrap/owner.ts --email owner@example.com --name "المالك"
node scripts/migrate/migrate.ts --db path/to/backup.db
# ملف .env.local: قيم VITE_FIREBASE_* أي قيم وهمية + VITE_FIREBASE_PROJECT_ID=demo-supplier-ledger + VITE_USE_EMULATORS=true
npm run dev
```

### هيكل الواجهة

- `src/core` التهيئة والجلسة والتوجيه · `src/shared` أدوات وعناصر مشتركة (التقويم، الورقة السفلية، رمز الريال).
- `src/features/<الميزة>/{domain,data,ui}`: المنطق النقي (مختبر) ← الوصول للبيانات (مختبر على المحاكي) ← الشاشات.
- الصفحات: الدخول، الحسابات، كشف الحساب (فترة + رصيد افتتاحي)، إضافة/تعديل عملية، المستخدمون، الإعدادات، سجل التعديلات، صفحة التوقيع العامة `#/s/<رمز>`، طباعة السند وكشف الحساب (A4 / حفظ PDF).

## الإعداد لأول مرة (خطوات المالك)

> لا تُرسل أي مفتاح أو ملف JSON في المحادثة أو تضعه في المستودع — المستودع عام. الأسرار تُدخل في GitHub Secrets فقط.

### 1) Firebase (مشروع `supplier-ledger-766c5`)

1. **Firestore Database** ← إنشاء قاعدة بيانات (Standard، الوضع الإنتاجي Production mode). اختر أقرب موقع متاح.
2. **Authentication** ← Sign-in method ← فعّل **Email/Password**. ثم Settings ← Authorized domains ← أضف `dhtrd.github.io`.
3. **Project settings** ← Your apps ← أضف تطبيق ويب (Web) وانسخ قيم الإعداد إلى متغيرات GitHub (الخطوة 2).
4. **Project settings ← Service accounts** ← Generate new private key ← احفظ الملف على جهازك فقط.

### 2) GitHub (Settings ← Secrets and variables ← Actions)

- **Variables**: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`.
- **Secrets**: `FIREBASE_SERVICE_ACCOUNT` (محتوى ملف JSON كاملاً)، ثم أسرار Dropbox الثلاثة (الخطوة 3).
- **Settings ← Pages** ← Source: **GitHub Actions**.
- **Settings ← Branches** ← قاعدة لـ `main`: Require a pull request + Require status checks (`Lint · types · unit tests · build`, `Firestore security-rules tests (emulator)`, `Security scan (dependencies + secrets)`, `analyze`).

### 3) Dropbox (النسخ الاحتياطي)

1. https://www.dropbox.com/developers/apps ← Create app ← Scoped access ← **App folder**.
2. Permissions: `files.content.write` و`files.content.read` ← Submit.
3. من صفحة التطبيق: App key وApp secret.
4. افتح في المتصفح (استبدل APP_KEY):
   `https://www.dropbox.com/oauth2/authorize?client_id=APP_KEY&response_type=code&token_access_type=offline`
   وافق وانسخ الرمز (code).
5. على جهازك:
   ```bash
   curl https://api.dropboxapi.com/oauth2/token -d code=CODE -d grant_type=authorization_code -d client_id=APP_KEY -d client_secret=APP_SECRET
   ```
   انسخ `refresh_token` من الرد.
6. أضف أسرار GitHub: `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`.
7. شغّل سير العمل **Backup** يدوياً مرة (Actions ← Backup ← Run workflow) وتأكد أنه نجح.

### 4) إنشاء المالك ونقل البيانات (على جهازك، مرة واحدة)

```bash
npm ci
# Windows PowerShell:  $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\service-account.json"
# Linux/macOS:         export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
export FIREBASE_PROJECT_ID=supplier-ledger-766c5
node scripts/bootstrap/owner.ts --email you@example.com --name "اسمك"
node scripts/migrate/migrate.ts --db path/to/backup.db --dry-run   # يعرض الأعداد فقط
node scripts/migrate/migrate.ts --db path/to/backup.db             # يكتب ثم يتحقق من كل رصيد
```

ثم افتح البرنامج واضغط «نسيت كلمة المرور» لتعيين كلمة مرور المالك.

## الاستعادة من نسخة احتياطية

نزّل `data.json` من مجلد `backups/<التاريخ>` في Dropbox ثم:

```bash
node scripts/backup/restore.ts --file data.json --confirm supplier-ledger-766c5
```
