import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  selectRelease,
  findRelease,
  downloadPackage,
  verifyPackage,
  type ReleasePackage,
} from "../src/main/githubUpdates.js";
import { handoffScript } from "../src/main/updateHandoff.js";

const bytes = Buffer.from("disposable test package");
const digest = createHash("sha256").update(bytes).digest("hex");
function entry(
  version: string,
  kind = "Portable",
  extra: Record<string, unknown> = {},
) {
  const name = `Vestra-${version}-x64-${kind}.exe`;
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: version.includes("-"),
    assets: [
      {
        name,
        digest: `sha256:${digest}`,
        size: bytes.length,
        browser_download_url: `https://github.com/deAYS/Vestra/releases/download/v${version}/${name}`,
      },
    ],
    ...extra,
  };
}
const release = selectRelease(
  [entry("0.1.0-alpha.4")],
  "0.1.0-alpha.3",
  "Portable",
)!;
test("updater selects the newest compatible complete release and keeps stable users off prereleases", () => {
  const data = [
    entry("0.1.0-alpha.9"),
    entry("0.1.0-alpha.10"),
    entry("0.1.0-alpha.11", "Portable", { draft: true }),
    entry("0.1.0-alpha.12", "Setup"),
  ];
  assert.equal(
    selectRelease(data, "0.1.0-alpha.3", "Portable")!.version,
    "0.1.0-alpha.10",
  );
  assert.equal(selectRelease(data, "0.1.0", "Portable"), undefined);
  assert.equal(
    selectRelease(
      [entry("0.1.1-alpha.1"), entry("0.1.1")],
      "0.1.0",
      "Portable",
    )!.version,
    "0.1.1",
  );
  assert.equal(selectRelease(data, "0.1.0-alpha.10", "Portable"), undefined);
});
test("updater rejects missing digests, unexpected asset hosts and unsafe versions", () => {
  for (const patch of [
    { digest: null },
    { digest: "sha256:no" },
    { browser_download_url: "https://evil.test/a.exe" },
    { size: 400 * 1024 * 1024 },
  ]) {
    const candidate = entry("0.2.0");
    Object.assign(candidate.assets[0]!, patch);
    assert.equal(selectRelease([candidate], "0.1.0", "Portable"), undefined);
  }
  assert.equal(
    selectRelease([entry("../bad")], "0.1.0", "Portable"),
    undefined,
  );
});
test("network errors are visible and cannot become a false up-to-date result", async () => {
  await assert.rejects(
    () =>
      findRelease(
        "0.1.0",
        "Portable",
        (async () => new Response("", { status: 403 })) as typeof fetch,
      ),
    /rate limit/,
  );
  await assert.rejects(() =>
    findRelease(
      "0.1.0",
      "Portable",
      (async () => new Response("invalid")) as typeof fetch,
    ),
  );
});
test("download verifies streamed bytes, reuses a verified copy and removes interrupted or corrupt files", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "vestra-update-fixture-"),
  );
  try {
    const progress: number[] = [];
    let requests = 0;
    const request = (async () => {
      requests++;
      return new Response(bytes);
    }) as typeof fetch;
    const file = await downloadPackage(
      directory,
      release,
      (value) => progress.push(value),
      request,
    );
    await verifyPackage(file, release);
    assert.equal(progress.at(-1), 100);
    await downloadPackage(directory, release, () => {}, request);
    assert.equal(requests, 1);
    await fs.writeFile(file, "corrupt");
    await assert.rejects(
      () =>
        downloadPackage(
          directory,
          release,
          () => {},
          (async () => new Response("wrong")) as typeof fetch,
        ),
      /verification/,
    );
    assert.equal(
      (await fs.readdir(directory)).some((name) => name.endsWith(".part")),
      false,
    );
    const broken = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 5));
        controller.error(new Error("connection lost"));
      },
    });
    await assert.rejects(
      () =>
        downloadPackage(
          directory,
          release,
          () => {},
          (async () => new Response(broken)) as typeof fetch,
        ),
      /connection lost/,
    );
    assert.equal(
      (await fs.readdir(directory)).some((name) => name.endsWith(".part")),
      false,
    );
    await downloadPackage(directory, release, () => {}, request);
    await verifyPackage(file, release);
  } finally {
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith("vestra-update-fixture-")
    )
      await fs.rm(directory, { recursive: true, force: true });
  }
});
test(
  "portable handoff replaces and verifies the original file, retains a backup and quotes apostrophes",
  { timeout: 30_000 },
  async () => {
    if (process.platform !== "win32") return;
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "vestra-update-fixture-"),
    );
    try {
      const target = path.join(directory, "Vestra user's çam [app].exe");
      const packageFile = path.join(directory, release.name);
      const errorFile = path.join(directory, "error.txt");
      await fs.writeFile(target, "old version");
      await fs.writeFile(packageFile, bytes);
      const script = handoffScript({
        pid: 2147483647,
        target,
        packageFile,
        errorFile,
        portable: true,
        release,
        token: "test",
      });
      const filename = path.join(directory, "test.ps1");
      await fs.writeFile(
        filename,
        `\uFEFFfunction Start-Process {param($FilePath,$ArgumentList,$WindowStyle) [IO.File]::WriteAllText('${path.join(directory, "launched.txt").replace(/'/g, "''")}', $FilePath + ' ' + $ArgumentList)}\n` +
          script,
      );
      await promisify(execFile)(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          filename,
        ],
        { windowsHide: true, timeout: 12_000 },
      );
      assert.deepEqual(
        await fs.readFile(target),
        bytes,
        await fs.readFile(errorFile, "utf8").catch(() => ""),
      );
      assert.equal(
        await fs.readFile(target + ".vestra-previous", "utf8"),
        "old version",
      );
      assert.match(
        await fs.readFile(path.join(directory, "launched.txt"), "utf8"),
        /--finish-update=test/,
      );
      await fs.writeFile(packageFile, "corrupt download");
      await promisify(execFile)(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          filename,
        ],
        { windowsHide: true, timeout: 12_000 },
      );
      assert.match(await fs.readFile(errorFile, "utf8"), /checksum changed/);
      assert.deepEqual(
        await fs.readFile(target),
        bytes,
        "a changed download does not overwrite the current executable",
      );
    } finally {
      if (
        path.dirname(directory) === path.resolve(os.tmpdir()) &&
        path.basename(directory).startsWith("vestra-update-fixture-")
      )
        await fs.rm(directory, { recursive: true, force: true });
    }
  },
);
