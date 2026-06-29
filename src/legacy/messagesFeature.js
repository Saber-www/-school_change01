import { QUICK_MESSAGES } from "./constants.js";
import { dateText, escapeHtml, icon, statusBadge } from "./domUtils.js";

export function createMessagesFeature({
  state,
  getDb,
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
  nextId,
  renderAuthRequired,
  renderInlineEmpty,
}) {
  function conversationsForUser(user) {
    if (!user) return [];
    return getDb().conversations
      .filter((conv) => conv.participants.includes(user.id))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function unreadMessageCount(user = currentUser()) {
    if (!user) return 0;
    return getDb().conversations
      .filter((conv) => conv.participants.includes(user.id))
      .reduce((total, conv) => total + unreadCountForConversation(conv, user), 0);
  }

  function unreadCountForConversation(conv, user = currentUser()) {
    if (!conv || !user) return 0;
    const readAt = conv.readBy?.[user.id] || conv.readBy?.[String(user.id)] || "";
    const readTime = readAt ? new Date(readAt).getTime() : 0;
    return (conv.messages || []).filter((message) => {
      const messageTime = new Date(message.createdAt).getTime();
      return message.senderId !== user.id && Number.isFinite(messageTime) && messageTime > readTime;
    }).length;
  }

  function unreadCountLabel(count) {
    return count > 99 ? "99+" : String(count);
  }

  function prepareMessageReadState() {
    const user = currentUser();
    if (state.view !== "messages" || !user || user.verifyStatus !== "已认证") return;
    const conversations = conversationsForUser(user);
    if ((!state.selectedConversationId || !conversations.some((conv) => conv.id === state.selectedConversationId)) && conversations.length) {
      state.selectedConversationId = conversations[0].id;
    }
    const selected = conversations.find((conv) => conv.id === state.selectedConversationId);
    if (markConversationRead(selected, user)) saveDb();
  }

  function markConversationRead(conv, user = currentUser()) {
    if (!conv || !user) return false;
    if (!unreadCountForConversation(conv, user)) return false;
    const nextReadAt = new Date().toISOString();
    conv.readBy = { ...(conv.readBy || {}), [user.id]: nextReadAt };
    return true;
  }

  function renderMessages() {
    const user = currentUser();
    if (!user) return renderAuthRequired("登录并认证后可使用站内消息。");
    if (user.verifyStatus !== "已认证") {
      return renderAuthRequired("完成校园认证后可使用站内消息。", {
        action: "go-verification",
        icon: "badge-check",
        label: "去认证",
      });
    }

    const conversations = conversationsForUser(user);
    if ((!state.selectedConversationId || !conversations.some((conv) => conv.id === state.selectedConversationId)) && conversations.length) {
      state.selectedConversationId = conversations[0].id;
    }
    const selected = conversations.find((conv) => conv.id === state.selectedConversationId);

    return `
      <section class="page-head">
        <div>
          <p class="eyebrow">消息中心</p>
          <h1>站内沟通</h1>
          <p class="lead">会话中展示关联信息卡片，默认隐藏手机号、微信号和学号等敏感信息。</p>
        </div>
      </section>

      <section class="messages-layout">
        <aside class="section-panel message-list">
          ${conversations.length ? conversations.map((conv) => renderConversationButton(conv, user)).join("") : renderInlineEmpty("暂无会话，先去详情页联系发布者。")}
        </aside>
        <div class="section-panel chat-window">
          ${selected ? renderChat(selected, user) : `<div class="empty-state"><p>请选择一个会话。</p></div>`}
        </div>
      </section>
    `;
  }

  function renderConversationButton(conv, user) {
    const peerId = conv.participants.find((id) => id !== user.id);
    const peer = userById(peerId);
    const item = itemByKind(conv.kind, conv.itemId);
    const canOpenItem = item && canBrowseItem(conv.kind, item, user);
    const last = conv.messages[conv.messages.length - 1];
    const unreadCount = unreadCountForConversation(conv, user);
    const title = canOpenItem ? item.title : unavailableItemText(conv.kind);
    return `
      <button class="conversation-button ${state.selectedConversationId === conv.id ? "active" : ""}" type="button" data-action="conversation" data-id="${conv.id}">
        <span class="conversation-avatar">${escapeHtml(peer.nickname.slice(0, 1))}</span>
        <span class="conversation-content">
          <strong>${escapeHtml(peer.nickname)}</strong>
          <span class="small-text">${escapeHtml(title)}</span>
          <span class="small-text conversation-preview">${escapeHtml(last?.text || "暂无消息")}</span>
        </span>
        <span class="conversation-meta">
          <span class="meta">${dateText(conv.updatedAt)}</span>
          ${unreadCount ? `<span class="unread-badge conversation-unread">${escapeHtml(unreadCountLabel(unreadCount))}</span>` : ""}
        </span>
      </button>
    `;
  }

  function renderChat(conv, user) {
    const item = itemByKind(conv.kind, conv.itemId);
    const canOpenItem = item && canBrowseItem(conv.kind, item, user);
    const peerId = conv.participants.find((id) => id !== user.id);
    const peer = userById(peerId);
    return `
      <div class="chat-card">
        <div class="chat-card-main">
          <div class="badge-row">
            <span class="badge info">${conv.kind === "task" ? "任务" : "帖子"}</span>
            ${item ? statusBadge(item.status) : ""}
          </div>
          <h3>${escapeHtml(canOpenItem ? item.title : item ? unavailableItemText(conv.kind) : "关联信息已不存在")}</h3>
          <p class="small-text">与 ${escapeHtml(peer.nickname)} 沟通 · ${dateText(conv.updatedAt)}</p>
        </div>
        <button class="table-action" type="button" ${canOpenItem ? `data-action="detail" data-kind="${conv.kind}" data-id="${conv.itemId}"` : "disabled"}>${icon("eye")}查看关联信息</button>
      </div>
      <div class="chat-messages" aria-label="会话内容">
        ${conv.messages.map((message) => `
          <div class="message-row ${message.senderId === user.id ? "mine" : ""}">
            <div class="bubble">
              <div class="bubble-text">${escapeHtml(message.text)}</div>
              <small>${dateText(message.createdAt)}</small>
            </div>
          </div>
        `).join("")}
      </div>
      <form class="chat-form" data-form="message">
        <input type="hidden" name="conversationId" value="${conv.id}" />
        <div class="filter-row quick-strip">
          ${QUICK_MESSAGES.map((text) => `<button class="quick-phrase" type="button" data-action="quick-message" data-text="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("")}
        </div>
        <div class="message-compose">
          <label class="sr-only" for="messageText">消息</label>
          <textarea id="messageText" name="text" required placeholder="输入文本消息。涉及提前转账、脱离平台、高风险物品时请谨慎处理。"></textarea>
          <button class="primary-button" type="submit">${icon("send")}发送</button>
        </div>
      </form>
    `;
  }

  function sendMessage(data, form) {
    if (!ensureAuth({ verified: true })) return;
    const conv = getDb().conversations.find((item) => item.id === Number(data.conversationId));
    if (!conv) return;
    const user = currentUser();
    const text = data.text.trim();
    if (!text) {
      toast("请输入消息内容");
      return;
    }
    const createdAt = new Date().toISOString();
    conv.messages.push({
      senderId: user.id,
      text,
      createdAt,
    });
    conv.updatedAt = createdAt;
    conv.readBy = { ...(conv.readBy || {}), [user.id]: createdAt };
    saveDb();
    form.reset();
    render();
    toast("消息已发送");
  }

  function startConversation(kind, id) {
    if (!ensureAuth({ verified: true })) return;
    const db = getDb();
    const item = itemByKind(kind, id);
    if (!item) return;
    const user = currentUser();
    if (!canBrowseItem(kind, item, user)) {
      toast(unavailableItemText(kind));
      return;
    }
    if (item.publisherId === user.id) {
      toast("不能联系自己发布的信息");
      return;
    }
    const participantIds = [user.id, item.publisherId].sort((a, b) => a - b);
    let conv = db.conversations.find(
      (row) =>
        row.kind === kind &&
        row.itemId === Number(id) &&
        row.participants.slice().sort((a, b) => a - b).join(",") === participantIds.join(","),
    );
    const isNewConversation = !conv;
    if (!conv) {
      conv = {
        id: nextId(db.conversations),
        participants: participantIds,
        kind,
        itemId: Number(id),
        updatedAt: new Date().toISOString(),
        readBy: { [user.id]: new Date().toISOString() },
        messages: [
          {
            senderId: user.id,
            text: kind === "task" ? "你好，我想了解这个任务的细节。" : "你好，这条信息还有效吗？",
            createdAt: new Date().toISOString(),
          },
        ],
      };
      db.conversations.unshift(conv);
      saveDb();
    }
    setView("messages", { selectedConversationId: conv.id });
    toast(isNewConversation ? "已创建会话，可继续发送消息" : "已进入已有会话");
  }

  return {
    conversationsForUser,
    unreadMessageCount,
    unreadCountForConversation,
    unreadCountLabel,
    prepareMessageReadState,
    renderMessages,
    sendMessage,
    startConversation,
  };
}
