export const STORAGE_KEY = "campus-light-market-db-v2";
export const SESSION_KEY = "campus-light-market-current-user";
export const AUTH_TOKEN_KEY = "campus-light-market-auth-token";
export const SERVER_SYNC_KEY = "campus-light-market-server-sync";

export const CHANNELS = [
  {
    key: "闲置转让",
    icon: "shopping-bag",
    desc: "教材、数码、宿舍用品等二手流转",
  },
  {
    key: "求购交换",
    icon: "repeat-2",
    desc: "发布想买、想换、想租的信息",
  },
  {
    key: "跑腿代取",
    icon: "package-check",
    desc: "快递、餐食、打印、排队等代办",
  },
  {
    key: "校内送货",
    icon: "truck",
    desc: "宿舍、教学楼、快递站点到点送达",
  },
  {
    key: "技能服务",
    icon: "sparkles",
    desc: "辅导、维修、摄影、文档美化",
  },
  {
    key: "失物招领",
    icon: "search-check",
    desc: "发布丢失或捡到的校园物品",
  },
];

export const CAMPUSES = ["东校区", "西校区", "南校区", "主校区"];
export const LISTING_STATUSES = ["展示中", "已完成", "已下架"];
export const TASK_STATUSES = ["待接单", "进行中", "已完成", "已取消"];
export const PUBLIC_LISTING_STATUSES = ["展示中"];
export const TASK_PROGRESS_STEPS = [
  { status: "待接单", label: "发布", hint: "等待接单" },
  { status: "进行中", label: "执行", hint: "已接单并执行中" },
  { status: "已完成", label: "完成", hint: "任务闭环" },
];
export const QUICK_MESSAGES = [
  "还在吗？",
  "可以在哪里交易？",
  "我想接这个任务。",
  "什么时候送到？",
  "我们优先在校内公共区域见面吧。",
];

export const CATEGORY_MAP = {
  闲置转让: ["教材资料", "数码电子", "生活用品", "服饰鞋包", "运动户外", "家具小电器", "票券卡券", "乐器文具", "其他闲置"],
  求购交换: ["教材资料", "宿舍用品", "数码配件", "课程资料", "可交换", "可租借"],
  跑腿代取: ["代取快递", "代买餐食", "代打印/取资料", "代排队", "临时帮忙"],
  校内送货: ["代送物品", "搬运协助", "跨校区送达", "易碎物品", "资料递送"],
  技能服务: ["学习辅导", "资料整理", "PPT/简历", "摄影修图", "电脑维修", "运动陪练", "其他互助"],
  失物招领: ["失物", "招领", "校园卡", "钥匙", "耳机数码", "书本资料", "其他物品"],
};

export const IMAGE_POOL = {
  闲置转让: [
    "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=80",
  ],
  求购交换: [
    "https://images.unsplash.com/photo-1497633762265-9d179a990aa6?auto=format&fit=crop&w=900&q=80",
  ],
  技能服务: [
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=80",
  ],
  失物招领: [
    "https://images.unsplash.com/photo-1582139329536-e7284fece509?auto=format&fit=crop&w=900&q=80",
  ],
};

export const FORBIDDEN_WORDS = ["代考", "代课", "代签到", "代写", "论文代写", "药品", "管制刀具", "烟酒", "刷单", "账号交易", "身份证"];
export const REVIEW_WORDS = ["高价", "贵重", "现金", "转账", "外挂", "校外"];
