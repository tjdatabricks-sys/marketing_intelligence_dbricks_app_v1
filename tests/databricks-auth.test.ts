import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { managedAuthentication } from "../src/lib/server/databricks-auth";
import { withApiErrors } from "../src/lib/server/api-errors";

function appEnvironment() {
  const vars = [
    "DATABRICKS_APP_NAME",
    "DATABRICKS_HOST",
    "DATABRICKS_CLIENT_ID",
    "DATABRICKS_CLIENT_SECRET",
    "DATABRICKS_TOKEN",
    "DATABRICKS_AUTH_TYPE",
    "DATABRICKS_CONFIG_FILE",
  ];
  const original = Object.fromEntries(
    vars.map((key) => [key, process.env[key]]),
  );
  process.env.DATABRICKS_APP_NAME = "managed-test-app";
  process.env.DATABRICKS_HOST = "https://workspace.example.databricks.com";
  process.env.DATABRICKS_CLIENT_ID = "platform-injected-client";
  process.env.DATABRICKS_CLIENT_SECRET = "platform-injected-secret";
  // These must not override the app identity or cause profile-file reads.
  process.env.DATABRICKS_TOKEN = "stray-pat";
  process.env.DATABRICKS_AUTH_TYPE = "pat";
  process.env.DATABRICKS_CONFIG_FILE = "Z:/does-not-exist/databrickscfg";
  return () => {
    for (const key of vars) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  };
}
function tokenServer(options: { expires?: number; reject?: boolean } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/.well-known/databricks-config"))
        return Response.json({
          oidc_endpoint: "https://workspace.example.databricks.com/oidc",
        });
      if (url.endsWith("/.well-known/oauth-authorization-server"))
        return Response.json({
          token_endpoint:
            "https://workspace.example.databricks.com/oidc/v1/token",
        });
      if (url.endsWith("/oidc/v1/token"))
        return options.reject
          ? new Response("invalid_client platform-injected-secret", {
              status: 401,
            })
          : Response.json({
              access_token: "managed-access-token",
              token_type: "Bearer",
              expires_in: options.expires ?? 3600,
            });
      throw new Error("Unexpected SDK request");
    },
  );
  return { calls, restore: () => fetchMock.mock.restore() };
}
test("official SDK discovers endpoint, uses injected identity, caches concurrent requests and ignores PAT/profile overrides", async () => {
  const restore = appEnvironment(),
    server = tokenServer();
  try {
    const provider = managedAuthentication("workspace.example.databricks.com");
    const headers = await Promise.all([
      provider.authenticate(),
      provider.authenticate(),
      provider.authenticate(),
    ]);
    assert.deepEqual(headers, [
      { Authorization: "Bearer managed-access-token" },
      { Authorization: "Bearer managed-access-token" },
      { Authorization: "Bearer managed-access-token" },
    ]);
    const tokens = server.calls.filter((call) =>
      call.url.endsWith("/v1/token"),
    );
    assert.equal(tokens.length, 1);
    const signed = new Headers(tokens[0].init?.headers).get("Authorization");
    assert.equal(
      signed,
      "Basic " +
        Buffer.from(
          "platform-injected-client:platform-injected-secret",
        ).toString("base64"),
    );
    assert.equal(
      new URLSearchParams(String(tokens[0].init?.body)).get("grant_type"),
      "client_credentials",
    );
    assert.equal(server.calls.length, 3);
  } finally {
    server.restore();
    restore();
  }
});
test("SDK refreshes an expired managed token without any user credential input", async () => {
  const restore = appEnvironment(),
    server = tokenServer({ expires: 3600 });
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    const provider = managedAuthentication("workspace.example.databricks.com");
    await provider.authenticate();
    mock.timers.tick(3601000);
    await provider.authenticate();
    assert.equal(
      server.calls.filter((call) => call.url.endsWith("/v1/token")).length,
      2,
    );
  } finally {
    mock.timers.reset();
    server.restore();
    restore();
  }
});
test("missing platform identity does not fall back to PAT or prompt for a login", async () => {
  const restore = appEnvironment(),
    server = tokenServer();
  try {
    delete process.env.DATABRICKS_CLIENT_SECRET;
    await assert.rejects(
      managedAuthentication("workspace.example.databricks.com").authenticate(),
    );
    assert.equal(server.calls.length, 0);
  } finally {
    server.restore();
    restore();
  }
});
test("managed authentication errors are safe and do not request manual secrets", async () => {
  const restore = appEnvironment(),
    server = tokenServer({ reject: true }),
    logger = mock.method(console, "error", () => {});
  try {
    const provider = managedAuthentication("workspace.example.databricks.com");
    const response = await withApiErrors(async () => {
      await provider.authenticate();
      return Response.json({});
    })(new Request("http://localhost/api/ready"));
    const body = await response.json();
    assert.equal(body.code, "WAREHOUSE_AUTHENTICATION");
    assert.match(body.error, /No manual client ID/);
    assert.doesNotMatch(
      JSON.stringify(body) + JSON.stringify(logger.mock.calls),
      /platform-injected-secret|stray-pat|managed-access-token/,
    );
  } finally {
    logger.mock.restore();
    server.restore();
    restore();
  }
});
