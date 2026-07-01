const fs = require("node:fs");
const path = require("node:path");
const cors = require("cors");
const express = require("express");
const env = require("./config/env");
const { createStore } = require("./data/store");
const { createApiRouter } = require("./routes/api");

async function main() {
  const app = express();
  const store = createStore(env);

  await store.init();

  app.disable("x-powered-by");
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "20mb" }));
  app.use(
    "/uploads",
    express.static(env.uploadDir, {
      immutable: true,
      maxAge: "30d",
    }),
  );
  app.use("/api", createApiRouter(store, env));
  app.use("/api", (req, res) => {
    res.status(404).json({ code: 404, message: "API not found", data: null });
  });

  const distDir = path.join(env.rootDir, "dist");
  if (env.nodeEnv === "development") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: env.rootDir,
      appType: "custom",
      server: {
        middlewareMode: true,
      },
    });

    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      try {
        const templatePath = path.join(env.rootDir, "index.html");
        const template = await fs.promises.readFile(templatePath, "utf8");
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (error) {
        vite.ssrFixStacktrace(error);
        next(error);
      }
    });
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, {
      maxAge: "30d",
      immutable: true,
      setHeaders(res, filePath) {
        if (path.basename(filePath) === "index.html") {
          res.setHeader("Cache-Control", "no-cache");
          return;
        }
        if (!path.extname(filePath)) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }));
    app.get("*", (req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.use((req, res) => {
    res.status(404).json({ code: 404, message: "Not found", data: null });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(500).json({
      code: 500,
      message: error.message || "server error",
      data: null,
    });
  });

  app.listen(env.port, () => {
    const storage = store.info();
    console.log(`Campus Light Market API running at http://127.0.0.1:${env.port}`);
    console.log(`Storage mode: ${storage.mode}; MySQL database: ${storage.mysqlDatabase}`);
    if (storage.lastError) console.warn(`MySQL unavailable, fallback to JSON: ${storage.lastError}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
