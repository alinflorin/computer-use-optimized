#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  REGISTRY_ROOT, getChildren, walk, call, getProp, ACCESSIBLE, actionNames,
  doAction, setText, grabFocus, getExtents, type NodeInfo, type Ref,
} from "./atspi.js";
import { pressKeys, typeText, clickAt, screenshot } from "./input.js";

// Short ids ("e12") -> object refs. Rebuilt whenever a tree/search is returned.
const refs = new Map<string, Ref>();
let counter = 0;
const idFor = (ref: Ref): string => {
  const id = `e${++counter}`;
  refs.set(id, ref);
  return id;
};
const resolve = (id: string): Ref => {
  const r = refs.get(id);
  if (!r) throw new Error(`Unknown ref "${id}". Call get_tree or find again to refresh refs.`);
  return r;
};

const fmt = (n: NodeInfo, depth = 0): string => {
  const label = n.name ? ` "${n.name}"` : "";
  return [`${"  ".repeat(depth)}${idFor(n.ref)} [${n.role}]${label}`, ...n.children.map((c) => fmt(c, depth + 1))].join("\n");
};

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (e: unknown) => ({ isError: true, ...text(e instanceof Error ? e.message : String(e)) });
const safe = <A>(fn: (a: A) => Promise<ReturnType<typeof text>>) => async (a: A) => {
  try { return await fn(a); } catch (e) { return fail(e); }
};

async function apps(filter?: string): Promise<{ ref: Ref; name: string }[]> {
  const kids = await getChildren(REGISTRY_ROOT);
  const named = await Promise.all(
    kids.map(async (ref) => ({ ref, name: String(await getProp(ref, ACCESSIBLE, "Name").catch(() => "")) })),
  );
  return filter ? named.filter((a) => a.name.toLowerCase().includes(filter.toLowerCase())) : named;
}

const server = new McpServer({ name: "computer-use-optimized", version: "0.1.0" });

server.registerTool("get_tree", {
  description:
    "Text tree of the accessibility hierarchy. Without `app`, lists running applications only. With `app` (name substring), dumps its widgets to `depth`. Every line starts with a ref id usable by click/type/focus.",
  inputSchema: { app: z.string().optional(), depth: z.number().int().min(1).max(15).default(6) },
}, safe(async ({ app, depth }) => {
  refs.clear(); counter = 0;
  const matches = await apps(app);
  if (!app) return text(matches.map((a) => `${idFor(a.ref)} [application] "${a.name}"`).join("\n"));
  if (!matches.length) return text(`No application matching "${app}".`);
  const trees = await Promise.all(matches.map((a) => walk(a.ref, depth)));
  return text(trees.map((t) => fmt(t)).join("\n"));
}));

server.registerTool("find", {
  description: "Search for elements by role and/or name substring (case-insensitive). Returns ref ids with screen position.",
  inputSchema: {
    name: z.string().optional(), role: z.string().optional(), app: z.string().optional(),
    depth: z.number().int().min(1).max(15).default(10),
  },
}, safe(async ({ name, role, app, depth }) => {
  if (!name && !role) throw new Error("Provide name and/or role.");
  refs.clear(); counter = 0;
  const trees = await Promise.all((await apps(app)).map((a) => walk(a.ref, depth)));
  const hits: NodeInfo[] = [];
  const visit = (n: NodeInfo) => {
    if ((!role || n.role === role.toLowerCase()) && (!name || n.name.toLowerCase().includes(name.toLowerCase()))) hits.push(n);
    n.children.forEach(visit);
  };
  trees.forEach(visit);
  const lines = await Promise.all(hits.slice(0, 50).map(async (h) => {
    const box = await getExtents(h.ref).catch(() => null);
    return `${idFor(h.ref)} [${h.role}] "${h.name}"${box ? ` @${box.join(",")}` : ""}`;
  }));
  return text(lines.length ? lines.join("\n") : "No matches.");
}));

server.registerTool("click", {
  description: "Activate an element via its primary AT-SPI action (no coordinates). If the element has no action, falls back to a real mouse click at its center.",
  inputSchema: { ref: z.string() },
}, safe(async ({ ref }) => {
  const r = resolve(ref);
  const actions = await actionNames(r).catch(() => []);
  if (actions.length && await doAction(r, 0)) return text(`Did action "${actions[0]}".`);
  const [x, y, w, h] = await getExtents(r);
  if (w <= 0 || h <= 0) throw new Error("No action and no usable screen position.");
  await clickAt(x + w / 2, y + h / 2);
  return text(`Clicked at ${Math.round(x + w / 2)},${Math.round(y + h / 2)}.`);
}));

server.registerTool("type", {
  description: "Set the text contents of an editable element (replaces existing text).",
  inputSchema: { ref: z.string(), text: z.string() },
}, safe(async ({ ref, text: t }) => {
  const ok = await setText(resolve(ref), t);
  return text(ok ? "Text set." : "Element rejected the text (not editable?).");
}));

server.registerTool("focus", {
  description: "Give keyboard focus to an element.",
  inputSchema: { ref: z.string() },
}, safe(async ({ ref }) => text((await grabFocus(resolve(ref))) ? "Focused." : "Could not focus.")));

server.registerTool("type_keys", {
  description: "Fallback: type literal text into whatever has focus, using synthetic keyboard input.",
  inputSchema: { text: z.string() },
}, safe(async ({ text: t }) => { await typeText(t); return text("Typed."); }));

server.registerTool("key", {
  description: 'Press a key combo on the focused window, e.g. "ctrl+s", "enter", "alt+f4".',
  inputSchema: { combo: z.string() },
}, safe(async ({ combo }) => { await pressKeys(combo); return text(`Pressed ${combo}.`); }));

server.registerTool("click_at", {
  description: "Fallback: real mouse click at absolute screen coordinates (use after a screenshot).",
  inputSchema: { x: z.number(), y: z.number(), button: z.enum(["left", "right", "middle"]).default("left") },
}, safe(async ({ x, y, button }) => { await clickAt(x, y, button); return text(`Clicked ${button} at ${x},${y}.`); }));

server.registerTool("screenshot", {
  description: "Full-screen screenshot (PNG). Prefer get_tree/find; use this when an app exposes no accessibility info.",
  inputSchema: {},
}, async () => {
  try {
    return { content: [{ type: "image" as const, data: await screenshot(), mimeType: "image/png" }] };
  } catch (e) { return fail(e); }
});

await server.connect(new StdioServerTransport());
