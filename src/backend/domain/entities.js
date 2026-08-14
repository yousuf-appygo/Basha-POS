/**
 * Clean Architecture - Domain Entities
 * Contains pure business objects and structural contracts
 */

export class MenuItem {
  constructor({ id, code, name, categoryId, price, active = true, image, station, portionsAvailable, portionsWarningLimit }) {
    this.id = id;
    this.code = code || "";
    this.name = name;
    this.categoryId = categoryId;
    this.price = Number(price || 0);
    this.active = active;
    this.image = image || null;
    this.station = station || "kitchen";
    this.portionsAvailable = portionsAvailable ?? null;
    this.portionsWarningLimit = portionsWarningLimit ?? 0;
  }
}

export class OrderLine {
  constructor({ id, code, name, price, quantity, lineTotal, notes }) {
    this.id = id;
    this.code = code || "";
    this.name = name;
    this.price = Number(price || 0);
    this.quantity = Number(quantity || 1);
    this.lineTotal = lineTotal !== undefined ? Number(lineTotal) : this.price * this.quantity;
    this.notes = notes || "";
  }
}

export class Order {
  constructor({ id, branchId, billNo, tableNo, orderType, lines = [], subtotal, tax, discount, total, status = "open", createdAt, serverName, payments = [] }) {
    this.id = id;
    this.branchId = branchId;
    this.billNo = billNo;
    this.tableNo = tableNo;
    this.orderType = orderType || "dine-in";
    this.lines = lines.map(l => new OrderLine(l));
    this.subtotal = subtotal;
    this.tax = tax;
    this.discount = discount;
    this.total = total;
    this.status = status;
    this.createdAt = createdAt || new Date().toISOString();
    this.serverName = serverName || "";
    this.payments = payments;
  }
}

export class Category {
  constructor({ id, name, active = true, portionsAvailable, portionsWarningLimit }) {
    this.id = id;
    this.name = name;
    this.active = active;
    this.portionsAvailable = portionsAvailable ?? null;
    this.portionsWarningLimit = portionsWarningLimit ?? 0;
  }
}
