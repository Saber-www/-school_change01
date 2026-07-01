import {
  AUTH_TOKEN_KEY,
  CATEGORY_MAP,
  CAMPUSES,
  CHANNELS,
  FORBIDDEN_WORDS,
  IMAGE_POOL,
  LISTING_STATUSES,
  PUBLIC_LISTING_STATUSES,
  REVIEW_WORDS,
  SERVER_SYNC_KEY,
  SESSION_KEY,
  STORAGE_KEY,
  TASK_PROGRESS_STEPS,
  TASK_STATUSES,
} from "./constants.js";
import { createMessagesFeature } from "./messagesFeature.js";
import { createInitialDb } from "./seedData.js";
import {
  $,
  $$,
  dateText,
  deadlineText,
  escapeHtml,
  hydrateIcons,
  icon,
  maskPhone,
  money,
  statusBadge,
  toast,
} from "./domUtils.js";

const SUMMARY_REFRESH_INTERVAL = 15000;
const MAX_LOCAL_CACHE_CHARS = 2 * 1024 * 1024;

let serverAvailable = false;
let db = loadDb();
localStorage.removeItem(AUTH_TOKEN_KEY);
localStorage.removeItem(SESSION_KEY);
let authToken = sessionStorage.getItem(AUTH_TOKEN_KEY) || "";
let currentUserId = authToken ? Number(sessionStorage.getItem(SESSION_KEY)) || 0 : 0;
let searchTimer = 0;
let summaryRefreshTimer = 0;
let summaryRefreshPending = false;

const state = {
  view: "home",
  activeChannel: "全部",
  detail: null,
  query: "",
  filters: {
    campus: "全部",
    status: "全部",
    min: "",
    max: "",
    sort: "最新发布",
  },
  publishType: "闲置转让",
  profileTab: "overview",
  adminTab: "dashboard",
  selectedConversationId: null,
  authMode: "login",
};

const viewHistory = [];
const MAX_VIEW_HISTORY = 30;

const {
  unreadMessageCount,
  unreadCountLabel,
  prepareMessageReadState,
  renderMessages,
  sendMessage,
  startConversation,
} = createMessagesFeature({
  state,
  getDb: () => db,
  saveDb,
  currentUser,
  userById,
  itemByKind,
  canBrowseItem,
  unavailableItemText,
  ensureAuth,
  setView,
  render,
  toast,
  apiRequest,
  syncDbFromServer,
  nextId,
  renderAuthRequired,
  renderInlineEmpty,
});

function loadDb() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const seeded = createInitialDb();
    cacheDbLocally(seeded);
    return seeded;
  }

  if (stored.length > MAX_LOCAL_CACHE_CHARS) {
    localStorage.removeItem(STORAGE_KEY);
    return createInitialDb();
  }

  try {
    const merged = mergeDbDefaults(JSON.parse(stored));
    cacheDbLocally(merged);
    return merged;
  } catch {
    const seeded = createInitialDb();
    cacheDbLocally(seeded);
    return seeded;
  }
}

function cacheDbLocally(nextDb) {
  try {
    const serialized = JSON.stringify(nextDb);
    if (serialized.length > MAX_LOCAL_CACHE_CHARS) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveDb() {
  cacheDbLocally(db);
  if (serverAvailable && authToken && currentUser()?.role === "admin") {
    syncDbToServer();
  }
}

function authHeaders(extra = {}) {
  return authToken
    ? { ...extra, Authorization: `Bearer ${authToken}` }
    : extra;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: authHeaders({
      "Content-Type": "application/json",
      ...(options.headers || {}),
    }),
  });
  const payload = await response.json().catch(() => ({ message: "服务响应异常" }));
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || "请求失败");
  }
  return payload.data;
}

async function syncDbFromServer() {
  try {
    const response = await fetch("/api/bootstrap", {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error("server unavailable");
    const payload = await response.json();
    if (payload.code !== 0 || !payload.data) throw new Error(payload.message || "invalid server response");
    db = mergeDbDefaults(payload.data, { preserveServerPayload: true });
    serverAvailable = true;
    cacheDbLocally(db);
    localStorage.setItem(SERVER_SYNC_KEY, "online");
  } catch {
    serverAvailable = false;
    localStorage.setItem(SERVER_SYNC_KEY, "offline");
  }
}

async function syncDbToServer() {
  try {
    await apiRequest("/api/bootstrap", {
      method: "PUT",
      body: JSON.stringify(db),
    });
    localStorage.setItem(SERVER_SYNC_KEY, "online");
  } catch {
    serverAvailable = false;
    localStorage.setItem(SERVER_SYNC_KEY, "offline");
  }
}

function mergeDbDefaults(incoming, options = {}) {
  const fallback = createInitialDb();
  const merged = {
    ...fallback,
    ...incoming,
    users: incoming.users || fallback.users,
    verifications: incoming.verifications || fallback.verifications,
    listings: incoming.listings || fallback.listings,
    tasks: incoming.tasks || fallback.tasks,
    favorites: incoming.favorites || fallback.favorites,
    browseHistory: incoming.browseHistory || fallback.browseHistory,
    conversations: incoming.conversations || fallback.conversations,
    reports: incoming.reports || fallback.reports,
    reviews: incoming.reviews || fallback.reviews || [],
    notifications: incoming.notifications || fallback.notifications || [],
    announcements: incoming.announcements || fallback.announcements,
    categories: incoming.categories || fallback.categories,
    auditLogs: incoming.auditLogs || fallback.auditLogs,
  };
  return normalizeSeedData(merged, fallback, options);
}

function normalizeSeedData(target, fallback, options = {}) {
  if (options.preserveServerPayload) {
    target.users = target.users || [];
    target.verifications = target.verifications || [];
    target.listings = target.listings || [];
    target.tasks = target.tasks || [];
    target.announcements = target.announcements || [];
    target.categories = mergeCategories(target.categories || {}, fallback.categories || {});
    return target;
  }

  target.users = mergeDemoUsers(target.users || [], fallback.users);
  target.verifications = mergeSeedRecords(target.verifications || [], fallback.verifications, (item) => `user:${item.userId}:${item.studentNo}`);
  target.listings = mergeSeedRecords(target.listings || [], fallback.listings, (item) => `listing:${item.channel}:${item.title}`);
  target.tasks = mergeSeedRecords(target.tasks || [], fallback.tasks, (item) => `task:${item.channel}:${item.title}`);
  target.announcements = mergeSeedRecords(target.announcements || [], fallback.announcements, (item) => `announcement:${item.title}`);
  target.categories = mergeCategories(target.categories || {}, fallback.categories || {});
  return target;
}

function mergeDemoUsers(users, fallbackUsers) {
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

function mergeSeedRecords(records, fallbackRecords, signatureOf) {
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

function mergeCategories(categories, fallbackCategories) {
  const merged = JSON.parse(JSON.stringify(categories));
  Object.entries(fallbackCategories).forEach(([channel, values]) => {
    merged[channel] = merged[channel] || [];
    values.forEach((value) => {
      if (!merged[channel].includes(value)) merged[channel].push(value);
    });
  });
  return merged;
}

function saveSession() {
  if (authToken && currentUserId) {
    sessionStorage.setItem(AUTH_TOKEN_KEY, authToken);
    sessionStorage.setItem(SESSION_KEY, String(currentUserId));
  } else {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  }
}

async function hydrateCurrentUser() {
  if (!authToken) {
    currentUserId = 0;
    saveSession();
    return;
  }
  try {
    const user = await apiRequest("/api/users/me", { method: "GET" });
    upsertUser(user);
    currentUserId = user.id;
    saveSession();
  } catch {
    authToken = "";
    currentUserId = 0;
    saveSession();
  }
}

function currentUser() {
  return db.users.find((user) => user.id === currentUserId) || null;
}

function userById(id) {
  return db.users.find((user) => user.id === Number(id)) || {
    id: 0,
    nickname: "已注销用户",
    verifyStatus: "未知",
    campus: "未知",
    creditScore: 0,
    status: "注销",
    role: "user",
  };
}

function canManageItem(kind, item, user = currentUser()) {
  if (!item || !user) return false;
  if (user.role === "admin") return true;
  if (item.publisherId === user.id) return true;
  return kind === "task" && item.takerId === user.id;
}

function canBrowseItem(kind, item, user = currentUser()) {
  if (!item) return false;
  if (kind === "task") return true;
  return PUBLIC_LISTING_STATUSES.includes(item.status);
}

function canViewOwnListingInProfile(kind, item, user = currentUser()) {
  return Boolean(kind === "listing" && item && user && item.publisherId === user.id);
}

function unavailableItemText(kind = "listing") {
  return kind === "task" ? "这条任务暂不可查看。" : "这条信息已下架或未通过审核，不能继续浏览。";
}

function channelMeta(key) {
  return CHANNELS.find((item) => item.key === key) || CHANNELS[0];
}

function appItems() {
  return [
    ...db.listings.map((item) => ({ kind: "listing", ...item })),
    ...db.tasks.map((item) => ({ kind: "task", ...item })),
  ];
}

function itemByKind(kind, id) {
  const collection = kind === "task" ? db.tasks : db.listings;
  return collection.find((item) => item.id === Number(id)) || null;
}

function isAdminRemovedListing(item) {
  return Boolean(item?.adminRemovedAt || item?.adminRemovedBy || item?.adminRemovalReason);
}

function upsertUser(user) {
  if (!user) return null;
  const index = db.users.findIndex((item) => item.id === user.id);
  const nextUser = index >= 0 ? { ...db.users[index], ...user } : user;
  if (index >= 0) db.users[index] = nextUser;
  else db.users.push(nextUser);
  return nextUser;
}

function upsertRecord(collection, record) {
  if (!record) return null;
  const index = collection.findIndex((item) => item.id === record.id);
  const nextRecord = index >= 0 ? { ...collection[index], ...record } : record;
  if (index >= 0) collection[index] = nextRecord;
  else collection.unshift(nextRecord);
  return nextRecord;
}

function isFavorited(kind, id, user = currentUser()) {
  return Boolean(user && db.favorites.some((fav) => fav.userId === user.id && fav.kind === kind && fav.id === Number(id)));
}

function renderFavoriteButton(kind, id, count, className = "ghost-button") {
  const active = isFavorited(kind, id);
  const countText = typeof count === "number" ? ` ${count}` : "";
  return `
    <button
      class="${className} favorite-button ${active ? "favorited" : ""}"
      type="button"
      data-action="favorite"
      data-kind="${kind}"
      data-id="${id}"
      aria-pressed="${active ? "true" : "false"}"
    >
      ${icon("heart")}${active ? "已收藏" : "收藏"}${countText}
    </button>
  `;
}

function pendingReportFor(kind, id, user = currentUser()) {
  return user
    ? db.reports.find((report) => report.reporterId === user.id && report.targetKind === kind && report.targetId === Number(id) && report.status === "待处理")
    : null;
}

function renderReportButton(kind, id) {
  const report = pendingReportFor(kind, id);
  if (report) {
    return `<button class="ghost-button" type="button" data-action="withdraw-report" data-id="${report.id}">${icon("rotate-ccw")}撤销举报</button>`;
  }
  return `<button class="ghost-button" type="button" data-action="open-report" data-kind="${kind}" data-id="${id}">${icon("flag")}举报</button>`;
}

function itemTitle(kind, id) {
  return itemByKind(kind, id)?.title || "关联信息已不存在";
}

function itemPublisher(kind, id) {
  const item = itemByKind(kind, id);
  return item ? userById(item.publisherId) : userById(0);
}

function isTaskChannel(channel) {
  return channel === "跑腿代取" || channel === "校内送货";
}

function profileSummaryFor(user) {
  if (!user) {
    return {
      posts: 0,
      tasks: 0,
      favorites: 0,
      conversations: 0,
      unreadMessages: 0,
    };
  }

  const tasks = db.tasks.filter((task) => task.publisherId === user.id || task.takerId === user.id);
  const favorites = db.favorites.filter((fav) => {
    if (fav.userId !== user.id) return false;
    const item = itemByKind(fav.kind, fav.id);
    return item && canBrowseItem(fav.kind, item, user);
  });

  return {
    posts: db.listings.filter((item) => item.publisherId === user.id).length,
    tasks: tasks.length,
    favorites: favorites.length,
    conversations: db.conversations.filter((conv) => conv.participants.includes(user.id)).length,
    unreadMessages: unreadMessageCount(user),
  };
}

function renderSummaryShortcut({ value, label, iconName, action, tab, className = "stat-card" }) {
  const tabAttr = tab ? ` data-tab="${tab}"` : "";
  return `
    <button class="${className} summary-shortcut" type="button" data-action="${action}"${tabAttr}>
      <span class="summary-shortcut-icon">${icon(iconName)}</span>
      <span>
        <strong>${value}</strong>
        <span>${label}</span>
      </span>
    </button>
  `;
}

function renderSummaryShortcuts(summary, className = "stat-card") {
  return [
    renderSummaryShortcut({ value: summary.posts, label: "我的帖子", iconName: "list", action: "profile-shortcut", tab: "posts", className }),
    renderSummaryShortcut({ value: summary.tasks, label: "我的任务", iconName: "package-check", action: "profile-shortcut", tab: "tasks", className }),
    renderSummaryShortcut({ value: summary.favorites, label: "收藏", iconName: "heart", action: "profile-shortcut", tab: "favorites", className }),
    renderSummaryShortcut({ value: summary.conversations, label: "会话", iconName: "message-circle", action: "messages-shortcut", className }),
  ].join("");
}

function viewSnapshot() {
  return {
    view: state.view,
    activeChannel: state.activeChannel,
    detail: state.detail ? { ...state.detail } : null,
    query: state.query,
    filters: { ...state.filters },
    publishType: state.publishType,
    profileTab: state.profileTab,
    adminTab: state.adminTab,
    selectedConversationId: state.selectedConversationId,
    authMode: state.authMode,
  };
}

function applyViewSnapshot(snapshot) {
  state.view = snapshot.view;
  state.activeChannel = snapshot.activeChannel;
  state.detail = snapshot.detail ? { ...snapshot.detail } : null;
  state.query = snapshot.query;
  state.filters = { ...snapshot.filters };
  state.publishType = snapshot.publishType;
  state.profileTab = snapshot.profileTab;
  state.adminTab = snapshot.adminTab;
  state.selectedConversationId = snapshot.selectedConversationId;
  state.authMode = snapshot.authMode;
}

function sameViewSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function rememberViewSnapshot(snapshot) {
  const last = viewHistory[viewHistory.length - 1];
  if (last && sameViewSnapshot(last, snapshot)) return;
  viewHistory.push(snapshot);
  if (viewHistory.length > MAX_VIEW_HISTORY) viewHistory.shift();
}

function canGoBack() {
  return viewHistory.length > 0;
}

function goBack() {
  const previous = viewHistory.pop();
  if (!previous) {
    toast("没有上一处页面");
    return;
  }
  applyViewSnapshot(previous);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function shouldRefreshSummaryData() {
  const modalOpen = Boolean($("#modalRoot")?.innerHTML.trim());
  const activeTag = document.activeElement?.tagName;
  const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(activeTag);
  if (modalOpen || document.hidden || editing) return false;
  return state.view !== "publish";
}

async function refreshSummaryData(force = false) {
  if (summaryRefreshPending) return;
  if (!force && !shouldRefreshSummaryData()) return;
  summaryRefreshPending = true;
  try {
    await syncDbFromServer();
    if (currentUser()) render();
  } finally {
    summaryRefreshPending = false;
  }
}

function startSummaryAutoRefresh() {
  if (summaryRefreshTimer) return;
  summaryRefreshTimer = window.setInterval(() => refreshSummaryData(), SUMMARY_REFRESH_INTERVAL);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshSummaryData();
  });
}

function ensureAuth(options = {}) {
  const user = currentUser();
  if (!user) {
    openAuthModal("login");
    toast("请先登录");
    return false;
  }
  if (options.admin && user.role !== "admin") {
    toast("需要管理员账号");
    return false;
  }
  if (options.verified && user.verifyStatus !== "已认证") {
    setView("profile", { profileTab: "verification" });
    toast("需要先完成校园认证");
    return false;
  }
  if (user.status !== "正常") {
    toast("当前账号状态不可执行该操作");
    return false;
  }
  return true;
}

function setView(view, options = {}) {
  const previous = viewSnapshot();
  state.view = view;
  if (Object.hasOwn(options, "channel")) state.activeChannel = options.channel;
  if (Object.hasOwn(options, "detail")) state.detail = options.detail;
  if (Object.hasOwn(options, "profileTab")) state.profileTab = options.profileTab;
  if (Object.hasOwn(options, "adminTab")) state.adminTab = options.adminTab;
  if (Object.hasOwn(options, "selectedConversationId")) state.selectedConversationId = options.selectedConversationId;
  const next = viewSnapshot();
  if (!options.replace && !sameViewSnapshot(previous, next)) rememberViewSnapshot(previous);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  refreshSummaryData();
}

function resetFilters() {
  state.filters = {
    campus: "全部",
    status: "全部",
    min: "",
    max: "",
    sort: "最新发布",
  };
}

function renderHeader() {
  const channelNav = $("#channelNav");
  const user = currentUser();
  const unreadTotal = unreadMessageCount(user);
  const backButton = $("#backButton");

  if (backButton) {
    backButton.classList.toggle("hide", !canGoBack());
    backButton.title = canGoBack() ? "返回上一处" : "暂无上一处页面";
  }

  channelNav.innerHTML = [
    `<button class="nav-pill ${state.activeChannel === "全部" ? "active" : ""}" type="button" data-action="browse" data-channel="全部">全部</button>`,
    ...CHANNELS.map(
      (channel) => `
        <button class="nav-pill ${state.activeChannel === channel.key ? "active" : ""}" type="button" data-action="browse" data-channel="${channel.key}">
          ${escapeHtml(channel.key)}
        </button>
      `,
    ),
  ].join("");

  $("#globalSearch").value = state.query;
  const userButton = $("#userButton");
  userButton.classList.toggle("hide", !user);
  userButton.innerHTML = user
    ? `${icon(user.role === "admin" ? "shield" : "circle-user-round")} ${escapeHtml(user.nickname)}`
    : "";

  const messagesButton = $("#messagesButton");
  messagesButton.classList.toggle("has-unread", unreadTotal > 0);
  messagesButton.title = unreadTotal ? `消息中心，${unreadTotal} 条未读` : "消息中心";
  messagesButton.innerHTML = `
    ${icon("message-circle")}
    ${unreadTotal ? `<span class="unread-badge">${escapeHtml(unreadCountLabel(unreadTotal))}</span>` : ""}
  `;

  $("#mobileNav").innerHTML = [
    { label: "首页", icon: "home", view: "home" },
    { label: "频道", icon: "layout-grid", view: "browse" },
    { label: "发布", icon: "plus", view: "publish" },
    { label: "消息", icon: "message-circle", view: "messages" },
    { label: user?.role === "admin" ? "后台" : "我的", icon: user?.role === "admin" ? "shield" : "user", view: user?.role === "admin" ? "admin" : "profile" },
  ]
    .map(
      (item) => `
        <button class="${state.view === item.view ? "active" : ""}" type="button" data-action="mobile-view" data-view="${item.view}">
          ${icon(item.icon)}
          <span>${item.label}</span>
          ${item.view === "messages" && unreadTotal ? `<span class="unread-badge">${escapeHtml(unreadCountLabel(unreadTotal))}</span>` : ""}
        </button>
      `,
    )
    .join("");
}

function render() {
  prepareMessageReadState();
  renderHeader();
  const app = $("#app");

  if (state.view === "home") {
    app.innerHTML = renderHome();
  } else if (state.view === "browse") {
    app.innerHTML = renderBrowse();
  } else if (state.view === "detail") {
    app.innerHTML = renderDetail();
  } else if (state.view === "publish") {
    app.innerHTML = currentUser()
      ? renderPublish()
      : renderAuthRequired("登录并完成校园认证后可发布闲置、求购、跑腿和失物招领信息。");
  } else if (state.view === "profile") {
    app.innerHTML = renderProfile();
  } else if (state.view === "messages") {
    app.innerHTML = renderMessages();
  } else if (state.view === "admin") {
    app.innerHTML = renderAdmin();
  } else {
    app.innerHTML = renderHome();
  }

  hydrateIcons();
}

function renderHome() {
  const user = currentUser();
  const pendingTasks = db.tasks.filter((task) => task.status === "待接单");
  const activeListings = db.listings.filter((item) => item.status === "展示中");
  const latestItems = activeListings
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 3);
  const hotTasks = pendingTasks
    .slice()
    .sort((a, b) => b.reward - a.reward)
    .slice(0, 3);
  const summary = profileSummaryFor(user);
  const completedCount = db.tasks.filter((task) => task.status === "已完成").length + db.listings.filter((listing) => listing.status === "已完成").length;

  return `
    <section class="home-grid">
      <div class="home-hero">
        <div>
          <p class="eyebrow">${escapeHtml(user?.campus || "游客浏览")} · ${escapeHtml(user?.verifyStatus || "公开信息")}</p>
          <h1>
            <span class="desktop-title">${user ? `欢迎回来，${escapeHtml(user.nickname)}` : "先看看校园里有什么"}</span>
            <span class="mobile-title">${user ? "欢迎回来" : "校园轻集市"}</span>
          </h1>
          <p class="lead">
            ${user
              ? "这里汇总最新闲置、待接任务、站内沟通和校园公告，方便你继续处理正在进行的校园交易与互助。"
              : "未登录也可以浏览公开的闲置、求购、跑腿和失物信息；发布、收藏、联系和举报需要登录并完成对应认证。"}
          </p>
        </div>
        <div class="home-hero-metrics">
          <span><strong>${activeListings.length}</strong>展示中</span>
          <span><strong>${pendingTasks.length}</strong>待接单</span>
          <span><strong>${completedCount}</strong>已完成</span>
        </div>
      </div>

      <aside>
        <div class="side-panel">
          <div class="section-head compact">
            <div>
              <p class="eyebrow">${user ? "个人概览" : "游客入口"}</p>
              <h3>${escapeHtml(user?.nickname || "登录后继续操作")}</h3>
            </div>
            ${user ? statusBadge(user.verifyStatus) : `<button class="secondary-button" type="button" data-action="login-modal">${icon("log-in")}登录</button>`}
          </div>
          ${
            user
              ? `<div class="home-mini-stats">${renderSummaryShortcuts(summary, "home-mini-stat")}</div>`
              : `<p class="small-text">登录后可发布信息、收藏内容、站内沟通，并在个人中心查看自己的发布和任务。</p>`
          }
        </div>
        <div class="side-panel">
          <div class="section-head compact">
            <div>
              <p class="eyebrow">公告</p>
              <h3>校园提醒</h3>
            </div>
          </div>
          ${db.announcements
            .slice()
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 3)
            .map(
              (notice) => `
                <div class="divider"></div>
                <div>
                  <div class="badge ${notice.level === "安全" ? "warn" : "info"}">${escapeHtml(notice.level)}</div>
                  <h3 style="margin-top: 8px;">${escapeHtml(notice.title)}</h3>
                  <p class="small-text">${escapeHtml(notice.content)}</p>
                </div>
              `,
            )
            .join("")}
        </div>
      </aside>
    </section>

    <section class="section-stack">
      <div class="section-panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">频道</p>
            <h2>校园场景</h2>
          </div>
          <button class="secondary-button" type="button" data-action="browse" data-channel="全部">${icon("arrow-right")}全部信息</button>
        </div>
        <div class="channel-grid">
          ${CHANNELS.map(
            (channel) => `
              <button class="channel-card" type="button" data-action="browse" data-channel="${channel.key}">
                <span class="channel-icon">${icon(channel.icon)}</span>
                <span>
                  <strong>${escapeHtml(channel.key)}</strong>
                  <span class="small-text">${escapeHtml(channel.desc)}</span>
                </span>
              </button>
            `,
          ).join("")}
        </div>
      </div>

      <div class="section-panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">最新发布</p>
            <h2>校园资源</h2>
          </div>
          <button class="secondary-button" type="button" data-action="browse" data-channel="闲置转让">${icon("shopping-bag")}闲置频道</button>
        </div>
        <div class="card-grid">
          ${latestItems.map((item) => renderListingCard(item)).join("") || renderInlineEmpty("暂无展示中的帖子")}
        </div>
      </div>

      <div class="section-panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">任务大厅</p>
            <h2>待接任务</h2>
          </div>
          <button class="secondary-button" type="button" data-action="browse" data-channel="跑腿代取">${icon("package-check")}去接单</button>
        </div>
        <div class="card-grid">
          ${hotTasks.map((task) => renderTaskCard(task)).join("") || renderInlineEmpty("暂无待接单任务")}
        </div>
      </div>
    </section>
  `;
}

function renderInlineEmpty(text) {
  return `<div class="empty-state" style="grid-column: 1 / -1;"><p>${escapeHtml(text)}</p></div>`;
}

function renderListingCard(item, row = false, options = {}) {
  const publisher = userById(item.publisherId);
  const user = currentUser();
  const canRelist = user?.id === item.publisherId && item.status === "已下架" && !isAdminRemovedListing(item);
  const canOpenOwnListing = options.ownerAccess && canViewOwnListingInProfile("listing", item, user);
  const canEdit = canOpenOwnListing;
  const detailAction = canOpenOwnListing ? "owner-detail" : "detail";
  const canShowFavorite = Boolean(user && canBrowseItem("listing", item, user));
  const priceText =
    item.channel === "求购交换"
      ? `${money(item.budgetMin, "预算")} - ${money(item.budgetMax, "面议")}`
      : money(item.price);

  return `
    <article class="listing-card ${row ? "list-row" : ""}">
      <img class="listing-image" src="${escapeHtml(item.images?.[0] || IMAGE_POOL[item.channel]?.[0] || IMAGE_POOL["闲置转让"][0])}" alt="${escapeHtml(item.title)}" loading="lazy" />
      <div class="listing-body">
        <div class="badge-row">
          <span class="badge info">${escapeHtml(item.channel)}</span>
          <span class="badge">${escapeHtml(item.category)}</span>
          ${statusBadge(item.status)}
        </div>
        <h3 class="card-title">
          <button type="button" data-action="${detailAction}" data-kind="listing" data-id="${item.id}">
            ${escapeHtml(item.title)}
          </button>
        </h3>
        <p class="small-text">${escapeHtml(item.description).slice(0, row ? 110 : 70)}${item.description.length > (row ? 110 : 70) ? "..." : ""}</p>
        <div class="price-line">
          <strong class="price">${priceText}</strong>
          <span class="small-text">${escapeHtml(item.locationText)}</span>
        </div>
        <div class="badge-row">
          ${item.tags.map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}
        </div>
        <div class="card-actions">
          <button class="secondary-button" type="button" data-action="${detailAction}" data-kind="listing" data-id="${item.id}">${icon("eye")}详情</button>
          ${canEdit ? `<button class="ghost-button" type="button" data-action="edit-listing" data-id="${item.id}">${icon("pencil")}修改</button>` : ""}
          ${canRelist ? `<button class="primary-button" type="button" data-action="listing-status" data-status="展示中" data-id="${item.id}">${icon("rotate-ccw")}重新上架</button>` : ""}
          ${canShowFavorite ? renderFavoriteButton("listing", item.id, item.favoriteCount) : ""}
        </div>
        <p class="meta">${escapeHtml(publisher.nickname)} · ${escapeHtml(item.campus)} · ${dateText(item.createdAt)} · 浏览 ${item.viewCount}</p>
      </div>
    </article>
  `;
}

function renderTaskCard(task, row = false) {
  const publisher = userById(task.publisherId);
  const user = currentUser();
  const isUrgent = new Date(task.deadlineAt) - Date.now() < 2 * 60 * 60 * 1000 && task.status !== "已完成";
  return `
    <article class="task-card ${isUrgent ? "urgent" : ""} ${row ? "list-row" : ""}">
      <div class="task-body" style="${row ? "" : "min-height: 100%;"}">
        <div class="badge-row">
          <span class="badge info">${escapeHtml(task.channel)}</span>
          <span class="badge">${escapeHtml(task.taskType)}</span>
          ${statusBadge(task.status)}
          ${isUrgent ? '<span class="badge warn">急单</span>' : ""}
        </div>
        <h3 class="card-title">
          <button type="button" data-action="detail" data-kind="task" data-id="${task.id}">
            ${escapeHtml(task.title)}
          </button>
        </h3>
        <div class="task-route">
          <span>${icon("map-pin")}取：${escapeHtml(task.pickupLocation)}</span>
          <span>${icon("flag")}送：${escapeHtml(task.deliveryLocation)}</span>
          <span>${icon("clock")}截止：${deadlineText(task.deadlineAt)}</span>
        </div>
        <div class="price-line">
          <strong class="price">${money(task.reward)}</strong>
          <span class="small-text">${escapeHtml(task.campus)}</span>
        </div>
        <div class="card-actions">
          <button class="secondary-button" type="button" data-action="detail" data-kind="task" data-id="${task.id}">${icon("eye")}详情</button>
          ${user ? renderFavoriteButton("task", task.id, task.favoriteCount) : ""}
        </div>
        <p class="meta">${escapeHtml(publisher.nickname)} · ${dateText(task.createdAt)} · 浏览 ${task.viewCount}</p>
      </div>
    </article>
  `;
}

function filteredItems() {
  const keyword = state.query.trim().toLowerCase();
  const min = Number(state.filters.min || 0);
  const max = Number(state.filters.max || Number.MAX_SAFE_INTEGER);

  let items = appItems().filter((item) => {
    if (!canBrowseItem(item.kind, item)) return false;
    const matchesChannel = state.activeChannel === "全部" || item.channel === state.activeChannel;
    const matchesKeyword = !keyword || searchableText(item).includes(keyword);
    const matchesCampus = state.filters.campus === "全部" || item.campus === state.filters.campus;
    const matchesStatus = state.filters.status === "全部" || item.status === state.filters.status;
    const amount = item.kind === "task" ? Number(item.reward || 0) : Number(item.price || item.budgetMax || item.budgetMin || 0);
    const matchesAmount = amount >= min && amount <= max;
    return matchesChannel && matchesKeyword && matchesCampus && matchesStatus && matchesAmount;
  });

  if (state.filters.sort === "价格升序") {
    items.sort((a, b) => amountOf(a) - amountOf(b));
  } else if (state.filters.sort === "价格降序") {
    items.sort((a, b) => amountOf(b) - amountOf(a));
  } else if (state.filters.sort === "热度") {
    items.sort((a, b) => (b.viewCount + b.favoriteCount) - (a.viewCount + a.favoriteCount));
  } else {
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  return items;
}

function searchableText(item) {
  const publisher = userById(item.publisherId);
  return [
    item.kind === "task" ? "任务 接单 跑腿 送货" : "帖子 发布 信息",
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
    publisher.nickname,
    ...(item.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function amountOf(item) {
  return item.kind === "task" ? Number(item.reward || 0) : Number(item.price || item.budgetMax || item.budgetMin || 0);
}

function renderBrowse() {
  const items = filteredItems();
  const statuses = state.activeChannel === "全部"
    ? [...new Set([...LISTING_STATUSES, ...TASK_STATUSES])]
    : isTaskChannel(state.activeChannel)
      ? TASK_STATUSES
      : LISTING_STATUSES;

  return `
    <section class="page-head">
      <div>
        <p class="eyebrow">信息发现</p>
        <h1>${escapeHtml(state.activeChannel)}频道</h1>
        <p class="lead">按频道、校区、地点、价格/报酬、状态筛选信息，搜索标题、频道、分类和标签。</p>
      </div>
      <button class="primary-button" type="button" data-action="publish">${icon("plus")}发布</button>
    </section>

    <section class="workspace">
      <aside class="filter-panel">
        <h3>筛选排序</h3>
        <form class="filter-form" data-form="filters">
          <div class="field">
            <label for="filterCampus">校区</label>
            <select id="filterCampus" name="campus">
              <option ${state.filters.campus === "全部" ? "selected" : ""}>全部</option>
              ${CAMPUSES.map((campus) => `<option ${state.filters.campus === campus ? "selected" : ""}>${campus}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="filterStatus">状态</label>
            <select id="filterStatus" name="status">
              <option ${state.filters.status === "全部" ? "selected" : ""}>全部</option>
              ${statuses.map((status) => `<option ${state.filters.status === status ? "selected" : ""}>${status}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="filterMin">最低价格/报酬</label>
            <input id="filterMin" name="min" type="number" min="0" value="${escapeHtml(state.filters.min)}" placeholder="不限" />
          </div>
          <div class="field">
            <label for="filterMax">最高价格/报酬</label>
            <input id="filterMax" name="max" type="number" min="0" value="${escapeHtml(state.filters.max)}" placeholder="不限" />
          </div>
          <div class="field">
            <label for="filterSort">排序</label>
            <select id="filterSort" name="sort">
              ${["最新发布", "价格升序", "价格降序", "热度"].map((sort) => `<option ${state.filters.sort === sort ? "selected" : ""}>${sort}</option>`).join("")}
            </select>
          </div>
          <div class="button-row">
            <button class="primary-button" type="submit">${icon("filter")}应用</button>
            <button class="ghost-button" type="button" data-action="reset-filters">${icon("rotate-ccw")}清空</button>
          </div>
        </form>
      </aside>

      <div>
        <div class="filter-row" style="margin-bottom: 14px;">
          <button class="chip ${state.activeChannel === "全部" ? "active" : ""}" type="button" data-action="browse" data-channel="全部">全部</button>
          ${CHANNELS.map((channel) => `<button class="chip ${state.activeChannel === channel.key ? "active" : ""}" type="button" data-action="browse" data-channel="${channel.key}">${channel.key}</button>`).join("")}
        </div>
        <div class="section-panel">
          <div class="section-head">
            <div>
              <h2>${items.length} 条结果</h2>
              <p class="small-text">${state.query ? `关键词：${escapeHtml(state.query)}` : "展示当前筛选条件下的信息"}</p>
            </div>
          </div>
          <div class="results-list">
            ${
              items.length
                ? items.map((item) => item.kind === "task" ? renderTaskCard(item, true) : renderListingCard(item, true)).join("")
                : renderInlineEmpty("没有匹配结果，换个关键词或清空筛选试试。")
            }
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderDetail() {
  if (!state.detail) return renderInlineEmpty("未选择信息");
  const item = itemByKind(state.detail.kind, state.detail.id);
  if (!item) {
    return `
      <section class="empty-state">
        <div>
          <p>这条信息已不存在。</p>
          <button class="secondary-button" type="button" data-action="browse" data-channel="全部">${icon("arrow-left")}返回列表</button>
        </div>
      </section>
    `;
  }
  const canRenderOwnerDetail = state.detail.ownerAccess && canViewOwnListingInProfile(state.detail.kind, item);
  if (!canBrowseItem(state.detail.kind, item) && !canRenderOwnerDetail) {
    return `
      <section class="empty-state">
        <div>
          <p>${unavailableItemText(state.detail.kind)}</p>
          <button class="secondary-button" type="button" data-action="browse" data-channel="全部">${icon("arrow-left")}返回列表</button>
        </div>
      </section>
    `;
  }

  const publisher = userById(item.publisherId);
  const isTask = state.detail.kind === "task";
  const titleMeta = isTask
    ? `${item.taskType} · ${item.pickupLocation} 到 ${item.deliveryLocation}`
    : `${item.category} · ${item.locationText}`;

  return `
    <section class="page-head">
      <div>
        <p class="eyebrow">${escapeHtml(item.channel)}详情</p>
        <h1>${escapeHtml(item.title)}</h1>
        <p class="lead">${escapeHtml(titleMeta)}</p>
      </div>
      ${
        canRenderOwnerDetail
          ? `<button class="ghost-button" type="button" data-action="profile-shortcut" data-tab="posts">${icon("arrow-left")}返回我的发布</button>`
          : `<button class="ghost-button" type="button" data-action="browse" data-channel="${item.channel}">${icon("arrow-left")}返回频道</button>`
      }
    </section>

    <section class="detail-layout">
      <div class="detail-main">
        ${
          isTask
            ? ""
            : `<div class="detail-gallery"><img src="${escapeHtml(item.images?.[0] || IMAGE_POOL[item.channel]?.[0] || IMAGE_POOL["闲置转让"][0])}" alt="${escapeHtml(item.title)}" /></div>`
        }
        <div class="detail-block">
          <div class="badge-row">
            <span class="badge info">${escapeHtml(item.channel)}</span>
            <span class="badge">${escapeHtml(isTask ? item.taskType : item.category)}</span>
            ${statusBadge(item.status)}
          </div>
          <div class="divider"></div>
          ${isTask ? renderTaskDetailFields(item) : renderListingDetailFields(item)}
          <div class="divider"></div>
          <h3>详细说明</h3>
          <p>${escapeHtml(item.description)}</p>
        </div>
        ${isTask ? renderTaskTimeline(item) : renderSafetyBlock(item.channel)}
      </div>

      <aside class="detail-aside">
        <div class="detail-block">
          <div class="seller-card">
            <span class="avatar">${escapeHtml(publisher.nickname.slice(0, 1))}</span>
            <div>
              <strong>${escapeHtml(publisher.nickname)}</strong>
              <p class="small-text">${escapeHtml(publisher.campus)} · 信用 ${publisher.creditScore} · ${escapeHtml(publisher.status)}</p>
              ${statusBadge(publisher.verifyStatus)}
            </div>
          </div>
          <div class="divider"></div>
          <p class="small-text">手机号默认隐藏：${maskPhone(publisher.phone)}。建议优先使用站内沟通，并选择校内公共区域交接。</p>
        </div>

        <div class="detail-block">
          <h3>操作</h3>
          <div class="detail-actions">
            <button class="primary-button" type="button" data-action="contact" data-kind="${state.detail.kind}" data-id="${item.id}">${icon("message-circle")}联系</button>
            ${renderFavoriteButton(state.detail.kind, item.id, undefined, "secondary-button")}
            ${renderReportButton(state.detail.kind, item.id)}
          </div>
          <div class="divider"></div>
          ${isTask ? renderTaskActions(item) : renderListingActions(item)}
        </div>

        <div class="detail-block">
          <h3>基础数据</h3>
          <p class="small-text">发布时间：${dateText(item.createdAt)}</p>
          <p class="small-text">浏览量：${item.viewCount}</p>
          <p class="small-text">收藏量：${item.favoriteCount}</p>
          <p class="small-text">校区：${escapeHtml(item.campus)}</p>
        </div>
      </aside>
    </section>
  `;
}

function renderListingDetailFields(item) {
  const priceText = item.channel === "求购交换"
    ? `${money(item.budgetMin, "预算")} - ${money(item.budgetMax, "面议")}`
    : money(item.price);
  return `
    <div class="stats-grid">
      <div class="stat-card"><strong>${priceText}</strong><span>${item.channel === "求购交换" ? "预算" : "价格"}</span></div>
      <div class="stat-card"><strong>${escapeHtml(item.conditionLevel || "不限")}</strong><span>成色</span></div>
      <div class="stat-card"><strong>${escapeHtml(item.locationText)}</strong><span>地点</span></div>
      <div class="stat-card"><strong>${escapeHtml(item.contactMode)}</strong><span>沟通方式</span></div>
    </div>
  `;
}

function renderTaskDetailFields(task) {
  return `
    <div class="stats-grid">
      <div class="stat-card"><strong>${money(task.reward)}</strong><span>任务报酬</span></div>
      <div class="stat-card"><strong>${escapeHtml(task.pickupLocation)}</strong><span>取货点</span></div>
      <div class="stat-card"><strong>${escapeHtml(task.deliveryLocation)}</strong><span>送达点</span></div>
      <div class="stat-card"><strong>${deadlineText(task.deadlineAt)}</strong><span>截止时间</span></div>
    </div>
    <div class="divider"></div>
    <p><strong>物品说明：</strong>${escapeHtml(task.itemNote)}</p>
  `;
}

function renderTaskTimeline(task) {
  return `
    <div class="detail-block">
      <h3>任务状态流转</h3>
      ${renderTaskProgress(task)}
      <ul class="timeline">
        ${task.timeline.map((node) => `<li><span>${escapeHtml(node.text)} · ${dateText(node.time)}</span></li>`).join("")}
      </ul>
    </div>
  `;
}

function renderTaskProgress(task) {
  const currentIndex = TASK_PROGRESS_STEPS.findIndex((step) => step.status === task.status);
  const isFinished = task.status === "已完成";
  const isInterrupted = ["已取消"].includes(task.status);
  const fallbackIndex = Math.min(Math.max((task.timeline?.length || 1) - 1, 0), TASK_PROGRESS_STEPS.length - 1);
  const reachedIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;

  return `
    <div class="task-status-note ${isInterrupted ? "interrupted" : ""}">
      ${icon(isInterrupted ? "circle-alert" : isFinished ? "check-circle-2" : "route")}
      <span>${escapeHtml(taskProgressHint(task))}</span>
    </div>
    <div class="task-progress" aria-label="任务进度">
      ${TASK_PROGRESS_STEPS.map((step, index) => {
        const stepClass = [
          index < reachedIndex || isFinished ? "completed" : "",
          index === reachedIndex && !isFinished && !isInterrupted ? "current" : "",
          index === reachedIndex && isInterrupted ? "interrupted" : "",
        ].filter(Boolean).join(" ");
        return `
          <div class="progress-step ${stepClass}">
            <span class="progress-dot">${index + 1}</span>
            <strong>${escapeHtml(step.label)}</strong>
            <small>${escapeHtml(step.hint)}</small>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function taskProgressHint(task) {
  const taker = task.takerId ? userById(task.takerId).nickname : "接单者";
  if (task.status === "待接单") return "当前等待认证用户接单。";
  if (task.status === "进行中") return `${taker} 已接单并正在执行。`;
  if (task.status === "已完成") return "任务已完成，流程已闭环。";
  if (task.status === "已取消") return task.cancelReason ? `任务已取消：${task.cancelReason}` : "任务已取消。";
  return `当前状态：${task.status}`;
}

function renderSafetyBlock(channel) {
  return `
    <div class="detail-block">
      <h3>安全提示</h3>
      <p>
        ${channel === "闲置转让" ? "高价商品建议当面验货，确认配件、瑕疵和价格后再交易。" : "默认隐藏手机号、微信号、学号等敏感信息，优先通过站内沟通确认细节。"}
      </p>
    </div>
  `;
}

function renderListingActions(item) {
  const user = currentUser();
  if (!user || user.id !== item.publisherId) {
    return `<p class="small-text">发布者可在此标记成交或下架。</p>`;
  }

  const editButton = `<button class="ghost-button" type="button" data-action="edit-listing" data-id="${item.id}">${icon("pencil")}修改信息</button>`;

  if (item.status === "已下架" && isAdminRemovedListing(item)) {
    return `
      <div class="button-row">
        ${editButton}
        <p class="small-text">该信息已被管理员下架，需由管理员审核后恢复展示。</p>
      </div>
    `;
  }

  if (item.status === "已下架" || item.status === "已完成") {
    const label = item.status === "已完成" ? "撤回成交并恢复展示" : "重新上架";
    return `
      <div class="button-row">
        ${editButton}
        <button class="primary-button" type="button" data-action="listing-status" data-status="展示中" data-id="${item.id}">${icon("rotate-ccw")}${label}</button>
      </div>
    `;
  }

  if (item.status === "待审核") {
    return `
      <div class="button-row">
        ${editButton}
        <p class="small-text">当前状态不可直接变更，待审核内容需由管理员处理。</p>
      </div>
    `;
  }

  return `
    <div class="button-row">
      ${editButton}
      <button class="secondary-button" type="button" data-action="listing-status" data-status="已完成" data-id="${item.id}">${icon("check-circle-2")}标记成交</button>
      <button class="ghost-button" type="button" data-action="listing-status" data-status="已下架" data-id="${item.id}">${icon("archive")}下架</button>
    </div>
  `;
}

function renderTaskActions(task) {
  const user = currentUser();
  if (!user) return `<p class="small-text">登录并完成校园认证后可接单或管理任务。</p>`;

  const isPublisher = user.id === task.publisherId;
  const isTaker = user.id === task.takerId;
  const buttons = [];

  if (task.status === "待接单" && !isPublisher) {
    buttons.push(`<button class="primary-button" type="button" data-action="task-state" data-next="accept" data-id="${task.id}">${icon("handshake")}接单</button>`);
  }
  if (task.status === "进行中" && isTaker) {
    buttons.push(`<button class="primary-button" type="button" data-action="task-state" data-next="complete" data-id="${task.id}">${icon("check-circle-2")}完成任务</button>`);
    buttons.push(`<button class="ghost-button" type="button" data-action="task-state" data-next="release" data-id="${task.id}">${icon("rotate-ccw")}撤回接单</button>`);
  }
  if (task.status === "已完成" && (isPublisher || isTaker)) {
    buttons.push(`<button class="primary-button" type="button" data-action="task-state" data-next="restore-progress" data-id="${task.id}">${icon("rotate-ccw")}恢复进行中</button>`);
  }
  if (task.status === "已取消" && (isPublisher || isTaker)) {
    buttons.push(`<button class="primary-button" type="button" data-action="task-state" data-next="restore-cancel" data-id="${task.id}">${icon("rotate-ccw")}恢复取消前状态</button>`);
  }
  if (!["已完成", "已取消"].includes(task.status) && (isPublisher || isTaker)) {
    buttons.push(`<button class="danger-button" type="button" data-action="task-state" data-next="cancel" data-id="${task.id}">${icon("x-circle")}取消</button>`);
  }

  if (!buttons.length) {
    return `<p class="small-text">当前账号暂无可执行操作。</p>`;
  }
  return `<div class="button-row">${buttons.join("")}</div>`;
}

function renderPublish() {
  const type = state.publishType;
  const categories = db.categories[type] || CATEGORY_MAP[type] || [];
  const isTask = isTaskChannel(type);
  const user = currentUser();

  return `
    <section class="page-head">
      <div>
        <p class="eyebrow">快速发布</p>
        <h1>先选类型，再填表单</h1>
        <p class="lead">标题 5 到 40 字，敏感词和禁售禁发规则会在提交时校验。任务类需要填写截止时间。</p>
      </div>
      ${user ? statusBadge(user.verifyStatus) : `<button class="secondary-button" type="button" data-action="login-modal">${icon("log-in")}登录</button>`}
    </section>

    <section class="publish-shell">
      <aside class="section-panel">
        <h3>发布类型</h3>
        <div class="type-grid" style="display: grid;">
          ${CHANNELS.map(
            (channel) => `
              <button class="type-card ${type === channel.key ? "active" : ""}" type="button" data-action="publish-type" data-type="${channel.key}">
                <span class="channel-icon">${icon(channel.icon)}</span>
                <span>
                  <strong>${escapeHtml(channel.key)}</strong>
                  <span>${escapeHtml(channel.desc)}</span>
                </span>
              </button>
            `,
          ).join("")}
        </div>
      </aside>

      <div class="section-panel">
        <form data-form="publish" class="form-grid">
          <input type="hidden" name="channel" value="${escapeHtml(type)}" />
          <div class="field full">
            <label for="publishTitle">标题</label>
            <input id="publishTitle" name="title" maxlength="40" required placeholder="例如：快递站代取两个小件送到宿舍楼" />
          </div>
          <div class="field">
            <label for="publishCategory">分类</label>
            <select id="publishCategory" name="category" required>
              ${categories.map((category) => `<option>${escapeHtml(category)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="publishCampus">校区</label>
            <select id="publishCampus" name="campus" required>
              ${CAMPUSES.map((campus) => `<option ${campus === user?.campus ? "selected" : ""}>${campus}</option>`).join("")}
            </select>
          </div>
          ${
            isTask
              ? renderTaskPublishFields(type)
              : renderListingPublishFields(type)
          }
          <div class="field full">
            <label for="publishDescription">描述</label>
            <textarea id="publishDescription" name="description" required placeholder="说明细节、要求、限制、交易方式或服务方式"></textarea>
          </div>
          <div class="field full">
            <label for="publishImage">图片（可选，10MB以内）</label>
            <input id="publishImage" name="imageFile" type="file" accept="image/*" />
          </div>
          <div class="form-actions field full">
            <button class="primary-button" type="submit">${icon("send")}提交发布</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderListingPublishFields(type) {
  const isWanted = type === "求购交换";
  return `
    <div class="field">
      <label for="publishLocation">地点</label>
      <input id="publishLocation" name="locationText" required placeholder="交易地点、服务地点或捡到地点" />
    </div>
    <div class="field">
      <label for="publishContact">联系方式可见性</label>
      <select id="publishContact" name="contactMode">
        <option>站内沟通</option>
        <option>认证后可见</option>
      </select>
    </div>
    ${
      isWanted
        ? `
          <div class="field">
            <label for="budgetMin">预算下限</label>
            <input id="budgetMin" name="budgetMin" type="number" min="0" placeholder="例如 20" />
          </div>
          <div class="field">
            <label for="budgetMax">预算上限</label>
            <input id="budgetMax" name="budgetMax" type="number" min="0" placeholder="例如 80" />
          </div>
        `
        : `
          <div class="field">
            <label for="publishPrice">价格/服务费</label>
            <input id="publishPrice" name="price" type="number" min="0" placeholder="${type === "失物招领" ? "可不填" : "例如 35"}" />
          </div>
          <div class="field">
            <label for="conditionLevel">成色</label>
            <select id="conditionLevel" name="conditionLevel">
              <option>不限</option>
              <option>全新</option>
              <option>九成新</option>
              <option>八成新</option>
              <option>七成新</option>
              <option>六成新</option>
            </select>
          </div>
        `
    }
  `;
}

function renderTaskPublishFields(type) {
  return `
    <div class="field">
      <label for="pickupLocation">取货点</label>
      <input id="pickupLocation" name="pickupLocation" required placeholder="例如：东校区菜鸟驿站" />
    </div>
    <div class="field">
      <label for="deliveryLocation">送达点</label>
      <input id="deliveryLocation" name="deliveryLocation" required placeholder="例如：竹园 3 栋楼下" />
    </div>
    <div class="field">
      <label for="reward">报酬</label>
      <input id="reward" name="reward" type="number" min="0" required placeholder="例如 8" />
    </div>
    <div class="field">
      <label for="deadlineAt">截止时间</label>
      <input id="deadlineAt" name="deadlineAt" type="datetime-local" required />
    </div>
    <div class="field full">
      <label for="itemNote">物品说明</label>
      <input id="itemNote" name="itemNote" required placeholder="${type === "校内送货" ? "物品类型、重量、是否易碎" : "验证码交付方式、物品数量、特殊要求"}" />
    </div>
  `;
}

function renderProfile() {
  const user = currentUser();
  if (!user) {
    return renderAuthRequired("登录后可查看我的发布、我的接单、收藏、消息和校园认证。");
  }

  const tabs = [
    ["overview", "总览", "layout-dashboard"],
    ["verification", "校园认证", "badge-check"],
    ["posts", "我的发布", "list"],
    ["tasks", "我的任务", "package-check"],
    ["favorites", "收藏历史", "heart"],
    ["settings", "账号设置", "settings"],
  ];

  return `
    <section class="page-head">
      <div>
        <p class="eyebrow">个人中心</p>
        <h1>${escapeHtml(user.nickname)}</h1>
        <p class="lead">管理发布内容、接单任务、收藏、浏览历史、举报记录与校园认证状态。</p>
      </div>
      <button class="ghost-button" type="button" data-action="logout">${icon("log-out")}退出</button>
    </section>

    <section class="profile-layout">
      <aside class="profile-card">
        <div class="seller-card">
          <span class="avatar">${escapeHtml(user.nickname.slice(0, 1))}</span>
          <div>
            <strong>${escapeHtml(user.nickname)}</strong>
            <p class="small-text">${escapeHtml(user.campus)} · ${maskPhone(user.phone)}</p>
            ${statusBadge(user.verifyStatus)}
          </div>
        </div>
        <div class="divider"></div>
        <div class="profile-tabs">
          ${tabs.map(([key, label, iconName]) => `<button class="tab-button ${state.profileTab === key ? "active" : ""}" type="button" data-action="profile-tab" data-tab="${key}">${icon(iconName)}${label}</button>`).join("")}
        </div>
      </aside>
      <div class="section-panel">
        ${renderProfileTab(user)}
      </div>
    </section>
  `;
}

function renderAuthRequired(text, options = {}) {
  const action = options.action || "login-modal";
  const label = options.label || "登录 / 注册";
  const buttonIcon = options.icon || "log-in";
  return `
    <section class="empty-state">
      <div>
        <p>${escapeHtml(text)}</p>
        <button class="primary-button" type="button" data-action="${action}">${icon(buttonIcon)}${label}</button>
      </div>
    </section>
  `;
}

function renderLoginPage() {
  const isLogin = state.authMode === "login";
  return `
    <section class="auth-page">
      <div class="auth-hero">
        <p class="eyebrow">校园轻集市</p>
        <h1>请登录后进入平台</h1>
        <p class="lead">普通用户进入校园信息与个人中心，管理员进入审核和运营后台。账号、发布、收藏、消息都通过后端服务保存。</p>
        <div class="badge-row">
          <span class="badge success">Vue 用户端</span>
          <span class="badge info">Express API</span>
          <span class="badge info">MySQL 数据库</span>
        </div>
      </div>

      <div class="section-panel auth-panel">
        <div class="auth-tabs">
          <button class="tab-button ${isLogin ? "active" : ""}" type="button" data-action="auth-mode" data-mode="login">${icon("log-in")}登录</button>
          <button class="tab-button ${!isLogin ? "active" : ""}" type="button" data-action="auth-mode" data-mode="register">${icon("user-plus")}注册</button>
        </div>
        <div class="divider"></div>
        ${
          isLogin
            ? `
              <form class="form-grid" data-form="login">
                <div class="field full">
                  <label for="pageLoginAccount">账号 / 邮箱 / 手机号</label>
                  <input id="pageLoginAccount" name="account" required autocomplete="username" placeholder="请输入账号" />
                </div>
                <div class="field full">
                  <label for="pageLoginPassword">密码</label>
                  <input id="pageLoginPassword" name="password" type="password" required autocomplete="current-password" placeholder="请输入密码" />
                </div>
                <div class="field full">
                  <button class="primary-button" type="submit">${icon("log-in")}登录</button>
                </div>
              </form>
            `
            : `
              <form class="form-grid" data-form="register">
                <div class="field">
                  <label for="pageRegisterAccount">账号</label>
                  <input id="pageRegisterAccount" name="account" required autocomplete="username" placeholder="英文或数字" />
                </div>
                <div class="field">
                  <label for="pageRegisterNickname">昵称</label>
                  <input id="pageRegisterNickname" name="nickname" required placeholder="校园昵称" />
                </div>
                <div class="field">
                  <label for="pageRegisterPhone">手机号</label>
                  <input id="pageRegisterPhone" name="phone" required placeholder="仅脱敏展示" />
                </div>
                <div class="field">
                  <label for="pageRegisterEmail">邮箱</label>
                  <input id="pageRegisterEmail" name="email" type="email" required placeholder="name@campus.edu" />
                </div>
                <div class="field">
                  <label for="pageRegisterCampus">校区</label>
                  <select id="pageRegisterCampus" name="campus">${CAMPUSES.map((campus) => `<option>${campus}</option>`).join("")}</select>
                </div>
                <div class="field">
                  <label for="pageRegisterPassword">密码</label>
                  <input id="pageRegisterPassword" name="password" type="password" minlength="6" required autocomplete="new-password" />
                </div>
                <div class="field full">
                  <button class="primary-button" type="submit">${icon("user-plus")}注册并登录</button>
                </div>
              </form>
            `
        }
      </div>
    </section>
  `;
}

function renderProfileTab(user) {
  if (state.profileTab === "verification") return renderVerificationForm(user);
  if (state.profileTab === "posts") return renderMyPosts(user);
  if (state.profileTab === "tasks") return renderMyTasks(user);
  if (state.profileTab === "favorites") return renderFavorites(user);
  if (state.profileTab === "settings") return renderSettings(user);
  return renderProfileOverview(user);
}

function renderProfileOverview(user) {
  const summary = profileSummaryFor(user);
  return `
    <h2>账号总览</h2>
    <div class="stats-grid">
      ${renderSummaryShortcuts(summary)}
    </div>
    <div class="divider"></div>
    <h3>信用标签</h3>
    <div class="badge-row">
      ${statusBadge(user.verifyStatus)}
      <span class="badge success">信用分 ${user.creditScore}</span>
      <span class="badge info">成交/完成 ${db.tasks.filter((task) => (task.publisherId === user.id || task.takerId === user.id) && task.status === "已完成").length}</span>
      <span class="badge">同校沟通优先</span>
    </div>
  `;
}

function renderVerificationForm(user) {
  const record = db.verifications
    .filter((item) => item.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  if (user.verifyStatus === "已认证") {
    return `
      <h2>校园认证</h2>
      <p class="lead">你已完成校园认证，可发布信息、接单和站内沟通。</p>
      <div class="divider"></div>
      <div class="badge-row">
        ${statusBadge(user.verifyStatus)}
        <span class="badge">认证校区：${escapeHtml(user.campus)}</span>
        <span class="badge">学号与真实姓名仅后台可见</span>
      </div>
    `;
  }

  return `
    <h2>校园认证</h2>
    <p class="lead">提交真实姓名、学号和校园邮箱或证明材料。管理员审核通过后可使用发布、接单和站内沟通。</p>
    ${record ? `<p class="small-text">最近记录：${statusBadge(record.status)} ${record.rejectReason ? ` · ${escapeHtml(record.rejectReason)}` : ""}</p>` : ""}
    <div class="divider"></div>
    <form class="form-grid" data-form="verification">
      <div class="field">
        <label for="realName">真实姓名</label>
        <input id="realName" name="realName" required placeholder="仅后台可见" />
      </div>
      <div class="field">
        <label for="studentNo">学号</label>
        <input id="studentNo" name="studentNo" required placeholder="仅后台可见" />
      </div>
      <div class="field">
        <label for="method">认证方式</label>
        <select id="method" name="method">
          <option>校园邮箱</option>
          <option>学生证照片</option>
          <option>教务系统截图</option>
        </select>
      </div>
      <div class="field">
        <label for="proofUrl">证明材料</label>
        <input id="proofUrl" name="proofUrl" required placeholder="邮箱地址或材料链接" />
      </div>
      <div class="field full">
        <button class="primary-button" type="submit">${icon("send")}提交认证</button>
      </div>
    </form>
  `;
}

function renderMyPosts(user) {
  const items = db.listings.filter((item) => item.publisherId === user.id);
  return `
    <div class="section-head">
      <div>
        <h2>我的发布</h2>
        <p class="small-text">全部、在架、待审核、已完成、已下架状态集中管理。</p>
      </div>
      <button class="secondary-button" type="button" data-action="publish">${icon("plus")}新发布</button>
    </div>
    <div class="results-list">
      ${items.length ? items.map((item) => renderListingCard(item, true, { ownerAccess: true })).join("") : renderInlineEmpty("还没有发布帖子。")}
    </div>
  `;
}

function renderMyTasks(user) {
  const items = db.tasks.filter((task) => task.publisherId === user.id || task.takerId === user.id);
  return `
    <h2>我的任务</h2>
    <p class="small-text">包含我发布的任务和我接单的任务。</p>
    <div class="divider"></div>
    <div class="results-list">
      ${items.length ? items.map((task) => renderTaskCard(task, true)).join("") : renderInlineEmpty("暂无相关任务。")}
    </div>
  `;
}

function renderFavorites(user) {
  const favorites = db.favorites
    .filter((fav) => fav.userId === user.id)
    .filter((fav) => {
      const item = itemByKind(fav.kind, fav.id);
      return item && canBrowseItem(fav.kind, item, user);
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const history = db.browseHistory
    .filter((row) => row.userId === user.id)
    .filter((row) => {
      const item = itemByKind(row.kind, row.id);
      return item && canBrowseItem(row.kind, item, user);
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return `
    <h2>收藏与浏览历史</h2>
    <div class="section-stack">
      <div>
        <h3>我的收藏</h3>
        <div class="results-list">
          ${favorites.length ? favorites.map((fav) => {
            const item = itemByKind(fav.kind, fav.id);
            if (!item) return "";
            return fav.kind === "task" ? renderTaskCard(item, true) : renderListingCard(item, true);
          }).join("") : renderInlineEmpty("还没有收藏。")}
        </div>
      </div>
      <div>
        <h3>浏览历史</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>类型</th><th>标题</th><th>时间</th><th>操作</th></tr></thead>
            <tbody>
              ${history.map((row) => `<tr><td>${row.kind === "task" ? "任务" : "帖子"}</td><td>${escapeHtml(itemTitle(row.kind, row.id))}</td><td>${dateText(row.createdAt)}</td><td><button class="table-action" type="button" data-action="detail" data-kind="${row.kind}" data-id="${row.id}">${icon("eye")}查看</button></td></tr>`).join("") || `<tr><td colspan="4">暂无浏览历史</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderSettings(user) {
  return `
    <h2>账号设置</h2>
    <div class="stats-grid settings-grid">
      <div class="stat-card"><strong>${escapeHtml(user.account)}</strong><span>登录账号</span></div>
      <div class="stat-card"><strong>${maskPhone(user.phone)}</strong><span>手机号脱敏</span></div>
      <div class="stat-card"><strong>${escapeHtml(user.email)}</strong><span>邮箱</span></div>
      <div class="stat-card"><strong>${escapeHtml(user.status)}</strong><span>账号状态</span></div>
    </div>
    <div class="divider"></div>
    <p class="small-text">默认隐藏手机号、学号、真实姓名等敏感信息；账号资料和后台审核数据由后端持久化保存。</p>
  `;
}

function renderAdmin() {
  const user = currentUser();
  if (!user || user.role !== "admin") {
    return `
      <section class="empty-state">
        <div>
          <p>管理后台需要管理员账号。请使用管理员账号登录。</p>
          <button class="primary-button" type="button" data-action="login-modal">${icon("shield")}管理员登录</button>
        </div>
      </section>
    `;
  }

  const tabs = [
    ["dashboard", "数据看板", "layout-dashboard"],
    ["users", "用户管理", "users"],
    ["verification", "认证审核", "badge-check"],
    ["listings", "信息管理", "list-checks"],
    ["tasks", "任务管理", "package-check"],
    ["reports", "举报处理", "flag"],
    ["categories", "分类管理", "folders"],
    ["announcements", "公告管理", "megaphone"],
    ["logs", "操作日志", "file-clock"],
  ];

  return `
    <section class="page-head">
      <div>
        <p class="eyebrow">管理后台</p>
        <h1>审核、风控与运营</h1>
        <p class="lead">覆盖用户管理、校园认证审核、帖子审核、任务异常、举报、分类和公告。</p>
      </div>
      <button class="ghost-button" type="button" data-action="logout">${icon("log-out")}退出</button>
    </section>

    <section class="admin-layout">
      <aside class="admin-panel">
        <div class="admin-tabs">
          ${tabs.map(([key, label, iconName]) => `<button class="tab-button ${state.adminTab === key ? "active" : ""}" type="button" data-action="admin-tab" data-tab="${key}">${icon(iconName)}${label}</button>`).join("")}
        </div>
      </aside>
      <div class="admin-panel">
        ${renderAdminTab()}
      </div>
    </section>
  `;
}

function renderAdminTab() {
  if (state.adminTab === "users") return renderAdminUsers();
  if (state.adminTab === "verification") return renderAdminVerification();
  if (state.adminTab === "listings") return renderAdminListings();
  if (state.adminTab === "tasks") return renderAdminTasks();
  if (state.adminTab === "reports") return renderAdminReports();
  if (state.adminTab === "categories") return renderAdminCategories();
  if (state.adminTab === "announcements") return renderAdminAnnouncements();
  if (state.adminTab === "logs") return renderAdminLogs();
  return renderAdminDashboard();
}

function renderAdminDashboard() {
  const pendingVerifications = db.verifications.filter((item) => item.status === "待审核").length;
  const pendingListings = db.listings.filter((item) => item.status === "待审核").length;
  const pendingReports = db.reports.filter((item) => item.status === "待处理").length;
  const activeTasks = db.tasks.filter((task) => ["待接单", "进行中"].includes(task.status)).length;
  return `
    <h2>数据看板</h2>
    <div class="stats-grid">
      <div class="stat-card"><strong>${db.users.length}</strong><span>用户数</span></div>
      <div class="stat-card"><strong>${db.listings.length}</strong><span>发布量</span></div>
      <div class="stat-card"><strong>${db.tasks.length}</strong><span>任务量</span></div>
      <div class="stat-card"><strong>${pendingReports}</strong><span>待处理举报</span></div>
      <div class="stat-card"><strong>${pendingVerifications}</strong><span>认证待审</span></div>
      <div class="stat-card"><strong>${pendingListings}</strong><span>帖子待审</span></div>
      <div class="stat-card"><strong>${activeTasks}</strong><span>进行中任务</span></div>
      <div class="stat-card"><strong>${db.auditLogs.length}</strong><span>操作日志</span></div>
    </div>
    <div class="divider"></div>
    <h3>待办入口</h3>
    <div class="button-row">
      <button class="secondary-button" type="button" data-action="admin-tab" data-tab="verification">${icon("badge-check")}认证审核</button>
      <button class="secondary-button" type="button" data-action="admin-tab" data-tab="listings">${icon("list-checks")}信息审核</button>
      <button class="secondary-button" type="button" data-action="admin-tab" data-tab="reports">${icon("flag")}举报处理</button>
    </div>
  `;
}

function renderAdminUsers() {
  return `
    <h2>用户管理</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>用户</th><th>联系方式</th><th>认证</th><th>信用</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${db.users.map((user) => `
            <tr>
              <td>${escapeHtml(user.nickname)}<br><span class="small-text">${escapeHtml(user.account)} · ${escapeHtml(user.role)}</span></td>
              <td>${maskPhone(user.phone)}<br><span class="small-text">${escapeHtml(user.email)}</span></td>
              <td>${statusBadge(user.verifyStatus)}</td>
              <td>${user.creditScore}</td>
              <td>${statusBadge(user.status)}</td>
              <td class="admin-actions">
                <button class="table-action" type="button" data-action="user-status" data-id="${user.id}" data-status="正常">正常</button>
                <button class="table-action" type="button" data-action="user-status" data-id="${user.id}" data-status="封禁">封禁</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminVerification() {
  return `
    <h2>校园认证审核</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>用户</th><th>姓名/学号</th><th>方式</th><th>材料</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${db.verifications.map((record) => {
            const user = userById(record.userId);
            return `
              <tr>
                <td>${escapeHtml(user.nickname)}<br><span class="small-text">${escapeHtml(user.campus)}</span></td>
                <td>${escapeHtml(record.realName)}<br><span class="small-text">${escapeHtml(record.studentNo)}</span></td>
                <td>${escapeHtml(record.method)}</td>
                <td>${escapeHtml(record.proofUrl)}</td>
                <td>${statusBadge(record.status)}</td>
                <td class="admin-actions">
                  <button class="table-action" type="button" data-action="verify-review" data-id="${record.id}" data-status="通过">通过</button>
                  <button class="table-action" type="button" data-action="verify-review" data-id="${record.id}" data-status="驳回">驳回</button>
                </td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="6">暂无认证记录</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminListings() {
  return `
    <h2>信息管理</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>标题</th><th>频道</th><th>发布者</th><th>状态</th><th>热度</th><th>操作</th></tr></thead>
        <tbody>
          ${db.listings.map((item) => `
            <tr>
              <td>${escapeHtml(item.title)}<br><span class="small-text">${escapeHtml(item.locationText)}</span></td>
              <td>${escapeHtml(item.channel)} / ${escapeHtml(item.category)}</td>
              <td>${escapeHtml(userById(item.publisherId).nickname)}</td>
              <td>${statusBadge(item.status)}</td>
              <td>浏览 ${item.viewCount}<br><span class="small-text">收藏 ${item.favoriteCount}</span></td>
              <td class="admin-actions">
                <button class="table-action" type="button" data-action="admin-listing-status" data-id="${item.id}" data-status="展示中">通过</button>
                <button class="table-action" type="button" data-action="admin-listing-status" data-id="${item.id}" data-status="已下架">下架</button>
                <button class="table-action" type="button" data-action="detail" data-kind="listing" data-id="${item.id}">${icon("eye")}查看</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminTasks() {
  return `
    <h2>任务管理</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>任务</th><th>路线</th><th>发布/接单</th><th>状态</th><th>截止</th><th>操作</th></tr></thead>
        <tbody>
          ${db.tasks.map((task) => `
            <tr>
              <td>${escapeHtml(task.title)}<br><span class="small-text">${escapeHtml(task.taskType)} · ${money(task.reward)}</span></td>
              <td>${escapeHtml(task.pickupLocation)}<br><span class="small-text">到 ${escapeHtml(task.deliveryLocation)}</span></td>
              <td>${escapeHtml(userById(task.publisherId).nickname)}<br><span class="small-text">接单：${task.takerId ? escapeHtml(userById(task.takerId).nickname) : "暂无"}</span></td>
              <td>${statusBadge(task.status)}</td>
              <td>${deadlineText(task.deadlineAt)}</td>
              <td class="admin-actions">
                <button class="table-action" type="button" data-action="admin-task-status" data-id="${task.id}" data-status="已取消">取消任务</button>
                <button class="table-action" type="button" data-action="detail" data-kind="task" data-id="${task.id}">${icon("eye")}查看</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminReports() {
  return `
    <h2>举报处理</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>对象</th><th>举报人</th><th>原因</th><th>状态</th><th>处理结果</th><th>操作</th></tr></thead>
        <tbody>
          ${db.reports.map((report) => `
            <tr>
              <td>${report.targetKind === "task" ? "任务" : "帖子"}：${escapeHtml(itemTitle(report.targetKind, report.targetId))}</td>
              <td>${escapeHtml(userById(report.reporterId).nickname)}</td>
              <td>${escapeHtml(report.reason)}</td>
              <td>${statusBadge(report.status)}</td>
              <td>${escapeHtml(report.result || "暂无")}</td>
              <td class="admin-actions">
                <button class="table-action" type="button" data-action="report-resolve" data-id="${report.id}" data-result="已警告并保留记录">警告</button>
                <button class="table-action" type="button" data-action="report-resolve" data-id="${report.id}" data-result="已下架相关内容">下架</button>
                <button class="table-action" type="button" data-action="detail" data-kind="${report.targetKind}" data-id="${report.targetId}">${icon("eye")}查看</button>
              </td>
            </tr>
          `).join("") || `<tr><td colspan="6">暂无举报</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminCategories() {
  return `
    <h2>分类管理</h2>
    <form class="form-grid" data-form="category">
      <div class="field">
        <label for="categoryChannel">频道</label>
        <select id="categoryChannel" name="channel">
          ${CHANNELS.map((channel) => `<option>${channel.key}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="categoryName">新增分类</label>
        <input id="categoryName" name="name" required placeholder="例如：毕业清仓" />
      </div>
      <div class="field full">
        <button class="primary-button" type="submit">${icon("plus")}新增分类</button>
      </div>
    </form>
    <div class="divider"></div>
    ${CHANNELS.map((channel) => `
      <h3>${escapeHtml(channel.key)}</h3>
      <div class="badge-row" style="margin-bottom: 14px;">
        ${(db.categories[channel.key] || []).map((category) => `<span class="badge">${escapeHtml(category)}</span>`).join("")}
      </div>
    `).join("")}
  `;
}

function renderAdminAnnouncements() {
  return `
    <h2>公告管理</h2>
    <form class="form-grid" data-form="announcement">
      <div class="field">
        <label for="noticeTitle">标题</label>
        <input id="noticeTitle" name="title" required placeholder="公告标题" />
      </div>
      <div class="field">
        <label for="noticeLevel">类型</label>
        <select id="noticeLevel" name="level">
          <option>公告</option>
          <option>安全</option>
          <option>活动</option>
        </select>
      </div>
      <div class="field full">
        <label for="noticeContent">内容</label>
        <textarea id="noticeContent" name="content" required placeholder="公告内容"></textarea>
      </div>
      <div class="field full">
        <button class="primary-button" type="submit">${icon("megaphone")}发布公告</button>
      </div>
    </form>
    <div class="divider"></div>
    <div class="results-list">
      ${db.announcements.map((notice) => `
        <div class="detail-block">
          <div class="badge-row"><span class="badge info">${escapeHtml(notice.level)}</span><span class="badge">${dateText(notice.createdAt)}</span></div>
          <h3>${escapeHtml(notice.title)}</h3>
          <p>${escapeHtml(notice.content)}</p>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAdminLogs() {
  return `
    <h2>操作日志</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>时间</th><th>管理员</th><th>操作</th></tr></thead>
        <tbody>
          ${db.auditLogs.slice().reverse().map((log) => `
            <tr>
              <td>${deadlineText(log.createdAt)}</td>
              <td>${escapeHtml(userById(log.adminId).nickname)}</td>
              <td>${escapeHtml(log.text)}</td>
            </tr>
          `).join("") || `<tr><td colspan="3">暂无操作日志</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function openAuthModal(mode = "login") {
  state.authMode = mode === "register" ? "register" : "login";
  const isLogin = mode === "login";
  $("#modalRoot").innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <p class="eyebrow">${isLogin ? "欢迎回来" : "创建账号"}</p>
          <h2>${isLogin ? "登录校园轻集市" : "注册新用户"}</h2>
        </div>
        <button class="icon-button" type="button" data-action="close-modal" title="关闭">${icon("x")}</button>
      </div>
      ${
        isLogin
          ? `
            <form class="form-grid" data-form="login">
              <div class="field full">
                <label for="loginAccount">账号 / 邮箱 / 手机号</label>
                <input id="loginAccount" name="account" required autocomplete="username" placeholder="请输入账号" />
              </div>
              <div class="field full">
                <label for="loginPassword">密码</label>
                <input id="loginPassword" name="password" type="password" required autocomplete="current-password" placeholder="请输入密码" />
              </div>
              <div class="field full">
                <button class="primary-button" type="submit">${icon("log-in")}登录</button>
              </div>
            </form>
            <button class="link-button" type="button" data-action="auth-mode" data-mode="register">${icon("user-plus")}注册新账号</button>
          `
          : `
            <form class="form-grid" data-form="register">
              <div class="field">
                <label for="registerAccount">账号</label>
                <input id="registerAccount" name="account" required placeholder="英文或数字" />
              </div>
              <div class="field">
                <label for="registerNickname">昵称</label>
                <input id="registerNickname" name="nickname" required placeholder="校园昵称" />
              </div>
              <div class="field">
                <label for="registerPhone">手机号</label>
                <input id="registerPhone" name="phone" required placeholder="仅脱敏展示" />
              </div>
              <div class="field">
                <label for="registerEmail">邮箱</label>
                <input id="registerEmail" name="email" type="email" required placeholder="name@campus.edu" />
              </div>
              <div class="field">
                <label for="registerCampus">校区</label>
                <select id="registerCampus" name="campus">${CAMPUSES.map((campus) => `<option>${campus}</option>`).join("")}</select>
              </div>
              <div class="field">
                <label for="registerPassword">密码</label>
                <input id="registerPassword" name="password" type="password" minlength="6" required />
              </div>
              <div class="field full">
                <button class="primary-button" type="submit">${icon("user-plus")}注册</button>
              </div>
            </form>
            <button class="link-button" type="button" data-action="auth-mode" data-mode="login">${icon("log-in")}已有账号登录</button>
          `
      }
    </div>
  `;
  hydrateIcons();
}

function openReportModal(kind, id) {
  const item = itemByKind(kind, id);
  if (!item) return;
  $("#modalRoot").innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <p class="eyebrow">举报</p>
          <h2>${escapeHtml(item.title)}</h2>
        </div>
        <button class="icon-button" type="button" data-action="close-modal" title="关闭">${icon("x")}</button>
      </div>
      <form class="form-grid" data-form="report">
        <input type="hidden" name="kind" value="${kind}" />
        <input type="hidden" name="id" value="${id}" />
        <div class="field full">
          <label for="reportReason">举报原因</label>
          <textarea id="reportReason" name="reason" required placeholder="请描述违规、诈骗、风险或信息不实的情况"></textarea>
        </div>
        <div class="field full">
          <button class="primary-button" type="submit">${icon("flag")}提交举报</button>
        </div>
      </form>
    </div>
  `;
  hydrateIcons();
}

function openListingEditModal(id) {
  if (!ensureAuth({ verified: true })) return;
  const listing = db.listings.find((item) => item.id === Number(id));
  const user = currentUser();
  if (!listing || listing.publisherId !== user.id) {
    toast("只能修改自己发布的信息");
    return;
  }
  const categories = db.categories[listing.channel] || CATEGORY_MAP[listing.channel] || [];
  const isWanted = listing.channel === "求购交换";
  $("#modalRoot").innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <p class="eyebrow">修改发布</p>
          <h2>${escapeHtml(listing.title)}</h2>
        </div>
        <button class="icon-button" type="button" data-action="close-modal" title="关闭">${icon("x")}</button>
      </div>
      <form class="form-grid" data-form="listing-edit">
        <input type="hidden" name="id" value="${listing.id}" />
        <div class="field full">
          <label for="editListingTitle">标题</label>
          <input id="editListingTitle" name="title" maxlength="40" required value="${escapeHtml(listing.title)}" />
        </div>
        <div class="field">
          <label for="editListingCategory">分类</label>
          <select id="editListingCategory" name="category" required>
            ${categories.map((category) => `<option ${category === listing.category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="editListingCampus">校区</label>
          <select id="editListingCampus" name="campus" required>
            ${CAMPUSES.map((campus) => `<option ${campus === listing.campus ? "selected" : ""}>${escapeHtml(campus)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="editListingLocation">地点</label>
          <input id="editListingLocation" name="locationText" required value="${escapeHtml(listing.locationText)}" />
        </div>
        <div class="field">
          <label for="editListingContact">联系方式可见性</label>
          <select id="editListingContact" name="contactMode">
            ${["站内沟通", "认证后可见"].map((mode) => `<option ${mode === listing.contactMode ? "selected" : ""}>${mode}</option>`).join("")}
          </select>
        </div>
        ${
          isWanted
            ? `
              <div class="field">
                <label for="editBudgetMin">预算下限</label>
                <input id="editBudgetMin" name="budgetMin" type="number" min="0" value="${escapeHtml(listing.budgetMin)}" />
              </div>
              <div class="field">
                <label for="editBudgetMax">预算上限</label>
                <input id="editBudgetMax" name="budgetMax" type="number" min="0" value="${escapeHtml(listing.budgetMax)}" />
              </div>
            `
            : `
              <div class="field">
                <label for="editListingPrice">价格/服务费</label>
                <input id="editListingPrice" name="price" type="number" min="0" value="${escapeHtml(listing.price)}" />
              </div>
              <div class="field">
                <label for="editConditionLevel">成色</label>
                <select id="editConditionLevel" name="conditionLevel">
                  ${["不限", "全新", "九成新", "八成新", "七成新", "六成新"].map((level) => `<option ${level === listing.conditionLevel ? "selected" : ""}>${level}</option>`).join("")}
                </select>
              </div>
            `
        }
        <div class="field full">
          <label for="editListingDescription">描述</label>
          <textarea id="editListingDescription" name="description" required>${escapeHtml(listing.description)}</textarea>
        </div>
        <div class="field full">
          <label for="editListingImage">图片</label>
          <div class="image-edit-row">
            <img src="${escapeHtml(listing.images?.[0] || IMAGE_POOL[listing.channel]?.[0] || IMAGE_POOL["闲置转让"][0])}" alt="${escapeHtml(listing.title)}当前图片" />
            <div>
              <input id="editListingImage" name="imageFile" type="file" accept="image/*" />
              <p class="small-text">不选择新图片则保留当前图片；新图片大小不能超过 10MB。</p>
            </div>
          </div>
        </div>
        <div class="form-actions field full">
          <button class="primary-button" type="submit">${icon("save")}保存修改</button>
        </div>
      </form>
    </div>
  `;
  hydrateIcons();
}

function closeModal() {
  $("#modalRoot").innerHTML = "";
}

function handleClick(event) {
  const target = event.target.closest("button, a");
  if (!target) return;

  if (target.id === "backButton") {
    goBack();
    return;
  }
  if (target.id === "brandButton") {
    setView("home", { channel: "全部" });
    return;
  }
  if (target.id === "publishButton") {
    setView("publish");
    return;
  }
  if (target.id === "messagesButton") {
    setView("messages");
    return;
  }
  if (target.id === "userButton") {
    const user = currentUser();
    if (!user) openAuthModal("login");
    else setView(user.role === "admin" ? "admin" : "profile");
    return;
  }

  const action = target.dataset.action;
  if (!action) return;

  if (action === "browse") {
    setView("browse", { channel: target.dataset.channel || "全部" });
  } else if (action === "publish") {
    setView("publish");
  } else if (action === "go-verification") {
    setView("profile", { profileTab: "verification" });
  } else if (action === "admin") {
    setView("admin");
  } else if (action === "profile-shortcut") {
    setView("profile", { profileTab: target.dataset.tab || "overview" });
  } else if (action === "messages-shortcut") {
    setView("messages");
  } else if (action === "mobile-view") {
    setView(target.dataset.view);
  } else if (action === "detail") {
    openDetail(target.dataset.kind, target.dataset.id);
  } else if (action === "owner-detail") {
    openDetail(target.dataset.kind, target.dataset.id, { ownerAccess: true });
  } else if (action === "favorite") {
    toggleFavorite(target.dataset.kind, target.dataset.id);
  } else if (action === "contact") {
    startConversation(target.dataset.kind, target.dataset.id);
  } else if (action === "edit-listing") {
    openListingEditModal(target.dataset.id);
  } else if (action === "open-report") {
    if (ensureAuth()) openReportModal(target.dataset.kind, target.dataset.id);
  } else if (action === "withdraw-report") {
    withdrawReport(target.dataset.id);
  } else if (action === "listing-status") {
    updateListingStatus(target.dataset.id, target.dataset.status);
  } else if (action === "task-state") {
    transitionTask(target.dataset.id, target.dataset.next);
  } else if (action === "publish-type") {
    state.publishType = target.dataset.type;
    render();
  } else if (action === "reset-filters") {
    resetFilters();
    render();
  } else if (action === "profile-tab") {
    state.profileTab = target.dataset.tab;
    render();
  } else if (action === "admin-tab") {
    state.adminTab = target.dataset.tab;
    render();
  } else if (action === "login-modal") {
    openAuthModal("login");
  } else if (action === "auth-mode") {
    state.authMode = target.dataset.mode || "login";
    if ($("#modalRoot").innerHTML.trim()) openAuthModal(state.authMode);
    else render();
  } else if (action === "close-modal") {
    closeModal();
  } else if (action === "logout") {
    logout();
  } else if (action === "conversation") {
    state.selectedConversationId = Number(target.dataset.id);
    render();
  } else if (action === "quick-message") {
    const textarea = $("#messageText");
    if (textarea) {
      textarea.value = target.dataset.text;
      textarea.focus();
    }
  } else if (action === "user-status") {
    updateUserStatus(target.dataset.id, target.dataset.status);
  } else if (action === "verify-review") {
    reviewVerification(target.dataset.id, target.dataset.status);
  } else if (action === "admin-listing-status") {
    adminUpdateListing(target.dataset.id, target.dataset.status);
  } else if (action === "admin-task-status") {
    adminUpdateTask(target.dataset.id, target.dataset.status);
  } else if (action === "report-resolve") {
    resolveReport(target.dataset.id, target.dataset.result);
  }
}

function handleSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const type = form.dataset.form;

  if (type === "filters") applyFilters(data);
  if (type === "login") login(data);
  if (type === "register") register(data);
  if (type === "publish") submitPublish(data, form);
  if (type === "listing-edit") updateListingDetails(data);
  if (type === "verification") submitVerification(data, form);
  if (type === "message") sendMessage(data, form);
  if (type === "report") submitReport(data);
  if (type === "category") addCategory(data, form);
  if (type === "announcement") addAnnouncement(data, form);
}

function handleInput(event) {
  if (event.target.id !== "globalSearch") return;
  state.query = event.target.value;
  if (state.view === "browse") {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => render(), 180);
  }
}

function handleKeydown(event) {
  if (event.target.id === "globalSearch" && event.key === "Enter") {
    event.preventDefault();
    setView("browse", { channel: "全部" });
  }
}

function applyFilters(data) {
  state.filters = {
    campus: data.campus || "全部",
    status: data.status || "全部",
    min: data.min || "",
    max: data.max || "",
    sort: data.sort || "最新发布",
  };
  render();
}

async function login(data) {
  const account = data.account.trim();
  if (!account || !data.password) {
    toast("请输入账号和密码");
    return;
  }

  try {
    const result = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ account, password: data.password }),
    });
    authToken = result.token || "";
    const user = upsertUser(result.user);
    currentUserId = user.id;
    saveSession();
    closeModal();

    await syncDbFromServer();
    upsertUser(result.user);
    currentUserId = user.id;
    saveSession();

    viewHistory.length = 0;
    state.authMode = "login";
    toast(`欢迎回来，${user.nickname}`);
    setView(user.role === "admin" ? "admin" : "home", {
      profileTab: "overview",
      adminTab: "dashboard",
      replace: true,
    });
  } catch (error) {
    toast(error.message || "登录失败");
  }
}

async function register(data) {
  const account = data.account.trim();
  if (!account || !data.password || !data.nickname.trim()) {
    toast("账号、密码和昵称必填");
    return;
  }

  try {
    const result = await apiRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        account,
        password: data.password,
        nickname: data.nickname.trim(),
        phone: data.phone.trim(),
        email: data.email.trim(),
        campus: data.campus,
      }),
    });
    authToken = result.token || "";
    const user = upsertUser(result.user);
    currentUserId = user.id;
    saveSession();
    closeModal();

    await syncDbFromServer();
    upsertUser(result.user);
    currentUserId = user.id;
    saveSession();

    viewHistory.length = 0;
    state.authMode = "login";
    toast("注册成功，请提交校园认证");
    setView("profile", { profileTab: "verification", replace: true });
  } catch (error) {
    toast(error.message || "注册失败");
  }
}

async function logout() {
  try {
    if (authToken) {
      await apiRequest("/api/auth/logout", { method: "POST" });
    }
  } catch {
    // 退出本地会话优先，后端会话失败不阻塞用户。
  }
  authToken = "";
  currentUserId = 0;
  saveSession();
  closeModal();
  viewHistory.length = 0;
  state.authMode = "login";
  toast("已退出登录");
  setView("home", {
    channel: "全部",
    detail: null,
    selectedConversationId: null,
    replace: true,
  });
}

async function submitPublish(data, form) {
  if (!ensureAuth({ verified: true })) return;

  const titleLength = Array.from(data.title.trim()).length;
  if (titleLength < 5 || titleLength > 40) {
    toast("标题需为 5 到 40 字");
    return;
  }

  const risk = scanRisk(`${data.title} ${data.description} ${data.itemNote || ""}`);
  if (risk.blocked.length) {
    toast(`命中禁发规则：${risk.blocked.join("、")}`);
    return;
  }

  const channel = data.channel;
  const reviewStatus = risk.review.length ? "待审核" : "展示中";

  if (isTaskChannel(channel)) {
    if (new Date(data.deadlineAt) <= new Date()) {
      toast("截止时间必须晚于当前时间");
      return;
    }
    const timeline = [
      {
        text: risk.review.length ? `命中风险词 ${risk.review.join("、")}，等待管理员介入` : "任务发布，等待认证用户接单",
        time: new Date().toISOString(),
      },
    ];
    try {
      const task = await apiRequest("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          channel,
          category: data.category,
          taskType: data.category,
          title: data.title.trim(),
          description: data.description.trim(),
          pickupLocation: data.pickupLocation.trim(),
          deliveryLocation: data.deliveryLocation.trim(),
          campus: data.campus,
          reward: Number(data.reward || 0),
          deadlineAt: new Date(data.deadlineAt).toISOString(),
          itemNote: data.itemNote.trim(),
          status: risk.review.length ? "已取消" : "待接单",
          timeline,
        }),
      });
      upsertRecord(db.tasks, task);
      await syncDbFromServer();
      form.reset();
      toast(risk.review.length ? "任务已进入人工复核" : "任务发布成功");
      setView("detail", { detail: { kind: "task", id: task.id } });
    } catch (error) {
      toast(error.message || "任务发布失败");
    }
    return;
  }

  const image = await resolvePublishImage(data.imageFile, channel);
  if (!image) return;

  try {
    const listing = await apiRequest("/api/listings", {
      method: "POST",
      body: JSON.stringify({
        channel,
        category: data.category,
        title: data.title.trim(),
        description: data.description.trim(),
        price: data.price ? Number(data.price) : "",
        budgetMin: data.budgetMin ? Number(data.budgetMin) : "",
        budgetMax: data.budgetMax ? Number(data.budgetMax) : "",
        conditionLevel: data.conditionLevel || "不限",
        campus: data.campus,
        locationText: data.locationText.trim(),
        contactMode: data.contactMode || "站内沟通",
        status: reviewStatus,
        images: [image],
        tags: risk.review.length ? ["待人工审核"] : ["站内沟通", "同校交易"],
      }),
    });
    upsertRecord(db.listings, listing);
    await syncDbFromServer();
    form.reset();
    toast(risk.review.length ? "信息已提交审核" : "发布成功");
    setView("detail", { detail: { kind: "listing", id: listing.id } });
  } catch (error) {
    toast(error.message || "发布失败");
  }
}

async function resolvePublishImage(file, channel) {
  const fallback = IMAGE_POOL[channel]?.[0] || IMAGE_POOL["闲置转让"][0];
  if (!file || typeof file === "string" || !file.size) return fallback;
  if (!file.type.startsWith("image/")) {
    toast("请选择图片文件");
    return "";
  }
  if (file.size > 10 * 1024 * 1024) {
    toast("图片大小不能超过 10MB");
    return "";
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const result = await apiRequest("/api/uploads/images", {
      method: "POST",
      body: JSON.stringify({ dataUrl }),
    });
    return result.url;
  } catch (error) {
    toast(error.message || "图片上传失败，请重新选择");
    return "";
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function scanRisk(text) {
  const blocked = FORBIDDEN_WORDS.filter((word) => text.includes(word));
  const review = REVIEW_WORDS.filter((word) => text.includes(word));
  return { blocked, review };
}

async function submitVerification(data, form) {
  if (!ensureAuth()) return;
  try {
    await apiRequest("/api/verifications", {
      method: "POST",
      body: JSON.stringify({
        realName: data.realName.trim(),
        studentNo: data.studentNo.trim(),
        method: data.method,
        proofUrl: data.proofUrl.trim(),
      }),
    });
    await syncDbFromServer();
    form.reset();
    toast("认证已提交，等待管理员审核");
    render();
  } catch (error) {
    toast(error.message || "认证提交失败");
  }
}

async function submitReport(data) {
  if (!ensureAuth()) return;
  try {
    await apiRequest("/api/reports", {
      method: "POST",
      body: JSON.stringify({
        targetKind: data.kind,
        targetId: Number(data.id),
        reason: data.reason.trim(),
      }),
    });
    await syncDbFromServer();
    closeModal();
    toast("举报已提交，管理员会处理");
    render();
  } catch (error) {
    toast(error.message || "举报提交失败");
  }
}

async function withdrawReport(id) {
  if (!ensureAuth()) return;
  const user = currentUser();
  const report = db.reports.find((item) => item.id === Number(id));
  if (!report || report.reporterId !== user.id) {
    toast("举报记录不存在");
    return;
  }
  if (report.status !== "待处理") {
    toast("已处理的举报不能撤销");
    return;
  }
  try {
    await apiRequest(`/api/reports/${report.id}`, { method: "DELETE" });
    await syncDbFromServer();
    toast("已撤销举报");
    render();
  } catch (error) {
    toast(error.message || "撤销举报失败");
  }
}

async function addCategory(data, form) {
  if (!ensureAuth({ admin: true })) return;
  try {
    await apiRequest("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify({ channel: data.channel, name: data.name.trim() }),
    });
    await syncDbFromServer();
    form.reset();
    toast("分类已新增");
    render();
  } catch (error) {
    toast(error.message || "分类新增失败");
  }
}

async function addAnnouncement(data, form) {
  if (!ensureAuth({ admin: true })) return;
  try {
    await apiRequest("/api/admin/announcements", {
      method: "POST",
      body: JSON.stringify({
        title: data.title.trim(),
        content: data.content.trim(),
        level: data.level,
      }),
    });
    await syncDbFromServer();
    form.reset();
    toast("公告已发布");
    render();
  } catch (error) {
    toast(error.message || "公告发布失败");
  }
}

function openDetail(kind, id, options = {}) {
  const item = itemByKind(kind, id);
  if (!item) {
    toast("信息不存在");
    return;
  }
  const canOpenAsOwner = options.ownerAccess && canViewOwnListingInProfile(kind, item);
  if (!canBrowseItem(kind, item) && !canOpenAsOwner) {
    toast(unavailableItemText(kind));
    return;
  }
  item.viewCount += 1;
  item.updatedAt = item.updatedAt || item.createdAt;
  const user = currentUser();
  if (user) {
    db.browseHistory = db.browseHistory.filter((row) => !(row.userId === user.id && row.kind === kind && row.id === Number(id)));
    db.browseHistory.unshift({
      userId: user.id,
      kind,
      id: Number(id),
      createdAt: new Date().toISOString(),
    });
    db.browseHistory = db.browseHistory.slice(0, 60);
    apiRequest("/api/history", {
      method: "POST",
      body: JSON.stringify({ kind, id: Number(id) }),
    }).catch(() => {});
  }
  if (!canOpenAsOwner) {
    const endpoint = kind === "task" ? `/api/tasks/${Number(id)}` : `/api/listings/${Number(id)}`;
    apiRequest(endpoint, { method: "GET" })
      .then((updated) => Object.assign(item, updated))
      .catch(() => {});
  }
  saveDb();
  setView("detail", { detail: { kind, id: Number(id), ownerAccess: canOpenAsOwner } });
}

async function toggleFavorite(kind, id) {
  if (!ensureAuth()) return;
  const item = itemByKind(kind, id);
  if (!item) return;
  if (!canBrowseItem(kind, item)) {
    toast(unavailableItemText(kind));
    return;
  }
  const user = currentUser();
  const index = db.favorites.findIndex((fav) => fav.userId === user.id && fav.kind === kind && fav.id === Number(id));
  const endpoint = kind === "task" ? `/api/tasks/${Number(id)}/favorite` : `/api/listings/${Number(id)}/favorite`;
  try {
    if (index >= 0) {
      await apiRequest(endpoint, { method: "DELETE" });
      toast("已取消收藏");
    } else {
      await apiRequest(kind === "task" ? endpoint : `/api/listings/${Number(id)}/favorite`, { method: "POST" });
      toast("已收藏");
    }
    await syncDbFromServer();
    render();
  } catch (error) {
    toast(error.message || "收藏操作失败");
  }
}

async function updateListingStatus(id, status) {
  if (!ensureAuth({ verified: true })) return;
  const item = db.listings.find((listing) => listing.id === Number(id));
  if (!item) return;
  if (item.publisherId !== currentUser().id) {
    toast("只能管理自己的帖子");
    return;
  }
  if (status === "展示中" && isAdminRemovedListing(item)) {
    toast("该信息已被管理员下架，不能自行重新上架");
    return;
  }
  const action = status === "展示中" ? "online" : status === "已完成" ? "complete" : "offline";
  try {
    await apiRequest(`/api/listings/${Number(id)}/${action}`, { method: "POST" });
    await syncDbFromServer();
    toast(status === "展示中" ? "已重新上架，其他用户可以浏览了" : `状态已更新为 ${status}`);
    render();
  } catch (error) {
    toast(error.message || "状态更新失败");
  }
}

async function updateListingDetails(data) {
  if (!ensureAuth({ verified: true })) return;
  const item = db.listings.find((listing) => listing.id === Number(data.id));
  const user = currentUser();
  if (!item || item.publisherId !== user.id) {
    toast("只能修改自己发布的信息");
    return;
  }

  const title = data.title.trim();
  const titleLength = Array.from(title).length;
  if (titleLength < 5 || titleLength > 40) {
    toast("标题需为 5 到 40 字");
    return;
  }
  const risk = scanRisk(`${title} ${data.description || ""}`);
  if (risk.blocked.length) {
    toast(`命中禁发规则：${risk.blocked.join("、")}`);
    return;
  }

  const updates = {
    category: data.category,
    title,
    description: data.description.trim(),
    campus: data.campus,
    locationText: data.locationText.trim(),
    contactMode: data.contactMode || "站内沟通",
  };
  if (item.channel === "求购交换") {
    updates.price = "";
    updates.budgetMin = data.budgetMin ? Number(data.budgetMin) : "";
    updates.budgetMax = data.budgetMax ? Number(data.budgetMax) : "";
    updates.conditionLevel = "不限";
  } else {
    updates.price = data.price ? Number(data.price) : "";
    updates.budgetMin = "";
    updates.budgetMax = "";
    updates.conditionLevel = data.conditionLevel || "不限";
  }
  if (data.imageFile && typeof data.imageFile !== "string" && data.imageFile.size) {
    const image = await resolvePublishImage(data.imageFile, item.channel);
    if (!image) return;
    updates.images = [image];
  }
  try {
    await apiRequest(`/api/listings/${Number(data.id)}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
    await syncDbFromServer();
    closeModal();
    toast("发布信息已更新");
    render();
  } catch (error) {
    toast(error.message || "发布信息更新失败");
  }
}

async function transitionTask(id, next) {
  if (!ensureAuth({ verified: true })) return;
  const task = db.tasks.find((item) => item.id === Number(id));
  if (!task) return;
  const user = currentUser();
  const isPublisher = task.publisherId === user.id;
  const isTaker = task.takerId === user.id;

  if (next === "accept") {
    if (task.status !== "待接单") return toast("任务已被接单或状态不可接单");
    if (isPublisher) return toast("发布者不能接自己的任务");
  } else if (next === "complete") {
    if (!isTaker || task.status !== "进行中") return toast("当前状态不可完成任务");
  } else if (next === "cancel") {
    if (!(isPublisher || isTaker) || ["已完成", "已取消"].includes(task.status)) return toast("当前状态不可取消");
    const reason = window.prompt("请输入取消原因", "双方协商取消");
    if (!reason) return;
    try {
      const updated = await apiRequest(`/api/tasks/${Number(id)}/${next}`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      upsertRecord(db.tasks, updated);
      await syncDbFromServer();
      render();
      toast(`任务已更新为${updated.status}，${taskProgressHint(updated)}`);
    } catch (error) {
      toast(error.message || "任务状态更新失败");
    }
    return;
  } else if (next === "release") {
    if (!isTaker || task.status !== "进行中") return toast("只有当前接单者可撤回接单");
  } else if (next === "restore-progress") {
    if (!(isPublisher || isTaker) || task.status !== "已完成") return toast("当前状态不可恢复");
  } else if (next === "restore-cancel") {
    if (!(isPublisher || isTaker) || task.status !== "已取消") return toast("当前状态不可恢复");
  }
  try {
    const updated = await apiRequest(`/api/tasks/${Number(id)}/${next}`, { method: "POST" });
    upsertRecord(db.tasks, updated);
    await syncDbFromServer();
    render();
    toast(`任务已更新为${updated.status}，${taskProgressHint(updated)}`);
  } catch (error) {
    toast(error.message || "任务状态更新失败");
  }
}

async function updateUserStatus(id, status) {
  if (!ensureAuth({ admin: true })) return;
  const user = db.users.find((item) => item.id === Number(id));
  if (!user) return;
  if (user.role === "admin" && status !== "正常") {
    toast("不能封禁管理员账号");
    return;
  }
  try {
    await apiRequest(`/api/admin/users/${Number(id)}/${status === "正常" ? "unban" : "ban"}`, { method: "POST" });
    await syncDbFromServer();
    toast("用户状态已更新");
    render();
  } catch (error) {
    toast(error.message || "用户状态更新失败");
  }
}

async function reviewVerification(id, status) {
  if (!ensureAuth({ admin: true })) return;
  const record = db.verifications.find((item) => item.id === Number(id));
  if (!record) return;
  try {
    await apiRequest(`/api/admin/verifications/${Number(id)}/${status === "通过" ? "approve" : "reject"}`, { method: "POST" });
    await syncDbFromServer();
    toast(`认证已${status === "通过" ? "通过" : "驳回"}`);
    render();
  } catch (error) {
    toast(error.message || "认证审核失败");
  }
}

async function adminUpdateListing(id, status) {
  if (!ensureAuth({ admin: true })) return;
  const item = db.listings.find((listing) => listing.id === Number(id));
  if (!item) return;
  try {
    await apiRequest(`/api/admin/listings/${Number(id)}/${status === "展示中" ? "approve" : "remove"}`, { method: "POST" });
    await syncDbFromServer();
    toast("帖子状态已更新");
    render();
  } catch (error) {
    toast(error.message || "帖子状态更新失败");
  }
}

async function adminUpdateTask(id, status) {
  if (!ensureAuth({ admin: true })) return;
  const task = db.tasks.find((item) => item.id === Number(id));
  if (!task) return;
  try {
    await apiRequest(`/api/admin/tasks/${Number(id)}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    await syncDbFromServer();
    toast("任务状态已更新");
    render();
  } catch (error) {
    toast(error.message || "任务状态更新失败");
  }
}

async function resolveReport(id, result) {
  if (!ensureAuth({ admin: true })) return;
  const report = db.reports.find((item) => item.id === Number(id));
  if (!report) return;
  try {
    await apiRequest(`/api/admin/reports/${Number(id)}/handle`, {
      method: "POST",
      body: JSON.stringify({ result }),
    });
    await syncDbFromServer();
    toast("举报已处理");
    render();
  } catch (error) {
    toast(error.message || "举报处理失败");
  }
}

function addAudit(text) {
  db.auditLogs.push({
    id: nextId(db.auditLogs),
    adminId: currentUser()?.id || 0,
    text,
    createdAt: new Date().toISOString(),
  });
}

function nextId(collection) {
  return collection.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

async function init() {
  await syncDbFromServer();
  await hydrateCurrentUser();
  if (!db.users.some((user) => user.id === currentUserId)) {
    authToken = "";
    currentUserId = 0;
    saveSession();
  }
  document.addEventListener("click", handleClick);
  document.addEventListener("submit", handleSubmit);
  document.addEventListener("input", handleInput);
  document.addEventListener("keydown", handleKeydown);
  startSummaryAutoRefresh();
  render();
  refreshSummaryData();
}

init();
