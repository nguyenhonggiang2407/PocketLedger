import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";
import { createApp, verifyPassword } from "./app.js";
import { moneyToCents, decimal, csvCell, validDate } from "./domain.js";
const password = "Fictional-Test-Password-2026";
const fixture = () => {
  const store = new Store(":memory:");
  return { store, app: createApp(store) };
};
async function account(
  app: ReturnType<typeof createApp>,
  email = "learner@example.test",
) {
  const agent = request.agent(app);
  const r = await agent
    .post("/api/auth/signup")
    .send({ name: "Test Student", email, password })
    .expect(201);
  return { agent, csrf: r.body.csrf, user: r.body.user };
}
const entry = {
  type: "expense",
  category: "Food",
  amount: "0.10",
  date: "2026-10-05",
  note: "Synthetic lunch",
};

test("CSV exports all matching rows beyond the 500-row screen limit and handles hostile notes", async () => {
  const { store, app } = fixture();
  try {
    const a = await account(app);
    const insert = store.db.prepare(
      "INSERT INTO transactions(user_id,type,category,amount_cents,date,note) VALUES(?,?,?,?,?,?)",
    );
    store.atomic(() => {
      for (let i = 0; i < 501; i++)
        insert.run(
          a.user.id,
          "expense",
          "Food",
          1,
          "2026-10-05",
          i === 0 ? "  +SUM(1,2)" : "Synthetic item " + i,
        );
      insert.run(
        a.user.id,
        "expense",
        "Study",
        100,
        "2026-10-05",
        "Study item",
      );
    });
    const list = await a.agent
      .get("/api/transactions?month=2026-10&category=Food")
      .expect(200);
    assert.equal(list.body.total, 501);
    assert.equal(list.body.entries.length, 500);
    const exportResult = await a.agent
      .get("/api/export.csv?month=2026-10&category=Food")
      .expect(200);
    assert.equal(exportResult.text.split("\r\n").length, 502);
    assert(exportResult.text.includes('"\'  +SUM(1,2)"'));
    assert(!exportResult.text.includes("Study item"));
    assert.equal(exportResult.headers["cache-control"], "no-store");
    const overview = (await a.agent.get("/api/overview?month=2026-10")).body;
    assert.equal(overview.summary.expenseCents, 601);
    assert.equal(
      overview.budgets.find((b: { category: string }) => b.category === "Food")
        .spentCents,
      501,
    );
    for (const note of ["=1+1", "\t1", "\n=1", " @SUM(1,2)"])
      assert(csvCell(note).startsWith("\"'"));
  } finally {
    store.close();
  }
});

test("secure session cookie flags and expiration protect authenticated endpoints", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store, {
      origin: "https://ledger.example.test",
      secure: true,
    });
    const created = await request(app)
      .post("/api/auth/signup")
      .set("Origin", "https://ledger.example.test")
      .send({ name: "Test Student", email: "SESSION@example.test", password })
      .expect(201);
    const cookie = String(created.headers["set-cookie"][0]);
    assert(cookie.includes("HttpOnly"));
    assert(cookie.includes("SameSite=Strict"));
    assert(cookie.includes("Secure"));
    assert.equal(created.body.user.email, "session@example.test");
    const rawCookie = cookie.split(";")[0];
    await request(app)
      .get("/api/overview?month=2026-10")
      .set("Cookie", rawCookie)
      .expect(200);
    store.db.prepare("UPDATE sessions SET expires_at=?").run(Date.now() - 1000);
    assert.equal(
      (await request(app).get("/api/auth/me").set("Cookie", rawCookie)).body
        .user,
      null,
    );
    await request(app)
      .get("/api/export.csv?month=2026-10")
      .set("Cookie", rawCookie)
      .expect(401);
  } finally {
    store.close();
  }
});
test("decimal amounts are exact and reject malformed, negative, unsafe and fractional-cent input", () => {
  assert.equal(moneyToCents("0.10") + moneyToCents("0.20"), 30);
  assert.equal(decimal(30), "0.30");
  assert.equal(decimal(-109), "-1.09");
  for (const x of ["0", "-1", "1.001", "NaN", "1e3", "10000000", "01.00", 1])
    assert.throws(() => moneyToCents(x));
  assert.equal(csvCell(" =SUM(A1:A2)"), `"' =SUM(A1:A2)"`);
  assert.equal(csvCell('hello, "world"'), `"hello, ""world"""`);
});
test("signup hashes passwords, stores only hashed session tokens, restores cookies and invalidates logout", async () => {
  const { store, app } = fixture();
  try {
    const a = await account(app);
    const row = store.db
      .prepare("SELECT password_hash FROM users WHERE id=?")
      .get(a.user.id) as { password_hash: string };
    assert.notEqual(row.password_hash, password);
    assert(await verifyPassword(password, row.password_hash));
    assert(!("password_hash" in a.user));
    const me = await a.agent.get("/api/auth/me").expect(200);
    assert.equal(me.body.user.id, a.user.id);
    await a.agent
      .post("/api/auth/logout")
      .set("X-CSRF-Token", a.csrf)
      .send({})
      .expect(200);
    assert.equal((await a.agent.get("/api/auth/me")).body.user, null);
    await a.agent.get("/api/overview?month=2026-10").expect(401);
    const login = await a.agent
      .post("/api/auth/login")
      .send({ email: a.user.email, password })
      .expect(200);
    assert.notEqual(login.body.csrf, a.csrf);
  } finally {
    store.close();
  }
});
test("concurrent signup resolves duplicate email as409, not500; oversized JSON returns413", async () => {
  const { store, app } = fixture();
  try {
    const payload = { name: "Student", email: "race@example.test", password };
    const responses = await Promise.all([
      request(app).post("/api/auth/signup").send(payload),
      request(app).post("/api/auth/signup").send(payload),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    await request(app)
      .post("/api/auth/signup")
      .send({ ...payload, name: "x".repeat(20000) })
      .expect(413);
  } finally {
    store.close();
  }
});
test("ownership and CSRF apply to reads, edits, deletes, exports and monthly budgets", async () => {
  const { store, app } = fixture();
  try {
    const a = await account(app),
      b = await account(app, "other@example.test");
    await a.agent.post("/api/transactions").send(entry).expect(403);
    await a.agent
      .post("/api/transactions")
      .set("X-CSRF-Token", a.csrf)
      .set("Origin", "https://attacker.example")
      .send(entry)
      .expect(403);
    const added = await a.agent
      .post("/api/transactions")
      .set("X-CSRF-Token", a.csrf)
      .send(entry)
      .expect(201);
    const id = added.body.id;
    await b.agent
      .put("/api/transactions/" + id)
      .set("X-CSRF-Token", b.csrf)
      .send({ ...entry, amount: "10" })
      .expect(404);
    await b.agent
      .delete("/api/transactions/" + id)
      .set("X-CSRF-Token", b.csrf)
      .send({})
      .expect(404);
    assert.equal(
      (await b.agent.get("/api/transactions?month=2026-10")).body.total,
      0,
    );
    assert(
      !(await b.agent.get("/api/export.csv?month=2026-10")).text.includes(
        entry.note,
      ),
    );
    await a.agent
      .put("/api/budgets")
      .set("X-CSRF-Token", a.csrf)
      .send({ month: "2026-10", category: "Food", amount: "100" })
      .expect(200);
    assert.equal(
      (await b.agent.get("/api/overview?month=2026-10")).body.budgets.find(
        (x: { category: string }) => x.category === "Food",
      ).limitCents,
      null,
    );
  } finally {
    store.close();
  }
});
test("CRUD, filters, budget math and CSV protection remain correct", async () => {
  const { store, app } = fixture();
  try {
    const a = await account(app);
    const add = async (d: unknown) =>
      a.agent
        .post("/api/transactions")
        .set("X-CSRF-Token", a.csrf)
        .send(d)
        .expect(201);
    const first = await add(entry);
    await add({ ...entry, amount: "0.20", note: "=1+1" });
    await add({
      ...entry,
      type: "income",
      category: "Allowance",
      amount: "1.00",
    });
    await add({ ...entry, date: "2026-09-05", amount: "9.00" });
    await a.agent
      .put("/api/budgets")
      .set("X-CSRF-Token", a.csrf)
      .send({ month: "2026-10", category: "Food", amount: "0.25" })
      .expect(200);
    let overview = (
      await a.agent.get("/api/overview?month=2026-10").expect(200)
    ).body;
    assert.equal(overview.summary.expenseCents, 30);
    assert.equal(overview.summary.netCents, 70);
    assert.equal(overview.summary.balanceCents, -830);
    assert.equal(
      overview.budgets.find((b: { category: string }) => b.category === "Food")
        .spentCents,
      30,
    );
    assert.equal(
      (await a.agent.get("/api/transactions?month=2026-10&category=Food")).body
        .total,
      2,
    );
    const csv = await a.agent.get("/api/export.csv?month=2026-10").expect(200);
    assert(csv.text.includes(`"'=1+1"`));
    assert(!csv.text.includes("2026-09-05"));
    await a.agent
      .put("/api/transactions/" + first.body.id)
      .set("X-CSRF-Token", a.csrf)
      .send({ ...entry, amount: "0.15" })
      .expect(200);
    await a.agent
      .delete("/api/transactions/" + first.body.id)
      .set("X-CSRF-Token", a.csrf)
      .send({})
      .expect(200);
    overview = (await a.agent.get("/api/overview?month=2026-10")).body;
    assert.equal(overview.summary.expenseCents, 20);
    await a.agent
      .post("/api/transactions")
      .set("X-CSRF-Token", a.csrf)
      .send({ ...entry, date: "2026-02-30" })
      .expect(400);
    await a.agent
      .post("/api/transactions")
      .set("X-CSRF-Token", a.csrf)
      .send({ ...entry, category: "Allowance" })
      .expect(400);
    await a.agent.get("/api/overview?month=2026-13").expect(400);
    await a.agent
      .delete("/api/budgets/Food?month=2026-10")
      .set("X-CSRF-Token", a.csrf)
      .send({})
      .expect(200);
  } finally {
    store.close();
  }
});
test("private demo workspaces are isolated and seeding never overwrites existing data", async () => {
  const { store, app } = fixture();
  try {
    const a = request.agent(app),
      b = request.agent(app);
    const da = await a.post("/api/auth/demo").send({}).expect(201),
      db = await b.post("/api/auth/demo").send({}).expect(201);
    assert.notEqual(da.body.user.id, db.body.user.id);
    const m = new Date().toISOString().slice(0, 7);
    assert.equal((await a.get("/api/transactions?month=" + m)).body.total, 12);
    const list = (await a.get("/api/transactions?month=" + m)).body.entries;
    await a
      .delete("/api/transactions/" + list[0].id)
      .set("X-CSRF-Token", da.body.csrf)
      .send({})
      .expect(200);
    assert.equal((await b.get("/api/transactions?month=" + m)).body.total, 12);
    await a
      .post("/api/demo")
      .set("X-CSRF-Token", da.body.csrf)
      .send({ month: m })
      .expect(409);
  } finally {
    store.close();
  }
});
test("private demo uses the requested calendar month and validates it before creating records", async () => {
  const { store, app } = fixture();
  try {
    for (const selectedMonth of ["2026-13", "1999-12", null])
      await request(app)
        .post("/api/auth/demo")
        .send({ month: selectedMonth })
        .expect(400);
    for (const table of ["users", "sessions", "transactions", "budgets"])
      assert.equal(
        store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n,
        0,
      );
    const agent = request.agent(app);
    const selectedMonth = "2030-02";
    const demo = await agent
      .post("/api/auth/demo")
      .send({ month: selectedMonth })
      .expect(201);
    const overview = await agent
      .get("/api/overview?month=" + selectedMonth)
      .expect(200);
    assert.equal(overview.body.summary.count, 12);
    assert.equal(overview.body.summary.incomeCents, 148000);
    assert.equal(overview.body.summary.expenseCents, 68240);
    assert.equal(overview.body.summary.balanceCents, 143560);
    assert.equal(store.entries(demo.body.user.id, selectedMonth).length, 12);
    assert.equal(store.entries(demo.body.user.id, "2030-01").length, 3);
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) n FROM budgets WHERE user_id=? AND month=?")
        .get(demo.body.user.id, selectedMonth)?.n,
      5,
    );
    const boundary = request.agent(app);
    const earliest = await boundary
      .post("/api/auth/demo")
      .send({ month: "2000-01" })
      .expect(201);
    const dates = store.db
      .prepare("SELECT date FROM transactions WHERE user_id=?")
      .all(earliest.body.user.id) as { date: string }[];
    assert.equal(dates.length, 12);
    assert(dates.every((row) => validDate(row.date)));
    assert.equal(
      (await boundary.get("/api/overview?month=2000-01").expect(200)).body
        .summary.balanceCents,
      79760,
    );
  } finally {
    store.close();
  }
});

test("SQLite retains transactions, budgets and hashed sessions across reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pocketledger-test-"));
  const path = join(dir, "ledger.sqlite");
  let store = new Store(path);
  try {
    let app = createApp(store);
    const a = await account(app);
    await a.agent
      .post("/api/transactions")
      .set("X-CSRF-Token", a.csrf)
      .send(entry)
      .expect(201);
    const sessionRow = store.db
      .prepare("SELECT token_hash FROM sessions")
      .get() as { token_hash: string };
    assert.match(sessionRow.token_hash, /^[a-f0-9]{64}$/);
    store.close();
    store = new Store(path);
    app = createApp(store);
    assert.equal(store.entries(a.user.id, "2026-10").length, 1);
    assert.equal(
      (store.user(a.user.id) as { email: string }).email,
      a.user.email,
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) n FROM sessions").get()?.n,
      1,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
