/**
 * Clean Architecture Frontend - Domain Entities
 */

export class CartItem {
  constructor({ id, code, name, price, quantity = 1, notes = "" }) {
    this.id = id;
    this.code = code || "";
    this.name = name;
    this.price = Number(price || 0);
    this.quantity = Number(quantity || 1);
    this.notes = notes;
  }

  get lineTotal() {
    return Math.round(this.price * this.quantity * 100) / 100;
  }
}
