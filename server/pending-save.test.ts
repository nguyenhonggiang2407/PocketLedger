import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const { transformSync } = require("esbuild");
type Node = { type: any; props: any };
const nodes = (value: any): Node[] =>
  Array.isArray(value)
    ? value.flatMap(nodes)
    : value && typeof value === "object" && "props" in value
      ? [value, ...nodes(value.props.children)]
      : [];

// Run the real TSX module. Hooks/rendered props are adapted; effects and browser
// focus/layout are intentionally excluded. No server, account or database runs.
function fixture(kind: "entry" | "budget") {
  const entry = { type: "expense", category: "Food", date: "2030-04-19", note: "" };
  const state: any[] = [
    { id: 7, name: "Fictional Student", email: "student@example.test", isDemo: 1 },
    false, "", "login", false, "2030-04", "", "Overview", null, [], 0,
    false, 0, kind === "entry" ? entry : null,
    kind === "budget" ? { category: "Food", limitCents: 5000, spentCents: 1234 } : null,
    "", null,
  ];
  let cursor = 0, component: any, tree: Node;
  const jsx = (type: any, props: any) => ({ type, props: props || {} });
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value: any) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    },
    useRef(initial: any) { const index = cursor++; return state[index] ||= { current: initial }; },
    useEffect() {},
    StrictMode: Symbol("strict"),
  };
  const calls: { path: string; options: any }[] = [];
  let pending: { resolve: () => void; reject: (error: Error) => void };
  const fetch = (path: string, options: any) => {
    calls.push({ path, options });
    return new Promise((resolve, reject) => {
      pending = { reject, resolve: () => resolve({ ok: true, status: 201, json: async () => ({ id: 88 }) }) };
    });
  };
  class Snapshot {
    data: Map<string, string>;
    constructor(form: any) {
      this.data = new Map(Object.entries(form.values).filter(([name]) => !controls().find(node => node.props.name === name)?.props.disabled) as [string, string][]);
    }
    get(name: string) { return this.data.get(name) ?? null; }
  }
  const module = { exports: {} };
  const code = transformSync(readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8"), {
    loader: "tsx", format: "cjs", jsx: "automatic", target: "es2022",
  }).code;
  runInNewContext(code, {
    module, exports: module.exports, fetch, FormData: Snapshot,
    document: { getElementById: () => ({}) },
    require(id: string) {
      if (id === "react") return hooks;
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: Symbol("fragment") };
      if (id === "react-dom/client") return { createRoot: () => ({ render: (root: Node) => { component = root.props.children.type; } }) };
      if (id.endsWith(".css")) return {};
      throw Error("Unexpected module: " + id);
    },
  }, { timeout: 1000 });
  function render() { cursor = 0; tree = component(); return tree; }
  function form() { return nodes(tree).find(node => node.type === "form" && node.props.onSubmit.name === (kind === "entry" ? "saveEntry" : "saveBudget"))!; }
  function controls() { return nodes(form()).filter(node => ["input", "select"].includes(node.type)); }
  render();
  const draft = { values: kind === "entry"
    ? { type: "expense", category: "Food", amount: "12.34", date: "2030-04-19", note: "Fictional lunch" }
    : { amount: "50.00" } };
  return {
    calls, draft, form, controls, render, pending: () => pending,
    submit: () => form().props.onSubmit({ preventDefault() {}, currentTarget: draft }),
    input(name: string, value: string) {
      const field = controls().find(node => node.props.name === name)!;
      if (!field.props.disabled) (draft.values as any)[name] = value;
    },
  };
}

for (const kind of ["entry", "budget"] as const) {
  test(`${kind} saves freeze the actual rendered fields, retain failed drafts and retry the corrected snapshot`, async () => {
    const f = fixture(kind), original = { ...f.draft.values };
    const failed = f.submit(); f.render();
    assert.equal(f.calls.length, 1);
    assert.equal(f.form().props["aria-busy"], true);
    assert.ok(f.controls().every(field => field.props.disabled), "late edits must be blocked while the snapshot saves");
    f.input("amount", "999.99");
    if (kind === "entry") f.input("note", "Late text absent from the request");
    assert.deepEqual(f.draft.values, original);
    await f.submit();
    assert.equal(f.calls.length, 1, "a pending form cannot submit another request");
    const payload = JSON.parse(f.calls[0].options.body);
    assert.equal(payload.amount, original.amount);
    if (kind === "entry") assert.equal(payload.note, original.note);
    else { assert.equal(payload.month, "2030-04"); assert.equal(payload.category, "Food"); }
    f.pending().reject(Error("Fictional offline failure")); await failed; f.render();
    assert.ok(f.controls().every(field => !field.props.disabled));
    assert.equal(f.form().props["aria-busy"], false);
    assert.deepEqual(f.draft.values, original, "failure must not clear the learner's amount or note");
    f.input("amount", "23.45");
    const saved = f.submit(); f.render();
    assert.equal(JSON.parse(f.calls[1].options.body).amount, "23.45");
    f.pending().resolve(); await saved; f.render();
    assert.equal(f.form(), undefined, "successful retry closes the same editor");
    assert.equal(f.calls.length, 2);
  });
}
