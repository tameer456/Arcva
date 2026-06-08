/**
 * ArcvaClient
 * Thin wrapper around the Base44 REST API.
 * Each method accepts the user's OAuth token and talks to the Arcva app backend.
 */

const BASE44_APP_ID = "6a1e7db0584fc5296b3417c8";
const BASE_URL = `https://api.base44.com/api/apps/${BASE44_APP_ID}/entities`;

export class ArcvaClient {
  constructor(token) {
    this.token = token;
    this.headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "api-key": token,
    };
  }

  // ── Query records ──────────────────────────────────────────────────────────
  async query(entity, filter = {}, limit = 50) {
    const params = new URLSearchParams({
      limit: String(limit),
    });
    if (Object.keys(filter).length) {
      params.set("query", JSON.stringify(filter));
    }

    const res = await fetch(`${BASE_URL}/${entity}?${params}`, {
      headers: this.headers,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Arcva query failed (${res.status}): ${err}`);
    }

    const data = await res.json();
    return data.items || data || [];
  }

  // ── Create record ──────────────────────────────────────────────────────────
  async create(entity, fields) {
    const res = await fetch(`${BASE_URL}/${entity}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(fields),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Arcva create failed (${res.status}): ${err}`);
    }

    return await res.json();
  }

  // ── Update record ──────────────────────────────────────────────────────────
  async update(entity, id, fields) {
    const res = await fetch(`${BASE_URL}/${entity}/${id}`, {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify(fields),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Arcva update failed (${res.status}): ${err}`);
    }

    return await res.json();
  }

  // ── Delete record ──────────────────────────────────────────────────────────
  async delete(entity, id) {
    const res = await fetch(`${BASE_URL}/${entity}/${id}`, {
      method: "DELETE",
      headers: this.headers,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Arcva delete failed (${res.status}): ${err}`);
    }

    return true;
  }
}
