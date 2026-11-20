import { test } from "node:test";
import assert from "node:assert/strict";
import { Patcher } from "./api/patcher.js";

class Base {
  static inherited = "base";
}

class Card extends Base {
  static displayName = "Card";
  static defaultProps = { size: 1 };
  readonly props: { label: string };
  constructor(props: { label: string }) {
    super();
    this.props = props;
  }
  render(): string {
    return `card:${this.props.label}`;
  }
}

test("a patched class component still constructs with new and keeps its statics", () => {
  const patcher = new Patcher();
  const module = { Card: Card as unknown };
  const seen: unknown[] = [];
  patcher.before("Test", module, "Card", (args) => { seen.push(args[0]); });
  const Patched = module.Card as typeof Card & { inherited: string };
  assert.notEqual(Patched, Card);
  const instance = new Patched({ label: "a" });
  assert.equal(instance.render(), "card:a");
  assert.ok(instance instanceof Card);
  assert.ok(instance instanceof Patched);
  assert.deepEqual(seen, [{ label: "a" }], "hooks still run for construct calls");
  assert.equal(Patched.displayName, "Card");
  assert.deepEqual(Patched.defaultProps, { size: 1 });
  assert.equal(Patched.inherited, "base");
  assert.equal(Patched.name, "Card");
  assert.equal(Patched.length, 1);
  assert.equal(Patched.prototype, Card.prototype);
  assert.equal(Patched.toString(), Function.prototype.toString.call(Card));
});

test("a subclass of a patched class constructs with its own prototype", () => {
  const patcher = new Patcher();
  const module = { Card: Card as unknown };
  patcher.after("Test", module, "Card", () => undefined);
  const Patched = module.Card as typeof Card;
  class Fancy extends Patched {
    override render(): string {
      return `fancy:${this.props.label}`;
    }
  }
  const fancy = new Fancy({ label: "b" });
  assert.equal(fancy.render(), "fancy:b");
  assert.ok(fancy instanceof Fancy);
});

test("plain function patches keep this, displayName and source", () => {
  const patcher = new Patcher();
  function Row(this: unknown, a: number, b: number): number {
    return a + b;
  }
  (Row as unknown as { displayName: string }).displayName = "Row";
  const module = { Row };
  patcher.after("Test", module, "Row", (_args, result) => (result as number) * 10);
  assert.equal(module.Row(1, 2), 30);
  assert.equal((module.Row as unknown as { displayName: string }).displayName, "Row");
  assert.equal(String(module.Row), Function.prototype.toString.call(Row));
});

test("patching a getter-only non-configurable export throws the named error and leaves nothing installed", () => {
  const patcher = new Patcher();
  const exports = {};
  const original = (): number => 1;
  Object.defineProperty(exports, "useThing", { enumerable: true, get: () => original });
  assert.throws(
    () => patcher.after("Test", exports, "useThing", () => 2),
    (err: unknown) => err instanceof Error && err.message === "Cannot patch useThing: export is read-only",
  );
  assert.equal((exports as { useThing: () => number }).useThing, original);
  assert.equal(patcher.getPatchCount(), 0);
});

test("a configurable getter export is patched with defineProperty and restored on unpatch", () => {
  const patcher = new Patcher();
  const exports = {};
  const original = (): number => 1;
  const getter = (): (() => number) => original;
  Object.defineProperty(exports, "useThing", { enumerable: true, configurable: true, get: getter });
  const unpatch = patcher.after("Test", exports, "useThing", () => 2);
  assert.equal((exports as { useThing: () => number }).useThing(), 2);
  unpatch();
  const restored = Object.getOwnPropertyDescriptor(exports, "useThing");
  assert.equal(restored?.get, getter);
  assert.equal(restored?.enumerable, true);
  assert.equal((exports as { useThing: () => number }).useThing(), 1);
});

test("a non-writable configurable data export is patched and restored", () => {
  const patcher = new Patcher();
  const exports = {};
  const original = (): number => 1;
  Object.defineProperty(exports, "fixed", { value: original, writable: false, configurable: true, enumerable: true });
  const unpatch = patcher.instead("Test", exports, "fixed", () => 3);
  assert.equal((exports as { fixed: () => number }).fixed(), 3);
  unpatch();
  const restored = Object.getOwnPropertyDescriptor(exports, "fixed");
  assert.equal(restored?.value, original);
  assert.equal(restored?.writable, false);
});

test("unpatch restores the original class and inherited methods", () => {
  const patcher = new Patcher();
  const module = { Card: Card as unknown };
  const unpatch = patcher.after("Test", module, "Card", () => undefined);
  unpatch();
  assert.equal(module.Card, Card);

  const proto = { greet: () => "hi" };
  const instance = Object.create(proto) as { greet: () => string };
  const unpatchInherited = patcher.after("Test", instance, "greet", () => "patched");
  assert.equal(instance.greet(), "patched");
  unpatchInherited();
  assert.equal(Object.prototype.hasOwnProperty.call(instance, "greet"), false);
  assert.equal(instance.greet(), "hi");
});

test("a method stored behind an inherited setter is restored through that setter", () => {
  const patcher = new Patcher();
  const original = (): string => "hi";
  let stored: unknown = original;
  const proto = {
    get greet(): unknown { return stored; },
    set greet(value: unknown) { stored = value; },
  };
  const instance = Object.create(proto) as { greet: () => string };
  const unpatch = patcher.after("Test", instance, "greet", () => "patched");
  assert.equal(instance.greet(), "patched");
  unpatch();
  assert.equal(stored, original);
  assert.equal(instance.greet(), "hi");
});
