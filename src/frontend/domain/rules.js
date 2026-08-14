/**
 * Clean Architecture Frontend - Domain Rules
 * Pure business rules for UI operations & search filtering
 */

/**
 * Filter menu items strictly by item name and item code.
 * Category matching is explicitly excluded as per specification.
 */
export function filterMenuItemsBySearch(items = [], searchQuery = "") {
  const q = String(searchQuery || "").trim().toLowerCase();
  if (!q) return items;

  return items.filter((item) => {
    const nameMatch = String(item.name || "").toLowerCase().includes(q);
    const codeMatch = String(item.code || "").toLowerCase().includes(q);
    return nameMatch || codeMatch;
  });
}

/**
 * Calculate totals for cart items given tax rate and discount
 */
export function calculateCartTotals(cartItems = [], taxRate = 0, discountAmount = 0) {
  const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
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
