import { test } from "node:test";
import assert from "node:assert/strict";
import { comboToEvents } from "./input.js";

test("single key presses and releases", () => {
  assert.deepEqual(comboToEvents("enter"), ["28:1", "28:0"]);
});

test("combo presses in order and releases in reverse", () => {
  assert.deepEqual(comboToEvents("Ctrl+S"), ["29:1", "31:1", "31:0", "29:0"]);
});

test("unknown key throws", () => {
  assert.throws(() => comboToEvents("ctrl+banana"), /Unknown key/);
});
