import { state, t } from "./state.js";
import { esc, formatMoney, round, activeTax, taxPercent, isAdmin, showToast } from "./utils.js";
import { api } from "./api.js";

let globalRenderFn = null;

export function setModalRenderFn(fn) {
  globalRenderFn = fn;
}

export function openModal(modal) {
  return new Promise((resolve) => {
    state.modal = { ...modal, resolve };
    if (globalRenderFn) globalRenderFn();
  });
}

export function closeModal(value) {
  const resolve = state.modal?.resolve;
  state.modal = null;
  if (globalRenderFn) globalRenderFn();
  if (resolve) resolve(value);
}

export function showInfo({ title = "Information", message = "", okText = "OK" }) {
  return openModal({
    title,
    message,
    okText,
    cancelText: ""
  });
}

export function showConfirm({ title = "Confirm Action", message = "", okText = "Confirm", cancelText = "Cancel", danger = false }) {
  return openModal({
    title,
    message,
    okText,
    cancelText,
    danger
  });
}

export function showPrompt({ title = "Enter Details", message = "", placeholder = "", value = "", okText = "Save", cancelText = "Cancel" }) {
  return openModal({
    type: "prompt",
    title,
    message,
    placeholder,
    value,
    okText,
    cancelText
  });
}

export function showQuantityPrompt({ title = "Add Item Quantity", message = "Enter quantity to add:", placeholder = "1", value = "1", okText = "Add to Cart", cancelText = "Cancel" }) {
  return openModal({
    type: "quantity_prompt",
    title,
    message,
    placeholder,
    value,
    okText,
    cancelText
  });
}

export function renderCustomerDropdown(type, query = "") {
  if (!query || query.trim().length < 2) return "";
  const q = query.trim().toLowerCase();
  
  const matches = (state.customers || []).filter(c => {
    const matchPhone = (c.phone || "").toLowerCase().includes(q);
    const matchName = (c.name || "").toLowerCase().includes(q);
    return matchPhone || matchName;
  }).slice(0, 5);

  if (matches.length === 0) return "";

  return `
    <div class="customer-dropdown-results" style="position: absolute; top: 100%; left: 0; right: 0; z-index: 9999999; background: #fff; border: 1px solid var(--brand); border-radius: 6px; box-shadow: 0 8px 16px rgba(0,0,0,0.15); max-height: 180px; overflow-y: auto; margin-top: 2px;">
      ${matches.map(c => `
        <div class="customer-dropdown-item" data-type="${type}" data-phone="${esc(c.phone)}" data-name="${esc(c.name)}" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f3f4f6; transition: background 0.15s ease; text-align: left;" onmouseover="this.style.background='var(--brand-soft)'" onmouseout="this.style.background='transparent'">
          <div style="font-weight: 700; color: var(--ink); font-size: 13px;">${esc(c.name)} <span style="font-weight: normal; font-size: 11px; color: var(--brand); font-weight: 600;">[${esc(c.tier)}]</span></div>
          <div style="font-size: 11px; color: #4a4a4a; display: flex; justify-content: space-between;">
            <span>📱 ${esc(c.phone)}</span>
            <span>⭐ ${c.points || 0} pts</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

export function renderModal() {
  if (!state.modal) return "";
  const modal = state.modal;
  if (modal.type === "quantity_prompt") {
    return `
      <div class="modal-backdrop" style="z-index: 999999 !important;">
        <section class="modal-card" style="max-width: 360px; width: 100%;">
          <div class="section-title"><h2>${esc(modal.title || "Input")}</h2></div>
          <form id="modalQuantityPromptForm">
            <div class="field" style="margin-top: 14px; text-align: center;">
              <label style="font-weight: 700; margin-bottom: 12px; display: block; color: var(--ink); font-size: 15px;">${esc(modal.message || "Enter quantity:")}</label>
              <input id="modalQuantityInput" type="number" min="1" class="search-input" value="${esc(modal.value || "1")}" placeholder="${esc(modal.placeholder || "1")}" autocomplete="off" style="width: 140px; font-size: 26px; font-weight: 800; text-align: center; padding: 12px; border-radius: 8px; background: var(--panel); border: 2px solid var(--brand); color: var(--ink); margin: 0 auto; display: block;" required />
            </div>
            <div class="modal-actions" style="margin-top: 24px; display: flex; gap: 8px; justify-content: center;">
              <button class="btn secondary" type="button" data-modal-cancel>${esc(modal.cancelText || "Cancel")}</button>
              <button class="btn" type="submit" style="background: var(--brand); color: #111; font-weight: 800;">${esc(modal.okText || "Add")}</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }
  if (modal.type === "prompt") {
    return `
      <div class="modal-backdrop" style="z-index: 999999 !important;">
        <section class="modal-card" style="max-width: 420px; width: 100%;">
          <div class="section-title"><h2>${esc(modal.title || "Input")}</h2></div>
          <form id="modalPromptForm">
            <div class="field" style="margin-top: 14px;">
              <label style="font-weight: 700; margin-bottom: 8px; display: block; color: var(--ink);">${esc(modal.message || "Enter value:")}</label>
              <input id="modalPromptInput" type="text" class="search-input" value="${esc(modal.value || "")}" placeholder="${esc(modal.placeholder || "")}" autocomplete="off" style="width: 100%; padding: 10px; border-radius: 6px; background: var(--panel); border: 1px solid var(--line); color: var(--ink);" required />
            </div>
            <div class="modal-actions" style="margin-top: 24px; display: flex; gap: 8px; justify-content: flex-end;">
              <button class="btn secondary" type="button" data-modal-cancel>${esc(modal.cancelText || "Cancel")}</button>
              <button class="btn" type="submit">${esc(modal.okText || "Save")}</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }
  if (modal.type === "settle") {
    const order = modal.order;
    const discountPercent = Number(modal.values?.discountPercent ?? order.discountPercent ?? 0);
    const subtotal = Number(order.subtotal || 0);
    const discount = round(subtotal * (discountPercent / 100));
    const taxableAmount = round(subtotal - discount);
    const tax = round(taxableAmount * Number(activeTax().rate || 0));

    const pointsRedeemed = Number(modal.values?.pointsRedeemed || 0);
    const loyaltySettings = state.loyaltySettings || { rupeesPerPoint: 100, rupeeValuePerPoint: 1 };
    const pointsDiscount = round(pointsRedeemed * Number(loyaltySettings.rupeeValuePerPoint || 1));
    const total = round(Math.max(0, taxableAmount + tax - pointsDiscount));

    return `
      <div class="modal-backdrop" style="z-index: 999999 !important;">
        <section class="modal-card">
          <div class="section-title"><h2>Settle Table ${esc(order.tableNo)}</h2><strong>${formatMoney(total)}</strong></div>
          <form id="modalSettleForm">
            <div class="grid cols-2">
              <div class="field">
                <label>Discount %</label>
                <input name="discountPercent" type="number" min="0" max="100" step="0.01" value="${esc(discountPercent)}" />
              </div>
              <div class="field">
                <label style="font-weight: 800; color: var(--ink); margin-bottom: 6px; display: block;">Payment Type</label>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;">
                  ${[
                    { id: "upi", label: "📱 UPI", color: "#60a5fa", bgActive: "rgba(96, 165, 250, 0.25)", borderActive: "#60a5fa" },
                    { id: "cash", label: "💵 CASH", color: "#34d399", bgActive: "rgba(52, 211, 153, 0.25)", borderActive: "#34d399" },
                    { id: "card", label: "💳 CARD", color: "#f59e0b", bgActive: "rgba(245, 158, 11, 0.25)", borderActive: "#f59e0b" },
                    { id: "aggregator", label: "🤝 PARTNER", color: "#a78bfa", bgActive: "rgba(167, 139, 250, 0.25)", borderActive: "#a78bfa" }
                  ].map((p) => {
                    const currentMode = modal.values?.paymentMode || state.paymentMode;
                    const isActive = currentMode === p.id;
                    return `
                      <button type="button" class="btn-modal-payment-shortcut" data-payment-mode="${p.id}" style="
                        background: ${isActive ? p.bgActive : "rgba(255,255,255,0.02)"};
                        color: ${isActive ? p.color : "var(--muted)"};
                        border: 1px solid ${isActive ? p.borderActive : "rgba(255,255,255,0.08)"};
                        padding: 8px 4px; font-size: 11.5px; border-radius: 6px; font-weight: 800; cursor: pointer; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; transition: all 0.15s ease-in-out;
                      " title="Select ${p.id.toUpperCase()}">
                        ${p.label}
                      </button>
                    `;
                  }).join("")}
                </div>
                <input type="hidden" name="paymentMode" value="${esc(modal.values?.paymentMode || state.paymentMode)}" />
              </div>
            </div>
            
            <div class="grid cols-2" style="margin-top: 10px;">
              <div class="field">
                <label>Customer Phone (Loyalty)</label>
                <div style="position: relative; width: 100%;">
                  <input id="modalCustomerPhone" name="customerPhone" type="tel" value="${esc(modal.values?.customerPhone || "")}" placeholder="9876543210" autocomplete="off" />
                  ${renderCustomerDropdown("modalPhone", modal.values?.customerPhone)}
                </div>
              </div>
              <div class="field">
                <label>Customer Name</label>
                <div style="position: relative; width: 100%;">
                  <input id="modalCustomerName" name="customerName" type="text" value="${esc(modal.values?.customerName || "")}" placeholder="Anand" autocomplete="off" />
                  ${renderCustomerDropdown("modalName", modal.values?.customerName)}
                </div>
              </div>
            </div>

            ${(() => {
              const phone = modal.values?.customerPhone || "";
              const matched = phone ? state.customers.find(c => c.phone.trim() === phone.trim()) : null;
              if (!matched) return "";
              const currentRedeemed = Number(modal.values?.pointsRedeemed || 0);
              return `
                <div class="loyalty-profile-badge" style="background: var(--brand-soft); border: 1px solid rgba(212, 175, 55, 0.4); border-radius: 6px; padding: 10px 14px; margin-top: 10px; font-size: 13px; text-align: left; width: 100%; color: var(--ink);">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="color: var(--warn); font-weight: 700; display: flex; align-items: center; gap: 4px;">👑 ${matched.tier} Member</span>
                    ${matched.discountPercent ? `<span style="background: var(--brand); color: #111; padding: 1px 6px; border-radius: 4px; font-weight: bold; font-size: 11px;">${matched.discountPercent}% OFF Saved</span>` : ""}
                  </div>
                  <div style="color: #4a4a4a; font-size: 11px;">
                    Total Orders: <strong>${matched.orderCount || 0}</strong> · Total Spent: <strong>${formatMoney(matched.totalSales || 0)}</strong>
                  </div>
                  <div style="margin-top: 8px; border-top: 1px solid rgba(212,175,55,0.15); padding-top: 8px; display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                      <div>
                        <span style="color: #4a4a4a;">Loyalty Points:</span>
                        <strong style="color: var(--ink); font-size: 14px; margin-left: 4px;">${matched.points || 0} pts</strong>
                        <span class="muted" style="font-size: 10px; display: block;">1 pt = ${formatMoney(loyaltySettings.rupeeValuePerPoint || 1)} discount</span>
                      </div>
                      ${(matched.points > 0) ? `
                        <div style="display: flex; align-items: center; gap: 4px;">
                          <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; color: var(--ink); font-weight: bold; user-select: none;">
                            <input type="checkbox" id="modalChkRedeemPoints" ${currentRedeemed > 0 ? "checked" : ""} style="width: 15px; height: 15px; cursor: pointer; margin: 0;" />
                            Redeem
                          </label>
                        </div>
                      ` : ""}
                    </div>
                    ${(matched.points > 0) ? `
                      <div id="modalPointsInputGroup" style="display: ${currentRedeemed > 0 ? 'flex' : 'none'}; align-items: center; justify-content: flex-end; gap: 6px; border-top: 1px dashed rgba(212,175,55,0.15); padding-top: 6px;">
                        <span class="muted" style="font-size: 11px;">Amount:</span>
                        <input type="number" id="modalPointsRedeemed" name="pointsRedeemed" min="1" max="${matched.points}" value="${currentRedeemed}" class="text-field compact" style="width: 70px; text-align: center; border: 1px solid var(--line); background: var(--panel); font-weight: bold; color: var(--ink);" />
                        <span class="muted" style="font-size: 11px;">pts</span>
                        <button type="button" class="btn warning compact" id="modalBtnRemovePoints" style="background: #fecaca; color: #b91c1c; border: 1px solid #fee2e2; font-size: 10px; padding: 1px 6px; min-height: 20px; box-shadow: none; margin-left: 4px; border-radius: 4px;">Remove</button>
                      </div>
                      <div id="modalPointsApplyGroup" style="display: ${currentRedeemed > 0 ? 'none' : 'flex'}; justify-content: flex-end; border-top: 1px dashed rgba(212,175,55,0.15); padding-top: 6px;">
                        <button type="button" class="btn primary compact" id="modalBtnApplyAllPoints" style="font-size: 10px; padding: 1px 6px; min-height: 20px; box-shadow: none; border-radius: 4px;">Apply Max (${matched.points} pts)</button>
                      </div>
                    ` : ""}
                  </div>
                </div>
              `;
            })()}

            <div class="totals" style="margin-top: 15px;">
              <div class="total-row"><span>Subtotal</span><strong>${formatMoney(subtotal)}</strong></div>
              <div class="total-row"><span>Discount</span><strong>${formatMoney(discount)}</strong></div>
              <div class="total-row"><span>${esc(activeTax().name)} ${taxPercent()}%</span><strong>${formatMoney(tax)}</strong></div>
              ${pointsDiscount > 0 ? `
                <div class="total-row" style="color: #34d399;">
                  <span>Points Redeemed Discount</span>
                  <strong>-${formatMoney(pointsDiscount)}</strong>
                </div>
              ` : ""}
              <div class="total-row grand"><span>Payable</span><strong>${formatMoney(total)}</strong></div>
            </div>
            ${isAdmin() ? `
              <div class="field" style="margin-top:10px; border: 1.5px dashed rgba(239, 68, 68, 0.4); padding: 10px; border-radius: 6px; background: rgba(239, 68, 68, 0.02); text-align: left;">
                <label style="color: #f87171; font-weight: 800; display: flex; align-items: center; gap: 4px; font-size: 12px; margin-bottom: 4px;">
                  🚨 Emergency Settle Date & Time <span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #fecaca; margin-left: auto; font-size: 9px; padding: 2px 5px;">ADMIN ONLY</span>
                </label>
                <input name="customCreatedAt" type="datetime-local" value="${esc(modal.values?.customCreatedAt || "")}" style="background: #222; border: 1px solid #555; color: #fff; padding: 6px; border-radius: 4px; width: 100%; font-size: 13px;" />
                <span class="muted" style="font-size: 9.5px; display: block; margin-top: 4px; color: #fca5a5; line-height: 1.3;">Leave blank to use current real-time date & time.</span>
              </div>
            ` : ""}
            <div class="modal-actions" style="display: flex; gap: 8px; justify-content: flex-end; align-items: center; width: 100%;">
              <button class="btn secondary" type="button" data-modal-cancel>Cancel</button>
              <button class="btn secondary" type="submit" id="btnSettleBillOnly" style="font-weight: bold; background: rgba(212,175,55,0.08); color: var(--brand); border: 1px solid rgba(212,175,55,0.3);">Settle (Bill Only)</button>
              <button class="btn" type="submit" id="btnSettleBillKot">Settle (Bill + KOT)</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }
  return `
    <div class="modal-backdrop" style="z-index: 999999 !important;">
      <section class="modal-card">
        <div class="section-title"><h2>${esc(modal.title || "Confirm")}</h2></div>
        <div class="modal-body">${modal.html || `<p>${esc(modal.message || "")}</p>`}</div>
        <div class="modal-actions">
          ${modal.cancelText ? `<button class="btn secondary" type="button" data-modal-cancel>${esc(modal.cancelText)}</button>` : ""}
          <button class="btn ${modal.danger ? "danger" : ""}" type="button" data-modal-ok>${esc(modal.okText || "OK")}</button>
        </div>
      </section>
    </div>
  `;
}

export async function openDailySummaryModal() {
  try {
    const branchId = state.activeBranchId || "all";
    const date = state.dashboardDate;
    const summary = await api(`/api/reports/daily?branchId=${branchId}&date=${date}`);
    if (!summary) {
      showInfo({ title: "Daily Summary", message: "Failed to retrieve summary data." });
      return;
    }
    
    const formattedSales = formatMoney(summary.totalSales || 0);
    const averageBill = formatMoney(summary.averageBill || 0);
    const branchName = state.branches.find(b => b.id === branchId)?.name || "All Branches";
    
    const allItemsHtml = (summary.allItemsSold || []).length > 0
      ? summary.allItemsSold.map((item, index) => `
        <div class="items-sold-row" data-name="${esc(item.name.toLowerCase())}" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--line);">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 11px; font-weight: 800; background: rgba(24,21,18,0.06); color: var(--muted); width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
              ${index + 1}
            </span>
            <div>
              <strong style="font-size: 13.5px; color: var(--ink);">${esc(item.name)}</strong>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 800; font-size: 13.5px; color: var(--brand);">${item.quantity} portions</div>
            <div style="font-size: 11px;" class="muted">${formatMoney(item.sales)}</div>
          </div>
        </div>
      `).join("")
      : `<div style="text-align: center; padding: 20px 0; color: var(--muted); font-size: 13px;">No item sales recorded for today yet.</div>`;
      
    const paymentsHtml = (summary.payments || []).map(p => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(24,21,18,0.02); border: 1px solid var(--line); border-radius: 6px;">
        <span style="text-transform: uppercase; font-weight: 700; font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px;">
          ${p.mode === 'cash' ? '💵' : p.mode === 'upi' ? '📱' : p.mode === 'card' ? '💳' : '🛒'} ${p.mode}
        </span>
        <strong style="color: var(--ink); font-size: 13px;">${formatMoney(p.amount || 0)}</strong>
      </div>
    `).join("");

    const modalHtml = `
      <div style="display: flex; flex-direction: column; gap: 20px; text-align: left;">
        <div style="background: rgba(243,165,31,0.05); border: 1px solid rgba(243,165,31,0.15); border-radius: 8px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <span class="muted" style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">Selected Date</span>
            <strong style="display: block; font-size: 15px; color: var(--ink);">📅 ${date}</strong>
          </div>
          <div style="text-align: right;">
            <span class="muted" style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">Filter Scope</span>
            <strong style="display: block; font-size: 15px; color: var(--brand);">📍 ${esc(branchName)}</strong>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
          <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.15); padding: 14px; border-radius: 8px; text-align: center;">
            <span style="font-size: 11px; color: var(--good); font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">💰 Total Revenue</span>
            <strong style="font-size: 18px; color: var(--ink); font-weight: 800;">${formattedSales}</strong>
          </div>
          <div style="background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.15); padding: 14px; border-radius: 8px; text-align: center;">
            <span style="font-size: 11px; color: var(--brand); font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">📦 Total Orders</span>
            <strong style="font-size: 18px; color: var(--ink); font-weight: 800;">${summary.totalBills || 0}</strong>
          </div>
          <div style="background: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.15); padding: 14px; border-radius: 8px; text-align: center;">
            <span style="font-size: 11px; color: var(--warn); font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">🍛 Items Sold</span>
            <strong style="font-size: 18px; color: var(--ink); font-weight: 800;">${summary.totalItemsSold || 0}</strong>
          </div>
          <div style="background: rgba(168, 85, 247, 0.05); border: 1px solid rgba(168, 85, 247, 0.15); padding: 14px; border-radius: 8px; text-align: center;">
            <span style="font-size: 11px; color: var(--brand-2); font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">🎫 Avg Order Value</span>
            <strong style="font-size: 18px; color: var(--ink); font-weight: 800;">${averageBill}</strong>
          </div>
        </div>

        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
            <h3 style="margin: 0; font-size: 13.5px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--brand); display: flex; align-items: center; gap: 6px;">
              🍛 Items Sold Today
            </h3>
            <span style="font-size: 11px; font-weight: bold; background: rgba(245, 158, 11, 0.15); color: var(--warn); padding: 2px 8px; border-radius: 20px;">
              ${(summary.allItemsSold || []).length} unique items
            </span>
          </div>
          
          ${(summary.allItemsSold || []).length > 0 ? `
            <input type="text" id="itemsSoldSearchInput" placeholder="🔍 Search sold items..." style="width: 100%; margin-bottom: 10px; padding: 8px 12px; background: #fff; border: 1px solid var(--line); border-radius: 6px; color: var(--ink); font-size: 13px; outline: none;" />
          ` : ""}
          
          <div style="background: rgba(24,21,18,0.01); border: 1px solid var(--line); border-radius: 8px; padding: 4px 14px; max-height: 250px; overflow-y: auto;">
            <div id="itemsSoldNoResults" style="display: none; text-align: center; padding: 20px 0; color: var(--muted); font-size: 13px;">No items match your search.</div>
            ${allItemsHtml}
          </div>
        </div>

        <div>
          <h3 style="margin: 0 0 10px; font-size: 13.5px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--ink); display: flex; align-items: center; gap: 6px;">
            💳 Payment Mode Breakdown
          </h3>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
            ${paymentsHtml}
          </div>
        </div>
      </div>
    `;

    if (!window.hasItemsSoldSearchDelegation) {
      window.hasItemsSoldSearchDelegation = true;
      document.addEventListener("input", (e) => {
        const searchInput = e.target.closest("#itemsSoldSearchInput");
        if (searchInput) {
          const query = searchInput.value.toLowerCase().trim();
          const rows = document.querySelectorAll(".items-sold-row");
          let visibleCount = 0;
          rows.forEach(row => {
            const name = row.dataset.name || "";
            if (name.includes(query)) {
              row.style.setProperty("display", "flex", "important");
              visibleCount++;
            } else {
              row.style.setProperty("display", "none", "important");
            }
          });
          
          const noResults = document.querySelector("#itemsSoldNoResults");
          if (noResults) {
            noResults.style.setProperty("display", (visibleCount === 0 && rows.length > 0) ? "block" : "none", "important");
          }
        }
      });
    }

    await openModal({
      title: "📊 Daily Summary Dashboard",
      html: modalHtml,
      okText: "Close Summary",
      cancelText: ""
    });
  } catch (error) {
    console.error("Error opening daily summary modal:", error);
    showInfo({ title: "Error", message: "Failed to open Daily Summary." });
  }
}

export async function openDailyPortionsModal() {
  try {
    const data = await api("/api/menu-items/portions");
    state.menuItems = data.menuItems || state.menuItems;
    state.categories = data.categories || state.categories;

    const itemsHtml = state.menuItems.map(item => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--line);">
        <div>
          <strong style="color: var(--ink); font-size: 14px;">${esc(item.name)}</strong>
          <span class="muted" style="font-size: 11px; display: block;">Base Price: ${formatMoney(item.price)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <input type="number" class="portion-input" data-id="${item.id}" value="${item.dailyPortions !== null && item.dailyPortions !== undefined ? item.dailyPortions : ''}" placeholder="Unlimited" min="0" style="width: 90px; text-align: center; padding: 6px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel); font-weight: bold; color: var(--ink);" />
        </div>
      </div>
    `).join("");

    const modalHtml = `
      <div style="text-align: left;">
        <p class="muted" style="font-size: 12px; margin-bottom: 15px;">
          Set available daily portion quantities for each dish. Leave empty or blank for <strong>unlimited portion availability</strong>.
        </p>
        <div style="max-height: 350px; overflow-y: auto; padding-right: 5px;">
          ${itemsHtml}
        </div>
      </div>
    `;

    const confirmed = await openModal({
      title: "🍲 Set Today's Available Portions",
      html: modalHtml,
      okText: "Save & Lock Portions",
      cancelText: "Remind Me Later"
    });

    if (confirmed) {
      const inputs = document.querySelectorAll(".portion-input");
      const updates = [];
      inputs.forEach(input => {
        const id = input.dataset.id;
        const val = input.value.trim();
        updates.push({
          id,
          dailyPortions: val === "" ? null : Math.max(0, parseInt(val, 10) || 0)
        });
      });

      await api("/api/menu-items/portions", {
        method: "PUT",
        body: JSON.stringify({ items: updates })
      });

      state.portionsInitializedToday = true;
      showToast("Portion limits set successfully for today!", "success");
      const updated = await api("/api/menu-items/portions");
      state.menuItems = updated.menuItems || state.menuItems;
      if (globalRenderFn) globalRenderFn();
    }
  } catch (err) {
    console.error("Failed to load daily portions modal:", err);
  }
}
