import { state, t, rupee } from "./state.js";

export function round(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function parseCSV(text) {
  const lines = [];
  let row = [""];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i+1];
    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push("");
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++;
      }
      lines.push(row);
      row = [""];
    } else {
      row[row.length - 1] += c;
    }
  }
  if (row.length > 1 || row[0] !== "") {
    lines.push(row);
  }
  return lines;
}

export function generateCSV(headers, rows) {
  const escapeField = (val) => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const headerLine = headers.map(escapeField).join(",");
  const bodyLines = rows.map(row => row.map(escapeField).join(","));
  return [headerLine, ...bodyLines].join("\r\n");
}

export function downloadCSV(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function formatMoney(value) {
  return rupee.format(Number(value || 0));
}

export function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function getOrderShift(createdAt) {
  if (!createdAt) return "unknown";
  try {
    const d = new Date(createdAt);
    if (isNaN(d.getTime())) return "unknown";
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false
    }).format(d);
    const hour = parseInt(hourStr, 10);
    if (hour >= 6 && hour < 16) {
      return "morning";
    } else {
      return "evening";
    }
  } catch (e) {
    return "unknown";
  }
}

export function getCurrentShiftLabel() {
  try {
    const d = new Date();
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false
    }).format(d);
    const hour = parseInt(hourStr, 10);
    if (hour >= 6 && hour < 16) {
      return "Morning Shift (6 AM - 4 PM)";
    } else {
      return "Evening Shift (4 PM - 6 AM next day)";
    }
  } catch (e) {
    return "Unknown";
  }
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

export function getStaffSalesByShift(orders, selectedDate, selectedShift, activeBranchId) {
  const staffSalesMap = new Map();
  const filtered = orders.filter(order => {
    const matchesBranch = activeBranchId === "all" || order.branchId === activeBranchId;
    const matchesDate = getBusinessDateKey(order.businessDate || order.createdAt) === selectedDate;
    const isNotCancelled = order.status !== "cancelled";
    if (!matchesBranch || !matchesDate || !isNotCancelled) {
      return false;
    }
    if (selectedShift !== "all") {
      const shift = getOrderShift(order.createdAt);
      if (shift !== selectedShift) {
        return false;
      }
    }
    return true;
  });

  for (const order of filtered) {
    const staffId = order.createdBy || "unknown";
    const totalAmount = Number(order.total || 0);
    const paymentMode = order.payments && order.payments[0] ? order.payments[0].mode : "unknown";
    const staffData = staffSalesMap.get(staffId) || {
      userId: staffId,
      name: "Unknown Staff",
      role: "Staff",
      billsCount: 0,
      totalSales: 0,
      cashSales: 0,
      upiSales: 0,
      cardSales: 0,
      aggregatorSales: 0,
      averageOrder: 0
    };

    const u = state.users.find(user => user.id === staffId);
    if (u) {
      staffData.name = u.name;
      staffData.role = u.role;
    } else if (staffId === "customer_online") {
      staffData.name = "Customer (Online)";
      staffData.role = "Online Portal";
    }

    staffData.billsCount += 1;
    staffData.totalSales = round(staffData.totalSales + totalAmount);

    if (paymentMode === "cash") {
      staffData.cashSales = round(staffData.cashSales + totalAmount);
    } else if (paymentMode === "upi") {
      staffData.upiSales = round(staffData.upiSales + totalAmount);
    } else if (paymentMode === "card") {
      staffData.cardSales = round(staffData.cardSales + totalAmount);
    } else if (paymentMode === "aggregator") {
      staffData.aggregatorSales = round(staffData.aggregatorSales + totalAmount);
    }

    staffData.averageOrder = staffData.billsCount ? round(staffData.totalSales / staffData.billsCount) : 0;
    staffSalesMap.set(staffId, staffData);
  }

  return [...staffSalesMap.values()].sort((a, b) => b.totalSales - a.totalSales);
}

export function isAdmin() {
  return state.user?.role === "admin";
}

export function hasUiPermission(permission) {
  if (isAdmin()) return true;
  const role = state.roles.find((item) => item.name === state.user?.role);
  return role?.permissions?.includes("*") || role?.permissions?.includes(permission);
}

export function activeTax() {
  const active = state.taxRates.find((tax) => tax.active);
  if (active) {
    return active;
  }
  if (state.taxRates && state.taxRates.length > 0) {
    return { name: "None", rate: 0, inactive: true };
  }
  if (state.group?.taxRate) {
    return { name: state.group?.taxLabel || "Tax", rate: state.group?.taxRate, active: true };
  }
  return { name: "None", rate: 0, inactive: true };
}

export function taxPercent(tax = activeTax()) {
  return round(Number(tax.rate || 0) * 100);
}

export function getSyncDate() {
  return new Date(Date.now() + (state.serverTimeOffset || 0));
}

export function getKolkataDateText() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(getSyncDate());
}

export function supplierNames(ids = []) {
  const names = ids
    .map((id) => state.suppliers.find((supplier) => supplier.id === id)?.name)
    .filter(Boolean);
  return names.length ? names.join(", ") : "-";
}

export function branchName(branchId) {
  return state.branches.find((branch) => branch.id === branchId)?.name || state.group?.name || "Restaurant";
}

export function selectedValue(value, current) {
  return String(value) === String(current) ? "selected" : "";
}

export function checkedValue(value) {
  return value ? "checked" : "";
}

export function activeSuppliers() {
  return state.suppliers.filter((supplier) => supplier.active !== false);
}

export function branchInventoryForSupplier(supplierId) {
  return state.inventory.filter((item) => {
    return item.branchId === state.activeBranchId && item.active !== false && (!supplierId || item.supplierIds?.includes(supplierId));
  });
}

export function currentBranch() {
  return state.branches.find((branch) => branch.id === state.activeBranchId) || state.branches[0];
}

export function viewTitle() {
  const map = {
    dashboard: t("Owner Dashboard"),
    pos: t("POS Billing"),
    tables: t("Table Service"),
    kitchen: t("Kitchen KOT"),
    inventory: t("Inventory"),
    bills: t("Bills"),
    "order-history": t("Order History"),
    masters: t("Masters"),
    reports: t("Reports"),
    loans: "Vendor Loans",
    customers: t("Customers")
  };
  return map[state.activeView] || t("Dashboard");
}

export function canUseView(view) {
  if (isAdmin()) return true;
  if (view === "dashboard") return hasUiPermission("dashboard.view") || hasUiPermission("reports.view");
  if (view === "tables") return hasUiPermission("table.use") || hasUiPermission("pos.use");
  if (view === "pos") return hasUiPermission("pos.use");
  if (view === "customers") return hasUiPermission("pos.use") || hasUiPermission("reports.view") || hasUiPermission("bills.view") || true;
  if (view === "kitchen") return hasUiPermission("kitchen.use");
  if (view === "inventory") return hasUiPermission("inventory.view");
  if (view === "bills") return hasUiPermission("bills.view") || hasUiPermission("reports.view") || hasUiPermission("pos.use");
  if (view === "order-history") return canUseView("bills") || canUseView("pos") || canUseView("kitchen");
  if (view === "masters") return hasUiPermission("masters.view") || isAdmin();
  if (view === "reports") return hasUiPermission("reports.view");
  if (view === "delivery") return hasUiPermission("delivery.use") || hasUiPermission("pos.use");
  if (view === "notifications") return hasUiPermission("notifications.view") || true;
  if (view === "loans") return hasUiPermission("loans.view") || ["admin", "owner", "manager"].includes(state.user?.role);
  return false;
}

export function firstAllowedView() {
  return ["dashboard", "tables", "pos", "customers", "kitchen", "inventory", "bills", "order-history", "delivery", "masters", "reports", "loans"].find(canUseView) || "dashboard";
}

export function showToast(message, type = "success") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.position = "fixed";
    container.style.top = "24px";
    container.style.right = "24px";
    container.style.zIndex = "99999";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.style.background = "#1a1815";
  toast.style.color = "#fff";
  toast.style.borderLeft = "4px solid #d4af37";
  toast.style.padding = "12px 20px";
  toast.style.borderRadius = "6px";
  toast.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.5)";
  toast.style.fontSize = "14px";
  toast.style.fontWeight = "500";
  toast.style.display = "flex";
  toast.style.alignItems = "center";
  toast.style.gap = "8px";
  toast.style.minWidth = "250px";
  toast.style.transition = "all 0.3s ease";
  toast.style.transform = "translateY(-20px)";
  toast.style.opacity = "0";

  const icon = document.createElement("span");
  icon.innerHTML = type === "success" ? "✓" : "🛈";
  icon.style.color = "#d4af37";
  icon.style.fontWeight = "bold";

  const text = document.createElement("span");
  text.textContent = message;

  toast.appendChild(icon);
  toast.appendChild(text);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transform = "translateY(0)";
    toast.style.opacity = "1";
  }, 10);

  setTimeout(() => {
    toast.style.transform = "translateY(-20px)";
    toast.style.opacity = "0";
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

export function showNotificationToast(message) {
  showToast(message, "info");
}

let activeApiRequests = 0;

export function showLoader() {
  activeApiRequests++;
  let bar = document.getElementById("global-loader-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "global-loader-bar";
    bar.className = "global-loader";
    document.body.appendChild(bar);
  }
  let spinner = document.getElementById("global-loader-spinner");
  if (!spinner) {
    spinner = document.createElement("div");
    spinner.id = "global-loader-spinner";
    spinner.className = "global-spinner-container";
    spinner.innerHTML = `<div class="global-spinner"></div><span style="font-weight: 600;">Processing...</span>`;
    document.body.appendChild(spinner);
  }
  bar.style.width = "0%";
  bar.style.opacity = "1";
  bar.offsetHeight;
  bar.classList.remove("done");
  bar.classList.add("loading");
  spinner.style.opacity = "1";
}

export function hideLoader() {
  activeApiRequests = Math.max(0, activeApiRequests - 1);
  if (activeApiRequests === 0) {
    const bar = document.getElementById("global-loader-bar");
    const spinner = document.getElementById("global-loader-spinner");
    if (bar) {
      bar.classList.remove("loading");
      bar.classList.add("done");
    }
    if (spinner) {
      spinner.style.opacity = "0";
    }
    setTimeout(() => {
      if (activeApiRequests === 0) {
        if (bar && bar.parentNode) bar.remove();
        if (spinner && spinner.parentNode) spinner.remove();
      }
    }, 300);
  }
}

export function playOrderSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, audioCtx.currentTime);
    gain1.gain.setValueAtTime(0.35, audioCtx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.45);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start();
    osc1.stop(audioCtx.currentTime + 0.5);
    
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.15);
    gain2.gain.setValueAtTime(0.35, audioCtx.currentTime + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.65);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(audioCtx.currentTime + 0.15);
    osc2.stop(audioCtx.currentTime + 0.8);
  } catch (e) {
    console.warn("Audio Context sound blocked or not supported yet:", e);
  }
}

export function playAlarmSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(500, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(900, audioCtx.currentTime + 0.3);
    osc.frequency.linearRampToValueAtTime(500, audioCtx.currentTime + 0.6);
    osc.frequency.linearRampToValueAtTime(900, audioCtx.currentTime + 0.9);
    osc.frequency.linearRampToValueAtTime(500, audioCtx.currentTime + 1.2);
    
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.25);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 1.3);
  } catch (e) {
    console.warn("Audio Context sound blocked or not supported yet:", e);
  }
}

let recognition = null;

export function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    state.voiceError = "Speech recognition is not supported in this browser.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = state.language === "ta" ? "ta-IN" : "en-US";

  recognition.onstart = () => {
    state.voiceActive = true;
    state.voiceFeedback = "Listening for voice commands...";
    state.voiceError = "";
  };

  recognition.onresult = async (event) => {
    const lastResultIndex = event.results.length - 1;
    const transcript = event.results[lastResultIndex][0].transcript.toLowerCase().trim();
    state.voiceFeedback = `Heard: "${transcript}"`;

    if (transcript.includes("stop") || transcript.includes("நிறுத்து")) {
      stopVoiceControl();
      return;
    }

    const isAddCommand = transcript.startsWith("add") || transcript.startsWith("சேர்") || transcript.startsWith("சேர்க்கவும்");
    if (isAddCommand) {
      let command = transcript.replace(/^(add|சேர்|சேர்க்கவும்)\s+/, "").trim();
      const wordToNum = {
        "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
        "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "ஒன்று": 1, "இரண்டு": 2, "மூன்று": 3, "நான்கு": 4, "ஐந்து": 5
      };
      
      let qty = 1;
      const words = command.split(/\s+/);
      const firstWord = words[0];
      
      if (wordToNum[firstWord] !== undefined) {
        qty = wordToNum[firstWord];
        command = words.slice(1).join(" ").trim();
      } else {
        const digitMatch = command.match(/^(\d+)\s+/);
        if (digitMatch) {
          qty = parseInt(digitMatch[1], 10) || 1;
          command = command.substring(digitMatch[0].length).trim();
        }
      }
      
      const spokenName = command.trim();
      if (spokenName.length >= 2) {
        let matchedItem = state.menuItems.find(item => item.active && item.name.toLowerCase().trim() === spokenName);
        if (!matchedItem) {
          matchedItem = state.menuItems.find(item => item.active && (item.name.toLowerCase().includes(spokenName) || spokenName.includes(item.name.toLowerCase())));
        }
        if (!matchedItem) {
          const spokenWords = spokenName.split(/\s+/).filter(w => w.length > 2);
          if (spokenWords.length > 0) {
            matchedItem = state.menuItems.find(item => item.active && spokenWords.every(word => item.name.toLowerCase().includes(word)));
          }
        }
        
        if (matchedItem) {
          if (state.activeView === "pos") {
            const line = state.cart.find((cartItem) => cartItem.id === matchedItem.id);
            const nextQty = (line ? line.quantity : 0) + qty;
            if (line) line.quantity = nextQty;
            else state.cart.push({ id: matchedItem.id, code: matchedItem.code || "", name: matchedItem.name, price: matchedItem.price, quantity: qty });
            state.focusQtyId = matchedItem.id;
            state.voiceFeedback = `✅ Added ${qty}x ${matchedItem.name} to cart`;
            showToast(`Added ${qty}x ${matchedItem.name} to cart`, "success");
            speakConfirmation(`Added ${qty} ${matchedItem.name}`);
          }
        } else {
          state.voiceFeedback = `Could not find any item matching "${spokenName}"`;
        }
      }
      return;
    }
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed") {
      state.voiceError = "Microphone access denied.";
      state.voiceActive = false;
    } else {
      state.voiceError = `Error: ${event.error}`;
    }
  };

  recognition.onend = () => {
    if (state.voiceActive) {
      try {
        recognition.start();
      } catch (err) {}
    }
  };
}

export function speakConfirmation(text) {
  if (window.speechSynthesis) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  }
}

export function startVoiceControl() {
  if (!recognition) {
    initSpeechRecognition();
  }
  if (recognition && !state.voiceActive) {
    try {
      recognition.start();
    } catch (err) {
      state.voiceError = "Failed to start speech recognition.";
    }
  }
}

export function stopVoiceControl() {
  if (recognition) {
    state.voiceActive = false;
    state.voiceFeedback = "Voice control disabled.";
    try {
      recognition.stop();
    } catch (err) {}
  }
}
