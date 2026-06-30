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
  const schemaFile = path.join(env.rootDir, "db/schema.sql");
  const mirrorTables = [
    "admin_audit_log",
    "notification",
    "review",
    "report",
    "browse_history",
    "favorite",
    "message",
    "conversation",
    "task_status_log",
    "task_order",
    "listing_image",
    "listing",
    "campus_verification",
    "category",
    "admin_user",
    "user",
  ];

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

  function statusCode(value, fallback = 0) {
    const statusMap = {
      正常: 0,
      禁言: 1,
      封禁: 1,
      注销: 2,
    };
    return statusMap[value] ?? fallback;
  }

  function userVerifyStatusCode(value, fallback = 0) {
    const statusMap = {
      未认证: 0,
      待审核: 1,
      已认证: 2,
      通过: 2,
      驳回: 3,
    };
    return statusMap[value] ?? fallback;
  }

  function verificationStatusCode(value, fallback = 0) {
    const statusMap = {
      待审核: 0,
      通过: 1,
      已认证: 1,
      驳回: 2,
    };
    return statusMap[value] ?? fallback;
  }

  function listingStatusCode(value, fallback = 0) {
    const statusMap = {
      待审核: 0,
      展示中: 1,
      已完成: 2,
      已成交: 2,
      已解决: 2,
      已下架: 3,
      驳回: 3,
    };
    return statusMap[value] ?? fallback;
  }

  function taskStatusCode(value, fallback = 1) {
    const statusMap = {
      待接单: 1,
      进行中: 2,
      已完成: 3,
      已取消: 4,
      申诉中: 5,
    };
    return statusMap[value] ?? fallback;
  }

  function reportStatusCode(value, fallback = 0) {
    const statusMap = {
      待处理: 0,
      已处理: 1,
      驳回: 2,
    };
    return statusMap[value] ?? fallback;
  }

  function readStatusCode(value, fallback = 0) {
    const statusMap = {
      未读: 0,
      已读: 1,
    };
    return statusMap[value] ?? fallback;
  }

  function mysqlDate(value, fallbackToNow = true) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
      if (!fallbackToNow) return null;
      const now = new Date();
      return now.toISOString().slice(0, 19).replace("T", " ");
    }
    const safeDate = value ? date : new Date();
    return safeDate.toISOString().slice(0, 19).replace("T", " ");
  }

  function nullableDate(value) {
    return value ? mysqlDate(value, false) : null;
  }

  function boolCode(value) {
    return value ? 1 : 0;
  }

  function numberOrNull(value) {
    if (value === "" || value === undefined || value === null) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function text(value, fallback = "", max = 255) {
    const normalized = value === undefined || value === null ? fallback : String(value);
    return normalized.slice(0, max);
  }

  function campusId(value) {
    const map = {
      主校区: 1,
      东校区: 2,
      西校区: 3,
      南校区: 4,
    };
    return map[value] || null;
  }

  function targetType(value) {
    const map = {
      listing: "listing",
      task: "task",
      user: "user",
      message: "message",
      帖子: "listing",
      任务: "task",
      用户: "user",
      消息: "message",
    };
    return map[value] || text(value || "listing", "listing", 30);
  }

  function buildCategoryRows(categories = {}) {
    const rows = [];
    const ids = new Map();
    let id = 1;
    Object.entries(categories || {}).forEach(([channel, names]) => {
      (names || []).forEach((name, index) => {
        const categoryName = text(name, "其他", 50);
        rows.push({
          id,
          parentId: 0,
          channel: text(channel, "其他", 30),
          name: categoryName,
          sortOrder: index + 1,
          status: 0,
          createdAt: mysqlDate(),
        });
        ids.set(`${channel}:${categoryName}`, id);
        id += 1;
      });
    });
    return { rows, ids };
  }

  function stripSqlComments(sql) {
    return sql
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
  }

  async function ensureSchemaTables() {
    const schema = await fs.readFile(schemaFile, "utf8");
    const statements = stripSqlComments(schema)
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await pool.query(statement);
    }
  }

  async function clearMirrorTables(connection) {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of mirrorTables) {
      await connection.query(`DELETE FROM \`${table}\``);
    }
  }

  async function syncStateToTables(data) {
    if (!pool || !data) return;
    await ensureSchemaTables();

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await clearMirrorTables(connection);

      for (const user of data.users || []) {
        const isAdmin = user.role === "admin";
        const row = [
          Number(user.id) || null,
          text(user.account || user.username, "", 50),
          text(user.password || user.passwordHash, "", 255),
          text(user.nickname || user.account || user.username || "用户", "用户", 50),
          text(user.avatarUrl || user.avatar_url || "", "", 255) || null,
          text(user.phone || "", "", 30) || null,
          text(user.email || "", "", 100) || null,
          numberOrNull(user.schoolId || user.school_id),
          numberOrNull(user.campusId || user.campus_id),
          userVerifyStatusCode(user.verifyStatus ?? user.verify_status),
          Number(user.creditScore ?? user.credit_score ?? 60),
          statusCode(user.status),
          mysqlDate(user.createdAt || user.created_at),
          mysqlDate(user.updatedAt || user.updated_at),
        ];
        await connection.execute(
          `
            INSERT INTO \`user\` (
              id, username, password_hash, nickname, avatar_url, phone, email, school_id, campus_id,
              verify_status, credit_score, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          row,
        );

        if (isAdmin) {
          await connection.execute(
            "INSERT INTO admin_user (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [row[0], row[1], row[2], text(user.adminRole || "admin", "admin", 30), row[11], row[12]],
          );
        }
      }

      const { rows: categoryRows, ids: categoryIds } = buildCategoryRows(data.categories || {});
      for (const category of categoryRows) {
        await connection.execute(
          "INSERT INTO category (id, parent_id, channel, name, sort_order, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [category.id, category.parentId, category.channel, category.name, category.sortOrder, category.status, category.createdAt],
        );
      }

      for (const record of data.verifications || []) {
        await connection.execute(
          `
            INSERT INTO campus_verification (
              id, user_id, real_name, student_no, method, proof_url, status, reject_reason, reviewed_by, reviewed_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            Number(record.id) || null,
            Number(record.userId) || null,
            text(record.realName, "", 50),
            text(record.studentNo, "", 50),
            text(record.method, "学号", 30),
            text(record.proofUrl || "", "", 255) || null,
            verificationStatusCode(record.status),
            text(record.rejectReason || "", "", 255) || null,
            numberOrNull(record.reviewedBy),
            nullableDate(record.reviewedAt),
            mysqlDate(record.createdAt),
          ],
        );
      }

      for (const listing of data.listings || []) {
        const categoryId = categoryIds.get(`${listing.channel}:${listing.category}`) || null;
        await connection.execute(
          `
            INSERT INTO listing (
              id, publisher_id, channel, category_id, title, description, price, budget_min, budget_max,
              condition_level, campus_id, location_text, trade_method, contact_mode, status, view_count,
              favorite_count, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            Number(listing.id) || null,
            Number(listing.publisherId) || null,
            text(listing.channel, "闲置转让", 30),
            categoryId,
            text(listing.title, "", 80),
            text(listing.description, "", 65535),
            numberOrNull(listing.price),
            numberOrNull(listing.budgetMin),
            numberOrNull(listing.budgetMax),
            text(listing.conditionLevel || "", "", 30) || null,
            campusId(listing.campus),
            text(listing.locationText || "", "", 120) || null,
            text(listing.tradeMethod || "", "", 30) || null,
            text(listing.contactMode || "站内沟通", "站内沟通", 30),
            listingStatusCode(listing.status),
            Number(listing.viewCount || 0),
            Number(listing.favoriteCount || 0),
            mysqlDate(listing.createdAt),
            mysqlDate(listing.updatedAt || listing.createdAt),
          ],
        );

        for (const [index, image] of (listing.images || []).entries()) {
          await connection.execute(
            "INSERT INTO listing_image (listing_id, image_url, sort_order, created_at) VALUES (?, ?, ?, ?)",
            [Number(listing.id) || null, text(image, "", 255), index + 1, mysqlDate(listing.createdAt)],
          );
        }
      }

      for (const task of data.tasks || []) {
        await connection.execute(
          `
            INSERT INTO task_order (
              id, publisher_id, taker_id, task_type, title, description, pickup_location, delivery_location,
              campus_id, reward, deadline_at, item_note, proof_required, status, cancel_reason, completed_at,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            Number(task.id) || null,
            Number(task.publisherId) || null,
            numberOrNull(task.takerId),
            text(task.taskType || task.channel || "other", "other", 30),
            text(task.title, "", 80),
            text(task.description, "", 65535),
            text(task.pickupLocation, "", 120),
            text(task.deliveryLocation, "", 120),
            campusId(task.campus),
            numberOrNull(task.reward) ?? 0,
            mysqlDate(task.deadlineAt),
            text(task.itemNote || "", "", 255) || null,
            boolCode(task.proofRequired),
            taskStatusCode(task.status),
            text(task.cancelReason || "", "", 255) || null,
            nullableDate(task.completedAt),
            mysqlDate(task.createdAt),
            mysqlDate(task.updatedAt || task.createdAt),
          ],
        );

        let previousStatus = null;
        for (const item of task.timeline || []) {
          await connection.execute(
            "INSERT INTO task_status_log (task_id, operator_id, from_status, to_status, remark, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [
              Number(task.id) || null,
              Number(task.takerId || task.publisherId) || null,
              previousStatus,
              taskStatusCode(task.status),
              text(item.text || "", "", 255),
              mysqlDate(item.time || task.updatedAt || task.createdAt),
            ],
          );
          previousStatus = taskStatusCode(task.status);
        }
      }

      for (const conversation of data.conversations || []) {
        const participants = conversation.participants || [];
        const lastMessage = (conversation.messages || [])[conversation.messages?.length - 1] || null;
        await connection.execute(
          `
            INSERT INTO conversation (
              id, target_type, target_id, buyer_id, seller_id, last_message, last_message_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            Number(conversation.id) || null,
            targetType(conversation.kind),
            Number(conversation.itemId) || null,
            Number(participants[0]) || 0,
            Number(participants[1] || participants[0]) || 0,
            text(lastMessage?.text || "", "", 255) || null,
            nullableDate(lastMessage?.createdAt || conversation.updatedAt),
            mysqlDate((conversation.messages || [])[0]?.createdAt || conversation.updatedAt),
          ],
        );

        for (const message of conversation.messages || []) {
          await connection.execute(
            "INSERT INTO message (conversation_id, sender_id, content, message_type, read_status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [
              Number(conversation.id) || null,
              Number(message.senderId) || null,
              text(message.text || message.content || "", "", 65535),
              text(message.messageType || "text", "text", 20),
              readStatusCode(message.readStatus),
              mysqlDate(message.createdAt),
            ],
          );
        }
      }

      for (const favorite of data.favorites || []) {
        await connection.execute(
          "INSERT INTO favorite (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)",
          [Number(favorite.userId) || null, targetType(favorite.kind || favorite.targetType), Number(favorite.id || favorite.targetId) || null, mysqlDate(favorite.createdAt)],
        );
      }

      for (const history of data.browseHistory || []) {
        await connection.execute(
          "INSERT INTO browse_history (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)",
          [Number(history.userId) || null, targetType(history.kind || history.targetType), Number(history.id || history.targetId) || null, mysqlDate(history.createdAt)],
        );
      }

      for (const report of data.reports || []) {
        await connection.execute(
          `
            INSERT INTO report (
              id, reporter_id, target_type, target_id, reason, description, evidence_url, status,
              handled_by, handled_at, handle_result, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            Number(report.id) || null,
            Number(report.reporterId) || null,
            targetType(report.targetKind || report.targetType),
            Number(report.targetId) || null,
            text(report.reason, "", 100),
            text(report.description || "", "", 65535) || null,
            text(report.evidenceUrl || report.evidence_url || "", "", 255) || null,
            reportStatusCode(report.status),
            numberOrNull(report.handledBy),
            nullableDate(report.handledAt),
            text(report.result || report.handleResult || "", "", 255) || null,
            mysqlDate(report.createdAt),
          ],
        );
      }

      for (const review of data.reviews || []) {
        await connection.execute(
          "INSERT INTO review (id, reviewer_id, target_user_id, target_type, target_id, rating, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            Number(review.id) || null,
            Number(review.reviewerId) || null,
            Number(review.targetUserId) || null,
            targetType(review.targetType),
            Number(review.targetId) || null,
            Math.min(5, Math.max(1, Number(review.rating || 5))),
            text(review.content || "", "", 255) || null,
            mysqlDate(review.createdAt),
          ],
        );
      }

      for (const notification of data.notifications || []) {
        await connection.execute(
          "INSERT INTO notification (id, user_id, title, content, read_status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          [
            Number(notification.id) || null,
            Number(notification.userId) || null,
            text(notification.title, "", 100),
            text(notification.content, "", 255),
            readStatusCode(notification.readStatus),
            mysqlDate(notification.createdAt),
          ],
        );
      }

      for (const log of data.auditLogs || []) {
        await connection.execute(
          "INSERT INTO admin_audit_log (id, admin_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            Number(log.id) || null,
            Number(log.adminId) || null,
            text(log.action || log.text || "操作日志", "操作日志", 50),
            text(log.targetType || "system", "system", 30),
            numberOrNull(log.targetId),
            text(log.detail || log.text || "", "", 65535),
            mysqlDate(log.createdAt),
          ],
        );
      }

      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      connection.release();
    }
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

    await ensureSchemaTables();

    const [rows] = await pool.query("SELECT id FROM app_state WHERE id = 1 LIMIT 1");
    if (!rows.length) {
      await pool.execute("INSERT INTO app_state (id, data) VALUES (1, ?)", [JSON.stringify(seed)]);
    }

    const [stateRows] = await pool.query("SELECT data FROM app_state WHERE id = 1 LIMIT 1");
    const state = stateRows.length ? parseState(stateRows[0].data) : seed;
    await syncStateToTables(normalizeState(state, seed));
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
        if (JSON.stringify(state) !== JSON.stringify(normalized)) {
          await write(normalized);
        } else {
          await syncStateToTables(normalized);
        }
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
      await syncStateToTables(data);
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
