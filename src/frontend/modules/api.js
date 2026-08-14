import { state } from "./state.js";
import { showLoader, hideLoader, showNotificationToast, hasUiPermission, firstAllowedView, canUseView } from "./utils.js";

const apiCache = new Map();

export function logConnectionError(type, err, statusCode = null) {
  let code = "UNKNOWN";
  let message = "An unknown error occurred.";
  
  if (err) {
    if (typeof err === "string") {
      message = err;
    } else {
      message = err.message || String(err);
    }
  }

  if (statusCode) {
    code = `HTTP_${statusCode}`;
    if (statusCode === 401) message = "Unauthorized Session (401). Please re-login.";
    else if (statusCode === 403) message = "Forbidden (403). You do not have permissions for this resource.";
    else if (statusCode === 404) message = "Resource Not Found (404). Check API endpoint.";
    else if (statusCode === 500) message = "Internal Server Error (500). The database or server experienced a fault.";
    else if (statusCode === 503) message = "Service Unavailable (503). Server overloaded or offline.";
  } else if (err && err.name === "AbortError") {
    code = "TIMEOUT";
    message = "Request timed out. Please check your mobile hotspot/cellular signal strength.";
  } else if (message.toLowerCase().includes("failed to fetch") || message.toLowerCase().includes("networkerror")) {
    code = "DNS_OR_NETWORK_FAIL";
    message = "Network connection failed. This usually indicates a DNS resolution failure, cellular disconnection, or no internet data on your mobile hotspot.";
  } else if (!navigator.onLine) {
    code = "DEVICE_OFFLINE";
    message = "Browser reports device is completely offline. Verify hotspot tethering/cellular status.";
  } else if (message.toLowerCase().includes("offline mode")) {
    code = "MANUAL_OFFLINE";
    message = "Manual offline mode is active. Server synchronization and live requests are suspended.";
  }

  const logEntry = {
    timestamp: new Date().toLocaleTimeString(),
    type,
    code,
    message
  };

  state.connectionLogs = [logEntry, ...(state.connectionLogs || [])].slice(0, 30);
  localStorage.setItem("basha_connection_logs", JSON.stringify(state.connectionLogs));
}

export async function api(path, options = {}) {
  if (state.networkMode === "offline") {
    const offlineErr = new Error("Application is in manual Offline (Local-only) mode. Server request skipped.");
    offlineErr.status = 503;
    logConnectionError("api_error", offlineErr, 503);
    throw offlineErr;
  }

  const method = options.method || "GET";
  if (method !== "GET") {
    apiCache.clear();
  }
  const useCache = method === "GET" && !options.noCache;
  const cacheKey = `${path}_${JSON.stringify(options.headers || {})}`;
  
  if (useCache && apiCache.has(cacheKey)) {
    const cached = apiCache.get(cacheKey);
    const age = Date.now() - cached.timestamp;
    if (age < 3000) {
      return Promise.resolve(JSON.parse(JSON.stringify(cached.data)));
    }
  }

  const { showLoader: showVisual = true, ...restOptions } = options;
  if (showVisual) {
    showLoader();
  }
  try {
    let response;
    let attempts = 0;
    const maxAttempts = 3;
    let retryDelay = 300;

    while (attempts < maxAttempts) {
      try {
        response = await fetch(path, {
          ...restOptions,
          headers: {
            "content-type": "application/json",
            ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
            ...(options.headers || {})
          }
        });
        break; // Success
      } catch (err) {
        attempts++;
        if (attempts >= maxAttempts) {
          throw err;
        }
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        retryDelay *= 2.5;
      }
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const err = new Error("Server communication issue. Please check your mobile hotspot/internet connection or retry.");
      logConnectionError("api_error", err);
      throw err;
    }
    const resText = await response.text();
    let payload = {};
    if (resText) {
      try {
        payload = JSON.parse(resText);
      } catch (pErr) {
        const err = new Error("Invalid response format from server. Please retry.");
        logConnectionError("api_error", err);
        throw err;
      }
    }
    if (!response.ok) {
      const err = new Error(payload.error || "Request failed");
      logConnectionError("api_error", err, response.status);
      throw err;
    }
    
    if (useCache) {
      apiCache.set(cacheKey, {
        timestamp: Date.now(),
        data: payload
      });
    }
    
    return payload;
  } catch (err) {
    let statusCode = err.status || null;
    if (err.name !== "AbortError" && !err.message.toLowerCase().includes("offline mode")) {
      logConnectionError("api_error", err, statusCode);
    }
    if (err.name === "AbortError" || err.message.toLowerCase().includes("timeout")) {
      throw new Error("Request timed out. Please check your mobile hotspot/internet speed and stability, then try again.");
    }
    if (!navigator.onLine) {
      throw new Error("Device is completely offline. Please check your Wi-Fi, cellular, or mobile hotspot connection.");
    }
    if (err instanceof TypeError || err.message.toLowerCase().includes("failed to fetch") || err.message.toLowerCase().includes("networkerror")) {
      throw new Error("No response from server. You are connected to a network (like a mobile hotspot or Wi-Fi), but there is no actual internet access, or the server is temporarily down. Please check your hotspot data or cellular connection.");
    }
    throw err;
  } finally {
    if (showVisual) {
      hideLoader();
    }
  }
}

export async function syncClock() {
  const t0 = Date.now();
  try {
    const res = await api("/api/time-sync");
    const t2 = Date.now();
    const serverTime = res.serverTime;
    const rtt = t2 - t0;
    const offset = Math.round(serverTime - (t0 + rtt / 2));
    state.serverTimeOffset = offset;
    localStorage.setItem("basha_server_time_offset", offset);
    state.lastClockSync = new Date().toISOString();
    localStorage.setItem("basha_last_clock_sync", state.lastClockSync);
    return { success: true, offset, rtt };
  } catch (error) {
    console.error("Failed to sync clock with server", error);
    return { success: false, error: error.message };
  }
}

export async function refreshOperationalData(isBackground = false, renderFn = null) {
  if (!isBackground) {
    state.isLoadingDashboardAndReports = true;
    if (renderFn) renderFn();
  }
  const opt = isBackground ? { showLoader: false } : {};
  try {
    const [orders, kots, inventory, stockUsages, summary, expenses, supplierBills, supplierOrders, bills, performance, profit, operatingExpenses, notifications, loans, salaryPayments, portionsData, dailyPrepReport, owners, ownerDraws, dailyLedger, cancelledReports, tableOrders] = await Promise.all([
      (["pos", "tables", "dashboard", "delivery", "reports", "order-history"].includes(state.activeView)) ? api("/api/orders", opt).catch(() => state.orders || []) : Promise.resolve(state.orders || []),
      (["pos", "tables", "delivery", "kitchen", "reports"].includes(state.activeView)) ? api("/api/kots", opt).catch(() => state.kots || []) : Promise.resolve(state.kots || []),
      (!isBackground && ["inventory", "reports"].includes(state.activeView) && (hasUiPermission("inventory.view") || hasUiPermission("purchase.manage"))) ? api("/api/inventory", opt).catch(() => state.inventory) : Promise.resolve(state.inventory),
      (!isBackground && ["inventory", "reports"].includes(state.activeView) && (hasUiPermission("inventory.view") || hasUiPermission("purchase.manage"))) ? api(`/api/stock-usages?branchId=${state.activeBranchId || "all"}`, opt).catch(() => state.stockUsages) : Promise.resolve(state.stockUsages),
      (["dashboard", "reports"].includes(state.activeView) && hasUiPermission("reports.view")) ? api(`/api/reports/daily?branchId=${state.activeBranchId || "all"}&date=${state.dashboardDate}`, opt).catch(() => state.summary) : Promise.resolve(state.summary),
      (!isBackground && state.activeView === "reports" && hasUiPermission("reports.view")) ? api(`/api/reports/expenses?branchId=${state.activeBranchId || "all"}&period=month`, opt).catch(() => null) : Promise.resolve(null),
      (!isBackground && ["inventory", "masters", "reports"].includes(state.activeView) && hasUiPermission("purchase.manage")) ? api("/api/supplier-bills", opt).catch(() => state.supplierBills || []) : Promise.resolve(state.supplierBills || []),
      (!isBackground && ["inventory", "masters", "reports"].includes(state.activeView) && hasUiPermission("purchase.manage")) ? api("/api/supplier-orders", opt).catch(() => state.supplierOrders || []) : Promise.resolve(state.supplierOrders || []),
      (!isBackground && ["bills", "reports"].includes(state.activeView) && (hasUiPermission("reports.view") || hasUiPermission("pos.use") || hasUiPermission("bills.view"))) ? api(`/api/bills?branchId=${state.activeBranchId || "all"}&date=${state.dashboardDate}&period=${state.reportPeriod}`, opt).catch(() => state.bills || []) : Promise.resolve(state.bills || []),
      (["dashboard", "reports"].includes(state.activeView) && hasUiPermission("reports.view")) ? api(`/api/reports/performance?branchId=${state.activeBranchId || "all"}&date=${state.dashboardDate}&period=${state.reportPeriod}`, opt).catch(() => state.performance || []) : Promise.resolve(state.performance || []),
      (!isBackground && state.activeView === "reports" && hasUiPermission("reports.view")) ? api(`/api/reports/profit?branchId=${state.activeBranchId || "all"}&date=${state.dashboardDate}&period=${state.reportPeriod}`, opt).catch(() => null) : Promise.resolve(state.profit),
      (!isBackground && ["reports", "inventory"].includes(state.activeView) && (hasUiPermission("purchase.manage") || hasUiPermission("reports.view"))) ? api(`/api/expenses?branchId=${state.activeBranchId || "all"}&date=${state.dashboardDate}&period=${state.reportPeriod}`, opt).catch(() => state.operatingExpenses || []) : Promise.resolve(state.operatingExpenses || []),
      state.token ? api(`/api/notifications?branchId=${state.activeBranchId || "all"}`, opt).catch(() => state.notifications || []) : Promise.resolve(state.notifications || []),
      (!isBackground && state.activeView === "loans" && state.token && ["admin", "owner", "manager"].includes(state.user?.role)) ? api("/api/loans", opt).catch(() => state.loans || []) : Promise.resolve(state.loans || []),
      (!isBackground && state.activeView === "reports" && state.token && ["admin", "owner", "manager"].includes(state.user?.role)) ? api("/api/salary-payments", opt).catch(() => state.salaryPayments || []) : Promise.resolve(state.salaryPayments || []),
      (state.token && (hasUiPermission("pos.use") || hasUiPermission("kitchen.use") || hasUiPermission("reports.view") || hasUiPermission("table.use") || ["pos", "tables", "kitchen"].includes(state.activeView))) ? api("/api/menu-items/portions", opt).catch(() => null) : Promise.resolve(null),
      (!isBackground && state.activeView === "reports" && state.token && hasUiPermission("reports.view")) ? api(`/api/reports/daily-prep?date=${state.dashboardDate}&period=${state.reportPeriod}`, opt).catch(() => null) : Promise.resolve(state.dailyPrepReport || null),
      (!isBackground && ["reports", "masters"].includes(state.activeView) && state.token && ["admin", "owner", "manager"].includes(state.user?.role)) ? api("/api/owners", opt).catch(() => state.owners || []) : Promise.resolve(state.owners || []),
      (!isBackground && state.activeView === "reports" && state.token && ["admin", "owner", "manager"].includes(state.user?.role)) ? api("/api/owner-draws", opt).catch(() => state.ownerDraws || []) : Promise.resolve(state.ownerDraws || []),
      (!isBackground && state.activeView === "reports" && hasUiPermission("reports.view")) ? api(`/api/reports/daily-ledger?branchId=${state.activeBranchId || "all"}&month=${state.dashboardDate.slice(0, 7)}`, opt).catch(() => null) : Promise.resolve(state.dailyLedger),
      (!isBackground && state.activeView === "reports" && (hasUiPermission("reports.view") || hasUiPermission("pos.use"))) ? api(`/api/reports/cancellations?branchId=${state.activeBranchId || "all"}`, opt).catch(() => null) : Promise.resolve(null),
      (hasUiPermission("table.use") || hasUiPermission("pos.use") || hasUiPermission("reports.view")) ? api("/api/table-orders", opt).catch(() => state.tableOrders || []) : Promise.resolve(state.tableOrders || [])
    ]);
    state.orders = orders || [];
    state.kots = kots || [];
    state.inventory = inventory || [];
    state.stockUsages = stockUsages || [];
    state.summary = summary || state.summary;
    if (expenses) state.expenses = expenses;
    if (supplierBills) state.supplierBills = supplierBills;
    if (supplierOrders) state.supplierOrders = supplierOrders;
    state.bills = bills || [];
    state.performance = performance || [];
    state.operatingExpenses = operatingExpenses || [];
    state.notifications = notifications || [];
    if (profit) state.profit = profit;
    state.loans = loans || [];
    state.salaryPayments = salaryPayments || [];
    state.owners = owners || [];
    state.ownerDraws = ownerDraws || [];
    if (dailyLedger) state.dailyLedger = dailyLedger;
    state.cancelledReports = cancelledReports || state.cancelledReports || { orders: [], tables: [] };
    if (portionsData) {
      state.menuItems = portionsData.menuItems || state.menuItems;
      state.categories = portionsData.categories || state.categories;
      state.portionsInitializedToday = portionsData.portionsInitializedToday !== undefined ? portionsData.portionsInitializedToday : state.portionsInitializedToday;
    }
    state.dailyPrepReport = dailyPrepReport || { trend: [], itemSummary: [] };
    if (tableOrders) {
      state.tableOrders = tableOrders;
    }
    if (!isBackground && state.activeView === "reports" && hasUiPermission("reports.view")) {
      state.menuProfitability = await api(`/api/reports/menu-profitability?branchId=${state.activeBranchId || "all"}&date=${state.dashboardDate}&period=${state.reportPeriod}`, opt).catch(() => []);
    }
  } finally {
    state.isLoadingDashboardAndReports = false;
    if (!isBackground) {
      if (renderFn) renderFn();
    }
  }
}

export async function refreshMasters(isBackground = false) {
  const opt = isBackground ? { showLoader: false } : {};
  const payload = await api("/api/bootstrap", opt);
  state.user = payload.user;
  state.group = payload.group;
  state.taxRates = payload.taxRates || [];
  state.branches = payload.branches;
  state.categories = payload.categories;
  state.menuItems = payload.menuItems;
  state.suppliers = payload.suppliers;
  state.inventory = payload.inventory;
  state.ingredientYields = payload.ingredientYields || [];
  state.menuItemConsumptions = payload.menuItemConsumptions || [];
  state.roles = payload.roles;
  state.users = payload.users;
}

export async function loadPublicLandingSettings() {
  return api("/api/public/landing-settings")
    .then((payload) => {
      state.landingPageSettings = payload;
    })
    .catch((err) => {
      console.warn("Could not load landing settings:", err);
    });
}

export async function loadPublicMenu() {
  try {
    const payload = await api("/api/public/menu", { noCache: true });
    state.publicMenu = payload;
    if (!state.customerBranchId && payload.branches?.length > 0) {
      state.customerBranchId = payload.branches[0].id;
    }
  } catch (err) {
    console.warn("Could not load public menu:", err);
  }
}

export async function syncOfflineOrders(force = false) {
  if (!force && !navigator.onLine) return;
  if (state.networkMode === "offline") return;

  const queue = (() => {
    try {
      return JSON.parse(localStorage.getItem("offline_orders_queue") || "[]");
    } catch (e) {
      return [];
    }
  })();
  if (queue.length === 0) return;

  try {
    const payload = {
      deltas: queue.map(order => ({
        id: order.id,
        billNo: order.billNo,
        branchId: order.branchId,
        orderType: order.orderType,
        tableNo: order.tableNo,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        deliveryAddress: order.deliveryAddress,
        deliveryFee: order.deliveryFee,
        items: order.lines.map(line => ({ menuItemId: line.menuItemId, quantity: line.quantity })),
        discountPercent: order.discountPercent,
        payments: order.payments,
        createdAt: order.createdAt
      }))
    };

    const response = await api("/api/orders/sync-deltas", {
      method: "POST",
      body: JSON.stringify(payload),
      showLoader: false
    });

    const results = response.results || [];
    const remaining = [];
    let syncedCount = 0;
    let duplicateCount = 0;

    queue.forEach(order => {
      const match = results.find(r => r.id === order.id);
      if (match) {
        if (match.status === "success") {
          syncedCount++;
        } else if (match.status === "ignored_duplicate") {
          duplicateCount++;
        } else {
          order.error = match.error || "Validation failed on server";
          remaining.push(order);
        }
      } else {
        remaining.push(order);
      }
    });

    localStorage.setItem("offline_orders_queue", JSON.stringify(remaining));

    if (syncedCount > 0 || duplicateCount > 0) {
      const successMsg = `🔄 Differential Sync Completed: successfully synchronized ${syncedCount} offline orders${duplicateCount > 0 ? ` (${duplicateCount} duplicate(s) bypassed)` : ""}!`;
      showNotificationToast(successMsg);
      await refreshOperationalData(true).catch(() => {});
    }
  } catch (e) {
    console.warn("[Offline Sync] Failed:", e);
  }
}
