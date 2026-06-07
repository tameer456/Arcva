#!/usr/bin/env node

/**
 * Arcva MCP Server
 * Exposes Arcva startup OS features as MCP tools for Claude users.
 * Deploy to: mcp.arcva.app
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ArcvaClient } from "./arcva-client.js";

const server = new McpServer({
  name: "arcva",
  version: "1.0.0",
  description: "Arcva — AI-powered startup OS. Manage your business plan, tasks, financials, competitors, and marketing content directly from Claude.",
});

// ── Helper: get authenticated client ────────────────────────────────────────
function getClient(token) {
  if (!token) throw new Error("Missing Arcva auth token. Please connect your Arcva account.");
  return new ArcvaClient(token);
}

// ════════════════════════════════════════════════════════════════════════════
// TOOL 1 — get_startup_context
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "get_startup_context",
  "Get the full context of the user's startup — name, industry, stage, goals, and budget. Always call this first to understand who you're helping.",
  {
    token: z.string().describe("Arcva auth token"),
  },
  async ({ token }) => {
    const client = getClient(token);
    const businesses = await client.query("Business", {}, 1);
    if (!businesses.length) {
      return {
        content: [{
          type: "text",
          text: "No business profile found. Ask the user to complete their Arcva business profile first at arcva.app.",
        }],
      };
    }
    const b = businesses[0];
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          id: b.id,
          name: b.data.name,
          description: b.data.description,
          industry: b.data.industry,
          country: b.data.country,
          stage: b.data.stage,
          goals: b.data.goals,
          budget: b.data.budget,
        }, null, 2),
      }],
    };
  }
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 2 — update_business
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "update_business",
  "Update the user's startup profile — stage, goals, industry, description, or budget.",
  {
    token: z.string().describe("Arcva auth token"),
    business_id: z.string().describe("Business record ID from get_startup_context"),
    name: z.string().optional().describe("Business name"),
    description: z.string().optional().describe("Business description"),
    industry: z.string().optional().describe("Industry"),
    country: z.string().optional().describe("Country"),
    stage: z.enum(["idea", "startup", "growing", "established"]).optional().describe("Current startup stage"),
    goals: z.string().optional().describe("Business goals"),
    budget: z.enum(["under_1k", "1k_5k", "5k_20k", "20k_50k", "50k_plus"]).optional().describe("Monthly budget range"),
  },
  async ({ token, business_id, ...fields }) => {
    const client = getClient(token);
    const updates = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    await client.update("Business", business_id, updates);
    return {
      content: [{
        type: "text",
        text: `Business profile updated successfully. Updated fields: ${Object.keys(updates).join(", ")}`,
      }],
    };
  }
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 3 — business_advisor
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "business_advisor",
  "Ask the Arcva AI Business Advisor a question about your startup. Saves the conversation history to Arcva so context builds over time.",
  {
    token: z.string().describe("Arcva auth token"),
    question: z.string().describe("The founder's question for the business advisor"),
    business_context: z.string().optional().describe("Paste output from get_startup_context to give the advisor full context"),
  },
  async ({ token, question, business_context }) => {
    const client = getClient(token);

    // Save the user message to chat history
    await client.create("ChatMessage", {
      role: "user",
      content: question,
    });

    // Build system prompt with business context
    const systemPrompt = `You are the Arcva AI Business Advisor — a strategic advisor for startup founders. 
You have deep expertise in product strategy, go-to-market, fundraising, operations, and scaling.
Be direct, actionable, and specific. Avoid generic advice.
${business_context ? `\nStartup context:\n${business_context}` : ""}`;

    // Call Claude API as the advisor brain
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: question }],
      }),
    });

    const data = await response.json();
    const answer = data.content?.[0]?.text || "Unable to get advisor response.";

    // Save advisor response to chat history
    await client.create("ChatMessage", {
      role: "assistant",
      content: answer,
    });

    return {
      content: [{ type: "text", text: answer }],
    };
  }
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 4 — get_business_plan
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "get_business_plan",
  "Retrieve the user's existing business plan from Arcva, or list all plans.",
  {
    token: z.string().describe("Arcva auth token"),
    plan_id: z.string().optional().describe("Specific plan ID to retrieve. Omit to list all plans."),
  },
  async ({ token, plan_id }) => {
    const client = getClient(token);
    if (plan_id) {
      const plans = await client.query("BusinessPlan", { id: plan_id }, 1);
      if (!plans.length) return { content: [{ type: "text", text: "Business plan not found." }] };
      return { content: [{ type: "text", text: JSON.stringify(plans[0], null, 2) }] };
    }
    const plans = await client.query("BusinessPlan", {}, 20);
    return {
      content: [{
        type: "text",
        text: plans.length
          ? JSON.stringify(plans.map(p => ({ id: p.id, title: p.data.title, status: p.data.status })), null, 2)
          : "No business plans found. Create one in Arcva at arcva.app.",
      }],
    };
  }
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 5 — create_business_plan
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "create_business_plan",
  "Create or update a business plan section in Arcva. Can write any combination of sections.",
  {
    token: z.string().describe("Arcva auth token"),
    title: z.string().describe("Business plan title"),
    executive_summary: z.string().optional().describe("Executive summary"),
    market_analysis: z.string().optional().describe("Market analysis"),
    competitor_analysis: z.string().optional().describe("Competitor analysis"),
    revenue_model: z.string().optional().describe("Revenue model"),
    growth_strategy: z.string().optional().describe("Growth strategy"),
    financial_projections: z.string().optional().describe("Financial projections"),
    status: z.enum(["draft", "complete"]).optional().default("draft"),
  },
  async ({ token, ...planData }) => {
    const client = getClient(token);
    const record = await client.create("BusinessPlan", planData);
    return {
      content: [{
        type: "text",
        text: `Business plan "${planData.title}" created successfully in Arcva. Plan ID: ${record.id}`,
      }],
    };
  }
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 6 — manage_tasks
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "manage_tasks",
  "Create, list, or update tasks in the Arcva roadmap. Filter by status or priority.",
  {
    token: z.string().describe("Arcva auth token"),
    action: z.enum(["list", "create", "update"]).describe("Action to perform"),
    task_id: z.string().optional().describe("Task ID (required for update)"),
    title: z.string().optional().describe("Task title (required for create)"),
    description: z.string().optional().describe("Task description"),
    status: z.enum(["not_started", "in_progress", "completed"]).optional().describe("Task status"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("Task priority"),
    category: z.string().optional().describe("Task category"),
    due_date: z.string().optional().describe("Due date in YYYY-MM-DD format"),
    filter_status: z.enum(["not_started", "in_progress", "completed"]).optional().describe("Filter listed tasks by status"),
    filter_priority: z.enum(["low", "medium", "high"]).optional().describe("Filter listed tasks by priority"),
  },
  async ({ token, action, task_id, filter_status, filter_priority, ...taskData }) => {
    const client = getClient(token);

    if (action === "list") {
      const query = {};
      if (filter_status) query["data.status"] = filter_status;
      if (filter_priority) query["data.priority"] = filter_priority;
      const tasks = await client.query("Task", query, 50);
      return {
        content: [{
          type: "text",
          text: tasks.length
            ? JSON.stringify(tasks.map(t => ({
                id: t.id,
                title: t.data.title,
                status: t.data.status,
                priority: t.data.priority,
                category: t.data.category,
                due_date: t.data.due_date,
              })), null, 2)
            : "No tasks found.",
        }],
      };
    }

    if (action === "create") {
      if (!taskData.title) throw new Error("title is required to create a task");
      const record = await client.create("Task", taskData);
      return {
        content: [{ type: "text", text: `Task "${taskData.title}" created. ID: ${record.id}` }],
      };
    }

    if (action === "update") {
      if (!task_id) throw new Error("task_id is required to update a task");
      const updates = Object.fromEntries(Object.entries(taskData).filter(([, v]) => v !== undefined));
      await client.update("Task", task_id, updates);
      return {
        content: [{ type: "text", text: `Task ${task_id} updated. Fields: ${Object.keys(updates).join(", ")}` }],
      };
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 7 — track_financials
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "track_financials",
  "Log revenue or expenses, or get a financial summary with totals and runway.",
  {
    token: z.string().describe("Arcva auth token"),
    action: z.enum(["log", "summary"]).describe("log a transaction or get summary"),
    type: z.enum(["expense", "revenue"]).optional().describe("Transaction type (required for log)"),
    amount: z.number().optional().describe("Amount in your currency (required for log)"),
    category: z.string().optional().describe("Category e.g. marketing, salary, hosting"),
    description: z.string().optional().describe("Transaction description"),
    date: z.string().optional().describe("Date in YYYY-MM-DD format (defaults to today)"),
  },
  async ({ token, action, ...txData }) => {
    const client = getClient(token);

    if (action === "log") {
      if (!txData.type || !txData.amount) throw new Error("type and amount are required to log a transaction");
      if (!txData.date) txData.date = new Date().toISOString().split("T")[0];
      const record = await client.create("Transaction", txData);
      return {
        content: [{
          type: "text",
          text: `${txData.type === "revenue" ? "Revenue" : "Expense"} of ${txData.amount} logged. ID: ${record.id}`,
        }],
      };
    }

    if (action === "summary") {
      const transactions = await client.query("Transaction", {}, 500);
      const revenue = transactions
        .filter(t => t.data.type === "revenue")
        .reduce((sum, t) => sum + (t.data.amount || 0), 0);
      const expenses = transactions
        .filter(t => t.data.type === "expense")
        .reduce((sum, t) => sum + (t.data.amount || 0), 0);
      const net = revenue - expenses;

      // Group expenses by category
      const byCategory = {};
      transactions
        .filter(t => t.data.type === "expense" && t.data.category)
        .forEach(t => {
          byCategory[t.data.category] = (byCategory[t.data.category] || 0) + t.data.amount;
        });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_revenue: revenue,
            total_expenses: expenses,
            net: net,
            profitable: net > 0,
            transactions_count: transactions.length,
            expenses_by_category: byCategory,
          }, null, 2),
        }],
      };
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 8 — research_competitor
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "research_competitor",
  "Add, list, or retrieve competitors tracked in Arcva. Mark a competitor as analyzed after research.",
  {
    token: z.string().describe("Arcva auth token"),
    action: z.enum(["list", "add", "update"]).describe("Action to perform"),
    competitor_id: z.string().optional().describe("Competitor ID (required for update)"),
    name: z.string().optional().describe("Competitor name (required for add)"),
    website: z.string().optional().describe("Competitor website URL"),
    strengths: z.string().optional().describe("Their strengths"),
    weaknesses: z.string().optional().describe("Their weaknesses"),
    pricing: z.string().optional().describe("Pricing analysis"),
    insights: z.string().optional().describe("Marketing insights"),
    opportunities: z.string().optional().describe("Opportunities for Arcva user against this competitor"),
    analyzed: z.boolean().optional().describe("Mark as analyzed"),
  },
  async ({ token, action, competitor_id, ...data }) => {
    const client = getClient(token);

    if (action === "list") {
      const competitors = await client.query("Competitor", {}, 50);
      return {
        content: [{
          type: "text",
          text: competitors.length
            ? JSON.stringify(competitors.map(c => ({
                id: c.id,
                name: c.data.name,
                website: c.data.website,
                analyzed: c.data.analyzed,
              })), null, 2)
            : "No competitors tracked yet.",
        }],
      };
    }

    if (action === "add") {
      if (!data.name) throw new Error("name is required to add a competitor");
      const record = await client.create("Competitor", data);
      return {
        content: [{ type: "text", text: `Competitor "${data.name}" added to Arcva. ID: ${record.id}` }],
      };
    }

    if (action === "update") {
      if (!competitor_id) throw new Error("competitor_id is required to update");
      const updates = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
      await client.update("Competitor", competitor_id, updates);
      return {
        content: [{ type: "text", text: `Competitor ${competitor_id} updated.` }],
      };
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 9 — create_marketing_content
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "create_marketing_content",
  "Generate and save marketing content to Arcva — posts, ads, email campaigns, landing pages, and more.",
  {
    token: z.string().describe("Arcva auth token"),
    action: z.enum(["create", "list"]).describe("Create new content or list existing"),
    content_type: z.enum(["instagram_post", "tiktok_idea", "ad_copy", "email_campaign", "product_description", "landing_page"]).optional().describe("Type of content (required for create)"),
    title: z.string().optional().describe("Content title (required for create)"),
    content: z.string().optional().describe("The actual content text (required for create)"),
    platform: z.string().optional().describe("Target platform"),
    status: z.enum(["draft", "published"]).optional().default("draft"),
  },
  async ({ token, action, ...contentData }) => {
    const client = getClient(token);

    if (action === "list") {
      const items = await client.query("MarketingContent", {}, 50);
      return {
        content: [{
          type: "text",
          text: items.length
            ? JSON.stringify(items.map(i => ({
                id: i.id,
                title: i.data.title,
                content_type: i.data.content_type,
                platform: i.data.platform,
                status: i.data.status,
              })), null, 2)
            : "No marketing content saved yet.",
        }],
      };
    }

    if (action === "create") {
      if (!contentData.content_type || !contentData.title || !contentData.content) {
        throw new Error("content_type, title, and content are required");
      }
      const record = await client.create("MarketingContent", contentData);
      return {
        content: [{
          type: "text",
          text: `Marketing content "${contentData.title}" saved to Arcva. ID: ${record.id}`,
        }],
      };
    }
  }
);

// ── Start server ─────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Arcva MCP server running.");
