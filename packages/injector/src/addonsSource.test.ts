import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as nodeFs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as vm from "node:vm";
import { buildAddonsSource } from "./addonsSource.js";

interface Addons {
  addonFolder(kind: string): Promise<string>;
  readAddonFiles(
    kind: string,
  ): Promise<Array<{ filename: string; source: string }>>;
  writeThemeFile(filename: string, css: string): Promise<string>;
  removeThemeFile(filename: string): Promise<boolean>;
}

async function fixture(): Promise<{
  root: string;
  api: Addons;
  cleanup: () => Promise<void>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-addons-"));
  const context = vm.createContext({
    fs: nodeFs,
    path,
    Buffer,
    console,
    app: { getPath: () => root },
    shell: {
      async trashItem(file: string) {
        const trash = path.join(root, "Trash");
        await fs.mkdir(trash, { recursive: true });
        await fs.rename(file, path.join(trash, path.basename(file)));
      },
    },
  });
  vm.runInContext(
    buildAddonsSource() +
      ";globalThis.api={addonFolder,readAddonFiles,writeThemeFile,removeThemeFile};",
    context,
  );
  return {
    root,
    api: context.api as Addons,
    cleanup: async () => {
      assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
      assert.ok(path.basename(root).startsWith("vestra-addons-"));
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test("addon folders accept only the two fixed directories", async () => {
  const f = await fixture();
  try {
    assert.equal(
      await f.api.addonFolder("plugins"),
      path.join(f.root, "Vestra", "plugins"),
    );
    assert.equal(
      await f.api.addonFolder("themes"),
      path.join(f.root, "Vestra", "themes"),
    );
    await assert.rejects(() => f.api.addonFolder("../../elsewhere"), /Unknown/);
  } finally {
    await f.cleanup();
  }
});

test("local discovery reads flat plugin builds and CSS, ignoring directories, hidden and oversized files", async () => {
  const f = await fixture();
  try {
    const plugins = await f.api.addonFolder("plugins"),
      themes = await f.api.addonFolder("themes");
    await fs.writeFile(
      path.join(plugins, "Example.plugin.js"),
      "window.example=1;",
    );
    await fs.writeFile(path.join(plugins, "source.ts"), "Not a build");
    await fs.mkdir(path.join(plugins, "Other.plugin.js"));
    await fs.writeFile(
      path.join(themes, "Aurora.theme.css"),
      ":root{--text-link:green}",
    );
    await fs.writeFile(path.join(themes, ".hidden.css"), "hidden");
    await fs.writeFile(path.join(themes, "too-big.css"), "界".repeat(180000));
    assert.deepEqual(
      Array.from(
        await f.api.readAddonFiles("plugins"),
        (file) => file.filename,
      ),
      ["Example.plugin.js"],
    );
    assert.deepEqual(
      Array.from(await f.api.readAddonFiles("themes"), (file) => file.filename),
      ["Aurora.theme.css"],
    );
  } finally {
    await f.cleanup();
  }
});

test("theme imports preserve existing files and reject paths, invalid content and byte-limit bypasses", async () => {
  const f = await fixture();
  try {
    assert.equal(
      await f.api.writeThemeFile("custom.css", "body{color:red}"),
      "custom.css",
    );
    assert.equal(
      await f.api.writeThemeFile("custom.css", "body{color:blue}"),
      "custom-1.css",
    );
    assert.equal(
      await fs.readFile(path.join(f.root, "Vestra/themes/custom.css"), "utf8"),
      "body{color:red}",
    );
    for (const name of [
      "../escape.css",
      "a/escape.css",
      "C:\\escape.css",
      ".hidden.css",
      "script.js",
      "a..b.css",
    ]) {
      await assert.rejects(
        () => f.api.writeThemeFile(name, "body{}"),
        /Invalid/,
      );
    }
    await assert.rejects(
      () => f.api.writeThemeFile("empty.css", "  "),
      /Invalid/,
    );
    await assert.rejects(
      () => f.api.writeThemeFile("huge.css", "界".repeat(180000)),
      /Invalid/,
    );
    await f.api.removeThemeFile("custom.css");
    assert.equal(
      await fs.readFile(path.join(f.root, "Trash/custom.css"), "utf8"),
      "body{color:red}",
    );
    await assert.rejects(
      () => f.api.removeThemeFile("../custom.css"),
      /Invalid/,
    );
  } finally {
    await f.cleanup();
  }
});
