// @ts-check
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";
import AstroPWA from "@vite-pwa/astro";
import { defineConfig } from "astro/config";

const appBase = process.env.CAPACITOR ? "/" : "/SpoonsHideAndSeek/";

// https://astro.build/config
export default defineConfig({
    integrations: [
        react(),
        tailwind({
            applyBaseStyles: false,
        }),
        AstroPWA({
            registerType: "autoUpdate",
            manifest: {
                name: "Spoons Hide and Seek",
                short_name: "Spoons",
                description:
                    "A Jet Lag-style hide and seek map for Tyne and Wear. Shows the game boundary, valid public-transport stops, and every area within 500 m of a stop where you can legally hide.",
                display: "standalone",
                start_url: appBase,
                scope: appBase,
                icons: [
                    {
                        src: "/SpoonsHideAndSeek/android-chrome-192x192.png",
                        sizes: "192x192",
                        type: "image/png",
                    },
                    {
                        src: "/SpoonsHideAndSeek/android-chrome-512x512.png",
                        sizes: "512x512",
                        type: "image/png",
                    },
                ],
                theme_color: "#1F2F3F",
            },
            workbox: {
                // Precache the app shell AND the local game data (*.geojson) so
                // the whole game works offline. Exclude the raw Google Maps
                // exports (not used at runtime). Bump the size cap so large
                // bundled chunks (e.g. arcgis) are cached too.
                globPatterns: [
                    "**/*.{js,css,html,ico,png,svg,woff,woff2,geojson}",
                ],
                globIgnores: ["**/google-map-export*"],
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
                // The document is precached under this exact key (Astro base,
                // no trailing slash), so offline navigations fall back to it.
                navigateFallback: "/SpoonsHideAndSeek",
                runtimeCaching: [
                    {
                        // Base-map tiles are cached as you view them, so areas
                        // you've panned over stay available offline. (Tiles you
                        // never loaded can't be shown offline.)
                        urlPattern: ({ url }) =>
                            [
                                "basemaps.cartocdn.com",
                                "tile.openstreetmap.org",
                                "tile.thunderforest.com",
                            ].some((host) => url.hostname.endsWith(host)),
                        handler: "CacheFirst",
                        options: {
                            cacheName: "map-tiles",
                            expiration: {
                                maxEntries: 3000,
                                maxAgeSeconds: 60 * 60 * 24 * 30,
                            },
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                    {
                        urlPattern: ({ url }) =>
                            url.hostname === "fonts.googleapis.com",
                        handler: "StaleWhileRevalidate",
                        options: {
                            cacheName: "google-fonts-stylesheets",
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                    {
                        urlPattern: ({ url }) =>
                            url.hostname === "fonts.gstatic.com",
                        handler: "CacheFirst",
                        options: {
                            cacheName: "google-fonts-webfonts",
                            expiration: {
                                maxEntries: 30,
                                maxAgeSeconds: 60 * 60 * 24 * 365,
                            },
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                ],
            },
        }),
    ],
    devToolbar: {
        enabled: false,
    },
    vite: {
        optimizeDeps: {
            // @arcgis/core lazily loads internal chunks (e.g. apiConverter) via
            // runtime dynamic import() from operator .load() calls. Vite's dep
            // scanner never sees these at startup, so pre-bundling rewrites the
            // imports to /node_modules/.vite/deps chunks that were never emitted
            // (404). Excluding it makes Vite serve arcgis ESM directly, so its
            // internal dynamic imports resolve against the real files.
            exclude: ["@arcgis/core"],
        },
        server: {
            watch: {
                ignored: ["**/source-data/**"],
            },
        },
    },
    site: "https://laurenjeffersonpugh.github.io",
    // Capacitor serves the bundled files from the app root, so build with no
    // base path for the native app (CAPACITOR=1). GitHub Pages keeps the
    // /SpoonsHideAndSeek/ project-page base.
    base: process.env.CAPACITOR ? "/" : "SpoonsHideAndSeek",
});
