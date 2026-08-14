/**
 * Clean Architecture - Domain Rules
 * Pure business rule functions that operate independently of persistence or frameworks
 */

export function calculateLineTotal(price, quantity) {
  return Math.round(Number(price || 0) * Number(quantity || 0) * 100) / 100;
}

export function calculateOrderTotals(lines = [], taxRate = 0, discountAmount = 0) {
  const subtotal = lines.reduce((sum, line) => sum + (line.lineTotal || (line.price * line.quantity)), 0);
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const tax = Math.round(afterDiscount * (taxRate / 100) * 100) / 100;
  const total = Math.round((afterDiscount + tax) * 100) / 100;
  
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discount: Math.round(discountAmount * 100) / 100,
    tax,
    total
  };
}

/**
 * Domain rule for menu search:
 * Matches ONLY item name and item code (Category search excluded as per specification)
 */
export function matchesSearchQuery(item, query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  
  const nameMatch = String(item.name || "").toLowerCase().includes(q);
  const codeMatch = String(item.code || "").toLowerCase().includes(q);
  
  return nameMatch || codeMatch;
}
