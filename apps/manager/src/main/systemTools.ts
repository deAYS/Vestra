import * as path from "node:path";

/** Absolute paths for Windows tools so a same-named exe in the working directory never runs. */
export function systemTool(name: "powershell" | "taskkill" | "reg"): string {
  const system32 = path.win32.join(
    process.env["SystemRoot"] ?? "C:\\Windows",
    "System32",
  );
  return name === "powershell"
    ? path.win32.join(system32, "WindowsPowerShell", "v1.0", "powershell.exe")
    : path.win32.join(system32, `${name}.exe`);
}
