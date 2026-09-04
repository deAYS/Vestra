// Manager error mapping: machine codes become friendly copy; raw detail
// stays behind "Show details". Progress labels carry no fake percentages.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { friendlyErrorMessage, progressLabel } from "../src/shared/errorMessages.js";

describe("error messages", () => {
  test("17. InstallerErrorCode maps to friendly copy", () => {
    assert.match(
      friendlyErrorMessage("permission-denied").title,
      /couldn't modify this Discord installation/,
    );
    assert.match(
      friendlyErrorMessage("permission-denied").hint,
      /required permissions/,
    );
    assert.match(friendlyErrorMessage("backup-missing").title, /original Discord backup/);
    assert.match(
      friendlyErrorMessage("verification-failed").title,
      /verification failed/,
    );
    assert.match(friendlyErrorMessage("safety-refusal").title, /safety checks/);
    assert.match(friendlyErrorMessage("unknown").title, /Something went wrong/);
    assert.match(friendlyErrorMessage(undefined).title, /Something went wrong/);
  });

  test("16. progress events map to phase labels without percentages", () => {
    const labels = [
      progressLabel("discovering"),
      progressLabel("staging"),
      progressLabel("patching", "Discord Canary"),
      progressLabel("verifying"),
      progressLabel("complete"),
    ];
    assert.deepEqual(labels, [
      "Preparing Vestra...",
      "Staging Vestra...",
      "Patching Discord Canary...",
      "Verifying...",
      "Done.",
    ]);
    for (const label of labels) assert.ok(!label.includes("%"), label);
  });
});
