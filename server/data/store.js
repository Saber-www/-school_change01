const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");

function createStore(env) {
  const dataDir = path.join(env.rootDir, "data");
  const dataFile = path.join(dataDir, "database.json");
  let mode = "json";
  let pool = null;
  let lastError = null;

  const dbName = env.mysql.database;
  const dbIdentifier = `\`${dbName}\``;

  async function readSeed() {
    const raw = await fs.readFile(dataFile, "utf8");
    return JSON.parse(raw);
  }

  function nextId(collection) {
    return collection.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
  }

  function mergeDemoUsers(users = [], fallbackUsers = []) {
    const merged = users.map((user) => ({ ...user }));
    fallbackUsers.forEach((seedUser) => {
      const existing = merged.find((user) => user.id === seedUser.id || user.account === seedUser.account);
      if (!existing) {
        merged.push({ ...seedUser });
        return;
      }
      Object.entries(seedUser).forEach(([key, value]) => {
        if (existing[key] === undefined || existing[key] === "") existing[key] = value;
      });
      existing.password = seedUser.password;
    });
    return merged;
  }

  function mergeSeedRecords(records = [], fallbackRecords = [], signatureOf) {
    const merged = records.map((record) => ({ ...record }));
    const signatures = new Set(merged.map(signatureOf));
    fallbackRecords.forEach((seedRecord) => {
      if (signatures.has(signatureOf(seedRecord))) return;
      const nextRecord = JSON.parse(JSON.stringify(seedRecord));
      if (merged.some((record) => record.id === nextRecord.id)) {
        nextRecord.id = nextId(merged);
      }
      merged.push(nextRecord);
      signatures.add(signatureOf(nextRecord));
    });
    return merged;
  }

  function mergeCategories(categories = {}, fallbackCategories = {}) {
    const merged = JSON.parse(JSON.stringify(categories));
    Object.entries(fallbackCategories).forEach(([channel, values]) => {
      merged[channel] = merged[channel] || [];
      values.forEach((value) => {
        if (!merged[channel].includes(value)) merged[channel].push(value);
      });
    });
    return merged;
  }

  function normalizeState(data, seed) {
    const normalized = { ...seed, ...data };
    normalized.users = mergeDemoUsers(normalized.users, seed.users);
    normalized.verifications = mergeSeedRecords(
      normalized.verifications,
      seed.verifications,
      (item) => `user:${item.userId}:${item.studentNo}`,
    );
    normalized.listings = mergeSeedRecords(normalized.listings, seed.listings, (item) => `listing:${item.channel}:${item.title}`);
    normalized.tasks = mergeSeedRecords(normalized.tasks, seed.tasks, (item) => `task:${item.channel}:${item.title}`);
    normalized.announcements = mergeSeedRecords(normalized.announcements, seed.announcements, (item) => `announcement:${item.title}`);
    normalized.categories = mergeCategories(normalized.categories, seed.categories);
    return normalized;
  }

  async function ensureJsonFile(seed) {
    await fs.mkdir(dataDir, { recursive: true });
    try {
      await fs.access(dataFile);
    } catch {
      await fs.writeFile(dataFile, JSON.stringify(seed, null, 2));
    }
  }

  function parseState(value) {
    if (!value) return null;
    if (typeof value === "string") return JSON.parse(value);
    return value;
  }

  async function initMysql(seed) {
    const rootConnection = await mysql.createConnection({
      host: env.mysql.host,
      port: env.mysql.port,
      user: env.mysql.user,
      password: env.mysql.password,
      multipleStatements: false,
    });

    await rootConnection.query(
      `CREATE DATABASE IF NOT EXISTS ${dbIdentifier} DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_0900_ai_ci`,
    );
    await rootConnection.end();

    pool = mysql.createPool({
      host: env.mysql.host,
      port: env.mysql.port,
      user: env.mysql.user,
      password: env.mysql.password,
      database: env.mysql.database,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: false,
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        id TINYINT PRIMARY KEY,
        data JSON NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);

    const [rows] = await pool.query("SELECT id FROM app_state WHERE id = 1 LIMIT 1");
    if (!rows.length) {
      await pool.execute("INSERT INTO app_state (id, data) VALUES (1, ?)", [JSON.stringify(seed)]);
    }
  }

  async function init() {
    const seed = await readSeed();
    await ensureJsonFile(seed);

    if (!env.mysql.enabled) {
      mode = "json";
      return;
    }

    try {
      await initMysql(seed);
      mode = "mysql";
      lastError = null;
    } catch (error) {
      mode = "json";
      pool = null;
      lastError = error;
    }
  }

  async function read() {
    const seed = await readSeed();
    if (mode === "mysql" && pool) {
      const [rows] = await pool.query("SELECT data FROM app_state WHERE id = 1 LIMIT 1");
      if (rows.length) {
        const state = parseState(rows[0].data);
        const normalized = normalizeState(state, seed);
        if (JSON.stringify(state) !== JSON.stringify(normalized)) await write(normalized);
        return normalized;
      }
      await write(seed);
      return seed;
    }

    await ensureJsonFile(seed);
    const state = JSON.parse(await fs.readFile(dataFile, "utf8"));
    const normalized = normalizeState(state, seed);
    if (JSON.stringify(state) !== JSON.stringify(normalized)) await write(normalized);
    return normalized;
  }

  async function write(data) {
    if (mode === "mysql" && pool) {
      await pool.execute(
        "INSERT INTO app_state (id, data) VALUES (1, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)",
        [JSON.stringify(data)],
      );
      return;
    }

    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
  }

  async function reset() {
    const seed = await readSeed();
    await write(seed);
    return seed;
  }

  function info() {
    return {
      mode,
      mysqlDatabase: env.mysql.database,
      lastError: lastError ? lastError.message : "",
    };
  }

  return {
    init,
    read,
    write,
    reset,
    info,
  };
}

module.exports = { createStore };
