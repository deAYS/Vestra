import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vm from "node:vm";
import { buildSettingsSource } from "./settingsSource.js";

test("desktop settings are atomic, channel-scoped and recover the last valid backup", async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "vestra-settings-test-"),
  );
  function backend(executable: string) {
    return vm.runInNewContext(
      buildSettingsSource() + ";({readSettings,writeSettings,settingsPath})",
      {
        fs,
        path,
        Buffer,
        process: { execPath: path.join(root, executable) },
        SETTINGS_FILE: "vestra-settings.json",
        app: { getPath: (kind: string) => path.join(root, kind) },
      },
    ) as {
      readSettings(): Promise<string | null>;
      writeSettings(text: string): Promise<void>;
      settingsPath(): string;
    };
  }
  try {
    const stable = backend("Discord.exe");
    assert.equal(await stable.readSettings(), null);
    await Promise.all([
      stable.writeSettings('{"selected":"first"}'),
      stable.writeSettings('{"selected":"last"}'),
    ]);
    assert.equal(await stable.readSettings(), '{"selected":"last"}');
    assert.equal(
      await fs.promises.readFile(stable.settingsPath() + ".bak", "utf8"),
      '{"selected":"first"}',
    );
    await fs.promises.writeFile(stable.settingsPath(), "{ interrupted file");
    assert.equal(await stable.readSettings(), '{"selected":"first"}');
    await stable.writeSettings('{"selected":"restored"}');
    assert.equal(await stable.readSettings(), '{"selected":"restored"}');
    assert.throws(() => stable.writeSettings("[]"), /JSON object/);
    assert.throws(
      () => stable.writeSettings("x".repeat(20 * 1024 * 1024 + 1)),
      /20 MB/,
    );
    assert.equal(await backend("DiscordCanary.exe").readSettings(), null);
    assert.equal(await backend("DiscordPTB.exe").readSettings(), null);
    const legacy = path.join(root, "userData", "vestra-settings.json");
    await fs.promises.mkdir(path.dirname(legacy), { recursive: true });
    await fs.promises.writeFile(legacy, '{"legacy":true}');
    assert.equal(
      await backend("DiscordCanary.exe").readSettings(),
      '{"legacy":true}',
    );
    assert.equal(await stable.readSettings(), '{"selected":"restored"}');
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
