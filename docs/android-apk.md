# Turning the app into an Android app / APK

This is a static web app (Astro + React + Leaflet) already deployed as a PWA to
GitHub Pages. There are three realistic ways to get it onto a phone, from
zero-effort to a real downloadable `.apk`. Pick based on how much you want to
set up and whether it must work offline.

| Route                      | Effort | Real `.apk`?          | Works offline?           | Needs                    |
| -------------------------- | ------ | --------------------- | ------------------------ | ------------------------ |
| **A. Install the PWA**     | none   | no (home-screen icon) | mostly (service worker)  | just Chrome on the phone |
| **B. PWABuilder (TWA)**    | low    | yes                   | no (loads the live site) | the deployed URL         |
| **C. Capacitor (bundled)** | higher | yes                   | yes (site baked in)      | Android Studio + JDK     |

For handing it to friends, **A or B** are easiest. Use **C** if you want a
self-contained APK that runs with no internet.

## App icons (already configured)

The manifest in [`astro.config.mjs`](../astro.config.mjs) now points at the
192×192 and 512×512 icons in `public/` (`android-chrome-192x192.png` /
`android-chrome-512x512.png`) — the "BOOT IMAGE / HIDE & SEEK" icon. That's
enough for PWA install and PWABuilder.

**To change the icon**, replace those two PNGs in `public/` (keep the exact
filenames and pixel sizes), then `pnpm build` and redeploy. To use different
filenames, update the `icons` array in `astro.config.mjs` to match (keep the
`/SpoonsHideAndSeek/` base in the `src`). They're marked `purpose: any` (shown
as-is) rather than `maskable`, because the boot artwork reaches the edges and a
maskable crop would cut off the text.

> The **browser-tab favicon** is separate and currently blank
> (`<link rel="icon" href="data:," />` in `src/layouts/Layout.astro`). Say the
> word if you want the boot there too.

---

## Route A — Install the PWA (no APK)

Once icons are in place, the deployed site is an installable PWA:

- On the phone, open <https://laurenjeffersonpugh.github.io/SpoonsHideAndSeek/>
  in **Chrome**.
- Chrome menu → **Install app** / **Add to Home screen**.

You get an app icon that launches fullscreen; the service worker (from
`@vite-pwa/astro`) caches the shell so it mostly works offline. It's not a file
you distribute, but it's the least work and updates automatically.

---

## Route B — Real APK with PWABuilder (recommended for a shareable file)

[PWABuilder](https://www.pwabuilder.com) (Microsoft) packages the deployed PWA
into a signed Android app (a **TWA** — Trusted Web Activity, essentially
fullscreen Chrome pointed at your site). No local Android toolchain needed.

1. Make sure the PWA is deployed with icons (prerequisite above).
2. Go to <https://www.pwabuilder.com>, enter
   `https://laurenjeffersonpugh.github.io/SpoonsHideAndSeek/`, and let it score
   the PWA. Fix anything it flags (usually icons).
3. **Package for stores → Android** → download the package. It gives you an
   `.apk` (for sideloading), an `.aab` (for the Play Store), and a **signing
   key** — keep the key safe; you need the same one to ship updates.
4. **Sideload** the `.apk`: transfer it to the phone, enable "Install unknown
   apps" for your file manager/browser, and open it.

### Two gotchas for this project

- **It loads the live site**, so it needs internet and always shows the latest
  deploy. No offline unless the service worker has cached things.
- **Fullscreen (no address bar)** needs a Digital Asset Links file at the
  **domain root**: `https://laurenjeffersonpugh.github.io/.well-known/assetlinks.json`.
  Because this repo is a **project** page served under `/SpoonsHideAndSeek/`,
  you can't put files at the domain root from this repo — you'd need a separate
  `laurenjeffersonpugh.github.io` (user) repo hosting `.well-known/assetlinks.json`.
  Without it the app still works but shows a thin Chrome toolbar. Fine for
  sharing with friends; matters if you want a polished Play Store entry.

---

## Route C — Self-contained APK with Capacitor (works offline) — SET UP

[Capacitor](https://capacitorjs.com) wraps the **built web files** in a native
Android shell, so everything is baked into the APK and runs with no internet,
and there's **no browser toolbar**. This is already wired up in the repo.

**Already done (committed):**

- Capacitor installed + `capacitor.config.ts` (`appId: com.spoons.hideandseek`,
  `webDir: dist`).
- The `android/` native project is scaffolded.
- The GitHub Pages base path is made conditional in
  [`astro.config.mjs`](../astro.config.mjs) — `base: process.env.CAPACITOR ? "/" : "SpoonsHideAndSeek"` — so the Capacitor build serves assets/`public/data` from
  the app root instead of `/SpoonsHideAndSeek/`. (Everything uses
  `import.meta.env.BASE_URL`, so nothing else needed changing.)
- Location permissions (`ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`) added
  to `android/app/src/main/AndroidManifest.xml`. The WebView is a secure
  context, so `navigator.geolocation` works and Android prompts at runtime.
- Launcher icon generated from the boot image (`public/JLIcon.png` →
  `assets/icon-only.png`). The adaptive-icon XMLs were removed so the full boot
  shows uncropped on all Android versions.
- npm scripts: `cap:sync`, `cap:open`, `cap:apk`.

**You need:** **JDK 17+** and **Android Studio** (only for the final
build/sign — that step can't be scripted).

### Build the APK

```bash
pnpm cap:apk        # builds with CAPACITOR=1, syncs into android/, opens Android Studio
```

(or `pnpm cap:sync` then `pnpm cap:open` separately.) In Android Studio:
**Build → Build Bundle(s) / APK(s) → Build APK(s)**. The APK lands in
`android/app/build/outputs/apk/`. For a shareable **signed release** APK use
**Build → Generate Signed Bundle / APK**, create a keystore, and **keep that
keystore** (needed for future updates). Sideload the APK as in Route B.

Whenever the web app changes, re-run `pnpm cap:sync` before rebuilding.

### Changing the icon later

Replace `assets/icon-only.png` (≥1024×1024) and run
`npx capacitor-assets generate --android`. If your new icon is centered with
padding, you can keep Capacitor's adaptive icons; the boot's edge-to-edge
artwork is why the adaptive XMLs were removed here.

---

## iOS note

TWA (Route B) is Android-only. On iPhone, Route A (Add to Home Screen in
Safari) works, and Capacitor (Route C) can build an iOS app too — but that
needs a Mac with Xcode.

## Recommendation

- Want it on **your own** phone fast → **Route A**.
- Want a **file to send friends**, don't mind it needing internet → **Route B**.
- Want a **standalone, offline APK** and don't mind installing Android Studio →
  **Route C**.
