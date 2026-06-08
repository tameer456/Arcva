import express from "express";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const authCodes = new Map();

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "arcva-mcp", version: "1.0.0" });
});

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  res.json({
    resource: "https://mcp.arcva.app",
    authorization_servers: ["https://mcp.arcva.app"],
  });
});

app.post("/", async (req, res) => {
  const { method, id, params } = req.body || {};

  // Initialize
  if (method === "initialize") {
    return res.json({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "arcva", version: "1.0.0" },
      },
    });
  }

  // List tools
  if (method === "tools/list") {
    return res.json({
      jsonrpc: "2.0", id,
      result: {
        tools: [
          { name: "get_startup_context", description: "Get the full context of the user's startup — name, industry, stage, goals, and budget.", inputSchema: { type: "object", properties: { token: { type: "string" } }, required: ["token"] } },
          { name: "manage_tasks", description: "Create, list, or update tasks in the Arcva roadmap.", inputSchema: { type: "object", properties: { token: { type: "string" }, action: { type: "string", enum: ["list", "create", "update"] }, title: { type: "string" }, status: { type: "string" }, priority: { type: "string" } }, required: ["token", "action"] } },
          { name: "track_financials", description: "Log revenue or expenses, or get a financial summary.", inputSchema: { type: "object", properties: { token: { type: "string" }, action: { type: "string", enum: ["log", "summary"] }, type: { type: "string" }, amount: { type: "number" } }, required: ["token", "action"] } },
          { name: "business_advisor", description: "Ask the Arcva AI Business Advisor a question about your startup.", inputSchema: { type: "object", properties: { token: { type: "string" }, question: { type: "string" } }, required: ["token", "question"] } },
          { name: "research_competitor", description: "Add, list, or retrieve competitors tracked in Arcva.", inputSchema: { type: "object", properties: { token: { type: "string" }, action: { type: "string", enum: ["list", "add", "update"] }, name: { type: "string" } }, required: ["token", "action"] } },
          { name: "create_marketing_content", description: "Generate and save marketing content to Arcva.", inputSchema: { type: "object", properties: { token: { type: "string" }, action: { type: "string", enum: ["create", "list"] }, title: { type: "string" }, content: { type: "string" } }, required: ["token", "action"] } },
        ],
      },
    });
  }

  // Call tool
  if (method === "tools/call") {
    const { name, arguments: args } = params || {};
    const token = args?.token || req.headers.authorization?.replace("Bearer ", "");

    try {
      const { ArcvaClient } = await import("./arcva-client.js");
      const client = new ArcvaClient(token);

      if (name === "get_startup_context") {
        const businesses = await client.query("Business", {}, 1);
        const b = businesses[0];
        return res.json({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: JSON.stringify(b?.data || "No business profile found", null, 2) }] },
        });
      }

      if (name === "manage_tasks") {
        if (args.action === "list") {
          const tasks = await client.query("Task", {}, 50);
          return res.json({
            jsonrpc: "2.0", id,
            result: { content: [{ type: "text", text: JSON.stringify(tasks.map(t => ({ id: t.id, ...t.data })), null, 2) }] },
          });
        }
        if (args.action === "create") {
          const record = await client.create("Task", { title: args.title, status: args.status || "not_started", priority: args.priority || "medium" });
          return res.json({
            jsonrpc: "2.0", id,
            result: { content: [{ type: "text", text: `Task "${args.title}" created. ID: ${record.id}` }] },
          });
        }
      }

      if (name === "track_financials") {
        if (args.action === "summary") {
          const transactions = await client.query("Transaction", {}, 500);
          const revenue = transactions.filter(t => t.data.type === "revenue").reduce((s, t) => s + (t.data.amount || 0), 0);
          const expenses = transactions.filter(t => t.data.type === "expense").reduce((s, t) => s + (t.data.amount || 0), 0);
          return res.json({
            jsonrpc: "2.0", id,
            result: { content: [{ type: "text", text: JSON.stringify({ revenue, expenses, net: revenue - expenses }, null, 2) }] },
          });
        }
        if (args.action === "log") {
          const record = await client.create("Transaction", { type: args.type, amount: args.amount, date: new Date().toISOString().split("T")[0] });
          return res.json({
            jsonrpc: "2.0", id,
            result: { content: [{ type: "text", text: `Transaction logged. ID: ${record.id}` }] },
          });
        }
      }

      if (name === "research_competitor") {
        if (args.action === "list") {
          const competitors = await client.query("Competitor", {}, 50);
          return res.json({
            jsonrpc: "2.0", id,
            result: { content: [{ type: "text", text: JSON.stringify(competitors.map(c => ({ id: c.id, ...c.data })), null, 2) }] },
          });
        }
        if (args.action === "add") {
          const record = await client.create("Competitor", { name: args.name });
          return res.json({
            jsonrpc: "2.0", id,
            result: { content: [{ type: "text", text: `Competitor "${args.name}" added. ID: ${record.id}` }] },
          });
        }
      }

      if (name === "create_marketing_content") {
        if (args.action === "list") {
          const items = await client.query("MarketingContent", {}, 50);
          return res.json({
            jsonrpc: "2.0", id,
            result: { content: [{ type: "text", text: JSON.stringify(items.map(i => ({ id: i.id, ...i.data })), null, 2) }] },
          });
        }
        if (args.action === "create") {
          const record = await client.create("MarketingContent", { title: args.title, content: args.content });
          return res.json({
            jsonrpc: "2.0", id,
            result: { content: [{ type: "text", text: `Content "${args.title}" saved. ID: ${record.id}` }] },
          });
        }
      }

      if (name === "business_advisor") {
        return res.json({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: `Advisor received: ${args.question}` }] },
        });
      }

      return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Tool not found: ${name}` } });

    } catch (err) {
      return res.json({ jsonrpc: "2.0", id, error: { code: -32000, message: err.message } });
    }
  }

  // Notifications (no response needed)
  if (method?.startsWith("notifications/")) {
    return res.status(204).send();
  }

  return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});

app.get("/", async (req, res) => {
  res.json({ service: "arcva-mcp", version: "1.0.0" });
});

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({
    issuer: "https://mcp.arcva.app",
    authorization_endpoint: "https://mcp.arcva.app/oauth/authorize",
    token_endpoint: "https://mcp.arcva.app/oauth/token",
    revocation_endpoint: "https://mcp.arcva.app/oauth/revoke",
    registration_endpoint: "https://mcp.arcva.app/oauth/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
  });
});

app.post("/oauth/register", (req, res) => {
  res.json({
    client_id: "arcva_mcp_client",
    client_secret: process.env.OAUTH_CLIENT_SECRET || "arcva_secret_2025",
    redirect_uris: req.body.redirect_uris || [],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  });
});

app.get("/oauth/authorize", (req, res) => {
  const { redirect_uri, state, client_id, error } = req.query;
  const errorHtml = error
    ? `<div style="background:#fee;border:1px solid #f99;border-radius:8px;padding:12px;margin-bottom:16px;color:#c00;font-size:13px;">Login failed. Please check your email and password.</div>`
    : "";
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect Arcva to Claude</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #f7f7f5;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: white; border-radius: 16px; padding: 40px;
            max-width: 420px; width: 90%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .logo { font-size: 28px; font-weight: 700; color: #534AB7; margin-bottom: 8px; }
    .subtitle { color: #666; font-size: 14px; margin-bottom: 24px; }
    .perms { background: #EEEDFE; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
    .perms p { font-size: 13px; color: #534AB7; font-weight: 500; margin-bottom: 8px; }
    .perms ul { font-size: 12px; color: #3C3489; padding-left: 16px; }
    .perms li { margin-bottom: 4px; }
    label { display: block; font-size: 13px; font-weight: 500; color: #333; margin-bottom: 6px; }
    input { width: 100%; padding: 12px 14px; border: 1px solid #e0ddd8;
            border-radius: 8px; font-size: 15px; margin-bottom: 16px; outline: none; }
    input:focus { border-color: #534AB7; }
    button { width: 100%; padding: 14px; background: #534AB7; color: white;
             border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
    button:hover { background: #3C3489; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Arcva</div>
    <div class="subtitle">Connect your Arcva account to Claude</div>
    ${errorHtml}
    <div class="perms">
      <p>Claude will be able to:</p>
      <ul>
        <li>Read your business profile and startup context</li>
        <li>Manage your tasks and roadmap</li>
        <li>Log and view financial transactions</li>
        <li>Read and create business plan sections</li>
        <li>Track and research competitors</li>
        <li>Create and save marketing content</li>
      </ul>
    </div>
    <form method="POST" action="/oauth/login">
      <input type="hidden" name="redirect_uri" value="${redirect_uri || ""}">
      <input type="hidden" name="state" value="${state || ""}">
      <input type="hidden" name="client_id" value="${client_id || ""}">
      <label>Email</label>
      <input type="email" name="email" placeholder="you@example.com" required>
      <label>Password</label>
      <input type="password" name="password" placeholder="••••••••" required>
      <button type="submit">Connect Arcva to Claude</button>
    </form>
  </div>
</body>
</html>`);
});

app.post("/oauth/login", async (req, res) => {
  const { email, password, redirect_uri, state, client_id } = req.body;
  try {
    const authRes = await fetch("https://arcva.app/api/apps/6a1e7db0584fc5296b3417c8/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, app_id: "6a1e7db0584fc5296b3417c8" }),
    });
    if (!authRes.ok) {
      const errText = await authRes.text();
      console.error("Base44 auth failed:", authRes.status, errText);
      return res.redirect(`/oauth/authorize?error=invalid_credentials&redirect_uri=${encodeURIComponent(redirect_uri)}&state=${state}&client_id=${client_id}`);
    }
    const authData = await authRes.json();
    const userToken = authData.token || authData.access_token || authData.jwt || authData.sessionToken || authData.id_token || Object.values(authData).find(v => typeof v === 'string' && v.length > 50);
    if (!userToken) {
      console.error("No token in Base44 response:", JSON.stringify(authData));
      return res.redirect(`/oauth/authorize?error=no_token&redirect_uri=${encodeURIComponent(redirect_uri)}&state=${state}&client_id=${client_id}`);
    }
    const code = crypto.randomBytes(32).toString("hex");
    authCodes.set(code, { token: userToken, expires: Date.now() + 10 * 60 * 1000 });
    const callbackUrl = new URL(redirect_uri);
    callbackUrl.searchParams.set("code", code);
    callbackUrl.searchParams.set("state", state);
    res.redirect(callbackUrl.toString());
  } catch (err) {
    console.error("Login error:", err);
    res.redirect(`/oauth/authorize?error=server_error&redirect_uri=${encodeURIComponent(redirect_uri)}&state=${state}&client_id=${client_id}`);
  }
});

app.post("/oauth/token", (req, res) => {
  const { code, grant_type } = req.body;
  if (grant_type !== "authorization_code") {
    return res.status(400).json({ error: "unsupported_grant_type" });
  }
  const entry = authCodes.get(code);
  if (!entry || entry.expires < Date.now()) {
    authCodes.delete(code);
    return res.status(400).json({ error: "invalid_grant" });
  }
  authCodes.delete(code);
  res.json({
    access_token: entry.token,
    token_type: "Bearer",
    expires_in: 86400 * 30,
    scope: "business:read business:write tasks:read tasks:write financials:read financials:write",
  });
});

app.post("/oauth/revoke", (req, res) => {
  res.json({ revoked: true });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Arcva OAuth server running on port ${PORT}`);
});
