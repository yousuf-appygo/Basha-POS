/**
 * Clean Architecture Frontend - Print Use Cases
 * Manages thermal printing formatted outputs, Customer Bill, KOT, and combined continuous receipts.
 */

export function buildCustomerBillHtml(order, activeTax, branchName, formatMoney, esc, capitalize) {
  const tax = activeTax();
  const billNoDisplay = order.billNo ? esc(order.billNo) : `EST-${order.tableNo || order.id || ""}`;
  const paymentDisplay = order.payments ? esc(order.payments.map((p) => p.mode.toUpperCase()).join(", ")) : "PENDING";
  const dateDisplay = new Date(order.createdAt || Date.now()).toLocaleString();

  return `
    <div class="receipt-logo-container">
      <img src="${order.receiptLogo || '/assets/basha_bw.png'}" alt="Logo" class="receipt-logo" />
    </div>
    <h1>${esc(branchName(order.branchId))}</h1>
    <h3>${order.billNo ? "Customer Bill" : "Table Estimate (Bill)"}</h3>
    <div class="divider"></div>
    <div class="meta">
      <strong>Bill:</strong> ${billNoDisplay}<br>
      <strong>Type:</strong> ${esc(capitalize(order.orderType || "dine-in"))}${order.tableNo ? ` | Table: ${esc(order.tableNo)}` : ""}<br>
      ${order.serverName ? `<strong>Server:</strong> ${esc(order.serverName)}<br>` : ""}
      <strong>Date:</strong> ${dateDisplay}<br>
      <strong>Payment:</strong> ${paymentDisplay}
    </div>
    <div class="divider"></div>
    <table>
      <thead>
        <tr>
          <th style="width: 55%;">Item</th>
          <th class="right" style="width: 15%;">Qty</th>
          <th class="right" style="width: 30%;">Amt</th>
        </tr>
      </thead>
      <tbody>
        ${order.lines.map((line) => `
          <tr>
            <td>
              ${esc(line.name)}
              ${line.notes ? `<br><small style="font-size:10px;color:#333;">Note: ${esc(line.notes)}</small>` : ""}
            </td>
            <td class="right">${line.quantity}</td>
            <td class="right">${formatMoney(line.lineTotal)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    
    <table class="totals-table">
      <tr>
        <td>Subtotal</td>
        <td class="right">${formatMoney(order.subtotal)}</td>
      </tr>
      ${order.discount ? `
      <tr>
        <td>Discount</td>
        <td class="right">-${formatMoney(order.discount)}</td>
      </tr>
      ` : ""}
      ${tax ? `
      <tr>
        <td>${esc(tax.name)} (${tax.rate}%)</td>
        <td class="right">${formatMoney(order.tax)}</td>
      </tr>
      ` : ""}
      <tr class="total-row">
        <td>TOTAL</td>
        <td class="right">${formatMoney(order.total)}</td>
      </tr>
    </table>
    
    <div class="double-divider"></div>
    <p class="center" style="font-size: 11px; margin-top: 10px; font-weight: bold;">Thank you. Visit again!</p>
  `;
}

export function buildKotHtml(kot, branchName, esc, capitalize) {
  return `
    <div class="receipt-logo-container">
      <img src="${kot.receiptLogo || '/assets/basha_bw.png'}" alt="Logo" class="receipt-logo" style="max-height: 50px;" />
    </div>
    <h1>KOT (Kitchen Order)</h1>
    <h3>${esc(branchName(kot.branchId))}</h3>
    <div class="divider"></div>
    <div class="meta">
      <strong>KOT Ref:</strong> ${esc(kot.billNo)}<br>
      <strong>Type:</strong> ${esc(capitalize(kot.orderType))}${kot.tableNo ? ` | Table: ${esc(kot.tableNo)}` : ""}<br>
      ${kot.serverName ? `<strong>Server:</strong> ${esc(kot.serverName)}<br>` : ""}
      <strong>Time:</strong> ${new Date(kot.createdAt || Date.now()).toLocaleString()}
    </div>
    <div class="divider"></div>
    <table>
      <thead>
        <tr>
          <th style="width: 70%;">Item</th>
          <th class="right" style="width: 30%;">Qty</th>
        </tr>
      </thead>
      <tbody>
        ${kot.lines.map((line) => `
          <tr>
            <td>
              <strong>${esc(line.name)}</strong>
              ${line.notes ? `<br><small style="font-size:10px;color:#333;">Note: ${esc(line.notes)}</small>` : ""}
            </td>
            <td class="right" style="font-size:14px; font-weight:bold;">${line.quantity}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <div class="divider"></div>
  `;
}
