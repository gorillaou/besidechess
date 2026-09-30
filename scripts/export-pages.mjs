import { spawn } from "node:child_process";
import { rename } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const apiDir = path.join(root, "app", "api");
const stash = path.join(root, ".api-stash");

process.env.GITHUB_PAGES = "true";
process.env.NEXT_PUBLIC_STATIC = "true";

let moved = false;
try {
  await rename(apiDir, stash);
  moved = true;
  const code = await new Promise((resolve) => {
    const child = spawn("npx", ["next", "build"], { stdio: "inherit", env: process.env });
    child.on("exit", (status) => resolve(status ?? 1));
  });
  if (code !== 0) process.exitCode = code;
} finally {
  if (moved) await rename(stash, apiDir);
}
