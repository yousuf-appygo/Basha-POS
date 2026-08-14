import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { gzipSync } from "node:zlib";
import { GoogleGenAI } from "@google/genai";

export const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map((item) => item.trim()).filter(Boolean);
export let apiQueue = Promise.resolve();

export function withApiLock(handler) {
  const run = apiQueue.then(handler, handler);
  apiQueue = run.catch(() => {});
  return run;
}

export function applySecurityHeaders(req, res) {
  if (!res) return;
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self';");
  const origin = req?.headers?.origin;
  if (origin && (allowedOrigins.includes(origin) || allowedOrigins.includes("*"))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  }
}

export function sendJson(res, status, payload) {
  applySecurityHeaders(null, res);
  const body = JSON.stringify(payload);
  // Node attaches the originating request to res.req, so we can gzip large
  // report/order payloads without changing every sendJson() call site.
  // Compressing small payloads isn't worth the CPU, so only bother above ~1KB.
  const acceptEncoding = res.req?.headers?.["accept-encoding"] || "";
  if (body.length > 1024 && acceptEncoding.includes("gzip")) {
    const compressed = gzipSync(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-encoding": "gzip",
      "content-length": compressed.length
    });
    return res.end(compressed);
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

export async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function currentBusinessDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function getBusinessDateKey(val) {
  if (!val) return "";
  const str = String(val).trim();
  const match = str.match(/\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  } catch (e) {}
  return str.substring(0, 10);
}

export function getNextDailyOrderNo(db, branchId, dateText) {
  const targetDate = getBusinessDateKey(dateText) || currentBusinessDate();
  const todayKots = (db.kots || []).filter(
    (k) => k.branchId === branchId && getBusinessDateKey(k.createdAt) === targetDate
  );
  let maxNo = 100;
  for (const kot of todayKots) {
    if (kot.dailyOrderNo && kot.dailyOrderNo > maxNo) {
      maxNo = kot.dailyOrderNo;
    }
  }
  return maxNo + 1;
}

export function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function sanitizeUser(user) {
  const { password, passwordHash, ...safeUser } = user;
  return safeUser;
}

export function isPasswordHash(value) {
  return String(value || "").startsWith("$2a$") || String(value || "").startsWith("$2b$") || String(value || "").startsWith("$2y$");
}

export async function passwordMatches(password, user) {
  const stored = user.passwordHash || user.password || "";
  if (!stored) return false;
  if (isPasswordHash(stored)) return bcrypt.compare(String(password), stored);
  return stored === String(password);
}

export function authorize(db, req) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return null;
  const session = db.sessions.find((item) => item.token === token);
  if (!session) return null;
  const user = db.users.find((item) => item.id === session.userId && item.active);
  return user ? sanitizeUser(user) : null;
}

export function canAccessBranch(user, branchId) {
  return ["admin", "owner"].includes(user.role) || user.branchIds.includes(branchId);
}

export function canManageMasters(user) {
  return user.role === "admin";
}

export function userPermissions(db, user) {
  const role = (db.roles || []).find((item) => item.name === user.role && item.active !== false);
  return role?.permissions || [];
}

export function hasPermission(db, user, permission) {
  const permissions = userPermissions(db, user);
  return user.role === "admin" || permissions.includes("*") || permissions.includes(permission);
}

export function assertAdmin(user, res) {
  if (canManageMasters(user)) return true;
  sendJson(res, 403, { error: "Admin access required" });
  return false;
}

export function requireText(value, field) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

export function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

const stockUnitMap = {
  kg: { kg: 1, g: 0.001 },
  litre: { litre: 1, ml: 0.001 },
  ltr: { ltr: 1, ml: 0.001 },
  pcs: { pcs: 1 },
  piece: { piece: 1, pcs: 1 },
  packet: { packet: 1 },
  bottle: { bottle: 1 },
  box: { box: 1 }
};

export function convertStockUsage(quantity, fromUnit, stockUnit) {
  const normalizedStockUnit = String(stockUnit || "").trim().toLowerCase();
  const normalizedFromUnit = String(fromUnit || "").trim().toLowerCase();
  const conversions = stockUnitMap[normalizedStockUnit] || { [normalizedStockUnit]: 1 };
  const factor = conversions[normalizedFromUnit];
  if (!factor) throw new Error(`Cannot use ${fromUnit} for ${stockUnit} stock`);
  return money(Number(quantity || 0) * factor);
}

export function activeTaxRate(db) {
  if (db.taxRates && db.taxRates.length > 0) {
    const active = db.taxRates.find((item) => item.active);
    return active ? Number(active.rate) : 0;
  }
  return Number(db.group.taxRate ?? 0);
}

export function expenseSummary(db, branchId = "all", period = "month") {
  const now = new Date();
  const start = new Date(now);
  if (period === "week") start.setDate(now.getDate() - 6);
  else start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const bills = (db.supplierBills || []).filter((bill) => {
    const billDate = new Date(bill.billDate || bill.createdAt);
    return billDate >= start && (branchId === "all" || bill.branchId === branchId);
  });
  const supplierMap = new Map();
  for (const bill of bills) {
    const current = supplierMap.get(bill.supplierId) || { supplierId: bill.supplierId, amount: 0, bills: 0 };
    current.amount = money(current.amount + bill.total);
    current.bills += 1;
    supplierMap.set(bill.supplierId, current);
  }
  return {
    period,
    totalExpenses: money(bills.reduce((sum, bill) => sum + bill.total, 0)),
    paid: money(bills.reduce((sum, bill) => sum + Number(bill.paidAmount || (bill.paymentStatus === "paid" ? bill.total : 0)), 0)),
    pending: money(bills.reduce((sum, bill) => sum + Number(bill.balanceAmount ?? (bill.paymentStatus === "paid" ? 0 : bill.total)), 0)),
    supplierBreakup: [...supplierMap.values()].map((row) => ({
      ...row,
      supplierName: db.suppliers.find((supplier) => supplier.id === row.supplierId)?.name || "Unknown Supplier"
    }))
  };
}

export function determineSalaryPaymentType(db, userId, date, amount, excludePaymentId) {
  if (!db || !userId || !date) return "partial";
  
  const { start, end } = periodRange(date, "month");
  
  // Find employee
  const user = (db.users || []).find((u) => u.id === userId);
  if (!user) return "partial";
  
  const salary = Number(user.salaryAmount || 0);
  const rangeHolidays = (db.holidays || []).filter((h) => inDateRange(h.holidayDate, start, end));
  const closureCount = rangeHolidays.filter((h) => h.type === "closure").length;
  
  const baseDate = new Date(`${date}T00:00:00`);
  const days = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate();
  
  const userAttendance = (db.attendance || []).filter(
    (a) => a.userId === userId && inDateRange(a.date, start, end)
  );
  
  let presentDays = 0;
  let calculatedSalary = 0;
  
  if (userAttendance.length > 0) {
    presentDays = userAttendance.filter((a) => a.status === "present").length;
    if (user.salaryType === "daily") {
      calculatedSalary = salary * presentDays;
    } else {
      calculatedSalary = (salary / 30) * presentDays;
    }
  } else {
    // Fallback
    if (user.salaryType === "daily") {
      const workingDays = Math.max(0, days - closureCount);
      calculatedSalary = salary * workingDays;
    } else {
      calculatedSalary = (salary / 30) * days;
    }
  }
  
  calculatedSalary = money(calculatedSalary);
  
  // Get other payments in this period
  const userPayments = (db.salaryPayments || []).filter(
    (p) => p.userId === userId && p.id !== excludePaymentId && inDateRange(p.date || currentBusinessDate(), start, end)
  );
  const totalPaidPreviously = userPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  
  const pendingBeforeThis = money(calculatedSalary - totalPaidPreviously);
  
  if (pendingBeforeThis > 0 && amount >= pendingBeforeThis) {
    return "full";
  } else {
    return "partial";
  }
}

export function periodRange(dateText = currentBusinessDate(), period = "day") {
  const start = new Date(`${dateText}T00:00:00`);
  const end = new Date(start);
  if (period === "month") {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1, 1);
  } else {
    end.setDate(start.getDate() + 1);
  }
  return { start: dateKey(start), end: dateKey(end) };
}

export function inDateRange(value, start, end) {
  const clean = getBusinessDateKey(value);
  return clean >= start && clean < end;
}

export function filteredOrders(db, { branchId = "all", date = currentBusinessDate(), period = "day" } = {}) {
  const { start, end } = periodRange(date, period);
  return (db.orders || []).filter((order) => {
    const bDate = getBusinessDateKey(order.businessDate || order.createdAt);
    return order.status !== "cancelled" && inDateRange(bDate, start, end) && (branchId === "all" || order.branchId === branchId);
  });
}

export function userPerformanceReport(db, branchId = "all", date = currentBusinessDate(), period = "day") {
  const orders = filteredOrders(db, { branchId, date, period });
  const rows = new Map();
  const addSale = (userId, amount, bills) => {
    const user = db.users.find((item) => item.id === userId);
    if (!user) return;
    const row = rows.get(userId) || { userId, name: user.name, role: user.role, bills: 0, sales: 0, averageBill: 0 };
    row.bills += bills;
    row.sales = money(row.sales + amount);
    row.averageBill = row.bills ? money(row.sales / row.bills) : 0;
    rows.set(userId, row);
  };
  for (const order of orders) {
    addSale(order.createdBy, Number(order.total || 0), 1);
    if (order.serverId && order.serverId !== order.createdBy) addSale(order.serverId, Number(order.total || 0), 1);
  }
  return [...rows.values()].sort((a, b) => b.sales - a.sales);
}

export function getExpenseContribution(expense, targetDateText, period) {
  const expDate = new Date(`${expense.expenseDate}T00:00:00`);
  const tgtDate = new Date(`${targetDateText}T00:00:00`);
  
  const expYear = expDate.getFullYear();
  const expMonth = expDate.getMonth();
  const expDay = expDate.getDate();
  
  const tgtYear = tgtDate.getFullYear();
  const tgtMonth = tgtDate.getMonth();
  
  const freq = expense.frequency || "one-time";
  
  // Calculate days in target month
  const daysInTgtMonth = new Date(tgtYear, tgtMonth + 1, 0).getDate();
  
  if (freq === "one-time") {
    if (period === "month") {
      if (expYear === tgtYear && expMonth === tgtMonth) {
        return Number(expense.amount || 0);
      }
    } else {
      if (expense.expenseDate === targetDateText) {
        return Number(expense.amount || 0);
      }
    }
  } else if (freq === "daily") {
    if (period === "month") {
      const endOfTgtMonth = new Date(tgtYear, tgtMonth, daysInTgtMonth, 23, 59, 59);
      if (expDate <= endOfTgtMonth) {
        let activeDays = daysInTgtMonth;
        if (expYear === tgtYear && expMonth === tgtMonth) {
          activeDays = daysInTgtMonth - expDay + 1;
        }
        return Number(expense.amount || 0) * activeDays;
      }
    } else {
      if (tgtDate >= expDate) {
        return Number(expense.amount || 0);
      }
    }
  } else if (freq === "monthly") {
    if (period === "month") {
      const endOfTgtMonth = new Date(tgtYear, tgtMonth, daysInTgtMonth, 23, 59, 59);
      if (expDate <= endOfTgtMonth) {
        return Number(expense.amount || 0);
      }
    } else {
      const endOfTgtMonth = new Date(tgtYear, tgtMonth, daysInTgtMonth, 23, 59, 59);
      if (expDate <= endOfTgtMonth) {
        return Number(expense.amount || 0) / daysInTgtMonth;
      }
    }
  }
  return 0;
}

export function profitReport(db, branchId = "all", date = currentBusinessDate(), period = "day") {
  const { start, end } = periodRange(date, period);
  const orders = filteredOrders(db, { branchId, date, period });
  const supplierBills = (db.supplierBills || []).filter((bill) => inDateRange(bill.billDate || currentBusinessDate(), start, end) && (branchId === "all" || bill.branchId === branchId));
  
  // Calculate holidays in period
  const rangeHolidays = (db.holidays || []).filter((h) => inDateRange(h.holidayDate, start, end) && (branchId === "all" || h.branchId === "all" || h.branchId === branchId));
  const closureCount = rangeHolidays.filter((h) => h.type === "closure").length;
  
  const baseDate = new Date(`${date}T00:00:00`);
  const days = period === "month" ? new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate() : 1;
  
  const salaryExpense = db.users.filter((user) => user.active !== false && (branchId === "all" || user.branchIds?.includes(branchId))).reduce((sum, user) => {
    const salary = Number(user.salaryAmount || 0);
    
    // Check for attendance records in this period
    const userAttendance = (db.attendance || []).filter(
      (a) => a.userId === user.id && inDateRange(a.date, start, end)
    );
    
    if (userAttendance.length > 0) {
      const presentDays = userAttendance.filter((a) => a.status === "present").length;
      if (user.salaryType === "daily") {
        return sum + (salary * presentDays);
      } else {
        return sum + ((salary / 30) * presentDays);
      }
    } else {
      // Fallback
      if (user.salaryType === "daily") {
        // Working days are total days minus any unpaid closures in the period
        const workingDays = Math.max(0, days - closureCount);
        return sum + (salary * workingDays);
      } else {
        return sum + (salary / 30 * days);
      }
    }
  }, 0);
  
  const sales = money(orders.reduce((sum, order) => sum + Number(order.total || 0), 0));
  const supplierExpense = money(supplierBills.reduce((sum, bill) => sum + Number(bill.total || 0), 0));
  
  // Dynamic manual expenses based on frequency
  const branchExpenses = (db.expenses || []).filter((expense) => branchId === "all" || expense.branchId === branchId);
  let otherExpense = 0;
  const detailedExpenses = [];
  
  for (const exp of branchExpenses) {
    const contribution = getExpenseContribution(exp, date, period);
    if (contribution > 0) {
      otherExpense += contribution;
      detailedExpenses.push({
        ...exp,
        calculatedAmount: money(contribution)
      });
    }
  }
  otherExpense = money(otherExpense);
  
  const salaries = money(salaryExpense);
  const rangePayments = (db.salaryPayments || []).filter((s) => inDateRange(s.date || currentBusinessDate(), start, end) && (branchId === "all" || s.branchId === branchId));
  const paidSalaries = money(rangePayments.reduce((sum, s) => sum + Number(s.amount || 0), 0));
  const partnerSettlements = (db.partnerSettlements || []).filter((s) => inDateRange(s.date, start, end));
  const partnerExpense = money(partnerSettlements.reduce((sum, s) => sum + Number(s.amount || 0), 0));

  // Calculate actual cost of partner items sold in the period.
  // Build a lookup Map once instead of calling Array.find() (O(menuItems))
  // inside this loop for every single order line - with a large order
  // history and menu, the old code was effectively O(orders * lines * menuItems).
  const menuItemsById = new Map((db.menuItems || []).map(mi => [mi.id, mi]));
  let partnerSalesCost = 0;
  for (const order of orders) {
    for (const line of order.lines || []) {
      const menuItem = menuItemsById.get(line.menuItemId);
      const partnerShopId = line.partnerShopId || menuItem?.partnerShopId;
      if (partnerShopId) {
        const costPrice = line.partnerCostPrice !== undefined ? line.partnerCostPrice : (menuItem?.partnerCostPrice || 0);
        partnerSalesCost += Number(line.quantity || 0) * costPrice;
      }
    }
  }
  partnerSalesCost = money(partnerSalesCost);

  const totalExpenses = money(supplierExpense + otherExpense + salaries + partnerExpense);

  const usages = (db.stockUsages || []).filter((u) => {
    const createdDate = u.createdAt ? u.createdAt.slice(0, 10) : currentBusinessDate();
    return inDateRange(createdDate, start, end) && (branchId === "all" || u.branchId === branchId);
  });
  const inventoryById = new Map((db.inventory || []).map(inv => [inv.id, inv]));
  const stockConsumedCost = money(usages.reduce((sum, u) => {
    const cost = u.costValue || money(Number(u.stockQuantity || 0) * Number(inventoryById.get(u.inventoryId)?.lastCost || 0));
    return sum + cost;
  }, 0));

  const stationSummary = {};
  for (const order of orders) {
    for (const line of order.lines || []) {
      const station = line.kitchenStation || "counter";
      const menuItem = menuItemsById.get(line.menuItemId);
      const itemCost = menuItem ? (menuItem.costPrice || menuItem.partnerCostPrice || 0) : (line.partnerCostPrice || 0);
      const totalCost = Number(line.quantity || 1) * itemCost;
      const totalSales = Number(line.lineTotal || 0);
      
      if (!stationSummary[station]) {
        stationSummary[station] = { station, sales: 0, cost: 0, profit: 0, count: 0 };
      }
      stationSummary[station].sales += totalSales;
      stationSummary[station].cost += totalCost;
      stationSummary[station].count += Number(line.quantity || 0);
    }
  }
  const kitchenStationProfit = Object.keys(stationSummary).map(station => {
    const s = stationSummary[station];
    return {
      station,
      sales: money(s.sales),
      cost: money(s.cost),
      profit: money(s.sales - s.cost),
      count: s.count
    };
  });

  return {
    period,
    date,
    sales,
    supplierExpense,
    otherExpense,
    salaries,
    paidSalaries,
    partnerExpense,
    partnerSalesCost,
    totalExpenses,
    stockConsumedCost,
    kitchenStationProfit,
    profit: money(sales - totalExpenses),
    profitBasedOnConsumption: money(sales - (stockConsumedCost + otherExpense + salaries + partnerSalesCost)),
    expenses: detailedExpenses,
    supplierBills: supplierBills.slice().reverse(),
    holidays: rangeHolidays,
    stockUsages: usages
  };
}

let aiClient = null;
export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in environment variables.");
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

export function getMenuProfitability(db, branchId, date, period) {
  const orders = filteredOrders(db, { branchId, date, period });
  const itemMap = new Map();
  
  for (const item of db.menuItems || []) {
    if (item.active !== false) {
      itemMap.set(item.id, {
        id: item.id,
        name: item.name || "Unknown Item",
        code: item.code || "",
        price: Number(item.price || 0),
        costPrice: Number(item.costPrice || item.partnerCostPrice || 0),
        kitchenStation: item.kitchenStation || "General",
        quantitySold: 0,
        grossRevenue: 0,
        totalCost: 0,
        netProfit: 0,
        marginPercent: 0,
        profitClassification: "profitable"
      });
    }
  }

  for (const order of orders) {
    if (order.status === "cancelled") continue;
    for (const line of order.lines || []) {
      let data = itemMap.get(line.menuItemId);
      if (!data) {
        const foundItem = (db.menuItems || []).find(m => m.id === line.menuItemId);
        data = {
          id: line.menuItemId,
          name: line.name || foundItem?.name || "Unknown Item",
          code: line.code || foundItem?.code || "",
          price: Number(line.unitPrice || foundItem?.price || 0),
          costPrice: Number(line.partnerCostPrice || foundItem?.costPrice || foundItem?.partnerCostPrice || 0),
          kitchenStation: line.kitchenStation || foundItem?.kitchenStation || "General",
          quantitySold: 0,
          grossRevenue: 0,
          totalCost: 0,
          netProfit: 0,
          marginPercent: 0,
          profitClassification: "profitable"
        };
        itemMap.set(line.menuItemId, data);
      }
      data.quantitySold += Number(line.quantity || 0);
      data.grossRevenue += Number(line.lineTotal || 0);
    }
  }

  const result = [];
  for (const item of itemMap.values()) {
    item.grossRevenue = money(item.grossRevenue);
    item.totalCost = money(item.quantitySold * item.costPrice);
    item.netProfit = money(item.grossRevenue - item.totalCost);
    
    if (item.price > 0) {
      item.marginPercent = money(((item.price - item.costPrice) / item.price) * 100);
    } else {
      item.marginPercent = 0;
    }

    if (item.price < item.costPrice || item.marginPercent < 0) {
      item.profitClassification = "loss";
    } else if (item.marginPercent < 30) {
      item.profitClassification = "low_profit";
    } else {
      item.profitClassification = "profitable";
    }

    result.push(item);
  }

  return result.sort((a, b) => b.netProfit - a.netProfit);
}

export function getRuleBasedAnalysisFallback(data) {
  const lossItems = data.menuItems.filter(i => i.status === "loss" || i.price < i.costPrice);
  const lowMarginItems = data.menuItems.filter(i => i.status === "low_profit");
  const cashCows = data.menuItems.filter(i => i.quantitySold > 5 && i.status === "profitable");
  
  let lossSection = "";
  if (lossItems.length > 0) {
    lossSection = "The following items are currently **Loss Makers** (making negative profit per sale):\n" + 
      lossItems.map(i => `- **${i.name}** (Code: ${i.code}): Selling Price is ₹${i.price} but Ingredient Cost is ₹${i.costPrice}! You are losing ₹${Math.abs(i.price - i.costPrice)} on every portion sold.`).join("\n");
  } else {
    lossSection = "Excellent news! There are no loss-making menu items in this period. All active items are priced above their base ingredient cost.";
  }

  let lowMarginSection = "";
  if (lowMarginItems.length > 0) {
    lowMarginSection = "The following items have a **Low Profit Margin** (below 30% threshold):\n" +
      lowMarginItems.map(i => `- **${i.name}**: Selling Price ₹${i.price} | Ingredient Cost ₹${i.costPrice} | Current Margin **${i.marginPercent}%** (Suggested target: >45%)`).join("\n");
  } else {
    lowMarginSection = "All active menu items maintain a healthy margin above 30%.";
  }

  let cashCowSection = "";
  if (cashCows.length > 0) {
    cashCowSection = "The following are your **High Margin Cash Cows** (high volume and healthy margins):\n" +
      cashCows.map(i => `- **${i.name}** (Sold: **${i.quantitySold}** portions, Profit Margin: **${i.marginPercent}%**)`).join("\n");
  } else {
    cashCowSection = "No items matched 'Cash Cow' volume criteria (volume > 5 with margin >= 30%) in this range.";
  }

  return `### 📊 1. Executive Performance Summary (Automated Fallback)
The operational report for **${data.period.toUpperCase()}** ending on **${data.date}** shows:
- **Gross Sales**: ₹${data.totalSales}
- **Stock Consumption Cost**: ₹${data.stockConsumedCost}
- **Staff Expenses**: ₹${data.salaries}
- **Overhead Expenses**: ₹${data.otherExpense}
- **Net Operational Profit**: ₹${data.netProfit}

### ⚠️ 2. Menu Financial Diagnosis & Warnings
${lossSection}

${lowMarginSection}

${cashCowSection}

### 💡 3. Actionable Strategies to Increase Sales & Profits
1. **Optimize High Food-Cost Items**: Consider slightly increasing the prices of low-margin items or renegotiating bulk purchase rates with suppliers for core ingredients.
2. **Promote Combo Meals**: Pair high-margin, high-sales items (like drinks/desserts) with popular main dishes to increase the average ticket size.
3. **Portion Control**: Standardize kitchen recipes to ensure consistent portion sizes and prevent ingredient wastage.
4. **Cross-Selling**: Train cashiers and servers to proactively recommend side dishes and appetizers during order taking.

*Note: The Gemini API key is not configured or reachable. This analysis was generated locally using the automated financial rules engine.*`;
}

export function calculateOrder(db, items, discountPercent = 0) {
  const lines = items.map((line) => {
    const menuItem = db.menuItems.find((item) => item.id === line.menuItemId && item.active);
    if (!menuItem) throw new Error(`Invalid menu item: ${line.menuItemId}`);
    const quantity = Number(line.quantity || 1);
    const lineTotal = money(menuItem.price * quantity);
    return {
      id: createId("line"),
      menuItemId: menuItem.id,
      code: menuItem.code || "",
      name: menuItem.name,
      kitchenStation: menuItem.kitchenStation,
      quantity,
      unitPrice: menuItem.price,
      lineTotal,
      notes: line.notes || "",
      partnerShopId: menuItem.partnerShopId || null,
      partnerCostPrice: menuItem.partnerCostPrice || 0
    };
  });
  const subtotal = money(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const discountRate = Math.min(100, Math.max(0, Number(discountPercent || 0))) / 100;
  const discount = money(subtotal * discountRate);
  const taxableAmount = money(subtotal - discount);
  const tax = money(taxableAmount * activeTaxRate(db));
  const total = money(taxableAmount + tax);
  return { lines, subtotal, discountPercent: money(discountRate * 100), discount, taxableAmount, tax, total };
}

export function checkPortionsAvailability(db, items) {
  for (const line of items) {
    const mi = db.menuItems.find((item) => item.id === line.menuItemId);
    if (!mi) continue;
    
    const qty = Number(line.quantity || 1);
    
    if (mi.portionsAvailable !== undefined && mi.portionsAvailable !== null) {
      if (mi.portionsAvailable < qty) {
        throw new Error(`${mi.name} is out of stock (${mi.portionsAvailable} portions left)`);
      }
    }
    
    const cat = db.categories.find((c) => c.id === mi.categoryId);
    if (cat && cat.portionsAvailable !== undefined && cat.portionsAvailable !== null) {
      if (cat.portionsAvailable < qty) {
        throw new Error(`Items under category ${cat.name} are out of stock (${cat.portionsAvailable} portions left)`);
      }
    }
  }
}

export function getDailySalesCounts(db, businessDate = currentBusinessDate()) {
  const today = businessDate || currentBusinessDate();
  const itemSales = {};
  const catSales = {};

  const todayOrders = (db.orders || []).filter(o => getBusinessDateKey(o.businessDate || o.createdAt) === today && o.status !== "cancelled");

  for (const order of todayOrders) {
    for (const line of (order.lines || [])) {
      const miId = line.menuItemId;
      const qty = Number(line.quantity || 1);
      if (miId) {
        itemSales[miId] = (itemSales[miId] || 0) + qty;
        const mi = (db.menuItems || []).find(m => m.id === miId);
        if (mi && mi.categoryId) {
          catSales[mi.categoryId] = (catSales[mi.categoryId] || 0) + qty;
        }
      }
    }
  }

  return { itemSales, catSales };
}

export function syncDailyPortions(db, businessDate = currentBusinessDate()) {
  const today = businessDate || currentBusinessDate();
  const { itemSales, catSales } = getDailySalesCounts(db, today);

  for (const mi of db.menuItems || []) {
    if (mi.preparedQty && Number(mi.preparedQty) > 0) {
      const yieldPerUnit = Number(mi.yieldPerUnit) || 1;
      const totalPrepared = Math.round(Number(mi.preparedQty) * yieldPerUnit);
      const sold = itemSales[mi.id] || 0;
      mi.portionsAvailable = Math.max(0, totalPrepared - sold);
    } else {
      mi.preparedQty = 0;
      mi.portionsAvailable = null;
    }
  }

  for (const cat of db.categories || []) {
    if (cat.preparedQty && Number(cat.preparedQty) > 0) {
      const yieldPerUnit = Number(cat.yieldPerUnit) || 1;
      const totalPrepared = Math.round(Number(cat.preparedQty) * yieldPerUnit);
      const sold = catSales[cat.id] || 0;
      cat.portionsAvailable = Math.max(0, totalPrepared - sold);
    } else {
      cat.preparedQty = 0;
      cat.portionsAvailable = null;
    }
  }

  return { itemSales, catSales };
}

export function decrementPortions(db, items, branchId) {
  for (const line of items) {
    const mi = db.menuItems.find((item) => item.id === line.menuItemId);
    if (!mi) continue;
    
    const qty = Number(line.quantity || 1);
    
    if (mi.portionsAvailable !== undefined && mi.portionsAvailable !== null) {
      mi.portionsAvailable = Math.max(0, mi.portionsAvailable - qty);
    }
    
    const cat = db.categories.find((c) => c.id === mi.categoryId);
    if (cat && cat.portionsAvailable !== undefined && cat.portionsAvailable !== null) {
      cat.portionsAvailable = Math.max(0, cat.portionsAvailable - qty);
    }

    // Deduct raw ingredient stock based on ingredient yields & menuItem consumptions
    const consumptions = (db.menuItemConsumptions || []).filter((c) => c.menuItemId === mi.id);
    for (const c of consumptions) {
      const ingYield = (db.ingredientYields || []).find((y) => y.id === c.ingredientYieldId || y.yieldName === c.yieldName);
      if (!ingYield) continue;

      const actualBranchId = branchId || line.branchId || (db.branches && db.branches[0]?.id);
      if (!actualBranchId) continue;

      const stockItem = (db.inventory || []).find((i) => i.id === ingYield.rawGroceryId && i.branchId === actualBranchId);
      if (!stockItem) continue;

      const rawQtyRatio = Number(ingYield.rawQuantity || 1);
      const yieldAmt = Number(ingYield.yieldAmount || 1);
      const consumeAmt = Number(c.consumeAmount || 1);

      if (yieldAmt > 0) {
        const deductQty = (qty * consumeAmt * rawQtyRatio) / yieldAmt;
        stockItem.quantity = Math.round((Number(stockItem.quantity || 0) - deductQty) * 1000) / 1000;
      }
    }
  }
}

export function refundPortions(db, items, branchId) {
  for (const line of items) {
    const mi = db.menuItems.find((item) => item.id === line.menuItemId);
    if (!mi) continue;
    
    const qty = Number(line.quantity || 1);
    
    if (mi.portionsAvailable !== undefined && mi.portionsAvailable !== null) {
      mi.portionsAvailable += qty;
    }
    
    const cat = db.categories.find((c) => c.id === mi.categoryId);
    if (cat && cat.portionsAvailable !== undefined && cat.portionsAvailable !== null) {
      cat.portionsAvailable += qty;
    }

    // Refund raw ingredient stock based on ingredient yields & menuItem consumptions
    const consumptions = (db.menuItemConsumptions || []).filter((c) => c.menuItemId === mi.id);
    for (const c of consumptions) {
      const ingYield = (db.ingredientYields || []).find((y) => y.id === c.ingredientYieldId || y.yieldName === c.yieldName);
      if (!ingYield) continue;

      const actualBranchId = branchId || line.branchId || (db.branches && db.branches[0]?.id);
      if (!actualBranchId) continue;

      const stockItem = (db.inventory || []).find((i) => i.id === ingYield.rawGroceryId && i.branchId === actualBranchId);
      if (!stockItem) continue;

      const rawQtyRatio = Number(ingYield.rawQuantity || 1);
      const yieldAmt = Number(ingYield.yieldAmount || 1);
      const consumeAmt = Number(c.consumeAmount || 1);

      if (yieldAmt > 0) {
        const refundQty = (qty * consumeAmt * rawQtyRatio) / yieldAmt;
        stockItem.quantity = Math.round((Number(stockItem.quantity || 0) + refundQty) * 1000) / 1000;
      }
    }
  }
}

export function handleCustomerOnOrder(db, order) {
  if (!order.customerPhone) return;
  const phone = String(order.customerPhone).trim();
  if (!phone) return;

  db.customers = db.customers || [];
  let cust = db.customers.find((c) => c.phone === phone);
  if (!cust) {
    cust = {
      id: createId("cust"),
      name: String(order.customerName || "Walk-in Customer").trim(),
      phone: phone,
      totalSales: 0,
      orderCount: 0,
      tier: "New",
      discountPercent: 0,
      points: 0,
      createdAt: new Date().toISOString()
    };
    db.customers.push(cust);
  } else {
    if (order.customerName && (!cust.name || cust.name === "Walk-in Customer")) {
      cust.name = String(order.customerName).trim();
    }
  }

  // Ensure points property exists
  cust.points = Number(cust.points || 0);

  // Apply points redemption
  if (order.pointsRedeemed) {
    cust.points = Math.max(0, cust.points - Number(order.pointsRedeemed));
  }

  // Accrue points based on order total
  const loyaltySettings = db.loyaltySettings || { rupeesPerPoint: 100, rupeeValuePerPoint: 1 };
  const rupeesPerPoint = Number(loyaltySettings.rupeesPerPoint || 100);
  const earnedPoints = Math.floor(order.total / rupeesPerPoint);
  cust.points += earnedPoints;

  cust.orderCount += 1;
  cust.totalSales = Number((cust.totalSales + order.total).toFixed(2));
  cust.lastOrderAt = new Date().toISOString();

  if (cust.orderCount >= 10) {
    cust.tier = "VIP";
  } else if (cust.orderCount >= 3) {
    cust.tier = "Regular";
  } else {
    cust.tier = "New";
  }
}

export function handleCancelCustomerOnOrder(db, order) {
  if (!order.customerPhone) return;
  const phone = String(order.customerPhone).trim();
  if (!phone) return;

  db.customers = db.customers || [];
  const cust = db.customers.find((c) => c.phone === phone);
  if (cust) {
    cust.orderCount = Math.max(0, cust.orderCount - 1);
    cust.totalSales = Number(Math.max(0, cust.totalSales - order.total).toFixed(2));

    // Revert redeemed points
    if (order.pointsRedeemed) {
      cust.points = Number(cust.points || 0) + Number(order.pointsRedeemed);
    }

    // Deduct accrued points
    const loyaltySettings = db.loyaltySettings || { rupeesPerPoint: 100, rupeeValuePerPoint: 1 };
    const rupeesPerPoint = Number(loyaltySettings.rupeesPerPoint || 100);
    const earnedPoints = Math.floor(order.total / rupeesPerPoint);
    cust.points = Math.max(0, Number(cust.points || 0) - earnedPoints);

    if (cust.orderCount >= 10) {
      cust.tier = "VIP";
    } else if (cust.orderCount >= 3) {
      cust.tier = "Regular";
    } else {
      cust.tier = "New";
    }
  }
}

export function dailySummary(db, branchId = "all", businessDate = currentBusinessDate()) {
  const today = businessDate || currentBusinessDate();
  const orders = (db.orders || []).filter((order) => {
    return getBusinessDateKey(order.businessDate || order.createdAt) === today && order.status !== "cancelled" && (branchId === "all" || order.branchId === branchId);
  });
  const monthKey = today.slice(0, 7);
  const monthOrders = (db.orders || []).filter((order) => {
    return getBusinessDateKey(order.businessDate || order.createdAt).startsWith(monthKey) && order.status !== "cancelled" && (branchId === "all" || order.branchId === branchId);
  });
  const payments = orders.flatMap((order) => order.payments.map((payment) => ({ ...payment, branchId: order.branchId })));
  const salesByBranch = db.branches.map((branch) => {
    const branchOrders = orders.filter((order) => order.branchId === branch.id);
    return {
      branchId: branch.id,
      branchName: branch.name,
      sales: money(branchOrders.reduce((sum, order) => sum + order.total, 0)),
      bills: branchOrders.length
    };
  });
  const itemMap = new Map();
  for (const order of orders) {
    for (const line of order.lines) {
      const current = itemMap.get(line.menuItemId) || { name: line.name, quantity: 0, sales: 0 };
      current.quantity += line.quantity;
      current.sales = money(current.sales + line.lineTotal);
      itemMap.set(line.menuItemId, current);
    }
  }
  const salesTrend = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(`${today}T00:00:00`);
    date.setDate(date.getDate() - offset);
    const key = dateKey(date);
    const dayOrders = (db.orders || []).filter((order) => getBusinessDateKey(order.businessDate || order.createdAt) === key && order.status !== "cancelled" && (branchId === "all" || order.branchId === branchId));
    salesTrend.push({
      date: key,
      label: key.slice(5),
      sales: money(dayOrders.reduce((sum, order) => sum + order.total, 0)),
      bills: dayOrders.length
    });
  }
  return {
    businessDate: today,
    totalSales: money(orders.reduce((sum, order) => sum + order.total, 0)),
    totalBills: orders.length,
    averageBill: orders.length ? money(orders.reduce((sum, order) => sum + order.total, 0) / orders.length) : 0,
    payments: ["cash", "upi", "card", "aggregator"].map((mode) => ({
      mode,
      amount: money(payments.filter((payment) => payment.mode === mode).reduce((sum, payment) => sum + payment.amount, 0))
    })),
    cancellations: (db.orders || []).filter((order) => getBusinessDateKey(order.businessDate || order.createdAt) === today && order.status === "cancelled").length,
    openKots: db.kots.filter((kot) => kot.status !== "served" && (branchId === "all" || kot.branchId === branchId)).length,
    lowStock: db.inventory
      .filter((item) => item.active !== false && item.quantity <= item.reorderLevel && (branchId === "all" || item.branchId === branchId))
      .map((item) => {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const usages = (db.stockUsages || []).filter((u) => 
          u.inventoryId === item.id && 
          (branchId === "all" || u.branchId === branchId) && 
          new Date(u.createdAt) >= sevenDaysAgo
        );
        const totalConsumedInSevenDays = usages.reduce((sum, u) => sum + Number(u.stockQuantity || 0), 0);
        const dailyConsumptionRate = Math.round((totalConsumedInSevenDays / 7) * 100) / 100;
        
        let depletionText = "Stable (No recent use)";
        if (dailyConsumptionRate > 0) {
          const daysLeft = Math.round((Number(item.quantity || 0) / dailyConsumptionRate) * 10) / 10;
          if (daysLeft <= 0) {
            depletionText = "CRITICAL: Out of Stock!";
          } else if (daysLeft < 1) {
            depletionText = `CRITICAL: Depleting in ${Math.round(daysLeft * 24)} hours`;
          } else {
            depletionText = `Depleting in ${daysLeft} days`;
          }
        }
        
        return {
          ...item,
          dailyConsumptionRate,
          depletionText
        };
      }),
    salesByBranch,
    totalItemsSold: [...itemMap.values()].reduce((sum, item) => sum + item.quantity, 0),
    topItems: [...itemMap.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 8),
    allItemsSold: [...itemMap.values()].sort((a, b) => b.quantity - a.quantity),
    salesTrend,
    month: {
      month: monthKey,
      totalSales: money(monthOrders.reduce((sum, order) => sum + order.total, 0)),
      totalBills: monthOrders.length,
      averageBill: monthOrders.length ? money(monthOrders.reduce((sum, order) => sum + order.total, 0) / monthOrders.length) : 0,
      discount: money(monthOrders.reduce((sum, order) => sum + Number(order.discount || 0), 0)),
      tax: money(monthOrders.reduce((sum, order) => sum + Number(order.tax || 0), 0)),
      payments: ["cash", "upi", "card", "aggregator"].map((mode) => ({
        mode,
        amount: money(monthOrders.flatMap((order) => order.payments || []).filter((payment) => payment.mode === mode).reduce((sum, payment) => sum + Number(payment.amount || 0), 0))
      })),
      bills: monthOrders.slice().reverse().map((order) => ({
        id: order.id,
        billNo: order.billNo,
        businessDate: order.businessDate,
        orderType: order.orderType,
        tableNo: order.tableNo || "",
        total: order.total,
        discount: order.discount || 0,
        tax: order.tax || 0,
        paymentMode: (order.payments || []).map((payment) => payment.mode).join(", "),
        status: order.status
      }))
    }
  };
}

export function addPriceHistory(item, cost, dateText) {
  item.priceHistory = item.priceHistory || [];
  const costVal = money(cost);
  const dateStr = dateText || currentBusinessDate();
  const existing = item.priceHistory.find(h => h.date === dateStr);
  if (existing) {
    existing.cost = costVal;
  } else {
    item.priceHistory.push({ date: dateStr, cost: costVal });
  }
  item.priceHistory.sort((a, b) => a.date.localeCompare(b.date));
  if (item.priceHistory.length > 60) {
    item.priceHistory = item.priceHistory.slice(-60);
  }
}
