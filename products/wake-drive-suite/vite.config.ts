import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

export default defineConfig(({ mode }) => {
  if (mode !== "jolbang") throw new Error("Use --mode jolbang or --mode yeolgong");
  const name = mode === "jolbang" ? "Wake Drive" : "열공";
  const color = mode === "jolbang" ? "#292333" : "#254ba1";
  const description = mode === "jolbang" ? "눈 감김과 고개 움직임을 살피는 운전 보조 앱" : "집중과 휴식을 관리하고 학습 기록을 쌓는 열공 앱";
  const branding = path.resolve("branding", mode);
  return {
    define: { "import.meta.env.VITE_APP_VARIANT": JSON.stringify(mode) },
    server: { host: "127.0.0.1", port: mode === "jolbang" ? 5220 : 5211, strictPort: true },
    preview: { host: "127.0.0.1", port: mode === "jolbang" ? 5220 : 5211, strictPort: true, headers: { "Cache-Control": "no-cache", "Permissions-Policy": "camera=(self), microphone=(), geolocation=()" } },
    build: { outDir: `dist/${mode}`, emptyOutDir: true },
    plugins: [{
      name: "app-identity",
      transformIndexHtml(html) { return html.replaceAll("__APP_NAME__", name).replaceAll("__APP_COLOR__", color).replaceAll("__APP_DESCRIPTION__", description); },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const filename = (req.url ?? "").split("?")[0].slice(1);
          if (!["manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "sw.js"].includes(filename)) return next();
          const file = path.join(branding, filename);
          if (!fs.existsSync(file)) return next();
          res.setHeader("Content-Type", filename.endsWith("png") ? "image/png" : filename.endsWith("svg") ? "image/svg+xml" : filename.endsWith("js") ? "application/javascript" : "application/manifest+json");
          res.end(fs.readFileSync(file));
        });
      },
      closeBundle() { fs.cpSync(branding, path.resolve(`dist/${mode}`), { recursive: true }); },
    }],
  };
});
