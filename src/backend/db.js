import { readFile, writeFile, mkdir, rename, readdir, unlink } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

// Robust resolution of data directory walking up from the module path or checking process.cwd()
let dataDir = join(process.cwd(), "data");
const moduleFile = fileURLToPath(import.meta.url);
let currentPath = moduleFile;
for (let i = 0; i < 5; i++) {
  const checkDir = join(currentPath, "data");
  if (existsSync(checkDir) && existsSync(join(checkDir, "seed.json"))) {
    dataDir = checkDir;
    break;
  }
  const nextPath = join(currentPath, "..");
  if (nextPath === currentPath) break;
  currentPath = nextPath;
}

const seedPath = join(dataDir, "seed.json");
const runtimePath = join(dataDir, "runtime.json");

async function writeJsonAtomic(filePath, data) {
  const tempPath = filePath + ".tmp";
  await writeFile(tempPath, typeof data === "string" ? data : JSON.stringify(data, null, 2));
  await rename(tempPath, filePath);
}

// Timeout wrapper for MongoDB operations to prevent long API freezes
export function withMongoTimeout(promise, timeoutMs = 2500) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("MongoDB operation timed out")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Native .env file loader for environments where standard dotenv isn't imported
try {
  const envPath = join(process.cwd(), ".env");
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf8");
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const index = trimmed.indexOf("=");
        if (index > 0) {
          const key = trimmed.slice(0, index).trim();
          let val = trimmed.slice(index + 1).trim();
          if (val.startsWith('"') && val.endsWith('"')) {
            val = val.slice(1, -1);
          } else if (val.startsWith("'") && val.endsWith("'")) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
} catch (err) {
  console.warn("Failed to natively load .env file:", err.message);
}

let mongoClient = null;
let mongoDb = null;
let connectPromise = null;
let lastMongoError = null;
let mongoReconnectDelay = 10000; // Start at 10 seconds backoff

export function getLastMongoError() {
  return lastMongoError;
}

// Simple utility helpers needed for default seeding
function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function getMongoClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return null;
  }
  if (mongoClient) {
    return mongoClient;
  }
  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    try {
      const client = new MongoClient(uri, {
        connectTimeoutMS: 2000,        // Shorter timeout prevents long API thread locks
        serverSelectionTimeoutMS: 2000,// Fast fail if server unavailable
        socketTimeoutMS: 10000,
        maxPoolSize: 50,
        minPoolSize: 5,
        maxIdleTimeMS: 30000,
        retryWrites: true,
        retryReads: true,
      });
      await client.connect();
      mongoClient = client;
      mongoDb = client.db();
      console.log("Successfully connected to MongoDB");
      lastMongoError = null;
      mongoReconnectDelay = 10000; // Reset reconnection delay to 10s on success
      return mongoClient;
    } catch (err) {
      console.error("Failed to connect to MongoDB, falling back to local file system:", err.message);
      lastMongoError = err.message || String(err);
      
      // Implement exponential backoff for reconnect cooldown to prevent repeated API freezes
      const delay = mongoReconnectDelay;
      mongoReconnectDelay = Math.min(mongoReconnectDelay * 2, 300000); // Max 5 minutes (300,000 ms)
      setTimeout(() => {
        connectPromise = null;
      }, delay);
      return null;
    }
  })();

  return connectPromise;
}

async function ensureRuntimeData() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(runtimePath)) {
    const seed = await readFile(seedPath, "utf8");
    await writeJsonAtomic(runtimePath, seed);
  }
}

export function ensureMenuDescriptions(db) {
  if (!db || !Array.isArray(db.menuItems)) return;
  for (const item of db.menuItems) {
    if (item.description === undefined || item.description === null) {
      item.description = "";
    }
    if (item.description.trim() === "") {
      const name = String(item.name || "").toLowerCase();
      let desc = "";
      if (name.includes("bun parotta")) {
        desc = "Soft, layered, and flaky parotta shaped like a bun. Crispy on the outside, fluffy inside.";
      } else if (name.includes("panju parotta")) {
        desc = "Super soft, melt-in-the-mouth parotta, layered beautifully like cotton wool.";
      } else if (name.includes("nool parotta")) {
        desc = "Stringy, multi-layered string parotta cooked to golden perfection.";
      } else if (name.includes("veechu parotta")) {
        desc = "Thinly stretched, rectangular layered parotta, crispy and delicious.";
      } else if (name.includes("egg kothu")) {
        desc = "Minced flaky parotta shredded and stir-fried on a tawa with spiced eggs and gravy.";
      } else if (name.includes("chicken kothu")) {
        desc = "Delectable shredded parotta scrambled on a tawa with juicy chicken pieces, eggs, and rich gravy.";
      } else if (name.includes("mutton kothu")) {
        desc = "Rich, flavorful kothu parotta chopped with tender minced mutton, eggs, and signature spices.";
      } else if (name.includes("kothu")) {
        desc = "Minced layered parotta stir-fried with fragrant spices, curry leaves, and choice of meat.";
      } else if (name.includes("ceylon") || name.includes("lappa")) {
        desc = "Traditional folded parotta stuffed with a savory egg and meat filling, cooked on a hot griddle.";
      } else if (name.includes("ilai parotta") || name.includes("kizhi parotta")) {
        desc = "Parotta soaked in flavorful gravy, wrapped in a banana leaf and steam-cooked to infuse exotic aromas.";
      } else if (name.includes("coin parotta")) {
        desc = "Mini-sized, thick, flaky parottas, perfectly crispy and served in a set of 6.";
      } else if (name.includes("chicken biriyani")) {
        desc = "Fragrant Seeraga Samba rice cooked with succulent chicken pieces, freshly ground spices, and herbs in traditional Basha style.";
      } else if (name.includes("plain biriyani") || name.includes("kuska")) {
        desc = "Aromatic biriyani rice cooked to perfection with rich spices and herbs, served without meat.";
      } else if (name.includes("egg biriyani")) {
        desc = "Fragrant Samba biriyani rice served with perfectly boiled spiced eggs.";
      } else if (name.includes("mutton biriyani")) {
        desc = "Premium Seeraga Samba rice layered with slow-cooked tender mutton and native aromatic spices.";
      } else if (name.includes("biriyani")) {
        desc = "Traditional spiced rice dish cooked with aromatic Seeraga Samba rice, native herbs, and spices.";
      } else if (name.includes("dosa") || name.includes("dosai")) {
        desc = "Crispy South Indian crepe made from fermented rice and lentil batter.";
      } else if (name.includes("tandoori")) {
        desc = "Succulent chicken marinated in yogurt and aromatic spices, roasted to perfection in a traditional tandoor clay oven.";
      } else if (name.includes("65")) {
        desc = "Crispy, deep-fried spicy entree seasoned with curry leaves and green chilies.";
      } else if (name.includes("rice") || name.includes("noodles")) {
        desc = "Freshly tossed rice or soft noodles stir-fried in a wok with fresh vegetables, eggs, or savory meat.";
      } else if (name.includes("roti") || name.includes("naan")) {
        desc = "Traditional oven-baked Indian flatbread, perfect for pairing with savory gravies.";
      } else {
        const cat = db.categories?.find(c => c.id === item.categoryId);
        const catName = String(cat?.name || "").toLowerCase();
        if (catName.includes("beverage") || catName.includes("juice")) {
          desc = `Refreshing and freshly prepared ${item.name} to quench your thirst.`;
        } else if (catName.includes("dessert") || catName.includes("sweet")) {
          desc = `Delightful, sweet, and comforting ${item.name} to complete your meal.`;
        } else if (catName.includes("starter") || catName.includes("appetizer")) {
          desc = `Crispy and appetizing ${item.name}, perfect to start your feast.`;
        } else {
          desc = `Delicious and freshly prepared ${item.name}, made with premium ingredients in authentic Basha style.`;
        }
      }
      item.description = desc;
    }
  }
}

export function ensureMenuCodes(db) {
  const used = new Set();
  for (const [index, item] of db.menuItems.entries()) {
    const existing = String(item.code || "").trim().toUpperCase();
    if (existing && !used.has(existing)) {
      item.code = existing;
      used.add(existing);
      continue;
    }
    const generated = `ITEM${String(index + 1).padStart(3, "0")}`;
    item.code = generated;
    used.add(generated);
  }
  ensureMenuDescriptions(db);
}

export function ensureMasterDefaults(db) {
  const defaultRoles = [
    { id: "role_admin", name: "admin", label: "Admin", permissions: ["*"], active: true },
    { id: "role_owner", name: "owner", label: "Owner", permissions: ["dashboard.view", "reports.view", "pos.use", "kitchen.use", "inventory.view", "purchase.manage", "attendance.manage", "bills.view", "delivery.use", "notifications.view", "loans.view", "masters.view", "order.cancel"], active: true },
    { id: "role_manager", name: "manager", label: "Manager", permissions: ["dashboard.view", "reports.view", "pos.use", "kitchen.use", "inventory.view", "purchase.manage", "order.cancel", "attendance.manage", "bills.view", "delivery.use", "notifications.view", "loans.view", "masters.view"], active: true },
    { id: "role_server", name: "server", label: "Server", permissions: ["table.use"], active: true },
    { id: "role_cashier", name: "cashier", label: "Cashier", permissions: ["pos.use", "bills.view", "delivery.use"], active: true },
    { id: "role_kitchen", name: "kitchen", label: "Kitchen", permissions: ["kitchen.use"], active: true },
    { id: "role_delivery", name: "delivery", label: "Delivery Agent", permissions: ["delivery.use"], active: true },
    { id: "role_kot_reader", name: "kot_reader", label: "KOT Reader", permissions: ["kitchen.use", "order.cancel"], active: true },
    { id: "role_floor_manager", name: "floor_manager", label: "Floor Manager", permissions: ["table.use", "kitchen.use"], active: true }
  ];
  db.roles = db.roles?.length ? db.roles : defaultRoles;
  for (const role of defaultRoles) {
    const existing = db.roles.find((item) => item.name === role.name);
    if (existing) {
      if (["owner", "manager", "kot_reader"].includes(role.name)) {
        for (const p of ["attendance.manage", "bills.view", "delivery.use", "notifications.view", "loans.view", "masters.view", "order.cancel"]) {
          if (role.name === "kot_reader" && !["kitchen.use", "order.cancel"].includes(p)) continue;
          if (!existing.permissions.includes(p)) {
            existing.permissions.push(p);
          }
        }
      }
      if (role.name === "cashier") {
        for (const p of ["bills.view", "delivery.use"]) {
          if (!existing.permissions.includes(p)) {
            existing.permissions.push(p);
          }
        }
      }
    } else {
      db.roles.push(role);
    }
  }
  db.taxRates = db.taxRates?.length ? db.taxRates : [{ id: "tax_gst_5", name: "GST 5%", rate: Number(db.group.taxRate || 0.05), active: true }];
  db.inventory = db.inventory || [];
  for (const item of db.inventory) {
    if (!item.itemType) {
      item.itemType = "raw";
    }
  }
  db.supplierBills = db.supplierBills || [];
  db.suppliers = db.suppliers || [];
  for (const s of db.suppliers) {
    if (s.pendingAmount === undefined) s.pendingAmount = 0;
  }
  db.supplierPayments = db.supplierPayments || [];
  db.supplierOrders = db.supplierOrders || [];
  db.tableOrders = db.tableOrders || [];
  db.expenses = db.expenses || [];
  db.loans = db.loans || [];
  db.holidays = db.holidays || [];
  db.stockUsages = db.stockUsages || [];
  db.attendance = db.attendance || [];
  db.notifications = db.notifications || [];
  db.customers = db.customers || [];
  db.partnerShops = db.partnerShops || [];
  db.partnerSettlements = db.partnerSettlements || [];
  db.salaryPayments = db.salaryPayments || [];
  db.owners = db.owners || [];
  db.ownerDraws = db.ownerDraws || [];
  db.coupons = db.coupons || [];
  db.yieldMappings = db.yieldMappings || [];
  db.ingredientYields = db.ingredientYields || [];
  db.menuItemConsumptions = db.menuItemConsumptions || [];
  const ensureDefaultUser = (candidate) => {
    if (!db.users.some((user) => user.id === candidate.id || user.email === candidate.email)) db.users.push(candidate);
  };
  if (!db.users.some((user) => user.role === "admin")) {
    db.users.unshift({
      id: "usr_admin",
      name: "Admin",
      email: "admin@basha.local",
      password: "admin123",
      role: "admin",
      branchIds: db.branches.map((branch) => branch.id),
      active: true
    });
  }
  ensureDefaultUser({
    id: "usr_server_pondy",
    name: "Pondy Server",
    email: "server.pondy@basha.local",
    password: "server123",
    role: "server",
    branchIds: ["pondy_main"],
    active: true
  });
  ensureDefaultUser({
    id: "usr_kitchen_pondy",
    name: "Pondy Kitchen",
    email: "kitchen.pondy@basha.local",
    password: "kitchen123",
    role: "kitchen",
    branchIds: ["pondy_main"],
    active: true
  });
  for (const supplier of db.suppliers || []) {
    if (!("active" in supplier)) supplier.active = true;
  }
  for (const bill of db.supplierBills || []) {
    if (!("paidAmount" in bill)) bill.paidAmount = bill.paymentStatus === "paid" ? money(bill.total) : 0;
    if (!("balanceAmount" in bill)) bill.balanceAmount = bill.paymentStatus === "paid" ? 0 : money(bill.total - bill.paidAmount);
  }
  for (const user of db.users || []) {
    if (!("salaryAmount" in user)) user.salaryAmount = 0;
    if (!("salaryType" in user)) user.salaryType = "monthly";
  }
  for (const item of db.inventory || []) {
    if (!("supplierIds" in item)) item.supplierIds = item.supplierId ? [item.supplierId] : [];
    if (!("active" in item)) item.active = true;
    
    // Seed priceHistory if missing
    if (!item.priceHistory || item.priceHistory.length === 0) {
      const lastCost = Number(item.lastCost || 30);
      const baseDate = new Date();
      const history = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(baseDate);
        d.setDate(baseDate.getDate() - i * 3);
        const randomFactor = 0.9 + Math.random() * 0.2; // +/- 10%
        history.push({
          date: dateKey(d),
          cost: money(lastCost * (i === 0 ? 1 : randomFactor))
        });
      }
      item.priceHistory = history;
    }
  }
}

let cachedDb = null;
const reportsCache = new Map();

export function getReportsCache(key) {
  return reportsCache.get(key);
}

export function setReportsCache(key, value) {
  reportsCache.set(key, value);
}

export function clearReportsCache() {
  reportsCache.clear();
}

export async function saveMenuItemImage(itemId, base64) {
  if (!itemId || !base64) return;
  
  // 1. Try MongoDB
  const client = await getMongoClient();
  if (client && mongoDb) {
    try {
      const collection = mongoDb.collection("menu_item_images");
      await collection.replaceOne({ _id: itemId }, { _id: itemId, image: base64 }, { upsert: true });
      return;
    } catch (err) {
      console.error(`[Database Image Storage] Error saving image ${itemId} to MongoDB:`, err.message);
    }
  }

  // 2. Local fallback
  try {
    const imagesDir = join(dataDir, "images");
    await mkdir(imagesDir, { recursive: true });
    const imagePath = join(imagesDir, itemId);
    await writeFile(imagePath, base64, "utf8");
  } catch (err) {
    console.error(`[Database Image Storage] Error saving image ${itemId} to disk:`, err.message);
  }
}

export async function getMenuItemImage(itemId) {
  if (!itemId) return null;

  // 1. Try MongoDB
  const client = await getMongoClient();
  if (client && mongoDb) {
    try {
      const collection = mongoDb.collection("menu_item_images");
      const doc = await collection.findOne({ _id: itemId });
      if (doc && doc.image) {
        return doc.image;
      }
    } catch (err) {
      console.error(`[Database Image Storage] Error loading image ${itemId} from MongoDB:`, err.message);
    }
  }

  // 2. Local fallback
  try {
    const imagePath = join(dataDir, "images", itemId);
    if (existsSync(imagePath)) {
      return await readFile(imagePath, "utf8");
    }
  } catch (err) {
    // ignore
  }
  return null;
}

export async function saveLandingImage(key, base64) {
  if (!key || !base64) return;

  // 1. Try MongoDB
  const client = await getMongoClient();
  if (client && mongoDb) {
    try {
      const collection = mongoDb.collection("landing_images");
      await collection.replaceOne({ _id: key }, { _id: key, image: base64 }, { upsert: true });
      return;
    } catch (err) {
      console.error(`[Database Image Storage] Error saving landing image ${key} to MongoDB:`, err.message);
    }
  }

  // 2. Local fallback
  try {
    const imagesDir = join(dataDir, "images");
    await mkdir(imagesDir, { recursive: true });
    const imagePath = join(imagesDir, `landing_${key}`);
    await writeFile(imagePath, base64, "utf8");
  } catch (err) {
    console.error(`[Database Image Storage] Error saving landing image ${key} to disk:`, err.message);
  }
}

export async function getLandingImage(key) {
  if (!key) return null;

  // 1. Try MongoDB
  const client = await getMongoClient();
  if (client && mongoDb) {
    try {
      const collection = mongoDb.collection("landing_images");
      const doc = await collection.findOne({ _id: key });
      if (doc && doc.image) {
        return doc.image;
      }
    } catch (err) {
      console.error(`[Database Image Storage] Error loading landing image ${key} from MongoDB:`, err.message);
    }
  }

  // 2. Try local fallback
  try {
    const imagePath = join(dataDir, "images", `landing_${key}`);
    if (existsSync(imagePath)) {
      return await readFile(imagePath, "utf8");
    }
  } catch (err) {
    // ignore
  }
  return null;
}

export async function migrateAndExtractBloatedImages(db) {
  let modified = false;

  // 1. Extract menu item base64 images in parallel
  if (Array.isArray(db.menuItems)) {
    await Promise.all(
      db.menuItems.map(async (item) => {
        if (item.image && item.image.startsWith("data:")) {
          console.log(`[Database Auto-Migration] Extracting base64 image for menu item "${item.name}" (${Math.round(item.image.length / 1024)} KB) to external storage...`);
          try {
            await saveMenuItemImage(item.id, item.image);
            item.image = "/api/public/menu-item-image/" + item.id;
            modified = true;
          } catch (err) {
            console.error(`Failed to migrate image for menu item "${item.name}":`, err.message);
          }
        }
      })
    );
  }

  // 2. Extract landing settings images
  if (db.landingPageSettings) {
    if (db.landingPageSettings.brandLogo && db.landingPageSettings.brandLogo.startsWith("data:")) {
      console.log(`[Database Auto-Migration] Extracting base64 landing page brandLogo (${Math.round(db.landingPageSettings.brandLogo.length / 1024)} KB) to external storage...`);
      try {
        await saveLandingImage("brandLogo", db.landingPageSettings.brandLogo);
        db.landingPageSettings.brandLogo = "/api/public/landing-image/brandLogo";
        modified = true;
      } catch (err) {
        console.error(`Failed to migrate landing page brandLogo:`, err.message);
      }
    }
    if (db.landingPageSettings.heroImage && db.landingPageSettings.heroImage.startsWith("data:")) {
      console.log(`[Database Auto-Migration] Extracting base64 landing page heroImage (${Math.round(db.landingPageSettings.heroImage.length / 1024)} KB) to external storage...`);
      try {
        await saveLandingImage("heroImage", db.landingPageSettings.heroImage);
        db.landingPageSettings.heroImage = "/api/public/landing-image/heroImage";
        modified = true;
      } catch (err) {
        console.error(`Failed to migrate landing page heroImage:`, err.message);
      }
    }
  }

  return modified;
}

export async function clearImagesData() {
  try {
    const imagesDir = join(dataDir, "images");
    if (existsSync(imagesDir)) {
      const files = await readdir(imagesDir).catch(() => []);
      for (const file of files) {
        await unlink(join(imagesDir, file)).catch(() => {});
      }
    }
  } catch (err) {
    console.error("Error clearing local images:", err.message);
  }

  const client = await getMongoClient().catch(() => null);
  if (client && mongoDb) {
    try {
      await withMongoTimeout(mongoDb.collection("menu_item_images").deleteMany({}), 2500).catch(() => {});
      await withMongoTimeout(mongoDb.collection("landing_images").deleteMany({}), 2500).catch(() => {});
    } catch (err) {
      console.error("Error clearing MongoDB image collections:", err.message);
    }
  }
}

export async function readDb() {
  if (cachedDb) {
    // structuredClone is a native (C++) deep clone - much faster than
    // JSON.parse(JSON.stringify()) for large/nested objects, and it
    // doesn't block the event loop nearly as long since there's no
    // intermediate string allocation.
    return structuredClone(cachedDb);
  }

  const client = await getMongoClient().catch(() => null);
  if (client && mongoDb) {
    try {
      const collection = mongoDb.collection("system_state");
      const doc = await withMongoTimeout(collection.findOne({ _id: "master_state" }), 2500);
      if (doc) {
        const { _id, ...db } = doc;
        ensureMenuCodes(db);
        ensureMasterDefaults(db);
        const shrunk = await migrateAndExtractBloatedImages(db);
        cachedDb = structuredClone(db);
        if (shrunk) {
          const copy = structuredClone(db);
          delete copy._id;
          withMongoTimeout(collection.replaceOne({ _id: "master_state" }, copy, { upsert: true }), 2500).catch(() => {});
        }
        return db;
      } else {
        await ensureRuntimeData();
        const seedStr = await readFile(seedPath, "utf8");
        const db = JSON.parse(seedStr);
        ensureMenuCodes(db);
        ensureMasterDefaults(db);
        await migrateAndExtractBloatedImages(db);
        cachedDb = structuredClone(db);
        withMongoTimeout(collection.replaceOne({ _id: "master_state" }, { ...db }, { upsert: true }), 2500).catch(() => {});
        return db;
      }
    } catch (err) {
      console.error("Error reading from MongoDB, falling back to local file:", err.message);
    }
  }

  await ensureRuntimeData();
  const db = JSON.parse(await readFile(runtimePath, "utf8"));
  ensureMenuCodes(db);
  ensureMasterDefaults(db);
  const shrunk = await migrateAndExtractBloatedImages(db);
  if (shrunk) {
    await writeJsonAtomic(runtimePath, db);
  }
  cachedDb = structuredClone(db);
  return db;
}

let writeQueue = Promise.resolve();

export async function writeDb(db) {
  const currentWrite = (async () => {
    // Wait for the previous write to finish, ignoring its success/failure so we never block
    try {
      await writeQueue;
    } catch (err) {
      console.warn("[Database Queue] Prior write failed, proceeding with current write:", err.message);
    }

    ensureMenuCodes(db);
    ensureMasterDefaults(db);
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();

    // Instantly sync the local memory cache to keep parallel requests perfectly updated.
    // structuredClone is a native deep clone - much cheaper than a JSON string round-trip,
    // and we reuse this single clone for the MongoDB write below instead of cloning twice.
    const snapshot = structuredClone(db);
    cachedDb = snapshot;

    // Invalidate reports cache on writes
    clearReportsCache();

    // Always update local disk atomically as primary fast persistence
    const localWritePromise = writeJsonAtomic(runtimePath, db).catch((err) => {
      console.error("Error writing to local JSON file:", err.message);
    });

    const client = await getMongoClient().catch(() => null);
    if (client && mongoDb) {
      try {
        const collection = mongoDb.collection("system_state");
        const copy = structuredClone(snapshot);
        delete copy._id;
        await withMongoTimeout(collection.replaceOne({ _id: "master_state" }, copy, { upsert: true }), 2500);
      } catch (err) {
        console.error("Error writing to MongoDB, fallback kept local file:", err.message);
      }
    }

    await localWritePromise;
  })();

  // Chain the current write onto the queue
  writeQueue = currentWrite;

  // Wait for this specific write to finish and propagate errors or success to the caller
  return currentWrite;
}
