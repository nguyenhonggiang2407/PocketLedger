import React, { useState, useEffect, useRef, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
type User = { id: number; name: string; email: string; isDemo: number };
type Entry = {
  id: number;
  type: "income" | "expense";
  category: string;
  amountCents: number;
  date: string;
  note: string;
};
type Budget = {
  category: string;
  limitCents: number | null;
  spentCents: number;
};
type Overview = {
  summary: {
    incomeCents: number;
    expenseCents: number;
    netCents: number;
    balanceCents: number;
    count: number;
  };
  budgets: Budget[];
  trend: { month: string; incomeCents: number; expenseCents: number }[];
};
const expenses = [
    "Food",
    "Housing",
    "Transport",
    "Study",
    "Health",
    "Leisure",
    "Other",
  ],
  incomes = ["Allowance", "Work", "Other income"];
const icons: Record<string, string> = {
  Food: "◒",
  Housing: "⌂",
  Transport: "↗",
  Study: "▤",
  Health: "+",
  Leisure: "✦",
  Other: "⋯",
  Allowance: "↓",
  Work: "▣",
  "Other income": "↙",
};
const money = (c: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(c / 100),
  dateLabel = (date: string) =>
    new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
  today = () => {
    const date = new Date();
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  },
  monthLabel = (m: string) =>
    new Date(m + "-02T12:00:00Z").toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
let csrf = "";
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch("/api" + path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      ...options.headers,
    },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error("The server could not respond. Please try again.");
  }
  if (!response.ok)
    throw new ApiError(response.status, data.error || "Please try again.");
  return data;
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    transactions: <path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />,
    budgets: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <path d="m12 12 7-7" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    edit: <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    logout: <path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4" />,
    down: <path d="M12 4v16m-6-6 6 6 6-6" />,
    up: <path d="M12 20V4m-6 6 6-6 6 6" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  };
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name] || paths.overview}
    </svg>
  );
}
const Logo = () => (
  <span className="logo">
    <img
      className="logo-mark"
      src="/pocketledger.svg"
      width="40"
      height="40"
      alt=""
      aria-hidden="true"
    />
    <span className="logo-word">
      PocketLedger<span className="logo-period">.</span>
    </span>
  </span>
);
function App() {
  const [user, setUser] = useState<User | null>(null),
    [boot, setBoot] = useState(true),
    [error, setError] = useState(""),
    [authMode, setAuthMode] = useState<"login" | "signup">("login"),
    [busy, setBusy] = useState(false);
  const [month, setMonth] = useState(today().slice(0, 7)),
    [category, setCategory] = useState(""),
    [tab, setTab] = useState("Overview"),
    [overview, setOverview] = useState<Overview | null>(null),
    [entries, setEntries] = useState<Entry[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Partial<Entry> | null>(null),
    [budgetEdit, setBudgetEdit] = useState<Budget | null>(null),
    [notice, setNotice] = useState(""),
    [confirmDelete, setConfirmDelete] = useState<Entry | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const dialogKind = editor
    ? "entry"
    : budgetEdit
      ? "budget"
      : confirmDelete
        ? "delete"
        : "";
  async function who() {
    setBoot(true);
    try {
      const data = await api<{ user: User | null; csrf: string }>("/auth/me");
      csrf = data.csrf;
      setUser(data.user);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBoot(false);
    }
  }
  useEffect(() => {
    who();
  }, []);
  useEffect(() => {
    if (!user) return;
    let current = true;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    // Avoid displaying one month's amounts under a newly selected month.
    setOverview(null);
    setEntries([]);
    setTotal(0);
    Promise.all([
      api<Overview>("/overview?month=" + month, { signal: abort.signal }),
      api<{ entries: Entry[]; total: number }>(
        "/transactions?month=" +
          month +
          "&category=" +
          encodeURIComponent(category),
        { signal: abort.signal },
      ),
    ])
      .then(([o, t]) => {
        if (current) {
          setOverview(o);
          setEntries(t.entries);
          setTotal(t.total);
        }
      })
      .catch((e) => {
        if (current && e.name !== "AbortError") {
          if (e instanceof ApiError && e.status === 401) {
            csrf = "";
            setUser(null);
            setEditor(null);
            setBudgetEdit(null);
            setConfirmDelete(null);
          }
          setError(e.message);
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      abort.abort();
    };
  }, [user, month, category, revision]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!dialogKind) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) {
        setEditor(null);
        setBudgetEdit(null);
        setConfirmDelete(null);
      }
    };
    window.addEventListener("keydown", escape);
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const background = Array.from(
      document.querySelectorAll<HTMLElement>(".workspace > .sidebar, .workspace > .main"),
    );
    const previousInert = background.map((element) => element.inert);
    background.forEach((element) => {
      element.inert = true;
    });
    document.body.style.overflow = "hidden";
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    const controls = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ) || [],
      );
    (
      modal?.querySelector<HTMLElement>('input[name="amount"]') || controls()[0]
    )?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = controls(),
        first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("keydown", trap);
      background.forEach((element, index) => {
        element.inert = previousInert[index];
      });
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [dialogKind]);
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const data = {
      email: form.get("email"),
      password: form.get("password"),
      ...(authMode === "signup" ? { name: form.get("name") } : {}),
    };
    try {
      const result = await api<{ user: User; csrf: string }>(
        "/auth/" + authMode,
        { method: "POST", body: JSON.stringify(data) },
      );
      csrf = result.csrf;
      setUser(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function demo() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: User; csrf: string }>("/auth/demo", {
        method: "POST",
        body: JSON.stringify({ month }),
      });
      csrf = result.csrf;
      setUser(result.user);
      setNotice(
        "Your private demo is ready. All sample entries are fictional.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      try {
        await api("/auth/logout", { method: "POST", body: "{}" });
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) throw e;
      }
      csrf = "";
      setUser(null);
      setOverview(null);
      setEntries([]);
      setEditor(null);
      setBudgetEdit(null);
      setConfirmDelete(null);
      setNotice("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await api("/transactions" + (editor.id ? "/" + editor.id : ""), {
        method: editor.id ? "PUT" : "POST",
        body: JSON.stringify({
          type: form.get("type"),
          category: form.get("category"),
          amount: form.get("amount"),
          date: form.get("date"),
          note: form.get("note"),
        }),
      });
      setEditor(null);
      setRevision((x) => x + 1);
      setNotice(editor.id ? "Entry updated." : "Entry added to your ledger.");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await api("/budgets", {
        method: "PUT",
        body: JSON.stringify({
          month,
          category: budgetEdit!.category,
          amount: form.get("amount"),
        }),
      });
      setBudgetEdit(null);
      setRevision((x) => x + 1);
      setNotice("Monthly budget saved.");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeEntry() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api("/transactions/" + confirmDelete.id, {
        method: "DELETE",
        body: "{}",
      });
      setConfirmDelete(null);
      setRevision((x) => x + 1);
      setNotice("Entry deleted.");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (boot)
    return (
      <div className="boot">
        <Logo />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!user)
    return (
      <main className="welcome">
        <section className="welcome-story">
          <Logo />
          <div className="welcome-copy">
            <span className="eyebrow">
              FOR STUDENT LIFE, AND EVERYTHING IN BETWEEN
            </span>
            <h1>
              A little clarity.
              <br />A lot more
              <br />
              <em>breathing room.</em>
            </h1>
            <p>
              See where your money goes, make a plan for the month, and keep
              everyday spending in perspective.
            </p>
            <div className="preview">
              <div>
                <span>YOUR MONTH, AT A GLANCE</span>
                <b>Room for what matters.</b>
              </div>
              <div className="preview-bar">
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="preview-tags">
                <span>↗ Track everyday</span>
                <span>◒ Plan your categories</span>
                <span>✓ Keep it private</span>
              </div>
            </div>
          </div>
          <small>
            Built for learning. No bank connections or financial advice.
          </small>
        </section>
        <section className="welcome-auth">
          <div className="auth-card">
            <span className="eyebrow">YOUR OWN PRIVATE LEDGER</span>
            <h2>
              {authMode === "login"
                ? "Welcome back."
                : "Start with a clean page."}
            </h2>
            <p>
              {authMode === "login"
                ? "A calmer view of your student budget."
                : "Create your account. Your workspace starts empty."}
            </p>
            {error && (
              <div className="alert" role="alert">
                {error}
                <button onClick={who} type="button">
                  Retry connection
                </button>
              </div>
            )}
            <div className="auth-tabs">
              <button
                className={authMode === "login" ? "active" : ""}
                aria-pressed={authMode === "login"}
                disabled={busy}
                onClick={() => {
                  setAuthMode("login");
                  setError("");
                }}
              >
                Sign in
              </button>
              <button
                className={authMode === "signup" ? "active" : ""}
                aria-pressed={authMode === "signup"}
                disabled={busy}
                onClick={() => {
                  setAuthMode("signup");
                  setError("");
                }}
              >
                Create account
              </button>
            </div>
            <form onSubmit={authenticate}>
              {authMode === "signup" && (
                <label>
                  Your name
                  <input
                    name="name"
                    autoComplete="name"
                    minLength={2}
                    maxLength={60}
                    required
                    placeholder="How should we call you?"
                  />
                </label>
              )}
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  placeholder="you@example.com"
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    authMode === "signup" ? "new-password" : "current-password"
                  }
                  minLength={10}
                  maxLength={128}
                  required
                  placeholder="At least 10 characters"
                />
              </label>
              <button className="primary full" disabled={busy}>
                {busy
                  ? "Just a moment…"
                  : authMode === "login"
                    ? "Open my ledger →"
                    : "Create my workspace →"}
              </button>
            </form>
            <div className="or">
              <span>or take a look around</span>
            </div>
            <button className="secondary full" disabled={busy} onClick={demo}>
              Explore a private demo <span>↗</span>
            </button>
            <p className="fine">
              Fictional USD entries. A separate workspace is created for you; no
              shared demo account.
            </p>
          </div>
          <small>POCKETLEDGER · A STUDENT PROJECT</small>
        </section>
      </main>
    );
  const summary = overview?.summary,
    allocated =
      overview?.budgets.reduce((n, b) => n + (b.limitCents || 0), 0) || 0,
    plannedSpent =
      overview?.budgets
        .filter((b) => b.limitCents !== null)
        .reduce((n, b) => n + b.spentCents, 0) || 0;
  const budgets = overview?.budgets || [],
    plannedCategories = budgets.filter((b) => b.limitCents !== null),
    overLimitCategories = plannedCategories.filter(
      (b) => b.spentCents > b.limitCents!,
    ),
    spending = budgets.filter((b) => b.spentCents > 0),
    maxTrend = Math.max(
      1,
      ...(overview?.trend || []).flatMap((t) => [
        t.incomeCents,
        t.expenseCents,
      ]),
    );
  return (
    <div className="workspace">
      <a className="skip" href="#content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Logo />
        <span className="side-label">WORKSPACE</span>
        <nav aria-label="Workspace">
          {[
            ["Overview", "overview"],
            ["Transactions", "transactions"],
            ["Budgets", "budgets"],
          ].map(([label, icon]) => (
            <button
              key={label}
              className={tab === label ? "selected" : ""}
              aria-current={tab === label ? "page" : undefined}
              aria-label={label}
              onClick={() => setTab(label)}
            >
              <Icon name={icon} />
              <span className="nav-label">{label}</span>
              {tab === label && <i />}
            </button>
          ))}
        </nav>
        <div className="side-note">
          <span>✦</span>
          <h3>
            Small habits.
            <br />
            Clearer picture.
          </h3>
          <p>Your ledger is a record of life, not a score to judge it by.</p>
        </div>
        <div className="side-user">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <b>{user.name}</b>
            <small>
              {user.isDemo ? "Fictional demo" : "Personal workspace"}
            </small>
          </div>
          <button
            onClick={logout}
            disabled={busy}
            aria-label="Sign out"
            title="Sign out"
          >
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span>
            <span className="status-dot" aria-hidden="true" /> Your private workspace
          </span>
          <span>
            USD <span className="top-separator">/</span>{" "}
            {user.isDemo ? "DEMO MODE" : "PERSONAL LEDGER"}
          </span>
        </header>
        <main id="content" tabIndex={-1} aria-busy={loading}>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {tab} <span aria-hidden="true">/</span> {monthLabel(month)}
              </span>
              <h1>
                {tab === "Overview"
                  ? "Your month, in focus."
                  : tab === "Transactions"
                    ? "The everyday details."
                    : "A plan with room to live."}
              </h1>
              <p>
                {tab === "Overview"
                  ? "A simple snapshot of your income, spending, and what’s left."
                  : tab === "Transactions"
                    ? "Record the little things. The bigger picture follows."
                    : "Set category limits for the month and follow your progress."}
              </p>
            </div>
            <div className="heading-actions">
              <label className="month-control">
                <span>Selected month</span>
                <input
                  type="month"
                  value={month}
                  min="2000-01"
                  max="2099-12"
                  onChange={(e) => {
                    if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.target.value))
                      setMonth(e.target.value);
                  }}
                />
              </label>
              <button
                className="primary"
                onClick={() => {
                  setError("");
                  setEditor({
                    type: "expense",
                    category: "Food",
                    date: today(),
                    note: "",
                  });
                }}
              >
                <Icon name="plus" /> Add entry
              </button>
            </div>
          </div>
          {user.isDemo && (
            <div className="demo-banner">
              <b>✦ A space to explore</b>
              <span>
                Every sample entry is fictional. Changes stay in your own demo
                workspace.
              </span>
            </div>
          )}
          {error && (
            <div className="alert" role="alert">
              {error}
              <button onClick={() => setRevision((x) => x + 1)}>
                Try again
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              ✓ {notice}
            </div>
          )}
          {loading && (
            <p className="loading" role="status">
              Updating your month…
            </p>
          )}
          {tab === "Overview" && (
            <>
              <div className="stat-grid">
                <section className="stat balance">
                  <div>
                    <span>ALL-TIME BALANCE</span>
                    <span aria-hidden="true">↗</span>
                  </div>
                  <strong>{summary ? money(summary.balanceCents) : "—"}</strong>
                  <p>Income minus expenses, across your ledger</p>
                  <div className="balance-decoration" aria-hidden="true">
                    ◒
                  </div>
                </section>
                <section className="stat">
                  <div>
                    <span>MONTHLY INCOME</span>
                    <span className="stat-symbol green">
                      <Icon name="down" />
                    </span>
                  </div>
                  <strong>{summary ? money(summary.incomeCents) : "—"}</strong>
                  <p>Money coming in · {monthLabel(month)}</p>
                </section>
                <section className="stat">
                  <div>
                    <span>MONTHLY SPENDING</span>
                    <span className="stat-symbol orange">
                      <Icon name="up" />
                    </span>
                  </div>
                  <strong>{summary ? money(summary.expenseCents) : "—"}</strong>
                  <p>
                    {summary
                      ? summary.count + " entries this month · income included"
                      : "Waiting for monthly totals"}
                  </p>
                </section>
                <section
                  className={"stat difference " + ((summary?.netCents || 0) < 0 ? "is-negative" : "")}
                >
                  <div>
                    <span>MONTHLY DIFFERENCE</span>
                    <span className="stat-symbol"><Icon name="transactions" /></span>
                  </div>
                  <strong>{summary ? money(summary.netCents) : "—"}</strong>
                  <p>Income minus spending · this month</p>
                </section>
              </div>
              {overview && (
                <section className="plan-summary" aria-label="Monthly category plan">
                  <span className="plan-symbol"><Icon name="budgets" /></span>
                  <div>
                    <b>
                      {plannedCategories.length
                        ? `${plannedCategories.length} of ${budgets.length} categories have a limit`
                        : "Give your month a little structure"}
                    </b>
                    <p>
                      {overLimitCategories.length
                        ? `${overLimitCategories.length} ${overLimitCategories.length === 1 ? "category is" : "categories are"} over the limit you set.`
                        : plannedCategories.length
                          ? `${money(plannedSpent)} spent in planned categories · ${money(allocated)} allocated.`
                          : "Set your own category limits to compare your spending."}
                    </p>
                  </div>
                  <button className="text-button" onClick={() => setTab("Budgets")}>
                    Review budgets <Icon name="arrow" />
                  </button>
                </section>
              )}
              <div className="overview-grid">
                <section className="panel trend">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">A LITTLE PERSPECTIVE</span>
                      <h2>Income & spending</h2>
                    </div>
                    <span className="pill">Last 6 months</span>
                  </div>
                  <div className="legend">
                    <span>
                      <i className="income-dot" /> Income
                    </span>
                    <span>
                      <i className="expense-dot" /> Spending
                    </span>
                  </div>
                  <div
                    className="chart"
                    role="img"
                    aria-label={
                      "Income and spending for six months. " +
                      (overview?.trend
                        .map(
                          (t) =>
                            `${monthLabel(t.month)}: income ${money(t.incomeCents)}, spending ${money(t.expenseCents)}`,
                        )
                        .join(". ") || "Waiting for monthly totals.")
                    }
                  >
                    {overview?.trend.map((t) => (
                      <div className="chart-month" key={t.month}>
                        <div className="chart-bars">
                          <div
                            className="income-bar"
                            style={{
                              height: (t.incomeCents / maxTrend) * 100 + "%",
                            }}
                            title={"Income " + money(t.incomeCents)}
                          />
                          <div
                            className="expense-bar"
                            style={{
                              height: (t.expenseCents / maxTrend) * 100 + "%",
                            }}
                            title={"Spending " + money(t.expenseCents)}
                          />
                        </div>
                        <span>
                          {new Date(t.month + "-02").toLocaleDateString(
                            "en-US",
                            { month: "short", timeZone: "UTC" },
                          )}
                        </span>
                        <span className="sr-only">
                          {t.month}: income {money(t.incomeCents)}, spending{" "}
                          {money(t.expenseCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="chart-bottom">
                    <span>This month’s difference</span>
                    <b
                      className={(summary?.netCents || 0) < 0 ? "negative" : ""}
                    >
                      {summary ? money(summary.netCents) : "—"}
                    </b>
                  </div>
                </section>
                <section className="panel spending">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">WHERE IT GOES</span>
                      <h2>Spending breakdown</h2>
                    </div>
                  </div>
                  {spending.length ? (
                    <>
                      <div className="spending-total">
                        <small>TOTAL THIS MONTH</small>
                        <strong>{money(summary?.expenseCents || 0)}</strong>
                      </div>
                      <div className="segment-bar">
                        {spending.map((b, i) => (
                          <i
                            key={b.category}
                            className={"color-" + (i % 7)}
                            style={{
                              width:
                                (b.spentCents / (summary?.expenseCents || 1)) *
                                  100 +
                                "%",
                            }}
                            title={b.category + " " + money(b.spentCents)}
                          />
                        ))}
                      </div>
                      <div className="breakdown">
                        {spending.map((b, i) => (
                          <div key={b.category}>
                            <span>
                              <i className={"color-" + (i % 7)} />
                              {b.category}
                            </span>
                            <b>{money(b.spentCents)}</b>
                            <small>
                              {Math.round(
                                (b.spentCents / (summary?.expenseCents || 1)) *
                                  100,
                              )}
                              %
                            </small>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="empty">
                      <span>◒</span>
                      <h3>
                        {loading ? "Updating your month…" : !overview ? "Spending is unavailable." : "A clean slate."}
                      </h3>
                      <p>
                        {loading ? "Your category totals will appear here." : !overview ? "Try again to load this month’s totals." : "Add an expense to see your month take shape."}
                      </p>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
          {tab !== "Budgets" && (
            <section className="panel transactions">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">YOUR EVERYDAY LEDGER</span>
                  <h2>
                    {tab === "Overview"
                      ? "Recent transactions"
                      : "Transactions"}{" "}
                    <span className="count">{total}</span>
                  </h2>
                </div>
                <div className="table-actions">
                  <label>
                    <span className="sr-only">
                      Filter transactions by category
                    </span>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="">All categories</option>
                      {[...expenses, ...incomes].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <a
                    className="secondary"
                    href={
                      "/api/export.csv?month=" +
                      month +
                      "&category=" +
                      encodeURIComponent(category)
                    }
                  >
                    <Icon name="down" /> Export CSV
                  </a>
                </div>
              </div>
              <p className="table-note">
                {monthLabel(month)}
                {category ? " · " + category : ""} · Summary and budgets include
                all categories.{" "}
                {total > 500
                  ? "Only the latest 500 entries are shown; export includes all matches."
                  : ""}
              </p>
              {entries.length ? (
                <div className="table-scroll">
                  <table>
                    <caption className="sr-only">
                      {monthLabel(month)} transactions{category ? `, ${category}` : ""}.{" "}
                      {tab === "Overview" ? "Latest seven matching entries." : "Latest matching entries."}
                    </caption>
                    <thead>
                      <tr>
                        <th>Transaction</th>
                        <th>Category</th>
                        <th>Date</th>
                        <th className="amount-column">Amount</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(tab === "Overview" ? entries.slice(0, 7) : entries).map(
                        (e) => (
                          <tr key={e.id}>
                            <td>
                              <div className="entry-title">
                                <span
                                  aria-hidden="true"
                                  className={
                                    "category-icon " +
                                    (e.type === "income" ? "income" : "")
                                  }
                                >
                                  {icons[e.category] || "◒"}
                                </span>
                                <div>
                                  <b>{e.note || e.category}</b>
                                  <small>
                                    {e.type === "income"
                                      ? "Money in"
                                      : "Money out"}
                                    <span className="mobile-entry-meta">
                                      {" "}· {e.category} · {dateLabel(e.date)}
                                    </span>
                                  </small>
                                </div>
                              </div>
                            </td>
                            <td className="category-column">
                              <span className="category-tag">{e.category}</span>
                            </td>
                            <td className="date-column">
                              {dateLabel(e.date)}
                            </td>
                            <td
                              className={
                                "amount-column " +
                                (e.type === "income" ? "positive" : "")
                              }
                            >
                              {e.type === "income" ? "+" : "−"}
                              {money(e.amountCents)}
                            </td>
                            <td>
                              <div className="entry-actions">
                                <button
                                  aria-label={"Edit " + (e.note || e.category)}
                                  onClick={() => {
                                    setError("");
                                    setEditor(e);
                                  }}
                                >
                                  <Icon name="edit" />
                                </button>
                                <button
                                  aria-label={
                                    "Delete " + (e.note || e.category)
                                  }
                                  onClick={() => {
                                    setError("");
                                    setConfirmDelete(e);
                                  }}
                                >
                                  <Icon name="close" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">
                  <span>▤</span>
                  <h3>
                    {loading
                      ? "Loading your ledger…"
                      : !overview
                        ? "This month could not load."
                        : category
                          ? "No entries in this category."
                          : "Your story starts here."}
                  </h3>
                  <p>
                    {loading
                      ? "Your private workspace is being updated."
                      : !overview
                        ? "Try again to load your entries and totals."
                        : category
                          ? "Try another category or add your next entry."
                          : "Add your first entry, or explore fictional sample data."}
                  </p>
                  {!loading &&
                    !category &&
                    overview &&
                    !overview.summary.count && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await api("/demo", {
                              method: "POST",
                              body: JSON.stringify({ month }),
                            });
                            setRevision((x) => x + 1);
                            setNotice("Fictional sample data added.");
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Load fictional sample data
                      </button>
                    )}
                </div>
              )}
              {tab === "Overview" && entries.length > 7 && (
                <button
                  className="text-button view-all"
                  onClick={() => setTab("Transactions")}
                >
                  View all transactions →
                </button>
              )}
            </section>
          )}
          {tab === "Budgets" && (
            <>
              <div className="budget-intro">
                <div>
                  <span className="eyebrow">{monthLabel(month)}</span>
                  <h2>
                    Make a little plan.
                    <br />
                    Leave a little room.
                  </h2>
                  <p>
                    Budgets are monthly category limits you choose. Unbudgeted
                    spending is still included in your ledger.
                  </p>
                </div>
                <div>
                  <small>PLANNED CATEGORIES</small>
                  <strong>{overview ? money(allocated) : "—"}</strong>
                  <span>
                    {overview
                      ? money(plannedSpent) + " spent in those categories"
                      : "Waiting for monthly budgets"}
                  </span>
                </div>
              </div>
              <div className="budget-grid">
                {budgets.map((b) => {
                  const pct = b.limitCents
                      ? Math.round((b.spentCents / b.limitCents) * 100)
                      : 0,
                    remaining = (b.limitCents || 0) - b.spentCents;
                  return (
                    <section
                      className={"panel budget-card " + (b.limitCents === null ? "unplanned" : remaining < 0 ? "over-limit" : "planned")}
                      key={b.category}
                    >
                      <div>
                        <span className="category-icon" aria-hidden="true">
                          {icons[b.category]}
                        </span>
                        <h3>{b.category}</h3>
                        <button
                          className="text-button"
                          aria-label={(b.limitCents ? "Edit " : "Set ") + b.category + " monthly limit"}
                          onClick={() => {
                            setError("");
                            setBudgetEdit(b);
                          }}
                        >
                          {b.limitCents ? "Edit" : "Set limit"}
                        </button>
                      </div>
                      <span className="budget-state">
                        {b.limitCents === null ? "No limit set" : remaining < 0 ? "Over your limit" : remaining === 0 ? "At your limit" : "Within your limit"}
                      </span>
                      <p>
                        <strong>{money(b.spentCents)}</strong>
                        <span>
                          {b.limitCents
                            ? " of " + money(b.limitCents)
                            : " spent · no limit set"}
                        </span>
                      </p>
                      <div
                        className={
                          "budget-progress " + (pct > 100 ? "over" : "")
                        }
                        role="progressbar"
                        aria-label={b.category + " budget used"}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.min(pct, 100)}
                        aria-valuetext={
                          b.limitCents
                            ? `${pct}% used; ${money(b.spentCents)} of ${money(b.limitCents)}`
                            : "No budget limit set"
                        }
                      >
                        <i style={{ width: Math.min(pct, 100) + "%" }} />
                      </div>
                      <footer>
                        <span>
                          {b.limitCents
                            ? remaining < 0
                              ? money(-remaining) + " over limit"
                              : money(remaining) + " remaining"
                            : "Choose a limit to track progress"}
                        </span>
                        <b>{b.limitCents ? pct + "%" : "—"}</b>
                      </footer>
                      {b.limitCents && (
                        <button
                          className="remove-budget text-button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await api(
                                "/budgets/" +
                                  encodeURIComponent(b.category) +
                                  "?month=" +
                                  month,
                                { method: "DELETE", body: "{}" },
                              );
                              setRevision((x) => x + 1);
                              setNotice(
                                "Budget limit removed. Entries were kept.",
                              );
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Remove limit
                        </button>
                      )}
                    </section>
                  );
                })}
              </div>
            </>
          )}
          <footer className="app-footer">
            <Logo />
            <span>A little more clarity, one entry at a time.</span>
            <span>Single-currency ledger · USD</span>
          </footer>
        </main>
      </div>
      {editor && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="entry-title"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">THE EVERYDAY DETAILS</span>
                <h2 id="entry-title">
                  {editor.id ? "Edit your entry" : "Add a new entry"}
                </h2>
              </div>
              <button
                disabled={busy}
                aria-label="Close entry form"
                onClick={() => setEditor(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={saveEntry}>
              <label>
                Type
                <select
                  name="type"
                  value={editor.type}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      type: e.target.value as "income" | "expense",
                      category:
                        e.target.value === "income" ? "Allowance" : "Food",
                    })
                  }
                >
                  <option value="expense">Expense · money out</option>
                  <option value="income">Income · money in</option>
                </select>
              </label>
              <div className="form-columns">
                <label>
                  Amount (USD)
                  <input
                    name="amount"
                    type="text"
                    inputMode="decimal"
                    pattern="(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?"
                    required
                    placeholder="0.00"
                    aria-describedby="entry-amount-help"
                    defaultValue={
                      editor.amountCents === undefined
                        ? ""
                        : (editor.amountCents / 100).toFixed(2)
                    }
                    key={editor.id || "new"}
                  />
                </label>
                <label>
                  Date
                  <input
                    name="date"
                    type="date"
                    min="2000-01-01"
                    max="2099-12-31"
                    required
                    defaultValue={editor.date}
                  />
                </label>
              </div>
              <label>
                Category
                <select
                  name="category"
                  value={editor.category}
                  onChange={(e) =>
                    setEditor({ ...editor, category: e.target.value })
                  }
                >
                  {(editor.type === "income" ? incomes : expenses).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Note <span className="optional">optional</span>
                <input
                  name="note"
                  maxLength={300}
                  defaultValue={editor.note}
                  placeholder="e.g. Lunch on campus"
                />
              </label>
              <p className="fine form-help" id="entry-amount-help">
                Enter a positive USD amount, such as 12.50. Use up to two decimal places.
                Your entry is saved only when you choose Save entry.
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setEditor(null)}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Saving…" : "Save entry"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {budgetEdit && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="budget-title"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">{monthLabel(month)}</span>
                <h2 id="budget-title">{budgetEdit.category} budget</h2>
              </div>
              <button
                disabled={busy}
                aria-label="Close budget form"
                onClick={() => setBudgetEdit(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={saveBudget}>
              <label>
                Monthly limit (USD)
                <input
                  name="amount"
                  inputMode="decimal"
                  required
                  placeholder="0.00"
                  aria-describedby="budget-amount-help"
                  defaultValue={
                    budgetEdit.limitCents === null
                      ? ""
                      : (budgetEdit.limitCents / 100).toFixed(2)
                  }
                />
              </label>
              <p className="fine form-help" id="budget-amount-help">
                Spent this month: {money(budgetEdit.spentCents)}. Setting a
                limit never changes your entries.
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setBudgetEdit(null)}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Saving…" : "Save monthly limit"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {confirmDelete && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <div className="modal-head">
              <h2 id="delete-title">Delete this entry?</h2>
              <button
                disabled={busy}
                aria-label="Cancel deletion"
                onClick={() => setConfirmDelete(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            <p>
              {confirmDelete.note || confirmDelete.category} ·{" "}
              {money(confirmDelete.amountCents)}
            </p>
            <p className="fine">
              This removes the entry from your ledger and updates your totals.
            </p>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setConfirmDelete(null)}
              >
                Keep entry
              </button>
              <button className="danger" disabled={busy} onClick={removeEntry}>
                {busy ? "Deleting…" : "Delete entry"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
