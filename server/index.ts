import { Store } from "./store.js";
import { configuredDemoLogin, createApp, seedDemoLogin } from "./app.js";
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
const port = Number(process.env.PORT || 3002),
  host = process.env.HOST || "127.0.0.1",
  origin = process.env.APP_ORIGIN || "http://127.0.0.1:5174";
const secure =
  process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
if (process.env.NODE_ENV === "production" && !origin.startsWith("https://"))
  throw Error("Set APP_ORIGIN to your HTTPS origin for production.");
const demoLogin = configuredDemoLogin();
const store = new Store(
  process.env.DATABASE_PATH || "./data/pocketledger.sqlite",
);
try {
  if (demoLogin) await seedDemoLogin(store, demoLogin);
} catch (error) {
  store.close();
  throw error;
}
const server = createApp(store, {
  origin,
  secure,
  demoLoginEmail: demoLogin?.email,
}).listen(port, host, () =>
  console.log(`PocketLedger listening on http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
