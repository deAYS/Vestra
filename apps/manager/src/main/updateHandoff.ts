import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { ReleasePackage } from "./githubUpdates.js";

function literal(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

/** The helper outlives Electron; no shell command contains unquoted user paths. */
export function handoffScript(options: {
  pid: number;
  packageFile: string;
  target: string;
  portable: boolean;
  release: ReleasePackage;
  token: string;
  errorFile: string;
}): string {
  const { pid, packageFile, target, portable, release, token, errorFile } =
    options;
  return `$ErrorActionPreference = 'Stop'
$package = ${literal(packageFile)}
$target = ${literal(target)}
$backup = $target + '.vestra-previous'
$failure = ${literal(errorFile)}
function Get-VestraHash($filename) {
  $stream = [IO.File]::OpenRead($filename)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
try {
  $manager = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
  if ($manager -and -not $manager.WaitForExit(60000)) { throw 'Manager did not close. Update cancelled.' }
  if ((Get-VestraHash $package) -ne ${literal(release.sha256)}) { throw 'Update checksum changed. Update cancelled.' }
  ${
    portable
      ? `for ($attempt = 0; ; $attempt++) {
    try { [IO.File]::Copy($target, $backup, $true); break }
    catch { if ($attempt -ge 40) { throw }; Start-Sleep -Milliseconds 250 }
  }
  try {
    for ($attempt = 0; ; $attempt++) {
      try { [IO.File]::Copy($package, $target, $true); break }
      catch { if ($attempt -ge 40) { throw }; Start-Sleep -Milliseconds 250 }
    }
    if ((Get-VestraHash $target) -ne ${literal(release.sha256)}) { throw 'Portable replacement verification failed.' }
  } catch {
    [IO.File]::Copy($backup, $target, $true)
    throw
  }`
      : `$installer = Start-Process -FilePath $package -ArgumentList @('/S', '--updated') -WindowStyle Hidden -PassThru
  $installer.WaitForExit()
  if ($installer.ExitCode -ne 0) { throw ('Installer exited with code ' + $installer.ExitCode) }
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'Updated Manager executable was not found.' }`
  }
  Start-Process -FilePath $target -ArgumentList @(${literal("--finish-update=" + token)}) -WindowStyle Hidden
} catch {
  [IO.File]::WriteAllText($failure, $_.Exception.Message)
  if (Test-Path -LiteralPath $target -PathType Leaf) { Start-Process -FilePath $target -WindowStyle Hidden }
}
`;
}

export async function launchUpdateHelper(
  options: Parameters<typeof handoffScript>[0],
  directory: string,
): Promise<void> {
  const filename = path.join(directory, "apply-update.ps1");
  // Windows PowerShell 5.1 needs the BOM to preserve non-ASCII installation paths.
  await fs.writeFile(filename, "\uFEFF" + handoffScript(options), "utf8");
  // -EncodedCommand avoids Windows argument quoting ambiguities, including paths with spaces.
  const command = `& ${literal(filename)}`;
  const child = spawn(
    path.join(
      process.env["SystemRoot"] ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      Buffer.from(command, "utf16le").toString("base64"),
    ],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
}
