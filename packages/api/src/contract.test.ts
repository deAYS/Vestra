import { test } from "node:test";
import assert from "node:assert/strict";
import { runtime } from "../../core/src/index.js";
import { API_VERSION, getVestra, Styles, definePlugin, type VestraAPI } from "./index.js";

// Compile-time contract check: published types must be implemented by the host.
const contract: VestraAPI = runtime;

test("public SDK binds services to the existing host and rejects incompatible versions", () => {
  const g = globalThis as unknown as { Vestra?: unknown };
  const saved = g.Vestra;
  try {
    g.Vestra = contract;
    assert.equal(getVestra().apiVersion, API_VERSION);
    Styles.inject("sdk-contract", ":root { --sdk-contract: 1 }");
    assert.equal(runtime.Styles.has("sdk-contract"), true);
    Styles.remove("sdk-contract");
    assert.equal(runtime.Styles.has("sdk-contract"), false);
    g.Vestra = { apiVersion: "2.0.0" };
    assert.throws(getVestra, /major version 1/);
    assert.equal(definePlugin({ name: "SDK", description: "Fixture", authors: ["Test"] }).name, "SDK");
  } finally {
    if (saved === undefined) delete g.Vestra;
    else g.Vestra = saved;
  }
});
