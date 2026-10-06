import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
for (const args of [
  ["node_modules/vite/bin/vite.js", "build"],
  ["--test", "--test-concurrency=1", ...readdirSync(new URL("../tests", import.meta.url))
    .filter(name => name.endsWith(".test.mjs")).sort().map(name => `tests/${name}`)],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
