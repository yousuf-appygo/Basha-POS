import { state, t } from "../modules/state.js";
import { esc, formatMoney, round, activeTax, taxPercent, hasUiPermission, showToast, showNotificationToast } from "../modules/utils.js";
import { api } from "../modules/api.js";
import { printCustomerBill, printKot, printBillAndKot } from "../modules/print.js";
import { openModal, openDailyPortionsModal } from "../modules/modal.js";

export function tableCartTotals() {
  const subtotal = round(state.tableCart.reduce((sum, line) => sum + line.price * line.quantity, 0));
  const discount = round(subtotal * (Number(state.discountPercent || 0) / 100));
  const taxableAmount = round(subtotal - discount);
  const tax = activeTax().inactive ? 0 : round(taxableAmount * Number(activeTax().rate || 0));
  return { subtotal, discount, taxableAmount, tax, total: round(taxableAmount + tax) };
}

export function cartTotals() {
  const subtotal = round(state.cart.reduce((sum, line) => sum + line.price * line.quantity, 0));
  
  let couponDiscountPercent = 0;
  if (state.appliedCouponCode) {
    const cp = state.coupons.find(c => c.code.toUpperCase() === state.appliedCouponCode.toUpperCase() && c.active);
    if (cp && subtotal >= (cp.minOrderAmount || 0)) {
      couponDiscountPercent = cp.discountPercent;
    }
  }

  const finalDiscountPercent = Number(state.discountPercent || 0) + couponDiscountPercent;
  const discount = round(subtotal * (finalDiscountPercent / 100));
  const taxableAmount = round(subtotal - discount);
  const tax = activeTax().inactive ? 0 : round(taxableAmount * Number(activeTax().rate || 0));
  const deliveryFee = state.orderType === "delivery" ? Number(state.deliveryFee || 0) : 0;
  const deliveryTip = state.orderType === "delivery" ? Number(state.deliveryTip || 0) : 0;
  
  const pointsRedeemed = Number(state.pointsRedeemed || 0);
  const loyaltySettings = state.loyaltySettings || { rupeesPerPoint: 100, rupeeValuePerPoint: 1 };
  const pointsDiscount = round(pointsRedeemed * Number(loyaltySettings.rupeeValuePerPoint || 1));
  const baseTotal = round(taxableAmount + tax + deliveryFee + deliveryTip);

  return { 
    subtotal, 
    discount, 
    taxableAmount, 
    tax, 
    deliveryFee, 
    deliveryTip,
    couponDiscountPercent,
    finalDiscountPercent,
    pointsRedeemed,
    pointsDiscount,
    total: round(Math.max(0, baseTotal - pointsDiscount))
  };
}

export function renderPos() {
  const activeMenuItems = state.menuItems.filter((item) => item.active);
  const activeCategories = state.categories.filter((category) => category.active !== false);
  if (state.activeCategory !== "all" && !activeCategories.some((category) => category.id === state.activeCategory)) {
    state.activeCategory = "all";
  }
  const search = state.posSearch.trim().toLowerCase();
  const categoryItems = state.activeCategory === "all"
    ? activeMenuItems
    : activeMenuItems.filter((item) => item.categoryId === state.activeCategory);
  const items = search
    ? categoryItems.filter((item) => {
        return item.name.toLowerCase().includes(search) || 
               String(item.code || "").toLowerCase().includes(search);
      })
    : categoryItems;
  const totals = cartTotals();
  const tax = activeTax();
  const cartCount = state.cart.reduce((sum, line) => sum + line.quantity, 0);
  return `
    <div class="pos-mobile-tabs" style="display: none; width: 100%; border-bottom: 2px solid var(--line); margin-bottom: 16px; gap: 8px;">
      <button class="pos-mobile-tab-btn" data-mobile-tab="items" style="flex: 1; padding: 12px 6px; font-weight: 800; border-bottom: 3px solid ${state.posMobileTab === 'items' ? 'var(--brand)' : 'transparent'}; background: none; color: ${state.posMobileTab === 'items' ? 'var(--brand)' : 'var(--muted)'}; font-size: 14px;">🍔 Items List</button>
      <button class="pos-mobile-tab-btn" data-mobile-tab="cart" style="flex: 1; padding: 12px 6px; font-weight: 800; border-bottom: 3px solid ${state.posMobileTab === 'cart' ? 'var(--brand)' : 'transparent'}; background: none; color: ${state.posMobileTab === 'cart' ? 'var(--brand)' : 'var(--muted)'}; font-size: 14px;">🛒 View Bill (${cartCount})</button>
    </div>
    <section class="pos-layout ${state.posMobileTab === 'items' ? 'show-items' : 'show-cart'}">
      <div>
        <div class="daily-portions-banner">
          <div class="daily-portions-info">
            <span style="font-size: 20px;">☀️</span>
            <div>
              <strong style="display: block; font-size: 13.5px; color: var(--brand);">Daily Portion Prep Control</strong>
              <small class="muted" style="font-size: 11px;">Track prepared stock counts & category auto out-of-stock alerts.</small>
            </div>
          </div>
          <div class="daily-portions-actions">
            <button class="btn secondary compact" id="btnDailyPortionsSetup" style="font-weight: 800; border-color: rgba(212,175,55,0.4); font-size: 12.5px; padding: 6px 14px;">Setup Today's Prepared Portions</button>
            <button class="btn warning compact" id="btnRecentBillsPOS" style="font-weight: 800; background: rgba(212, 175, 55, 0.12); color: #d4af37; border-color: rgba(212, 175, 55, 0.35); font-size: 12.5px; padding: 6px 14px; display: flex; align-items: center; gap: 4px;">🕒 Recent Bills</button>
          </div>
        </div>
        ${(() => {
          const lowStockItems = (state.summary?.lowStock || []);
          if (lowStockItems.length === 0) return "";
          
          return `
            <div class="low-stock-banner">
              <div class="low-stock-info">
                <span style="font-size: 18px; animation: pulse 1s infinite alternate;">⚠️</span>
                <div>
                  <strong style="font-size: 13px; color: #f87171; display: block; font-weight: 800;">Low Stock Inventory Alerts</strong>
                  <span class="muted" style="font-size: 11px; font-weight: 700;">
                    ${lowStockItems.map(item => `${esc(item.name)} (${esc(item.depletionText || "Reorder")})`).join(", ")}
                  </span>
                </div>
              </div>
              <button class="btn secondary compact" id="btnSettleNotificationRead" style="font-size: 10px; font-weight: 800; border-color: rgba(239,68,68,0.2); padding: 4px 8px; color: #f87171;" onclick="state.activeView='inventory'; render();">View Inventory</button>
            </div>
          `;
        })()}
        <div class="pos-search-row">
          <div class="field" style="margin-top:0">
            <label>Search Item / Code</label>
            <input id="posSearch" class="search-input" value="${esc(state.posSearch)}" placeholder="Type item name or code..." autocomplete="off" />
          </div>
          <button class="btn secondary" id="clearSearch" type="button">Clear</button>
        </div>
        <div class="category-tabs">
          <button data-category="all" class="${state.activeCategory === "all" ? "active" : ""}">All</button>
          ${activeCategories.map((category) => `<button data-category="${category.id}" class="${state.activeCategory === category.id ? "active" : ""}">${esc(category.name)}</button>`).join("")}
        </div>
        <div class="menu-grid">
          ${items.map((item) => {
            const cat = state.categories.find(c => c.id === item.categoryId);
            const catPortionsLeft = cat?.portionsAvailable !== undefined && cat?.portionsAvailable !== null ? Number(cat.portionsAvailable) : null;
            const isCatOutOfStock = catPortionsLeft !== null && catPortionsLeft <= 0;
            
            const portionsLeft = item.portionsAvailable !== undefined && item.portionsAvailable !== null ? Number(item.portionsAvailable) : null;
            const warningLimit = item.portionsWarningLimit !== undefined && item.portionsWarningLimit !== null ? Number(item.portionsWarningLimit) : 0;
            
            const isOutOfStock = item.outOfStock === true || item.outOfStock === "true" || (portionsLeft !== null && portionsLeft <= 0) || isCatOutOfStock;
            const isLowStock = !isOutOfStock && (
              (portionsLeft !== null && portionsLeft > 0 && portionsLeft <= warningLimit) ||
              (catPortionsLeft !== null && catPortionsLeft > 0 && catPortionsLeft <= (cat.portionsWarningLimit || 0))
            );
            
            return `
              <button class="item-card ${isOutOfStock ? 'out-of-stock' : ''}" 
                data-add-item="${item.id}" 
                ${isOutOfStock ? 'disabled' : ''} 
                style="${isOutOfStock ? 'opacity: 0.55; position: relative; pointer-events: none; border: 1.5px solid #ef4444; background: rgba(239, 68, 68, 0.05);' : isLowStock ? 'border: 1.5px solid #f59e0b; background: rgba(245, 158, 11, 0.03);' : ''}">
                
                ${isOutOfStock ? `
                  <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.75); color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 800; font-size: 11px; z-index: 10; border-radius: 6px; letter-spacing: 0.05em; padding: 4px; text-align: center;">
                    <span style="color: #ef4444; font-size: 14px;">🚫</span>
                    <span style="color: #f87171;">OUT OF STOCK</span>
                    ${isCatOutOfStock ? `<span style="font-size: 9px; color: #fca5a5; font-weight: normal; margin-top: 2px;">(Category Limit)</span>` : ''}
                  </div>
                ` : ''}
                
                <span class="code-pill">${esc(item.code || "NO CODE")}</span>
                <strong>${esc(item.name)}</strong>
                <span class="tiny">${esc(item.kitchenStation)}</span>
                <div class="price">${formatMoney(item.price)}</div>
                
                ${portionsLeft !== null ? `
                  <div style="font-size: 11px; margin-top: 6px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 4px; color: ${isOutOfStock ? '#ef4444' : isLowStock ? '#f59e0b' : '#10b981'}">
                    <span>⚡</span> <span>Portions left: ${portionsLeft}</span>
                  </div>
                ` : catPortionsLeft !== null ? `
                  <div style="font-size: 11px; margin-top: 6px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 4px; color: ${isOutOfStock ? '#ef4444' : isLowStock ? '#f59e0b' : '#10b981'}">
                    <span>⚡</span> <span>Cat left: ${catPortionsLeft}</span>
                  </div>
                ` : ''}
              </button>
            `;
          }).join("")}
        </div>
      </div>
      <aside class="panel cart-panel">
        <div class="section-title"><h2>Current Cart / Bill</h2></div>
        <div class="cart-scroll-area">
          <div class="grid cols-2">
            <div class="field">
              <label>Order Type</label>
              <select id="orderType">
                <option value="dine-in" ${state.orderType === "dine-in" ? "selected" : ""}>Dine In</option>
                <option value="takeaway" ${state.orderType === "takeaway" ? "selected" : ""}>Takeaway</option>
                <option value="delivery" ${state.orderType === "delivery" ? "selected" : ""}>Delivery</option>
              </select>
            </div>
            <div class="field">
              <label>Table / Ref No</label>
              <input id="tableNo" value="${esc(state.tableNo)}" placeholder="e.g. 5 or A2" />
            </div>
          </div>
          <div class="grid cols-2">
            <div class="field">
              <label>Customer Phone (Loyalty)</label>
              <input id="customerPhone" value="${esc(state.customerPhone)}" placeholder="9876543210" autocomplete="off" />
            </div>
            <div class="field">
              <label>Customer Name</label>
              <input id="customerName" value="${esc(state.customerName)}" placeholder="e.g. Rahul" autocomplete="off" />
            </div>
          </div>
          ${state.orderType === "delivery" ? `
            <div class="field">
              <label>Delivery Address</label>
              <input id="deliveryAddress" value="${esc(state.deliveryAddress)}" placeholder="Street, landmark, door no..." />
            </div>
            <div class="grid cols-2">
              <div class="field">
                <label>Delivery Fee (₹)</label>
                <input id="deliveryFee" type="number" min="0" value="${esc(state.deliveryFee)}" placeholder="0" />
              </div>
              <div class="field">
                <label>Driver Tip (₹)</label>
                <input id="deliveryTip" type="number" min="0" value="${esc(state.deliveryTip)}" placeholder="0" />
              </div>
            </div>
          ` : ""}
          <div class="cart-items">
            ${state.cart.length ? state.cart.map((line) => `
              <div class="cart-row">
                <div>
                  <strong>${esc(line.name)}</strong>
                  <div class="muted">${formatMoney(line.price)} each</div>
                </div>
                <div class="qty-controls">
                  <button class="btn secondary compact" data-qty-dec="${line.id}">-</button>
                  <input class="cart-qty-input" data-qty-input="${line.id}" type="number" min="1" value="${line.quantity}" style="width: 44px; text-align: center; padding: 4px; border-radius: 4px; border: 1px solid var(--line); background: var(--panel); font-weight: bold; color: var(--ink);" />
                  <button class="btn secondary compact" data-qty-inc="${line.id}">+</button>
                  <button class="btn danger compact" data-remove="${line.id}">×</button>
                </div>
              </div>
            `).join("") : `<p class="muted">Cart is empty. Tap items on the left to add.</p>`}
          </div>
          <div class="grid cols-2">
            <div class="field">
              <label>Discount %</label>
              <input id="discountPercent" type="number" min="0" max="100" value="${esc(state.discountPercent)}" />
            </div>
            <div class="field">
              <label>Payment Method</label>
              <select id="paymentMode">
                <option value="upi" ${state.paymentMode === "upi" ? "selected" : ""}>UPI / QR</option>
                <option value="cash" ${state.paymentMode === "cash" ? "selected" : ""}>Cash</option>
                <option value="card" ${state.paymentMode === "card" ? "selected" : ""}>Card</option>
                <option value="aggregator" ${state.paymentMode === "aggregator" ? "selected" : ""}>Aggregator Partner</option>
              </select>
            </div>
          </div>
          <div class="totals">
            <div class="total-row"><span>Subtotal</span><strong>${formatMoney(totals.subtotal)}</strong></div>
            <div class="total-row"><span>Discount</span><strong>${formatMoney(totals.discount)}</strong></div>
            ${!tax.inactive && tax.rate > 0 ? `
            <div class="total-row"><span>${esc(tax.name)} ${taxPercent(tax)}%</span><strong>${formatMoney(totals.tax)}</strong></div>
            ` : ""}
            <div class="total-row grand"><span>Payable Amount</span><strong>${formatMoney(totals.total)}</strong></div>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 14px;">
          <button class="btn" id="btnExpressCash" ${state.cart.length ? "" : "disabled"} style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #fff; border: none; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25); font-weight: 800; font-size: 13px; height: 42px;">
            ⚡ Express Cash Checkout <kbd style="font-size: 10px; padding: 1px 4px; background: rgba(0,0,0,0.2); border-radius: 3px; border: 1px solid rgba(255,255,255,0.25); font-family: monospace; margin-left: 4px;">F10</kbd>
          </button>
          <div class="grid cols-2" style="gap: 8px;">
            <button class="btn secondary" id="placeOrderBillOnly" ${state.cart.length ? "" : "disabled"} style="font-weight: bold; background: rgba(212,175,55,0.08); color: var(--brand); border: 1px solid rgba(212,175,55,0.3);">
              Bill Only
            </button>
            <button class="btn" id="placeOrder" ${state.cart.length ? "" : "disabled"}>
              Bill + KOT <kbd style="font-size: 10px; padding: 1px 4px; background: rgba(0,0,0,0.18); border-radius: 3px; border: 1px solid rgba(255,255,255,0.15); font-family: monospace; margin-left: 4px; opacity: 0.85;">F8</kbd>
            </button>
          </div>
          <button class="btn secondary" id="clearCart" style="width: 100%;">
            Clear Cart <kbd style="font-size: 10px; padding: 1px 4px; background: rgba(255,255,255,0.06); border-radius: 3px; border: 1px solid rgba(255,255,255,0.1); font-family: monospace; margin-left: 4px; opacity: 0.85;">Alt+C</kbd>
          </button>
        </div>
      </aside>
    </section>
  `;
}
