const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = process.cwd();
const dist = path.join(root, "dist");
const publicDir = path.join(root, "public");

const test = spawnSync(process.execPath, [path.join(root, "scripts", "test-story.mjs")], {
  stdio: "inherit",
});

if (test.status !== 0) {
  process.exit(test.status || 1);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync(publicDir, dist, { recursive: true });

console.log("Built static app into dist/.");
