import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = path.join(projectRoot, "android");
const wrapper = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const result = spawnSync(wrapper, ["assembleDebug"], {
  cwd: androidRoot,
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
