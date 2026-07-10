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

## Route C — Self-contained APK with Capacitor (works offline) — **this is the one set up**

[Capacitor](https://capacitorjs.com) wraps the built web files in a native
Android shell: everything is baked into the APK, it runs with **no internet**,
and there's **no browser toolbar**. The project is already wired up (Capacitor
installed, `android/` project scaffolded, base path handled, GPS permission
added, boot launcher icon generated, `cap:*` npm scripts added). You just need
to build it. Follow the steps below in order.

### Step 1 — Install Android Studio (one time)

1. Download it from <https://developer.android.com/studio> and run the
   installer.
2. On first launch, pick the **Standard** setup — it downloads the Android SDK,
   platform-tools, and a bundled Java (JDK). **You don't need to install Java
   separately** as long as you build inside Android Studio.
3. Let the setup wizard finish downloading (needs internet, a few minutes).

(You already have Node + pnpm from working on the web app.)

### Step 2 — Build the web app and open it in Android Studio

From the repo root:

```bash
pnpm install      # only if you haven't already
pnpm cap:apk
```

`pnpm cap:apk` does three things: builds the site for native (root paths),
copies it into the `android/` project, and opens Android Studio.

> If Android Studio doesn't open automatically, open it manually → **Open** →
> select the **`android`** folder inside the repo.

### Step 3 — Let Android Studio finish setting up

The first time you open the project, Android Studio runs a **Gradle sync**
(bottom status bar). This can take a few minutes and needs internet.

- If it shows a banner like _"Install missing SDK package(s)"_ or asks to accept
  licenses, click the link/**Accept** and let it install.
- Wait until the status bar says sync finished with no errors before
  continuing.

### Step 4 — Build the APK

1. Menu bar → **Build** → **Build App Bundle(s) / APK(s)** → **Build APK(s)**.
2. When it finishes, a small notification appears in the bottom-right:
   _"APK(s) generated successfully"_ with a **locate** link. Click **locate**.
3. That opens the folder containing **`app-debug.apk`** (path:
   `android/app/build/outputs/apk/debug/app-debug.apk`).

This "debug" APK is fully installable and fine for sharing with friends. (For a
"proper" signed release build, see [Optional](#optional--signed-release-apk)
below.)

### Step 5 — Put it on a phone

1. Get `app-debug.apk` onto the phone — email it to yourself, upload to Google
   Drive, or copy it over a USB cable.
2. On the phone, tap the file (in the Files app or your browser's downloads).
3. Android will say installs from this source are blocked → tap **Settings** →
   enable **Allow from this source** → go back → **Install**.
4. Open the app. It'll ask for **location permission** the first time — allow
   it so the map can find you.

Done — it launches fullscreen, no toolbar, and works without internet.

### Updating the app after you change the web code

Re-run the build and rebuild the APK:

```bash
pnpm cap:sync     # rebuild web + copy into android/
```

Then in Android Studio, **Build → Build APK(s)** again (Step 4).

### Optional — signed release APK

The debug APK is signed with a throwaway debug key. For a cleaner build you can
control (and update over time):

1. **Build** → **Generate Signed App Bundle / APK…** → choose **APK** → Next.
2. Click **Create new…** to make a **keystore** (a `.jks` file). Fill in a
   password, key alias, and another password; save the file somewhere safe.
3. Pick **release**, Finish. Output:
   `android/app/build/outputs/apk/release/app-release.apk`.

> **Keep the keystore and passwords.** You need the same keystore to ship
> updates; lose it and users must uninstall/reinstall to update.

### Changing the app icon later

Replace `assets/icon-only.png` (≥1024×1024) and run
`npx capacitor-assets generate --android`, then rebuild. (The boot icon's
artwork reaches the edges, which is why the Android adaptive-icon XMLs were
removed — so the full image shows instead of being cropped to a circle.)

### If something goes wrong

- **`pnpm cap:apk` can't find Android Studio** → open Android Studio yourself
  and **Open** the `android` folder; then do Steps 3–4.
- **Gradle sync fails / "SDK location not found"** → in Android Studio open
  **Settings → Languages & Frameworks → Android SDK**, make sure an SDK is
  installed, then **File → Sync Project with Gradle Files**.
- **Map is blank / data missing in the app** → you built without the native
  base. Always build via `pnpm cap:sync` / `pnpm cap:apk` (they set
  `CAPACITOR=1`), not a plain `pnpm build`.

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
