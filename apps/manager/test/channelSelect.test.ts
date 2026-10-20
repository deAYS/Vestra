// Manager channel selection: production defaults to Stable (Recommended),
// development builds preselect Canary (Development target). Single installs
// auto-select; multi-install never patches more than one channel per action.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  channelBadge,
  defaultChannel,
  isDevelopmentBuild,
  selectDefaultChannel,
} from "../src/shared/channelSelect.js";

describe("channel selection", () => {
  test("3. production default is stable", () => {
    assert.equal(defaultChannel(false), "stable");
    assert.equal(isDevelopmentBuild(false), false);
  });

  test("4. development mode also selects Stable + Development target badge", () => {
    assert.equal(defaultChannel(true), "stable");
    assert.equal(isDevelopmentBuild(true), true);
    assert.equal(channelBadge("stable", true), "Development target");
    assert.equal(channelBadge("canary", true), undefined);
  });

  test("production marks stable Recommended, never canary", () => {
    assert.equal(channelBadge("stable", false), "Recommended");
    assert.equal(channelBadge("canary", false), undefined);
    assert.equal(channelBadge("ptb", false), undefined);
  });

  test("5. exactly one installation is automatically selected", () => {
    assert.equal(selectDefaultChannel(["ptb"], false), "ptb");
    assert.equal(selectDefaultChannel(["canary"], false), "canary");
  });

  test("multiple installations prefer the build default", () => {
    assert.equal(selectDefaultChannel(["stable", "canary"], false), "stable");
    assert.equal(selectDefaultChannel(["stable", "canary"], true), "stable");
    assert.equal(selectDefaultChannel(["stable", "ptb"], true), "stable");
  });

  test("no installations selects nothing (no fake entries)", () => {
    assert.equal(selectDefaultChannel([], false), undefined);
  });
});
