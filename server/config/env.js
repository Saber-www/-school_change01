const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireSafeIdentifier(name, label) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`${label} 只能包含字母、数字和下划线`);
  }
  return name;
}

const mysqlDatabase = requireSafeIdentifier(
  process.env.MYSQL_DATABASE || "campus_light_market_03",
  "MYSQL_DATABASE",
);

const rootDir = path.resolve(__dirname, "../..");

module.exports = {
  port: toNumber(process.env.PORT, 3000),
  rootDir,
  nodeEnv: process.env.NODE_ENV || "development",
  uploadDir: path.resolve(rootDir, process.env.UPLOAD_DIR || "uploads"),
  mysql: {
    enabled: process.env.MYSQL_ENABLED !== "false",
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: toNumber(process.env.MYSQL_PORT, 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: mysqlDatabase,
  },
};
