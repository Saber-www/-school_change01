export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function icon(name) {
  return `<i data-lucide="${name}" aria-hidden="true"></i>`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function maskPhone(phone) {
  const text = String(phone || "");
  if (text.length < 7) return "已隐藏";
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

export function money(value, fallback = "面议") {
  if (value === "" || value === null || value === undefined) return fallback;
  return `¥${Number(value).toFixed(Number(value) % 1 === 0 ? 0 : 1)}`;
}

export function dateText(value) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无";
  const diff = Date.now() - date.getTime();
  const minute = Math.floor(diff / 60000);
  if (minute < 1) return "刚刚";
  if (minute < 60) return `${minute} 分钟前`;
  const hour = Math.floor(minute / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} 天前`;
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

export function deadlineText(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未设置";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function statusBadge(status) {
  if (["展示中", "待接单", "已完成", "已认证", "正常"].includes(status)) {
    return `<span class="badge success">${escapeHtml(status)}</span>`;
  }
  if (["待审核", "进行中", "待处理"].includes(status)) {
    return `<span class="badge warn">${escapeHtml(status)}</span>`;
  }
  if (["通过"].includes(status)) return `<span class="badge success">${escapeHtml(status)}</span>`;
  if (["已取消", "已下架", "封禁", "未认证", "驳回"].includes(status)) {
    return `<span class="badge danger">${escapeHtml(status)}</span>`;
  }
  return `<span class="badge">${escapeHtml(status)}</span>`;
}

export function toast(message) {
  const host = $("#toastHost");
  if (!host) return;
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateY(8px)";
  }, 2300);
  setTimeout(() => node.remove(), 2800);
}

export function hydrateIcons() {
  if (window.lucide) {
    window.lucide.createIcons({
      attrs: {
        width: 18,
        height: 18,
        "stroke-width": 1.8,
      },
    });
  }
}
