const http = require("http");
const fs = require("fs");
const path = require("path");
const { handleAgentRequest, readJsonBody } = require("./lib/agent-runtime");
const { handleTranscribeRequest, readBinaryBody } = require("./lib/transcribe-runtime");

const useDist = process.argv.includes("--dist");
const root = path.join(process.cwd(), useDist ? "dist" : "public");
const requestedPort = Number(process.env.PORT || 5173);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function cacheControlFor(extension) {
  if ([".html", ".js", ".css", ".json"].includes(extension)) {
    return "no-store";
  }
  return "public, max-age=3600";
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function safeStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const filePath = path.normalize(path.join(root, requested));
  return filePath.startsWith(root) ? filePath : null;
}

async function requestHandler(req, res) {
  const pathname = (req.url || "/").split("?")[0];

  if (pathname === "/api/agent" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const result = await handleAgentRequest(body);
      sendJson(res, 200, result);
    } catch {
      sendJson(res, 400, { ok: false, error: "bad_request" });
    }
    return;
  }

  if (pathname === "/api/transcribe" && req.method === "POST") {
    try {
      const buffer = await readBinaryBody(req);
      const result = await handleTranscribeRequest({ headers: req.headers, buffer });
      sendJson(res, 200, result);
    } catch {
      sendJson(res, 400, { ok: false, error: "bad_audio", message: "我没有听清楚。可以再说一次，或者打字。" });
    }
    return;
  }

  if (req.url && pathname.startsWith("/api/")) {
    sendJson(res, 404, { ok: false, error: "not_found" });
    return;
  }

  const filePath = safeStaticPath(req.url || "/");
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(root, "index.html"), (indexError, indexData) => {
        if (indexError) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
        res.end(indexData);
      });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": cacheControlFor(extension),
    });
    res.end(data);
  });
}

function listen(port, attemptsLeft) {
  const server = http.createServer(requestHandler);
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(error);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`EAZO storybook running at http://localhost:${port}`);
    console.log(`Serving ${useDist ? "dist" : "public"} with optional /api/agent and /api/transcribe fallback.`);
  });
}

listen(requestedPort, 20);
