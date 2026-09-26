import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // API prefixes only. Page routes deliberately use different paths
    // (/league/:id, /join/:code, /draft/:id) so a browser reload of a page
    // is never proxied to the API.
    proxy: {
      "/dev": "http://127.0.0.1:3000",
      "/auth": "http://127.0.0.1:3000",
      "/me": "http://127.0.0.1:3000",
      "/leagues": "http://127.0.0.1:3000",
      "/drafts": "http://127.0.0.1:3000",
      "/invites": "http://127.0.0.1:3000",
      "/socket.io": {
        target: "http://127.0.0.1:3000",
        ws: true,
      },
    },
  },
});
