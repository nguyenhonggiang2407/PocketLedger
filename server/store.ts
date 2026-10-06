import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AppError, expenseCategories, type Entry } from "./domain.js";
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,is_demo INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,type TEXT NOT NULL CHECK(type IN ('income','expense')),category TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 999999999),date TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;
    CREATE INDEX IF NOT EXISTS tx_owner_date ON transactions(user_id,date);
    CREATE TABLE IF NOT EXISTS budgets(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,month TEXT NOT NULL,category TEXT NOT NULL,limit_cents INTEGER NOT NULL CHECK(limit_cents BETWEEN 1 AND 999999999),PRIMARY KEY(user_id,month,category)) STRICT; PRAGMA user_version=1;`);
  }
  close() {
    this.db.close();
  }
  atomic<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  user(id: number) {
    return this.db
      .prepare("SELECT id,name,email,is_demo isDemo FROM users WHERE id=?")
      .get(id);
  }
  entries(uid: number, selectedMonth: string, category = ""): Entry[] {
    return this.db
      .prepare(
        `SELECT id,type,category,amount_cents amountCents,date,note FROM transactions WHERE user_id=? AND substr(date,1,7)=? AND (?='' OR category=?) ORDER BY date DESC,id DESC`,
      )
      .all(uid, selectedMonth, category, category) as unknown as Entry[];
  }
  owned(uid: number, id: number): Entry {
    const e = this.db
      .prepare(
        "SELECT id,type,category,amount_cents amountCents,date,note FROM transactions WHERE user_id=? AND id=?",
      )
      .get(uid, id) as unknown as Entry | undefined;
    if (!e) throw new AppError(404, "Entry not found.");
    return e;
  }
  overview(uid: number, m: string) {
    const rows = this.entries(uid, m);
    const incomeCents = rows
        .filter((e) => e.type === "income")
        .reduce((n, e) => n + e.amountCents, 0),
      expenseCents = rows
        .filter((e) => e.type === "expense")
        .reduce((n, e) => n + e.amountCents, 0);
    const balance = this.db
      .prepare(
        "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount_cents ELSE -amount_cents END),0) amount FROM transactions WHERE user_id=?",
      )
      .get(uid) as { amount: number };
    const stored = this.db
      .prepare(
        "SELECT category,limit_cents limitCents FROM budgets WHERE user_id=? AND month=?",
      )
      .all(uid, m) as unknown as { category: string; limitCents: number }[];
    const budgets = expenseCategories.map((category) => ({
      category,
      limitCents:
        stored.find((b) => b.category === category)?.limitCents ?? null,
      spentCents: rows
        .filter((e) => e.type === "expense" && e.category === category)
        .reduce((n, e) => n + e.amountCents, 0),
    }));
    const trend = [];
    for (let offset = 5; offset >= 0; offset--) {
      const d = new Date(m + "-01T00:00:00Z");
      d.setUTCMonth(d.getUTCMonth() - offset);
      const key = d.toISOString().slice(0, 7);
      const totals = this.db
        .prepare(
          "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount_cents ELSE 0 END),0) incomeCents,COALESCE(SUM(CASE WHEN type='expense' THEN amount_cents ELSE 0 END),0) expenseCents FROM transactions WHERE user_id=? AND substr(date,1,7)=?",
        )
        .get(uid, key);
      trend.push({ month: key, ...totals });
    }
    return {
      summary: {
        incomeCents,
        expenseCents,
        netCents: incomeCents - expenseCents,
        balanceCents: balance.amount,
        count: rows.length,
      },
      budgets,
      trend,
    };
  }
  demo(uid: number, m: string) {
    this.atomic(() => {
      if (
        this.db
          .prepare("SELECT id FROM transactions WHERE user_id=? LIMIT 1")
          .get(uid) ||
        this.db
          .prepare("SELECT category FROM budgets WHERE user_id=? LIMIT 1")
          .get(uid)
      )
        throw new AppError(
          409,
          "Demo data is only available for an empty workspace.",
        );
      const add = this.db.prepare(
        "INSERT INTO transactions(user_id,type,category,amount_cents,date,note) VALUES(?,?,?,?,?,?)",
      );
      const items: [string, string, number, number, string][] = [
        ["income", "Allowance", 120000, 1, "Monthly support · fictional"],
        ["income", "Work", 28000, 5, "Campus library shift · fictional"],
        ["expense", "Housing", 52000, 2, "Shared apartment · fictional"],
        ["expense", "Food", 1245, 3, "Groceries · fictional"],
        ["expense", "Transport", 3500, 4, "Monthly student pass · fictional"],
        ["expense", "Study", 2400, 6, "Secondhand textbooks · fictional"],
        ["expense", "Food", 1860, 8, "Market groceries · fictional"],
        ["expense", "Leisure", 1200, 9, "Movie with friends · fictional"],
        ["expense", "Health", 1800, 10, "Pharmacy · fictional"],
        ["expense", "Food", 650, 11, "Lunch on campus · fictional"],
        ["expense", "Food", 2735, 12, "Weekly groceries · fictional"],
        ["expense", "Other", 850, 13, "Laundry · fictional"],
      ];
      for (const [type, category, cents, day, note] of items)
        add.run(
          uid,
          type,
          category,
          cents,
          `${m}-${String(day).padStart(2, "0")}`,
          note,
        );
      const budget = this.db.prepare(
        "INSERT INTO budgets(user_id,month,category,limit_cents) VALUES(?,?,?,?)",
      );
      for (const [category, limit] of [
        ["Food", 16000],
        ["Housing", 55000],
        ["Transport", 5000],
        ["Study", 8000],
        ["Leisure", 6000],
      ] as const)
        budget.run(uid, m, category, limit);
      const prior = new Date(m + "-01T00:00:00Z");
      prior.setUTCMonth(prior.getUTCMonth() - 1);
      const previous = prior.toISOString().slice(0, 7);
      add.run(
        uid,
        "income",
        "Allowance",
        130000,
        previous + "-01",
        "Previous month · fictional",
      );
      add.run(
        uid,
        "expense",
        "Housing",
        52000,
        previous + "-02",
        "Previous month · fictional",
      );
      add.run(
        uid,
        "expense",
        "Food",
        14200,
        previous + "-14",
        "Previous month · fictional",
      );
    });
  }
}
