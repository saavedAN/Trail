import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Served from https://<user>.github.io/Trail/ on GitHub Pages.
const base = process.env.BASE_PATH ?? "/Trail/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-180.png", "icon.svg"],
      manifest: {
        name: "Trail",
        short_name: "Trail",
        description: "Offline trail maps for Virginia hikes",
        theme_color: "#2f5d3a",
        background_color: "#f6f4ee",
        display: "standalone",
        start_url: base,
        scope: base,
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallbackDenylist: [/\/data\//],
        runtimeCaching: [
          {
            // Style and tile index: fresh when online, cached copy when offline.
            urlPattern: ({ url }) => url.hostname === "tiles.openfreemap.org" && (url.pathname.startsWith("/styles/") || /^\/planet\/?$/.test(url.pathname)),
            handler: "NetworkFirst",
            options: { cacheName: "trail-tiles-v1", networkTimeoutSeconds: 4 },
          },
          {
            // Map tiles, fonts, sprites and elevation tiles never change: cache first.
            urlPattern: ({ url }) => url.hostname === "tiles.openfreemap.org" || url.hostname === "s3.amazonaws.com",
            handler: "CacheFirst",
            options: { cacheName: "trail-tiles-v1", expiration: { maxEntries: 30000 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes("/data/"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "trail-data-v1" },
          },
        ],
      },
    }),
  ],
});
