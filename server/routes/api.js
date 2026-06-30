const crypto = require("node:crypto");
const express = require("express");

const PUBLIC_LISTING_STATUSES = ["展示中"];
const FORBIDDEN_WORDS = ["代考", "代课", "代签到", "代写", "论文代写", "药品", "管制刀具", "烟酒", "刷单", "账号交易", "身份证"];

const sessions = new Map();

function createApiRouter(store) {
  const router = express.Router();

  const wrap = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

  function ok(res, data = {}) {
    res.json({ code: 0, message: "ok", data });
  }

  function fail(res, status, message, code = status) {
    res.status(status).json({ code, message, data: null });
  }

  function tokenFrom(req) {
    const header = req.headers.authorization || "";
    if (header.startsWith("Bearer ")) return header.slice(7);
    return req.headers["x-demo-token"] || "";
  }

  function currentUser(req, db) {
    const token = tokenFrom(req);
    const id = sessions.get(token);
    if (id) return db.users.find((user) => user.id === id) || null;
    return null;
  }

  function requireUser(req, res, db, options = {}) {
    const user = currentUser(req, db);
    if (!user) {
      fail(res, 401, "请先登录");
      return null;
    }
    if (user.status !== "正常") {
      fail(res, 403, "账号状态不可用");
      return null;
    }
    if (options.verified && user.verifyStatus !== "已认证" && user.role !== "admin") {
      fail(res, 403, "请先完成校园认证");
      return null;
    }
    if (options.admin && user.role !== "admin") {
      fail(res, 403, "需要管理员权限");
      return null;
    }
    return user;
  }

  function nextId(collection) {
    return collection.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
  }

  function now() {
    return new Date().toISOString();
  }

  function scanForbidden(text) {
    return FORBIDDEN_WORDS.filter((word) => text.includes(word));
  }

  function canReadListing(user, listing) {
    if (!listing) return false;
    return PUBLIC_LISTING_STATUSES.includes(listing.status);
  }

  function matchesQuery(item, query) {
    if (!query) return true;
    const text = [
      item.channel,
      item.category,
      item.taskType,
      item.title,
      item.description,
      item.campus,
      item.locationText,
      item.pickupLocation,
      item.deliveryLocation,
      item.conditionLevel,
      item.contactMode,
      item.status,
      item.itemNote,
      ...(item.tags || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.includes(String(query).toLowerCase());
  }

  function paginate(records, req) {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 20)));
    const start = (page - 1) * pageSize;
    return {
      records: records.slice(start, start + pageSize),
      page,
      pageSize,
      total: records.length,
    };
  }

  function addAudit(db, adminId, action, targetType, targetId, detail) {
    db.auditLogs = db.auditLogs || [];
    db.auditLogs.push({
      id: nextId(db.auditLogs),
      adminId,
      action,
      targetType,
      targetId,
      text: `${action}：${detail}`,
      detail,
      createdAt: now(),
    });
  }

  function filterByQuery(records, req, fields = [["channel", "channel"], ["campus", "campus"], ["status", "status"]]) {
    let filtered = records.filter((item) => matchesQuery(item, req.query.q || ""));
    for (const [param, field] of fields) {
      const value = req.query[param];
      if (value && value !== "全部") filtered = filtered.filter((item) => item[field] === value);
    }
    return filtered;
  }

  router.get("/health", (req, res) => {
    ok(res, { status: "up", version: "v3.0", storage: store.info() });
  });

  router.get("/bootstrap", wrap(async (req, res) => {
    ok(res, await store.read());
  }));

  router.put("/bootstrap", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db);
    if (!user) return;
    await store.write(req.body || {});
    ok(res, req.body || {});
  }));

  router.post("/dev/reset", wrap(async (req, res) => {
    const db = await store.read();
    const admin = requireUser(req, res, db, { admin: true });
    if (!admin) return;
    ok(res, await store.reset());
  }));

  router.post("/auth/register", wrap(async (req, res) => {
    const db = await store.read();
    const body = req.body || {};
    if (!body.account || !body.password || !body.nickname) return fail(res, 400, "账号、密码和昵称必填");
    if (db.users.some((user) => user.account === body.account)) return fail(res, 409, "账号已存在");

    const user = {
      id: nextId(db.users),
      account: String(body.account).trim(),
      password: String(body.password),
      nickname: String(body.nickname).trim(),
      phone: body.phone || "",
      email: body.email || "",
      campus: body.campus || "主校区",
      verifyStatus: "未认证",
      creditScore: 60,
      status: "正常",
      role: "user",
      createdAt: now(),
      updatedAt: now(),
    };
    db.users.push(user);
    await store.write(db);

    const token = crypto.randomUUID();
    sessions.set(token, user.id);
    ok(res, { token, user });
  }));

  router.post("/auth/login", wrap(async (req, res) => {
    const db = await store.read();
    const body = req.body || {};
    const account = String(body.account || "").toLowerCase();
    const user = db.users.find(
      (item) =>
        [item.account, item.nickname, item.email, item.phone].some((value) => String(value).toLowerCase() === account) &&
        item.password === body.password,
    );
    if (!user) return fail(res, 401, "账号或密码不正确");
    if (user.status !== "正常") return fail(res, 403, "账号状态不可用");

    const token = crypto.randomUUID();
    sessions.set(token, user.id);
    ok(res, { token, user });
  }));

  router.post("/auth/logout", (req, res) => {
    sessions.delete(tokenFrom(req));
    ok(res);
  });

  router.get("/users/me", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db);
    if (user) ok(res, user);
  }));

  router.put("/users/me", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = req.body || {};
    Object.assign(user, {
      nickname: body.nickname ?? user.nickname,
      phone: body.phone ?? user.phone,
      email: body.email ?? user.email,
      campus: body.campus ?? user.campus,
      updatedAt: now(),
    });
    await store.write(db);
    ok(res, user);
  }));

  router.post("/verifications", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = req.body || {};
    const record = {
      id: nextId(db.verifications),
      userId: user.id,
      realName: body.realName || "",
      studentNo: body.studentNo || "",
      method: body.method || "学号",
      proofUrl: body.proofUrl || "",
      status: "待审核",
      rejectReason: "",
      reviewedBy: null,
      reviewedAt: "",
      createdAt: now(),
    };
    db.verifications.unshift(record);
    user.verifyStatus = "待审核";
    user.updatedAt = now();
    await store.write(db);
    ok(res, record);
  }));

  router.get("/verifications/me", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db);
    if (user) ok(res, db.verifications.filter((record) => record.userId === user.id));
  }));

  router.get("/listings", wrap(async (req, res) => {
    const db = await store.read();
    const user = currentUser(req, db);
    const records = filterByQuery(db.listings.filter((item) => canReadListing(user, item)), req);
    ok(res, paginate(records, req));
  }));

  router.get("/listings/:id", wrap(async (req, res) => {
    const db = await store.read();
    const listing = db.listings.find((item) => item.id === Number(req.params.id));
    if (!listing) return fail(res, 404, "帖子不存在");
    if (!canReadListing(currentUser(req, db), listing)) return fail(res, 404, "帖子不存在或已下架");
    listing.viewCount += 1;
    listing.updatedAt = now();
    await store.write(db);
    ok(res, listing);
  }));

  router.post("/listings", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db, { verified: true });
    if (!user) return;
    const body = req.body || {};
    const blocked = scanForbidden(`${body.title || ""} ${body.description || ""}`);
    if (blocked.length) return fail(res, 400, `命中禁发规则：${blocked.join("、")}`);

    const listing = {
      id: nextId(db.listings),
      publisherId: user.id,
      channel: body.channel || "闲置转让",
      category: body.category || "其他",
      title: body.title || "",
      description: body.description || "",
      price: body.price || "",
      originalPrice: body.originalPrice || "",
      budgetMin: body.budgetMin || "",
      budgetMax: body.budgetMax || "",
      conditionLevel: body.conditionLevel || "",
      campus: body.campus || user.campus,
      locationText: body.locationText || "",
      contactMode: body.contactMode || "站内沟通",
      status: body.status || "展示中",
      viewCount: 0,
      favoriteCount: 0,
      createdAt: now(),
      updatedAt: now(),
      images: body.images || [],
      tags: body.tags || ["站内沟通"],
    };
    db.listings.unshift(listing);
    await store.write(db);
    ok(res, listing);
  }));

  router.put("/listings/:id", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db, { verified: true });
    if (!user) return;
    const listing = db.listings.find((item) => item.id === Number(req.params.id));
    if (!listing) return fail(res, 404, "帖子不存在");
    if (listing.publisherId !== user.id && user.role !== "admin") return fail(res, 403, "不能编辑他人帖子");
    Object.assign(listing, req.body || {}, { updatedAt: now() });
    await store.write(db);
    ok(res, listing);
  }));

  router.post("/listings/:id/:action(online|offline|complete|favorite)", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db);
    if (!user) return;
    const listing = db.listings.find((item) => item.id === Number(req.params.id));
    if (!listing) return fail(res, 404, "帖子不存在");

    if (req.params.action === "favorite") {
      if (!canReadListing(user, listing)) return fail(res, 404, "帖子不存在或已下架");
      if (!db.favorites.some((fav) => fav.userId === user.id && fav.kind === "listing" && fav.id === listing.id)) {
        db.favorites.unshift({ userId: user.id, kind: "listing", id: listing.id, createdAt: now() });
        listing.favoriteCount += 1;
      }
    } else {
      if (listing.publisherId !== user.id && user.role !== "admin") return fail(res, 403, "只能管理自己的帖子");
      listing.status = req.params.action === "online" ? "展示中" : req.params.action === "offline" ? "已下架" : "已完成";
    }
    listing.updatedAt = now();
    await store.write(db);
    ok(res, listing);
  }));

  router.delete("/listings/:id/favorite", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db);
    if (!user) return;
    const id = Number(req.params.id);
    const before = db.favorites.length;
    db.favorites = db.favorites.filter((fav) => !(fav.userId === user.id && fav.kind === "listing" && fav.id === id));
    const listing = db.listings.find((item) => item.id === id);
    if (listing && db.favorites.length !== before) listing.favoriteCount = Math.max(0, listing.favoriteCount - 1);
    await store.write(db);
    ok(res, listing || {});
  }));

  router.get("/tasks", wrap(async (req, res) => {
    const db = await store.read();
    ok(res, paginate(filterByQuery(db.tasks, req), req));
  }));

  router.get("/tasks/:id", wrap(async (req, res) => {
    const db = await store.read();
    const task = db.tasks.find((item) => item.id === Number(req.params.id));
    if (!task) return fail(res, 404, "任务不存在");
    task.viewCount += 1;
    task.updatedAt = now();
    await store.write(db);
    ok(res, task);
  }));

  router.post("/tasks", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db, { verified: true });
    if (!user) return;
    const body = req.body || {};
    const blocked = scanForbidden(`${body.title || ""} ${body.description || ""} ${body.itemNote || ""}`);
    if (blocked.length) return fail(res, 400, `命中禁发规则：${blocked.join("、")}`);

    const task = {
      id: nextId(db.tasks),
      publisherId: user.id,
      takerId: null,
      channel: body.channel || "跑腿代取",
      taskType: body.taskType || body.category || "代取快递",
      title: body.title || "",
      description: body.description || "",
      pickupLocation: body.pickupLocation || "",
      deliveryLocation: body.deliveryLocation || "",
      campus: body.campus || user.campus,
      reward: Number(body.reward || 0),
      deadlineAt: body.deadlineAt || new Date(Date.now() + 3600000).toISOString(),
      itemNote: body.itemNote || "",
      proofRequired: Boolean(body.proofRequired),
      status: "待接单",
      cancelReason: "",
      completedAt: "",
      createdAt: now(),
      updatedAt: now(),
      viewCount: 0,
      favoriteCount: 0,
      timeline: [{ text: "任务发布，等待认证用户接单", time: now() }],
    };
    db.tasks.unshift(task);
    await store.write(db);
    ok(res, task);
  }));

  router.post("/tasks/:id/:action(accept|complete|cancel|release|restore-progress|restore-cancel)", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db, { verified: true });
    if (!user) return;
    const task = db.tasks.find((item) => item.id === Number(req.params.id));
    if (!task) return fail(res, 404, "任务不存在");

    const isPublisher = task.publisherId === user.id;
    const isTaker = task.takerId === user.id;
    if (req.params.action === "accept") {
      if (task.status !== "待接单") return fail(res, 409, "任务已被接单或状态不可接单");
      if (isPublisher) return fail(res, 403, "发布者不能接自己的任务");
      task.takerId = user.id;
      task.status = "进行中";
      task.previousStatus = "";
      task.previousTakerId = null;
      task.timeline.push({ text: `${user.nickname} 已接单并开始执行`, time: now() });
    } else if (req.params.action === "complete") {
      if (!isTaker || task.status !== "进行中") return fail(res, 403, "当前状态不可完成任务");
      task.previousStatus = task.status;
      task.previousTakerId = task.takerId;
      task.status = "已完成";
      task.completedAt = now();
      task.timeline.push({ text: "接单者完成任务，流程闭环", time: now() });
    } else if (req.params.action === "cancel") {
      if (!(isPublisher || isTaker) || ["已完成", "已取消"].includes(task.status)) return fail(res, 403, "当前状态不可取消");
      task.previousStatus = task.status;
      task.previousTakerId = task.takerId || null;
      task.status = "已取消";
      task.cancelReason = (req.body || {}).reason || "双方协商取消";
      task.timeline.push({ text: `任务取消：${task.cancelReason}`, time: now() });
    } else if (req.params.action === "release") {
      if (!isTaker || task.status !== "进行中") return fail(res, 403, "只有当前接单者可撤回接单");
      task.previousStatus = task.status;
      task.previousTakerId = task.takerId;
      task.takerId = null;
      task.status = "待接单";
      task.timeline.push({ text: `${user.nickname} 撤回接单，任务恢复待接单`, time: now() });
    } else if (req.params.action === "restore-progress") {
      if (!(isPublisher || isTaker) || task.status !== "已完成") return fail(res, 403, "当前状态不可恢复");
      task.status = "进行中";
      task.completedAt = "";
      if (!task.takerId && task.previousTakerId) task.takerId = task.previousTakerId;
      task.timeline.push({ text: "撤回完成操作，任务恢复进行中", time: now() });
    } else if (req.params.action === "restore-cancel") {
      if (!(isPublisher || isTaker) || task.status !== "已取消") return fail(res, 403, "当前状态不可恢复");
      const fallbackStatus = task.takerId ? "进行中" : "待接单";
      const restoredStatus = ["待接单", "进行中"].includes(task.previousStatus) ? task.previousStatus : fallbackStatus;
      task.status = restoredStatus;
      task.takerId = task.previousTakerId || (restoredStatus === "待接单" ? null : task.takerId);
      task.cancelReason = "";
      task.timeline.push({ text: `撤回取消操作，任务恢复为${restoredStatus}`, time: now() });
    }

    task.updatedAt = now();
    await store.write(db);
    ok(res, task);
  }));

  router.get("/conversations", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db, { verified: true });
    if (user) ok(res, db.conversations.filter((conv) => conv.participants.includes(user.id)));
  }));

  router.get("/conversations/:id/messages", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db, { verified: true });
    if (!user) return;
    const conversation = db.conversations.find((conv) => conv.id === Number(req.params.id));
    if (!conversation || !conversation.participants.includes(user.id)) return fail(res, 404, "会话不存在");
    ok(res, conversation.messages);
  }));

  router.post("/messages", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db, { verified: true });
    if (!user) return;
    const body = req.body || {};
    let conversation = body.conversationId ? db.conversations.find((conv) => conv.id === Number(body.conversationId)) : null;

    if (!conversation && body.targetType && body.targetId && body.receiverId) {
      if (body.targetType === "listing") {
        const listing = db.listings.find((item) => item.id === Number(body.targetId));
        if (!canReadListing(user, listing)) return fail(res, 404, "帖子不存在或已下架");
      }
      conversation = {
        id: nextId(db.conversations),
        participants: [user.id, Number(body.receiverId)].sort((a, b) => a - b),
        kind: body.targetType,
        itemId: Number(body.targetId),
        updatedAt: now(),
        readBy: { [user.id]: now() },
        messages: [],
      };
      db.conversations.unshift(conversation);
    }

    if (!conversation || !conversation.participants.includes(user.id)) return fail(res, 404, "会话不存在");
    const createdAt = now();
    const message = { senderId: user.id, text: body.content || body.text || "", createdAt };
    conversation.messages.push(message);
    conversation.updatedAt = createdAt;
    conversation.readBy = { ...(conversation.readBy || {}), [user.id]: createdAt };
    await store.write(db);
    ok(res, message);
  }));

  router.post("/reports", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = req.body || {};
    const report = {
      id: nextId(db.reports),
      reporterId: user.id,
      targetKind: body.targetKind || body.targetType || body.kind,
      targetId: Number(body.targetId || body.id),
      reason: body.reason || "",
      description: body.description || "",
      status: "待处理",
      result: "",
      createdAt: now(),
    };
    db.reports.unshift(report);
    await store.write(db);
    ok(res, report);
  }));

  router.delete("/reports/:id", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db);
    if (!user) return;
    const report = db.reports.find((item) => item.id === Number(req.params.id));
    if (!report || report.reporterId !== user.id) return fail(res, 404, "举报记录不存在");
    if (report.status !== "待处理") return fail(res, 409, "已处理的举报不能撤销");
    db.reports = db.reports.filter((item) => item.id !== report.id);
    await store.write(db);
    ok(res, { id: report.id });
  }));

  router.get("/reviews/target/:id", wrap(async (req, res) => {
    const db = await store.read();
    ok(res, db.reviews.filter((review) => review.targetId === Number(req.params.id)));
  }));

  router.post("/reviews", wrap(async (req, res) => {
    const db = await store.read();
    const user = requireUser(req, res, db, { verified: true });
    if (!user) return;
    const body = req.body || {};
    const review = {
      id: nextId(db.reviews),
      reviewerId: user.id,
      targetUserId: Number(body.targetUserId),
      targetType: body.targetType || "task",
      targetId: Number(body.targetId),
      rating: Number(body.rating || 5),
      content: body.content || "",
      createdAt: now(),
    };
    db.reviews.unshift(review);
    await store.write(db);
    ok(res, review);
  }));

  router.get("/admin/dashboard", wrap(async (req, res) => {
    const db = await store.read();
    const admin = requireUser(req, res, db, { admin: true });
    if (!admin) return;
    ok(res, {
      users: db.users.length,
      listings: db.listings.length,
      tasks: db.tasks.length,
      pendingVerifications: db.verifications.filter((item) => item.status === "待审核").length,
      pendingReports: db.reports.filter((item) => item.status === "待处理").length,
      completed: db.listings.filter((item) => item.status === "已完成").length + db.tasks.filter((item) => item.status === "已完成").length,
    });
  }));

  router.get("/admin/users", wrap(async (req, res) => {
    const db = await store.read();
    const admin = requireUser(req, res, db, { admin: true });
    if (admin) ok(res, paginate(db.users, req));
  }));

  router.post("/admin/users/:id/:action(ban|unban)", wrap(async (req, res) => {
    const db = await store.read();
    const admin = requireUser(req, res, db, { admin: true });
    if (!admin) return;
    const user = db.users.find((item) => item.id === Number(req.params.id));
    if (!user) return fail(res, 404, "用户不存在");
    user.status = req.params.action === "ban" ? "封禁" : "正常";
    addAudit(db, admin.id, req.params.action === "ban" ? "封禁用户" : "解封用户", "user", user.id, user.nickname);
    await store.write(db);
    ok(res, user);
  }));

  router.get("/admin/listings", wrap(async (req, res) => {
    const db = await store.read();
    const admin = requireUser(req, res, db, { admin: true });
    if (admin) ok(res, paginate(db.listings, req));
  }));

  router.post("/admin/listings/:id/:action(approve|remove)", wrap(async (req, res) => {
    const db = await store.read();
    const admin = requireUser(req, res, db, { admin: true });
    if (!admin) return;
    const listing = db.listings.find((item) => item.id === Number(req.params.id));
    if (!listing) return fail(res, 404, "帖子不存在");
    listing.status = req.params.action === "approve" ? "展示中" : "已下架";
    listing.updatedAt = now();
    addAudit(db, admin.id, `帖子${listing.status}`, "listing", listing.id, listing.title);
    await store.write(db);
    ok(res, listing);
  }));

  router.get("/admin/tasks", wrap(async (req, res) => {
    const db = await store.read();
    const admin = requireUser(req, res, db, { admin: true });
    if (admin) ok(res, paginate(db.tasks, req));
  }));

  router.get("/admin/verifications", wrap(async (req, res) => {
    const db = await store.read();
    const admin = requireUser(req, res, db, { admin: true });
    if (admin) ok(res, paginate(db.verifications, req));
  }));

  router.post("/admin/verifications/:id/:action(approve|reject)", wrap(async (req, res) => {
    const db = await store.read();
    const admin = requireUser(req, res, db, { admin: true });
    if (!admin) return;
    const record = db.verifications.find((item) => item.id === Number(req.params.id));
    if (!record) return fail(res, 404, "认证记录不存在");
    const user = db.users.find((item) => item.id === record.userId);
    record.status = req.params.action === "approve" ? "通过" : "驳回";
    record.reviewedBy = admin.id;
    record.reviewedAt = now();
    record.rejectReason = req.params.action === "approve" ? "" : "材料不清晰，请重新提交";
    if (user) user.verifyStatus = req.params.action === "approve" ? "已认证" : "未认证";
    addAudit(db, admin.id, `认证${record.status}`, "verification", record.id, user?.nickname || "");
    await store.write(db);
    ok(res, record);
  }));

  router.get("/admin/reports", wrap(async (req, res) => {
    const db = await store.read();
    const admin = requireUser(req, res, db, { admin: true });
    if (admin) ok(res, paginate(db.reports, req));
  }));

  router.post("/admin/reports/:id/handle", wrap(async (req, res) => {
    const db = await store.read();
    const admin = requireUser(req, res, db, { admin: true });
    if (!admin) return;
    const report = db.reports.find((item) => item.id === Number(req.params.id));
    if (!report) return fail(res, 404, "举报不存在");
    report.status = "已处理";
    report.result = (req.body || {}).result || "已处理并保留记录";
    report.handledBy = admin.id;
    report.handledAt = now();
    addAudit(db, admin.id, "处理举报", "report", report.id, report.result);
    await store.write(db);
    ok(res, report);
  }));

  router.get("/admin/categories", wrap(async (req, res) => {
    const db = await store.read();
    const admin = requireUser(req, res, db, { admin: true });
    if (admin) ok(res, db.categories);
  }));

  router.post("/admin/categories", wrap(async (req, res) => {
    const db = await store.read();
    const admin = requireUser(req, res, db, { admin: true });
    if (!admin) return;
    const body = req.body || {};
    db.categories[body.channel] = db.categories[body.channel] || [];
    if (!db.categories[body.channel].includes(body.name)) db.categories[body.channel].push(body.name);
    addAudit(db, admin.id, "新增分类", "category", 0, `${body.channel}/${body.name}`);
    await store.write(db);
    ok(res, db.categories);
  }));

  router.put("/admin/categories/:id", wrap(async (req, res) => {
    const db = await store.read();
    const admin = requireUser(req, res, db, { admin: true });
    if (!admin) return;
    addAudit(db, admin.id, "编辑分类", "category", Number(req.params.id), "JSON 状态表兼容模式");
    await store.write(db);
    ok(res, db.categories);
  }));

  return router;
}

module.exports = { createApiRouter };
