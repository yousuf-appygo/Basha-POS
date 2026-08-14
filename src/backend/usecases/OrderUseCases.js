/**
 * Clean Architecture - Order Use Cases
 * Coordinates application business logic for POS orders, Table estimates, KOTs & Settlements
 */

import { calculateOrderTotals } from "../domain/rules.js";

export class OrderUseCases {
  constructor(repository) {
    this.repository = repository;
  }

  async getActiveMenuItems(query = "") {
    const items = await this.repository.getMenuItems();
    return items.filter(item => {
      if (!item.active) return false;
      if (!query) return true;
      const q = query.trim().toLowerCase();
      return (item.name || "").toLowerCase().includes(q) || (item.code || "").toLowerCase().includes(q);
    });
  }

  async placeOrder(orderData) {
    const taxRate = await this.repository.getActiveTaxRate();
    const totals = calculateOrderTotals(orderData.lines, taxRate, orderData.discount || 0);
    
    const finalOrder = {
      ...orderData,
      ...totals,
      createdAt: new Date().toISOString()
    };
    
    return await this.repository.saveOrder(finalOrder);
  }

  async settleOrder(orderId, paymentData) {
    const order = await this.repository.getOrderById(orderId);
    if (!order) throw new Error("Order not found");
    
    const settled = {
      ...order,
      status: "settled",
      payments: paymentData.payments,
      settledAt: new Date().toISOString()
    };
    
    return await this.repository.updateOrder(settled);
  }
}
