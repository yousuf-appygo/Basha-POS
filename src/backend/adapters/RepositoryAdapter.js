/**
 * Clean Architecture - Repository Adapter
 * Implements data access layer connecting domain use cases to the database driver
 */

import { currentDb, saveDb, readDb, getMenuItemImage, getLandingImage } from "../db.js";
import { activeTaxRate } from "../utils.js";

export class RepositoryAdapter {
  async getMenuItems() {
    return currentDb.menuItems || [];
  }

  async getActiveTaxRate() {
    return activeTaxRate(currentDb);
  }

  async getOrderById(id) {
    return (currentDb.orders || []).find(o => o.id === id);
  }

  async saveOrder(order) {
    if (!currentDb.orders) currentDb.orders = [];
    currentDb.orders.push(order);
    await saveDb();
    return order;
  }

  async updateOrder(order) {
    const idx = (currentDb.orders || []).findIndex(o => o.id === order.id);
    if (idx !== -1) {
      currentDb.orders[idx] = order;
      await saveDb();
    }
    return order;
  }

  async getFullDatabaseExport() {
    await readDb();
    const exportDb = JSON.parse(JSON.stringify(currentDb));
    
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
    return exportDb;
  }

  async restoreFullDatabase(backupData) {
    const currentDb = await readDb();
    const imported = backupData.database || backupData;

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
    return { success: true, restoredAt: new Date().toISOString() };
  }
}
