import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

async function ensureSchema() {
  await env.datastore_db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
}

describe("DATASTORE authentication", () => {
  it("serves the landing page from Worker assets", async () => {
    const response = await SELF.fetch("https://datastore.test/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Tu portal al análisis de");
  });

  it("does not authenticate a request without a session", async () => {
    const response = await SELF.fetch("https://datastore.test/me");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it("registers, authenticates and rejects an invalid password", async () => {
    await ensureSchema();
    const username = `test-${crypto.randomUUID().slice(0, 8)}`;
    const register = await SELF.fetch("https://datastore.test/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Strong-pass-123" }),
    });
    expect(register.status).toBe(201);

    const invalidLogin = await SELF.fetch("https://datastore.test/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "wrong-password" }),
    });
    expect(invalidLogin.status).toBe(401);

    const login = await SELF.fetch("https://datastore.test/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Strong-pass-123" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("Set-Cookie");
    expect(cookie).toContain("__Host-session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");

    const me = await SELF.fetch("https://datastore.test/me", { headers: { Cookie: cookie.split(";")[0] } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ authenticated: true, user: username });
  });
});
