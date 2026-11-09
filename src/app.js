(function () {
  "use strict";

  /* ============================================================
     Constants & tiny helpers
     ============================================================ */

  const APP = Object.freeze({
    id: "sanyu-ledger",
    name: "记账本",
    version: "1.2.0",
    schema: 1
  });

  const KEYS = Object.freeze({
    data: "sanyu.ledger.data.v1",
    backups: "sanyu.ledger.autobackups.v1"
  });

  const VIEWS = ["home", "ledger", "balance", "report"];

  const DEFAULT_ACCOUNTS = Object.freeze([
    { id: "alipay", name: "支付宝", glyph: "支", color: "#3b82d0" },
    { id: "icbc", name: "工商银行", short: "工行", glyph: "工", color: "#b64b41" },
    { id: "wechat", name: "微信", glyph: "微", color: "#339b62" }
  ]);
  const DEFAULT_ACCOUNT = "wechat";

  const CATEGORIES = Object.freeze({
    income: [
      { id: "family", name: "家庭生活费", icon: "🏠", color: "#4f8b6b" },
      { id: "national", name: "国家助学金", icon: "🎓", color: "#5b7fb8" },
      { id: "college", name: "学院助学金", icon: "🏫", color: "#8b6fb1" },
      { id: "assistant", name: "三助", icon: "📋", color: "#b2863f" },
      { id: "parttime", name: "兼职", icon: "💼", color: "#4f8f92" },
      { id: "other_income", name: "其他收入", icon: "✨", color: "#838a82" }
    ],
    expense: [
      { id: "food", name: "食品", icon: "🍜", color: "#d97757" },
      { id: "daily", name: "生活用品", icon: "🧴", color: "#c49a58" },
      { id: "ai", name: "AI费用", icon: "🤖", color: "#5f7fb3" },
      { id: "transport", name: "交通", icon: "🚌", color: "#5a9a83" },
      { id: "study", name: "学习", icon: "📚", color: "#9a7bb5" },
      { id: "fun", name: "娱乐", icon: "🎬", color: "#c36d86" },
      { id: "telecom", name: "通讯", icon: "📱", color: "#6f93a8" },
      { id: "other_expense", name: "其他支出", icon: "📦", color: "#8b8f88" }
    ]
  });

  const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const FALLBACK_CATEGORY = Object.freeze({ id: "other", name: "未分类", icon: "🧾", color: "#8b8f88" });
  const CATEGORY_NAME_LIMIT = 20;
  const CATEGORY_COLORS = ["#2f806e", "#a35a80", "#5274ad", "#b16d43", "#7377a6", "#7f8943"];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const pad2 = (value) => String(value).padStart(2, "0");

  function uid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
      }
    } catch (error) {
      /* ignore */
    }
    return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => {
      switch (character) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        case '"': return "&quot;";
        case "'": return "&#39;";
        default: return character;
      }
    });
  }

  const escapeAttr = escapeHTML;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function hexToRgba(hex, alpha) {
    const raw = String(hex || "").replace("#", "");
    const full = raw.length === 3 ? raw.split("").map((part) => part + part).join("") : raw;
    const number = Number.parseInt(full, 16);
    if (!Number.isFinite(number) || full.length !== 6) {
      return "rgba(139, 143, 136, " + alpha + ")";
    }
    const red = (number >> 16) & 255;
    const green = (number >> 8) & 255;
    const blue = number & 255;
    return "rgba(" + red + ", " + green + ", " + blue + ", " + alpha + ")";
  }

  function debounce(fn, delay) {
    let timer = null;
    return function debounced() {
      const args = arguments;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(null, args), delay);
    };
  }

  function accounts() {
    return DEFAULT_ACCOUNTS.concat(data.accounts);
  }

  function getAccount(id) {
    return accounts().find((account) => account.id === id) || DEFAULT_ACCOUNTS[2];
  }

  function customAccount(id, name) {
    return { id, name, glyph: Array.from(name)[0], color: colorForId(id) };
  }

  function normalizeAccounts(raw) {
    const seen = new Set();
    const custom = [];
    for (const item of Array.isArray(raw) ? raw : []) {
      if (!item || typeof item.id !== "string" || !/^account-[\w-]{1,80}$/.test(item.id) ||
          typeof item.name !== "string" || seen.has(item.id)) continue;
      const name = item.name.trim().slice(0, CATEGORY_NAME_LIMIT);
      if (!name) continue;
      custom.push(customAccount(item.id, name));
      seen.add(item.id);
    }
    return custom;
  }

  function getCategory(type, id) {
    return CATEGORIES[type].find((category) => category.id === id) ||
      data.categories.find((category) => category.type === type && category.id === id) ||
      FALLBACK_CATEGORY;
  }

  function defaultCategoryId(type) {
    const list = CATEGORIES[type] || [];
    return list.length ? list[0].id : "other";
  }

  function nameKey(name) {
    return name.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function colorForId(id) {
    const hash = Array.from(id).reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0);
    return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
  }

  function customCategory(id, type, name, archived = false) {
    return { id, type, name, archived, icon: "🏷️", color: colorForId(id) };
  }

  function normalizeCategories(raw) {
    const categories = [];
    const seen = new Set();
    for (const item of Array.isArray(raw) ? raw : []) {
      if (!item || (item.type !== "income" && item.type !== "expense") ||
          typeof item.id !== "string" || !/^custom-[\w-]{1,80}$/.test(item.id) ||
          typeof item.name !== "string" || seen.has(item.type + ":" + item.id)) continue;
      const name = item.name.trim().slice(0, CATEGORY_NAME_LIMIT);
      if (!name) continue;
      categories.push(customCategory(item.id, item.type, name, item.archived === true));
      seen.add(item.type + ":" + item.id);
    }
    return categories;
  }

  /* ============================================================
     Dates & money
     ============================================================ */

  function dateToISO(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function todayISO() {
    return dateToISO(new Date());
  }

  function currentMonthKey() {
    return todayISO().slice(0, 7);
  }

  function dateFromString(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (year < 1900 || year > 2100) {
      return null;
    }
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }
    return date;
  }

  function isValidDateString(value) {
    return dateFromString(value) !== null;
  }

  function monthFromDate(value) {
    return isValidDateString(value) ? value.slice(0, 7) : "";
  }

  function addMonths(monthKey, delta) {
    const parts = String(monthKey).split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const date = new Date(year, month - 1 + delta, 1);
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1);
  }

  function monthRange(endMonth, count) {
    const months = [];
    for (let index = count - 1; index >= 0; index -= 1) {
      months.push(addMonths(endMonth, -index));
    }
    return months;
  }

  function monthShortLabel(monthKey) {
    return Number(monthKey.slice(5, 7)) + "月";
  }

  function monthFullLabel(monthKey) {
    return monthKey.slice(0, 4) + "年" + Number(monthKey.slice(5, 7)) + "月";
  }

  function formatDateCN(value, options) {
    const opts = options || {};
    const date = dateFromString(value);
    if (!date) {
      return value || "";
    }
    const showYear = opts.year === true || (opts.year === "auto" && date.getFullYear() !== new Date().getFullYear());
    const text = (showYear ? date.getFullYear() + "年" : "") + (date.getMonth() + 1) + "月" + date.getDate() + "日";
    return opts.weekday ? text + " " + WEEKDAYS[date.getDay()] : text;
  }

  function relativeDay(value) {
    const date = dateFromString(value);
    if (!date) {
      return value || "";
    }
    const today = dateFromString(todayISO());
    const diff = Math.round((today.getTime() - date.getTime()) / 86400000);
    if (diff === 0) return "今天";
    if (diff === 1) return "昨天";
    if (diff === 2) return "前天";
    return formatDateCN(value, { year: "auto" });
  }

  function shortDateLabel(value) {
    const date = dateFromString(value);
    if (!date) {
      return value || "";
    }
    return (date.getMonth() + 1) + "/" + date.getDate();
  }

  function dateTimeLabel(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return (date.getMonth() + 1) + "月" + date.getDate() + "日 " + pad2(date.getHours()) + ":" + pad2(date.getMinutes());
  }

  function timeOnlyLabel(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return pad2(date.getHours()) + ":" + pad2(date.getMinutes());
  }

  function timeAgo(isoString) {
    if (!isoString) {
      return "还没有";
    }
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return "还没有";
    }
    const diff = Date.now() - date.getTime();
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
    if (diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
    if (diff < 86400000 * 7) return Math.floor(diff / 86400000) + " 天前";
    return dateTimeLabel(isoString);
  }

  function daysSince(isoString) {
    if (!isoString) {
      return Infinity;
    }
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return Infinity;
    }
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const then = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.max(0, Math.floor((start.getTime() - then.getTime()) / 86400000));
  }

  function isoOr(value, fallback) {
    if (typeof value === "string" && value && !Number.isNaN(Date.parse(value))) {
      return new Date(value).toISOString();
    }
    return fallback;
  }

  function toCents(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) : 0;
  }

  function parseAmount(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
    }
    if (typeof value !== "string") {
      return null;
    }
    let text = value.trim().replace(/[,\s¥￥]/g, "").replace(/[。，]/g, ".");
    if (!text) {
      return null;
    }
    if (!/^\d*\.?\d*$/.test(text) || !/\d/.test(text)) {
      return null;
    }
    const number = Number(text);
    if (!Number.isFinite(number) || number < 0) {
      return null;
    }
    return Math.round(number * 100) / 100;
  }

  function parseBalance(value) {
    if (typeof value === "number" && value < 0) {
      const absolute = parseAmount(-value);
      return absolute === null ? null : -absolute;
    }
    if (typeof value === "string" && /^[-−]/.test(value.trim())) {
      const absolute = parseAmount(value.trim().slice(1));
      return absolute === null ? null : -absolute;
    }
    return parseAmount(value);
  }

  const amountFormatter = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  // Integer (yuan) formatter used for the whole part of a balance, so large
  // balances never depend on floating point division.
  const wholeFormatter = new Intl.NumberFormat("zh-CN");

  function money(value, options) {
    const opts = options || {};
    const cents = toCents(value);
    const signPrefix = cents < 0 ? "−" : opts.sign && cents > 0 ? "+" : "";
    const body = amountFormatter.format(Math.abs(cents) / 100);
    return signPrefix + (opts.currency === false ? "" : "¥") + body;
  }

  // Balance values are kept in integer cents; this formats them without any
  // further float conversion (moneyCents(350000) → "¥3,500.00").
  function moneyCents(value, options) {
    const opts = options || {};
    const cents = toCents(Math.round(Number(value) || 0) / 100);
    const sign = cents < 0 ? "−" : opts.sign && cents > 0 ? "+" : "";
    const abs = Math.abs(cents);
    const whole = Math.floor(abs / 100);
    const fraction = String(abs % 100).padStart(2, "0");
    return sign + (opts.currency === false ? "" : "¥") + wholeFormatter.format(whole) + "." + fraction;
  }

  function percentOf(part, whole) {
    if (!whole) {
      return 0;
    }
    return (part / whole) * 100;
  }

  function formatPercent(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return "0%";
    }
    if (value < 0.1) {
      return "<0.1%";
    }
    if (value >= 10) {
      return Math.round(value) + "%";
    }
    return value.toFixed(1).replace(/\.0$/, "") + "%";
  }

  function axisMoney(value) {
    const number = Math.abs(Number(value) || 0);
    if (number >= 10000) {
      const scaled = number / 10000;
      return (scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/, "")) + "万";
    }
    if (number >= 1000) {
      const scaled = number / 1000;
      return (scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/, "")) + "k";
    }
    return String(Math.round(number));
  }

  function niceStep(rawValue) {
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      return 1;
    }
    const exponent = Math.floor(Math.log10(rawValue));
    const base = Math.pow(10, exponent);
    const fraction = rawValue / base;
    let multiplier = 1;
    if (fraction <= 1) multiplier = 1;
    else if (fraction <= 2) multiplier = 2;
    else if (fraction <= 2.5) multiplier = 2.5;
    else if (fraction <= 5) multiplier = 5;
    else multiplier = 10;
    return multiplier * base;
  }

  function niceCeil(rawValue) {
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      return 100;
    }
    return Math.ceil(rawValue / niceStep(rawValue)) * niceStep(rawValue);
  }

  /* ============================================================
     Data model & persistence
     ============================================================ */

  function defaultData() {
    const now = new Date().toISOString();
    return {
      app: APP.id,
      schemaVersion: APP.schema,
      createdAt: now,
      updatedAt: now,
      lastExportAt: null,
      settings: { lastAccount: DEFAULT_ACCOUNT, autoSync: true },
      accounts: [],
      categories: [],
      balances: [],
      transactions: []
    };
  }

  function testStorage() {
    try {
      const key = "__sanyu_storage_test__";
      window.localStorage.setItem(key, "1");
      window.localStorage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function normalizeData(raw) {
    const source = raw && typeof raw === "object" && raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
      ? raw.data
      : raw;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("备份格式不正确");
    }
    const hasBalances = Array.isArray(source.balances);
    const hasTransactions = Array.isArray(source.transactions);
    if (!hasBalances && !hasTransactions) {
      throw new Error("备份中没有可识别的记录");
    }

    const now = new Date().toISOString();
    const createdAt = isoOr(source.createdAt, now);
    const updatedAt = isoOr(source.updatedAt, createdAt);
    const lastExportAt = source.lastExportAt ? isoOr(source.lastExportAt, null) : null;
    const rawSettings = source.settings && typeof source.settings === "object" ? source.settings : {};
    const customAccounts = normalizeAccounts(source.accounts);
    const accountIds = new Set(DEFAULT_ACCOUNTS.concat(customAccounts).map((account) => account.id));
    const lastAccount = accountIds.has(rawSettings.lastAccount) ? rawSettings.lastAccount : DEFAULT_ACCOUNT;
    // Older backups predate the balance auto-sync switch; treat them as "on"
    // so that recording a transaction keeps adjusting the running balance.
    const autoSync = rawSettings.autoSync !== false &&
      rawSettings.autoBalance !== false &&
      rawSettings.syncBalances !== false;

    const balancesByDate = new Map();
    (hasBalances ? source.balances : []).forEach((item) => {
      if (!item || typeof item !== "object" || !isValidDateString(item.date)) {
        return;
      }
      const record = {
        id: String(item.id || uid()),
        date: item.date,
        note: String(item.note || "").slice(0, 80),
        createdAt: isoOr(item.createdAt, now),
        updatedAt: isoOr(item.updatedAt, now)
      };
      DEFAULT_ACCOUNTS.forEach(({ id }) => {
        record[id] = clamp(parseBalance(item[id]) || 0, -999999999.99, 999999999.99);
      });
      customAccounts.forEach(({ id }) => {
        const amount = parseBalance(item[id]);
        if (amount !== null) record[id] = clamp(amount, -999999999.99, 999999999.99);
      });
      const existing = balancesByDate.get(record.date);
      if (!existing || record.updatedAt > existing.updatedAt) {
        balancesByDate.set(record.date, record);
      }
    });
    const balances = Array.from(balancesByDate.values()).sort((a, b) => a.date.localeCompare(b.date));

    const usedIds = new Set();
    const transactions = [];
    (hasTransactions ? source.transactions : []).forEach((item) => {
      if (!item || typeof item !== "object" || !isValidDateString(item.date)) {
        return;
      }
      const type = item.type === "income" ? "income" : item.type === "expense" ? "expense" : "";
      if (!type) {
        return;
      }
      const amount = parseAmount(item.amount);
      if (amount === null || amount <= 0) {
        return;
      }
      let id = String(item.id || uid());
      if (usedIds.has(id)) {
        id = uid();
      }
      usedIds.add(id);
      const category = typeof item.category === "string" && item.category
        ? item.category
        : defaultCategoryId(type);
      const account = accountIds.has(item.account) ? item.account : DEFAULT_ACCOUNT;
      transactions.push({
        id,
        date: item.date,
        type,
        category,
        amount: clamp(amount, 0.01, 999999999.99),
        account,
        note: String(item.note || "").slice(0, 80),
        createdAt: isoOr(item.createdAt, now),
        updatedAt: isoOr(item.updatedAt, now),
        ...(item.balanceSynced === false ? { balanceSynced: false } : {})
      });
    });
    transactions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

    return {
      app: APP.id,
      schemaVersion: APP.schema,
      createdAt,
      updatedAt,
      lastExportAt,
      settings: { lastAccount, autoSync },
      accounts: customAccounts,
      categories: normalizeCategories(source.categories),
      balances,
      transactions
    };
  }

  let storageOK = testStorage();
  let pendingNotice = "";
  let data = loadData();
  let lastSavedAt = data.updatedAt;
  let backupDue = false;
  let storageFailureNotified = false;
  let dialogOpen = false;
  let dialogResolve = null;
  let dialogLastFocus = null;
  let sheetOpen = false;
  let sheetType = "";
  let sheetRefresh = null;
  let sheetLastFocus = null;
  let toastTimer = null;

  const ui = {
    view: "home",
    ledgerMonth: currentMonthKey(),
    ledgerAll: false,
    ledgerType: "all",
    reportMonth: currentMonthKey(),
    reportRange: 12,
    balanceSeries: "total",
    today: todayISO()
  };

  function loadData() {
    if (!storageOK) {
      return defaultData();
    }
    let raw = null;
    try {
      raw = window.localStorage.getItem(KEYS.data);
    } catch (error) {
      storageOK = false;
      return defaultData();
    }
    if (!raw) {
      return defaultData();
    }
    try {
      return normalizeData(JSON.parse(raw));
    } catch (error) {
      try {
        window.localStorage.setItem(KEYS.data + ".corrupt." + Date.now(), raw);
      } catch (ignored) {
        /* ignore quota errors */
      }
      pendingNotice = "本地数据读取失败，原始内容已另存。请从备份恢复。";
      return defaultData();
    }
  }

  function persist(options) {
    const opts = options || {};
    if (opts.touch !== false) {
      data.updatedAt = new Date().toISOString();
    }
    const serialized = JSON.stringify(data);
    let saved = false;
    try {
      window.localStorage.setItem(KEYS.data, serialized);
      saved = true;
    } catch (error) {
      // If the quota is full, discarding old automatic copies is a reasonable
      // last resort; the manual JSON backup remains the source of truth.
      try {
        window.localStorage.removeItem(KEYS.backups);
        window.localStorage.setItem(KEYS.data, serialized);
        saved = true;
      } catch (ignored) {
        saved = false;
      }
    }

    if (saved) {
      storageOK = true;
      storageFailureNotified = false;
      lastSavedAt = data.updatedAt;
      updateStorageStatus();
      updateBackupNudge();
      return true;
    }

    storageOK = false;
    updateStorageStatus();
    updateBackupNudge();
    if (!storageFailureNotified) {
      storageFailureNotified = true;
      showToast("保存失败：浏览器没有可用空间，请立即导出备份", { duration: 6200 });
    }
    return false;
  }

  function readAutoBackups() {
    try {
      const raw = window.localStorage.getItem(KEYS.backups);
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) {
        return [];
      }
      return list.filter((item) => item && typeof item.raw === "string" && item.at).slice(0, 6);
    } catch (error) {
      return [];
    }
  }

  function createAutoBackup(reason, force) {
    if (!storageOK) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(KEYS.data);
      if (!raw) {
        return;
      }
      const backups = readAutoBackups();
      const latest = backups[0];
      if (!force && latest) {
        const latestTime = new Date(latest.at).getTime();
        if (Number.isFinite(latestTime) && Date.now() - latestTime < 6 * 60 * 60 * 1000) {
          return;
        }
      }
      backups.unshift({
        at: new Date().toISOString(),
        reason: reason || "自动",
        raw
      });
      window.localStorage.setItem(KEYS.backups, JSON.stringify(backups.slice(0, 6)));
    } catch (error) {
      /* Automatic copies are best-effort only. */
    }
  }

  function dataCount() {
    return data.transactions.length + data.balances.length;
  }

  function hasBackupData() {
    return dataCount() > 0 || data.categories.length > 0 || data.accounts.length > 0;
  }

  function sortedTransactions() {
    return data.transactions.slice().sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      if (byDate !== 0) return byDate;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  function sortedBalances() {
    return data.balances.slice().sort((a, b) => a.date.localeCompare(b.date));
  }

  function latestBalance() {
    const balances = sortedBalances();
    return balances.length ? balances[balances.length - 1] : null;
  }

  function autoSyncEnabled() {
    return data.settings.autoSync !== false;
  }

  function transactionDelta(transaction) {
    const cents = toCents(transaction.amount);
    return transaction.type === "income" ? cents : -cents;
  }

  /* ============================================================
     Running balance
     Every transaction changes the balance of the account it was paid
     from. Snapshots are hand-recorded anchors; between two snapshots
     the balance moves with the transactions. This keeps historical
     snapshots tamper-free while staying correct when an older
     transaction is edited or added later.
     ============================================================ */

  function accountAnchors(snapshots) {
    const anchors = {};
    const ledgerAccounts = accounts();
    for (const snapshot of snapshots) {
      for (const { id } of ledgerAccounts) {
        if (snapshot[id] !== undefined) anchors[id] = snapshot;
      }
    }
    return anchors;
  }

  function anchorAccountValues(anchors) {
    return Object.fromEntries(accounts().map(({ id }) => [id, toCents(anchors[id]?.[id])]));
  }

  function runningBalanceAt(date, excludedId, includeFuture = false) {
    const snapshots = sortedBalances().filter((snapshot) => snapshot.date <= date);
    const anchors = accountAnchors(snapshots);
    const cents = anchorAccountValues(anchors);
    for (const transaction of data.transactions) {
      if (transaction.id === excludedId || transaction.balanceSynced === false ||
          (!includeFuture && transaction.date > date)) continue;
      const { account } = transaction;
      if (!anchors[account] || transaction.date > anchors[account].date) {
        cents[account] += transactionDelta(transaction);
      }
    }
    return {
      date,
      anchor: snapshots[snapshots.length - 1] || null,
      anchors,
      actual: { cents, total: accountValuesTotal(cents) }
    };
  }

  function runningBalanceNow(excludedId) {
    // Preserve the existing treatment of future-dated imported transactions.
    return runningBalanceAt(todayISO(), excludedId, true);
  }

  function balanceBeforeTransaction(transaction, excludedId) {
    const current = runningBalanceNow(excludedId);
    const anchor = current.anchors[transaction.account];
    const coveredBySnapshot = Boolean(anchor && transaction.date <= anchor.date);
    return {
      cents: current.actual.cents[transaction.account],
      anchorDate: anchor?.date,
      coveredBySnapshot
    };
  }

  // Legacy rebuild helper: for every snapshot after the first, computes the
  // balance that would result from the first snapshot plus every synced
  // transaction since. Later snapshots are used as cross-checks only.
  function resolveTransactionDiff() {
    const anchors = accountAnchors(sortedBalances().reverse());
    const expected = anchorAccountValues(anchors);
    data.transactions.forEach((transaction) => {
      if (transaction.balanceSynced === false || !anchors[transaction.account]) return;
      expected[transaction.account] += transactionDelta(transaction);
    });
    const diffs = [];
    for (const [key, base] of Object.entries(anchors)) {
      const actual = toCents(base[key]);
      const difference = actual - expected[key];
      if (difference !== 0) {
        diffs.push({
          snapshot: base,
          key,
          expected: expected[key] / 100,
          actual: actual / 100,
          diff: difference / 100
        });
      }
    }
    return diffs;
  }

  function describeDiff(diff) {
    const account = getAccount(diff.key);
    return formatDateCN(diff.snapshot.date, { year: "auto" }) + " 的" + account.name + "余额应为 " +
      money(diff.expected) + "，实际记的是 " + money(diff.actual) + "（差 " + money(diff.diff) + "）";
  }

  async function fixBalanceDrift() {
    const diffs = resolveTransactionDiff();
    if (!diffs.length) {
      showToast("余额与流水已经对得上");
      return;
    }
    const lines = diffs.slice(0, 6).map(describeDiff).join("\n");
    const more = diffs.length > 6 ? "\n…等共 " + diffs.length + " 处" : "";
    const confirmed = await askDialog({
      title: "按流水校正余额？",
      message: "从最早的手记余额开始，按之后的全部流水重算：\n" + escapeHTML(lines + more) +
        "\n\n建议在记完当天的收支后，再记录一次新的余额快照，这样以后就以新快照为准。",
      icon: "i-alert",
      tone: "danger",
      actions: [
        { label: "取消", value: false, kind: "ghost" },
        { label: "校正", value: true, kind: "danger" }
      ]
    });
    if (!confirmed) return;
    createAutoBackup("校正余额前", true);
    diffs.forEach((diff) => {
      diff.snapshot[diff.key] = diff.expected;
      diff.snapshot.updatedAt = new Date().toISOString();
    });
    const saved = persist();
    renderCurrent();
    showToast(saved ? "已校正 " + diffs.length + " 处余额" : "已校正，但本机保存失败，请导出备份");
  }

  async function restoreBalanceForTransaction(id) {
    const target = data.transactions.find((transaction) => transaction.id === id);
    if (!target) return;
    const account = getAccount(target.account);
    const amount = money(target.amount);
    const confirmed = await askDialog({
      title: "补记这笔余额变动？",
      message: "「" + escapeHTML(getCategory(target.type, target.category).name + " " + amount) + "」之前没有联动余额。\n" +
        "补上后，" + escapeHTML(account.name) + "会" + (target.type === "income" ? "增加 " : "扣除 ") + amount + "。\n" +
        "如果这笔其实已经算在手动余额里，就不要补记，否则会重复扣款。",
      icon: "i-wallet",
      actions: [
        { label: "取消", value: false, kind: "ghost" },
        { label: "补记", value: true, kind: "secondary" }
      ]
    });
    if (!confirmed) return;
    createAutoBackup("补记余额前", true);
    delete target.balanceSynced;
    target.updatedAt = new Date().toISOString();
    const saved = persist();
    renderCurrent();
    showToast(saved ? account.name + "余额已" + (target.type === "income" ? "入账 " : "扣款 ") + amount : "已补记，但本机保存失败", {
      actionLabel: "撤销",
      duration: 6500,
      onAction: () => {
        target.balanceSynced = false;
        persist();
        renderCurrent();
        showToast("已撤销补记");
      }
    });
  }

  function totalBalance(snapshot) {
    return accountValuesTotal(snapshotAccountValues(snapshot));
  }

  function monthStats(monthKey) {
    let income = 0;
    let expense = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    data.transactions.forEach((transaction) => {
      if (transaction.date.slice(0, 7) !== monthKey) {
        return;
      }
      if (transaction.type === "income") {
        income += toCents(transaction.amount);
        incomeCount += 1;
      } else {
        expense += toCents(transaction.amount);
        expenseCount += 1;
      }
    });
    return {
      income: income / 100,
      expense: expense / 100,
      net: (income - expense) / 100,
      incomeCount,
      expenseCount,
      count: incomeCount + expenseCount
    };
  }

  function monthSeries(months) {
    const indexByMonth = new Map();
    months.forEach((month, index) => indexByMonth.set(month, index));
    const incomes = months.map(() => 0);
    const expenses = months.map(() => 0);
    data.transactions.forEach((transaction) => {
      const index = indexByMonth.get(transaction.date.slice(0, 7));
      if (index === undefined) {
        return;
      }
      if (transaction.type === "income") {
        incomes[index] += toCents(transaction.amount);
      } else {
        expenses[index] += toCents(transaction.amount);
      }
    });
    const incomeValues = incomes.map((cents) => cents / 100);
    const expenseValues = expenses.map((cents) => cents / 100);
    return {
      months,
      incomes: incomeValues,
      expenses: expenseValues,
      hasData: incomeValues.some((value) => value > 0) || expenseValues.some((value) => value > 0)
    };
  }

  /* ============================================================
     Status & backup nudges
     ============================================================ */

  function updateStorageStatus() {
    const badge = $("#saveBadge");
    const warning = $("#storageWarning");
    if (badge) {
      badge.classList.toggle("is-error", !storageOK);
      const label = badge.querySelector("span");
      if (label) {
        if (!storageOK) {
          label.textContent = "未保存";
        } else if (!hasBackupData()) {
          label.textContent = "本机存储已就绪";
        } else {
          const savedDay = lastSavedAt ? dateToISO(new Date(lastSavedAt)) : "";
          label.textContent = "已保存 " + (savedDay === todayISO() ? timeOnlyLabel(lastSavedAt) : dateTimeLabel(lastSavedAt));
        }
      }
    }
    if (warning) {
      warning.hidden = storageOK;
    }
    updateHeaderDot();
  }

  function updateHeaderDot() {
    const dot = $("#headerDot");
    if (!dot) return;
    dot.classList.toggle("is-error", !storageOK);
    dot.classList.toggle("is-due", storageOK && backupDue);
  }

  function updateBackupNudge() {
    let due = false;
    let days = 0;
    if (storageOK && hasBackupData()) {
      if (data.lastExportAt) {
        days = daysSince(data.lastExportAt);
        due = days >= 14;
      } else {
        days = daysSince(data.createdAt);
        due = days >= 7;
      }
    }
    backupDue = due;
    const nudge = $("#backupNudge");
    const text = $("#nudgeText");
    if (nudge) {
      nudge.hidden = !due;
    }
    if (text && due) {
      if (data.lastExportAt) {
        text.textContent = "距离上次备份已经 " + days + " 天。导出 JSON 放到微信收藏，换手机也不怕。";
      } else {
        text.textContent = "这本账还没有导出过备份。花十秒存一份到微信收藏吧。";
      }
    }
    updateHeaderDot();
  }

  /* ============================================================
     Rendering — shared bits
     ============================================================ */

  function emptyState(iconId, title, text, actionMarkup) {
    return '<div class="empty">' +
      '<div class="empty-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#' + iconId + '"/></svg></div>' +
      "<h3>" + escapeHTML(title) + "</h3>" +
      "<p>" + escapeHTML(text) + "</p>" +
      (actionMarkup || "") +
      "</div>";
  }

  function chartEmpty(container, title, text) {
    container.innerHTML = '<div class="chart-empty">' +
      '<div class="chart-empty-art" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
      "<div><strong>" + escapeHTML(title) + "</strong><p>" + escapeHTML(text) + "</p></div>" +
      "</div>";
  }

  function accountGlyph(account) {
    return '<span class="acct-glyph" style="--account-color:' + account.color +
      '" aria-hidden="true">' + escapeHTML(account.glyph) + "</span>";
  }

  function txItemMarkup(transaction, options) {
    const opts = options || {};
    const category = getCategory(transaction.type, transaction.category);
    const account = getAccount(transaction.account);
    const amountSign = transaction.type === "income" ? "+" : "−";
    const meta = opts.showDate
      ? '<span class="tx-time">' + escapeHTML(relativeDay(transaction.date)) + "</span>"
      : "";
    const sub = transaction.note
      ? escapeHTML(transaction.note)
      : transaction.type === "income" ? "收入" : "支出";
    const id = escapeAttr(transaction.id);
    return '<div class="tx-row">' +
      '<button class="tx-item" type="button" data-action="edit-tx" data-id="' + id + '"' +
        (transaction.balanceSynced === false ? ' data-unsynced="1"' : "") + ">" +
        '<span class="cat-avatar" style="--icon-bg:' + hexToRgba(category.color, 0.13) + '" aria-hidden="true">' + category.icon + "</span>" +
        '<span class="tx-main">' +
          '<span class="tx-title-row"><span class="tx-title">' + escapeHTML(category.name) + "</span>" +
          '<span class="tx-tag">' + escapeHTML(account.short || account.name) + "</span></span>" +
          '<span class="tx-sub">' + sub + "</span>" +
        "</span>" +
        '<span class="tx-amount ' + transaction.type + '">' + amountSign + money(transaction.amount) + meta + "</span>" +
      "</button>" +
      '<button class="tx-delete" type="button" data-action="delete-tx" data-id="' + id +
        '" aria-label="删除这条流水" title="删除这条流水">' +
        '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-trash"/></svg>' +
      "</button>" +
    "</div>";
  }

  // Second pass for the "补记余额" chip: appended after the row markup is in
  // the DOM, so it is a sibling of the row button instead of a nested button.
  function markRestorableRows(root) {
    var scope = root || document;
    var rows = Array.prototype.slice.call(scope.querySelectorAll('.tx-item[data-unsynced="1"]'));
    rows.forEach((row) => {
      if (row.querySelector(".tx-restore")) return;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tx-restore";
      chip.dataset.action = "restore-balance";
      chip.dataset.id = row.dataset.id || "";
      chip.textContent = "补记余额";
      row.appendChild(chip);
    });
  }
  function renderDateLine() {
    const today = dateFromString(ui.today) || new Date();
    const text = (today.getMonth() + 1) + "月" + today.getDate() + "日 " + WEEKDAYS[today.getDay()];
    const target = $("#todayText");
    if (target) target.textContent = text;
  }

  // Creates a fresh values object so in-place mutations can never leak into
  // the running-balance result used for the total.
  function snapshotAccountValues(snapshot) {
    return Object.fromEntries(accounts().map(({ id }) => [id, toCents(snapshot?.[id])]));
  }

  function manualAccountValuesAt(date) {
    const snapshots = sortedBalances().filter((snapshot) => snapshot.date <= date);
    return anchorAccountValues(accountAnchors(snapshots));
  }

  function accountValuesTotal(values) {
    return Object.values(values).reduce((sum, cents) => sum + cents, 0);
  }

  function renderHome() {
    const balances = sortedBalances();
    const running = autoSyncEnabled() ? runningBalanceNow() : null;
    // Balance maths stays in cents; only the display is in yuan.
    const latestSnapshot = balances.length ? balances[balances.length - 1] : null;
    const displayValues = running ? running.actual.cents : latestSnapshot ? manualAccountValuesAt(latestSnapshot.date) : null;

    renderHeroAccounts(displayValues);
    if (running) {
      renderHeroDelta(running);
    } else {
      renderHeroDeltaFromSnapshots(latestSnapshot, balances.length > 1 ? balances[balances.length - 2] : null);
    }

    const heroDate = $("#heroDate");
    const heroTotal = $("#heroTotal");
    if (heroDate) {
      if (running) {
        heroDate.textContent = running.anchor ? "已含今日收支" : "已含全部收支";
      } else {
        heroDate.textContent = latestSnapshot ? "截至 " + formatDateCN(latestSnapshot.date, { year: "auto" }) : "尚未记录";
      }
    }
    if (heroTotal) {
      const totalCents = running ? running.actual.total : displayValues ? accountValuesTotal(displayValues) : null;
      const negative = totalCents != null && totalCents < 0;
      const totalText = totalCents == null ? "—" : moneyCents(Math.abs(totalCents), { currency: false });
      heroTotal.innerHTML = totalCents != null
        ? (negative ? '<span class="sign-prefix">−</span>' : "") +
          '<span class="currency">¥</span><span>' + totalText + "</span>"
        : '<span class="currency">¥</span><span>—</span>';
      heroTotal.classList.toggle("has-negative", negative);
      heroTotal.setAttribute("aria-label", "总余额 ¥" + totalText);
      heroTotal.dataset.amount = totalText;
    }
    const stats = monthStats(currentMonthKey());
    setText("#statIncome", money(stats.income));
    setText("#statExpense", money(stats.expense));
    setText("#statIncomeCount", stats.incomeCount + " 笔");
    setText("#statExpenseCount", stats.expenseCount + " 笔");
    const netEl = $("#statNet");
    if (netEl) {
      netEl.textContent = money(stats.net);
      netEl.classList.toggle("is-negative", stats.net < 0);
      netEl.classList.toggle("is-positive", stats.net > 0);
    }
    setText("#statNetNote", stats.count ? "收入 − 支出" : "还没有流水");

    const onboarding = $("#onboarding");
    if (onboarding) {
      onboarding.hidden = dataCount() > 0;
    }

    const syncNote = $("#syncNote");
    if (syncNote) {
      syncNote.textContent = autoSyncEnabled()
        ? "记流水时，会自动从对应账户里扣款或入账。"
        : "余额自动更新已关闭，流水不会改变余额。";
    }

    renderHomeChart();
    renderRecent();
  }

  function renderHeroAccounts(values) {
    const container = $("#heroAccounts");
    if (!container) return;
    const actual = values || {};
    container.innerHTML = accounts().map((account) => {
      const value = Object.prototype.hasOwnProperty.call(actual, account.id) ? actual[account.id] : null;
      return '<div class="hero-account">' +
        '<div class="hero-account-top">' + accountGlyph(account) +
          '<span class="hero-account-name" title="' + escapeAttr(account.name) + '">' + escapeHTML(account.name) + "</span></div>" +
        '<strong class="' + (value != null && value < 0 ? "is-negative" : "") + '">' +
        (value == null ? "—" : moneyCents(value)) + "</strong>" +
        "</div>";
    }).join("");
  }

  function deltaMarkup(delta) {
    return {
      html: delta === 0
        ? "无收支"
        : '<span class="' + (delta > 0 ? "delta-positive" : "delta-negative") + '">' +
          moneyCents(delta, { sign: true }) + "</span>"
    };
  }

  function renderHeroDelta(running) {
    const heroDelta = $("#heroDelta");
    if (!heroDelta) return;
    const stats = monthStats(currentMonthKey());
    const todayStats = monthStats(ui.today);
    const net = Math.round((stats.income - stats.expense) * 100);
    if (!running.anchor) {
      heroDelta.textContent = "还没有余额快照：记下余额后，收支会自动加减";
      return;
    }
    const parts = [];
    parts.push(stats.count
      ? "本月 " + deltaMarkup(net).html
      : "本月还没有收支");
    if (todayStats.count) {
      parts.push("今日 " + deltaMarkup(Math.round((todayStats.income - todayStats.expense) * 100)).html);
    }
    heroDelta.innerHTML = parts.join('<span class="delta-sep" aria-hidden="true"> · </span>');
  }

  function renderHeroDeltaFromSnapshots(latest, previous) {
    const heroDelta = $("#heroDelta");
    if (!heroDelta) return;
    if (!latest) {
      heroDelta.textContent = "先记下今天的账户余额吧";
    } else if (!previous) {
      heroDelta.textContent = "第一次余额记录，之后就能看到变化";
    } else {
      const delta = accountValuesTotal(manualAccountValuesAt(latest.date)) - accountValuesTotal(manualAccountValuesAt(previous.date));
      if (delta === 0) {
        heroDelta.textContent = "与上次记录持平";
      } else {
        heroDelta.innerHTML = "较上次 " + '<span class="' + (delta > 0 ? "delta-positive" : "delta-negative") + '">' +
          moneyCents(delta, { sign: true }) + "</span>";
      }
    }
  }

  function renderHomeChart() {
    const container = $("#homeChart");
    if (!container) return;
    const series = monthSeries(monthRange(currentMonthKey(), 6));
    if (!series.hasData) {
      chartEmpty(container, "还没有收支数据", "记下第一笔收入或支出，这里就会长出一张图。");
      return;
    }
    renderTrapezoidChart(container, series, { compact: true });
  }

  function renderRecent() {
    const container = $("#recentList");
    if (!container) return;
    const list = sortedTransactions().slice(0, 5);
    const unsynced = data.transactions.filter((transaction) => transaction.balanceSynced === false).length;
    setText("#recentSub", data.transactions.length
      ? "最近 5 笔 · 共 " + data.transactions.length + " 笔" + (unsynced ? " · " + unsynced + " 笔未联动" : "")
      : "每一笔都算数");
    if (!list.length) {
      container.innerHTML = emptyState(
        "i-list",
        "还没有流水",
        "今天花了什么，或者收到了什么？顺手记下第一笔。",
        '<button class="btn btn-secondary btn-sm" type="button" data-action="open-tx">记一笔</button>'
      );
      return;
    }
    container.innerHTML = list.map((transaction) => txItemMarkup(transaction, { showDate: true })).join("");
    markRestorableRows(container);
  }

  function renderLedger() {
    const filtered = data.transactions.filter((transaction) => {
      if (!ui.ledgerAll && transaction.date.slice(0, 7) !== ui.ledgerMonth) {
        return false;
      }
      return ui.ledgerType === "all" || transaction.type === ui.ledgerType;
    }).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));

    const monthLabel = $("#ledgerMonthLabel");
    if (monthLabel) {
      monthLabel.textContent = ui.ledgerAll ? "全部时间" : monthFullLabel(ui.ledgerMonth);
      monthLabel.classList.toggle("is-all", ui.ledgerAll);
    }
    const prevButton = $('[data-action="ledger-prev"]');
    const nextButton = $('[data-action="ledger-next"]');
    if (prevButton) prevButton.disabled = ui.ledgerAll;
    if (nextButton) nextButton.disabled = ui.ledgerAll || ui.ledgerMonth >= currentMonthKey();

    const allButton = $("#ledgerAllButton");
    if (allButton) {
      allButton.classList.toggle("is-active", ui.ledgerAll);
      allButton.textContent = ui.ledgerAll ? "回到本月" : "全部时间";
    }

    $$("#ledgerTypeFilter button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.type === ui.ledgerType);
    });

    const contextTransactions = ui.ledgerAll
      ? data.transactions
      : data.transactions.filter((transaction) => transaction.date.slice(0, 7) === ui.ledgerMonth);
    let contextIncome = 0;
    let contextExpense = 0;
    contextTransactions.forEach((transaction) => {
      if (transaction.type === "income") contextIncome += toCents(transaction.amount);
      else contextExpense += toCents(transaction.amount);
    });
    setText("#ledgerSummary",
      "收入 " + moneyCents(contextIncome) + " · 支出 " + moneyCents(contextExpense) +
        " · 结余 " + moneyCents(contextIncome - contextExpense)
    );

    const container = $("#ledgerList");
    if (!container) return;
    if (!filtered.length) {
      container.innerHTML = emptyState(
        "i-list",
        data.transactions.length ? "没有符合条件的记录" : "账本还是空的",
        data.transactions.length
          ? "换个筛选条件看看，或者切到「全部时间」。"
          : "记下第一笔收支，月底就能看见钱去了哪里。",
        '<button class="btn btn-secondary btn-sm" type="button" data-action="open-tx">记一笔</button>'
      );
      return;
    }

    const groups = new Map();
    filtered.forEach((transaction) => {
      if (!groups.has(transaction.date)) {
        groups.set(transaction.date, []);
      }
      groups.get(transaction.date).push(transaction);
    });

    let html = "";
    groups.forEach((transactions, date) => {
      let income = 0;
      let expense = 0;
      transactions.forEach((transaction) => {
        if (transaction.type === "income") income += toCents(transaction.amount);
        else expense += toCents(transaction.amount);
      });
      const totals = [];
      if (income > 0) totals.push('<span class="in">收 ' + moneyCents(income) + "</span>");
      if (expense > 0) totals.push('<span class="out">支 ' + moneyCents(expense) + "</span>");
      html += '<section class="day-group">' +
        '<div class="day-head">' +
          '<span class="day-date">' + escapeHTML(formatDateCN(date, { year: ui.ledgerAll ? "auto" : false, weekday: true })) + "</span>" +
          '<span class="day-total">' + totals.join(" · ") + "</span>" +
        "</div>" +
        transactions.map((transaction) => txItemMarkup(transaction, { showDate: false })).join("") +
        "</section>";
    });
    container.innerHTML = html;
    markRestorableRows(container);
  }

  function renderBalance() {
    const balances = sortedBalances();
    const latest = balances.length ? balances[balances.length - 1] : null;
    const running = autoSyncEnabled() ? runningBalanceNow() : null;
    const overview = $("#balanceOverview");

    if (overview) {
      if (!latest && !running) {
        overview.innerHTML = '<div class="bo-head"><span class="bo-label">最新余额</span></div>' +
          emptyState(
            "i-wallet",
            "还没有余额快照",
            "把各个账户的余额记在一起，随时查看变化。",
            '<button class="btn btn-secondary btn-sm" type="button" data-action="open-balance">记录第一次余额</button>'
          );
      } else {
        const today = todayISO();
        let values;
        let totalCents;
        let badge;
        let deltaMarkupText;
        if (running) {
          const actual = running.actual;
          values = actual.cents;
          totalCents = actual.total;
          badge = formatDateCN(today, { year: "auto" }) + " · 已含今日收支";
          const todayStats = monthStats(today);
          const todayNet = Math.round((todayStats.income - todayStats.expense) * 100);
          if (running.anchor) {
            deltaMarkupText = "今日 " + deltaMarkup(todayNet).html + " · 从 " +
              formatDateCN(running.anchor.date, { year: "auto" }) + " 的手记余额起算";
          } else {
            deltaMarkupText = "还没有余额快照，各账户从 0 开始累计";
          }
        } else {
          const previous = balances.length > 1 ? balances[balances.length - 2] : null;
          values = manualAccountValuesAt(latest.date);
          totalCents = accountValuesTotal(values);
          badge = formatDateCN(latest.date, { year: "auto" });
          deltaMarkupText = "自动更新已关闭，只显示手动记录的余额";
          if (previous) {
            const delta = totalCents - accountValuesTotal(manualAccountValuesAt(previous.date));
            if (delta === 0) {
              deltaMarkupText += " · 与上次记录持平";
            } else {
              deltaMarkupText += " · 较上次 " + '<span class="' + (delta > 0 ? "up" : "down") + '">' +
                moneyCents(delta, { sign: true }) + "</span>";
            }
          }
        }
        const accountRows = accounts().map((account) => {
          const cents = values[account.id];
          const share = totalCents > 0 ? percentOf(cents, totalCents) : 0;
          return '<div class="bo-account">' + accountGlyph(account) +
            '<span class="bo-account-name">' + escapeHTML(account.name) + "</span>" +
            '<span class="bo-account-share">' + formatPercent(share) + "</span>" +
            '<strong class="' + (cents < 0 ? "is-negative" : "") + '">' + moneyCents(cents) + "</strong></div>";
        }).join("");
        overview.innerHTML = '<div class="bo-head">' +
          '<span class="bo-label">' + (running ? "当前余额" : "最新快照") + "</span>" +
          '<span class="bo-date"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-calendar"/></svg>' +
          escapeHTML(badge) + "</span>" +
          "</div>" +
          '<div class="bo-total' + (totalCents < 0 ? " is-negative" : "") + '"' +
          ' data-amount="' + (totalCents < 0 ? "−" : "") + moneyCents(Math.abs(totalCents), { currency: false }) + '">' +
          (totalCents < 0 ? '<span class="sign-prefix">−</span>' : "") +
          '<span class="currency">¥</span>' + moneyCents(Math.abs(totalCents), { currency: false }) + "</div>" +
          '<div class="bo-delta">' + deltaMarkupText + "</div>" +
          '<div class="bo-accounts">' + accountRows + "</div>";
      }
    }

    const series = [{ id: "total", name: "总余额", color: "#2f6a50" }, ...accounts()];
    const selectedSeries = series.find((item) => item.id === ui.balanceSeries) || series[0];
    ui.balanceSeries = selectedSeries.id;
    $("#balanceSeries").innerHTML = series.map((item) =>
      '<button type="button" class="chip' + (item === selectedSeries ? " is-active" : "") +
      '" data-action="balance-series" data-series="' + item.id + '" aria-pressed="' +
      (item === selectedSeries) + '">' + escapeHTML(item.name) + '</button>'
    ).join("");

    const runningNow = running;
    const seriesLabel = selectedSeries.name;
    const seriesValue = (amounts) => (
      ui.balanceSeries === "total"
        ? accountValuesTotal(amounts)
        : amounts[ui.balanceSeries]
    );
    const chartBalances = balances.slice(-12);
    const points = chartBalances.map((snapshot) => ({
      date: snapshot.date,
      // The line chart works in yuan.
      value: seriesValue(runningNow ? runningBalanceAt(snapshot.date).actual.cents : manualAccountValuesAt(snapshot.date)) / 100
    }));
    const needsLivePoint = runningNow && (
      !latest ||
      runningNow.date > latest.date ||
      data.transactions.some((item) => item.date > latest.date)
    );
    if (needsLivePoint) {
      points.push({ date: runningNow.date, value: seriesValue(runningNow.actual.cents) / 100 });
    }

    setText("#balanceChartBadge", points.length ? "最近 " + points.length + " 次" : "暂无记录");
    if (!latest && !runningNow) {
      setText("#balanceChartSub", "每次记录后的余额变化");
    } else if (points.length < 2) {
      setText("#balanceChartSub", "再记一笔，就能看到走势");
    } else {
      setText("#balanceChartSub", formatDateCN(points[0].date, { year: "auto" }) + " — " +
        formatDateCN(points[points.length - 1].date, { year: "auto" }) + " · " + seriesLabel +
        (runningNow ? "（含自动更新）" : ""));
    }

    const chart = $("#balanceChart");
    if (chart) {
      if (!points.length) {
        chartEmpty(chart, "还没有余额走势", "记录两次以上，就能看见余额的起伏。");
      } else {
        renderLineChart(chart, points, {
          color: selectedSeries.color,
          label: seriesLabel,
          showArea: false,
          emptyTitle: "还没有余额走势",
          emptyText: "记录两次以上，就能看见余额的起伏。"
        });
      }
    }

    const snapshotList = $("#snapshotList");
    if (snapshotList) {
      if (!balances.length) {
        snapshotList.innerHTML = emptyState(
          "i-calendar",
          "还没有历史快照",
          "每次记录都会留在这里，点击某一条还能修改。"
        );
      } else {
        snapshotList.innerHTML = balances.slice().reverse().map((snapshot) => {
          const values = snapshotAccountValues(snapshot);
          return '<button class="snapshot-item" type="button" data-action="edit-balance" data-id="' + escapeAttr(snapshot.id) + '">' +
            '<div class="snap-top">' +
              '<span class="snap-date">' + escapeHTML(formatDateCN(snapshot.date, { year: true, weekday: true })) + "</span>" +
              '<span class="snap-total">' + moneyCents(accountValuesTotal(values)) + "</span>" +
            "</div>" +
            '<div class="snap-accounts">' +
              accounts().filter(({ id }) => snapshot[id] !== undefined).map((account) =>
                "<span>" + escapeHTML(account.short || account.name) + " <b>" + moneyCents(values[account.id]) + "</b></span>"
              ).join("") +
            "</div>" +
            (snapshot.note ? '<div class="snap-note">' + escapeHTML(snapshot.note) + "</div>" : "") +
            "</button>";
        }).join("");
      }
    }
    setText("#snapshotCount", balances.length ? "共 " + balances.length + " 次 · 点击一条记录可修改" : "点击一条记录可以修改");
  }

  function renderReport() {
    const stats = monthStats(ui.reportMonth);
    const monthTransactions = data.transactions.filter((transaction) => transaction.date.slice(0, 7) === ui.reportMonth);
    const expenses = monthTransactions.filter((transaction) => transaction.type === "expense");
    const incomes = monthTransactions.filter((transaction) => transaction.type === "income");

    setText("#reportMonthLabel", monthFullLabel(ui.reportMonth));
    setText("#reportMonthSub", ui.reportMonth.slice(0, 4) + " · " + pad2(Number(ui.reportMonth.slice(5, 7))));
    const prevButton = $('[data-action="report-prev"]');
    const nextButton = $('[data-action="report-next"]');
    if (prevButton) prevButton.disabled = false;
    if (nextButton) nextButton.disabled = ui.reportMonth >= currentMonthKey();
    const currentButton = $("#reportCurrentButton");
    if (currentButton) currentButton.hidden = ui.reportMonth === currentMonthKey();

    setText("#reportIncome", money(stats.income));
    setText("#reportExpense", money(stats.expense));
    setText("#reportIncomeCount", stats.incomeCount + " 笔");
    setText("#reportExpenseCount", stats.expenseCount + " 笔");
    const net = $("#reportNet");
    if (net) {
      net.textContent = money(stats.net);
      net.classList.toggle("is-negative", stats.net < 0);
      net.classList.toggle("is-positive", stats.net > 0);
    }
    let saveRate = "—";
    if (stats.income > 0) {
      const rate = Math.round((stats.net / stats.income) * 100);
      saveRate = "结余率 " + rate + "%";
    } else if (stats.expense > 0) {
      saveRate = "本月没有进账";
    } else {
      saveRate = "还没有记录";
    }
    setText("#reportSaveRate", saveRate);
    setText("#expenseCountBadge", expenses.length + " 笔");

    renderExpenseDonut(expenses, stats.expense);
    renderIncomeBreakdown(incomes, stats.income);

    $$("#reportRangeToggle button").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.range) === ui.reportRange);
    });

    const chart = $("#reportChart");
    if (chart) {
      const series = monthSeries(monthRange(ui.reportMonth, ui.reportRange));
      if (!series.hasData) {
        chartEmpty(chart, "这段时间没有收支", "换个月份看看，或者先记下第一笔。");
      } else {
        renderTrapezoidChart(chart, series, { compact: false });
      }
    }
  }

  function renderExpenseDonut(expenses, totalExpense) {
    const container = $("#expenseDonut");
    if (!container) return;
    if (!expenses.length) {
      container.innerHTML = emptyState(
        "i-chart",
        "这个月还没有支出",
        "有支出后，这里会用扇形图告诉你钱花在了哪里。",
        '<button class="btn btn-secondary btn-sm" type="button" data-action="open-tx">记一笔支出</button>'
      );
      return;
    }

    const grouped = new Map();
    expenses.forEach((transaction) => {
      const category = getCategory("expense", transaction.category);
      if (!grouped.has(category.id)) {
        grouped.set(category.id, {
          id: category.id,
          name: category.name,
          color: category.color,
          cents: 0,
          count: 0
        });
      }
      const entry = grouped.get(category.id);
      entry.cents += toCents(transaction.amount);
      entry.count += 1;
    });
    const entries = Array.from(grouped.values()).sort((a, b) => b.cents - a.cents);
    const totalCents = entries.reduce((sum, entry) => sum + entry.cents, 0) || toCents(totalExpense);
    const gap = entries.length > 1 ? 1.15 : 0;
    let offset = 0;
    const segments = entries.map((entry, index) => {
      const percentage = totalCents > 0 ? (entry.cents / totalCents) * 100 : 0;
      const length = Math.max(0.35, percentage - gap);
      const markup = '<circle class="donut-segment" data-cat-index="' + index + '" cx="90" cy="90" r="65" fill="none" ' +
        'stroke="' + escapeAttr(entry.color) + '" stroke-width="17" pathLength="100" ' +
        'stroke-dasharray="' + length.toFixed(2) + " " + (100 - length).toFixed(2) + '" ' +
        'stroke-dashoffset="' + (-offset).toFixed(2) + '" data-base-width="17" ' +
        'aria-label="' + escapeAttr(entry.name + "，占 " + formatPercent(percentage)) + '" role="img">' +
        "<title>" + escapeHTML(entry.name + " " + moneyCents(entry.cents)) + "</title></circle>";
      offset += percentage;
      return markup;
    }).join("");

    const legend = entries.map((entry, index) => {
      const percentage = totalCents > 0 ? (entry.cents / totalCents) * 100 : 0;
      return '<button class="cat-legend-item" type="button" data-cat-index="' + index + '">' +
        '<i class="cat-legend-dot" style="background:' + entry.color + '" aria-hidden="true"></i>' +
        '<span class="cat-legend-name">' + escapeHTML(entry.name) + "</span>" +
        '<span class="cat-legend-pct">' + formatPercent(percentage) + "</span>" +
        '<span class="cat-legend-amount">' + moneyCents(entry.cents) + "</span>" +
        "</button>";
    }).join("");

    container.innerHTML = '<div class="donut-layout">' +
      '<div class="donut-shell">' +
        '<svg viewBox="0 0 180 180" role="img" aria-label="' + escapeAttr("当月支出分类：" + entries.map((entry) => entry.name).join("、")) + '">' +
          '<circle cx="90" cy="90" r="65" fill="none" stroke="#f1ece3" stroke-width="17"></circle>' +
          segments +
        "</svg>" +
        '<div class="donut-center" id="donutCenter">' +
          "<span>当月支出</span><strong>" + moneyCents(totalCents) + "</strong>" +
          "<em>" + entries.length + " 个分类</em>" +
        "</div>" +
      "</div>" +
      '<div class="cat-legend" id="expenseLegend">' + legend + "</div>" +
      "</div>";

    let activeIndex = null;
    const segmentEls = $$(".donut-segment", container);
    const legendEls = $$(".cat-legend-item", container);
    const center = $("#donutCenter", container);

    function setActive(index) {
      activeIndex = activeIndex === index ? null : index;
      segmentEls.forEach((segment, segmentIndex) => {
        const active = activeIndex === segmentIndex;
        segment.style.strokeWidth = active ? "21px" : "17px";
        segment.style.opacity = activeIndex == null || active ? "1" : "0.38";
      });
      legendEls.forEach((item, itemIndex) => {
        item.classList.toggle("is-active", activeIndex === itemIndex);
      });
      if (!center) return;
      if (activeIndex == null) {
        center.innerHTML = "<span>当月支出</span><strong>" + moneyCents(totalCents) + "</strong><em>" + entries.length + " 个分类</em>";
      } else {
        const entry = entries[activeIndex];
        const percentage = totalCents > 0 ? (entry.cents / totalCents) * 100 : 0;
        center.innerHTML = "<span>" + escapeHTML(entry.name) + "</span><strong>" + moneyCents(entry.cents) +
          "</strong><em>" + formatPercent(percentage) + " · " + entry.count + " 笔</em>";
      }
    }

    segmentEls.forEach((segment) => {
      segment.addEventListener("click", () => setActive(Number(segment.dataset.catIndex)));
    });
    legendEls.forEach((item) => {
      item.addEventListener("click", () => setActive(Number(item.dataset.catIndex)));
    });
  }

  function renderIncomeBreakdown(incomes, totalIncome) {
    const container = $("#incomeBreakdown");
    if (!container) return;
    if (!incomes.length) {
      container.innerHTML = emptyState(
        "i-wallet",
        "这个月还没有进账",
        "生活费、助学金、三助到账后，在这里记一笔。",
        '<button class="btn btn-secondary btn-sm" type="button" data-action="open-tx">记一笔收入</button>'
      );
      return;
    }
    const grouped = new Map();
    incomes.forEach((transaction) => {
      const category = getCategory("income", transaction.category);
      if (!grouped.has(category.id)) {
        grouped.set(category.id, { name: category.name, color: category.color, cents: 0, count: 0 });
      }
      const entry = grouped.get(category.id);
      entry.cents += toCents(transaction.amount);
      entry.count += 1;
    });
    const entries = Array.from(grouped.values()).sort((a, b) => b.cents - a.cents);
    const totalCents = entries.reduce((sum, entry) => sum + entry.cents, 0) || toCents(totalIncome);
    container.innerHTML = entries.map((entry) => {
      const percentage = totalCents > 0 ? (entry.cents / totalCents) * 100 : 0;
      return '<div class="breakdown-row">' +
        '<span class="breakdown-name"><i style="background:' + entry.color + '" aria-hidden="true"></i><span>' + escapeHTML(entry.name) + "</span></span>" +
        '<span class="breakdown-track"><span class="breakdown-fill" style="width:' + percentage.toFixed(1) + "%;--bar-color:" + entry.color + '"></span></span>' +
        '<span class="breakdown-value">' + moneyCents(entry.cents) + "<em>" + formatPercent(percentage) + "</em></span>" +
        "</div>";
    }).join("");
  }

  function setText(selector, text) {
    const element = $(selector);
    if (element) {
      element.textContent = text;
    }
  }

  function setText(selector, text) {
    const element = $(selector);
    if (element) {
      element.textContent = text;
    }
  }

  function renderCurrent() {
    if (ui.today !== todayISO()) {
      ui.today = todayISO();
      renderDateLine();
    }
    if (ui.view === "home") {
      renderHome();
    } else if (ui.view === "ledger") {
      renderLedger();
    } else if (ui.view === "balance") {
      renderBalance();
    } else if (ui.view === "report") {
      renderReport();
    }
    if (sheetOpen && sheetType === "transaction" && typeof sheetRefresh === "function") {
      sheetRefresh();
    }
    updateStorageStatus();
    updateBackupNudge();
  }
  /* ============================================================
     Charts
     ============================================================ */

  function axisLabel(value, step) {
    if (step < 1) {
      return (Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
    }
    if (step < 10) {
      return (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "");
    }
    return axisMoney(value);
  }

  function trapezoidPath(x, top, width, height) {
    if (height <= 0.2) {
      return "";
    }
    const inset = Math.min(width * 0.2, 3.2);
    const radius = Math.min(width * 0.18, 2.2);
    const base = top + height;
    return "M" + x.toFixed(1) + " " + base.toFixed(1) +
      " L" + (x + inset).toFixed(1) + " " + (top + radius).toFixed(1) +
      " Q" + (x + inset).toFixed(1) + " " + top.toFixed(1) + " " + (x + inset + radius).toFixed(1) + " " + top.toFixed(1) +
      " L" + (x + width - inset - radius).toFixed(1) + " " + top.toFixed(1) +
      " Q" + (x + width - inset).toFixed(1) + " " + top.toFixed(1) + " " + (x + width - inset).toFixed(1) + " " + (top + radius).toFixed(1) +
      " L" + (x + width).toFixed(1) + " " + base.toFixed(1) +
      " Z";
  }

  function renderTrapezoidChart(container, series, options) {
    const width = Math.floor(container.clientWidth);
    const height = Math.floor(container.clientHeight);
    if (!width || !height) return;
    if (!series.hasData) {
      chartEmpty(container, "还没有收支数据", "记下第一笔，图表就会在这里生长。");
      return;
    }

    const opts = options || {};
    const months = series.months;
    const incomeValues = series.incomes;
    const expenseValues = series.expenses;
    const left = width < 340 ? 35 : 40;
    const right = 7;
    const top = 17;
    const bottom = 25;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const maxValue = Math.max.apply(null, incomeValues.concat(expenseValues).concat([1]));
    const roughMax = maxValue * 1.08;
    const stepValue = niceStep(roughMax / 5);
    const gridCount = Math.max(4, Math.ceil(roughMax / stepValue));
    const yMax = stepValue * gridCount;
    const yOf = (value) => top + plotHeight - (value / yMax) * plotHeight;
    const baseY = top + plotHeight;
    const chartId = "trap" + Math.random().toString(36).slice(2, 8);
    const groupWidth = plotWidth / months.length;
    const pairGap = Math.max(1.8, Math.min(4, groupWidth * 0.11));
    const barWidth = Math.max(3.2, Math.min(16, (groupWidth * 0.62 - pairGap) / 2));
    const pairWidth = barWidth * 2 + pairGap;

    let svg = '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' +
      escapeAttr("月度收支梯形图，" + months.map((month, index) =>
        monthFullLabel(month) + "收入" + money(incomeValues[index]) + "，支出" + money(expenseValues[index])
      ).join("；")) + '">' +
      "<defs>" +
        '<linearGradient id="' + chartId + '-income" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#78ad8b"></stop>' +
          '<stop offset="100%" stop-color="#4b8868"></stop>' +
        "</linearGradient>" +
        '<linearGradient id="' + chartId + '-expense" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#df967b"></stop>' +
          '<stop offset="100%" stop-color="#c86c4d"></stop>' +
        "</linearGradient>" +
      "</defs>";

    for (let index = 0; index <= gridCount; index += 1) {
      const value = stepValue * index;
      const y = yOf(value);
      svg += '<line class="' + (index === 0 ? "chart-baseline" : "chart-grid") + '" x1="' + left + '" y1="' + y.toFixed(1) +
        '" x2="' + (width - right) + '" y2="' + y.toFixed(1) + '"></line>';
      svg += '<text class="chart-axis" x="' + (left - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' +
        escapeHTML(axisLabel(value, stepValue)) + "</text>";
    }

    months.forEach((month, index) => {
      const groupX = left + index * groupWidth;
      const pairX = groupX + (groupWidth - pairWidth) / 2;
      const incomeHeight = Math.max(0, (incomeValues[index] / yMax) * plotHeight);
      const expenseHeight = Math.max(0, (expenseValues[index] / yMax) * plotHeight);
      const delay = Math.min(index * 24, 220);
      if (incomeHeight > 0.4) {
        svg += '<path class="chart-bar" d="' + trapezoidPath(pairX, baseY - incomeHeight, barWidth, incomeHeight) +
          '" fill="url(#' + chartId + '-income)" style="animation-delay:' + delay + 'ms"></path>';
      }
      if (expenseHeight > 0.4) {
        svg += '<path class="chart-bar" d="' + trapezoidPath(pairX + barWidth + pairGap, baseY - expenseHeight, barWidth, expenseHeight) +
          '" fill="url(#' + chartId + '-expense)" style="animation-delay:' + (delay + 35) + 'ms"></path>';
      }
    });

    const labelEvery = Math.max(1, Math.ceil((months.length * 28) / Math.max(plotWidth, 1)));
    months.forEach((month, index) => {
      if ((months.length - 1 - index) % labelEvery !== 0) {
        return;
      }
      const x = left + groupWidth * (index + 0.5);
      svg += '<text class="chart-axis" x="' + x.toFixed(1) + '" y="' + (height - 7) +
        '" text-anchor="middle">' + escapeHTML(monthShortLabel(month)) + "</text>";
    });

    months.forEach((month, index) => {
      svg += '<rect class="chart-band" data-chart-index="' + index + '" x="' + (left + groupWidth * index).toFixed(1) +
        '" y="' + (top - 2) + '" width="' + groupWidth.toFixed(1) + '" height="' + (plotHeight + 8) + '"></rect>';
    });
    svg += "</svg>";

    container.innerHTML = svg + '<div class="chart-tooltip" aria-hidden="true"></div>';
    const svgElement = $("svg", container);
    const tooltip = $(".chart-tooltip", container);
    if (!svgElement || !tooltip) return;
    const bands = $$(".chart-band", svgElement);
    const hoverCapable = window.matchMedia("(hover: hover)").matches;

    function hideTooltip() {
      tooltip.classList.remove("is-visible");
      bands.forEach((band) => band.classList.remove("is-active"));
    }

    function showTooltip(index) {
      const income = incomeValues[index];
      const expense = expenseValues[index];
      tooltip.innerHTML = "<strong>" + escapeHTML(monthFullLabel(months[index])) + "</strong>" +
        '<div class="chart-tooltip-row"><span>收入</span><b class="income">' + money(income) + "</b></div>" +
        '<div class="chart-tooltip-row"><span>支出</span><b class="expense">' + money(expense) + "</b></div>" +
        '<div class="chart-tooltip-row"><span>结余</span><b>' + money(income - expense, { sign: true }) + "</b></div>";
      tooltip.classList.add("is-visible");
      const centerX = left + groupWidth * (index + 0.5);
      const half = Math.min(72, width / 2 - 4);
      tooltip.style.left = clamp(centerX, half, width - half).toFixed(1) + "px";
      tooltip.style.top = "0px";
      bands.forEach((band, bandIndex) => {
        band.classList.toggle("is-active", bandIndex === index);
      });
    }

    bands.forEach((band) => {
      const index = Number(band.dataset.chartIndex);
      if (hoverCapable) {
        band.addEventListener("pointerenter", () => showTooltip(index));
      }
      band.addEventListener("click", () => showTooltip(index));
    });
    if (hoverCapable) {
      svgElement.addEventListener("pointerleave", hideTooltip);
    }
    if (opts.compact) {
      tooltip.classList.add("chart-tooltip-compact");
    }
  }

  function renderLineChart(container, points, options) {
    const opts = options || {};
    const width = Math.floor(container.clientWidth);
    const height = Math.floor(container.clientHeight);
    if (!width || !height) return;
    if (!points.length) {
      chartEmpty(container, opts.emptyTitle || "还没有数据", opts.emptyText || "记录几次之后，就能看到走势。");
      return;
    }

    const left = width < 340 ? 38 : 43;
    const right = 8;
    const top = 16;
    const bottom = 24;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const values = points.map((point) => point.value);
    const rawMin = Math.min.apply(null, values);
    const rawMax = Math.max.apply(null, values);
    const rawSpan = rawMax - rawMin || Math.max(rawMax * 0.12, 20);
    // Balance charts may dip below zero after auto-deductions, so keep the
    // domain free around the data instead of clamping it to 0.
    let low = rawMin - rawSpan * 0.28;
    let high = rawMax + rawSpan * 0.28;
    const stepValue = niceStep((high - low) / 4);
    low = Math.floor(low / stepValue) * stepValue;
    high = Math.ceil(high / stepValue) * stepValue;
    if (high <= low) {
      high = low + stepValue;
    }
    const gridCount = Math.max(1, Math.round((high - low) / stepValue));
    const yOf = (value) => top + plotHeight - ((value - low) / (high - low)) * plotHeight;
    const color = opts.color || "#2f6a50";
    const chartId = "line" + Math.random().toString(36).slice(2, 8);
    const label = opts.label || "余额";

    let svg = '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' +
      escapeAttr(label + "走势，共" + points.length + "次记录，从" + formatDateCN(points[0].date, { year: true }) +
        "到" + formatDateCN(points[points.length - 1].date, { year: true })) + '">' +
      "<defs>" +
        '<linearGradient id="' + chartId + '-area" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + color + '" stop-opacity=".2"></stop>' +
          '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"></stop>' +
        "</linearGradient>" +
      "</defs>";

    for (let index = 0; index <= gridCount; index += 1) {
      const value = low + stepValue * index;
      const y = yOf(value);
      const zeroLine = value === 0;
      svg += '<line class="' + (zeroLine ? "chart-baseline" : "chart-grid") + '" x1="' + left + '" y1="' + y.toFixed(1) +
        '" x2="' + (width - right) + '" y2="' + y.toFixed(1) + '"></line>';
      svg += '<text class="chart-axis" x="' + (left - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' +
        escapeHTML((value < 0 ? "−" : "") + axisLabel(Math.abs(value), stepValue)) + "</text>";
    }

    const positions = points.map((point, index) => {
      const x = points.length === 1 ? left + plotWidth / 2 : left + (plotWidth / (points.length - 1)) * index;
      return { x, y: yOf(point.value) };
    });
    const linePath = positions.map((position, index) => (index === 0 ? "M" : "L") + position.x.toFixed(1) + " " + position.y.toFixed(1)).join(" ");
    if (positions.length > 1 && opts.showArea !== false) {
      const areaPath = linePath + " L" + positions[positions.length - 1].x.toFixed(1) + " " + (top + plotHeight) +
        " L" + positions[0].x.toFixed(1) + " " + (top + plotHeight) + " Z";
      svg += '<path class="chart-area" d="' + areaPath + '" fill="url(#' + chartId + '-area)"></path>';
    }
    if (positions.length > 1) {
      svg += '<path class="chart-line" d="' + linePath + '" stroke="' + color + '"></path>';
    }
    positions.forEach((position, index) => {
      svg += '<circle class="chart-point" data-point-index="' + index + '" cx="' + position.x.toFixed(1) + '" cy="' + position.y.toFixed(1) +
        '" r="3.4" fill="' + color + '"></circle>';
    });

    const labelEvery = Math.max(1, Math.ceil((points.length * 33) / Math.max(plotWidth, 1)));
    points.forEach((point, index) => {
      if ((points.length - 1 - index) % labelEvery !== 0) {
        return;
      }
      svg += '<text class="chart-axis" x="' + positions[index].x.toFixed(1) + '" y="' + (height - 6) +
        '" text-anchor="middle">' + escapeHTML(shortDateLabel(point.date)) + "</text>";
    });

    const boundaries = [left];
    for (let index = 1; index < positions.length; index += 1) {
      boundaries.push((positions[index - 1].x + positions[index].x) / 2);
    }
    boundaries.push(left + plotWidth);
    positions.forEach((position, index) => {
      const start = positions.length === 1 ? left : boundaries[index];
      const end = positions.length === 1 ? left + plotWidth : boundaries[index + 1];
      svg += '<rect class="chart-band" data-chart-index="' + index + '" x="' + start.toFixed(1) + '" y="' + top +
        '" width="' + Math.max(1, end - start).toFixed(1) + '" height="' + (plotHeight + 6) + '"></rect>';
    });
    svg += "</svg>";

    container.innerHTML = svg + '<div class="chart-tooltip" aria-hidden="true"></div>';
    const svgElement = $("svg", container);
    const tooltip = $(".chart-tooltip", container);
    if (!svgElement || !tooltip) return;
    const bands = $$(".chart-band", svgElement);
    const dots = $$(".chart-point", svgElement);
    const hoverCapable = window.matchMedia("(hover: hover)").matches;

    function hideTooltip() {
      tooltip.classList.remove("is-visible");
      bands.forEach((band) => band.classList.remove("is-active"));
      dots.forEach((dot) => dot.setAttribute("r", "3.4"));
    }

    function showTooltip(index) {
      const point = points[index];
      tooltip.innerHTML = "<strong>" + escapeHTML(formatDateCN(point.date, { year: true, weekday: true })) + "</strong>" +
        '<div class="chart-tooltip-row"><span>' + escapeHTML(label) + '</span><b class="income">' + money(point.value) + "</b></div>";
      tooltip.classList.add("is-visible");
      const half = Math.min(76, width / 2 - 4);
      tooltip.style.left = clamp(positions[index].x, half, width - half).toFixed(1) + "px";
      tooltip.style.top = "0px";
      bands.forEach((band, bandIndex) => {
        band.classList.toggle("is-active", bandIndex === index);
      });
      dots.forEach((dot, dotIndex) => dot.setAttribute("r", dotIndex === index ? "5" : "3.4"));
    }

    bands.forEach((band) => {
      const index = Number(band.dataset.chartIndex);
      if (hoverCapable) {
        band.addEventListener("pointerenter", () => showTooltip(index));
      }
      band.addEventListener("click", () => showTooltip(index));
    });
    if (hoverCapable) {
      svgElement.addEventListener("pointerleave", hideTooltip);
    }
  }
  /* ============================================================
     View navigation & sheet plumbing
     ============================================================ */

  function switchView(view, options) {
    if (!VIEWS.includes(view)) {
      view = "home";
    }
    const opts = options || {};
    ui.view = view;
    $$(".view").forEach((section) => {
      section.classList.toggle("is-active", section.id === "view-" + view);
    });
    $$(".tab[data-view]").forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle("is-active", active);
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    if (opts.scroll !== false) {
      window.scrollTo({ top: 0, behavior: opts.instant ? "auto" : "smooth" });
    }
    if (opts.history !== false) {
      try {
        window.history.replaceState(null, "", "#" + view);
      } catch (error) {
        /* file:// contexts can reject history changes; navigation still works. */
      }
    }
    const titles = {
      home: "记账本 · 手机余额账本",
      ledger: "流水明细 · 记账本",
      balance: "余额快照 · 记账本",
      report: "收支报表 · 记账本"
    };
    document.title = titles[view] || titles.home;
    renderCurrent();
  }

  function updateBodyLock() {
    document.body.classList.toggle("is-locked", sheetOpen || dialogOpen);
  }

  function openSheet(config) {
    const backdrop = $("#sheetBackdrop");
    const sheet = $("#sheet");
    const body = $("#sheetBody");
    const foot = $("#sheetFoot");
    if (!backdrop || !sheet || !body || !foot) return;

    if (!sheetOpen) {
      sheetLastFocus = document.activeElement;
    }
    sheetOpen = true;
    sheetType = config.type || "";
    sheetRefresh = null;
    if (config.kicker) {
      $("#sheetKicker").textContent = config.kicker;
      $("#sheetKicker").hidden = false;
    } else {
      $("#sheetKicker").textContent = "";
      $("#sheetKicker").hidden = true;
    }
    $("#sheetTitle").textContent = config.title || "";
    body.innerHTML = config.body || "";
    body.scrollTop = 0;
    foot.innerHTML = config.foot || "";
    foot.hidden = !config.foot;
    backdrop.hidden = false;
    updateBodyLock();
    if (config.onOpen) {
      config.onOpen();
    }
    window.requestAnimationFrame(() => {
      backdrop.classList.add("is-open");
      sheet.focus({ preventScroll: true });
    });
  }

  let sheetCloseTimer = null;

  function closeSheet() {
    if (!sheetOpen) return;
    const backdrop = $("#sheetBackdrop");
    sheetOpen = false;
    sheetType = "";
    sheetRefresh = null;
    if (backdrop) {
      backdrop.classList.remove("is-open");
    }
    updateBodyLock();
    const restoreTarget = sheetLastFocus;
    sheetLastFocus = null;
    window.clearTimeout(sheetCloseTimer);
    sheetCloseTimer = window.setTimeout(() => {
      if (!sheetOpen && backdrop) {
        backdrop.hidden = true;
      }
    }, 300);
    if (restoreTarget && document.contains(restoreTarget)) {
      window.setTimeout(() => {
        try {
          restoreTarget.focus({ preventScroll: true });
        } catch (error) {
          /* ignore */
        }
      }, 80);
    }
  }

  function showFormError(element, message) {
    if (!element) return;
    element.textContent = message;
    element.hidden = false;
    element.classList.remove("shake");
    void element.offsetWidth;
    element.classList.add("shake");
    element.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function hideFormError(element) {
    if (!element) return;
    element.hidden = true;
    element.textContent = "";
  }

  function amountInputValue(value) {
    return value == null || value === "" ? "" : (Math.round(Number(value) * 100) / 100).toFixed(2);
  }

  function categoryOptionsMarkup(type, selectedId) {
    const categories = CATEGORIES[type].concat(data.categories.filter((category) =>
      category.type === type && (!category.archived || category.id === selectedId)
    ));
    if (selectedId && !categories.some((category) => category.id === selectedId)) {
      categories.push({ ...FALLBACK_CATEGORY, id: selectedId });
    }
    return categories.map((category) => (
      '<button type="button" class="cat-option' + (category.id === selectedId ? " is-active" : "") +
      '" data-category="' + escapeAttr(category.id) + '" title="' + escapeAttr(category.name) +
      '" aria-pressed="' + (category.id === selectedId ? "true" : "false") + '">' +
        '<span class="cat-emoji" aria-hidden="true">' + category.icon + "</span>" +
        "<span>" + escapeHTML(category.name) + "</span>" +
      "</button>"
    )).join("");
  }

  function categoryNameMarkup(name = "") {
    return '<label class="field-label" for="categoryName">分类名称</label>' +
      '<div class="category-name-row">' +
        '<input class="text-input" id="categoryName" maxlength="' + CATEGORY_NAME_LIMIT +
          '" placeholder="例如：房租、奖学金" value="' + escapeAttr(name) + '">' +
        '<button class="btn btn-secondary btn-sm" id="saveCategory" type="button">保存分类</button>' +
      '</div><p class="form-error" id="categoryError" role="alert" hidden></p>';
  }

  function commitCatalog(key, items) {
    const previous = data[key];
    const updatedAt = data.updatedAt;
    data[key] = items;
    if (persist()) return true;
    data[key] = previous;
    data.updatedAt = updatedAt;
    return false;
  }

  function bindCategoryName(type, editing, onSave) {
    const input = $("#categoryName");
    const error = $("#categoryError");
    function save() {
      const name = input.value.trim().replace(/\s+/g, " ");
      if (!name) {
        showFormError(error, "请填写分类名称。");
        return;
      }
      const key = nameKey(name);
      const duplicate = CATEGORIES[type].concat(data.categories.filter((item) => item.type === type))
        .find((item) => item.id !== editing?.id && nameKey(item.name) === key);
      if (duplicate) {
        showFormError(error, duplicate.archived ? "该分类已停用，可在「分类管理」中恢复。" : "这个分类已存在。");
        return;
      }
      const category = editing ? { ...editing, name } : customCategory("custom-" + uid(), type, name);
      const categories = editing
        ? data.categories.map((item) => item === editing ? category : item)
        : data.categories.concat(category);
      if (!commitCatalog("categories", categories)) {
        showFormError(error, "分类未保存，请检查本机存储后重试。");
        return;
      }
      renderCurrent();
      showToast(editing ? "分类已改名" : "分类已添加");
      onSave(category);
    }
    $("#saveCategory").addEventListener("click", save);
    input.addEventListener("input", () => hideFormError(error));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        save();
      }
    });
  }

  function openCategorySheet(type = "expense", editing = null) {
    const categories = data.categories.filter((item) => item.type === type);
    const body = '<div class="type-switch" role="group" aria-label="分类类型">' +
      ["expense", "income"].map((item) =>
        '<button type="button" data-category-type="' + item + '" class="' + (type === item ? "is-active" : "") +
        '" aria-pressed="' + (type === item) + '">' + (item === "income" ? "收入" : "支出") + '</button>'
      ).join("") + '</div>' +
      '<div class="category-editor">' + categoryNameMarkup(editing?.name) +
        (editing ? '<button class="btn btn-secondary btn-sm" id="cancelCategoryEdit" type="button">取消改名</button>' : '') +
      '</div>' +
      '<div class="data-section-title"><span>自定义分类</span></div>' +
      '<p class="form-hint">改名会更新流水和报表中的名称。停用后，新流水的分类列表会隐藏该项。</p>' +
      '<div class="custom-category-list">' +
        (categories.length ? categories.map((item) =>
          '<div class="custom-category-row">' +
            '<span class="custom-category-name">' + escapeHTML(item.name) +
              (item.archived ? '<small>已停用</small>' : '') + '</span>' +
            '<button class="btn btn-secondary btn-sm" type="button" data-rename-category="' + escapeAttr(item.id) + '">改名</button>' +
            '<button class="btn btn-secondary btn-sm" type="button" data-toggle-category="' + escapeAttr(item.id) + '">' +
              (item.archived ? "恢复" : "停用") + '</button>' +
          '</div>'
        ).join("") : '<p class="form-hint">还没有自定义分类。</p>') +
      '</div>';

    openSheet({
      type: "categories",
      title: "分类管理",
      body,
      foot: '<button class="btn btn-secondary" type="button" data-action="open-data">返回数据与备份</button>',
      onOpen: () => {
        bindCategoryName(type, editing, () => openCategorySheet(type));
        $("#cancelCategoryEdit")?.addEventListener("click", () => openCategorySheet(type));
        $$("[data-category-type]").forEach((button) => {
          button.addEventListener("click", () => openCategorySheet(button.dataset.categoryType));
        });
        $$("[data-rename-category]").forEach((button) => {
          button.addEventListener("click", () => {
            openCategorySheet(type, categories.find((item) => item.id === button.dataset.renameCategory));
            window.requestAnimationFrame(() => $("#categoryName")?.focus());
          });
        });
        $$("[data-toggle-category]").forEach((button) => {
          button.addEventListener("click", () => {
            const target = categories.find((item) => item.id === button.dataset.toggleCategory);
            const next = data.categories.map((item) => item === target ? { ...item, archived: !item.archived } : item);
            if (!commitCatalog("categories", next)) return;
            openCategorySheet(type);
            showToast(target.archived ? "分类已恢复" : "分类已停用，旧流水保留原分类");
          });
        });
      }
    });
  }

  function openAccountSheet() {
    const body = '<form id="accountForm" class="category-editor" autocomplete="off">' +
      '<label class="field-label" for="accountName">新账户名称</label>' +
      '<div class="category-name-row">' +
        '<input class="text-input" id="accountName" maxlength="' + CATEGORY_NAME_LIMIT +
          '" placeholder="例如：现金、招商银行">' +
        '<button class="btn btn-secondary btn-sm" type="submit">添加账户</button>' +
      '</div><p class="form-error" id="accountError" role="alert" hidden></p>' +
    '</form>' +
    '<div class="data-section-title"><span>账本账户</span></div>' +
    '<p class="form-hint">添加后即可用于记账。要设置初始金额，请打开「记余额」填写该账户的余额。</p>' +
    '<div class="custom-category-list">' + accounts().map((account) =>
      '<div class="custom-category-row">' + accountGlyph(account) +
      '<span class="custom-category-name">' + escapeHTML(account.name) + '</span></div>'
    ).join("") + '</div>';

    openSheet({
      type: "accounts",
      title: "账户管理",
      body,
      foot: '<button class="btn btn-secondary" type="button" data-action="open-balance">记余额</button>',
      onOpen: () => {
        const input = $("#accountName");
        const error = $("#accountError");
        input.addEventListener("input", () => hideFormError(error));
        $("#accountForm").addEventListener("submit", (event) => {
          event.preventDefault();
          const name = input.value.trim().replace(/\s+/g, " ");
          if (!name) {
            showFormError(error, "请填写账户名称。");
            return;
          }
          if (accounts().some((account) => nameKey(account.name) === nameKey(name))) {
            showFormError(error, "这个账户名称已存在。");
            return;
          }
          const account = customAccount("account-" + uid(), name);
          if (!commitCatalog("accounts", data.accounts.concat(account))) {
            showFormError(error, "账户未保存，请检查本机存储后重试。");
            return;
          }
          renderCurrent();
          openAccountSheet();
          showToast("账户已添加");
        });
      }
    });
  }

  /* ============================================================
     Transaction sheet
     ============================================================ */

  async function deleteTransactionById(id) {
    const existing = data.transactions.find((transaction) => transaction.id === id);
    if (!existing) {
      showToast("这条流水已经不存在了");
      return false;
    }
    const confirmLines = ["将删除「" + getCategory(existing.type, existing.category).name + " " +
      money(existing.amount) + "」。"];
    if (autoSyncEnabled()) {
      confirmLines.push("这笔从" + getAccount(existing.account).name +
        (existing.type === "income" ? "退回 " : "加回 ") + money(existing.amount) + "。");
    }
    confirmLines.push("删除后仍可从本机自动副本恢复。");
    const confirmed = await askDialog({
      title: "删除这笔流水？",
      message: confirmLines.join("\n"),
      icon: "i-trash",
      tone: "danger",
      actions: [
        { label: "保留", value: false, kind: "ghost" },
        { label: "删除", value: true, kind: "danger" }
      ]
    });
    if (!confirmed) return false;
    createAutoBackup("删除流水前", true);
    const index = data.transactions.findIndex((transaction) => transaction.id === id);
    if (index < 0) {
      showToast("这条流水已经不存在了");
      return false;
    }
    const removed = data.transactions[index];
    data.transactions.splice(index, 1);
    const saved = persist();
    closeSheet();
    renderCurrent();
    showToast(saved ? "已删除这笔流水" : "已从页面删除，但本机保存失败", {
      actionLabel: "撤销",
      duration: 7000,
      onAction: () => {
        data.transactions.push(removed);
        persist();
        renderCurrent();
        showToast("已恢复这笔流水");
      }
    });
    return true;
  }

  function openTxSheet(id) {
    const existing = id ? data.transactions.find((transaction) => transaction.id === id) : null;
    if (id && !existing) {
      showToast("这条流水已经不存在了");
      return;
    }

    let currentType = existing ? existing.type : "expense";
    const selections = { expense: defaultCategoryId("expense"), income: defaultCategoryId("income") };
    if (existing) selections[existing.type] = existing.category;
    const selectedAccount = existing ? existing.account : data.settings.lastAccount;
    const editing = Boolean(existing);
    const date = existing ? existing.date : todayISO();
    const amount = existing ? existing.amount : "";
    const note = existing ? existing.note : "";

    const accountOptions = accounts().map((account) => (
      '<option value="' + account.id + '"' + (account.id === selectedAccount ? " selected" : "") + ">" +
      escapeHTML(account.name) + "</option>"
    )).join("");

    const body = '<form id="txForm" novalidate autocomplete="off">' +
      '<div class="type-switch" role="group" aria-label="选择收支类型">' +
        '<button type="button" data-tx-type="expense" class="' + (currentType === "expense" ? "is-active" : "") + '">支出</button>' +
        '<button type="button" data-tx-type="income" class="' + (currentType === "income" ? "is-active" : "") + '">收入</button>' +
      "</div>" +
      '<div class="field">' +
        '<label class="field-label" for="txAmount">金额 <span class="optional">必填</span></label>' +
        '<div class="amount-hero" id="amountHero"><span class="currency">¥</span>' +
          '<input id="txAmount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + escapeAttr(amountInputValue(amount)) + '">' +
        "</div>" +
      "</div>" +
      '<div class="field">' +
        '<div class="category-heading">' +
          '<span class="field-label" id="txCategoryLabel">分类 <span class="optional">必填</span></span>' +
          '<button class="category-add" type="button" id="addTxCategory" aria-controls="txCategoryEditor" aria-expanded="false">＋ 新建分类</button>' +
        '</div>' +
        '<div class="category-editor" id="txCategoryEditor" hidden></div>' +
        '<div class="category-grid" id="txCategories" role="group" aria-labelledby="txCategoryLabel"></div>' +
      "</div>" +
      '<div class="form-grid">' +
        '<div class="field">' +
          '<label class="field-label" for="txDate">日期</label>' +
          '<input class="text-input" id="txDate" type="date" value="' + escapeAttr(date) + '" max="' + todayISO() + '">' +
        "</div>" +
        '<div class="field">' +
          '<label class="field-label" for="txAccount">账户</label>' +
          '<div class="select-wrap"><select class="select-input" id="txAccount">' + accountOptions + "</select>" +
            '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-down"/></svg></div>' +
          '<p class="form-hint" id="txAccountHint"></p>' +
        "</div>" +
      "</div>" +
      '<div class="tx-sync" id="txSync" hidden></div>' +
      '<div class="field">' +
        '<label class="field-label" for="txNote">备注 <span class="optional">选填</span></label>' +
        '<input class="text-input" id="txNote" type="text" maxlength="60" placeholder="例如：和同学吃晚饭" value="' + escapeAttr(note) + '">' +
      "</div>" +
      '<div class="form-error" id="txError" hidden></div>' +
      "</form>";

    const foot = '<button class="btn btn-primary" type="submit" form="txForm">' +
      (editing ? "保存修改" : "保存这笔") + "</button>" +
      (editing
        ? '<button class="sheet-delete" type="button" id="deleteTx">' +
          '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-trash"/></svg>删除这笔流水</button>'
        : "");

    openSheet({
      type: "transaction",
      kicker: editing ? "EDIT TRANSACTION" : "NEW TRANSACTION",
      title: editing ? "编辑流水" : "记一笔",
      body,
      foot,
      onOpen: () => {
        const form = $("#txForm");
        const amountInput = $("#txAmount");
        const dateInput = $("#txDate");
        const accountInput = $("#txAccount");
        const noteInput = $("#txNote");
        const categoryGrid = $("#txCategories");
        const errorBox = $("#txError");
        const amountHero = $("#amountHero");
        const categoryEditor = $("#txCategoryEditor");
        const addCategoryButton = $("#addTxCategory");

        function toggleCategoryEditor(open) {
          categoryEditor.hidden = !open;
          addCategoryButton.setAttribute("aria-expanded", String(open));
          addCategoryButton.textContent = open ? "收起" : "＋ 新建分类";
          if (open) $("#categoryName").focus();
        }

        function bindQuickCategory() {
          categoryEditor.innerHTML = categoryNameMarkup();
          bindCategoryName(currentType, null, (category) => {
            selections[currentType] = category.id;
            toggleCategoryEditor(false);
            bindQuickCategory();
            paintCategories();
            $(".cat-option.is-active", categoryGrid).focus({ preventScroll: true });
          });
        }

        function paintCategories() {
          categoryGrid.innerHTML = categoryOptionsMarkup(currentType, selections[currentType]);
          $$(".cat-option", categoryGrid).forEach((button) => {
            button.addEventListener("click", () => {
              selections[currentType] = button.dataset.category;
              $$(".cat-option", categoryGrid).forEach((item) => {
                const active = item.dataset.category === selections[currentType];
                item.classList.toggle("is-active", active);
                item.setAttribute("aria-pressed", active ? "true" : "false");
              });
              hideFormError(errorBox);
            });
          });
          const active = $(".cat-option.is-active", categoryGrid);
          categoryGrid.scrollTop = Math.max(0, active.offsetTop + active.offsetHeight - categoryGrid.clientHeight + 2);
        }

        $$(".type-switch button", form).forEach((button) => {
          button.addEventListener("click", () => {
            const nextType = button.dataset.txType;
            if (nextType === currentType) return;
            currentType = nextType;
            toggleCategoryEditor(false);
            bindQuickCategory();
            $$(".type-switch button", form).forEach((item) => {
              item.classList.toggle("is-active", item.dataset.txType === currentType);
            });
            paintCategories();
            refreshTxPreview();
            hideFormError(errorBox);
          });
        });

        paintCategories();
        bindQuickCategory();
        addCategoryButton.addEventListener("click", () => toggleCategoryEditor(categoryEditor.hidden));

        // Live account balance + "after this entry" preview.
        const hint = $("#txAccountHint");
        const syncBox = $("#txSync");

        function readTxPreviewState() {
          const unsynced = existing?.balanceSynced === false;
          const draft = {
            type: currentType,
            amount: parseAmount(amountInput.value) || 0,
            date: isValidDateString(dateInput.value) ? dateInput.value : todayISO(),
            account: accountInput.value
          };
          const base = balanceBeforeTransaction(draft, existing?.id);
          const delta = unsynced || base.coveredBySnapshot ? 0 : transactionDelta(draft);
          return { base, delta, unsynced };
        }
        function refreshTxPreview() {
          const account = getAccount(accountInput.value);
          const active = readTxPreviewState();
          const base = active.base;
          const now = autoSyncEnabled();
          const delta = active.delta;
          const after = base.cents + delta;

          if (hint) {
            const beforeNow = now ? runningBalanceNow().actual.cents[account.id] :
              manualAccountValuesAt(todayISO())[account.id];
            hint.textContent = account.name + "当前约 " + moneyCents(beforeNow) +
              (now ? "" : " · 自动更新已关闭");
          }

          if (!syncBox) return;
          if (!now) {
            syncBox.hidden = false;
            syncBox.className = "tx-sync is-off";
            syncBox.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-info"/></svg>' +
              "<span>流水会照常记录，余额不会自动更新。「数据」里可以随时开启自动更新。</span>";
            return;
          }
          const amountCents = Math.abs(delta);
          const lines = [];
          if (amountCents > 0) {
            lines.push(account.name + " " + moneyCents(base.cents) + (delta >= 0 ? " + " : " − ") +
              moneyCents(amountCents) + " = " + moneyCents(after));
          } else {
            lines.push(account.name + " 预计余额 " + moneyCents(after));
          }
          if (active.unsynced) {
            lines.push("这笔记于联动功能之前，保存不会重复扣款；需要联动可点「补记余额」");
          } else if (base.coveredBySnapshot) {
            lines.push("这笔日期在该账户最近一次快照当天或之前，当前余额以快照为准");
          } else if (!base.anchorDate) {
            lines.push("还没有余额快照，将从 0 开始累计");
          } else {
            lines.push("从 " + formatDateCN(base.anchorDate, { year: "auto" }) + " 的余额继续累计");
          }
          syncBox.hidden = false;
          syncBox.className = "tx-sync" + (active.unsynced ? " is-off" : "") +
            (after < 0 && amountCents > 0 ? " is-negative" : "");
          syncBox.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#' +
            (active.unsynced ? "i-info" : after < 0 && amountCents > 0 ? "i-alert" : "i-check") + '"/></svg>' +
            '<span class="tx-sync-text">' + lines.map(escapeHTML).join("<br>") + "</span>" +
            (amountCents > 0 && !active.unsynced
              ? '<span class="tx-sync-tag">' + (after < 0 ? "余额为负" : active.delta > 0 ? "入账" : "扣款") + "</span>"
              : "");
        }
        refreshTxPreview();

        amountInput.addEventListener("input", refreshTxPreview);
        dateInput.addEventListener("change", refreshTxPreview);
        accountInput.addEventListener("change", refreshTxPreview);

        // Lets renderCurrent() keep the preview in sync after data changes.
        sheetRefresh = refreshTxPreview;

        form.addEventListener("submit", (event) => {
          event.preventDefault();
          hideFormError(errorBox);
          amountHero.classList.remove("is-error");
          const amountValue = parseAmount(amountInput.value);
          if (amountValue === null || amountValue <= 0) {
            amountHero.classList.add("is-error");
            amountInput.focus();
            showFormError(errorBox, "请填写大于 0 的金额。");
            return;
          }
          if (!isValidDateString(dateInput.value) || dateInput.value > todayISO()) {
            dateInput.focus();
            showFormError(errorBox, "请选择一个今天或更早的日期。");
            return;
          }
          const selectedCategory = selections[currentType];

          const now = new Date().toISOString();
          if (editing) {
            createAutoBackup("修改流水前", true);
            existing.type = currentType;
            existing.category = selectedCategory;
            existing.amount = amountValue;
            existing.date = dateInput.value;
            existing.account = accountInput.value;
            existing.note = noteInput.value.trim().slice(0, 60);
            existing.updatedAt = now;
          } else {
            data.transactions.push({
              id: uid(),
              date: dateInput.value,
              type: currentType,
              category: selectedCategory,
              amount: amountValue,
              account: accountInput.value,
              note: noteInput.value.trim().slice(0, 60),
              createdAt: now,
              updatedAt: now
            });
          }
          data.settings.lastAccount = accountInput.value;
          const saved = persist();
          closeSheet();
          renderCurrent();
          const account = getAccount(accountInput.value);
          const unsyncedNote = editing && existing.balanceSynced === false;
          const anchor = runningBalanceNow().anchors[account.id];
          const balanceHint = autoSyncEnabled() && !unsyncedNote && (!anchor || dateInput.value > anchor.date)
            ? account.name + "余额已" + (currentType === "income" ? "入账" : "扣款") + " " + money(amountValue)
            : "";
          if (!saved) {
            showToast("已记在本次页面，但本机保存失败，请立即导出备份", { duration: 6200 });
          } else if (unsyncedNote) {
            showToast("这笔流水已更新（未联动余额）");
          } else if (editing) {
            showToast(balanceHint ? "已更新 · " + balanceHint : "这笔流水已更新");
          } else {
            showToast(balanceHint ? "已记下 · " + balanceHint : "已记下" + (currentType === "income" ? "这笔收入" : "这笔支出"));
          }
        });

        const deleteButton = $("#deleteTx");
        if (deleteButton) {
          deleteButton.addEventListener("click", () => {
            deleteTransactionById(existing.id);
          });
        }
      }
    });
  }

  /* ============================================================
     Balance sheet
     ============================================================ */

  // Balance kept for an account whose input the user leaves blank. When a
  // record is being edited or overwritten, its stored numbers win; otherwise
  // the account keeps whatever it currently shows.
  function retainedAccountCents(date, record) {
    const day = isValidDateString(date) ? date : todayISO();
    const cents = !autoSyncEnabled()
      ? manualAccountValuesAt(day)
      : (day < todayISO() ? runningBalanceAt(day) : runningBalanceNow()).actual.cents;
    if (record) {
      accounts().forEach(({ id }) => {
        if (record[id] !== undefined) cents[id] = toCents(record[id]);
      });
    }
    return cents;
  }

  function openBalanceSheet(id) {
    const existing = id ? data.balances.find((snapshot) => snapshot.id === id) : null;
    if (id && !existing) {
      showToast("这条余额记录已经不存在了");
      return;
    }
    const editing = Boolean(existing);
    const date = existing ? existing.date : todayISO();
    const latestSnapshot = latestBalance();
    // Editing shows the stored numbers; a new snapshot starts empty so the
    // user only types the accounts that actually changed.
    const note = existing ? existing.note : "";

    const rows = accounts().map((account) => {
      const { id, name } = account;
      return '<div class="account-balance-row">' + accountGlyph(account) +
        '<label for="balance-' + id + '">' + escapeHTML(name) + "</label>" +
        '<span class="input-wrap"><span>¥</span><input id="balance-' + id + '" data-balance-key="' + id +
        '" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' +
        escapeAttr(amountInputValue(existing?.[id])) + '"></span>' +
        "</div>";
    }).join("");

    const body = '<form id="balanceForm" novalidate autocomplete="off">' +
      '<div class="field">' +
        '<label class="field-label" for="balanceDate">记录日期</label>' +
        '<input class="text-input" id="balanceDate" type="date" value="' + escapeAttr(date) + '" max="' + todayISO() + '">' +
        '<p class="form-hint">同一天只保留一条记录，重复保存会更新它。</p>' +
        (autoSyncEnabled()
          ? '<p class="form-hint form-hint-sync"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-check"/></svg>' +
            "之后记的收支会从对应账户的余额里加减；这里填的是手记余额。" +
            (latestSnapshot ? "（上一次 " + escapeHTML(formatDateCN(latestSnapshot.date, { year: "auto" })) + "）" : "") +
            "</p>"
          : '<p class="form-hint">余额自动更新已关闭，这里填写的余额就是最新余额。</p>') +
      "</div>" +
      '<div class="field">' +
        '<span class="field-label">账户余额 <span class="optional">留空 = 保持不变</span></span>' +
        '<div class="account-balance-list">' + rows + "</div>" +
        '<p class="form-hint">只填有变化的账户，留空的账户会保持原来的余额；要把余额清零请填 0。</p>' +
        '<div class="date-warning" id="balanceWarning" hidden></div>' +
        '<div class="account-total"><span>保存后合计</span><strong id="balanceTotal">¥0.00</strong></div>' +
      "</div>" +
      '<div class="field">' +
        '<label class="field-label" for="balanceNote">备注 <span class="optional">选填</span></label>' +
        '<input class="text-input" id="balanceNote" type="text" maxlength="60" placeholder="例如：月末发生活费前" value="' + escapeAttr(note) + '">' +
      "</div>" +
      '<div class="form-error" id="balanceError" hidden></div>' +
      "</form>";

    const foot = '<button class="btn btn-primary" type="submit" form="balanceForm">' +
      (editing ? "保存这次更新" : "保存本次余额") + "</button>" +
      (editing
        ? '<button class="sheet-delete" type="button" id="deleteBalance">' +
          '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-trash"/></svg>删除这次快照</button>'
        : "");

    openSheet({
      type: "balance",
      kicker: editing ? "EDIT SNAPSHOT" : "NEW SNAPSHOT",
      title: editing ? "更新余额" : "记录余额",
      body,
      foot,
      onOpen: () => {
        const form = $("#balanceForm");
        const dateInput = $("#balanceDate");
        const noteInput = $("#balanceNote");
        const errorBox = $("#balanceError");
        const warning = $("#balanceWarning");
        const totalLabel = $("#balanceTotal");
        const inputs = $$("input[data-balance-key]", form);

        function readAmounts() {
          const amounts = {};
          let valid = true;
          inputs.forEach((input) => {
            const key = input.dataset.balanceKey;
            const raw = input.value.trim();
            if (raw === "") return;
            const value = parseBalance(raw);
            if (value === null || Math.abs(value) > 999999999.99) {
              valid = false;
            } else {
              amounts[key] = value;
            }
          });
          return { valid, amounts };
        }

        function duplicateOn(dateValue) {
          return data.balances.find((snapshot) => (
            snapshot.date === dateValue && (!existing || snapshot.id !== existing.id)
          ));
        }

        function refreshTotal() {
          const retained = retainedAccountCents(dateInput.value, existing || duplicateOn(dateInput.value));
          Object.entries(readAmounts().amounts).forEach(([key, value]) => { retained[key] = toCents(value); });
          totalLabel.textContent = moneyCents(accountValuesTotal(retained));
        }

        // Show the kept amount as a placeholder so an empty field never reads
        // like it is about to wipe the account to zero.
        function refreshPlaceholders(dateValue) {
          const retained = retainedAccountCents(dateValue, existing || duplicateOn(dateValue));
          inputs.forEach((input) => {
            const key = input.dataset.balanceKey;
            input.placeholder = amountInputValue(retained[key] / 100) || "0.00";
          });
        }

        function refreshWarning() {
          const duplicate = duplicateOn(dateInput.value);
          if (duplicate) {
            warning.hidden = false;
            warning.textContent = editing
              ? "这一天已有另一条余额记录，保存后会覆盖它。"
              : "这一天已经有余额记录，保存后会更新那条记录。";
          } else {
            warning.hidden = true;
            warning.textContent = "";
          }
        }

        inputs.forEach((input) => {
          input.addEventListener("input", () => {
            hideFormError(errorBox);
            refreshTotal();
          });
        });
        dateInput.addEventListener("change", () => {
          hideFormError(errorBox);
          refreshWarning();
          refreshPlaceholders(dateInput.value);
          refreshTotal();
        });
        refreshPlaceholders(dateInput.value);
        refreshTotal();
        refreshWarning();

        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          hideFormError(errorBox);
          const { valid, amounts } = readAmounts();
          if (!valid) {
            showFormError(errorBox, "请填写有效余额，金额最多为 999,999,999.99 元。");
            return;
          }
          if (!Object.keys(amounts).length) {
            showFormError(errorBox, "请至少填写一个账户余额，没有余额就填 0。");
            return;
          }
          if (!isValidDateString(dateInput.value) || dateInput.value > todayISO()) {
            showFormError(errorBox, "请选择一个今天或更早的日期。");
            return;
          }

          const targetDate = dateInput.value;
          const duplicate = duplicateOn(targetDate);
          if (editing && duplicate) {
            const confirmed = await askDialog({
              title: "覆盖同一天的记录？",
              message: "「" + formatDateCN(targetDate, { year: true }) + "」已经有一条余额记录了。继续保存会用当前填写的内容覆盖它。",
              icon: "i-alert",
              actions: [
                { label: "取消", value: false, kind: "ghost" },
                { label: "覆盖", value: true, kind: "danger" }
              ]
            });
            if (!confirmed) return;
          }

          const record = existing || duplicate;
          const retained = retainedAccountCents(targetDate, record);
          // A blank custom account without a saved amount keeps its prior anchor.
          const merged = { ...amounts };
          for (const { id } of DEFAULT_ACCOUNTS.concat(data.accounts.filter(({ id }) => record?.[id] !== undefined))) {
            if (merged[id] === undefined) merged[id] = retained[id] / 100;
          }

          createAutoBackup(editing ? "修改余额前" : "保存余额前", true);
          const now = new Date().toISOString();
          let target = existing;
          if (!target && duplicate) {
            target = duplicate;
          }
          if (target) {
            if (duplicate && duplicate.id !== target.id) {
              data.balances = data.balances.filter((snapshot) => snapshot.id !== duplicate.id);
            }
            target.date = targetDate;
            Object.assign(target, merged);
            target.note = noteInput.value.trim().slice(0, 60);
            target.updatedAt = now;
          } else {
            data.balances.push({
              id: uid(),
              date: targetDate,
              ...merged,
              note: noteInput.value.trim().slice(0, 60),
              createdAt: now,
              updatedAt: now
            });
          }
          const saved = persist();
          closeSheet();
          renderCurrent();
          if (!saved) {
            showToast("余额已记在本次页面，但本机保存失败，请立即导出备份", { duration: 6200 });
          } else {
            showToast(duplicate || editing ? "余额记录已更新" : "已记下本次余额");
          }
        });

        const deleteButton = $("#deleteBalance");
        if (deleteButton) {
          deleteButton.addEventListener("click", async () => {
            const confirmed = await askDialog({
              title: "删除这次余额快照？",
              message: "将删除「" + formatDateCN(existing.date, { year: true }) + " · " + money(totalBalance(existing) / 100) + "」。",
              icon: "i-trash",
              tone: "danger",
              actions: [
                { label: "保留", value: false, kind: "ghost" },
                { label: "删除", value: true, kind: "danger" }
              ]
            });
            if (!confirmed) return;
            createAutoBackup("删除余额前", true);
            const index = data.balances.findIndex((snapshot) => snapshot.id === existing.id);
            if (index < 0) {
              showToast("这条记录已经不存在了");
              return;
            }
            const removed = data.balances[index];
            data.balances.splice(index, 1);
            const saved = persist();
            closeSheet();
            renderCurrent();
            showToast(saved ? "已删除这次余额快照" : "已从页面删除，但本机保存失败", {
              actionLabel: "撤销",
              duration: 7000,
              onAction: () => {
                data.balances.push(removed);
                persist();
                renderCurrent();
                showToast("已恢复这次快照");
              }
            });
          });
        }
      }
    });
  }
  /* ============================================================
     Data centre, export & import
     ============================================================ */

  function dataActionMarkup(config) {
    return '<button class="data-action' + (config.recommended ? " is-recommended" : "") + '" type="button" data-action="' +
      escapeAttr(config.action) + '">' +
      '<span class="data-action-icon ' + (config.iconClass || "") + '">' +
        '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#' + config.icon + '"/></svg>' +
      "</span>" +
      '<span class="data-action-text"><strong>' + escapeHTML(config.title) + "</strong><span>" + escapeHTML(config.description) + "</span></span>" +
      (config.recommended ? '<span class="recommended-flag">推荐</span>' : "") +
      '<svg class="icon icon-chevron" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-right"/></svg>' +
      "</button>";
  }

  function openDataSheet() {
    const backups = readAutoBackups();
    const lastExportText = data.lastExportAt
      ? timeAgo(data.lastExportAt) + "（" + dateTimeLabel(data.lastExportAt) + "）"
      : "还没有导出过";
    const statusTitle = storageOK ? "数据只保存在这台设备" : "本地存储暂不可用";
    const statusText = storageOK
      ? "已保存 " + data.transactions.length + " 笔流水、" + data.balances.length + " 次余额。" +
        (data.lastExportAt ? "备份时间：" + lastExportText + "。" : "还没有导出过备份。")
      : "关闭页面后，这次填写的内容可能会丢失。请马上导出备份。";

    const autoText = backups.length
      ? "共 " + backups.length + " 份 · 最近 " + timeAgo(backups[0].at) + "（" + (backups[0].reason || "自动") + "）"
      : "打开账本或重要操作前会自动留一份，最多保留 6 份。";

    const body = '<div class="data-status' + (storageOK ? "" : " is-error") + '">' +
        '<div class="data-status-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#' +
          (storageOK ? "i-shield" : "i-alert") + '"/></svg></div>' +
        "<div><strong>" + escapeHTML(statusTitle) + "</strong><p>" + escapeHTML(statusText) + "</p></div>" +
      "</div>" +
      '<div class="data-metrics">' +
        '<div class="data-metric"><b>' + data.transactions.length + "</b><span>笔流水</span></div>" +
        '<div class="data-metric"><b>' + data.balances.length + "</b><span>次余额</span></div>" +
        '<div class="data-metric"><b>' + backups.length + "</b><span>本机副本</span></div>" +
      "</div>" +

      '<div class="data-section-title"><span>备份与恢复</span></div>' +
      '<div class="data-actions">' +
        dataActionMarkup({
          action: "import-data",
          icon: "i-upload",
          title: "导入完整备份（JSON）",
          description: "选择导出的 JSON，预览后合并或覆盖账本",
          iconClass: "upload"
        }) +
        dataActionMarkup({
          action: "export-json",
          icon: "i-download",
          title: "完整备份（JSON）",
          description: "导出流水、余额、账户、分类和设置",
          recommended: true
        }) +
        dataActionMarkup({
          action: "export-csv",
          icon: "i-list",
          title: "导出流水 CSV",
          description: "可以用 Excel / WPS 打开查看",
          iconClass: ""
        }) +
        dataActionMarkup({
          action: "export-balances",
          icon: "i-wallet",
          title: "导出余额 CSV",
          description: "各账户的余额快照和合计",
          iconClass: ""
        }) +
        dataActionMarkup({
          action: "copy-json",
          icon: "i-copy",
          title: "复制备份文本",
          description: "下载不方便时，复制到微信收藏或备忘录",
          iconClass: "copy"
        }) +
      "</div>" +

      '<div class="data-section-title"><span>记账设置</span></div>' +
      '<div class="data-actions">' +
        dataActionMarkup({
          action: "manage-accounts",
          icon: "i-wallet",
          title: "账户管理",
          description: "添加银行卡、现金等自定义账户"
        }) +
        dataActionMarkup({
          action: "manage-categories",
          icon: "i-list",
          title: "分类管理",
          description: "添加、改名、停用或恢复收入和支出分类"
        }) +
      "</div>" +

      '<div class="balance-tools">' +
        '<div class="balance-tools-label"><span>余额与流水</span><span>AUTO</span></div>' +
        '<label class="sync-row" for="autoSyncToggle">' +
          '<span class="sync-row-text"><strong>记流水时自动更新余额</strong>' +
            "<span>支出从所选账户扣款，收入加到所选账户</span></span>" +
          '<span class="switch"><input type="checkbox" id="autoSyncToggle" role="switch"' +
            (autoSyncEnabled() ? " checked" : "") + '><span class="switch-track" aria-hidden="true"></span></span></span>' +
        "</label>" +
        '<button type="button" class="data-action balance-check" data-action="fix-balance">' +
          '<span class="data-action-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-check"/></svg></span>' +
          '<span class="data-action-text"><strong>按流水校正余额</strong>' +
            "<span>从最早手记余额起按全部流水重算，修正以前「没有联动」产生的偏差</span></span>" +
          '<svg class="icon icon-chevron" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-right"/></svg>' +
        "</button>" +
      "</div>" +

      '<div class="auto-copy-box">' +
        '<div class="auto-copy-head"><span>本机自动副本</span>' +
          (backups.length ? '<button type="button" data-action="restore-autobackup">恢复最近一份</button>' : "") +
        "</div>" +
        "<p>" + escapeHTML(autoText) + "</p>" +
      "</div>" +

      '<details class="help-block">' +
        "<summary>数据存在哪里？更新页面会丢吗？</summary>" +
        '<div class="help-content">' +
          "<strong>记录保存在当前浏览器的本地存储里。</strong>不会上传到任何服务器，所以也不需要登录。" +
          "<ul>" +
            "<li>更新页面时，只要仍在<strong>同一个网址</strong>（或同一个文件位置）打开，原有记录会继续保留。</li>" +
            "<li>把 HTML 发到手机后，建议用 Safari 或 Chrome 打开；微信内置浏览器可能限制本地存储。</li>" +
            "<li>本地 HTML 在部分手机浏览器里可能不允许持久保存；长期使用最好放到一个固定网址。</li>" +
            "<li>换手机、清理浏览器数据、使用无痕模式之前，先在「完整备份」里导出 JSON。</li>" +
            "<li>每笔收支会按所选账户自动从余额里加减；以前记的流水想补上联动，用上面的「按流水校正余额」。</li>" +
            "<li>iPhone 上建议「添加到主屏幕」并定期打开；Safari 可能清理长期未访问的网站数据。</li>" +
            "<li>恢复时选「从备份导入」，合并会保留现有记录，覆盖则用备份替换当前账本。</li>" +
          "</ul>" +
          "<p style=\"margin-top:7px\">最稳妥的节奏：每周导出一次 JSON，发到微信收藏或网盘。</p>" +
        "</div>" +
      "</details>" +

      '<div class="danger-zone">' +
        '<button type="button" class="danger-link" data-action="clear-data">清空全部记录…</button>' +
      "</div>" +
      '<div class="data-version">记账本 v' + APP.version + " · 数据格式 v" + APP.schema + " · 本地优先</div>";

    openSheet({
      type: "data",
      kicker: "DATA & BACKUP",
      title: "数据与备份",
      body,
      foot: ""
    });
  }

  function refreshDataSheet() {
    if (!sheetOpen || sheetType !== "data") return;
    const body = $("#sheetBody");
    const scrollTop = body ? body.scrollTop : 0;
    openDataSheet();
    window.requestAnimationFrame(() => {
      if (body) body.scrollTop = scrollTop;
    });
  }

  function buildBackupPayload() {
    return {
      app: APP.id,
      appVersion: APP.version,
      schemaVersion: APP.schema,
      exportedAt: new Date().toISOString(),
      counts: {
        transactions: data.transactions.length,
        balances: data.balances.length,
        categories: data.categories.length,
        accounts: data.accounts.length
      },
      data: JSON.parse(JSON.stringify(data))
    };
  }

  function downloadFile(filename, content, mimeType) {
    // Inside the Android shell, blob downloads are not supported by WebView.
    // The shell exposes LedgerApp.saveFile, which writes to the public
    // Downloads folder through MediaStore and returns a boolean.
    if (window.LedgerApp && typeof window.LedgerApp.saveFile === "function") {
      try {
        const saved = window.LedgerApp.saveFile(
          String(filename),
          String(content),
          String(mimeType || "application/octet-stream")
        );
        return saved ? "native" : "failed";
      } catch (error) {
        return "failed";
      }
    }
    const blob = new Blob([content], { type: mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
      URL.revokeObjectURL(url);
    }, 5000);
    return "browser";
  }

  function timestampForFile() {
    const now = new Date();
    return todayISO() + "-" + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
  }

  function markExported(exportedAt) {
    data.lastExportAt = exportedAt || new Date().toISOString();
    persist({ touch: false });
    updateBackupNudge();
    updateStorageStatus();
  }

  function exportJSON() {
    if (!hasBackupData()) {
      showToast("还没有可以导出的记录");
      return;
    }
    const exportedAt = new Date().toISOString();
    const payload = buildBackupPayload();
    payload.data.lastExportAt = exportedAt;
    const filename = "sanyu-backup-" + timestampForFile() + ".json";
    const result = downloadFile(filename, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    if (result === "failed") {
      refreshDataSheet();
      return;
    }
    markExported(exportedAt);
    showToast(result === "native"
      ? "完整备份已保存到「下载」目录，建议发到微信收藏"
      : "完整备份已导出，建议发到微信收藏", { duration: 4200 });
    refreshDataSheet();
  }

  function csvEscape(value) {
    let text = String(value == null ? "" : value);
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text) && !/^-\d+(\.\d+)?$/.test(text)) {
      text = "'" + text;
    }
    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function exportTransactionsCSV() {
    if (!data.transactions.length) {
      showToast("还没有流水可以导出");
      return;
    }
    const lines = [["日期", "类型", "分类", "金额", "账户", "备注"].join(",")];
    sortedTransactions().forEach((transaction) => {
      lines.push([
        transaction.date,
        transaction.type === "income" ? "收入" : "支出",
        getCategory(transaction.type, transaction.category).name,
        (toCents(transaction.amount) / 100).toFixed(2),
        getAccount(transaction.account).name,
        transaction.note || ""
      ].map(csvEscape).join(","));
    });
    const filename = "sanyu-transactions-" + timestampForFile() + ".csv";
    const result = downloadFile(filename, "\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8");
    if (result === "failed") return;
    showToast(result === "native" ? "流水 CSV 已保存到「下载」目录" : "流水 CSV 已导出");
  }

  function exportBalancesCSV() {
    if (!data.balances.length) {
      showToast("还没有余额快照可以导出");
      return;
    }
    const ledgerAccounts = accounts();
    const lines = [["日期", ...ledgerAccounts.map(({ name }) => name), "合计", "备注"].map(csvEscape).join(",")];
    sortedBalances().forEach((snapshot) => {
      lines.push([
        snapshot.date,
        ...ledgerAccounts.map(({ id }) => snapshot[id] === undefined ? "" : (toCents(snapshot[id]) / 100).toFixed(2)),
        (totalBalance(snapshot) / 100).toFixed(2),
        snapshot.note || ""
      ].map(csvEscape).join(","));
    });
    const filename = "sanyu-balances-" + timestampForFile() + ".csv";
    const result = downloadFile(filename, "\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8");
    if (result === "failed") return;
    showToast(result === "native" ? "余额 CSV 已保存到「下载」目录" : "余额 CSV 已导出");
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      /* Fall back below. */
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let success = false;
    try {
      success = document.execCommand("copy");
    } catch (error) {
      success = false;
    }
    document.body.removeChild(textarea);
    return success;
  }

  async function copyBackupText() {
    if (!hasBackupData()) {
      showToast("还没有可以备份的记录");
      return;
    }
    const exportedAt = new Date().toISOString();
    const payload = buildBackupPayload();
    payload.data.lastExportAt = exportedAt;
    const text = JSON.stringify(payload, null, 2);
    const copied = await copyText(text);
    if (!copied) {
      showToast("复制失败，请改用「完整备份（JSON）」下载");
      return;
    }
    markExported(exportedAt);
    showToast("备份内容已复制，可以粘贴到微信收藏或备忘录", { duration: 4600 });
    refreshDataSheet();
  }

  function readFileText(file) {
    if (file && typeof file.text === "function") {
      return file.text();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("读取失败"));
      reader.readAsText(file);
    });
  }

  async function handleImportFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast("文件超过 10 MB，暂不支持导入");
      return;
    }
    let imported;
    try {
      const text = (await readFileText(file)).replace(/^\uFEFF/, "");
      imported = normalizeData(JSON.parse(text));
    } catch (error) {
      showToast("无法读取这份备份，请确认是「完整备份（JSON）」文件");
      return;
    }
    if (!(imported.transactions.length || imported.balances.length || imported.categories.length || imported.accounts.length)) {
      showToast("这份备份里没有流水、余额、自定义账户或分类");
      return;
    }

    const dateCandidates = imported.transactions.map((item) => item.date)
      .concat(imported.balances.map((item) => item.date))
      .sort();
    const firstDate = dateCandidates[0];
    const lastDate = dateCandidates[dateCandidates.length - 1];
    const dateRange = firstDate
      ? "，时间范围 " + escapeHTML(formatDateCN(firstDate, { year: true })) +
        " 至 " + escapeHTML(formatDateCN(lastDate, { year: true }))
      : "";
    const result = await askDialog({
      title: "导入这份备份？",
      message: "备份包含 <strong>" + imported.transactions.length + " 笔流水</strong>、<strong>" +
        imported.balances.length + " 次余额</strong>、<strong>" + imported.accounts.length +
        " 个自定义账户</strong>和 <strong>" + imported.categories.length + " 个自定义分类</strong>" + dateRange +
        "。\n\n合并：保留现有账本，补充缺少的记录、账户和分类。\n覆盖：用备份替换当前账本和设置。",
      icon: "i-upload",
      actions: [
        { label: "取消", value: "cancel", kind: "ghost" },
        { label: "合并到当前账本", value: "merge", kind: "secondary" },
        { label: "覆盖当前账本", value: "replace", kind: "danger" }
      ]
    });
    if (!result || result === "cancel") return;

    createAutoBackup("导入前", true);
    const previous = data;
    let message;
    if (result === "replace") {
      data = imported;
      message = "已用备份覆盖当前账本";
    } else {
      data = mergeImported(imported);
      message = "已合并：" + (data.transactions.length - previous.transactions.length) + " 笔流水、" +
        (data.balances.length - previous.balances.length) + " 次余额、" +
        (data.accounts.length - previous.accounts.length) + " 个账户、" +
        (data.categories.length - previous.categories.length) + " 个分类";
    }
    if (!persist()) {
      data = previous;
      refreshDataSheet();
      showToast("导入未保存，当前账本已保留。请检查本机存储后重试。", { duration: 6200 });
      return;
    }
    closeSheet();
    renderCurrent();
    showToast(message, { duration: 4200 });
  }

  function mergeImported(imported) {
    const merged = {
      ...data,
      accounts: data.accounts.slice(),
      categories: data.categories.slice(),
      transactions: data.transactions.slice()
    };
    const accountIds = new Set(merged.accounts.map(({ id }) => id));
    const accountNames = new Set(accounts().map(({ name }) => nameKey(name)));
    for (const account of imported.accounts) {
      if (accountIds.has(account.id)) continue;
      let name = account.name;
      for (let number = 2; accountNames.has(nameKey(name)); number += 1) {
        const suffix = " (" + number + ")";
        name = account.name.slice(0, CATEGORY_NAME_LIMIT - suffix.length) + suffix;
      }
      merged.accounts.push(customAccount(account.id, name));
      accountIds.add(account.id);
      accountNames.add(nameKey(name));
    }
    const categoryIds = new Map();
    for (const category of imported.categories) {
      const matches = merged.categories.filter((item) => item.type === category.type);
      const local = matches.find((item) => item.id === category.id) ||
        matches.find((item) => nameKey(item.name) === nameKey(category.name));
      if (!local) merged.categories.push(category);
      categoryIds.set(category.type + ":" + category.id, local ? local.id : category.id);
    }
    const existingTransactionIds = new Set(data.transactions.map((transaction) => transaction.id));
    const balancesByDate = new Map(data.balances.map((snapshot) => [snapshot.date, snapshot]));
    imported.transactions.forEach((transaction) => {
      if (!existingTransactionIds.has(transaction.id)) {
        const category = categoryIds.get(transaction.type + ":" + transaction.category) || transaction.category;
        merged.transactions.push({ ...transaction, category });
        existingTransactionIds.add(transaction.id);
      }
    });
    imported.balances.forEach((snapshot) => {
      const local = balancesByDate.get(snapshot.date);
      if (!local) {
        balancesByDate.set(snapshot.date, snapshot);
        return;
      }
      const extra = imported.accounts.filter(({ id }) => local[id] === undefined && snapshot[id] !== undefined);
      if (extra.length) {
        const supplemented = { ...local };
        extra.forEach(({ id }) => { supplemented[id] = snapshot[id]; });
        balancesByDate.set(snapshot.date, supplemented);
      }
    });
    merged.balances = Array.from(balancesByDate.values());
    if (imported.lastExportAt && (!data.lastExportAt || imported.lastExportAt > data.lastExportAt)) {
      merged.lastExportAt = imported.lastExportAt;
    }
    return merged;
  }

  async function restoreAutoBackup() {
    const backups = readAutoBackups();
    if (!backups.length) {
      showToast("还没有本机自动副本");
      return;
    }
    const latest = backups[0];
    let restored;
    try {
      restored = normalizeData(JSON.parse(latest.raw));
    } catch (error) {
      showToast("这份自动副本已损坏，无法恢复");
      return;
    }
    const confirmed = await askDialog({
      title: "恢复最近的本机副本？",
      message: "副本时间：" + escapeHTML(dateTimeLabel(latest.at)) + "，包含 " +
        restored.transactions.length + " 笔流水、" + restored.balances.length + " 次余额、" +
        restored.accounts.length + " 个自定义账户和 " + restored.categories.length + " 个自定义分类。\n当前账本会先另存一份。",
      icon: "i-database",
      actions: [
        { label: "取消", value: false, kind: "ghost" },
        { label: "恢复副本", value: true, kind: "danger" }
      ]
    });
    if (!confirmed) return;
    createAutoBackup("恢复副本前", true);
    data = restored;
    const saved = persist();
    closeSheet();
    renderCurrent();
    showToast(saved ? "已恢复本机副本" : "已恢复，但本机保存失败，请导出备份");
  }

  async function clearAllData() {
    const confirmed = await askDialog({
      title: "清空全部记录？",
      message: "将删除 <strong>" + data.transactions.length + " 笔流水</strong>和 <strong>" +
        data.balances.length + " 次余额</strong>。本机自动副本会保留，但仍建议先导出 JSON。",
      icon: "i-trash",
      tone: "danger",
      actions: [
        { label: "取消", value: false, kind: "ghost" },
        { label: "清空记录", value: true, kind: "danger" }
      ]
    });
    if (!confirmed) return;
    createAutoBackup("清空账本前", true);
    data = { ...defaultData(), accounts: data.accounts, categories: data.categories };
    persist();
    closeSheet();
    renderCurrent();
    showToast("账本已清空，本机自动副本仍保留", {
      actionLabel: "查看备份",
      duration: 7000,
      onAction: openDataSheet
    });
  }

  /* ============================================================
     Dialog & toast
     ============================================================ */

  function askDialog(config) {
    if (dialogOpen) {
      return Promise.resolve(null);
    }
    const backdrop = $("#dialogBackdrop");
    const dialog = $("#dialog");
    const icon = $("#dialogIcon");
    const title = $("#dialogTitle");
    const message = $("#dialogMessage");
    const actions = $("#dialogActions");
    if (!backdrop || !dialog || !icon || !title || !message || !actions) {
      return Promise.resolve(null);
    }

    dialogLastFocus = document.activeElement;
    icon.className = "dialog-icon" + (config.tone === "danger" ? " is-danger" : "");
    icon.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#' + (config.icon || "i-alert") + '"/></svg>';
    title.textContent = config.title || "确认";
    message.innerHTML = config.message || "";
    actions.innerHTML = "";
    (config.actions || [{ label: "知道了", value: true, kind: "ghost" }]).forEach((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn " + (action.kind === "danger" ? "btn-danger" : action.kind === "ghost" ? "btn-ghost" : "btn-secondary");
      button.textContent = action.label;
      button.addEventListener("click", () => settleDialog(action.value));
      actions.appendChild(button);
    });

    dialogOpen = true;
    backdrop.hidden = false;
    updateBodyLock();
    window.requestAnimationFrame(() => {
      backdrop.classList.add("is-open");
      const firstButton = $("button", actions);
      if (firstButton) firstButton.focus({ preventScroll: true });
    });

    return new Promise((resolve) => {
      dialogResolve = resolve;
    });
  }

  function settleDialog(value) {
    if (!dialogOpen) return;
    const backdrop = $("#dialogBackdrop");
    const resolve = dialogResolve;
    const restoreTarget = dialogLastFocus;
    dialogOpen = false;
    dialogResolve = null;
    dialogLastFocus = null;
    if (backdrop) {
      backdrop.classList.remove("is-open");
    }
    updateBodyLock();
    window.setTimeout(() => {
      if (!dialogOpen && backdrop) {
        backdrop.hidden = true;
      }
    }, 220);
    if (resolve) {
      resolve(value);
    }
    if (restoreTarget && document.contains(restoreTarget)) {
      window.setTimeout(() => {
        try {
          restoreTarget.focus({ preventScroll: true });
        } catch (error) {
          /* ignore */
        }
      }, 60);
    }
  }

  function showToast(message, options) {
    const toast = $("#toast");
    const text = $("#toastMessage");
    const action = $("#toastAction");
    if (!toast || !text || !action) return;
    const opts = options || {};
    window.clearTimeout(toastTimer);
    text.textContent = message;
    if (opts.actionLabel) {
      action.hidden = false;
      action.textContent = opts.actionLabel;
      action.onclick = () => {
        hideToast();
        if (typeof opts.onAction === "function") opts.onAction();
      };
    } else {
      action.hidden = true;
      action.textContent = "";
      action.onclick = null;
    }
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(hideToast, opts.duration || (opts.actionLabel ? 6500 : 3200));
  }

  function hideToast() {
    const toast = $("#toast");
    if (toast) toast.classList.remove("is-visible");
    window.clearTimeout(toastTimer);
  }

  /* ============================================================
     Event wiring & boot
     ============================================================ */

  const handleChartResize = debounce(() => {
    if (ui.view === "home") renderHomeChart();
    else if (ui.view === "balance") renderBalance();
    else if (ui.view === "report") renderReport();
  }, 160);

  function handleAction(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    switch (action) {
      case "switch-view":
        event.preventDefault();
        switchView(target.dataset.view);
        break;
      case "open-tx":
        event.preventDefault();
        openTxSheet();
        break;
      case "edit-tx":
        event.preventDefault();
        if (target.closest("[data-action='restore-balance']")) break;
        openTxSheet(id);
        break;
      case "delete-tx":
        event.preventDefault();
        event.stopPropagation();
        deleteTransactionById(id);
        break;
      case "restore-balance":
        event.preventDefault();
        event.stopPropagation();
        restoreBalanceForTransaction(id);
        break;
      case "open-balance":
        event.preventDefault();
        openBalanceSheet();
        break;
      case "edit-balance":
        event.preventDefault();
        openBalanceSheet(id);
        break;
      case "open-data":
        event.preventDefault();
        openDataSheet();
        break;
      case "manage-categories":
        openCategorySheet();
        break;
      case "manage-accounts":
        openAccountSheet();
        break;
      case "close-sheet":
        event.preventDefault();
        closeSheet();
        break;
      case "go-all-ledger":
        event.preventDefault();
        ui.ledgerAll = true;
        ui.ledgerType = "all";
        switchView("ledger");
        break;
      case "ledger-prev":
        if (!ui.ledgerAll) {
          ui.ledgerMonth = addMonths(ui.ledgerMonth, -1);
          renderLedger();
        }
        break;
      case "ledger-next":
        if (!ui.ledgerAll && ui.ledgerMonth < currentMonthKey()) {
          ui.ledgerMonth = addMonths(ui.ledgerMonth, 1);
          renderLedger();
        }
        break;
      case "ledger-all":
        ui.ledgerAll = !ui.ledgerAll;
        if (!ui.ledgerAll) {
          ui.ledgerMonth = currentMonthKey();
        }
        renderLedger();
        break;
      case "filter-type":
        ui.ledgerType = target.dataset.type || "all";
        renderLedger();
        break;
      case "balance-series":
        ui.balanceSeries = target.dataset.series || "total";
        renderBalance();
        break;
      case "report-prev":
        ui.reportMonth = addMonths(ui.reportMonth, -1);
        renderReport();
        break;
      case "report-next":
        if (ui.reportMonth < currentMonthKey()) {
          ui.reportMonth = addMonths(ui.reportMonth, 1);
          renderReport();
        }
        break;
      case "report-current":
        ui.reportMonth = currentMonthKey();
        renderReport();
        break;
      case "report-range":
        ui.reportRange = Number(target.dataset.range) === 6 ? 6 : 12;
        renderReport();
        break;
      case "export-json":
        exportJSON();
        break;
      case "export-csv":
        exportTransactionsCSV();
        break;
      case "export-balances":
        exportBalancesCSV();
        break;
      case "copy-json":
        copyBackupText();
        break;
      case "import-data": {
        const input = $("#importInput");
        if (input) {
          input.value = "";
          input.click();
        }
        break;
      }
      case "restore-autobackup":
        restoreAutoBackup();
        break;
      case "fix-balance":
        fixBalanceDrift();
        break;
      case "clear-data":
        clearAllData();
        break;
      default:
        break;
    }
  }

  function bindStaticEvents() {
    document.addEventListener("click", handleAction);

    const sheetBackdrop = $("#sheetBackdrop");
    if (sheetBackdrop) {
      sheetBackdrop.addEventListener("click", (event) => {
        if (event.target === sheetBackdrop) closeSheet();
      });
    }
    const dialogBackdrop = $("#dialogBackdrop");
    if (dialogBackdrop) {
      dialogBackdrop.addEventListener("click", (event) => {
        if (event.target === dialogBackdrop) settleDialog(null);
      });
    }
    const importInput = $("#importInput");
    if (importInput) {
      importInput.addEventListener("change", (event) => {
        const file = event.target.files && event.target.files[0];
        event.target.value = "";
        if (file) handleImportFile(file);
      });
    }
    document.addEventListener("change", (event) => {
      const toggle = event.target.closest("#autoSyncToggle");
      if (!toggle) return;
      data.settings.autoSync = Boolean(toggle.checked);
      persist();
      showToast(toggle.checked
        ? "已开启：记流水时自动更新对应账户余额"
        : "已关闭：余额只按手动记录更新", { duration: 3600 });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (dialogOpen) {
          event.preventDefault();
          settleDialog(null);
        } else if (sheetOpen) {
          event.preventDefault();
          closeSheet();
        }
      }
    });

    window.addEventListener("resize", handleChartResize);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (ui.today !== todayISO()) {
        ui.today = todayISO();
        renderDateLine();
        renderCurrent();
      }
    });

    window.addEventListener("beforeunload", (event) => {
      if (!storageOK && hasBackupData()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }

  function init() {
    bindStaticEvents();
    renderDateLine();
    const hashView = window.location.hash ? window.location.hash.replace("#", "") : "";
    const startView = VIEWS.includes(hashView) ? hashView : "home";
    switchView(startView, { scroll: false, history: false, instant: true });
    try {
      window.history.replaceState(null, "", "#" + startView);
    } catch (error) {
      /* ignore */
    }
    updateStorageStatus();
    updateBackupNudge();
    createAutoBackup("打开账本");
    if (pendingNotice) {
      window.setTimeout(() => showToast(pendingNotice, { duration: 6000 }), 500);
    }
    if (navigator.storage && typeof navigator.storage.persist === "function") {
      try {
        navigator.storage.persist().catch(() => {});
      } catch (error) {
        /* ignore */
      }
    }
  }

  init();
})();


















