import { test as base, type Page, type BrowserContext } from "@playwright/test";
import { api, type AuthTokens } from "../helpers/api";
import { uniq, uniqEmail } from "../helpers/ids";

export type Role = "admin" | "owner" | "dev" | "viewer";

type SessionCache = Record<Role, { tokens: AuthTokens; timestamp: number } | undefined>;

const USERS: Record<Role, { username: string; password: string }> = {
  admin: { username: "admin", password: process.env.HA_ADMIN_PASSWORD ?? "adminadmin" },
  owner: { username: "qa_owner", password: "password1" },
  dev: { username: "qa_dev", password: "password1" },
  viewer: { username: "qa_viewer", password: "password1" },
};

type AuthFixtures = {
  pageAs: (role: Role) => Promise<{ page: Page; context: BrowserContext; tokens: AuthTokens }>;
  ownerPage: Page;
  adminPage: Page;
  devPage: Page;
  viewerPage: Page;
  freshUser: (prefix?: string) => Promise<{ username: string; token: string; page: Page; context: BrowserContext }>;
};

type WorkerFixtures = {
  workerSessions: SessionCache;
};

export const test = base.extend<AuthFixtures, WorkerFixtures>({
  workerSessions: [
    async ({}, use) => {
      const cache: SessionCache = {
        admin: undefined,
        owner: undefined,
        dev: undefined,
        viewer: undefined,
      };
      await use(cache);
    },
    { scope: "worker" },
  ],

  pageAs: async ({ browser, baseURL, workerSessions }, use) => {
    const contextsToClose: BrowserContext[] = [];

    const helper = async (role: Role) => {
      const creds = USERS[role];
      const now = Date.now();
      let cached = workerSessions[role];
      if (!cached || now - cached.timestamp > 10 * 60 * 1000) {
        const tokens = await api.login(creds.username, creds.password);
        cached = { tokens, timestamp: now };
        workerSessions[role] = cached;
      }

      const context = await browser.newContext({
        baseURL,
        permissions: ["clipboard-read", "clipboard-write"],
        storageState: {
          cookies: [],
          origins: [
            {
              origin: baseURL ?? "http://127.0.0.1:5173",
              localStorage: [
                { name: "ha_token", value: cached.tokens.token },
                { name: "ha_refresh", value: cached.tokens.refresh_token },
                { name: "ha_user", value: JSON.stringify(cached.tokens.user) },
              ],
            },
          ],
        },
      });
      contextsToClose.push(context);
      const page = await context.newPage();
      return { page, context, tokens: cached.tokens };
    };

    await use(helper);

    for (const ctx of contextsToClose) {
      await ctx.close().catch(() => {});
    }
  },

  ownerPage: async ({ pageAs }, use) => {
    const { page } = await pageAs("owner");
    await use(page);
  },

  adminPage: async ({ pageAs }, use) => {
    const { page } = await pageAs("admin");
    await use(page);
  },

  devPage: async ({ pageAs }, use) => {
    const { page } = await pageAs("dev");
    await use(page);
  },

  viewerPage: async ({ pageAs }, use) => {
    const { page } = await pageAs("viewer");
    await use(page);
  },

  freshUser: async ({ browser, baseURL }, use) => {
    const contexts: BrowserContext[] = [];
    const helper = async (prefix = "fresh") => {
      const username = uniq(prefix).replace(/-/g, "_").slice(0, 24);
      const email = uniqEmail(prefix);
      const password = "password1";
      await api.register(username, email, password);
      const tokens = await api.login(username, password);

      const context = await browser.newContext({
        baseURL,
        permissions: ["clipboard-read", "clipboard-write"],
        storageState: {
          cookies: [],
          origins: [
            {
              origin: baseURL ?? "http://127.0.0.1:5173",
              localStorage: [
                { name: "ha_token", value: tokens.token },
                { name: "ha_refresh", value: tokens.refresh_token },
                { name: "ha_user", value: JSON.stringify(tokens.user) },
              ],
            },
          ],
        },
      });
      contexts.push(context);
      const page = await context.newPage();
      return { username, token: tokens.token, page, context };
    };

    await use(helper);

    for (const ctx of contexts) {
      await ctx.close().catch(() => {});
    }
  },
});

export { expect } from "@playwright/test";
