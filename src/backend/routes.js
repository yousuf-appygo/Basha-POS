import crypto from "node:crypto";
import { readDb, writeDb, getMongoClient, getReportsCache, setReportsCache, getLastMongoError, saveMenuItemImage, getMenuItemImage, saveLandingImage, getLandingImage, clearImagesData } from "./db.js";
import {
  sendJson, parseBody, authorize, hasPermission, money, createId, calculateOrder,
  checkPortionsAvailability, decrementPortions, refundPortions, handleCustomerOnOrder,
  handleCancelCustomerOnOrder, dailySummary, currentBusinessDate, getNextDailyOrderNo, getBusinessDateKey,
  dateKey, sanitizeUser, isPasswordHash, passwordMatches, canAccessBranch,
  canManageMasters, userPermissions, assertAdmin, requireText, convertStockUsage,
  activeTaxRate, expenseSummary, determineSalaryPaymentType, periodRange,
  inDateRange, filteredOrders, userPerformanceReport, getExpenseContribution,
  profitReport, getGeminiClient, getMenuProfitability, getRuleBasedAnalysisFallback,
  addPriceHistory, applySecurityHeaders, syncDailyPortions, getDailySalesCounts
} from "./utils.js";

function sanitizeMenuItem(item) {
  if (!item) return item;
  let imageUrl = item.image || "";
  if (imageUrl && imageUrl.startsWith("data:")) {
    imageUrl = `/api/public/menu-item-image/${item.id}`;
  }
  return {
    ...item,
    image: imageUrl
  };
}

function sanitizeMenuItems(menuItems) {
  if (!Array.isArray(menuItems)) return [];
  return menuItems.map(sanitizeMenuItem);
}

export async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    const client = await getMongoClient();
    const mongoError = getLastMongoError();
    return sendJson(res, 200, {
      ok: true,
      backend: client ? "mongodb" : "json",
      mongoDbConnected: !!client,
      hasMongoUri: !!process.env.MONGODB_URI,
      mongoConnectionError: mongoError,
      time: new Date().toISOString()
    });
  }

  const db = await readDb();

  // --- PRINT JOBS CLOUD QUEUE ---
  if (req.method === "POST" && pathname === "/api/print-jobs") {
    const body = await parseBody(req);
    const job = {
      id: "job_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      branchId: body.branchId || "all",
      title: body.title || "Print Job",
      html: body.html,
      createdAt: new Date().toISOString(),
      status: "pending"
    };
    db.printJobs = db.printJobs || [];
    db.printJobs.push(job);
    await writeDb(db);
    return sendJson(res, 201, { success: true, job });
  }

  if (req.method === "GET" && pathname === "/api/print-jobs") {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    db.printJobs = db.printJobs || [];
    const pending = db.printJobs.filter(j => j.status === "pending" && (branchId === "all" || j.branchId === branchId));
    return sendJson(res, 200, pending);
  }

  if (req.method === "POST" && pathname.startsWith("/api/print-jobs/") && pathname.endsWith("/complete")) {
    const parts = pathname.split("/");
    const id = parts[3];
    db.printJobs = db.printJobs || [];
    const job = db.printJobs.find(j => j.id === id);
    if (job) {
      job.status = "printed";
      // Auto prune older than 1 hour to keep DB light
      const oneHourAgo = Date.now() - 3600000;
      db.printJobs = db.printJobs.filter(j => j.status === "pending" || new Date(j.createdAt).getTime() > oneHourAgo);
      await writeDb(db);
    }
    return sendJson(res, 200, { success: true });
  }

  const defaultLandingSettings = {
    brandName: "MADURAI BASHA",
    brandSub: "Royal Biryani & South Indian Cuisine",
    estd: "ESTD. 1997",
    heroTitle: "The Legendary Taste of Madurai Biryani",
    heroDesc: "Indulge in authentic, rich flavours slow-cooked to royal perfection. Handcrafted with our signature blend of secret spices, premium Basmati, and fresh tender meat. Served hot at your convenience.",
    aboutLabel: "OUR LEGACY",
    aboutTitle: "Crafting Authentic Culinary Memories",
    aboutPara1: "Founded with a passion for preserving traditional Tamil cuisine, Madurai Basha brings the majestic aromas and deep culinary traditions of Madurai right to your plate. Our masters follow timeless preparation secrets, slow-dum-cooking using seasoned pots and firewood configurations where possible.",
    aboutPara2: "Every batch of Biryani is carefully monitored to achieve the perfect grain length, tender texture, and signature spice-infused profile that has won the hearts of thousands of loyal customers.",
    yearsCount: "29+",
    yearsLabel: "Years of Perfection",
    specTitle: "Our Signature Delicacies",
    specialties: [
      { id: "spec1", tag: "Legendary", price: "280", title: "Madurai Seeraga Samba Mutton Biryani", desc: "Fragrant indigenous Seeraga Samba rice cooked slowly with rich, juicy, fall-off-the-bone tender mutton pieces and spices." },
      { id: "spec2", tag: "All-Time Favorite", price: "220", title: "Basha Special Chicken Biryani", desc: "Succulent marinated chicken loaded with robust spices, layered with fluffy long-grain Basmati, and slow-dum-cooked." },
      { id: "spec3", tag: "Classic", price: "160", title: "Madurai Mutton Elumbu Curry", desc: "Traditional rich bone gravy simmered with shallots, crushed pepper, and roasted spices in traditional chettinad style." }
    ],
    branch1Title: "Pondicherry Main Branch",
    branch1Addr: "📍 45, Mission Street, Heritage Town,\nPuducherry, 605001.",
    branch1Hours: "Everyday: 11:00 AM - 11:30 PM",
    branch2Title: "Madurai Royal Junction",
    branch2Addr: "📍 12, West Tower Street, Near Temple,\nMadurai, Tamil Nadu, 625001.",
    branch2Hours: "Everyday: 11:00 AM - Midnight",
    footerDesc: "Bringing legendary, royal dum cooked Seeraga Samba and Basmati biryani to your doorstep. Since 1997.",
    loginHeroTitle: "Control every branch without sitting inside every branch.",
    loginHeroDesc: "Billing, KOT, stock, purchases, and daily owner visibility for your Pondicherry restaurant group.",
    loginCardTitle: "Sign in",
    loginCardSubtitle: "Use admin login for setup, owner login for reports."
  };
  if (!db.landingPageSettings) {
    db.landingPageSettings = defaultLandingSettings;
    await writeDb(db);
  }

  if (req.method === "POST" && pathname === "/api/login") {
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const user = db.users.find((item) => String(item.email || "").toLowerCase() === email && item.active);
    if (!user || !await passwordMatches(body.password, user)) return sendJson(res, 401, { error: "Invalid credentials" });
    const token = crypto.randomUUID();
    db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
    await writeDb(db);
    return sendJson(res, 200, {
      token,
      user: sanitizeUser(user),
      mongoDbConnected: !!(await getMongoClient()),
      mongoConnectionError: getLastMongoError() ? String(getLastMongoError().message || getLastMongoError()) : null
    });
  }

  if (req.method === "GET" && pathname === "/api/public/menu") {
    return sendJson(res, 200, {
      branches: (db.branches || []).filter((b) => b.active !== false),
      categories: (db.categories || []).filter((c) => c.active !== false),
      menuItems: sanitizeMenuItems((db.menuItems || []).filter((m) => m.active !== false))
    });
  }

  if (req.method === "GET" && pathname === "/api/public/menu-items/backup") {
    const backupItems = db.menuItems.map(item => {
      let imageUrl = item.image || "";
      if (imageUrl && imageUrl.startsWith("data:")) {
        imageUrl = "/api/public/menu-item-image/" + item.id;
      }
      return {
        id: item.id || "",
        code: item.code || "",
        name: item.name || "",
        categoryId: item.categoryId || "",
        categoryName: (db.categories.find(c => c.id === item.categoryId))?.name || "",
        price: item.price || 0,
        kitchenStation: item.kitchenStation || "counter",
        preparationTime: item.preparationTime || 15,
        active: item.active !== false,
        outOfStock: !!item.outOfStock,
        availableForDelivery: item.availableForDelivery !== false,
        image: imageUrl,
        description: item.description || "",
        partnerShopId: item.partnerShopId || null,
        partnerCostPrice: item.partnerCostPrice || 0,
        partnerMarkup: item.partnerMarkup || 0
      };
    });
    return sendJson(res, 200, backupItems);
  }

  if (req.method === "POST" && pathname === "/api/public/menu-items/restore") {
    const body = await parseBody(req);
    const json = body.items;
    if (!Array.isArray(json)) {
      return sendJson(res, 400, { error: "Invalid backup format. Expected an items array." });
    }
    
    let successCount = 0;
    let failCount = 0;
    
    for (const item of json) {
      if (!item.name || !item.code) {
        failCount++;
        continue;
      }
      
      // Resolve category
      let categoryId = item.categoryId || "";
      const categoryName = item.categoryName || "";
      if (!categoryId && categoryName) {
        let cat = db.categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
        if (!cat) {
          cat = {
            id: createId("cat"),
            name: categoryName,
            sortOrder: db.categories.length + 1,
            active: true
          };
          db.categories.push(cat);
        }
        categoryId = cat.id;
      }
      
      if (!categoryId) {
        let firstCat = db.categories.find(c => c.active !== false);
        if (!firstCat) {
          firstCat = {
            id: createId("cat"),
            name: "Main Menu",
            sortOrder: 1,
            active: true
          };
          db.categories.push(firstCat);
        }
        categoryId = firstCat.id;
      }
      
      const existingItem = db.menuItems.find(mi => mi.code?.toUpperCase() === item.code.toUpperCase());
      const itemId = item.id || (existingItem ? existingItem.id : createId("item"));
      
      let imageToSave = item.image || "";
      if (existingItem && imageToSave && (imageToSave.includes("/api/public/menu-item-image/") || imageToSave.includes("/placeholder.png"))) {
        if (existingItem.image && existingItem.image.startsWith("data:")) {
          imageToSave = existingItem.image;
        }
      }

      if (imageToSave && imageToSave.startsWith("data:")) {
        await saveMenuItemImage(itemId, imageToSave);
        imageToSave = "/api/public/menu-item-image/" + itemId;
      }
      
      if (existingItem) {
        existingItem.name = item.name;
        existingItem.categoryId = categoryId;
        existingItem.price = Number(item.price) || 0;
        existingItem.kitchenStation = item.kitchenStation || "counter";
        existingItem.preparationTime = Number(item.preparationTime) || 15;
        existingItem.active = item.active !== false;
        existingItem.outOfStock = !!item.outOfStock;
        existingItem.availableForDelivery = item.availableForDelivery !== false;
        existingItem.image = imageToSave;
        existingItem.description = item.description || "";
        existingItem.partnerShopId = item.partnerShopId || null;
        existingItem.partnerCostPrice = Number(item.partnerCostPrice) || 0;
        existingItem.partnerMarkup = Number(item.partnerMarkup) || 0;
      } else {
        const newItem = {
          id: itemId,
          code: item.code,
          name: item.name,
          categoryId,
          price: Number(item.price) || 0,
          kitchenStation: item.kitchenStation || "counter",
          preparationTime: Number(item.preparationTime) || 15,
          active: item.active !== false,
          outOfStock: !!item.outOfStock,
          availableForDelivery: item.availableForDelivery !== false,
          image: imageToSave,
          description: item.description || "",
          partnerShopId: item.partnerShopId || null,
          partnerCostPrice: Number(item.partnerCostPrice) || 0,
          partnerMarkup: Number(item.partnerMarkup) || 0
        };
        db.menuItems.push(newItem);
      }
      successCount++;
    }
    
    await writeDb(db);
    return sendJson(res, 200, { success: true, successCount, failCount });
  }

  if (req.method === "GET" && pathname.startsWith("/api/public/menu-item-image/")) {
    const id = pathname.split("/")[4];
    let imgData = await getMenuItemImage(id);
    if (!imgData) {
      const menuItem = db.menuItems.find((item) => item.id === id);
      if (menuItem && menuItem.image && menuItem.image.startsWith("data:")) {
        imgData = menuItem.image;
      }
    }
    if (!imgData) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Image not found");
      return;
    }
    if (imgData.startsWith("data:")) {
      const matches = imgData.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const contentType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, "base64");
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": buffer.length,
          "Cache-Control": "public, max-age=86400"
        });
        res.end(buffer);
        return;
      }
    }
    if (imgData.startsWith("http://") || imgData.startsWith("https://") || imgData.startsWith("/")) {
      res.writeHead(302, { "Location": imgData });
      res.end();
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Invalid image data format");
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/public/landing-image/")) {
    const key = pathname.split("/")[4];
    let imgData = await getLandingImage(key);
    if (!imgData && db.landingPageSettings) {
      const legacyVal = db.landingPageSettings[key];
      if (legacyVal && legacyVal.startsWith("data:")) {
        imgData = legacyVal;
      }
    }
    if (!imgData) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Image not found");
      return;
    }
    if (imgData.startsWith("data:")) {
      const matches = imgData.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const contentType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, "base64");
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": buffer.length,
          "Cache-Control": "public, max-age=86400"
        });
        res.end(buffer);
        return;
      }
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Invalid image data format");
    return;
  }

  if (req.method === "GET" && pathname === "/api/public/landing-settings") {
    const settings = db.landingPageSettings || defaultLandingSettings;
    const activeBranches = (db.branches || []).filter((b) => b.active !== false);
    return sendJson(res, 200, {
      ...settings,
      branches: activeBranches
    });
  }

  if (req.method === "POST" && pathname === "/api/public/orders") {
    const body = await parseBody(req);
    const branchId = body.branchId;
    if (!branchId || !db.branches.some((b) => b.id === branchId)) {
      return sendJson(res, 400, { error: "Invalid branch selected" });
    }
    try {
      checkPortionsAvailability(db, body.items || []);
    } catch (err) {
      return sendJson(res, 422, { error: err.message });
    }
    const calculated = calculateOrder(db, body.items || [], 0);
    if (!calculated.lines.length) return sendJson(res, 422, { error: "At least one order item is required" });
    decrementPortions(db, calculated.lines, branchId);
    const tipAmount = Number(body.tipAmount) || 0;
    const order = {
      id: createId("ord"),
      billNo: `${branchId.toUpperCase()}-WEB-${Date.now().toString().slice(-6)}`,
      branchId: branchId,
      orderType: "delivery",
      tableNo: "",
      customerName: requireText(body.customerName, "Customer Name"),
      customerPhone: requireText(body.customerPhone, "Customer Phone"),
      deliveryAddress: requireText(body.deliveryAddress, "Delivery Address"),
      deliveryStatus: "pending",
      deliveryAgent: "",
      deliveryFee: 0,
      lines: calculated.lines,
      subtotal: calculated.subtotal,
      discountPercent: 0,
      discount: 0,
      taxableAmount: calculated.taxableAmount,
      tax: calculated.tax,
      tipAmount: tipAmount,
      deliveryTip: tipAmount,
      total: money(calculated.total + tipAmount),
      payments: [],
      status: "pending_payment",
      createdBy: "customer_online",
      businessDate: currentBusinessDate(),
      createdAt: new Date().toISOString()
    };
    const dailyOrderNo = getNextDailyOrderNo(db, branchId, order.businessDate);
    order.dailyOrderNo = dailyOrderNo;
    
    db.orders = db.orders || [];
    db.orders.push(order);
    handleCustomerOnOrder(db, order);

    // Create notification for new online order only!
    db.notifications = db.notifications || [];
    db.notifications.push({
      id: createId("not"),
      branchId: order.branchId,
      title: "New Online Order!",
      message: `Delivery order of ₹${order.total} from ${order.customerName} was received online!`,
      type: "customer_order",
      timestamp: new Date().toISOString(),
      read: false
    });

    await writeDb(db);
    return sendJson(res, 201, { order });
  }

  if (req.method === "POST" && pathname === "/api/public/factory-reset") {
    // Preserve critical system defaults so they are not locked out
    const adminUser = db.users.find(u => u.role === "admin") || {
      id: "usr_admin",
      name: "Admin",
      email: "admin@basha.local",
      password: "admin123",
      role: "admin",
      branchIds: db.branches.map(b => b.id),
      active: true
    };

    const preservedRoles = db.roles || [];
    const preservedBranches = db.branches || [];
    const preservedGroup = db.group || { name: "MADURAI BASHA RESTAURANT GROUP" };
    const preservedTaxRates = db.taxRates || [];
    const preservedLandingPageSettings = db.landingPageSettings;

    const resetDb = {
      group: preservedGroup,
      branches: preservedBranches,
      roles: preservedRoles,
      taxRates: preservedTaxRates,
      landingPageSettings: preservedLandingPageSettings,
      users: [adminUser],
      categories: [],
      menuItems: [],
      suppliers: [],
      inventory: [],
      orders: [],
      tableOrders: [],
      kots: [],
      supplierBills: [],
      supplierOrders: [],
      expenses: [],
      loans: [],
      holidays: [],
      stockUsages: [],
      attendance: [],
      notifications: [],
      customers: [],
      partnerShops: [],
      partnerSettlements: [],
      salaryPayments: [],
      owners: [],
      ownerDraws: [],
      coupons: [],
      sessions: [],
      auditLogs: [],
      meta: {
        updatedAt: new Date().toISOString(),
        resetAt: new Date().toISOString()
      }
    };

    await clearImagesData();
    await writeDb(resetDb);
    return sendJson(res, 200, { success: true, message: "All masters and operational data have been fully reset." });
  }

  const user = authorize(db, req);
  if (!user) return sendJson(res, 401, { error: "Unauthorized" });

  if (req.method === "GET" && pathname === "/api/bootstrap") {
    const today = currentBusinessDate();
    let resetDone = false;
    if (db.portionsDate !== today) {
      for (const mi of db.menuItems || []) {
        mi.preparedQty = 0;
        mi.portionsAvailable = null;
      }
      for (const cat of db.categories || []) {
        cat.preparedQty = 0;
        cat.portionsAvailable = null;
      }
      resetDone = true;
    }
    syncDailyPortions(db, today);
    if (resetDone) {
      await writeDb(db);
    }
    return sendJson(res, 200, {
      user,
      group: db.group,
      taxRates: db.taxRates || [],
      branches: ["admin", "owner"].includes(user.role) ? db.branches : db.branches.filter((branch) => user.branchIds.includes(branch.id)),
      categories: db.categories,
      menuItems: sanitizeMenuItems(db.menuItems),
      suppliers: db.suppliers || [],
      supplierPayments: db.supplierPayments || [],
      inventory: db.inventory,
      roles: db.roles || [],
      users: db.users.map(sanitizeUser),
      supplierBills: db.supplierBills || [],
      supplierOrders: db.supplierOrders || [],
      tableOrders: db.tableOrders || [],
      holidays: db.holidays || [],
      customers: db.customers || [],
      coupons: db.coupons || [],
      loans: db.loans || [],
      partnerShops: db.partnerShops || [],
      partnerSettlements: db.partnerSettlements || [],
      yieldMappings: db.yieldMappings || [],
      ingredientYields: db.ingredientYields || [],
      menuItemConsumptions: db.menuItemConsumptions || [],
      summary: dailySummary(db),
      portionsInitializedToday: db.portionsDate === today,
      loyaltySettings: db.loyaltySettings || { rupeesPerPoint: 100, rupeeValuePerPoint: 1 },
      landingPageSettings: db.landingPageSettings || defaultLandingSettings,
      mongoDbConnected: !!(await getMongoClient()),
      mongoConnectionError: getLastMongoError() ? String(getLastMongoError().message || getLastMongoError()) : null
    });
  }

  if (req.method === "PUT" && pathname === "/api/admin/landing-settings") {
    if (!["admin", "owner"].includes(user.role)) {
      return sendJson(res, 403, { error: "Access denied. Only Admins and Owners can manage landing page settings." });
    }
    const body = await parseBody(req);

    let brandLogoToSave = String(body.brandLogo || "").trim() || "";
    if (brandLogoToSave && brandLogoToSave.startsWith("data:")) {
      await saveLandingImage("brandLogo", brandLogoToSave);
      brandLogoToSave = "/api/public/landing-image/brandLogo";
    }

    let heroImageToSave = String(body.heroImage || "").trim() || "";
    if (heroImageToSave && heroImageToSave.startsWith("data:")) {
      await saveLandingImage("heroImage", heroImageToSave);
      heroImageToSave = "/api/public/landing-image/heroImage";
    }

    db.landingPageSettings = {
      brandName: String(body.brandName || "").trim() || "MADURAI BASHA",
      brandSub: String(body.brandSub || "").trim() || "Royal Biryani & South Indian Cuisine",
      estd: String(body.estd || "").trim() || "ESTD. 1997",
      heroTitle: String(body.heroTitle || "").trim() || "The Legendary Taste of Madurai Biryani",
      heroDesc: String(body.heroDesc || "").trim() || "",
      aboutLabel: String(body.aboutLabel || "").trim() || "OUR LEGACY",
      aboutTitle: String(body.aboutTitle || "").trim() || "Crafting Authentic Culinary Memories",
      aboutPara1: String(body.aboutPara1 || "").trim() || "",
      aboutPara2: String(body.aboutPara2 || "").trim() || "",
      yearsCount: String(body.yearsCount || "").trim() || "29+",
      yearsLabel: String(body.yearsLabel || "").trim() || "Years of Perfection",
      specTitle: String(body.specTitle || "").trim() || "Our Signature Delicacies",
      specialties: Array.isArray(body.specialties) ? body.specialties : [],
      branch1Title: String(body.branch1Title || "").trim() || "Pondicherry Main Branch",
      branch1Addr: String(body.branch1Addr || "").trim() || "",
      branch1Hours: String(body.branch1Hours || "").trim() || "",
      branch2Title: String(body.branch2Title || "").trim() || "Madurai Royal Junction",
      branch2Addr: String(body.branch2Addr || "").trim() || "",
      branch2Hours: String(body.branch2Hours || "").trim() || "",
      footerDesc: String(body.footerDesc || "").trim() || "",
      brandLogo: brandLogoToSave,
      heroImage: heroImageToSave,
      loginHeroTitle: String(body.loginHeroTitle || "").trim() || "Control every branch without sitting inside every branch.",
      loginHeroDesc: String(body.loginHeroDesc || "").trim() || "",
      loginCardTitle: String(body.loginCardTitle || "").trim() || "Sign in",
      loginCardSubtitle: String(body.loginCardSubtitle || "").trim() || "Use admin login for setup, owner login for reports."
    };
    await writeDb(db);
    return sendJson(res, 200, db.landingPageSettings);
  }

  if (req.method === "GET" && pathname === "/api/orders") {
    if (!hasPermission(db, user, "reports.view") && !hasPermission(db, user, "pos.use") && !hasPermission(db, user, "delivery.use")) return sendJson(res, 403, { error: "Orders access required" });
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const limit = parseInt(urlObj.searchParams.get("limit") || "250", 10);
    const today = currentBusinessDate();
    const todayOrders = (db.orders || []).filter(o => getBusinessDateKey(o.businessDate || o.createdAt) === today || (o.createdAt || "").startsWith(today));
    const recentOrders = db.orders.slice(-limit);
    const orderMap = new Map();
    for (const o of [...todayOrders, ...recentOrders]) {
      orderMap.set(o.id, o);
    }
    const result = Array.from(orderMap.values()).reverse();
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && pathname === "/api/bills") {
    if (!hasPermission(db, user, "reports.view") && !hasPermission(db, user, "pos.use") && !hasPermission(db, user, "bills.view")) return sendJson(res, 403, { error: "Bills access required" });
    const cached = getReportsCache(req.url);
    if (cached) return sendJson(res, 200, cached);
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    const period = params.get("period") || "month";
    const date = params.get("date") || currentBusinessDate();
    if (branchId !== "all" && !canAccessBranch(user, branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    const result = filteredOrders(db, { branchId, date, period }).slice().reverse();
    setReportsCache(req.url, result);
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && pathname === "/api/table-orders") {
    if (!hasPermission(db, user, "table.use") && !hasPermission(db, user, "pos.use") && !hasPermission(db, user, "reports.view")) return sendJson(res, 403, { error: "Table access required" });
    return sendJson(res, 200, db.tableOrders || []);
  }

  if (req.method === "POST" && pathname === "/api/table-orders") {
    if (!hasPermission(db, user, "table.use") && !hasPermission(db, user, "pos.use")) return sendJson(res, 403, { error: "Table order access required" });
    const body = await parseBody(req);
    if (!canAccessBranch(user, body.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    const tableNo = requireText(body.tableNo, "Table number");
    const serverUser = db.users.find((item) => item.id === body.serverId);
    const selectedServer = serverUser || user;
    try {
      checkPortionsAvailability(db, body.items || []);
    } catch (err) {
      return sendJson(res, 422, { error: err.message });
    }
    const calculated = calculateOrder(db, body.items || []);
    if (!calculated.lines.length) return sendJson(res, 422, { error: "At least one order item is required" });
    decrementPortions(db, calculated.lines, body.branchId);
    let tableOrder = db.tableOrders.find((item) => item.branchId === body.branchId && item.tableNo === tableNo && item.status === "open");
    if (!tableOrder) {
      tableOrder = {
        id: createId("tbl"),
        orderNo: `${body.branchId.toUpperCase()}-T${tableNo}-${Date.now().toString().slice(-5)}`,
        branchId: body.branchId,
        tableNo,
        serverId: selectedServer.id,
        serverName: selectedServer.name,
        lines: [],
        subtotal: 0,
        tax: 0,
        total: 0,
        status: "open",
        createdBy: user.id,
        createdAt: new Date().toISOString()
      };
      db.tableOrders.push(tableOrder);
    }
    tableOrder.serverId = selectedServer.id || tableOrder.serverId;
    tableOrder.serverName = selectedServer.name || tableOrder.serverName || user.name;
    
    // Merge new items into existing lines if menuItemId and notes match
    for (const newline of calculated.lines) {
      const existingLine = tableOrder.lines.find(l => l.menuItemId === newline.menuItemId && (l.notes || "") === (newline.notes || ""));
      if (existingLine) {
        existingLine.quantity += newline.quantity;
        existingLine.lineTotal = money(existingLine.quantity * existingLine.unitPrice);
      } else {
        tableOrder.lines.push(newline);
      }
    }

    tableOrder.subtotal = money(tableOrder.lines.reduce((sum, line) => sum + line.lineTotal, 0));
    tableOrder.discountPercent = Number(tableOrder.discountPercent || 0);
    tableOrder.discount = money(tableOrder.subtotal * (tableOrder.discountPercent / 100));
    tableOrder.taxableAmount = money(tableOrder.subtotal - tableOrder.discount);
    tableOrder.tax = money(tableOrder.taxableAmount * activeTaxRate(db));
    tableOrder.total = money(tableOrder.taxableAmount + tableOrder.tax);
    tableOrder.updatedAt = new Date().toISOString();
    const dailyOrderNo = getNextDailyOrderNo(db, tableOrder.branchId, tableOrder.updatedAt.slice(0, 10));
    tableOrder.dailyOrderNo = tableOrder.dailyOrderNo || dailyOrderNo;
    const kot = {
      id: createId("kot"),
      orderId: "",
      tableOrderId: tableOrder.id,
      billNo: tableOrder.orderNo,
      dailyOrderNo: dailyOrderNo,
      branchId: tableOrder.branchId,
      tableNo: tableOrder.tableNo,
      orderType: "dine-in",
      serverName: tableOrder.serverName,
      lines: calculated.lines,
      status: "new",
      notes: tableOrder.notes || "",
      createdAt: tableOrder.updatedAt
    };
    db.kots.push(kot);
    db.notifications = db.notifications || [];
    db.notifications.push({
      id: createId("not"),
      branchId: kot.branchId,
      title: `New KOT (${kot.billNo})`,
      message: `Table ${kot.tableNo} order sent to kitchen.`,
      type: "kot_new",
      timestamp: new Date().toISOString(),
      read: false
    });
    await writeDb(db);
    return sendJson(res, 201, { tableOrder, kot });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/table-orders/")) {
    if (!hasPermission(db, user, "table.use") && !hasPermission(db, user, "pos.use")) return sendJson(res, 403, { error: "Table order access required" });
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const tableOrder = db.tableOrders.find((item) => item.id === id && item.status === "open");
    if (!tableOrder) return sendJson(res, 404, { error: "Open table order not found" });
    if (!canAccessBranch(user, tableOrder.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    if ("serverId" in body) {
      const serverUser = db.users.find((item) => item.id === body.serverId);
      if (serverUser) {
        tableOrder.serverId = serverUser.id;
        tableOrder.serverName = serverUser.name;
      }
    }
    if ("lines" in body) {
      const existingById = new Map(tableOrder.lines.map((line) => [line.id, line]));
      const nextLines = [];
      const itemsToValidate = [];
      const itemsToDecrement = [];
      const itemsToRefund = [];

      for (const input of body.lines || []) {
        const existing = existingById.get(input.id);
        if (!existing) continue;
        const quantity = money(input.quantity);
        if (quantity <= 0) continue;

        const diff = quantity - existing.quantity;
        if (diff > 0) {
          itemsToValidate.push({ menuItemId: existing.menuItemId, quantity: diff });
          itemsToDecrement.push({ menuItemId: existing.menuItemId, quantity: diff });
        } else if (diff < 0) {
          itemsToRefund.push({ menuItemId: existing.menuItemId, quantity: Math.abs(diff) });
        }

        nextLines.push({
          ...existing,
          quantity,
          lineTotal: money(existing.unitPrice * quantity),
          notes: String(input.notes || existing.notes || "")
        });
      }
      const removedLines = tableOrder.lines.filter((line) => !nextLines.some((item) => item.id === line.id));
      for (const line of removedLines) {
        itemsToRefund.push({ menuItemId: line.menuItemId, quantity: line.quantity });
      }
      try {
        checkPortionsAvailability(db, itemsToValidate);
      } catch (err) {
        return sendJson(res, 422, { error: err.message });
      }
      decrementPortions(db, itemsToDecrement, tableOrder.branchId);
      refundPortions(db, itemsToRefund, tableOrder.branchId);

      const removedIds = removedLines.map((line) => line.id);
      for (const kot of db.kots.filter((item) => item.tableOrderId === tableOrder.id && item.status === "new")) {
        kot.lines = kot.lines.filter((line) => !removedIds.includes(line.id));
        for (const line of kot.lines) {
          const updated = nextLines.find((item) => item.id === line.id);
          if (updated) {
            line.quantity = updated.quantity;
            line.lineTotal = updated.lineTotal;
          }
        }
      }
      tableOrder.lines = nextLines;
    }
    if ("discountPercent" in body) tableOrder.discountPercent = Math.min(100, Math.max(0, Number(body.discountPercent || 0)));
    tableOrder.subtotal = money(tableOrder.lines.reduce((sum, line) => sum + line.lineTotal, 0));
    tableOrder.discount = money(tableOrder.subtotal * (Number(tableOrder.discountPercent || 0) / 100));
    tableOrder.taxableAmount = money(tableOrder.subtotal - tableOrder.discount);
    tableOrder.tax = money(tableOrder.taxableAmount * activeTaxRate(db));
    tableOrder.total = money(tableOrder.taxableAmount + tableOrder.tax);
    tableOrder.updatedBy = user.id;
    tableOrder.updatedAt = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, { tableOrder, tableOrders: db.tableOrders });
  }

  if (req.method === "POST" && pathname.startsWith("/api/table-orders/") && pathname.endsWith("/cancel")) {
    const isAllowedToCancel = ["admin", "owner", "kot_reader"].includes(user.role) || hasPermission(db, user, "order.cancel") || hasPermission(db, user, "pos.use");
    if (!isAllowedToCancel) return sendJson(res, 403, { error: "Cancel approval required (Admin, Owner, or KOT Reader)" });
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const tableOrder = db.tableOrders.find((item) => item.id === id && item.status === "open");
    if (!tableOrder) return sendJson(res, 404, { error: "Open table order not found" });
    if (!canAccessBranch(user, tableOrder.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    tableOrder.status = "cancelled";
    tableOrder.cancelReason = String(body.reason || "Open table removed").trim();
    tableOrder.cancelledBy = user.id;
    tableOrder.cancelledAt = new Date().toISOString();
    refundPortions(db, tableOrder.lines, tableOrder.branchId);
    for (const kot of db.kots.filter((item) => item.tableOrderId === tableOrder.id && item.status !== "served")) {
      kot.status = "cancelled";
    }
    db.auditLogs.push({
      id: createId("audit"),
      type: "table_order_cancelled",
      tableOrderId: tableOrder.id,
      tableNo: tableOrder.tableNo,
      userId: user.id,
      reason: tableOrder.cancelReason,
      createdAt: tableOrder.cancelledAt
    });
    await writeDb(db);
    return sendJson(res, 200, { tableOrder, tableOrders: db.tableOrders });
  }

  if (req.method === "POST" && pathname.startsWith("/api/table-orders/") && pathname.includes("/item/") && pathname.endsWith("/alarm")) {
    const isAllowedToAlarm = ["admin", "owner", "manager", "floor_manager"].includes(user.role) || hasPermission(db, user, "table.use") || hasPermission(db, user, "pos.use");
    if (!isAllowedToAlarm) return sendJson(res, 403, { error: "Floor management access required to trigger alarm" });
    const parts = pathname.split("/");
    const tableOrderId = parts[3];
    const itemId = parts[5];
    const tableOrder = db.tableOrders.find((item) => item.id === tableOrderId && item.status === "open");
    if (!tableOrder) return sendJson(res, 404, { error: "Open table order not found" });
    if (!canAccessBranch(user, tableOrder.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    
    const line = tableOrder.lines.find(l => l.menuItemId === itemId);
    const itemName = line ? line.name : "Item";
    
    // Flag corresponding unserved KOT(s)
    const kots = (db.kots || []).filter(k => k.tableOrderId === tableOrder.id && k.status !== "served");
    for (const kot of kots) {
      const kotLine = kot.lines.find(l => l.menuItemId === itemId);
      if (kotLine) {
        kotLine.isAlerted = true;
        kotLine.alertedAt = new Date().toISOString();
        kot.isAlerted = true;
      }
    }
    
    // Create high-priority notification for KOT Reader / Kitchen
    db.notifications = db.notifications || [];
    db.notifications.push({
      id: createId("not"),
      branchId: tableOrder.branchId,
      title: `🚨 EMERGENCY ALARM: Table ${tableOrder.tableNo}`,
      message: `Specific item "${itemName}" is STILL NOT SERVED at Table ${tableOrder.tableNo}!`,
      type: "kitchen_alarm",
      timestamp: new Date().toISOString(),
      read: false,
      tableOrderId: tableOrderId,
      menuItemId: itemId,
      itemName: itemName,
      tableNo: tableOrder.tableNo,
      triggeredBy: user.name
    });
    
    await writeDb(db);
    return sendJson(res, 200, { success: true, tableOrder, tableOrders: db.tableOrders });
  }

  if (req.method === "POST" && pathname.startsWith("/api/table-orders/") && pathname.endsWith("/settle")) {
    if (!hasPermission(db, user, "pos.use")) return sendJson(res, 403, { error: "Cash counter access required" });
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const tableOrder = db.tableOrders.find((item) => item.id === id && item.status === "open");
    if (!tableOrder) return sendJson(res, 404, { error: "Open table order not found" });
    if (!canAccessBranch(user, tableOrder.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    const discountPercent = Math.min(100, Math.max(0, Number(body.discountPercent ?? tableOrder.discountPercent ?? 0)));
    const subtotal = money(tableOrder.lines.reduce((sum, line) => sum + line.lineTotal, 0));
    const discount = money(subtotal * (discountPercent / 100));
    const taxableAmount = money(subtotal - discount);
    const tax = money(taxableAmount * activeTaxRate(db));

    // Support points redemption discount
    const pointsRedeemed = Number(body.pointsRedeemed || 0);
    const loyaltySettings = db.loyaltySettings || { rupeesPerPoint: 100, rupeeValuePerPoint: 1 };
    const pointsDiscount = money(pointsRedeemed * Number(loyaltySettings.rupeeValuePerPoint || 1));
    const total = money(Math.max(0, taxableAmount + tax - pointsDiscount));

    // Automatically set or normalize single-payment amount to match the exact calculated total to avoid any floating-point/rounding mismatches
    if (body.payments && body.payments.length === 1) {
      body.payments[0].amount = total;
    }
    const paidAmount = money((body.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
    if (Math.abs(paidAmount - total) > 0.05) return sendJson(res, 422, { error: `Payment total (${paidAmount}) must match bill total (${total})` });
    
    let createdAtVal = new Date().toISOString();
    let businessDateVal = currentBusinessDate();
    if (user.role === "admin" && body.customCreatedAt) {
      try {
        const customDate = new Date(body.customCreatedAt);
        if (!isNaN(customDate.getTime())) {
          createdAtVal = customDate.toISOString();
          businessDateVal = body.customBusinessDate || body.customCreatedAt.substring(0, 10);
        }
      } catch (e) {
        // ignore
      }
    }

    const order = {
      id: createId("ord"),
      billNo: `${tableOrder.branchId.toUpperCase()}-${Date.now().toString().slice(-6)}`,
      branchId: tableOrder.branchId,
      orderType: "dine-in",
      tableNo: tableOrder.tableNo,
      serverId: tableOrder.serverId,
      serverName: tableOrder.serverName,
      customerName: body.customerName || "",
      customerPhone: body.customerPhone || "",
      pointsRedeemed,
      pointsDiscount,
      lines: tableOrder.lines,
      subtotal,
      discountPercent,
      discount,
      taxableAmount,
      tax,
      total,
      payments: body.payments,
      status: "paid",
      createdBy: user.id,
      businessDate: businessDateVal,
      createdAt: createdAtVal
    };
    tableOrder.status = "settled";
    tableOrder.discountPercent = discountPercent;
    tableOrder.discount = discount;
    tableOrder.taxableAmount = taxableAmount;
    tableOrder.tax = tax;
    tableOrder.total = total;
    tableOrder.settledOrderId = order.id;
    tableOrder.settledBy = user.id;
    tableOrder.settledAt = order.createdAt;
    db.orders.push(order);
    handleCustomerOnOrder(db, order);
    await writeDb(db);
    return sendJson(res, 201, { order, tableOrder, summary: dailySummary(db) });
  }

  if (req.method === "POST" && pathname === "/api/orders") {
    if (!hasPermission(db, user, "pos.use")) return sendJson(res, 403, { error: "POS access required" });
    const body = await parseBody(req);
    if (!canAccessBranch(user, body.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    try {
      checkPortionsAvailability(db, body.items || []);
    } catch (err) {
      return sendJson(res, 422, { error: err.message });
    }
    const calculated = calculateOrder(db, body.items || [], body.discountPercent || 0);
    if (!calculated.lines.length) return sendJson(res, 422, { error: "At least one order item is required" });
    decrementPortions(db, calculated.lines, body.branchId);

    // Support points redemption discount
    const pointsRedeemed = Number(body.pointsRedeemed || 0);
    const loyaltySettings = db.loyaltySettings || { rupeesPerPoint: 100, rupeeValuePerPoint: 1 };
    const pointsDiscount = money(pointsRedeemed * Number(loyaltySettings.rupeeValuePerPoint || 1));
    const deliveryFeeVal = body.orderType === "delivery" ? Number(body.deliveryFee || 0) : 0;
    const deliveryTipVal = body.orderType === "delivery" ? Number(body.deliveryTip || 0) : 0;
    const finalTotal = money(Math.max(0, calculated.total + deliveryFeeVal + deliveryTipVal - pointsDiscount));

    const paidAmount = money((body.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
    if (paidAmount !== finalTotal) return sendJson(res, 422, { error: "Payment total must match bill total" });
    
    let createdAtVal = new Date().toISOString();
    let businessDateVal = currentBusinessDate();
    if (user.role === "admin" && body.customCreatedAt) {
      try {
        const customDate = new Date(body.customCreatedAt);
        if (!isNaN(customDate.getTime())) {
          createdAtVal = customDate.toISOString();
          businessDateVal = body.customBusinessDate || body.customCreatedAt.substring(0, 10);
        }
      } catch (e) {
        // ignore
      }
    }

    const order = {
      id: createId("ord"),
      billNo: `${body.branchId.toUpperCase()}-${Date.now().toString().slice(-6)}`,
      branchId: body.branchId,
      orderType: body.orderType || "takeaway",
      tableNo: body.tableNo || "",
      customerName: body.customerName || "",
      customerPhone: body.customerPhone || "",
      pointsRedeemed,
      pointsDiscount,
      deliveryAddress: body.deliveryAddress || "",
      deliveryStatus: body.deliveryStatus || (body.orderType === "delivery" ? "pending" : ""),
      deliveryAgent: body.deliveryAgent || "",
      deliveryFee: Number(body.deliveryFee) || 0,
      deliveryTip: Number(body.deliveryTip) || 0,
      lines: calculated.lines,
      subtotal: calculated.subtotal,
      discountPercent: calculated.discountPercent,
      discount: calculated.discount,
      taxableAmount: calculated.taxableAmount,
      tax: calculated.tax,
      total: finalTotal,
      payments: body.payments,
      status: "paid",
      createdBy: user.id,
      businessDate: businessDateVal,
      createdAt: createdAtVal
    };
    const dailyOrderNo = getNextDailyOrderNo(db, order.branchId, order.businessDate);
    order.dailyOrderNo = dailyOrderNo;
    const kot = {
      id: createId("kot"),
      orderId: order.id,
      billNo: order.billNo,
      dailyOrderNo: dailyOrderNo,
      branchId: order.branchId,
      tableNo: order.tableNo,
      orderType: order.orderType,
      lines: order.lines,
      status: "new",
      notes: order.notes || "",
      createdAt: order.createdAt
    };
    db.orders.push(order);
    db.kots.push(kot);
    handleCustomerOnOrder(db, order);
    db.notifications = db.notifications || [];
    db.notifications.push({
      id: createId("not"),
      branchId: kot.branchId,
      title: `New KOT (${kot.billNo})`,
      message: `${kot.orderType === "dine-in" ? `Table ${kot.tableNo}` : kot.orderType.toUpperCase()} order sent to kitchen.`,
      type: "kot_new",
      timestamp: new Date().toISOString(),
      read: false
    });
    await writeDb(db);
    return sendJson(res, 201, { order, kot, summary: dailySummary(db) });
  }

  if (req.method === "POST" && pathname === "/api/orders/sync-deltas") {
    if (!hasPermission(db, user, "pos.use")) return sendJson(res, 403, { error: "POS access required" });
    const body = await parseBody(req);
    const deltas = body.deltas;
    if (!Array.isArray(deltas)) {
      return sendJson(res, 400, { error: "Invalid deltas format. Expected an array." });
    }

    const results = [];
    let syncedCount = 0;

    for (const orderDelta of deltas) {
      const exists = db.orders.some(o => o.id === orderDelta.id || o.billNo === orderDelta.billNo);
      if (exists) {
        results.push({ id: orderDelta.id, status: "ignored_duplicate" });
        continue;
      }

      if (!canAccessBranch(user, orderDelta.branchId)) {
        results.push({ id: orderDelta.id, status: "error", error: "Branch access denied" });
        continue;
      }

      try {
        checkPortionsAvailability(db, orderDelta.items || []);
      } catch (err) {
        results.push({ id: orderDelta.id, status: "error", error: err.message });
        continue;
      }

      const calculated = calculateOrder(db, orderDelta.items || [], orderDelta.discountPercent || 0);
      if (!calculated.lines.length) {
        results.push({ id: orderDelta.id, status: "error", error: "At least one order item is required" });
        continue;
      }

      decrementPortions(db, calculated.lines, orderDelta.branchId);

      const pointsRedeemed = Number(orderDelta.pointsRedeemed || 0);
      const loyaltySettings = db.loyaltySettings || { rupeesPerPoint: 100, rupeeValuePerPoint: 1 };
      const pointsDiscount = money(pointsRedeemed * Number(loyaltySettings.rupeeValuePerPoint || 1));
      const deliveryFeeVal = orderDelta.orderType === "delivery" ? Number(orderDelta.deliveryFee || 0) : 0;
      const deliveryTipVal = orderDelta.orderType === "delivery" ? Number(orderDelta.deliveryTip || 0) : 0;
      const finalTotal = money(Math.max(0, calculated.total + deliveryFeeVal + deliveryTipVal - pointsDiscount));

      let createdAtVal = orderDelta.createdAt || new Date().toISOString();
      let businessDateVal = orderDelta.businessDate || currentBusinessDate();

      const order = {
        id: orderDelta.id || createId("ord"),
        billNo: orderDelta.billNo || `${orderDelta.branchId.toUpperCase()}-${Date.now().toString().slice(-6)}`,
        branchId: orderDelta.branchId,
        orderType: orderDelta.orderType || "takeaway",
        tableNo: orderDelta.tableNo || "",
        customerName: orderDelta.customerName || "",
        customerPhone: orderDelta.customerPhone || "",
        pointsRedeemed,
        pointsDiscount,
        deliveryAddress: orderDelta.deliveryAddress || "",
        deliveryStatus: orderDelta.deliveryStatus || (orderDelta.orderType === "delivery" ? "pending" : ""),
        deliveryAgent: orderDelta.deliveryAgent || "",
        deliveryFee: Number(orderDelta.deliveryFee) || 0,
        deliveryTip: Number(orderDelta.deliveryTip) || 0,
        lines: calculated.lines,
        subtotal: calculated.subtotal,
        discountPercent: calculated.discountPercent,
        discount: calculated.discount,
        taxableAmount: calculated.taxableAmount,
        tax: calculated.tax,
        total: finalTotal,
        payments: orderDelta.payments,
        status: "paid",
        createdBy: user.id,
        businessDate: businessDateVal,
        createdAt: createdAtVal
      };

      const dailyOrderNo = getNextDailyOrderNo(db, order.branchId, order.businessDate);
      order.dailyOrderNo = dailyOrderNo;

      const kot = {
        id: createId("kot"),
        orderId: order.id,
        billNo: order.billNo,
        dailyOrderNo: dailyOrderNo,
        branchId: order.branchId,
        tableNo: order.tableNo,
        orderType: order.orderType,
        lines: order.lines,
        status: "new",
        notes: orderDelta.notes || "",
        createdAt: order.createdAt
      };

      db.orders.push(order);
      db.kots.push(kot);
      handleCustomerOnOrder(db, order);
      
      db.notifications = db.notifications || [];
      db.notifications.push({
        id: createId("not"),
        branchId: kot.branchId,
        title: `New KOT (${kot.billNo})`,
        message: `${kot.orderType === "dine-in" ? `Table ${kot.tableNo}` : kot.orderType.toUpperCase()} order sent to kitchen.`,
        type: "kot_new",
        timestamp: new Date().toISOString(),
        read: false
      });

      syncedCount++;
      results.push({ id: orderDelta.id, status: "success", billNo: order.billNo });
    }

    if (syncedCount > 0) {
      await writeDb(db);
    }

    return sendJson(res, 200, { results, syncedCount, summary: dailySummary(db) });
  }

  if (req.method === "POST" && pathname.startsWith("/api/orders/") && pathname.endsWith("/cancel")) {
    const isAllowedToCancel = ["admin", "owner", "kot_reader"].includes(user.role) || hasPermission(db, user, "order.cancel");
    if (!isAllowedToCancel) return sendJson(res, 403, { error: "Cancel approval required (Admin, Owner, or KOT Reader)" });
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const order = db.orders.find((item) => item.id === id);
    order.status = "cancelled";
    order.cancelReason = body.reason || "No reason provided";
    order.cancelledBy = user.id;
    order.cancelledAt = new Date().toISOString();
    refundPortions(db, order.lines, order.branchId);
    db.auditLogs.push({ id: createId("audit"), type: "order_cancelled", orderId: order.id, userId: user.id, reason: order.cancelReason, createdAt: order.cancelledAt });
    handleCancelCustomerOnOrder(db, order);
    await writeDb(db);
    return sendJson(res, 200, { order, summary: dailySummary(db) });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/orders/") && pathname.endsWith("/delivery")) {
    if (!hasPermission(db, user, "delivery.use") && !hasPermission(db, user, "pos.use")) return sendJson(res, 403, { error: "Access denied" });
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const order = db.orders.find((item) => item.id === id);
    if (!order) return sendJson(res, 404, { error: "Order not found" });
    if (!canAccessBranch(user, order.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    if ("deliveryStatus" in body) order.deliveryStatus = body.deliveryStatus;
    if ("deliveryAgent" in body) order.deliveryAgent = body.deliveryAgent;
    if ("deliveryFee" in body) {
      const oldFee = order.deliveryFee || 0;
      const newFee = Number(body.deliveryFee) || 0;
      order.deliveryFee = newFee;
      order.total = order.total - oldFee + newFee;
    }
    if ("deliveryTip" in body) {
      const oldTip = order.deliveryTip || 0;
      const newTip = Number(body.deliveryTip) || 0;
      order.deliveryTip = newTip;
      order.total = order.total - oldTip + newTip;
    }
    if ("status" in body) {
      order.status = body.status;
    }
    if ("paymentMode" in body) {
      order.payments = [{ mode: body.paymentMode, amount: order.total }];
    } else if (order.payments && order.payments.length > 0) {
      order.payments[0].amount = order.total;
    }
    await writeDb(db);
    return sendJson(res, 200, { order });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/orders/") && pathname.endsWith("/transaction")) {
    if (!hasPermission(db, user, "pos.use") && !hasPermission(db, user, "bills.use")) return sendJson(res, 403, { error: "Access denied" });
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const order = db.orders.find((item) => item.id === id);
    if (!order) return sendJson(res, 404, { error: "Order not found" });
    if (!canAccessBranch(user, order.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    
    order.transactionId = body.transactionId || "";
    if (order.payments && order.payments.length > 0) {
      order.payments[0].transactionId = body.transactionId || "";
    }
    await writeDb(db);
    return sendJson(res, 200, { order });
  }

  if (req.method === "POST" && pathname.startsWith("/api/orders/") && pathname.endsWith("/send-to-kitchen")) {
    if (!hasPermission(db, user, "delivery.use") && !hasPermission(db, user, "pos.use")) return sendJson(res, 403, { error: "Access denied" });
    const id = pathname.split("/")[3];
    const order = db.orders.find((item) => item.id === id);
    if (!order) return sendJson(res, 404, { error: "Order not found" });
    if (!canAccessBranch(user, order.branchId)) return sendJson(res, 403, { error: "Branch access denied" });

    const existingKot = db.kots.find((k) => k.orderId === order.id);
    if (existingKot) {
      return sendJson(res, 400, { error: "Order has already been sent to kitchen" });
    }

    const dailyOrderNo = getNextDailyOrderNo(db, order.branchId, order.businessDate);
    order.dailyOrderNo = dailyOrderNo;
    const kot = {
      id: createId("kot"),
      orderId: order.id,
      billNo: order.billNo,
      dailyOrderNo: dailyOrderNo,
      branchId: order.branchId,
      tableNo: "",
      orderType: "delivery",
      lines: order.lines,
      status: "new",
      notes: order.notes || "",
      createdAt: new Date().toISOString()
    };

    db.kots = db.kots || [];
    db.kots.push(kot);

    db.notifications = db.notifications || [];
    db.notifications.push({
      id: createId("not"),
      branchId: order.branchId,
      title: `New KOT (${kot.billNo})`,
      message: `Online delivery order sent to kitchen.`,
      type: "kot_new",
      timestamp: new Date().toISOString(),
      read: false
    });

    await writeDb(db);
    return sendJson(res, 200, { success: true, order, kot });
  }

  if (req.method === "GET" && pathname === "/api/kots") {
    if (!hasPermission(db, user, "kitchen.use") && !hasPermission(db, user, "reports.view")) return sendJson(res, 403, { error: "KOT access required" });
    const activeKots = db.kots.filter(k => k.status !== "served" && k.status !== "cancelled");
    const recentKots = db.kots.slice(-100);
    const kotMap = new Map();
    for (const k of [...activeKots, ...recentKots]) {
      kotMap.set(k.id, k);
    }
    return sendJson(res, 200, Array.from(kotMap.values()).reverse());
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/kots/")) {
    if (!hasPermission(db, user, "kitchen.use")) return sendJson(res, 403, { error: "Kitchen access required" });
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const kot = db.kots.find((item) => item.id === id);
    if (!kot) return sendJson(res, 404, { error: "KOT not found" });
    if (!canAccessBranch(user, kot.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    kot.status = body.status;
    kot.updatedAt = new Date().toISOString();

    if (body.status === "ready") {
      db.notifications = db.notifications || [];
      db.notifications.push({
        id: createId("not"),
        branchId: kot.branchId,
        title: `KOT Ready (${kot.billNo})`,
        message: `${kot.orderType === "dine-in" ? `Table ${kot.tableNo}` : kot.orderType.toUpperCase()} items are prepared and ready to serve!`,
        type: "kot_ready",
        timestamp: new Date().toISOString(),
        read: false
      });
    }

    await writeDb(db);
    return sendJson(res, 200, { kot, summary: dailySummary(db) });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/kots/")) {
    if (!hasPermission(db, user, "kitchen.use")) return sendJson(res, 403, { error: "Kitchen access required" });
    const id = pathname.split("/")[3];
    const kotIndex = db.kots.findIndex((item) => item.id === id);
    if (kotIndex === -1) return sendJson(res, 404, { error: "KOT not found" });
    const kot = db.kots[kotIndex];
    if (!canAccessBranch(user, kot.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    db.kots.splice(kotIndex, 1);
    await writeDb(db);
    return sendJson(res, 200, { success: true, summary: dailySummary(db) });
  }

  if (req.method === "POST" && pathname === "/api/categories") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const category = {
      id: createId("cat"),
      name: requireText(body.name, "Category name"),
      sortOrder: Number(body.sortOrder || db.categories.length + 1),
      active: true
    };
    db.categories.push(category);
    await writeDb(db);
    return sendJson(res, 201, { category, categories: db.categories });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/categories/")) {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const category = db.categories.find((item) => item.id === id);
    if (!category) return sendJson(res, 404, { error: "Category not found" });
    if ("name" in body) category.name = requireText(body.name, "Category name");
    if ("sortOrder" in body) category.sortOrder = Number(body.sortOrder || 0);
    if ("active" in body) category.active = Boolean(body.active);
    await writeDb(db);
    return sendJson(res, 200, { category, categories: db.categories });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/categories/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    const category = db.categories.find((item) => item.id === id);
    if (!category) return sendJson(res, 404, { error: "Category not found" });
    category.active = false;
    await writeDb(db);
    return sendJson(res, 200, { category, categories: db.categories });
  }

  if (req.method === "POST" && pathname === "/api/menu-items") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const category = db.categories.find((item) => item.id === body.categoryId);
    if (!category) return sendJson(res, 422, { error: "Valid category is required" });
    
    const menuItemId = createId("mi");
    let imageToSave = body.image || "";
    if (imageToSave && imageToSave.startsWith("data:")) {
      await saveMenuItemImage(menuItemId, imageToSave);
      imageToSave = "/api/public/menu-item-image/" + menuItemId;
    }

    const menuItem = {
      id: menuItemId,
      code: requireText(body.code, "Product code").toUpperCase(),
      categoryId: body.categoryId,
      name: requireText(body.name, "Menu item name"),
      price: money(body.price),
      kitchenStation: requireText(body.kitchenStation || "counter", "Kitchen station"),
      active: body.active !== false,
      partnerShopId: body.partnerShopId || null,
      partnerCostPrice: body.costPrice ? money(body.costPrice) : body.partnerCostPrice ? money(body.partnerCostPrice) : 0,
      costPrice: body.costPrice ? money(body.costPrice) : body.partnerCostPrice ? money(body.partnerCostPrice) : 0,
      partnerMarkup: body.partnerMarkup !== undefined ? Number(body.partnerMarkup) : 0,
      preparationTime: Number(body.preparationTime) || 0,
      portionsAvailable: body.portionsAvailable !== undefined && body.portionsAvailable !== "" && body.portionsAvailable !== null ? Number(body.portionsAvailable) : null,
      portionsWarningLimit: Number(body.portionsWarningLimit) || 0,
      preparedQty: Number(body.preparedQty) || 0,
      yieldPerUnit: Number(body.yieldPerUnit) || 0,
      image: imageToSave,
      description: body.description || "",
      outOfStock: body.outOfStock === true || body.outOfStock === "true",
      availableForDelivery: body.availableForDelivery !== false
    };
    if (db.menuItems.some((item) => item.code?.toUpperCase() === menuItem.code)) {
      return sendJson(res, 422, { error: "Product code already exists" });
    }
    db.menuItems.push(menuItem);
    await writeDb(db);
    return sendJson(res, 201, { menuItem: sanitizeMenuItem(menuItem), menuItems: sanitizeMenuItems(db.menuItems) });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/menu-items/")) {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const menuItem = db.menuItems.find((item) => item.id === id);
    if (!menuItem) return sendJson(res, 404, { error: "Menu item not found" });
    if ("categoryId" in body) {
      const category = db.categories.find((item) => item.id === body.categoryId);
      if (!category) return sendJson(res, 422, { error: "Valid category is required" });
      menuItem.categoryId = body.categoryId;
    }
    if ("code" in body) {
      const code = requireText(body.code, "Product code").toUpperCase();
      if (db.menuItems.some((item) => item.id !== id && item.code?.toUpperCase() === code)) {
        return sendJson(res, 422, { error: "Product code already exists" });
      }
      menuItem.code = code;
    }
    if ("name" in body) menuItem.name = requireText(body.name, "Menu item name");
    if ("price" in body) menuItem.price = money(body.price);
    if ("kitchenStation" in body) menuItem.kitchenStation = requireText(body.kitchenStation, "Kitchen station");
    if ("active" in body) menuItem.active = Boolean(body.active);
    if ("partnerShopId" in body) menuItem.partnerShopId = body.partnerShopId || null;
    if ("partnerMarkup" in body) menuItem.partnerMarkup = Number(body.partnerMarkup) || 0;
    if ("costPrice" in body || "partnerCostPrice" in body) {
      const c = body.costPrice !== undefined ? body.costPrice : body.partnerCostPrice;
      menuItem.costPrice = c ? money(c) : 0;
      menuItem.partnerCostPrice = c ? money(c) : 0;
    }
    if ("preparationTime" in body) menuItem.preparationTime = Number(body.preparationTime) || 0;
    if ("portionsAvailable" in body) {
      menuItem.portionsAvailable = body.portionsAvailable !== undefined && body.portionsAvailable !== "" && body.portionsAvailable !== null ? Number(body.portionsAvailable) : null;
    }
    if ("portionsWarningLimit" in body) menuItem.portionsWarningLimit = Number(body.portionsWarningLimit) || 0;
    if ("preparedQty" in body) menuItem.preparedQty = Number(body.preparedQty) || 0;
    if ("yieldPerUnit" in body) menuItem.yieldPerUnit = Number(body.yieldPerUnit) || 0;
    if ("image" in body) {
      let imageToSave = body.image || "";
      if (imageToSave && imageToSave.startsWith("data:")) {
        await saveMenuItemImage(id, imageToSave);
        imageToSave = "/api/public/menu-item-image/" + id;
      }
      menuItem.image = imageToSave;
    }
    if ("description" in body) menuItem.description = body.description || "";
    if ("outOfStock" in body) menuItem.outOfStock = Boolean(body.outOfStock);
    if ("availableForDelivery" in body) menuItem.availableForDelivery = Boolean(body.availableForDelivery);
    await writeDb(db);
    return sendJson(res, 200, { menuItem: sanitizeMenuItem(menuItem), menuItems: sanitizeMenuItems(db.menuItems) });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/menu-items/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    const menuItem = db.menuItems.find((item) => item.id === id);
    if (!menuItem) return sendJson(res, 404, { error: "Menu item not found" });
    menuItem.active = false;
    await writeDb(db);
    return sendJson(res, 200, { menuItem: sanitizeMenuItem(menuItem), menuItems: sanitizeMenuItems(db.menuItems) });
  }

  if (req.method === "GET" && pathname === "/api/inventory") {
    if (!hasPermission(db, user, "inventory.view") && !hasPermission(db, user, "purchase.manage")) return sendJson(res, 403, { error: "Inventory access required" });
    return sendJson(res, 200, db.inventory);
  }

  if (req.method === "GET" && pathname === "/api/stock-usages") {
    if (!hasPermission(db, user, "inventory.view") && !hasPermission(db, user, "purchase.manage")) return sendJson(res, 403, { error: "Inventory access required" });
    const cached = getReportsCache(req.url);
    if (cached) return sendJson(res, 200, cached);
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    const usages = (db.stockUsages || []).filter((usage) => branchId === "all" || usage.branchId === branchId);
    const result = usages.slice().reverse();
    setReportsCache(req.url, result);
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/stock-usages") {
    if (!hasPermission(db, user, "purchase.manage")) return sendJson(res, 403, { error: "Stock usage access required" });
    const body = await parseBody(req);
    if (!canAccessBranch(user, body.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    const stock = db.inventory.find((item) => item.id === body.inventoryId && item.branchId === body.branchId && item.active !== false);
    if (!stock) return sendJson(res, 404, { error: "Stock item not found" });
    const enteredQuantity = money(body.quantity);
    if (enteredQuantity <= 0) return sendJson(res, 422, { error: "Usage quantity must be greater than zero" });
    const stockQuantity = convertStockUsage(enteredQuantity, body.unit || stock.unit, stock.unit);
    if (stockQuantity > Number(stock.quantity || 0)) {
      return sendJson(res, 422, { error: `Only ${stock.quantity} ${stock.unit} available` });
    }
    const selectedKitchen = body.kitchen || stock.kitchen || "Main Kitchen";
    if (body.kitchen) {
      stock.kitchen = body.kitchen;
    }
    stock.quantity = money(Number(stock.quantity || 0) - stockQuantity);
    const usage = {
      id: createId("usage"),
      branchId: body.branchId,
      inventoryId: stock.id,
      itemName: stock.name,
      kitchen: selectedKitchen,
      enteredQuantity,
      enteredUnit: body.unit || stock.unit,
      stockQuantity,
      stockUnit: stock.unit,
      balanceAfter: stock.quantity,
      purpose: String(body.purpose || "Cooking").trim(),
      notes: String(body.notes || "").trim(),
      costValue: money(stockQuantity * (stock.lastCost || 0)),
      createdBy: user.id,
      createdByName: user.name,
      createdAt: new Date().toISOString()
    };
    db.stockUsages.push(usage);
    await writeDb(db);
    return sendJson(res, 201, { usage, stock, inventory: db.inventory, stockUsages: db.stockUsages.slice().reverse(), summary: dailySummary(db) });
  }

  if (req.method === "GET" && pathname === "/api/supplier-bills") {
    if (!hasPermission(db, user, "purchase.manage")) return sendJson(res, 403, { error: "Purchase access required" });
    return sendJson(res, 200, db.supplierBills || []);
  }

  if (req.method === "GET" && pathname === "/api/supplier-orders") {
    if (!hasPermission(db, user, "purchase.manage")) return sendJson(res, 403, { error: "Purchase access required" });
    return sendJson(res, 200, db.supplierOrders || []);
  }

  if (req.method === "GET" && pathname === "/api/inventory/reorder-recommendations") {
    if (!hasPermission(db, user, "purchase.manage")) return sendJson(res, 403, { error: "Purchase access required" });
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const supplierId = params.get("supplierId");
    const branchId = params.get("branchId") || "all";
    if (!canAccessBranch(user, branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    
    // Find active inventory items
    const supplierItems = db.inventory.filter((item) => 
      (branchId === "all" || item.branchId === branchId) && 
      item.active !== false && 
      (supplierId ? item.supplierIds?.includes(supplierId) : true)
    );
    
    const recommendations = [];
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    for (const item of supplierItems) {
      const usages = (db.stockUsages || []).filter((u) => 
        u.inventoryId === item.id && 
        (branchId === "all" || u.branchId === branchId) && 
        new Date(u.createdAt) >= sevenDaysAgo
      );
      const totalConsumedInSevenDays = usages.reduce((sum, u) => sum + Number(u.stockQuantity || 0), 0);
      const dailyConsumptionRate = money(totalConsumedInSevenDays / 7);
      
      const availableStock = Number(item.quantity || 0);
      const minStock = Number(item.reorderLevel || 0);
      
      const sufficientStockThreshold = money(minStock + (dailyConsumptionRate * 3));
      const isSufficientlyStocked = availableStock >= sufficientStockThreshold;
      
      let recommendedQty = 0;
      if (!isSufficientlyStocked) {
        recommendedQty = money(Math.max(0, (minStock + (dailyConsumptionRate * 7)) - availableStock));
        if (recommendedQty <= 0) {
          recommendedQty = money(Math.max(1, minStock - availableStock));
        }
      }
      
      recommendations.push({
        inventoryId: item.id,
        name: item.name,
        unit: item.unit,
        availableStock,
        minStock,
        dailyConsumptionRate,
        sufficientStockThreshold,
        isSufficientlyStocked,
        recommendedQty
      });
    }
    
    return sendJson(res, 200, recommendations);
  }

  if (req.method === "POST" && pathname === "/api/inventory") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    if (!canAccessBranch(user, body.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    const inventoryItem = {
      id: createId("inv"),
      branchId: body.branchId,
      name: requireText(body.name, "Stock item name"),
      brandName: String(body.brandName || "").trim(),
      unit: requireText(body.unit, "Unit"),
      quantity: money(body.quantity),
      reorderLevel: money(body.reorderLevel),
      lastCost: money(body.lastCost),
      supplierIds: Array.isArray(body.supplierIds) ? body.supplierIds : body.supplierId ? [body.supplierId] : [],
      itemType: body.itemType || "raw",
      kitchen: String(body.kitchen || "Main Kitchen").trim(),
      expiryDate: String(body.expiryDate || "").trim(),
      active: body.active !== false,
      priceHistory: [{ date: currentBusinessDate(), cost: money(body.lastCost) }]
    };
    db.inventory.push(inventoryItem);
    await writeDb(db);
    return sendJson(res, 201, { inventoryItem, inventory: db.inventory, summary: dailySummary(db) });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/inventory/")) {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const inventoryItem = db.inventory.find((item) => item.id === id);
    if (!inventoryItem) return sendJson(res, 404, { error: "Stock item not found" });
    if (!canAccessBranch(user, inventoryItem.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    if ("name" in body) inventoryItem.name = requireText(body.name, "Stock item name");
    if ("brandName" in body) inventoryItem.brandName = String(body.brandName || "").trim();
    if ("unit" in body) inventoryItem.unit = requireText(body.unit, "Unit");
    if ("quantity" in body) inventoryItem.quantity = money(body.quantity);
    if ("reorderLevel" in body) inventoryItem.reorderLevel = money(body.reorderLevel);
    if ("lastCost" in body) {
      inventoryItem.lastCost = money(body.lastCost);
      addPriceHistory(inventoryItem, body.lastCost);
    }
    if ("supplierIds" in body) inventoryItem.supplierIds = Array.isArray(body.supplierIds) ? body.supplierIds : [];
    if ("supplierId" in body) inventoryItem.supplierIds = body.supplierId ? [body.supplierId] : [];
    if ("itemType" in body) inventoryItem.itemType = body.itemType;
    if ("kitchen" in body) inventoryItem.kitchen = String(body.kitchen || "Main Kitchen").trim();
    if ("expiryDate" in body) inventoryItem.expiryDate = String(body.expiryDate || "").trim();
    if ("active" in body) inventoryItem.active = Boolean(body.active);
    await writeDb(db);
    return sendJson(res, 200, { inventoryItem, inventory: db.inventory, summary: dailySummary(db) });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/inventory/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    const inventoryItem = db.inventory.find((item) => item.id === id);
    if (!inventoryItem) return sendJson(res, 404, { error: "Stock item not found" });
    inventoryItem.active = false;
    await writeDb(db);
    return sendJson(res, 200, { inventoryItem, inventory: db.inventory, summary: dailySummary(db) });
  }

  if (req.method === "POST" && (pathname === "/api/inventory/physical-count" || pathname === "/api/inventory/daily-count")) {
    if (!hasPermission(db, user, "purchase.manage") && !hasPermission(db, user, "pos.use")) {
      return sendJson(res, 403, { error: "Access denied" });
    }
    const body = await parseBody(req);
    const branchId = body.branchId;
    if (!canAccessBranch(user, branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    
    const counts = body.counts || [];
    const adjusted = [];
    
    for (const itemCount of counts) {
      const stock = db.inventory.find((item) => item.id === itemCount.inventoryId && item.branchId === branchId && item.active !== false);
      if (!stock) continue;
      
      const previousQty = Number(stock.quantity || 0);
      const physicalQty = Number(itemCount.physicalQty !== undefined ? itemCount.physicalQty : itemCount.actualQuantity);
      if (isNaN(physicalQty) || physicalQty < 0) continue;
      
      const consumedQty = money(previousQty - physicalQty);
      stock.quantity = money(physicalQty);
      
      if (consumedQty > 0) {
        const usage = {
          id: createId("usage"),
          branchId: branchId,
          inventoryId: stock.id,
          itemName: stock.name,
          kitchen: stock.kitchen || "Main Kitchen",
          enteredQuantity: consumedQty,
          enteredUnit: stock.unit,
          stockQuantity: consumedQty,
          stockUnit: stock.unit,
          balanceAfter: physicalQty,
          purpose: String(itemCount.purpose || "Daily Stock Consumption").trim(),
          notes: String(itemCount.notes || `Physical check adjustment (Previous: ${previousQty}, Physical: ${physicalQty})`).trim(),
          costValue: money(consumedQty * (stock.lastCost || 0)),
          createdBy: user.id,
          createdByName: user.name,
          createdAt: new Date().toISOString()
        };
        db.stockUsages.push(usage);
        adjusted.push({ id: stock.id, name: stock.name, consumedQty, previousQty, physicalQty });
      } else if (consumedQty < 0) {
        const usage = {
          id: createId("usage"),
          branchId: branchId,
          inventoryId: stock.id,
          itemName: stock.name,
          kitchen: stock.kitchen || "Main Kitchen",
          enteredQuantity: consumedQty,
          enteredUnit: stock.unit,
          stockQuantity: consumedQty,
          stockUnit: stock.unit,
          balanceAfter: physicalQty,
          purpose: "Physical Stock Inward Correction",
          notes: `Correction (Previous: ${previousQty}, Physical: ${physicalQty})`,
          costValue: money(consumedQty * (stock.lastCost || 0)),
          createdBy: user.id,
          createdByName: user.name,
          createdAt: new Date().toISOString()
        };
        db.stockUsages.push(usage);
        adjusted.push({ id: stock.id, name: stock.name, consumedQty, previousQty, physicalQty });
      }
    }
    
    await writeDb(db);
    return sendJson(res, 200, { 
      success: true, 
      adjusted, 
      inventory: db.inventory, 
      stockUsages: db.stockUsages.slice().reverse(),
      summary: dailySummary(db)
    });
  }

  if (req.method === "GET" && pathname === "/api/loyalty-settings") {
    db.loyaltySettings = db.loyaltySettings || { rupeesPerPoint: 100, rupeeValuePerPoint: 1 };
    return sendJson(res, 200, db.loyaltySettings);
  }

  if (req.method === "POST" && pathname === "/api/loyalty-settings") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    db.loyaltySettings = {
      rupeesPerPoint: Number(body.rupeesPerPoint) || 100,
      rupeeValuePerPoint: Number(body.rupeeValuePerPoint) || 1
    };
    await writeDb(db);
    return sendJson(res, 200, { success: true, loyaltySettings: db.loyaltySettings });
  }

  if (req.method === "POST" && pathname === "/api/customers") {
    if (!hasPermission(db, user, "pos.use")) return sendJson(res, 403, { error: "POS access required" });
    const body = await parseBody(req);
    const phone = requireText(body.phone, "Phone number").trim();
    db.customers = db.customers || [];
    if (db.customers.some((c) => c.phone === phone)) {
      return sendJson(res, 422, { error: "Customer with this phone number already exists" });
    }
    const customer = {
      id: createId("cust"),
      name: requireText(body.name, "Customer name").trim(),
      phone,
      totalSales: 0,
      orderCount: 0,
      tier: body.tier || "New",
      discountPercent: Number(body.discountPercent) || 0,
      createdAt: new Date().toISOString()
    };
    db.customers.push(customer);
    await writeDb(db);
    return sendJson(res, 201, { customer, customers: db.customers });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/customers/")) {
    if (!hasPermission(db, user, "pos.use")) return sendJson(res, 403, { error: "POS access required" });
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    db.customers = db.customers || [];
    const customer = db.customers.find((c) => c.id === id);
    if (!customer) return sendJson(res, 404, { error: "Customer not found" });

    if ("name" in body) customer.name = requireText(body.name, "Customer name").trim();
    if ("phone" in body) {
      const newPhone = String(body.phone).trim();
      if (newPhone && db.customers.some((c) => c.phone === newPhone && c.id !== id)) {
        return sendJson(res, 422, { error: "Another customer has this phone number" });
      }
      customer.phone = newPhone;
    }
    if ("tier" in body) customer.tier = body.tier;
    if ("discountPercent" in body) customer.discountPercent = Number(body.discountPercent) || 0;
    
    await writeDb(db);
    return sendJson(res, 200, { customer, customers: db.customers });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/customers/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    db.customers = (db.customers || []).filter((c) => c.id !== id);
    await writeDb(db);
    return sendJson(res, 200, { success: true, customers: db.customers });
  }

  if (req.method === "POST" && pathname === "/api/coupons") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const code = requireText(body.code, "Coupon code").trim().toUpperCase();
    db.coupons = db.coupons || [];
    if (db.coupons.some((c) => c.code === code)) {
      return sendJson(res, 422, { error: "Coupon code already exists" });
    }
    const coupon = {
      id: createId("cp"),
      code,
      discountPercent: Number(body.discountPercent) || 0,
      description: String(body.description || "").trim(),
      minOrderAmount: Number(body.minOrderAmount) || 0,
      active: body.active !== false
    };
    db.coupons.push(coupon);
    await writeDb(db);
    return sendJson(res, 201, { coupon, coupons: db.coupons });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/coupons/")) {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    db.coupons = db.coupons || [];
    const coupon = db.coupons.find((c) => c.id === id);
    if (!coupon) return sendJson(res, 404, { error: "Coupon not found" });

    if ("code" in body) {
      const newCode = requireText(body.code, "Coupon code").trim().toUpperCase();
      if (db.coupons.some((c) => c.code === newCode && c.id !== id)) {
        return sendJson(res, 422, { error: "Another coupon uses this code" });
      }
      coupon.code = newCode;
    }
    if ("discountPercent" in body) coupon.discountPercent = Number(body.discountPercent) || 0;
    if ("description" in body) coupon.description = String(body.description).trim();
    if ("minOrderAmount" in body) coupon.minOrderAmount = Number(body.minOrderAmount) || 0;
    if ("active" in body) coupon.active = Boolean(body.active);

    await writeDb(db);
    return sendJson(res, 200, { coupon, coupons: db.coupons });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/coupons/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    db.coupons = (db.coupons || []).filter((c) => c.id !== id);
    await writeDb(db);
    return sendJson(res, 200, { success: true, coupons: db.coupons });
  }

  if (req.method === "GET" && pathname === "/api/yield-mappings") {
    return sendJson(res, 200, db.yieldMappings || []);
  }

  if (req.method === "POST" && pathname === "/api/yield-mappings") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const mapping = {
      id: createId("yld"),
      rawGroceryId: requireText(body.rawGroceryId, "Raw grocery item"),
      foodItemId: requireText(body.foodItemId, "Finished food item"),
      rawQuantity: Number(body.rawQuantity) || 1,
      expectedYield: Number(body.expectedYield) || 1,
      createdAt: new Date().toISOString()
    };
    db.yieldMappings = db.yieldMappings || [];
    db.yieldMappings.push(mapping);
    await writeDb(db);
    return sendJson(res, 201, { mapping, yieldMappings: db.yieldMappings });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/yield-mappings/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    db.yieldMappings = (db.yieldMappings || []).filter((y) => y.id !== id);
    await writeDb(db);
    return sendJson(res, 200, { success: true, yieldMappings: db.yieldMappings });
  }

  // Ingredient Yields endpoints
  if (req.method === "GET" && pathname === "/api/ingredient-yields") {
    return sendJson(res, 200, db.ingredientYields || []);
  }

  if (req.method === "POST" && pathname === "/api/ingredient-yields") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const item = {
      id: createId("ing_yield"),
      rawGroceryId: requireText(body.rawGroceryId, "Raw stock item"),
      yieldName: requireText(body.yieldName, "Yield Name").toLowerCase().trim(),
      rawQuantity: Number(body.rawQuantity) || 1,
      yieldAmount: Number(body.yieldAmount) || 1,
      active: true,
      createdAt: new Date().toISOString()
    };
    db.ingredientYields = db.ingredientYields || [];
    db.ingredientYields.push(item);
    await writeDb(db);
    return sendJson(res, 201, { item, ingredientYields: db.ingredientYields });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/ingredient-yields/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    db.ingredientYields = (db.ingredientYields || []).filter((y) => y.id !== id);
    // Also clean up any consumptions linked to this yieldName
    await writeDb(db);
    return sendJson(res, 200, { success: true, ingredientYields: db.ingredientYields });
  }

  // Menu Item Consumptions endpoints
  if (req.method === "GET" && pathname === "/api/menu-item-consumptions") {
    return sendJson(res, 200, db.menuItemConsumptions || []);
  }

  if (req.method === "POST" && pathname === "/api/menu-item-consumptions") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const item = {
      id: createId("menu_cons"),
      menuItemId: requireText(body.menuItemId, "Menu Item"),
      ingredientYieldId: requireText(body.ingredientYieldId, "Ingredient Yield reference"),
      consumeAmount: Number(body.consumeAmount) || 1,
      createdAt: new Date().toISOString()
    };
    // Let's resolve the yieldName for convenience
    const y = (db.ingredientYields || []).find((iy) => iy.id === item.ingredientYieldId);
    if (y) {
      item.yieldName = y.yieldName;
    }
    db.menuItemConsumptions = db.menuItemConsumptions || [];
    db.menuItemConsumptions.push(item);
    await writeDb(db);
    return sendJson(res, 201, { item, menuItemConsumptions: db.menuItemConsumptions });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/menu-item-consumptions/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    db.menuItemConsumptions = (db.menuItemConsumptions || []).filter((y) => y.id !== id);
    await writeDb(db);
    return sendJson(res, 200, { success: true, menuItemConsumptions: db.menuItemConsumptions });
  }

  if (req.method === "POST" && pathname === "/api/suppliers") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const supplier = {
      id: createId("sup"),
      name: requireText(body.name, "Supplier name"),
      phone: String(body.phone || "").trim(),
      category: requireText(body.category || "General", "Supplier category"),
      active: body.active !== false,
      pendingAmount: money(body.pendingAmount || 0)
    };
    db.suppliers.push(supplier);
    await writeDb(db);
    return sendJson(res, 201, { supplier, suppliers: db.suppliers });
  }

  if (req.method === "POST" && pathname === "/api/roles") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const role = {
      id: createId("role"),
      name: requireText(body.name, "Role name").toLowerCase().replaceAll(" ", "_"),
      label: requireText(body.label || body.name, "Role label"),
      permissions: Array.isArray(body.permissions) ? body.permissions : [],
      active: body.active !== false
    };
    if (db.roles.some((item) => item.name === role.name)) return sendJson(res, 422, { error: "Role already exists" });
    db.roles.push(role);
    await writeDb(db);
    return sendJson(res, 201, { role, roles: db.roles });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/roles/")) {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const role = db.roles.find((item) => item.id === id);
    if (!role) return sendJson(res, 404, { error: "Role not found" });
    if ("label" in body) role.label = requireText(body.label, "Role label");
    if ("permissions" in body) role.permissions = Array.isArray(body.permissions) ? body.permissions : [];
    if ("active" in body) role.active = Boolean(body.active);
    await writeDb(db);
    return sendJson(res, 200, { role, roles: db.roles });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/roles/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    const role = db.roles.find((item) => item.id === id);
    if (!role) return sendJson(res, 404, { error: "Role not found" });
    role.active = false;
    await writeDb(db);
    return sendJson(res, 200, { role, roles: db.roles });
  }

  if (req.method === "POST" && pathname === "/api/users") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const newUser = {
      id: createId("usr"),
      name: requireText(body.name, "User name"),
      email: requireText(body.email, "Email").toLowerCase(),
      password: requireText(body.password, "Password"),
      role: requireText(body.role, "Role"),
      branchIds: Array.isArray(body.branchIds) ? body.branchIds : [],
      salaryAmount: money(body.salaryAmount || 0),
      salaryType: body.salaryType || "monthly",
      active: body.active !== false
    };
    if (db.users.some((item) => item.email === newUser.email)) return sendJson(res, 422, { error: "Email already exists" });
    db.users.push(newUser);
    await writeDb(db);
    return sendJson(res, 201, { user: sanitizeUser(newUser), users: db.users.map(sanitizeUser) });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/users/")) {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const dbUser = db.users.find((item) => item.id === id);
    if (!dbUser) return sendJson(res, 404, { error: "User not found" });
    if ("name" in body) dbUser.name = requireText(body.name, "User name");
    if ("email" in body) dbUser.email = requireText(body.email, "Email").toLowerCase();
    if ("password" in body && body.password) {
      dbUser.password = requireText(body.password, "Password");
      delete dbUser.passwordHash;
    }
    if ("role" in body) dbUser.role = requireText(body.role, "Role");
    if ("branchIds" in body) dbUser.branchIds = Array.isArray(body.branchIds) ? body.branchIds : [];
    if ("salaryAmount" in body) dbUser.salaryAmount = money(body.salaryAmount || 0);
    if ("salaryType" in body) dbUser.salaryType = body.salaryType || "monthly";
    if ("active" in body) dbUser.active = Boolean(body.active);
    await writeDb(db);
    return sendJson(res, 200, { user: sanitizeUser(dbUser), users: db.users.map(sanitizeUser) });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/users/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    const dbUser = db.users.find((item) => item.id === id);
    if (!dbUser) return sendJson(res, 404, { error: "User not found" });
    dbUser.active = false;
    await writeDb(db);
    return sendJson(res, 200, { user: sanitizeUser(dbUser), users: db.users.map(sanitizeUser) });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/suppliers/")) {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const supplier = db.suppliers.find((item) => item.id === id);
    if (!supplier) return sendJson(res, 404, { error: "Supplier not found" });
    if ("name" in body) supplier.name = requireText(body.name, "Supplier name");
    if ("phone" in body) supplier.phone = String(body.phone || "").trim();
    if ("category" in body) supplier.category = requireText(body.category, "Supplier category");
    if ("active" in body) supplier.active = Boolean(body.active);
    if ("pendingAmount" in body) supplier.pendingAmount = money(body.pendingAmount);
    await writeDb(db);
    return sendJson(res, 200, { supplier, suppliers: db.suppliers });
  }

  if (req.method === "GET" && pathname === "/api/supplier-payments") {
    if (!hasPermission(db, user, "purchase.manage")) return sendJson(res, 403, { error: "Purchase access required" });
    db.supplierPayments = db.supplierPayments || [];
    return sendJson(res, 200, db.supplierPayments);
  }

  if (req.method === "POST" && pathname === "/api/supplier-payments") {
    if (!hasPermission(db, user, "purchase.manage")) return sendJson(res, 403, { error: "Purchase access required" });
    const body = await parseBody(req);
    const supplier = db.suppliers.find((s) => s.id === body.supplierId);
    if (!supplier) return sendJson(res, 422, { error: "Supplier not found" });

    const amount = money(body.amount);
    if (amount <= 0) return sendJson(res, 422, { error: "Payment amount must be greater than 0" });

    const payment = {
      id: createId("spay"),
      supplierId: supplier.id,
      amount,
      paymentDate: body.paymentDate || currentBusinessDate(),
      paymentMode: body.paymentMode || "cash",
      notes: String(body.notes || "").trim(),
      createdBy: user.id,
      createdAt: new Date().toISOString()
    };

    db.supplierPayments = db.supplierPayments || [];
    db.supplierPayments.push(payment);

    // Decrease pending amount on supplier
    supplier.pendingAmount = money((supplier.pendingAmount || 0) - amount);

    await writeDb(db);
    return sendJson(res, 201, { payment, supplierPayments: db.supplierPayments, suppliers: db.suppliers });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/supplier-payments/")) {
    if (!hasPermission(db, user, "purchase.manage")) return sendJson(res, 403, { error: "Purchase access required" });
    const id = pathname.split("/")[3];
    db.supplierPayments = db.supplierPayments || [];
    const paymentIndex = db.supplierPayments.findIndex((p) => p.id === id);
    if (paymentIndex === -1) return sendJson(res, 404, { error: "Payment not found" });

    const payment = db.supplierPayments[paymentIndex];
    const supplier = db.suppliers.find((s) => s.id === payment.supplierId);
    if (supplier) {
      // Increase pending amount back
      supplier.pendingAmount = money((supplier.pendingAmount || 0) + payment.amount);
    }

    db.supplierPayments.splice(paymentIndex, 1);
    await writeDb(db);
    return sendJson(res, 200, { success: true, supplierPayments: db.supplierPayments, suppliers: db.suppliers });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/suppliers/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    const supplier = db.suppliers.find((item) => item.id === id);
    if (!supplier) return sendJson(res, 404, { error: "Supplier not found" });
    supplier.active = false;
    await writeDb(db);
    return sendJson(res, 200, { supplier, suppliers: db.suppliers });
  }

  if (req.method === "POST" && pathname === "/api/branches") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const branch = {
      id: createId("branch"),
      name: requireText(body.name, "Branch name"),
      city: requireText(body.city || "Pondicherry", "City"),
      address: String(body.address || "").trim(),
      phone: String(body.phone || "").trim(),
      timings: String(body.timings || "").trim(),
      active: body.active !== false
    };
    db.branches.push(branch);
    for (const dbUser of db.users) {
      if (["admin", "owner"].includes(dbUser.role) && !dbUser.branchIds.includes(branch.id)) dbUser.branchIds.push(branch.id);
    }
    await writeDb(db);
    return sendJson(res, 201, { branch, branches: db.branches });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/branches/")) {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const branch = db.branches.find((item) => item.id === id);
    if (!branch) return sendJson(res, 404, { error: "Branch not found" });
    if ("name" in body) branch.name = requireText(body.name, "Branch name");
    if ("city" in body) branch.city = requireText(body.city, "City");
    if ("address" in body) branch.address = String(body.address || "").trim();
    if ("phone" in body) branch.phone = String(body.phone || "").trim();
    if ("timings" in body) branch.timings = String(body.timings || "").trim();
    if ("active" in body) branch.active = Boolean(body.active);
    await writeDb(db);
    return sendJson(res, 200, { branch, branches: db.branches });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/branches/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    const branch = db.branches.find((item) => item.id === id);
    if (!branch) return sendJson(res, 404, { error: "Branch not found" });
    branch.active = false;
    await writeDb(db);
    return sendJson(res, 200, { branch, branches: db.branches });
  }

  if (req.method === "POST" && pathname === "/api/tax-rates") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    if (body.active) for (const item of db.taxRates || []) item.active = false;
    const taxRate = {
      id: createId("tax"),
      name: requireText(body.name, "Tax name"),
      rate: money(Number(body.rate || 0) / 100),
      active: body.active !== false
    };
    db.taxRates = db.taxRates || [];
    db.taxRates.push(taxRate);
    if (taxRate.active) db.group.taxRate = taxRate.rate;
    await writeDb(db);
    return sendJson(res, 201, { taxRate, taxRates: db.taxRates, group: db.group });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/tax-rates/")) {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const taxRate = (db.taxRates || []).find((item) => item.id === id);
    if (!taxRate) return sendJson(res, 404, { error: "Tax rate not found" });
    if ("name" in body) taxRate.name = requireText(body.name, "Tax name");
    if ("rate" in body) taxRate.rate = money(Number(body.rate || 0) / 100);
    if ("active" in body) {
      if (body.active) for (const item of db.taxRates) item.active = false;
      taxRate.active = Boolean(body.active);
    }
    if (taxRate.active) db.group.taxRate = taxRate.rate;
    await writeDb(db);
    return sendJson(res, 200, { taxRate, taxRates: db.taxRates, group: db.group });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/tax-rates/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    const taxRate = (db.taxRates || []).find((item) => item.id === id);
    if (!taxRate) return sendJson(res, 404, { error: "Tax rate not found" });
    taxRate.active = false;
    await writeDb(db);
    return sendJson(res, 200, { taxRate, taxRates: db.taxRates, group: db.group });
  }

  if (req.method === "POST" && pathname === "/api/purchases") {
    const body = await parseBody(req);
    if (!hasPermission(db, user, "purchase.manage")) return sendJson(res, 403, { error: "Purchase access required" });
    if (!canAccessBranch(user, body.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    const purchase = {
      id: createId("pur"),
      branchId: body.branchId,
      supplierId: body.supplierId,
      invoiceNo: body.invoiceNo || "",
      total: money(body.total),
      kitchen: body.kitchen || "",
      lines: (body.lines || []).map(line => ({ ...line, kitchen: body.kitchen || "" })),
      createdBy: user.id,
      createdAt: new Date().toISOString()
    };
    for (const line of purchase.lines) {
      const stock = db.inventory.find((item) => item.id === line.inventoryId && item.branchId === body.branchId);
      if (stock) {
        stock.quantity = money(stock.quantity + Number(line.quantity || 0));
        if (body.kitchen) {
          stock.kitchen = body.kitchen;
        }
      }
    }
    db.purchases.push(purchase);
    await writeDb(db);
    return sendJson(res, 201, { purchase, inventory: db.inventory, summary: dailySummary(db) });
  }

  if (req.method === "GET" && pathname === "/api/expenses") {
    if (!hasPermission(db, user, "purchase.manage") && !hasPermission(db, user, "reports.view")) return sendJson(res, 403, { error: "Expenses access required" });
    const cached = getReportsCache(req.url);
    if (cached) return sendJson(res, 200, cached);
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    const period = params.get("period") || "month";
    const date = params.get("date") || currentBusinessDate();
    const { start, end } = periodRange(date, period);
    
    const results = [];
    for (const exp of (db.expenses || [])) {
      if (branchId !== "all" && exp.branchId !== branchId) continue;
      
      const contribution = getExpenseContribution(exp, date, period);
      const isOneTimeInRange = (exp.frequency || "one-time") === "one-time" && exp.expenseDate >= start && exp.expenseDate < end;
      const isRecurringActive = (exp.frequency === "daily" || exp.frequency === "monthly") && exp.expenseDate < end;
      
      if (isOneTimeInRange || isRecurringActive) {
        results.push({
          ...exp,
          calculatedAmount: money(contribution)
        });
      }
    }
    const finalResults = results.slice().reverse();
    setReportsCache(req.url, finalResults);
    return sendJson(res, 200, finalResults);
  }

  if (req.method === "POST" && pathname === "/api/expenses") {
    if (!["admin", "owner"].includes(user.role)) return sendJson(res, 403, { error: "Access denied. Only Admins and Owners can add expenses." });
    const body = await parseBody(req);
    if (!canAccessBranch(user, body.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    const expense = {
      id: createId("exp"),
      branchId: body.branchId,
      expenseDate: body.expenseDate || currentBusinessDate(),
      category: requireText(body.category || "General", "Category"),
      description: requireText(body.description || body.category || "Expense", "Description"),
      amount: money(body.amount),
      frequency: body.frequency || "one-time",
      paymentMode: body.paymentMode || "cash",
      notes: String(body.notes || "").trim(),
      createdBy: user.id,
      createdAt: new Date().toISOString()
    };
    if (expense.category === "Salary") {
      expense.userId = body.userId;
    }
    db.expenses.push(expense);

    if (expense.category === "Salary" && body.userId) {
      db.salaryPayments = db.salaryPayments || [];
      const salaryPaymentType = determineSalaryPaymentType(db, body.userId, expense.expenseDate, expense.amount, null);
      const paymentModeFormatted = expense.paymentMode ? (expense.paymentMode.toLowerCase() === "cash" ? "Cash" : expense.paymentMode.toLowerCase() === "upi" ? "UPI" : expense.paymentMode.toLowerCase() === "card" ? "Card" : "Bank Transfer") : "Cash";
      const payment = {
        id: "sal_exp_" + expense.id,
        userId: body.userId,
        branchId: expense.branchId || "all",
        date: expense.expenseDate,
        amount: expense.amount,
        paymentMode: paymentModeFormatted,
        type: salaryPaymentType,
        notes: expense.notes || `Salary payment expense (ID: ${expense.id})`,
        expenseId: expense.id,
        createdAt: new Date().toISOString()
      };
      db.salaryPayments.push(payment);
    }

    // Link dynamic loan vendor name if category matches
    db.loans = db.loans || [];
    const matchedLoan = db.loans.find(l => l.vendorName.trim().toLowerCase() === expense.category.trim().toLowerCase() && l.status === "active");
    if (matchedLoan) {
      const nextInst = matchedLoan.schedule.find(inst => inst.status !== "paid");
      if (nextInst) {
        nextInst.status = "paid";
        nextInst.paidDate = expense.expenseDate;
        nextInst.expenseId = expense.id;
        
        const totalPaid = matchedLoan.schedule.filter(item => item.status === "paid").length * matchedLoan.repaymentDaily;
        matchedLoan.status = totalPaid >= matchedLoan.amount ? "completed" : "active";
      }
    }

    await writeDb(db);
    return sendJson(res, 201, { expense, expenses: db.expenses });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/expenses/")) {
    if (!["admin", "owner"].includes(user.role)) return sendJson(res, 403, { error: "Access denied. Only Admins and Owners can edit expenses." });
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const expense = db.expenses.find((item) => item.id === id);
    if (!expense) return sendJson(res, 404, { error: "Expense not found" });
    if (!canAccessBranch(user, expense.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    
    const oldCategory = expense.category;
    const oldDate = expense.expenseDate;

    if ("expenseDate" in body) expense.expenseDate = body.expenseDate;
    if ("category" in body) expense.category = requireText(body.category, "Category");
    if ("description" in body) expense.description = requireText(body.description, "Description");
    if ("amount" in body) expense.amount = money(body.amount);
    if ("frequency" in body) expense.frequency = body.frequency;
    if ("paymentMode" in body) expense.paymentMode = body.paymentMode;
    if ("notes" in body) expense.notes = String(body.notes || "").trim();
    if ("userId" in body) expense.userId = body.userId;
    expense.updatedBy = user.id;
    expense.updatedAt = new Date().toISOString();

    const categoryChanged = String(oldCategory).trim().toLowerCase() !== String(expense.category).trim().toLowerCase();
    const dateChanged = oldDate !== expense.expenseDate;

    // Sync with salary payments
    if (expense.category === "Salary") {
      if (body.userId) {
        expense.userId = body.userId;
      }
      if (expense.userId) {
        db.salaryPayments = db.salaryPayments || [];
        let payment = db.salaryPayments.find(p => p.expenseId === id || p.id === "sal_exp_" + id);
        const salaryPaymentType = determineSalaryPaymentType(db, expense.userId, expense.expenseDate, expense.amount, payment?.id || null);
        const paymentModeFormatted = expense.paymentMode ? (expense.paymentMode.toLowerCase() === "cash" ? "Cash" : expense.paymentMode.toLowerCase() === "upi" ? "UPI" : expense.paymentMode.toLowerCase() === "card" ? "Card" : "Bank Transfer") : "Cash";
        
        if (payment) {
          payment.userId = expense.userId;
          payment.branchId = expense.branchId || "all";
          payment.date = expense.expenseDate;
          payment.amount = expense.amount;
          payment.paymentMode = paymentModeFormatted;
          payment.type = salaryPaymentType;
          payment.notes = expense.notes || `Salary payment expense (ID: ${expense.id})`;
        } else {
          payment = {
            id: "sal_exp_" + expense.id,
            userId: expense.userId,
            branchId: expense.branchId || "all",
            date: expense.expenseDate,
            amount: expense.amount,
            paymentMode: paymentModeFormatted,
            type: salaryPaymentType,
            notes: expense.notes || `Salary payment expense (ID: ${expense.id})`,
            expenseId: expense.id,
            createdAt: new Date().toISOString()
          };
          db.salaryPayments.push(payment);
        }
      }
    } else if (oldCategory === "Salary") {
      // If category changed from Salary to another category, remove the linked salary payment
      db.salaryPayments = (db.salaryPayments || []).filter(p => p.expenseId !== id && p.id !== "sal_exp_" + id);
      delete expense.userId;
    }

    db.loans = db.loans || [];

    if (categoryChanged) {
      // 1. Unlink from any previously linked loan instalment
      for (const loan of db.loans) {
        const linkedInst = loan.schedule.find(inst => inst.expenseId === id);
        if (linkedInst) {
          linkedInst.status = "pending";
          linkedInst.paidDate = null;
          delete linkedInst.expenseId;
          
          const totalPaid = loan.schedule.filter(item => item.status === "paid").length * loan.repaymentDaily;
          loan.status = totalPaid >= loan.amount ? "completed" : "active";
        }
      }

      // 2. Link to the new category if it matches a loan vendorName
      const matchedLoan = db.loans.find(l => l.vendorName.trim().toLowerCase() === expense.category.trim().toLowerCase() && l.status === "active");
      if (matchedLoan) {
        const nextInst = matchedLoan.schedule.find(inst => inst.status !== "paid");
        if (nextInst) {
          nextInst.status = "paid";
          nextInst.paidDate = expense.expenseDate;
          nextInst.expenseId = expense.id;

          const totalPaid = matchedLoan.schedule.filter(item => item.status === "paid").length * matchedLoan.repaymentDaily;
          matchedLoan.status = totalPaid >= matchedLoan.amount ? "completed" : "active";
        }
      }
    } else if (dateChanged) {
      // Just update the paidDate on the linked instalment
      for (const loan of db.loans) {
        const linkedInst = loan.schedule.find(inst => inst.expenseId === id);
        if (linkedInst) {
          linkedInst.paidDate = expense.expenseDate;
        }
      }
    }

    await writeDb(db);
    return sendJson(res, 200, { expense, expenses: db.expenses });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/expenses/")) {
    if (!["admin", "owner"].includes(user.role)) return sendJson(res, 403, { error: "Access denied. Only Admins and Owners can delete expenses." });
    const id = pathname.split("/")[3];

    // Unlink any previous instalment linked to this expense
    db.loans = db.loans || [];
    for (const loan of db.loans) {
      const linkedInst = loan.schedule.find(inst => inst.expenseId === id);
      if (linkedInst) {
        linkedInst.status = "pending";
        linkedInst.paidDate = null;
        delete linkedInst.expenseId;
        
        const totalPaid = loan.schedule.filter(item => item.status === "paid").length * loan.repaymentDaily;
        loan.status = totalPaid >= loan.amount ? "completed" : "active";
      }
    }

    db.expenses = (db.expenses || []).filter((e) => e.id !== id);
    db.salaryPayments = (db.salaryPayments || []).filter(p => p.expenseId !== id && p.id !== "sal_exp_" + id);
    await writeDb(db);
    return sendJson(res, 200, { success: true, expenses: db.expenses });
  }

  // --- OWNERS API ---
  if (req.method === "GET" && pathname === "/api/owners") {
    if (!["admin", "owner", "manager"].includes(user.role)) return sendJson(res, 403, { error: "Access denied" });
    return sendJson(res, 200, db.owners || []);
  }

  if (req.method === "POST" && pathname === "/api/owners") {
    if (!["admin", "owner"].includes(user.role)) return sendJson(res, 403, { error: "Access denied" });
    const body = await parseBody(req);
    const totalExisting = (db.owners || []).filter(o => o.active).reduce((sum, o) => sum + Number(o.sharePercent || 0), 0);
    const newShare = Number(body.sharePercent || 0);
    if (totalExisting + newShare > 100) {
      return sendJson(res, 400, { error: "Total active owners share percentage cannot exceed 100%" });
    }
    const owner = {
      id: createId("owner"),
      name: requireText(body.name, "Name"),
      sharePercent: newShare,
      capital: Number(body.capital || 0),
      active: body.active !== false
    };
    db.owners = db.owners || [];
    db.owners.push(owner);
    await writeDb(db);
    return sendJson(res, 201, { owner, owners: db.owners });
  }

  if (req.method === "PUT" && pathname.startsWith("/api/owners/")) {
    if (!["admin", "owner"].includes(user.role)) return sendJson(res, 403, { error: "Access denied" });
    const id = pathname.split("/")[3];
    const body = await parseBody(req);
    db.owners = db.owners || [];
    const ownerIndex = db.owners.findIndex(o => o.id === id);
    if (ownerIndex === -1) return sendJson(res, 404, { error: "Owner not found" });

    const owner = db.owners[ownerIndex];
    const name = body.name ? requireText(body.name, "Name") : owner.name;
    const sharePercent = body.sharePercent !== undefined ? Number(body.sharePercent) : owner.sharePercent;
    const capital = body.capital !== undefined ? Number(body.capital) : owner.capital;
    const active = body.active !== undefined ? body.active : owner.active;

    const totalExisting = (db.owners || []).filter(o => o.id !== id && o.active).reduce((sum, o) => sum + Number(o.sharePercent || 0), 0);
    if (active && (totalExisting + sharePercent > 100)) {
      return sendJson(res, 400, { error: "Total active owners share percentage cannot exceed 100%" });
    }

    db.owners[ownerIndex] = {
      ...owner,
      name,
      sharePercent,
      capital,
      active
    };

    await writeDb(db);
    return sendJson(res, 200, { owner: db.owners[ownerIndex], owners: db.owners });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/owners/")) {
    if (!["admin", "owner"].includes(user.role)) return sendJson(res, 403, { error: "Access denied" });
    const id = pathname.split("/")[3];
    db.owners = (db.owners || []).filter(o => o.id !== id);
    // clean draws for this owner too
    db.ownerDraws = (db.ownerDraws || []).filter(d => d.ownerId !== id);
    await writeDb(db);
    return sendJson(res, 200, { success: true, owners: db.owners });
  }

  // --- OWNER DRAWS API ---
  if (req.method === "GET" && pathname === "/api/owner-draws") {
    if (!["admin", "owner", "manager"].includes(user.role)) return sendJson(res, 403, { error: "Access denied" });
    return sendJson(res, 200, db.ownerDraws || []);
  }

  if (req.method === "POST" && pathname === "/api/owner-draws") {
    if (!["admin", "owner"].includes(user.role)) return sendJson(res, 403, { error: "Access denied" });
    const body = await parseBody(req);
    const draw = {
      id: createId("draw"),
      ownerId: requireText(body.ownerId, "Owner"),
      date: body.date || currentBusinessDate(),
      amount: money(body.amount),
      paymentMode: body.paymentMode || "cash",
      notes: String(body.notes || "").trim(),
      createdBy: user.id,
      createdAt: new Date().toISOString()
    };
    if (!draw.amount || draw.amount <= 0) return sendJson(res, 400, { error: "Invalid drawing amount" });
    db.ownerDraws = db.ownerDraws || [];
    db.ownerDraws.push(draw);
    await writeDb(db);
    return sendJson(res, 201, { draw, ownerDraws: db.ownerDraws });
  }

  if (req.method === "PUT" && pathname.startsWith("/api/owner-draws/")) {
    if (!["admin", "owner"].includes(user.role)) return sendJson(res, 403, { error: "Access denied" });
    const id = pathname.split("/")[3];
    const body = await parseBody(req);
    db.ownerDraws = db.ownerDraws || [];
    const drawIndex = db.ownerDraws.findIndex(d => d.id === id);
    if (drawIndex === -1) return sendJson(res, 404, { error: "Drawing record not found" });

    const draw = db.ownerDraws[drawIndex];
    db.ownerDraws[drawIndex] = {
      ...draw,
      ownerId: body.ownerId || draw.ownerId,
      date: body.date || draw.date,
      amount: body.amount !== undefined ? money(body.amount) : draw.amount,
      paymentMode: body.paymentMode || draw.paymentMode,
      notes: body.notes !== undefined ? String(body.notes).trim() : draw.notes
    };
    await writeDb(db);
    return sendJson(res, 200, { draw: db.ownerDraws[drawIndex], ownerDraws: db.ownerDraws });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/owner-draws/")) {
    if (!["admin", "owner"].includes(user.role)) return sendJson(res, 403, { error: "Access denied" });
    const id = pathname.split("/")[3];
    db.ownerDraws = (db.ownerDraws || []).filter(d => d.id !== id);
    await writeDb(db);
    return sendJson(res, 200, { success: true, ownerDraws: db.ownerDraws });
  }

  // --- DAILY LEDGER REPORT API ---
  if (req.method === "GET" && pathname === "/api/reports/daily-ledger") {
    if (!hasPermission(db, user, "reports.view")) return sendJson(res, 403, { error: "Reports access required" });
    const cached = getReportsCache(req.url);
    if (cached) return sendJson(res, 200, cached);
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    const yearMonth = params.get("month") || currentBusinessDate().slice(0, 7); // "YYYY-MM"
    
    const [year, month] = yearMonth.split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    
    const ledger = [];
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dayReport = profitReport(db, branchId, dateStr, "day");
      ledger.push({
        date: dateStr,
        sales: dayReport.sales,
        supplierExpense: dayReport.supplierExpense,
        otherExpense: dayReport.otherExpense,
        salaries: dayReport.salaries,
        partnerExpense: dayReport.partnerExpense,
        totalExpenses: dayReport.totalExpenses,
        stockConsumedCost: dayReport.stockConsumedCost,
        profit: dayReport.profit,
        profitBasedOnConsumption: dayReport.profitBasedOnConsumption
      });
    }
    const result = { month: yearMonth, ledger };
    setReportsCache(req.url, result);
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && pathname === "/api/loans") {
    if (!["admin", "owner", "manager"].includes(user.role)) return sendJson(res, 403, { error: "Access denied" });
    return sendJson(res, 200, db.loans || []);
  }

  if (req.method === "POST" && pathname === "/api/loans") {
    if (!["admin", "owner"].includes(user.role)) return sendJson(res, 403, { error: "Access denied" });
    const body = await parseBody(req);
    const amount = Number(body.amount);
    const repaymentDaily = Number(body.repaymentDaily);
    if (!amount || amount <= 0) return sendJson(res, 400, { error: "Invalid loan amount" });
    if (!repaymentDaily || repaymentDaily <= 0) return sendJson(res, 400, { error: "Invalid daily repayment" });
    
    const durationDays = Math.ceil(amount / repaymentDaily);
    const schedule = [];
    let current = new Date(body.startDate || currentBusinessDate());
    for (let i = 0; i < durationDays; i++) {
      const dateString = current.toISOString().split("T")[0];
      schedule.push({
        sequence: i + 1,
        dueDate: dateString,
        status: "pending",
        amount: repaymentDaily,
        paidDate: null
      });
      current.setDate(current.getDate() + 1);
    }

    const loan = {
      id: createId("loan"),
      vendorName: requireText(body.vendorName, "Vendor Name"),
      amount: amount,
      repaymentDaily: repaymentDaily,
      startDate: body.startDate || currentBusinessDate(),
      branchId: body.branchId || "all",
      schedule,
      status: "active",
      createdBy: user.id,
      createdAt: new Date().toISOString()
    };
    db.loans = db.loans || [];
    db.loans.push(loan);
    await writeDb(db);
    return sendJson(res, 201, { loan, loans: db.loans });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/loans/") && pathname.includes("/instalment/")) {
    if (!["admin", "owner", "manager"].includes(user.role)) return sendJson(res, 403, { error: "Access denied" });
    const parts = pathname.split("/");
    const id = parts[3];
    const seq = parseInt(parts[5], 10);
    
    db.loans = db.loans || [];
    const loan = db.loans.find((l) => l.id === id);
    if (!loan) return sendJson(res, 404, { error: "Loan not found" });
    
    const instalment = loan.schedule.find((inst) => inst.sequence === seq);
    if (!instalment) return sendJson(res, 404, { error: "Instalment not found" });
    
    const body = await parseBody(req);
    const newStatus = body.status; // "paid", "missed", "pending"
    const oldStatus = instalment.status;
    
    if (newStatus !== "paid" && newStatus !== "missed" && newStatus !== "pending") {
      return sendJson(res, 400, { error: "Invalid status value" });
    }
    
    if (oldStatus === "missed" && newStatus !== "missed") {
      // Find the last pending instalment from the end of the schedule
      const lastPendingIndex = [...loan.schedule].reverse().findIndex(item => item.status === "pending");
      if (lastPendingIndex !== -1) {
        const actualIndex = loan.schedule.length - 1 - lastPendingIndex;
        loan.schedule.splice(actualIndex, 1);
      }
    } else if (newStatus === "missed" && oldStatus !== "missed") {
      // Find the max sequence and due date to append the new installment
      const maxSeq = loan.schedule.reduce((max, item) => Math.max(max, item.sequence), 0);
      const maxDueDateStr = loan.schedule.reduce((max, item) => {
        return item.dueDate > max ? item.dueDate : max;
      }, "1970-01-01");
      
      const lastDate = new Date(maxDueDateStr);
      lastDate.setDate(lastDate.getDate() + 1);
      const nextDueDateStr = lastDate.toISOString().split("T")[0];
      
      loan.schedule.push({
        sequence: maxSeq + 1,
        dueDate: nextDueDateStr,
        status: "pending",
        amount: loan.repaymentDaily,
        paidDate: null
      });
    }
    
    instalment.status = newStatus;
    instalment.paidDate = newStatus === "paid" ? (body.paidDate || currentBusinessDate()) : null;
    
    // Recalculate loan status
    const totalPaid = loan.schedule.filter(item => item.status === "paid").length * loan.repaymentDaily;
    if (totalPaid >= loan.amount) {
      loan.status = "completed";
    } else {
      loan.status = "active";
    }
    
    await writeDb(db);
    return sendJson(res, 200, { loan, loans: db.loans });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/loans/")) {
    if (!["admin", "owner"].includes(user.role)) return sendJson(res, 403, { error: "Access denied" });
    const id = pathname.split("/")[3];
    db.loans = (db.loans || []).filter((l) => l.id !== id);
    await writeDb(db);
    return sendJson(res, 200, { success: true, loans: db.loans });
  }

  if (req.method === "GET" && pathname === "/api/holidays") {
    return sendJson(res, 200, db.holidays || []);
  }

  if (req.method === "POST" && pathname === "/api/holidays") {
    if (!["admin", "owner"].includes(user.role)) return sendJson(res, 403, { error: "Access denied. Only Admins and Owners can manage holidays/closures." });
    const body = await parseBody(req);
    const holiday = {
      id: createId("hol"),
      branchId: body.branchId || "all",
      holidayDate: requireText(body.holidayDate, "Holiday date"),
      name: requireText(body.name, "Holiday name"),
      description: String(body.description || "").trim(),
      type: body.type || "holiday", // "holiday" (paid) or "closure" (unpaid hotel close)
      createdBy: user.id,
      createdAt: new Date().toISOString()
    };
    db.holidays = db.holidays || [];
    db.holidays.push(holiday);
    await writeDb(db);
    return sendJson(res, 201, { holiday, holidays: db.holidays });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/holidays/")) {
    if (!["admin", "owner"].includes(user.role)) return sendJson(res, 403, { error: "Access denied. Only Admins and Owners can manage holidays/closures." });
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const holiday = (db.holidays || []).find((h) => h.id === id);
    if (!holiday) return sendJson(res, 404, { error: "Holiday/closure not found" });
    if ("holidayDate" in body) holiday.holidayDate = requireText(body.holidayDate, "Holiday date");
    if ("name" in body) holiday.name = requireText(body.name, "Holiday name");
    if ("description" in body) holiday.description = String(body.description || "").trim();
    if ("branchId" in body) holiday.branchId = body.branchId || "all";
    if ("type" in body) holiday.type = body.type || "holiday";
    await writeDb(db);
    return sendJson(res, 200, { holiday, holidays: db.holidays });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/holidays/")) {
    if (!["admin", "owner"].includes(user.role)) return sendJson(res, 403, { error: "Access denied. Only Admins and Owners can manage holidays/closures." });
    const id = pathname.split("/")[3];
    db.holidays = (db.holidays || []).filter((h) => h.id !== id);
    await writeDb(db);
    return sendJson(res, 200, { success: true, holidays: db.holidays });
  }

  if (req.method === "GET" && pathname === "/api/attendance") {
    if (!hasPermission(db, user, "attendance.manage")) return sendJson(res, 403, { error: "Attendance access required" });
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    const date = params.get("date") || currentBusinessDate();
    const branchUsers = db.users.filter((u) => u.active !== false && (branchId === "all" || u.branchIds?.includes(branchId)));
    const attendanceRecords = (db.attendance || []).filter((a) => a.date === date && (branchId === "all" || a.branchId === branchId));
    return sendJson(res, 200, {
      users: branchUsers.map(sanitizeUser),
      attendance: attendanceRecords
    });
  }

  if (req.method === "POST" && pathname === "/api/attendance") {
    if (!hasPermission(db, user, "attendance.manage")) return sendJson(res, 403, { error: "Attendance access required" });
    const body = await parseBody(req);
    const date = body.date || currentBusinessDate();
    const branchId = body.branchId || "all";
    const records = body.records || [];
    db.attendance = db.attendance || [];
    for (const record of records) {
      const existingIdx = db.attendance.findIndex((a) => a.date === date && a.userId === record.userId);
      if (existingIdx !== -1) {
        db.attendance[existingIdx].status = record.status;
      } else {
        db.attendance.push({
          id: createId("att"),
          date,
          branchId: record.branchId || branchId,
          userId: record.userId,
          status: record.status
        });
      }
    }
    await writeDb(db);
    return sendJson(res, 200, { success: true, attendance: db.attendance });
  }

  if (req.method === "GET" && pathname === "/api/notifications") {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    const list = (db.notifications || []).filter((n) => branchId === "all" || n.branchId === branchId);
    return sendJson(res, 200, list.slice(-50).reverse());
  }

  if (req.method === "POST" && pathname === "/api/notifications/dismiss-alarms") {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    let count = 0;
    for (const n of (db.notifications || [])) {
      if (n.type === "kitchen_alarm" && (branchId === "all" || n.branchId === branchId)) {
        n.read = true;
        count++;
      }
    }
    if (count > 0) {
      await writeDb(db);
    }
    return sendJson(res, 200, { success: true, count });
  }

  if (req.method === "POST" && pathname === "/api/notifications/read-all") {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    for (const n of (db.notifications || [])) {
      if (branchId === "all" || n.branchId === branchId) {
        n.read = true;
      }
    }
    await writeDb(db);
    return sendJson(res, 200, { success: true, notifications: db.notifications });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/notifications/")) {
    const id = pathname.split("/")[3];
    db.notifications = (db.notifications || []).filter((n) => n.id !== id);
    await writeDb(db);
    return sendJson(res, 200, { success: true });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/notifications/")) {
    const id = pathname.split("/")[3];
    const n = (db.notifications || []).find((item) => item.id === id);
    if (n) {
      n.read = true;
      await writeDb(db);
    }
    return sendJson(res, 200, { success: true });
  }

  // --- PARTNER SHOPS ---
  if (req.method === "GET" && pathname === "/api/partner-shops") {
    return sendJson(res, 200, db.partnerShops || []);
  }

  if (req.method === "POST" && pathname === "/api/partner-shops") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const shop = {
      id: createId("ps"),
      name: requireText(body.name, "Shop name"),
      contact: String(body.contact || "").trim(),
      pendingAmount: Number(body.pendingAmount) || 0,
      active: body.active !== false
    };
    db.partnerShops = db.partnerShops || [];
    db.partnerShops.push(shop);
    await writeDb(db);
    return sendJson(res, 201, { shop, partnerShops: db.partnerShops });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/partner-shops/")) {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    db.partnerShops = db.partnerShops || [];
    const shop = db.partnerShops.find((s) => s.id === id);
    if (!shop) return sendJson(res, 404, { error: "Partner shop not found" });
    if ("name" in body) shop.name = requireText(body.name, "Shop name");
    if ("contact" in body) shop.contact = String(body.contact || "").trim();
    if ("pendingAmount" in body) shop.pendingAmount = Number(body.pendingAmount) || 0;
    if ("active" in body) shop.active = Boolean(body.active);
    await writeDb(db);
    return sendJson(res, 200, { shop, partnerShops: db.partnerShops });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/partner-shops/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    db.partnerShops = db.partnerShops || [];
    const shop = db.partnerShops.find((s) => s.id === id);
    if (!shop) return sendJson(res, 404, { error: "Partner shop not found" });
    shop.active = false; // Soft delete
    await writeDb(db);
    return sendJson(res, 200, { success: true, partnerShops: db.partnerShops });
  }

  // --- PARTNER SETTLEMENTS ---
  if (req.method === "GET" && pathname === "/api/partner-settlements") {
    return sendJson(res, 200, db.partnerSettlements || []);
  }

  if (req.method === "POST" && pathname === "/api/partner-settlements") {
    if (!assertAdmin(user, res)) return;
    const body = await parseBody(req);
    const settlement = {
      id: createId("pst"),
      partnerShopId: requireText(body.partnerShopId, "Partner shop ID"),
      amount: money(body.amount),
      date: requireText(body.date || new Date().toISOString().slice(0, 10), "Date"),
      notes: String(body.notes || "").trim(),
      createdBy: user.id,
      createdAt: new Date().toISOString()
    };
    db.partnerSettlements = db.partnerSettlements || [];
    db.partnerSettlements.push(settlement);
    await writeDb(db);
    return sendJson(res, 201, { settlement, partnerSettlements: db.partnerSettlements });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/partner-settlements/")) {
    if (!assertAdmin(user, res)) return;
    const id = pathname.split("/")[3];
    db.partnerSettlements = db.partnerSettlements || [];
    db.partnerSettlements = db.partnerSettlements.filter((s) => s.id !== id);
    await writeDb(db);
    return sendJson(res, 200, { success: true, partnerSettlements: db.partnerSettlements });
  }

  if (req.method === "POST" && pathname === "/api/supplier-bills") {
    if (!hasPermission(db, user, "purchase.manage")) return sendJson(res, 403, { error: "Purchase access required" });
    const body = await parseBody(req);
    if (!canAccessBranch(user, body.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    const supplier = db.suppliers.find((item) => item.id === body.supplierId && item.active !== false);
    if (!supplier) return sendJson(res, 422, { error: "Valid supplier is required" });
    const lines = (body.lines || []).map((line) => {
      const stock = db.inventory.find((item) => item.id === line.inventoryId && item.branchId === body.branchId && item.active !== false);
      if (!stock) throw new Error("Valid stock item is required");
      const quantity = money(line.quantity);
      const unitCost = money(line.unitCost);
      const lineTotal = money(quantity * unitCost);
      stock.quantity = money(stock.quantity + quantity);
      stock.lastCost = unitCost;
      addPriceHistory(stock, unitCost, body.billDate || currentBusinessDate());
      stock.supplierIds = stock.supplierIds || [];
      if (!stock.supplierIds.includes(supplier.id)) stock.supplierIds.push(supplier.id);
      return {
        id: createId("bill_line"),
        inventoryId: stock.id,
        name: stock.name,
        unit: stock.unit,
        quantity,
        unitCost,
        lineTotal
      };
    });
    const computedTotal = money(lines.reduce((sum, line) => sum + line.lineTotal, 0));
    const total = money(body.total || computedTotal);
    const paidAmount = money(body.paidAmount || (body.paymentStatus === "paid" ? total : 0));
    const balanceAmount = money(total - paidAmount);
    const paymentStatus = balanceAmount <= 0 ? "paid" : paidAmount > 0 ? "partial" : "unpaid";
    const bill = {
      id: createId("sbill"),
      branchId: body.branchId,
      supplierId: supplier.id,
      billNo: requireText(body.billNo || body.invoiceNo, "Bill number"),
      billDate: body.billDate || currentBusinessDate(),
      paymentStatus,
      paymentMode: body.paymentMode || "",
      sourceOrderId: body.sourceOrderId || "",
      notes: String(body.notes || "").trim(),
      lines,
      total,
      paidAmount,
      balanceAmount: Math.max(0, balanceAmount),
      createdBy: user.id,
      createdAt: new Date().toISOString()
    };
    db.supplierBills.push(bill);
    supplier.pendingAmount = money((supplier.pendingAmount || 0) + bill.balanceAmount);
    if (bill.sourceOrderId) {
      const order = db.supplierOrders.find((item) => item.id === bill.sourceOrderId);
      if (order) {
        order.status = "billed";
        order.billedSupplierBillId = bill.id;
      }
    }
    await writeDb(db);
    return sendJson(res, 201, { bill, supplierBills: db.supplierBills, supplierOrders: db.supplierOrders, inventory: db.inventory, expenses: expenseSummary(db, body.branchId, "month") });
  }

  if (req.method === "POST" && pathname === "/api/supplier-orders") {
    if (!hasPermission(db, user, "purchase.manage")) return sendJson(res, 403, { error: "Purchase access required" });
    const body = await parseBody(req);
    if (!canAccessBranch(user, body.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    const supplier = db.suppliers.find((item) => item.id === body.supplierId && item.active !== false);
    if (!supplier) return sendJson(res, 422, { error: "Valid supplier is required" });
    
    const lines = [];
    for (const line of (body.lines || [])) {
      const stock = db.inventory.find((item) => item.id === line.inventoryId && item.branchId === body.branchId && item.active !== false);
      if (!stock) throw new Error("Valid stock item is required");
      if (!stock.supplierIds.includes(supplier.id)) throw new Error(`${stock.name} is not mapped to selected supplier`);
      
      const requestedQty = Number(line.quantity || 0);
      const availableStock = Number(stock.quantity || 0);
      const minStock = Number(stock.reorderLevel || 0);
      const adjustedQty = (minStock + requestedQty) - availableStock;
      
      if (adjustedQty > 0) {
        lines.push({
          id: createId("po_line"),
          inventoryId: stock.id,
          name: stock.name,
          unit: stock.unit,
          quantity: money(adjustedQty),
          notes: String(line.notes || "").trim()
        });
      }
    }
    
    if (!lines.length) {
      return sendJson(res, 422, { 
        error: "All requested items have sufficient available stock above their minimum levels. Adjusted order quantities are 0, so no purchase order was created." 
      });
    }
    const order = {
      id: createId("po"),
      orderNo: body.orderNo || `${body.branchId.toUpperCase()}-PO-${Date.now().toString().slice(-6)}`,
      branchId: body.branchId,
      supplierId: supplier.id,
      orderDate: body.orderDate || currentBusinessDate(),
      deliveryDate: body.deliveryDate || currentBusinessDate(),
      status: body.status || "draft",
      notes: String(body.notes || "").trim(),
      lines,
      createdBy: user.id,
      createdAt: new Date().toISOString()
    };
    db.supplierOrders.push(order);
    await writeDb(db);
    return sendJson(res, 201, { order, supplierOrders: db.supplierOrders });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/supplier-orders/")) {
    if (!hasPermission(db, user, "purchase.manage")) return sendJson(res, 403, { error: "Purchase access required" });
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const order = db.supplierOrders.find((item) => item.id === id);
    if (!order) return sendJson(res, 404, { error: "Supplier order not found" });
    if (!canAccessBranch(user, order.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    if ("status" in body) order.status = body.status;
    if ("deliveryDate" in body) order.deliveryDate = body.deliveryDate;
    if ("notes" in body) order.notes = String(body.notes || "").trim();
    await writeDb(db);
    return sendJson(res, 200, { order, supplierOrders: db.supplierOrders });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/supplier-bills/")) {
    if (!hasPermission(db, user, "purchase.manage")) return sendJson(res, 403, { error: "Purchase access required" });
    const body = await parseBody(req);
    const id = pathname.split("/")[3];
    const bill = db.supplierBills.find((item) => item.id === id);
    if (!bill) return sendJson(res, 404, { error: "Supplier bill not found" });
    const oldBalance = bill.balanceAmount ?? bill.total;
    if (bill.paymentStatus === "paid") return sendJson(res, 400, { error: "Paid supplier bills cannot be edited" });
    if (!canAccessBranch(user, bill.branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    if ("billNo" in body) bill.billNo = requireText(body.billNo, "Bill number");
    if ("billDate" in body) bill.billDate = body.billDate;
    if ("paymentStatus" in body) bill.paymentStatus = body.paymentStatus;
    if ("paymentMode" in body) bill.paymentMode = body.paymentMode;
    if ("notes" in body) bill.notes = String(body.notes || "").trim();
    if ("lines" in body) {
      for (const line of bill.lines || []) {
        const stock = db.inventory.find((item) => item.id === line.inventoryId && item.branchId === bill.branchId);
        if (stock) stock.quantity = money(stock.quantity - Number(line.quantity || 0));
      }
      const supplier = db.suppliers.find((item) => item.id === bill.supplierId);
      bill.lines = (body.lines || []).map((line) => {
        const stock = db.inventory.find((item) => item.id === line.inventoryId && item.branchId === bill.branchId && item.active !== false);
        if (!stock) throw new Error("Valid stock item is required");
        const quantity = money(line.quantity);
        const unitCost = money(line.unitCost);
        const lineTotal = money(quantity * unitCost);
        stock.quantity = money(stock.quantity + quantity);
        stock.lastCost = unitCost;
        addPriceHistory(stock, unitCost, bill.billDate);
        stock.supplierIds = stock.supplierIds || [];
        if (supplier && !stock.supplierIds.includes(supplier.id)) stock.supplierIds.push(supplier.id);
        return {
          id: line.id || createId("bill_line"),
          inventoryId: stock.id,
          name: stock.name,
          unit: stock.unit,
          quantity,
          unitCost,
          lineTotal
        };
      });
      bill.total = money(bill.lines.reduce((sum, line) => sum + line.lineTotal, 0));
      bill.updatedBy = user.id;
      bill.updatedAt = new Date().toISOString();
    }
    if ("paidAmount" in body || "paymentStatus" in body || "lines" in body) {
      bill.paidAmount = money(body.paidAmount ?? (bill.paymentStatus === "paid" ? bill.total : bill.paidAmount || 0));
      if (bill.paymentStatus === "paid") bill.paidAmount = bill.total;
      bill.balanceAmount = money(bill.total - bill.paidAmount);
      if (bill.balanceAmount <= 0) {
        bill.balanceAmount = 0;
        bill.paymentStatus = "paid";
      } else if (bill.paidAmount > 0) {
        bill.paymentStatus = "partial";
      } else {
        bill.paymentStatus = "unpaid";
      }
      const newBalance = bill.balanceAmount;
      const balanceDiff = money(newBalance - oldBalance);
      const supplier = db.suppliers.find((s) => s.id === bill.supplierId);
      if (supplier && balanceDiff !== 0) {
        supplier.pendingAmount = money((supplier.pendingAmount || 0) + balanceDiff);
      }
    }
    await writeDb(db);
    return sendJson(res, 200, { bill, supplierBills: db.supplierBills, inventory: db.inventory, expenses: expenseSummary(db, bill.branchId, "month") });
  }

  if (req.method === "GET" && pathname === "/api/reports/expenses") {
    if (!hasPermission(db, user, "reports.view")) return sendJson(res, 403, { error: "Reports access required" });
    const cached = getReportsCache(req.url);
    if (cached) return sendJson(res, 200, cached);
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    const period = params.get("period") || "month";
    const result = expenseSummary(db, branchId, period);
    setReportsCache(req.url, result);
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && pathname === "/api/reports/performance") {
    if (!hasPermission(db, user, "reports.view")) return sendJson(res, 403, { error: "Reports access required" });
    const cached = getReportsCache(req.url);
    if (cached) return sendJson(res, 200, cached);
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const result = userPerformanceReport(db, params.get("branchId") || "all", params.get("date") || currentBusinessDate(), params.get("period") || "month");
    setReportsCache(req.url, result);
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && pathname === "/api/reports/profit") {
    if (!hasPermission(db, user, "reports.view")) return sendJson(res, 403, { error: "Reports access required" });
    const cached = getReportsCache(req.url);
    if (cached) return sendJson(res, 200, cached);
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const result = profitReport(db, params.get("branchId") || "all", params.get("date") || currentBusinessDate(), params.get("period") || "month");
    setReportsCache(req.url, result);
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && pathname === "/api/reports/cancellations") {
    if (!hasPermission(db, user, "reports.view") && !hasPermission(db, user, "pos.use")) return sendJson(res, 403, { error: "Reports access required" });
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    
    const cancelledOrders = (db.orders || []).filter(o => o.status === "cancelled" && (branchId === "all" || o.branchId === branchId));
    const cancelledTables = (db.tableOrders || []).filter(o => o.status === "cancelled" && (branchId === "all" || o.branchId === branchId));
    
    return sendJson(res, 200, {
      orders: cancelledOrders,
      tables: cancelledTables
    });
  }

  if (req.method === "GET" && pathname === "/api/reports/menu-profitability") {
    if (!hasPermission(db, user, "reports.view")) return sendJson(res, 403, { error: "Reports access required" });
    const cached = getReportsCache(req.url);
    if (cached) return sendJson(res, 200, cached);
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    const date = params.get("date") || currentBusinessDate();
    const period = params.get("period") || "month";
    const result = getMenuProfitability(db, branchId, date, period);
    setReportsCache(req.url, result);
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/reports/ai-analysis") {
    if (!hasPermission(db, user, "reports.view")) return sendJson(res, 403, { error: "Reports access required" });
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    const date = params.get("date") || currentBusinessDate();
    const period = params.get("period") || "month";

    try {
      const profit = profitReport(db, branchId, date, period);
      const items = getMenuProfitability(db, branchId, date, period);
      
      const promptData = {
        period,
        date,
        totalSales: profit.sales,
        stockConsumedCost: profit.stockConsumedCost,
        salaries: profit.salaries,
        otherExpense: profit.otherExpense,
        partnerExpense: profit.partnerExpense,
        netProfit: profit.profitBasedOnConsumption,
        kitchenStations: profit.kitchenStationProfit,
        menuItems: items.map(i => ({
          name: i.name,
          code: i.code,
          price: i.price,
          costPrice: i.costPrice,
          quantitySold: i.quantitySold,
          grossRevenue: i.grossRevenue,
          netProfit: i.netProfit,
          marginPercent: i.marginPercent,
          status: i.profitClassification
        }))
      };

      let analysisText = "";
      try {
        const ai = getGeminiClient();
        const systemInstruction = "You are a professional restaurant business consultant and financial analyst for 'Basha Restaurant OS', a premium South Indian / Multi-Cuisine restaurant. Analyze the sales, expenses, profits, and menu performance, and give expert, actionable advice.";
        const prompt = `Please provide a detailed financial and operational analysis for Basha Restaurant based on the following real-time data:
        ${JSON.stringify(promptData, null, 2)}
        
        Provide your response as a beautifully formatted Markdown report with these exact sections:
        
        ### 📊 1. Executive Performance Summary
        Provide a concise overview of sales, total expenses, net profit, and profit margin. Analyze if the food cost and overhead ratios are healthy. Mention the best and worst performing kitchen stations.
        
        ### ⚠️ 2. Menu Financial Diagnosis & Warnings
        Identify and list ANY menu items that are:
        - **Loss Makers** (costPrice is higher than price, margin is negative)
        - **Low Margin Items** (profit margin is below 30%)
        - **Cash Cows** (high sales quantity and healthy margins)
        Highlight any specific problems with pricing or costing of items that require immediate attention.
        
        ### 💡 3. Actionable Strategies to Increase Sales & Profits
        Provide 4-5 highly specific, practical, and actionable tips to boost revenues and improve profit margins. Make these specific to South Indian / Multi-Cuisine contexts (e.g., biryani combo deals, portion control, prep adjustments, cross-selling).
         
        Be professional, direct, clear, and encouraging. Use clean formatting with bold terms.`;

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            systemInstruction,
            temperature: 0.7,
          }
        });
        
        analysisText = response.text || "No analysis returned from Gemini.";
      } catch (err) {
        console.error("Gemini API Error, falling back to rule-based analysis:", err);
        analysisText = getRuleBasedAnalysisFallback(promptData);
      }

      db.meta = db.meta || {};
      db.meta.aiSalesAnalysis = {
        branchId,
        date,
        period,
        text: analysisText,
        updatedAt: new Date().toISOString()
      };
      await writeDb(db);

      return sendJson(res, 200, { analysis: analysisText, updatedAt: db.meta.aiSalesAnalysis.updatedAt });
    } catch (err) {
      console.error("Error generating AI analysis:", err);
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/reports/daily-prep") {
    if (!hasPermission(db, user, "reports.view")) return sendJson(res, 403, { error: "Reports access required" });
    const cached = getReportsCache(req.url);
    if (cached) return sendJson(res, 200, cached);
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const date = params.get("date") || currentBusinessDate();
    const period = params.get("period") || "month"; // "month" or "week"
    
    const prepHistory = db.prepHistory || [];
    const baseDate = new Date(`${date}T00:00:00`);
    
    let start, end;
    if (period === "week") {
      const startD = new Date(baseDate);
      startD.setDate(baseDate.getDate() - 6);
      start = dateKey(startD);
      end = date;
    } else {
      const year = baseDate.getFullYear();
      const monthStr = String(baseDate.getMonth() + 1).padStart(2, "0");
      start = `${year}-${monthStr}-01`;
      const lastD = new Date(year, baseDate.getMonth() + 1, 0).getDate();
      end = `${year}-${monthStr}-${String(lastD).padStart(2, "0")}`;
    }
    
    const filtered = prepHistory.filter(h => h.date >= start && h.date <= end);
    
    const trend = [];
    let cur = new Date(`${start}T00:00:00`);
    const endD = new Date(`${end}T00:00:00`);
    while (cur <= endD) {
      const dKey = dateKey(cur);
      trend.push({
        date: dKey,
        label: period === "week" 
          ? cur.toLocaleDateString("en-US", { weekday: "short" }) 
          : cur.toLocaleDateString("en-US", { day: "numeric" }),
        totalPortions: 0,
        totalQty: 0
      });
      cur.setDate(cur.getDate() + 1);
    }
    
    for (const h of filtered) {
      const dayObj = trend.find(d => d.date === h.date);
      if (dayObj) {
        dayObj.totalPortions += Number(h.portionsAvailable) || 0;
        dayObj.totalQty += Number(h.preparedQty) || 0;
      }
    }
    
    const itemSummaryMap = {};
    for (const h of filtered) {
      if (!itemSummaryMap[h.name]) {
        itemSummaryMap[h.name] = { name: h.name, type: h.type, totalQty: 0, totalPortions: 0, daysCount: 0 };
      }
      itemSummaryMap[h.name].totalQty += Number(h.preparedQty) || 0;
      itemSummaryMap[h.name].totalPortions += Number(h.portionsAvailable) || 0;
      itemSummaryMap[h.name].daysCount += 1;
    }
    const itemSummary = Object.values(itemSummaryMap).sort((a, b) => b.totalPortions - a.totalPortions);
    
    const result = {
      period,
      start,
      end,
      trend,
      itemSummary,
      history: filtered
    };
    setReportsCache(req.url, result);
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && pathname === "/api/reports/stock-pricing") {
    if (!hasPermission(db, user, "reports.view") && !hasPermission(db, user, "inventory.view")) return sendJson(res, 403, { error: "Access required" });
    const cached = getReportsCache(req.url);
    if (cached) return sendJson(res, 200, cached);
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const inventoryId = params.get("inventoryId");
    const period = params.get("period") || "monthly";
    if (!inventoryId) return sendJson(res, 400, { error: "Missing inventoryId" });
    
    const bills = db.supplierBills || [];
    const stockItem = db.inventory.find(item => item.id === inventoryId);
    if (!stockItem) return sendJson(res, 404, { error: "Stock item not found" });
    
    const now = new Date(`${currentBusinessDate()}T00:00:00`);
    let daysToLookBack = period === "weekly" ? 7 : 30;
    const limitDate = new Date(now);
    limitDate.setDate(now.getDate() - daysToLookBack);
    const limitStr = dateKey(limitDate);
    
    const pricePoints = [];
    
    // 1. Add price history records
    const history = stockItem.priceHistory || [];
    for (const entry of history) {
      if (entry.date >= limitStr) {
        pricePoints.push({
          date: entry.date,
          price: Number(entry.cost || 0)
        });
      }
    }

    // 2. Add bill records if any
    for (const bill of bills) {
      if (bill.billDate < limitStr) continue;
      const matchingLine = (bill.lines || []).find(line => line.inventoryId === inventoryId);
      if (matchingLine) {
        pricePoints.push({
          date: bill.billDate,
          price: Number(matchingLine.unitCost || 0)
        });
      }
    }
    
    pricePoints.sort((a, b) => a.date.localeCompare(b.date));
    
    const grouped = {};
    for (const pt of pricePoints) {
      if (!grouped[pt.date]) {
        grouped[pt.date] = [];
      }
      grouped[pt.date].push(pt.price);
    }
    
    const chartData = Object.keys(grouped).sort().map(date => {
      const prices = grouped[date];
      const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
      return {
        date,
        price: money(avgPrice)
      };
    });
    
    if (chartData.length === 0) {
      chartData.push({
        date: currentBusinessDate(),
        price: stockItem.lastCost || 0
      });
    }
    
    const result = {
      inventoryId,
      name: stockItem.name,
      unit: stockItem.unit,
      currentPrice: stockItem.lastCost || 0,
      pricePoints: chartData
    };
    setReportsCache(req.url, result);
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/inventory/daily-count") {
    if (!hasPermission(db, user, "purchase.manage") && !hasPermission(db, user, "pos.use")) return sendJson(res, 403, { error: "Access denied" });
    const body = await parseBody(req);
    const branchId = body.branchId;
    if (!branchId) return sendJson(res, 400, { error: "Branch ID required" });
    if (!canAccessBranch(user, branchId)) return sendJson(res, 403, { error: "Branch access denied" });
    
    const counts = body.counts || [];
    
    for (const count of counts) {
      const stock = db.inventory.find(item => item.id === count.inventoryId && item.branchId === branchId && item.active !== false);
      if (!stock) continue;
      
      const expectedQty = Number(stock.quantity || 0);
      const actualQty = Number(count.actualQuantity);
      if (isNaN(actualQty) || actualQty < 0) continue;
      
      const consumedQty = expectedQty - actualQty;
      
      stock.quantity = money(actualQty);
      
      if (consumedQty !== 0) {
        db.stockUsages = db.stockUsages || [];
        const usage = {
          id: createId("usage"),
          branchId,
          inventoryId: stock.id,
          itemName: stock.name,
          enteredQuantity: Math.abs(consumedQty),
          enteredUnit: stock.unit,
          stockQuantity: Math.abs(consumedQty),
          stockUnit: stock.unit,
          balanceAfter: stock.quantity,
          purpose: consumedQty > 0 ? "Daily Floor Count Consumption" : "Daily Floor Count Adjustment",
          notes: `Floor manager count. Expected: ${expectedQty}, Counted: ${actualQty}. Diff: ${consumedQty}`,
          costValue: money(Math.abs(consumedQty) * (stock.lastCost || 0)),
          createdBy: user.id,
          createdByName: user.name,
          createdAt: new Date().toISOString()
        };
        db.stockUsages.push(usage);
      }
    }
    
    await writeDb(db);
    return sendJson(res, 200, { success: true, inventory: db.inventory, stockUsages: db.stockUsages || [], summary: dailySummary(db) });
  }

  if (req.method === "GET" && pathname === "/api/menu-items/portions") {
    const today = currentBusinessDate();
    let resetDone = false;
    if (db.portionsDate !== today) {
      for (const mi of db.menuItems || []) {
        mi.preparedQty = 0;
        mi.portionsAvailable = null;
      }
      for (const cat of db.categories || []) {
        cat.preparedQty = 0;
        cat.portionsAvailable = null;
      }
      resetDone = true;
    }
    const { itemSales, catSales } = syncDailyPortions(db, today);
    if (resetDone) {
      await writeDb(db);
    }
    return sendJson(res, 200, { 
      menuItems: sanitizeMenuItems(db.menuItems), 
      categories: db.categories,
      itemSales,
      catSales,
      portionsInitializedToday: db.portionsDate === today
    });
  }

  if ((req.method === "POST" && (pathname === "/api/menu-items/daily-portions" || pathname === "/api/menu-items/portions")) ||
      (req.method === "PUT" && pathname === "/api/menu-items/portions")) {
    if (!hasPermission(db, user, "pos.use") && !hasPermission(db, user, "purchase.manage") && !hasPermission(db, user, "kitchen.use")) {
      return sendJson(res, 403, { error: "Access denied" });
    }
    const body = await parseBody(req);
    
    // Support structured items array
    if (Array.isArray(body.items)) {
      for (const item of body.items) {
        const id = item.menuItemId || item.id;
        const mi = db.menuItems.find(m => m.id === id);
        if (mi) {
          if (item.preparedQty !== undefined) {
            mi.preparedQty = Number(item.preparedQty) || 0;
          } else if (item.dailyPortions !== undefined) {
            mi.preparedQty = item.dailyPortions !== null ? Number(item.dailyPortions) : 0;
          }
          if (item.yieldPerUnit !== undefined) {
            mi.yieldPerUnit = Number(item.yieldPerUnit) || 1;
          } else if (!mi.yieldPerUnit) {
            mi.yieldPerUnit = 1;
          }
          if (item.portionsWarningLimit !== undefined) {
            mi.portionsWarningLimit = Number(item.portionsWarningLimit) || 0;
          }
        }
      }
    }
    
    // Support structured categories array
    if (Array.isArray(body.categories)) {
      for (const catItem of body.categories) {
        const id = catItem.categoryId || catItem.id;
        const cat = db.categories.find(c => c.id === id);
        if (cat) {
          if (catItem.preparedQty !== undefined) {
            cat.preparedQty = Number(catItem.preparedQty) || 0;
          }
          if (catItem.yieldPerUnit !== undefined) {
            cat.yieldPerUnit = Number(catItem.yieldPerUnit) || 1;
          } else if (!cat.yieldPerUnit) {
            cat.yieldPerUnit = 1;
          }
          if (catItem.portionsWarningLimit !== undefined) {
            cat.portionsWarningLimit = Number(catItem.portionsWarningLimit) || 0;
          }
        }
      }
    }

    // Support generic updates format
    const updates = body.updates || [];
    for (const u of updates) {
      if (u.type === "item") {
        const mi = db.menuItems.find(item => item.id === u.id);
        if (mi) {
          mi.preparedQty = Number(u.preparedQty) || 0;
          mi.yieldPerUnit = Number(u.yieldPerUnit) || 1;
          mi.portionsWarningLimit = Number(u.portionsWarningLimit) || 0;
        }
      } else if (u.type === "category") {
        const cat = db.categories.find(c => c.id === u.id);
        if (cat) {
          cat.preparedQty = Number(u.preparedQty) || 0;
          cat.yieldPerUnit = Number(u.yieldPerUnit) || 1;
          cat.portionsWarningLimit = Number(u.portionsWarningLimit) || 0;
        }
      }
    }
    
    const today = currentBusinessDate();
    const { itemSales, catSales } = syncDailyPortions(db, today);

    // Sync to prepHistory
    db.prepHistory = db.prepHistory || [];
    
    for (const mi of db.menuItems) {
      if (mi.preparedQty > 0) {
        let hist = db.prepHistory.find(h => h.date === today && h.targetId === mi.id && h.type === "item");
        const totalPortions = Math.round(mi.preparedQty * (mi.yieldPerUnit || 1));
        const soldPortions = itemSales[mi.id] || 0;
        if (hist) {
          hist.preparedQty = mi.preparedQty;
          hist.yieldPerUnit = mi.yieldPerUnit || 1;
          hist.totalPreparedPortions = totalPortions;
          hist.soldPortions = soldPortions;
          hist.portionsAvailable = mi.portionsAvailable || 0;
        } else {
          db.prepHistory.push({
            id: createId("prep"),
            date: today,
            type: "item",
            targetId: mi.id,
            name: mi.name,
            preparedQty: mi.preparedQty,
            yieldPerUnit: mi.yieldPerUnit || 1,
            totalPreparedPortions: totalPortions,
            soldPortions: soldPortions,
            portionsAvailable: mi.portionsAvailable || 0
          });
        }
      } else {
        db.prepHistory = db.prepHistory.filter(h => !(h.date === today && h.targetId === mi.id && h.type === "item"));
      }
    }

    for (const cat of db.categories) {
      if (cat.preparedQty > 0) {
        let hist = db.prepHistory.find(h => h.date === today && h.targetId === cat.id && h.type === "category");
        const totalPortions = Math.round(cat.preparedQty * (cat.yieldPerUnit || 1));
        const soldPortions = catSales[cat.id] || 0;
        if (hist) {
          hist.preparedQty = cat.preparedQty;
          hist.yieldPerUnit = cat.yieldPerUnit || 1;
          hist.totalPreparedPortions = totalPortions;
          hist.soldPortions = soldPortions;
          hist.portionsAvailable = cat.portionsAvailable || 0;
        } else {
          db.prepHistory.push({
            id: createId("prep"),
            date: today,
            type: "category",
            targetId: cat.id,
            name: cat.name,
            preparedQty: cat.preparedQty,
            yieldPerUnit: cat.yieldPerUnit || 1,
            totalPreparedPortions: totalPortions,
            soldPortions: soldPortions,
            portionsAvailable: cat.portionsAvailable || 0
          });
        }
      } else {
        db.prepHistory = db.prepHistory.filter(h => !(h.date === today && h.targetId === cat.id && h.type === "category"));
      }
    }

    db.portionsDate = today;
    await writeDb(db);
    return sendJson(res, 200, { success: true, menuItems: sanitizeMenuItems(db.menuItems), categories: db.categories, itemSales, catSales, portionsInitializedToday: true });
  }

  if (req.method === "GET" && pathname === "/api/reports/payroll") {
    if (!hasPermission(db, user, "reports.view")) return sendJson(res, 403, { error: "Reports access required" });
    const cached = getReportsCache(req.url);
    if (cached) return sendJson(res, 200, cached);
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    const date = params.get("date") || currentBusinessDate();
    const period = params.get("period") || "month";
    
    const { start, end } = periodRange(date, period);
    const currentDb = await readDb();
    
    // Calculate holidays in period
    const rangeHolidays = (currentDb.holidays || []).filter((h) => inDateRange(h.holidayDate, start, end) && (branchId === "all" || h.branchId === "all" || h.branchId === branchId));
    const closureCount = rangeHolidays.filter((h) => h.type === "closure").length;
    
    const baseDate = new Date(`${date}T00:00:00`);
    const days = period === "month" ? new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate() : 1;
    
    const payroll = currentDb.users.filter((u) => u.active !== false && (branchId === "all" || u.branchIds?.includes(branchId))).map((user) => {
      const salary = Number(user.salaryAmount || 0);
      
      // Calculate attendance in period
      const userAttendance = (currentDb.attendance || []).filter(
        (a) => a.userId === user.id && inDateRange(a.date, start, end)
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
          presentDays = workingDays;
          calculatedSalary = salary * workingDays;
        } else {
          presentDays = days;
          calculatedSalary = (salary / 30) * days;
        }
      }
      
      // Calculate paid salary in the period for this user
      const userPayments = (currentDb.salaryPayments || []).filter(
        (p) => p.userId === user.id && inDateRange(p.date || currentBusinessDate(), start, end)
      );
      const totalPaid = userPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      
      return {
        userId: user.id,
        name: user.name,
        role: user.role,
        salaryAmount: salary,
        salaryType: user.salaryType || "monthly",
        presentDays,
        earnedSalary: money(calculatedSalary),
        paidSalary: money(totalPaid),
        balanceDue: money(calculatedSalary - totalPaid),
        payments: userPayments
      };
    });
    
    const result = { start, end, payroll };
    setReportsCache(req.url, result);
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && pathname === "/api/reports/daily") {
    if (!hasPermission(db, user, "reports.view")) return sendJson(res, 403, { error: "Reports access required" });
    const cached = getReportsCache(req.url);
    if (cached) return sendJson(res, 200, cached);
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const branchId = params.get("branchId") || "all";
    const date = params.get("date") || currentBusinessDate();
    const result = dailySummary(db, branchId, date);
    setReportsCache(req.url, result);
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && pathname === "/api/time-sync") {
    if (user.role !== "admin") return sendJson(res, 403, { error: "Admin access required" });
    return sendJson(res, 200, { serverTime: Date.now() });
  }

  // --- ADMIN SYSTEM BACKUP & RESTORE ---
  if (req.method === "GET" && pathname === "/api/admin/backup-export") {
    if (user.role !== "admin") return sendJson(res, 403, { error: "Admin access required" });
    const currentDb = await readDb();
    const exportDb = JSON.parse(JSON.stringify(currentDb));

    // Restore base64 image data into export JSON for menu items if stored externally
    if (Array.isArray(exportDb.menuItems)) {
      await Promise.all(
        exportDb.menuItems.map(async (item) => {
          if (!item.image || item.image.startsWith("/api/public/menu-item-image/") || item.image.includes("/placeholder.png")) {
            const base64 = await getMenuItemImage(item.id);
            if (base64) {
              item.image = base64;
            }
          }
        })
      );
    }

    // Restore base64 image data into export JSON for landing page images if stored externally
    if (exportDb.landingPageSettings) {
      if (!exportDb.landingPageSettings.brandLogo || exportDb.landingPageSettings.brandLogo.startsWith("/api/public/landing-image/")) {
        const logo = await getLandingImage("brandLogo");
        if (logo) exportDb.landingPageSettings.brandLogo = logo;
      }
      if (!exportDb.landingPageSettings.heroImage || exportDb.landingPageSettings.heroImage.startsWith("/api/public/landing-image/")) {
        const hero = await getLandingImage("heroImage");
        if (hero) exportDb.landingPageSettings.heroImage = hero;
      }
    }

    return sendJson(res, 200, exportDb);
  }

  if (req.method === "POST" && pathname === "/api/admin/backup-import") {
    if (user.role !== "admin") return sendJson(res, 403, { error: "Admin access required" });
    const body = await parseBody(req);
    const imported = body.database || body;
    if (!imported || typeof imported !== "object") {
      return sendJson(res, 400, { error: "Invalid backup format. Must be a JSON object." });
    }
    if (!Array.isArray(imported.users) || !Array.isArray(imported.branches)) {
      return sendJson(res, 400, { error: "Invalid backup format: 'users' and 'branches' must be valid arrays." });
    }

    const currentDb = await readDb();

    // Ensure all standard collections are initialized so no null/undefined references exist
    const arrayCollections = [
      "users", "branches", "roles", "taxRates", "categories", "menuItems",
      "suppliers", "inventory", "orders", "tableOrders", "kots", "supplierBills",
      "supplierOrders", "supplierPayments", "expenses", "loans", "holidays",
      "stockUsages", "attendance", "notifications", "customers", "partnerShops",
      "partnerSettlements", "salaryPayments", "owners", "ownerDraws", "coupons",
      "sessions", "auditLogs", "yieldMappings", "ingredientYields", "menuItemConsumptions"
    ];
    for (const key of arrayCollections) {
      if (!Array.isArray(imported[key])) {
        imported[key] = [];
      }
    }
    imported.group = imported.group || currentDb.group || { name: "MADURAI BASHA RESTAURANT GROUP" };
    imported.landingPageSettings = imported.landingPageSettings || currentDb.landingPageSettings || {};

    if (Array.isArray(imported.menuItems)) {
      await Promise.all(
        imported.menuItems.map(async (item) => {
          if (item.image && (item.image.includes("/api/public/menu-item-image/") || item.image.includes("/placeholder.png"))) {
            const currentItem = currentDb.menuItems ? currentDb.menuItems.find(mi => mi.id === item.id) : null;
            if (currentItem && currentItem.image && currentItem.image.startsWith("data:")) {
              item.image = currentItem.image;
            }
          }
          if (item.image && item.image.startsWith("data:")) {
            try {
              await saveMenuItemImage(item.id, item.image);
              item.image = "/api/public/menu-item-image/" + item.id;
            } catch (err) {
              console.error("Failed to store image on backup import:", err);
            }
          }
        })
      );
    }

    if (imported.landingPageSettings) {
      if (imported.landingPageSettings.brandLogo && imported.landingPageSettings.brandLogo.startsWith("data:")) {
        try {
          await saveLandingImage("brandLogo", imported.landingPageSettings.brandLogo);
          imported.landingPageSettings.brandLogo = "/api/public/landing-image/brandLogo";
        } catch (err) {}
      }
      if (imported.landingPageSettings.heroImage && imported.landingPageSettings.heroImage.startsWith("data:")) {
        try {
          await saveLandingImage("heroImage", imported.landingPageSettings.heroImage);
          imported.landingPageSettings.heroImage = "/api/public/landing-image/heroImage";
        } catch (err) {}
      }
    }

    await writeDb(imported);
    return sendJson(res, 200, { success: true, message: "Database imported successfully" });
  }

  if (req.method === "POST" && pathname === "/api/admin/factory-reset") {
    if (user.role !== "admin") return sendJson(res, 403, { error: "Admin access required" });
    const currentDb = await readDb();

    // Preserve critical system defaults so they are not locked out
    const adminUser = currentDb.users.find(u => u.role === "admin") || {
      id: "usr_admin",
      name: "Admin",
      email: "admin@basha.local",
      password: "admin123",
      role: "admin",
      branchIds: currentDb.branches.map(b => b.id),
      active: true
    };

    const preservedRoles = currentDb.roles || [];
    const preservedBranches = currentDb.branches || [];
    const preservedGroup = currentDb.group || { name: "MADURAI BASHA RESTAURANT GROUP" };
    const preservedTaxRates = currentDb.taxRates || [];
    const preservedLandingPageSettings = currentDb.landingPageSettings;

    // Fully purge categories, menu items, suppliers, inventory, orders, etc.
    const resetDb = {
      group: preservedGroup,
      branches: preservedBranches,
      roles: preservedRoles,
      taxRates: preservedTaxRates,
      landingPageSettings: preservedLandingPageSettings,
      users: [adminUser], // Keep the admin user to prevent lockout
      categories: [],
      menuItems: [],
      suppliers: [],
      inventory: [],
      orders: [],
      tableOrders: [],
      kots: [],
      supplierBills: [],
      supplierOrders: [],
      expenses: [],
      loans: [],
      holidays: [],
      stockUsages: [],
      attendance: [],
      notifications: [],
      customers: [],
      partnerShops: [],
      partnerSettlements: [],
      salaryPayments: [],
      owners: [],
      ownerDraws: [],
      coupons: [],
      sessions: [],
      auditLogs: [],
      meta: {
        updatedAt: new Date().toISOString(),
        resetAt: new Date().toISOString()
      }
    };

    await writeDb(resetDb);
    return sendJson(res, 200, { success: true, message: "All masters and operational data have been fully reset." });
  }

  if (req.method === "POST" && pathname === "/api/admin/clear-sales") {
    if (user.role !== "admin") return sendJson(res, 403, { error: "Admin access required" });
    const currentDb = await readDb();
    currentDb.orders = [];
    currentDb.kots = [];
    currentDb.tableOrders = [];
    currentDb.partnerSettlements = [];
    await writeDb(currentDb);
    return sendJson(res, 200, { success: true, message: "Sales and order records cleared successfully." });
  }

  // --- SALARY PAYMENTS (ADVANCES / PARTIAL / SETTLEMENTS) ---
  if (req.method === "GET" && pathname === "/api/salary-payments") {
    if (!["admin", "owner", "manager"].includes(user.role)) {
      return sendJson(res, 403, { error: "Access denied" });
    }
    const currentDb = await readDb();
    return sendJson(res, 200, currentDb.salaryPayments || []);
  }

  if (req.method === "POST" && pathname === "/api/salary-payments") {
    if (!["admin", "owner", "manager"].includes(user.role)) {
      return sendJson(res, 403, { error: "Access denied" });
    }
    const body = await parseBody(req);
    const amount = Number(body.amount || 0);
    if (!body.userId || amount <= 0 || !body.date) {
      return sendJson(res, 400, { error: "Missing required fields: userId, date, and positive amount are required." });
    }
    const currentDb = await readDb();
    currentDb.salaryPayments = currentDb.salaryPayments || [];
    const payment = {
      id: "sal_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      userId: body.userId,
      branchId: body.branchId || "all",
      date: body.date,
      amount,
      paymentMode: body.paymentMode || "Cash",
      type: body.type || "partial",
      notes: body.notes || "",
      createdAt: new Date().toISOString()
    };
    currentDb.salaryPayments.push(payment);
    await writeDb(currentDb);
    return sendJson(res, 201, { success: true, payment, salaryPayments: currentDb.salaryPayments });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/salary-payments/")) {
    if (!["admin", "owner", "manager"].includes(user.role)) {
      return sendJson(res, 403, { error: "Access denied" });
    }
    const id = pathname.substring("/api/salary-payments/".length);
    const currentDb = await readDb();
    currentDb.salaryPayments = (currentDb.salaryPayments || []).filter((p) => p.id !== id);
    await writeDb(currentDb);
    return sendJson(res, 200, { success: true, salaryPayments: currentDb.salaryPayments });
  }

  return sendJson(res, 404, { error: "API route not found" });
}

