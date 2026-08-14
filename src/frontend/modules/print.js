import { state, logoPath } from "./state.js";
import { esc, formatMoney, capitalize, taxPercent, activeTax, branchName, supplierNames, showToast } from "./utils.js";

export function getWebLogoSrc() {
  const settings = state.landingPageSettings || {};
  return settings.brandLogo || logoPath;
}

export function getWebHeroSrc() {
  const settings = state.landingPageSettings || {};
  return settings.heroImage || logoPath;
}

export function getReceiptLogoSrc() {
  return state.receiptLogo || `${window.location.origin}/assets/basha_bw.png`;
}

export function openStandardPrintWindow(title, body) {
  const win = window.open("", "_blank", "width=420,height=720");
  if (!win) return;
  win.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${esc(title)}</title>
        <style>
          * {
            box-sizing: border-box;
            font-weight: bold !important;
          }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 11px;
            font-weight: bold;
            line-height: 1.3;
            color: #000;
            background: #ffffff;
            margin: 0;
            padding: 10px;
          }
          .receipt {
            background: #fff;
            max-width: 280px;
            width: 100%;
            margin: 0 auto;
            padding: 8px;
            position: relative;
            border: 1px dashed #000;
          }
          .receipt-logo-container {
            text-align: center;
            margin-bottom: 8px;
            background: #ffffff !important;
            padding: 0px 5px 5px 5px;
            display: block;
          }
          .receipt-logo {
            max-width: 110px;
            max-height: 70px;
            height: auto;
            width: auto;
            display: inline-block;
            vertical-align: middle;
            background: #ffffff !important;
            filter: grayscale(1) contrast(1.2);
          }
          h1, h2, h3 {
            text-align: center;
            margin: 3px 0;
            font-weight: bold;
          }
          h1 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
          h2 { font-size: 12px; text-transform: uppercase; }
          h3 { font-size: 11px; text-transform: uppercase; font-weight: normal; margin-bottom: 6px; }
          .divider {
            border-top: 1px dashed #000;
            margin: 6px 0;
            height: 0;
          }
          .double-divider {
            border-top: 1px dashed #000;
            border-bottom: 1px dashed #000;
            height: 3px;
            margin: 6px 0;
          }
          .meta {
            font-size: 11px;
            margin: 6px 0;
            line-height: 1.3;
          }
          .meta strong {
            font-weight: bold;
          }
          table {
            width: 100%;
            table-layout: fixed;
            border-collapse: collapse;
            font-size: 11px;
            margin: 6px 0;
          }
          th {
            font-weight: bold;
            border-bottom: 1px dashed #000;
            padding: 3px 0;
            text-align: left;
            font-size: 11px;
          }
          td {
            padding: 3px 0;
            vertical-align: top;
            border-bottom: 1px dotted #000;
            font-size: 11px;
            overflow-wrap: break-word;
            word-wrap: break-word;
            word-break: break-word;
            white-space: normal;
          }
          tr {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          tr:last-child td {
            border-bottom: none;
          }
          .totals-table {
            margin-top: 6px;
          }
          .totals-table td {
            border-bottom: none;
            padding: 1.5px 0;
          }
          .totals-table tr.total-row td {
            border-top: 1px dashed #000;
            border-bottom: 1px dashed #000;
            font-weight: bold;
            font-size: 12px;
            padding: 5px 0;
          }
          .right { text-align: right; }
          .center { text-align: center; }
          .left { text-align: left; }
          .no-print {
            text-align: center;
            padding: 10px;
            background: #000;
            margin-bottom: 15px;
            border-radius: 6px;
            max-width: 320px;
            margin-left: auto;
            margin-right: auto;
          }
          .no-print button {
            padding: 6px 12px;
            font-weight: bold;
            font-family: inherit;
            font-size: 11px;
            cursor: pointer;
            border: 1px solid #000;
            border-radius: 4px;
            transition: opacity 0.2s;
          }
          .btn-print {
            background: #fff;
            color: #000;
          }
          .btn-close {
            background: #333;
            color: #fff;
            border: 1px solid #fff;
            margin-left: 8px;
          }
          @media print {
            @page {
              size: 80mm auto;
              margin: 0 !important;
            }
            body {
              width: 72mm;
              margin: 0;
              padding: 0mm 2mm 2mm 2mm;
              background: #fff;
              color: #000;
            }
            .receipt {
              width: 100% !important;
              max-width: 100% !important;
              padding: 0 !important;
              margin: 0 !important;
              border: none !important;
              box-shadow: none !important;
              border-radius: 0 !important;
            }
            .no-print {
              display: none !important;
            }
            button {
              display: none !important;
            }
            td {
              border-bottom: 1px dotted #000 !important;
            }
            tr:last-child td {
              border-bottom: none !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="no-print">
          <button class="btn-print" onclick="window.print()">🖨️ PRINT BILL</button>
          <button class="btn-close" onclick="window.close()">CLOSE</button>
        </div>
        <div class="receipt">
          ${body}
          <div style="height: 200px; background: transparent; border: none; outline: none; margin: 0; padding: 0;"></div>
        </div>
        <script>
          var printed = false;
          function doPrint() {
            if (printed) return;
            printed = true;
            window.print();
          }
          window.onload = function() {
            setTimeout(doPrint, 500);
          };
          setTimeout(doPrint, 2500);
        </script>
      </body>
    </html>
  `);
  win.document.close();
}

export function openMultipleStandardPrintWindow(jobs) {
  const win = window.open("", "_blank", "width=420,height=720");
  if (!win) return;
  
  const joinedTitle = jobs.map(j => j.title).join(" + ");
  
  const receiptsHtml = jobs.map((job, index) => `
    <div class="receipt ${index > 0 ? 'receipt-subsequent' : ''}">
      ${index > 0 ? `
        <div style="text-align: center; margin: 15px 0; font-weight: bold; font-family: monospace; font-size: 11px; border-top: 2px dashed #000; border-bottom: 2px dashed #000; padding: 6px 0;">
          ✂️ - - - - - TEAR OFF KOT HERE - - - - - ✂️
        </div>
      ` : ''}
      ${job.body}
      <!-- Feed spacer so paper rolls out past cutter blade before cutting -->
      <div style="height: 140px; background: transparent; border: none; outline: none; margin: 0; padding: 0;"></div>
    </div>
  `).join("");

  win.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${esc(joinedTitle)}</title>
        <style>
          * { box-sizing: border-box; font-weight: bold !important; }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 11px;
            font-weight: bold;
            line-height: 1.3;
            color: #000;
            background: #ffffff;
            margin: 0;
            padding: 10px;
          }
          .receipt {
            background: #fff;
            max-width: 280px;
            width: 100%;
            margin: 0 auto 20px auto;
            padding: 8px;
            position: relative;
            border: 1px dashed #000;
          }
          .receipt-subsequent {
            margin-top: 30px;
            padding-top: 20px;
          }
          .receipt-logo-container {
            text-align: center;
            margin-bottom: 8px;
            background: #ffffff !important;
            padding: 0px 5px 5px 5px;
            display: block;
          }
          .receipt-logo {
            max-width: 110px;
            max-height: 70px;
            height: auto;
            width: auto;
            display: inline-block;
            vertical-align: middle;
            background: #ffffff !important;
            filter: grayscale(1) contrast(1.2);
          }
          h1, h2, h3 { text-align: center; margin: 3px 0; font-weight: bold; }
          h1 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
          h2 { font-size: 12px; text-transform: uppercase; }
          h3 { font-size: 11px; text-transform: uppercase; font-weight: normal; margin-bottom: 6px; }
          .divider { border-top: 1px dashed #000; margin: 6px 0; height: 0; }
          .double-divider { border-top: 1px dashed #000; border-bottom: 1px dashed #000; height: 3px; margin: 6px 0; }
          .meta { font-size: 11px; margin: 6px 0; line-height: 1.3; }
          .meta strong { font-weight: bold; }
          table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 11px; margin: 6px 0; }
          th { font-weight: bold; border-bottom: 1px dashed #000; padding: 3px 0; text-align: left; font-size: 11px; }
          td { padding: 3px 0; vertical-align: top; border-bottom: 1px dotted #000; font-size: 11px; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; white-space: normal; }
          tr { page-break-inside: avoid; break-inside: avoid; }
          tr:last-child td { border-bottom: none; }
          .totals-table { margin-top: 6px; }
          .totals-table td { border-bottom: none; padding: 1.5px 0; }
          .totals-table tr.total-row td { border-top: 1px dashed #000; border-bottom: 1px dashed #000; font-weight: bold; font-size: 12px; padding: 5px 0; }
          .right { text-align: right; }
          .center { text-align: center; }
          .left { text-align: left; }
          .no-print { text-align: center; padding: 10px; background: #000; margin-bottom: 15px; border-radius: 6px; max-width: 320px; margin-left: auto; margin-right: auto; }
          .no-print button { padding: 6px 12px; font-weight: bold; font-family: inherit; font-size: 11px; cursor: pointer; border: 1px solid #000; border-radius: 4px; transition: opacity 0.2s; }
          .btn-print { background: #fff; color: #000; }
          .btn-close { background: #333; color: #fff; border: 1px solid #fff; margin-left: 8px; }
          @media print {
            @page { size: 80mm auto; margin: 0 !important; }
            body { width: 72mm; margin: 0; padding: 0mm 2mm 2mm 2mm; background: #fff; color: #000; }
            .receipt {
              width: 100% !important;
              max-width: 100% !important;
              padding: 0 !important;
              margin: 0 !important;
              border: none !important;
              box-shadow: none !important;
              border-radius: 0 !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            .receipt-subsequent {
              page-break-before: always !important;
              break-before: page !important;
              margin-top: 0 !important;
              padding-top: 15px !important;
              border-top: 2px dashed #000 !important;
            }
            .no-print { display: none !important; }
            button { display: none !important; }
            td { border-bottom: 1px dotted #000 !important; }
            tr:last-child td { border-bottom: none !important; }
          }
        </style>
      </head>
      <body>
        <div class="no-print">
          <button class="btn-print" onclick="window.print()">🖨️ PRINT ALL</button>
          <button class="btn-close" onclick="window.close()">CLOSE</button>
        </div>
        ${receiptsHtml}
        <script>
          var printed = false;
          function doPrint() {
            if (printed) return;
            printed = true;
            window.print();
          }
          window.onload = function() {
            setTimeout(doPrint, 500);
          };
          setTimeout(doPrint, 2500);
        </script>
      </body>
    </html>
  `);
  win.document.close();
}

export async function printHtml(title, body) {
  if (state.printerType === "desktop") {
    showToast("Routing print job via Cloud USB Print Queue...", "info");
    try {
      const response = await fetch("/api/print-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: state.activeBranchId, title: title, html: body })
      });
      if (response.ok) {
        showToast("Print job queued successfully on Desktop!", "success");
        return;
      }
    } catch (err) {
      console.error("Cloud print queue error:", err);
      showToast("Cloud print queue failed. Falling back to browser print...", "warning");
    }
  }

  if (state.printerType === "wifi") {
    let targetUrl = state.wifiPrinterIp || "";
    if (targetUrl) {
      if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
        targetUrl = "http://" + targetUrl;
      }
      try {
        const urlObj = new URL(targetUrl);
        if (!urlObj.port) urlObj.port = "9100";
        if (urlObj.pathname === "/") urlObj.pathname = "/print";
        targetUrl = urlObj.toString();
      } catch (e) {
        if (!targetUrl.includes(":", 6)) targetUrl = targetUrl + ":9100/print";
        else if (!targetUrl.endsWith("/print")) targetUrl = targetUrl + "/print";
      }

      showToast("Sending to local print server...", "info");
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const response = await fetch(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title, html: body, timestamp: Date.now() }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (response.ok) {
          showToast("Direct print successful!", "success");
          return;
        }
      } catch (err) {
        console.error("Local printer communication error:", err);
        showToast("Direct print failed. Falling back to browser print...", "warning");
      }
    }
  }
  
  openStandardPrintWindow(title, body);
}

export async function printMultipleHtml(jobs) {
  if (state.splitStandardPrints !== false) {
    for (let i = 0; i < jobs.length; i++) {
      await printHtml(jobs[i].title, jobs[i].body);
      if (i < jobs.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
    return;
  }

  if (state.printerType === "desktop" || state.printerType === "wifi") {
    const combinedBody = jobs.map((job, index) => `
      <div class="receipt ${index > 0 ? 'receipt-subsequent' : ''}">
        ${index > 0 ? `
          <div style="text-align: center; margin: 12px 0; font-weight: bold; font-family: monospace; font-size: 11px; border-top: 2px dashed #000; border-bottom: 2px dashed #000; padding: 6px 0;">
            ✂️ - - - - - TEAR OFF KOT HERE - - - - - ✂️
          </div>
        ` : ''}
        ${job.body}
        <div style="height: 140px; background: transparent;"></div>
      </div>
    `).join("");
    await printHtml(jobs.map(j => j.title).join(" + "), combinedBody);
    return;
  }
  
  openMultipleStandardPrintWindow(jobs);
}

export function getKotTimerHtml(createdAt, targetMins, isDefaultTarget, status) {
  const createdDate = new Date(createdAt);
  const elapsedMs = Date.now() - createdDate.getTime();
  const elapsedMins = Math.floor(elapsedMs / 60000);
  const targetMinsNum = Number(targetMins) || 15;
  const remainingMins = targetMinsNum - elapsedMins;
  const isDelayed = remainingMins < 0;

  let timerStr = "";
  if (status === "ready") {
    timerStr = "Ready";
  } else if (isDelayed) {
    timerStr = `Delayed by ${Math.abs(remainingMins)}m`;
  } else {
    timerStr = `${remainingMins}m remaining`;
  }

  let placedTime = "";
  try {
    placedTime = createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {}

  let progressPercent = 100;
  if (targetMinsNum > 0) {
    progressPercent = Math.max(0, Math.min(100, (remainingMins / targetMinsNum) * 100));
  }

  let timerColor = "#10b981";
  let progressColor = "#10b981";
  let statusText = "Preparing...";
  let statusBg = "rgba(16, 185, 129, 0.05)";

  if (status === "ready") {
    timerColor = "#3b82f6";
    progressColor = "#3b82f6";
    statusText = "Ready for Pickup";
    statusBg = "rgba(59, 130, 246, 0.05)";
    progressPercent = 100;
  } else if (isDelayed) {
    timerColor = "#ef4444";
    progressColor = "#ef4444";
    statusText = `DELAYED BY ${Math.abs(remainingMins)}m`;
    statusBg = "rgba(239, 68, 68, 0.05)";
  } else if (remainingMins <= 2) {
    timerColor = "#f59e0b";
    progressColor = "#f59e0b";
    statusText = "Overdue Soon!";
    statusBg = "rgba(245, 158, 11, 0.05)";
  }

  const targetTag = isDefaultTarget ? `Target: ${targetMinsNum}m (Default)` : `Target: ${targetMinsNum}m`;

  return `
    <div style="margin: 10px 0; padding: 10px; border-radius: 6px; background: ${statusBg}; border: 1px solid ${timerColor}33; transition: all 0.3s ease;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <span style="font-size: 11px; color: #a3a3a3; font-weight: 500;">⏱️ Placed: ${placedTime}</span>
        <span style="font-size: 11px; font-weight: 700; color: ${timerColor};">${targetTag}</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
        <span style="font-size: 11px; font-weight: 600; color: #a3a3a3;">${status === 'ready' ? 'Status' : 'Time Remaining'}</span>
        <span class="kds-timer-countdown" style="font-family: monospace; font-size: 16px; font-weight: 800; color: ${timerColor}; letter-spacing: 0.5px; text-shadow: 0 0 5px ${timerColor}33;">
          ${timerStr}
        </span>
      </div>
      <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; margin-bottom: 4px;">
        <div class="kds-timer-progress" style="width: ${progressPercent}%; height: 100%; background: ${progressColor}; transition: width 0.5s ease, background-color 0.5s ease; border-radius: 3px;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
        <span style="font-size: 11px; font-weight: bold; color: ${timerColor}; text-transform: uppercase; letter-spacing: 0.5px;">
          ${status === 'ready' ? 'Ready to Serve' : statusText}
        </span>
        ${isDelayed && status !== 'ready' ? `<span class="blink" style="font-size: 10px; padding: 1px 5px; border-radius: 3px; background: #ef4444; color: #ffffff; font-weight: 800;">RUSH</span>` : ''}
      </div>
    </div>
  `;
}

export function getCustomerBillHtml(order) {
  const tax = activeTax();
  const loyaltySettings = state.loyaltySettings || { rupeesPerPoint: 100, rupeeValuePerPoint: 1 };
  const pointsRedeemed = Number(order.pointsRedeemed || 0);
  const pointsDiscount = Math.round(pointsRedeemed * Number(loyaltySettings.rupeeValuePerPoint || 1) * 100) / 100;
  
  const billNoDisplay = order.billNo ? esc(order.billNo) : `EST-${order.tableNo || order.id || ""}`;
  const paymentDisplay = order.payments ? esc(order.payments.map((p) => p.mode.toUpperCase()).join(", ")) : "PENDING";
  const dateDisplay = new Date(order.createdAt || Date.now()).toLocaleString();

  return `
    <div class="receipt-logo-container">
      <img src="${getReceiptLogoSrc()}" alt="Logo" class="receipt-logo" style="${state.receiptLogoGrayscale ? 'filter: grayscale(1) contrast(1.2) !important;' : 'filter: none !important;'}" />
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
      ${order.transactionId ? `<br><strong>Txn ID:</strong> ${esc(order.transactionId)}` : ""}
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
          <td>Discount (${order.discountPercent}%)</td>
          <td class="right" style="color:#000;">-${formatMoney(order.discount)}</td>
        </tr>
      ` : ""}
      ${pointsRedeemed > 0 ? `
        <tr>
          <td>Points Redeemed (-${pointsRedeemed} pts)</td>
          <td class="right" style="color:#000;">-${formatMoney(pointsDiscount)}</td>
        </tr>
      ` : ""}
      ${!tax.inactive && tax.rate > 0 ? `
      <tr>
        <td>${esc(tax.name)} ${taxPercent(tax)}%</td>
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

export function getKotHtml(kot) {
  return `
    <div class="receipt-logo-container">
      <img src="${getReceiptLogoSrc()}" alt="Logo" class="receipt-logo" style="max-height: 50px; ${state.receiptLogoGrayscale ? 'filter: grayscale(1) contrast(1.2) !important;' : 'filter: none !important;'}" />
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
          <th style="width: 75%;">Item Name</th>
          <th class="right" style="width: 25%;">Qty</th>
        </tr>
      </thead>
      <tbody>
        ${kot.lines.map((line) => `
          <tr>
            <td>
              <strong>${esc(line.name)}</strong>
              ${line.kitchenStation ? `<br><span style="font-size:9px;text-transform:uppercase;">Station: ${esc(line.kitchenStation)}</span>` : ""}
              ${(line.notes || line.note) ? `<br><small style="font-size:11px;color:#000;">Note: ${esc(line.notes || line.note)}</small>` : ""}
            </td>
            <td class="right" style="font-size: 14px; font-weight: bold;">${line.quantity}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <div class="divider"></div>
    ${(kot.notes || kot.note) ? `
      <div style="margin-top: 10px; margin-bottom: 10px; font-size: 12px; border: 1px dashed #000; padding: 6px; border-radius: 4px; background: rgba(0,0,0,0.02); text-align: left;">
        <strong>📋 KOT Instructions:</strong><br>
        <span style="font-size: 11px; font-style: italic;">"${esc(kot.notes || kot.note)}"</span>
      </div>
      <div class="divider"></div>
    ` : ""}
    <div class="double-divider"></div>
  `;
}

export function printCustomerBill(order) {
  if (order) {
    state.lastPrintedOrder = order;
  }
  const billTitle = order.billNo ? `Bill ${order.billNo}` : `Estimate Table ${order.tableNo}`;
  printHtml(billTitle, getCustomerBillHtml(order));
}

export function printKot(kot) {
  printHtml(`KOT ${kot.billNo}`, getKotHtml(kot));
}

export async function printBillAndKot(order, kot) {
  if (order) {
    state.lastPrintedOrder = order;
  }
  const billTitle = order.billNo ? `Bill ${order.billNo}` : `Estimate Table ${order.tableNo}`;
  const kotTitle = `KOT ${kot.billNo}`;

  await printMultipleHtml([
    { title: billTitle, body: getCustomerBillHtml(order) },
    { title: kotTitle, body: getKotHtml(kot) }
  ]);
}

export function printPurchaseOrder(order) {
  printHtml(`Purchase Order ${order.orderNo}`, `
    <div class="receipt-logo-container">
      <img src="${getReceiptLogoSrc()}" alt="Logo" class="receipt-logo" style="${state.receiptLogoGrayscale ? 'filter: grayscale(1) contrast(1.2) !important;' : 'filter: none !important;'}" />
    </div>
    <h1>${esc(branchName(order.branchId))}</h1>
    <h3>Purchase Order</h3>
    <div class="divider"></div>
    <div class="meta">
      <strong>PO No:</strong> ${esc(order.orderNo)}<br>
      <strong>Supplier:</strong> ${esc(supplierNames([order.supplierId]))}<br>
      <strong>Order Date:</strong> ${esc(order.orderDate)}<br>
      <strong>Delivery Date:</strong> ${esc(order.deliveryDate)}<br>
      <strong>Status:</strong> ${esc(order.status)}
    </div>
    <div class="divider"></div>
    <table>
      <thead>
        <tr>
          <th style="width: 50%;">Item Description</th>
          <th class="right" style="width: 25%;">Qty</th>
          <th style="width: 25%; padding-left: 10px;">Unit</th>
        </tr>
      </thead>
      <tbody>
        ${order.lines.map((line) => `
          <tr>
            <td>${esc(line.name)}</td>
            <td class="right">${line.quantity}</td>
            <td style="padding-left: 10px;">${esc(line.unit)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <div class="divider"></div>
    ${order.notes ? `
      <div class="meta" style="margin-top: 8px;">
        <strong>Notes:</strong><br>
        ${esc(order.notes)}
      </div>
      <div class="divider"></div>
    ` : ""}
    <p class="meta" style="margin-top: 8px;"><strong>Prepared By:</strong> ${esc(state.user?.name || "")}</p>
  `);
}
