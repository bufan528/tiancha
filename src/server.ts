import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ensureSeed,
  listPool,
  getIndustry,
  listMaterials,
  listResearch,
  listPlans,
  addMaterial,
  INBOX_DIR,
} from "./store.js";
import { initInvestAgent } from "./agent-factory.js";
import { ROOT } from "./store.js";

/* ---- 极简 .env 加载（不引第三方依赖） ---- */
function loadEnv() {
  try {
    const envPath = join(ROOT, ".env");
    const txt = readFileSync(envPath, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const v = m[2].replace(/^["']|["']$/g, "");
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch {
    /* 无 .env 也可，走 offline-mock */
  }
}
loadEnv();

const PORT = Number(process.env.PORT ?? 8787);
const HOST = "127.0.0.1";
const WEB_DIR = join(ROOT, "web");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJSON(res: ServerResponse, status: number, obj: unknown) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req: IncomingMessage, limit = 20 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = normalize(join(WEB_DIR, pathname));
  if (!filePath.startsWith(WEB_DIR)) {
    sendJSON(res, 403, { error: "forbidden" });
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    sendJSON(res, 404, { error: "not found", path: pathname });
  }
}

/* ---- SSE 聊天 ---- */
async function handleChat(req: IncomingMessage, res: ServerResponse) {
  const raw = await readBody(req);
  let body: { message?: string; session_id?: string };
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    sendJSON(res, 400, { error: "invalid json body" });
    return;
  }
  const message = (body.message ?? "").trim();
  if (!message) {
    sendJSON(res, 400, { error: "message required" });
    return;
  }

  const agent = await initInvestAgent();

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const sse = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  let reply = "";
  const unsubscribe = agent.session.subscribe((event: any) => {
    try {
      if (event.type === "message_update" && event.assistantMessageEvent) {
        const e = event.assistantMessageEvent;
        if (e.type === "text_delta") {
          reply += e.delta;
          sse({ type: "text", delta: e.delta });
        }
      } else if (event.type === "tool_execution_start") {
        sse({ type: "tool", name: event.toolName, args: event.args, status: "start" });
      } else if (event.type === "tool_execution_end") {
        sse({ type: "tool", name: event.toolName, status: "end", isError: !!event.isError });
      }
    } catch {
      /* 忽略单事件序列化错误 */
    }
  });

  try {
    await agent.session.prompt(message);
  } catch (err: any) {
    sse({ type: "error", message: err?.message ?? String(err) });
  } finally {
    unsubscribe();
    sse({ type: "done", reply, session_id: body.session_id ?? null });
    res.end();
  }
}

/* ---- 极简 multipart 解析（单文件） ---- */
async function handleUpload(req: IncomingMessage, res: ServerResponse) {
  const ct = req.headers["content-type"] ?? "";
  const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!m) {
    sendJSON(res, 400, { error: "expected multipart/form-data with boundary" });
    return;
  }
  const boundary = `--${m[1] ?? m[2]}`;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const buf = Buffer.concat(chunks);
  const parts = buf.toString("binary").split(boundary);
  let saved: string | null = null;
  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const header = part.slice(0, headerEnd);
    if (!/filename="([^"]+)"/.test(header)) continue;
    const filename = header.match(/filename="([^"]+)"/)![1];
    if (!filename) continue;
    let content = part.slice(headerEnd + 4);
    content = content.replace(/\r\n$/, "");
    const safeName = `${Date.now()}_${filename.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_")}`;
    const dest = join(INBOX_DIR, safeName);
    await writeFile(dest, Buffer.from(content, "binary"));
    const item = addMaterial({
      sourceType: "upload",
      title: filename,
      industry: null,
      content: `（已上传文件 ${safeName}，存入 data/inbox）`,
      path: dest,
    });
    saved = item.id;
    break;
  }
  sendJSON(res, 200, { ok: true, materialId: saved });
}

/* ---- 路由 ---- */
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    const p = url.pathname;

    if (req.method === "GET" && p === "/api/health") {
      return sendJSON(res, 200, { ok: true, service: "diaoyan-agent", time: new Date().toISOString() });
    }
    if (req.method === "GET" && p === "/api/pool") {
      return sendJSON(res, 200, { items: listPool() });
    }
    const indMatch = p.match(/^\/api\/industry\/([^/]+)$/);
    if (req.method === "GET" && indMatch) {
      const name = decodeURIComponent(indMatch[1]);
      const ind = getIndustry(name);
      return ind ? sendJSON(res, 200, ind) : sendJSON(res, 404, { error: "not found", name });
    }
    if (req.method === "GET" && p === "/api/materials") {
      return sendJSON(res, 200, { items: listMaterials() });
    }
    if (req.method === "GET" && p === "/api/research") {
      return sendJSON(res, 200, { items: listResearch() });
    }
    if (req.method === "GET" && p === "/api/plans") {
      return sendJSON(res, 200, { items: listPlans() });
    }
    if (req.method === "POST" && p === "/api/chat") {
      return await handleChat(req, res);
    }
    if (req.method === "POST" && p === "/api/upload") {
      return await handleUpload(req, res);
    }
    if (req.method === "GET") {
      return await serveStatic(req, res);
    }
    sendJSON(res, 404, { error: "no route", method: req.method, path: p });
  } catch (err: any) {
    sendJSON(res, 500, { error: err?.message ?? String(err) });
  }
});

ensureSeed();
server.listen(PORT, HOST, () => {
  console.log(`[server] 投研工作台 http://${HOST}:${PORT}`);
});

// 预热 agent（后台，不阻塞监听）
initInvestAgent().catch((e) => console.error("[agent 预热失败]", e));
