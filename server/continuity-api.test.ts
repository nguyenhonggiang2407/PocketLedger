import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { Store } from "./store.js";
import { createApp } from "./app.js";
async function account(app: ReturnType<typeof createApp>, email: string) {
  const agent = request.agent(app);
  const r = await agent
    .post("/api/auth/signup")
    .send({
      name: "Fictional Student",
      email,
      password: "Fictional-test-password-2030",
    })
    .expect(201);
  return { agent, csrf: r.body.csrf, id: r.body.user.id };
}
test("paged API validates limits and cursors and does not leak another owner", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store),
      a = await account(app, "a@example.test"),
      b = await account(app, "b@example.test");
    const add = store.db.prepare(
      "INSERT INTO transactions(user_id,type,category,amount_cents,date,note) VALUES(?,'expense','Food',100,'2030-04-19','Test entry')",
    );
    for (let i = 0; i < 5; i++) add.run(a.id);
    const first = await a.agent
      .get("/api/transactions?month=2030-04&limit=2")
      .expect(200);
    assert.equal(first.body.entries.length, 2);
    assert.equal(first.body.total, 5);
    const after = encodeURIComponent(first.body.nextCursor);
    const second = await a.agent
      .get("/api/transactions?month=2030-04&limit=2&after=" + after)
      .expect(200);
    assert.equal(second.body.entries.length, 2);
    assert(
      !second.body.entries.some((e: { id: number }) =>
        first.body.entries.some((f: { id: number }) => f.id === e.id),
      ),
    );
    const last = await a.agent
      .get(
        "/api/transactions?month=2030-04&limit=2&after=" +
          encodeURIComponent(second.body.nextCursor),
      )
      .expect(200);
    assert.equal(last.body.entries.length, 1);
    assert.equal(last.body.nextCursor, null);
    await b.agent
      .get("/api/transactions?month=2030-04&limit=2&after=" + after)
      .expect(400);
    await a.agent
      .get("/api/transactions?month=2030-05&limit=2&after=" + after)
      .expect(400);
    for (const tail of [
      "limit=0",
      "limit=501",
      "limit[]=2",
      "after=!",
      "after[]=x",
    ])
      await a.agent.get("/api/transactions?month=2030-04&" + tail).expect(400);
    await request(app)
      .get("/api/transactions?month=2030-04&limit=2")
      .expect(401);
  } finally {
    store.close();
  }
});
test("budget-copy API requires CSRF, validates months and leaves source and occupied targets intact", async () => {
  const store = new Store(":memory:");
  try {
    const app = createApp(store),
      a = await account(app, "a@example.test"),
      b = await account(app, "b@example.test");
    await a.agent
      .put("/api/budgets")
      .set("X-CSRF-Token", a.csrf)
      .send({ month: "2030-03", category: "Food", amount: "42.10" })
      .expect(200);
    await a.agent
      .post("/api/budgets/copy")
      .send({ month: "2030-04" })
      .expect(403);
    await a.agent
      .post("/api/budgets/copy")
      .set("Origin", "https://evil.example")
      .set("X-CSRF-Token", a.csrf)
      .send({ month: "2030-04" })
      .expect(403);
    for (const month of ["2000-01", "2030-13", "1999-12"])
      await a.agent
        .post("/api/budgets/copy")
        .set("X-CSRF-Token", a.csrf)
        .send({ month })
        .expect(400);
    await b.agent
      .post("/api/budgets/copy")
      .set("X-CSRF-Token", b.csrf)
      .send({ month: "2030-04" })
      .expect(404);
    const result = await a.agent
      .post("/api/budgets/copy")
      .set("X-CSRF-Token", a.csrf)
      .send({ month: "2030-04" })
      .expect(201);
    assert.deepEqual(result.body, {
      copied: 1,
      sourceMonth: "2030-03",
      month: "2030-04",
    });
    await a.agent
      .post("/api/budgets/copy")
      .set("X-CSRF-Token", a.csrf)
      .send({ month: "2030-04" })
      .expect(409);
    for (const month of ["2030-03", "2030-04"]) {
      const view = await a.agent
        .get("/api/overview?month=" + month)
        .expect(200);
      assert.equal(
        view.body.budgets.find(
          (x: { category: string }) => x.category === "Food",
        ).limitCents,
        4210,
      );
    }
  } finally {
    store.close();
  }
});
