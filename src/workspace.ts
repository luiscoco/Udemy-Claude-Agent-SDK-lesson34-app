import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
export const LESSON = JSON.stringify({
  lesson: 34,
  title: "Hooks in practice",
  marker: "HOOK-PRACTICE-34",
});
export async function prepareWorkspace() {
  const parent = resolve(realpathSync.native(tmpdir()), "claude-sdk34"),
    root = resolve(parent, randomUUID());
  const safe = () => {
    const r = relative(parent, resolve(root));
    if (!r || r.startsWith("..") || isAbsolute(r))
      throw new Error("Invalid disposable workspace.");
  };
  safe();
  const cwd = join(root, "project"),
    home = join(root, "home"),
    sdkHome = join(root, "sdk");
  for (const d of [cwd, home, sdkHome]) await mkdir(d, { recursive: true });
  await writeFile(join(cwd, "lesson.txt"), LESSON);
  return {
    cwd,
    home,
    sdkHome,
    async inspect() {
      return {
        fixtureUnchanged:
          (await readFile(join(cwd, "lesson.txt"), "utf-8")) === LESSON,
      };
    },
    async cleanup() {
      safe();
      await rm(root, { recursive: true, force: true });
    },
  };
}
