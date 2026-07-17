import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

export default defineConfig({
  server: { host: "0.0.0.0", port: 5175, strictPort: true },
  preview: { host: "0.0.0.0", port: 5175, strictPort: true },
  plugins: [
    sites(),
    cloudflare({
      config: {
        main: "./worker/index.ts",
        compatibility_flags: ["nodejs_compat"],
      },
    }),
  ],
});
