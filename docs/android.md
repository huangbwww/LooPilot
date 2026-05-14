# Android APK

LooPilot can run as a normal Web/PWA app or as a Capacitor Android shell.

The Android shell bundles the React frontend into the APK. On first launch it asks for the LooPilot backend URL and a pairing code or token, then all API, media, and WebSocket traffic goes to that backend.

Backend URL examples:

- `https://xxxx.trycloudflare.com`
- `https://loopilot.example.com`
- `http://100.x.x.x:4317`
- `http://192.168.1.10:4317`

HTTP backend URLs are accepted only for local/private addresses such as localhost, LAN, and Tailscale-style `100.64.0.0/10` addresses. Public Internet access should use HTTPS, for example Cloudflare Tunnel or a normal HTTPS domain.

## Build a debug APK

Install Android Studio or the Android SDK first, then run:

```powershell
npm run android:debug
```

On Windows, make sure `JAVA_HOME` points to JDK 21 or another Java 17+ installation before building:

```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-21"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
```

The debug APK is generated under:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is signed automatically and can be installed on Android after allowing installs from unknown sources.

## Sync web assets only

```powershell
npm run android:sync
```

## Open in Android Studio

```powershell
npm run android:open
```

## Release signing

Generate a keystore and keep it outside git:

```powershell
keytool -genkeypair `
  -v `
  -keystore loopilot-release.jks `
  -alias loopilot `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000
```

Use the same package name and keystore for every upgrade. If the keystore is lost, Android cannot install future release builds over the old one.
