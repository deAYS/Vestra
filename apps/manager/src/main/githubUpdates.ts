import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { assertSafeVersion, compareVersions } from "@vestra/shared";

export const RELEASE_API =
  "https://api.github.com/repos/deAYS/Vestra/releases?per_page=100";
export type PackageKind = "Setup" | "Portable";
export interface ReleasePackage {
  version: string;
  url: string;
  sha256: string;
  size: number;
  name: string;
}
const MAX_PACKAGE = 350 * 1024 * 1024;

export function selectRelease(
  raw: unknown,
  current: string,
  kind: PackageKind,
): ReleasePackage | undefined {
  if (!Array.isArray(raw))
    throw new Error("GitHub returned an invalid release list.");
  const packages: ReleasePackage[] = [];
  for (const release of raw) {
    if (
      !release ||
      release.draft ||
      typeof release.tag_name !== "string" ||
      !Array.isArray(release.assets)
    )
      continue;
    const version = release.tag_name.replace(/^v/, "");
    try {
      assertSafeVersion(version);
    } catch {
      continue;
    }
    if (!current.includes("-") && (release.prerelease || version.includes("-")))
      continue;
    if (compareVersions(version, current) <= 0) continue;
    const name = `Vestra-${version}-x64-${kind}.exe`;
    const asset = release.assets.find(
      (entry: Record<string, unknown>) => entry?.["name"] === name,
    );
    if (
      !asset ||
      typeof asset.digest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)
    )
      continue;
    const url = `https://github.com/deAYS/Vestra/releases/download/${release.tag_name}/${name}`;
    if (
      asset.browser_download_url !== url ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 1 ||
      asset.size > MAX_PACKAGE
    )
      continue;
    packages.push({
      version,
      url,
      name,
      size: asset.size,
      sha256: asset.digest.slice(7).toLowerCase(),
    });
  }
  return packages.sort((a, b) => compareVersions(b.version, a.version))[0];
}

export async function findRelease(
  current: string,
  kind: PackageKind,
  request: typeof fetch = fetch,
): Promise<ReleasePackage | undefined> {
  const response = await request(RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Vestra-Updater",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 403 || response.status === 429
        ? "GitHub rate limit reached. Try again later."
        : `Update check failed (HTTP ${response.status}).`,
    );
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error("Release list is too large.");
  return selectRelease(JSON.parse(text), current, kind);
}

export async function verifyPackage(
  filename: string,
  release: ReleasePackage,
): Promise<void> {
  const handle = await fs.open(filename, "r");
  try {
    if ((await handle.stat()).size !== release.size)
      throw new Error("Update size does not match the release.");
    const hash = createHash("sha256");
    for await (const part of handle.createReadStream({ autoClose: false }))
      hash.update(part);
    if (hash.digest("hex") !== release.sha256)
      throw new Error(
        "Update checksum failed. The file will not be installed.",
      );
  } finally {
    await handle.close();
  }
}

export async function downloadPackage(
  directory: string,
  release: ReleasePackage,
  progress: (value: number) => void,
  request: typeof fetch = fetch,
): Promise<string> {
  // Filenames and URLs come exclusively from selectRelease, never renderer arguments.
  if (
    path.basename(release.name) !== release.name ||
    !/^Vestra-[\w.+-]+-x64-(Setup|Portable)\.exe$/.test(release.name)
  )
    throw new Error("Invalid update filename.");
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, release.name);
  try {
    await verifyPackage(filename, release);
    progress(100);
    return filename;
  } catch {
    /* download a fresh verified copy */
  }
  const partial = filename + ".part";
  const handle = await fs.open(partial, "w");
  try {
    const response = await request(release.url, {
      signal: AbortSignal.timeout(15 * 60 * 1000),
      headers: { "User-Agent": "Vestra-Updater" },
    });
    if (!response.ok || !response.body)
      throw new Error(`Download failed (HTTP ${response.status}).`);
    let received = 0;
    const hash = createHash("sha256");
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length;
      if (received > release.size || received > MAX_PACKAGE)
        throw new Error("Update download exceeds its declared size.");
      hash.update(chunk);
      // FileHandle.write may write only part of a buffer.
      let offset = 0;
      while (offset < chunk.length) {
        const result = await handle.write(chunk, offset, chunk.length - offset);
        if (!result.bytesWritten) throw new Error("Could not write update.");
        offset += result.bytesWritten;
      }
      progress(Math.min(99, Math.floor((received / release.size) * 100)));
    }
    if (received !== release.size || hash.digest("hex") !== release.sha256)
      throw new Error("Update verification failed. Nothing was installed.");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.rm(partial, { force: true });
    throw error;
  }
  await handle.close();
  await fs.rename(partial, filename);
  progress(100);
  return filename;
}
