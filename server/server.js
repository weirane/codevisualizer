const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { analyzeProject } = require("../src/analyzers/projectAnalyzer");
const { generateTextSummary } = require("../src/analyzers/textSummary");

const HOST = "0.0.0.0";
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStaticFile(res, url.pathname === "/" ? "/index.html" : url.pathname);
  } catch (error) {
    console.error("Unhandled error in request handler", error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/analyze") {
    const body = await readJsonBody(req, res);
    if (!body) {
      return;
    }

    const { rootPath } = body;
    if (!rootPath || typeof rootPath !== "string") {
      sendJson(res, 400, { error: "rootPath must be a non-empty string" });
      return;
    }

    const absPath = path.resolve(rootPath);
    if (!fs.existsSync(absPath)) {
      sendJson(res, 404, { error: `Path does not exist: ${absPath}` });
      return;
    }

    try {
      console.time(`analysis-${absPath}`);
      const report = await analyzeProject(absPath);
      console.timeEnd(`analysis-${absPath}`);
      report.narrative = generateTextSummary(report);
      sendJson(res, 200, report);
    } catch (error) {
      console.error("Analysis failed", error);
      sendJson(res, 500, {
        error: `Failed to analyze project: ${error.message}`,
      });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/source") {
    const body = await readJsonBody(req, res);
    if (!body) {
      return;
    }

    const { rootPath, filePath, maxBytes = 200 * 1024 } = body;
    if (!rootPath || !filePath) {
      sendJson(res, 400, { error: "rootPath and filePath are required" });
      return;
    }

    try {
      const response = readSourceSnippet(rootPath, filePath, maxBytes);
      sendJson(res, 200, response);
    } catch (error) {
      const status = error.code === "ENOENT" ? 404 : error.statusCode || 500;
      sendJson(res, status, {
        error: error.message || "Failed to read source file",
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function serveStaticFile(res, relativePath) {
  const safeRelativePath = sanitizePath(relativePath);
  const filePath = path.resolve(PUBLIC_DIR, safeRelativePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Access denied" });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        sendJson(res, 404, { error: "Not found" });
      } else {
        console.error("Static file error", err);
        sendJson(res, 500, { error: "Internal server error" });
      }
      return;
    }

    res.writeHead(200, { "Content-Type": getMimeType(filePath) });
    res.end(data);
  });
}

function sanitizePath(relativePath) {
  const normalized = path.posix.normalize(relativePath);
  return normalized.startsWith("/") ? normalized.slice(1) : normalized;
}

function getMimeType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req, res) {
  return new Promise((resolve) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) {
        sendJson(res, 413, { error: "Payload too large" });
        req.destroy();
        resolve(null);
      }
    });

    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(data);
        resolve(parsed);
      } catch (error) {
        sendJson(res, 400, { error: "Invalid JSON body" });
        resolve(null);
      }
    });

    req.on("error", (error) => {
      console.error("Error reading request body", error);
      sendJson(res, 400, { error: "Invalid request body" });
      resolve(null);
    });
  });
}

function readSourceSnippet(rootPath, relativePath, maxBytes) {
  const absRoot = path.resolve(rootPath);
  const absFile = path.resolve(absRoot, relativePath);

  if (!absFile.startsWith(absRoot)) {
    const error = new Error("Access denied");
    error.statusCode = 403;
    throw error;
  }

  const stats = fs.statSync(absFile);
  if (!stats.isFile()) {
    const error = new Error("Not a file");
    error.statusCode = 400;
    throw error;
  }

  const limit = Math.max(1024, Math.min(maxBytes, 512 * 1024));
  const handle = fs.openSync(absFile, "r");
  try {
    const size = Math.min(limit, stats.size);
    const buffer = Buffer.alloc(size);
    fs.readSync(handle, buffer, 0, size, 0);
    const content = buffer.toString("utf8");
    const truncated = stats.size > size;
    return { path: relativePath, size: stats.size, content, truncated };
  } finally {
    fs.closeSync(handle);
  }
}
