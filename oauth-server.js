/**
 * Arcva OAuth Server
 * Handles the OAuth 2.0 flow required by Anthropic's connector directory.
 * Run alongside the MCP server for web-based authentication.
 *
 * Flow:
 *  1. Claude redirects user to /oauth/authorize
 *  2. User logs into Arcva
 *  3. Server redirects back to Claude with auth code
 *  4. Claude exchanges code for token via /oauth/token
 *  5. Claude passes token to MCP tools as `token` param
 */

import express from "express";
import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory store for auth codes (use Redis in production)
const authCodes = new Map();
const tokens = new Map();

// ── GET /health ──────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "arcva-mcp", version: "1.0.0" });
});

// OAuth discovery endpoint — Claude reads this automatically
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({
    issuer: "https://mcp.arcva.app",
    authorization_endpoint: "https://mcp.arcva.app/oauth/authorize",
    token_endpoint: "https://mcp.arcva.app/oauth/token",
    revocation_endpoint: "https://mcp.arcva.app/oauth/revoke",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
  });
});

// Dynamic client registration
app.post("/oauth/register", (req, res) => {
  res.json({
    client_id: "arcva_mcp_client",
    client_secret: "arcva_secret_2025",
    redirect_uris: req.body.redirect_uris || [],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  });
});

// ── GET /oauth/authorize ─────────────────────────────────────────────────────
// Anthropic redirects Claude users here to begin auth
app.get("/oauth/authorize", (req, res) => {
  const { client_id, redirect_uri, state, response_type } = req.query;

  if (response_type && !["code", "token"].includes(response_type)) {
  return res.status(400).json({ error: "unsupported_response_type" });
}
  

  // Render the Arcva login page
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Connect Arcva to Claude</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
               background: #f7f7f5; display: flex; align-items: center; 
               justify-content: center; min-height: 100vh; }
        .card { background: white; border-radius: 16px; padding: 40px; 
                max-width: 420px; width: 90%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
        .logo { font-size: 28px; font-weight: 700; color: #534AB7; margin-bottom: 8px; }
        .subtitle { color: #666; font-size: 14px; margin-bottom: 32px; }
        label { display: block; font-size: 13px; font-weight: 500; 
                color: #333; margin-bottom: 6px; }
        input { width: 100%; padding: 12px 14px; border: 1px solid #e0ddd8; 
                border-radius: 8px; font-size: 15px; margin-bottom: 16px; outline: none; }
        input:focus { border-color: #534AB7; }
        button { width: 100%; padding: 14px; background: #534AB7; color: white; 
                 border: none; border-radius: 8px; font-size: 15px; font-weight: 600; 
                 cursor: pointer; }
        button:hover { background: #3C3489; }
        .permission-box { background: #EEEDFE; border-radius: 8px; padding: 16px; 
                          margin-bottom: 24px; }
        .permission-box p { font-size: 13px; color: #534AB7; font-weight: 500; 
                            margin-bottom: 8px; }
        .permission-box ul { font-size: 12px; color: #3C3489; padding-left: 16px; }
        .permission-box li { margin-bottom: 4px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">Arcva</div>
        <div class="subtitle">Connect your Arcva account to Claude</div>
        
        <div class="permission-box">
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
          <input type="hidden" name="redirect_uri" value="${redirect_uri}">
          <input type="hidden" name="state" value="${state}">
          <input type="hidden" name="client_id" value="${client_id}">
          <label>Email</label>
          <input type="email" name="email" placeholder="you@example.com" required>
          <label>Password</label>
          <input type="password" name="password" placeholder="••••••••" required>
          <button type="submit">Connect Arcva to Claude</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// ── POST /oauth/login ────────────────────────────────────────────────────────
// Validates Arcva credentials and issues an auth code
app.post("/oauth/login", async (req, res) => {
  const { email, password, redirect_uri, state, client_id } = req.body;

  try {
    // Authenticate with Base44
    const authRes = await fetch("https://api.base44.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        app_id: "6a1e7db0584fc5296b3417c8",
      }),
    });

    if (!authRes.ok) {
      return res.status(401).send(`
        <h2 style="font-family:Arial;color:red;padding:20px">
          Login failed. Check your email/password and try again.<br><br>
          Error: ${await authRes.text()}
        </h2>
      `);

    const authData = await authRes.json();
    const userToken = authData.token || authData.access_token;

    // Generate auth code and store with token
    const code = crypto.randomBytes(32).toString("hex");
    authCodes.set(code, {
      token: userToken,
      expires: Date.now() + 10 * 60 * 1000, // 10 min
      client_id,
    });

    // Redirect back to Claude with auth code
    const callbackUrl = new URL(redirect_uri);
    callbackUrl.searchParams.set("code", code);
    callbackUrl.searchParams.set("state", state);
    res.redirect(callbackUrl.toString());
  }
    catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ── POST /oauth/token ────────────────────────────────────────────────────────
// Claude exchanges auth code for access token
app.post("/oauth/token", (req, res) => {
  const { code, grant_type, client_id, client_secret } = req.body;

  if (grant_type !== "authorization_code") {
    return res.status(400).json({ error: "unsupported_grant_type" });
  }

  const entry = authCodes.get(code);
  if (!entry || entry.expires < Date.now()) {
    authCodes.delete(code);
    return res.status(400).json({ error: "invalid_grant" });
  }

  authCodes.delete(code);

  // Issue access token (= the Base44 user token)
  const accessToken = entry.token;
  tokens.set(accessToken, { client_id, created: Date.now() });

  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 86400 * 30, // 30 days
    scope: "business:read business:write tasks:read tasks:write financials:read financials:write",
  });
});

// ── GET /oauth/revoke ────────────────────────────────────────────────────────
app.post("/oauth/revoke", (req, res) => {
  const { token } = req.body;
  tokens.delete(token);
  res.json({ revoked: true });
});

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Arcva OAuth server running on port ${PORT}`);
});
