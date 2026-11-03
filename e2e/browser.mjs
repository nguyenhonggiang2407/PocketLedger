import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { Store } from "../dist-server/store.js";
import { createApp } from "../dist-server/app.js";
let server,
  store,
  browser,
  base,
  serial = 0;
before(async () => {
  mkdirSync("docs/screenshots", { recursive: true });
  store = new Store(":memory:");
  server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = "http://127.0.0.1:" + server.address().port;
  server.on("request", createApp(store, { origin: base }));
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
  store?.close();
});
async function fixture(t, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  const response = await context.request.post(base + "/api/auth/signup", {
    data: {
      name: "Fictional Student",
      email: `ledger-${++serial}@example.test`,
      password: "Fictional-password-2030",
    },
  });
  assert.equal(response.status(), 201);
  const session = await response.json();
  return { context, page, uid: session.user.id };
}
function seedEntries(uid, count = 551) {
  const add = store.db.prepare(
    "INSERT INTO transactions(user_id,type,category,amount_cents,date,note) VALUES(?,?,?,?,?,?)",
  );
  store.atomic(() => {
    for (let i = 0; i < count; i++)
      add.run(uid, "expense", "Food", 123, "2030-04-19", "Fictional item " + i);
    add.run(uid, "expense", "Study", 500, "2030-04-18", "A study entry");
  });
}
async function transactions(f) {
  await f.page.goto(base);
  await f.page
    .getByRole("button", { name: "Transactions", exact: true })
    .click();
  await f.page.getByLabel("Selected month", { exact: true }).fill("2030-04");
  await expect(f.page.locator("table tbody tr")).toHaveCount(50);
}
async function capture(page, name) {
  await expect(page.locator(".toast")).toBeHidden({ timeout: 6000 });
  await page.locator("#content").focus();
  await page.locator("#content").evaluate((element) => element.blur());
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "docs/screenshots/" + name + ".png",
    fullPage: true,
  });
}
test(
  "the real list reaches entries beyond 500 and CSV includes exactly the selected category",
  { timeout: 45000 },
  async (t) => {
    const f = await fixture(t);
    seedEntries(f.uid);
    await transactions(f);
    await f.page
      .getByLabel("Filter transactions by category")
      .selectOption("Food");
    await expect(f.page.locator('.pagination [role="status"]')).toHaveText(
      "Showing 50 of 551 matching entries",
    );
    for (let n = 100; n <= 550; n += 50) {
      await f.page
        .getByRole("button", { name: "Load older entries", exact: true })
        .click();
      await expect(f.page.locator("table tbody tr")).toHaveCount(n);
    }
    await f.page
      .getByRole("button", { name: "Load older entries", exact: true })
      .click();
    await expect(f.page.locator("table tbody tr")).toHaveCount(551);
    await expect(f.page.locator('.pagination [role="status"]')).toHaveText(
      "Showing 551 of 551 matching entries",
    );
    await expect(
      f.page.getByRole("button", { name: "Load older entries", exact: true }),
    ).toHaveCount(0);
    const pending = f.page.waitForEvent("download");
    await f.page.getByRole("link", { name: "Export CSV", exact: true }).click();
    const csv = readFileSync(await (await pending).path(), "utf8");
    assert.equal(csv.split("\r\n").length, 552);
    assert(!csv.includes("A study entry"));
  },
);
test(
  "a failed page keeps loaded entries and a delayed old page cannot enter a new category",
  { timeout: 45000 },
  async (t) => {
    const f = await fixture(t);
    seedEntries(f.uid, 101);
    await transactions(f);
    let fail = true,
      release,
      reached;
    const started = new Promise((resolve) => {
      reached = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let done;
    const finished = new Promise((resolve) => {
      done = resolve;
    });
    await f.page.route("**/api/transactions?**", async (route) => {
      if (!new URL(route.request().url()).searchParams.has("after"))
        return route.continue();
      if (fail) {
        fail = false;
        return route.abort("failed");
      }
      const response = await route.fetch();
      reached();
      await gate;
      try {
        await route.fulfill({ response });
      } catch {
        /* The filter change aborts this request. */
      }
      done();
    });
    await f.page
      .getByRole("button", { name: "Load older entries", exact: true })
      .click();
    await expect(f.page.locator('.pagination [role="alert"]')).toBeVisible();
    await expect(f.page.locator("table tbody tr")).toHaveCount(50);
    await f.page
      .getByRole("button", { name: "Load older entries", exact: true })
      .click();
    await started;
    try {
      await f.page
        .getByLabel("Filter transactions by category")
        .selectOption("Study");
      await expect(f.page.locator("table tbody tr")).toHaveCount(1);
    } finally {
      release();
    }
    await finished;
    await f.page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect(f.page.locator("table tbody tr")).toHaveCount(1);
    await expect(f.page.locator("table tbody")).toContainText("A study entry");
    await expect(f.page.locator("table tbody")).not.toContainText(
      "Fictional item",
    );
    await expect(f.page.locator('.pagination [role="status"]')).toHaveText(
      "Showing 1 of 1 matching entries",
    );
  },
);
test(
  "a budget copy survives a lost response and reload without copying transactions or overwriting limits",
  { timeout: 45000 },
  async (t) => {
    const f = await fixture(t);
    const add = store.db.prepare("INSERT INTO budgets VALUES(?,?,?,?)");
    add.run(f.uid, "2030-03", "Food", 3210);
    add.run(f.uid, "2030-03", "Study", 5000);
    await f.page.goto(base);
    await f.page.getByRole("button", { name: "Budgets", exact: true }).click();
    await f.page.getByLabel("Selected month", { exact: true }).fill("2030-04");
    const copy = f.page.getByRole("button", {
      name: "Copy previous month",
      exact: true,
    });
    await expect(copy).toBeEnabled();
    await f.page.route("**/api/budgets/copy", async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      await route.abort("failed");
    });
    await copy.click();
    const food = f.page.locator(".budget-card").filter({
      has: f.page.getByRole("heading", { name: "Food", exact: true }),
    });
    await expect(food).toContainText("$32.10");
    await expect(copy).toBeDisabled();
    assert.equal(
      store.db
        .prepare("SELECT count(*) n FROM transactions WHERE user_id=?")
        .get(f.uid).n,
      0,
    );
    await f.page.unroute("**/api/budgets/copy");
    await f.page.reload();
    await f.page.getByRole("button", { name: "Budgets", exact: true }).click();
    await f.page.getByLabel("Selected month", { exact: true }).fill("2030-04");
    await expect(food).toContainText("$32.10");
    await expect(copy).toBeDisabled();
    await capture(f.page, "budgets-desktop");
  },
);
test(
  "mobile budget copy succeeds and fits a narrow screen",
  { timeout: 45000 },
  async (t) => {
    const f = await fixture(t, { viewport: { width: 390, height: 844 } });
    store.db
      .prepare("INSERT INTO budgets VALUES(?,?,?,?)")
      .run(f.uid, "2030-03", "Food", 3210);
    await f.page.goto(base);
    await f.page.getByRole("button", { name: "Budgets", exact: true }).click();
    await f.page.getByLabel("Selected month", { exact: true }).fill("2030-04");
    await f.page
      .getByRole("button", { name: "Copy previous month", exact: true })
      .click();
    await expect(f.page.locator(".toast")).toContainText(
      "1 budget limit copied",
    );
    assert(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await capture(f.page, "budgets-mobile");
  },
);
test(
  "a session expiring during pagination clears the private ledger from the screen",
  { timeout: 45000 },
  async (t) => {
    const f = await fixture(t);
    seedEntries(f.uid, 51);
    await transactions(f);
    store.db
      .prepare("UPDATE sessions SET expires_at=? WHERE user_id=?")
      .run(Date.now() - 1000, f.uid);
    await f.page
      .getByRole("button", { name: "Load older entries", exact: true })
      .click();
    await expect(
      f.page.getByLabel("Email address", { exact: true }),
    ).toBeVisible();
    await expect(f.page.locator("table tbody tr")).toHaveCount(0);
  },
);
