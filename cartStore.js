// Simple in-memory cart storage keyed by session ID
// This avoids express-session's MemoryStore serialization issues
const carts = new Map();

module.exports = {
  getCart(sessionId) {
    return carts.get(sessionId) || [];
  },

  setCart(sessionId, items) {
    carts.set(sessionId, items);
  },

  addItem(sessionId, productId, qty) {
    const cart = this.getCart(sessionId);
    const existing = cart.find(c => c.productId === productId);
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({ productId, qty });
    }
    carts.set(sessionId, cart);
    return cart;
  },

  removeItem(sessionId, productId) {
    const cart = this.getCart(sessionId).filter(c => c.productId !== productId);
    carts.set(sessionId, cart);
    return cart;
  },

  updateQty(sessionId, productId, qty) {
    const cart = this.getCart(sessionId);
    if (qty <= 0) {
      return this.removeItem(sessionId, productId);
    }
    const item = cart.find(c => c.productId === productId);
    if (item) item.qty = qty;
    carts.set(sessionId, cart);
    return cart;
  },

  clearCart(sessionId) {
    carts.set(sessionId, []);
  },

  getCartLength(sessionId) {
    return this.getCart(sessionId).length;
  }
};
