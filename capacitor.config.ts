import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
    appId: "com.spoons.hideandseek",
    appName: "Spoons Hide and Seek",
    // Astro builds the static site here. Build with CAPACITOR=1 so the assets
    // use a root ("/") base path instead of the GitHub Pages one — see
    // astro.config.mjs. Then `npx cap sync` copies dist/ into the Android app.
    webDir: "dist",
};

export default config;
