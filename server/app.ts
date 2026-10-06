import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { z } from "zod";
import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Store } from "./store.js";
import {
  AppError,
  moneyToCents,
  decimal,
  validDate,
  month,
  csvCell,
  expenseCategories,
  incomeCategories,
  allCategories,
} from "./domain.js";
const derive = promisify(scrypt);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(password, salt, 64)) as Buffer;
  return salt + ":" + key.toString("hex");
}
export async function verifyPassword(password: string, hash: string) {
  const [salt, hex] = hash.split(":");
  const actual = (await derive(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(128),
});
const transaction = z
  .object({
    type: z.enum(["income", "expense"]),
    category: z.string(),
    amount: z.string(),
    date: z
      .string()
      .refine(validDate, "Choose a real date between 2000 and 2099."),
    note: z.string().trim().max(300).default(""),
  })
  .strict();
declare global {
  namespace Express {
    interface Request {
      session?: { uid: number; csrf: string; hash: string };
    }
  }
}
export function createApp(
  store: Store,
  {
    origin = "http://127.0.0.1:5174",
    secure = false,
    staticDir = resolve("dist"),
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const attempts = new Map<string, { count: number; until: number }>();
  const rate = (req: Request, key: string, limit = 12) => {
    const now = Date.now();
    const id = sha((req.ip || "") + ":" + key);
    let r = attempts.get(id);
    if (!r || r.until < now) {
      r = { count: 0, until: now + 15 * 60 * 1000 };
      attempts.set(id, r);
    }
    if (++r.count > limit)
      throw new AppError(429, "Too many attempts. Try again in 15 minutes.");
    if (attempts.size > 10000)
      for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  };
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("origin") && req.get("origin") !== origin)
        return next(
          new AppError(403, "This request came from a different origin."),
        );
      if (!req.is("application/json"))
        return next(new AppError(415, "Use application/json for changes."));
    }
    const raw = req.headers.cookie
      ?.split(";")
      .find((c) => c.trim().startsWith("pl_session="))
      ?.trim()
      .slice(11);
    if (raw && /^[a-f0-9]{64}$/.test(raw)) {
      const hash = sha(raw);
      const s = store.db
        .prepare(
          "SELECT user_id uid,csrf FROM sessions WHERE token_hash=? AND expires_at>?",
        )
        .get(hash, Date.now()) as { uid: number; csrf: string } | undefined;
      if (s) req.session = { ...s, hash };
    }
    next();
  });
  const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.session)
      return next(new AppError(401, "Sign in to your workspace."));
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.get("x-csrf-token") !== req.session.csrf
    )
      return next(
        new AppError(
          403,
          "Your session changed. Reload the page and try again.",
        ),
      );
    next();
  };
  const session = (uid: number, res: Response) => {
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(24).toString("hex");
    store.db.prepare("DELETE FROM sessions WHERE expires_at<?").run(Date.now());
    store.db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(sha(token), uid, csrf, Date.now() + 7 * 86400000);
    res.cookie("pl_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure,
      maxAge: 7 * 86400000,
      path: "/",
    });
    return { user: store.user(uid), csrf };
  };
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/auth/me", (req, res) =>
    res.json(
      req.session
        ? { user: store.user(req.session.uid), csrf: req.session.csrf }
        : { user: null, csrf: "" },
    ),
  );
  app.post("/api/auth/signup", async (req, res) => {
    rate(req, "signup", 5);
    const d = credentials
      .extend({ name: z.string().trim().min(2).max(60) })
      .strict()
      .parse(req.body);
    if (store.db.prepare("SELECT id FROM users WHERE email=?").get(d.email))
      throw new AppError(409, "An account with that email already exists.");
    const hash = await hashPassword(d.password);
    let uid: number;
    try {
      uid = Number(
        store.db
          .prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)")
          .run(d.name, d.email, hash).lastInsertRowid,
      );
    } catch (e) {
      if (store.db.prepare("SELECT id FROM users WHERE email=?").get(d.email))
        throw new AppError(409, "An account with that email already exists.");
      throw e;
    }
    res.status(201).json(session(uid, res));
  });
  app.post("/api/auth/login", async (req, res) => {
    rate(req, "login");
    const d = credentials.parse(req.body);
    const row = store.db
      .prepare("SELECT id,password_hash FROM users WHERE email=?")
      .get(d.email) as { id: number; password_hash: string } | undefined;
    const fallback =
      "00000000000000000000000000000000:" + Buffer.alloc(64).toString("hex");
    if (
      !(await verifyPassword(d.password, row?.password_hash || fallback)) ||
      !row
    )
      throw new AppError(401, "Email or password is incorrect.");
    if (req.session)
      store.db
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(req.session.hash);
    res.json(session(row.id, res));
  });
  app.post("/api/auth/demo", async (req, res) => {
    rate(req, "demo", 5);
    const name = "Alex Student",
      email = "demo-" + randomBytes(16).toString("hex") + "@example.invalid",
      hash = await hashPassword(randomBytes(32).toString("hex"));
    const row = store.db
      .prepare(
        "INSERT INTO users(name,email,password_hash,is_demo) VALUES(?,?,?,1)",
      )
      .run(name, email, hash);
    const uid = Number(row.lastInsertRowid);
    store.demo(uid, new Date().toISOString().slice(0, 7));
    res.status(201).json(session(uid, res));
  });
  app.post("/api/auth/logout", requireAuth, (req, res) => {
    store.db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(req.session!.hash);
    res.clearCookie("pl_session", {
      httpOnly: true,
      sameSite: "strict",
      secure,
      path: "/",
    });
    res.json({ ok: true });
  });
  app.get("/api/overview", requireAuth, (req, res) =>
    res.json(store.overview(req.session!.uid, month(req.query.month))),
  );
  app.get("/api/transactions", requireAuth, (req, res) => {
    const m = month(req.query.month);
    const category =
      typeof req.query.category === "string" ? req.query.category : "";
    if (
      category &&
      !allCategories.includes(category as (typeof allCategories)[number])
    )
      throw new AppError(400, "Choose a valid category.");
    const entries = store.entries(req.session!.uid, m, category);
    res.json({ entries: entries.slice(0, 500), total: entries.length });
  });
  const entryData = (body: unknown) => {
    const d = transaction.parse(body);
    if (
      !(d.type === "income" ? incomeCategories : expenseCategories).includes(
        d.category as never,
      )
    )
      throw new AppError(400, "Choose a category that matches the entry type.");
    return { ...d, cents: moneyToCents(d.amount) };
  };
  app.post("/api/transactions", requireAuth, (req, res) => {
    const uid = req.session!.uid;
    const count = store.db
      .prepare("SELECT COUNT(*) n FROM transactions WHERE user_id=?")
      .get(uid) as { n: number };
    if (count.n >= 10000)
      throw new AppError(
        409,
        "This workspace has reached its 10,000-entry limit.",
      );
    const d = entryData(req.body);
    const row = store.db
      .prepare(
        "INSERT INTO transactions(user_id,type,category,amount_cents,date,note) VALUES(?,?,?,?,?,?)",
      )
      .run(uid, d.type, d.category, d.cents, d.date, d.note);
    res.status(201).json(store.owned(uid, Number(row.lastInsertRowid)));
  });
  const id = (value: string) => {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw new AppError(400, "Invalid entry ID.");
    return Number(value);
  };
  app.put("/api/transactions/:id", requireAuth, (req, res) => {
    const uid = req.session!.uid,
      entryId = id(String(req.params.id));
    store.owned(uid, entryId);
    const d = entryData(req.body);
    store.db
      .prepare(
        "UPDATE transactions SET type=?,category=?,amount_cents=?,date=?,note=? WHERE user_id=? AND id=?",
      )
      .run(d.type, d.category, d.cents, d.date, d.note, uid, entryId);
    res.json(store.owned(uid, entryId));
  });
  app.delete("/api/transactions/:id", requireAuth, (req, res) => {
    const uid = req.session!.uid,
      entryId = id(String(req.params.id));
    store.owned(uid, entryId);
    store.db
      .prepare("DELETE FROM transactions WHERE user_id=? AND id=?")
      .run(uid, entryId);
    res.json({ ok: true });
  });
  app.put("/api/budgets", requireAuth, (req, res) => {
    const d = z
      .object({
        month: z.string(),
        category: z.enum(expenseCategories),
        amount: z.string(),
      })
      .strict()
      .parse(req.body);
    const m = month(d.month),
      cents = moneyToCents(d.amount);
    store.db
      .prepare(
        "INSERT INTO budgets VALUES(?,?,?,?) ON CONFLICT(user_id,month,category) DO UPDATE SET limit_cents=excluded.limit_cents",
      )
      .run(req.session!.uid, m, d.category, cents);
    res.json({ ok: true });
  });
  app.delete("/api/budgets/:category", requireAuth, (req, res) => {
    const m = month(req.query.month),
      category = String(req.params.category);
    if (!expenseCategories.includes(category as never))
      throw new AppError(400, "Invalid budget category.");
    store.db
      .prepare("DELETE FROM budgets WHERE user_id=? AND month=? AND category=?")
      .run(req.session!.uid, m, category);
    res.json({ ok: true });
  });
  app.post("/api/demo", requireAuth, (req, res) => {
    store.demo(req.session!.uid, month(req.body.month));
    res.status(201).json({ ok: true });
  });
  app.get("/api/export.csv", requireAuth, (req, res) => {
    const m = month(req.query.month),
      category =
        typeof req.query.category === "string" ? req.query.category : "";
    if (category && !allCategories.includes(category as never))
      throw new AppError(400, "Invalid category.");
    const rows = store.entries(req.session!.uid, m, category);
    const csv = [
      ["Date", "Type", "Category", "Amount (USD)", "Note"],
      ...rows.map((e) => [
        e.date,
        e.type,
        e.category,
        decimal(e.amountCents),
        e.note,
      ]),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.attachment("pocketledger-" + m + ".csv");
    res.send("\uFEFF" + csv);
  });
  app.use("/api", (_req, _res, next) =>
    next(new AppError(404, "API route not found.")),
  );
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve(staticDir, "index.html")),
    );
  }
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        error.type === "entity.too.large"
      )
        return res.status(413).json({
          error: "Request is too large. Keep notes under 300 characters.",
        });
      if (error instanceof z.ZodError)
        return res
          .status(400)
          .json({ error: error.issues[0]?.message || "Check your inputs." });
      if (error instanceof AppError)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof SyntaxError)
        return res.status(400).json({ error: "Request body is invalid JSON." });
      console.error(
        "Request failed:",
        error instanceof Error ? error.name : "Unknown error",
      );
      res
        .status(500)
        .json({ error: "Something went wrong. Please try again." });
    },
  );
  return app;
}
