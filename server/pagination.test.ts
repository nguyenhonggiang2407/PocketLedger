import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "./store.js";
import {
  pageLimit,
  readCursor,
  nextCursor,
  previousMonth,
} from "./pagination.js";
function fixture() {
  const store = new Store(":memory:");
  const addUser = store.db.prepare(
    "INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",
  );
  const a = Number(
    addUser.run("First", "first@example.test", "not-a-real-password")
      .lastInsertRowid,
  );
  const b = Number(
    addUser.run("Second", "second@example.test", "not-a-real-password")
      .lastInsertRowid,
  );
  return { store, a, b };
}
test("keyset pages reach entries beyond 500 with tied dates, correct totals and owner filters", () => {
  const { store, a, b } = fixture();
  try {
    const add = store.db.prepare(
      "INSERT INTO transactions(user_id,type,category,amount_cents,date,note) VALUES(?,?,?,?,?,?)",
    );
    store.atomic(() => {
      for (let i = 0; i < 551; i++)
        add.run(
          a,
          "expense",
          "Food",
          1,
          i % 2 ? "2030-04-19" : "2030-04-18",
          "Item " + i,
        );
      add.run(a, "expense", "Study", 1, "2030-04-19", "Different category");
      add.run(a, "expense", "Food", 1, "2030-03-19", "Different month");
      add.run(b, "expense", "Food", 1, "2030-04-19", "Other owner");
    });
    const ids: number[] = [];
    let cursor: string | undefined;
    do {
      const page = store.page(
        a,
        "2030-04",
        "Food",
        50,
        readCursor(cursor, a, "2030-04", "Food"),
      );
      assert.equal(page.total, 551);
      assert(page.entries.length <= 50);
      assert(page.entries.every((e) => e.note.startsWith("Item ")));
      ids.push(...page.entries.map((e) => e.id));
      cursor = page.hasMore
        ? nextCursor(a, "2030-04", "Food", page.entries.at(-1)!)
        : undefined;
    } while (cursor);
    assert.equal(ids.length, 551);
    assert.equal(new Set(ids).size, 551);
    assert.equal(store.overview(a, "2030-04").summary.expenseCents, 552);
  } finally {
    store.close();
  }
});
test("keyset paging does not shift already loaded rows when a newer entry is inserted", () => {
  const { store, a } = fixture();
  try {
    const add = store.db.prepare(
      "INSERT INTO transactions(user_id,type,category,amount_cents,date,note) VALUES(?,'expense','Food',1,'2030-04-19',?)",
    );
    for (let i = 0; i < 6; i++) add.run(a, "Item " + i);
    const first = store.page(a, "2030-04", "", 3);
    add.run(a, "New item");
    const second = store.page(a, "2030-04", "", 3, first.entries.at(-1)!);
    assert.equal(second.total, 7);
    assert.equal(second.entries.length, 3);
    assert(
      !second.entries.some((e) => first.entries.some((f) => f.id === e.id)),
    );
    assert(!second.entries.some((e) => e.note === "New item"));
  } finally {
    store.close();
  }
});
test("cursor validation rejects malformed data, wrong accounts, months and categories", () => {
  const good = nextCursor(1, "2030-04", "Food", { date: "2030-04-19", id: 50 });
  assert.deepEqual(readCursor(good, 1, "2030-04", "Food"), {
    date: "2030-04-19",
    id: 50,
  });
  for (const value of [
    "",
    "!",
    ["a"],
    "a".repeat(513),
    Buffer.from("{}").toString("base64url"),
    nextCursor(1, "2030-04", "Food", { date: "2030-04-31", id: 1 }),
  ]) {
    assert.throws(() => readCursor(value, 1, "2030-04", "Food"));
  }
  assert.throws(() => readCursor(good, 2, "2030-04", "Food"));
  assert.throws(() => readCursor(good, 1, "2030-03", "Food"));
  assert.throws(() => readCursor(good, 1, "2030-04", "Study"));
  for (const value of ["0", "501", "-1", "1.5", "50 OR 1=1", ["50"]])
    assert.throws(() => pageLimit(value));
  assert.equal(pageLimit(undefined), 500);
  assert.equal(pageLimit("1"), 1);
  assert.equal(pageLimit("500"), 500);
});
test("budget copy is atomic, owner-specific and never overwrites an existing target", () => {
  const { store, a, b } = fixture();
  try {
    const add = store.db.prepare("INSERT INTO budgets VALUES(?,?,?,?)");
    add.run(a, "2030-03", "Food", 1250);
    add.run(a, "2030-03", "Study", 3000);
    add.run(b, "2030-03", "Housing", 90000);
    assert.equal(store.copyBudgets(a, "2030-04", "2030-03"), 2);
    assert.equal(
      store
        .overview(a, "2030-04")
        .budgets.find((b) => b.category === "Housing")!.limitCents,
      null,
    );
    assert.throws(
      () => store.copyBudgets(a, "2030-04", "2030-03"),
      /already has/,
    );
    assert.equal(
      store.overview(a, "2030-04").budgets.find((b) => b.category === "Food")!
        .limitCents,
      1250,
    );
    store.db.exec(
      "CREATE TEMP TRIGGER fail_copy BEFORE INSERT ON budgets WHEN NEW.month='2030-05' AND NEW.category='Study' BEGIN SELECT RAISE(ABORT,'forced copy failure'); END;",
    );
    assert.throws(
      () => store.copyBudgets(a, "2030-05", "2030-03"),
      /forced copy failure/,
    );
    assert.equal(
      (
        store.db
          .prepare(
            "SELECT count(*) n FROM budgets WHERE user_id=? AND month='2030-05'",
          )
          .get(a) as { n: number }
      ).n,
      0,
    );
    assert.throws(
      () => store.copyBudgets(a, "2030-06", "2030-02"),
      /no budget limits/,
    );
  } finally {
    store.close();
  }
});
test("the previous month crosses years and keeps the supported lower date boundary", () => {
  assert.equal(previousMonth("2030-01"), "2029-12");
  assert.equal(previousMonth("2030-03"), "2030-02");
  assert.throws(() => previousMonth("2000-01"));
});
