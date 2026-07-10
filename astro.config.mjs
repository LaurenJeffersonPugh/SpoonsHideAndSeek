// @ts-check
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";
import AstroPWA from "@vite-pwa/astro";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
    integrations: [
        react(),
        tailwind({
            applyBaseStyles: false,
        }),
        AstroPWA({
            manifest: {
                name: "Spoons Hide and Seek",
                short_name: "Spoons",
                description:
                    "A Jet Lag-style hide and seek map for Tyne and Wear. Shows the game boundary, valid public-transport stops, and every area within 500 m of a stop where you can legally hide.",
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
    base: "SpoonsHideAndSeek",
});
