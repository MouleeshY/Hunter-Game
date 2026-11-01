/**
 * The API as a plain Node server.
 *
 *   node --experimental-strip-types api/node.ts   (or `bun api/node.ts`)
 *
 * It needs no framework adapter: Node 18+ ships a global `fetch`/`Request`/
 * `Response` implementation, and Hono speaks those. Serverless platforms use
 * `api/index.ts` instead; this file exists so the same API runs anywhere Node
 * does — including `node` on a $5 VPS.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getApp } from "./index";

const PORT = Number(process.env.PORT ?? 8787);

async function readBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const buffer = Buffer.concat(chunks);
  return buffer.length === 0 ? undefined : new Uint8Array(buffer);
}

function toRequest(req: IncomingMessage, body: Uint8Array | undefined): Request {
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = req.method ?? "GET";
  const payload =
    method === "GET" || method === "HEAD" || body === undefined
      ? undefined
      : (body.buffer.slice(
          body.byteOffset,
          body.byteOffset + body.byteLength,
        ) as ArrayBuffer);
  return new Request(url, { method, headers, body: payload });
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  const chunks: Uint8Array[] = [];
  const reader = response.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  }
  const payload = Buffer.concat(chunks);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(payload);
}

const server = createServer(async (req, res) => {
  try {
    const body = await readBody(req);
    const response = await getApp().fetch(toRequest(req, body));
    await writeResponse(res, response);
  } catch (cause) {
    console.error("api request failed", cause);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error." }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`Shadow Hunt API listening on http://localhost:${PORT}`);
});
