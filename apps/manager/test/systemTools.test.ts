import { test } from "node:test";
import assert from "node:assert/strict";
import { systemTool } from "../src/main/systemTools.js";

test("system tools resolve to absolute System32 paths", () => {
  const saved = process.env["SystemRoot"];
  process.env["SystemRoot"] = "C:\\Windows";
  try {
    assert.equal(systemTool("reg"), "C:\\Windows\\System32\\reg.exe");
    assert.equal(systemTool("taskkill"), "C:\\Windows\\System32\\taskkill.exe");
    assert.equal(
      systemTool("powershell"),
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
    delete process.env["SystemRoot"];
    assert.ok(systemTool("reg").endsWith("\\System32\\reg.exe"));
  } finally {
    if (saved === undefined) delete process.env["SystemRoot"];
    else process.env["SystemRoot"] = saved;
  }
});
