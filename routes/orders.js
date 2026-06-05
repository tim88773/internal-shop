const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

function reqAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// Status labels
const STATUS_LABELS = {
  'pending': '待处理',
  'accepted': '已接受',
  'shipped': '已出货',
  'delivered': '已送达',
  'cancelled': '已取消'
};

// Valid status transitions
const NEXT_STATUS = {
  'pending': 'accepted',
  'accepted': 'shipped',
  'shipped': 'delivered'
};

function statusLabel(s) { return STATUS_LABELS[s] || s; }

router.get('/cart', reqAuth, (req, res) => {
  if (!req.session._cart) req.session._cart = [];
  const db = getDB();
  const items = req.session._cart.map(item => {
    const p = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(item.productId);
    return p ? { id: p.id, name: p.name, price: p.price, quantity: p.quantity, defect_reason: p.defect_reason, cartQty: item.qty } : null;
  }).filter(Boolean);
  const total = items.reduce((s, i) => s + i.price * i.cartQty, 0);
  res.render('orders/cart', { title: 'Cart', items, total });
});

router.post('/cart/add', reqAuth, (req, res) => {
  const pid = parseInt(req.body.product_id);
  const qty = parseInt(req.body.quantity) || 1;
  if (qty < 1) { req.flash('error', 'Qty > 0'); return res.redirect('/products'); }
  const db = getDB();
  const p = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(pid);
  if (!p) { req.flash('error', 'Not found'); return res.redirect('/products'); }
  if (!req.session._cart) req.session._cart = [];
  const ex = req.session._cart.find(c => c.productId === pid);
  const need = (ex ? ex.qty : 0) + qty;
  if (p.quantity < need) { req.flash('error', 'Stock'); return res.redirect('/products'); }
  if (ex) { ex.qty += qty; } else { req.session._cart.push({ productId: pid, qty }); }
  req.flash('success', 'Added!');
  res.redirect('/products');
});

router.post('/cart/update', reqAuth, (req, res) => {
  const pid = parseInt(req.body.product_id);
  const qty = parseInt(req.body.quantity) || 0;
  if (!req.session._cart) req.session._cart = [];
  if (qty <= 0) { req.session._cart = req.session._cart.filter(c => c.productId !== pid); }
  else { const item = req.session._cart.find(c => c.productId === pid); if (item) item.qty = qty; }
  res.redirect('/orders/cart');
});

router.post('/cart/remove', reqAuth, (req, res) => {
  const pid = parseInt(req.body.product_id);
  if (req.session._cart) req.session._cart = req.session._cart.filter(c => c.productId !== pid);
  res.redirect('/orders/cart');
});

router.post('/checkout', reqAuth, (req, res) => {
  const cart = req.session._cart || [];
  if (cart.length === 0) { req.flash('error', 'Empty'); return res.redirect('/orders/cart'); }
  const db = getDB();
  const placeOrder = db.transaction(() => {
    for (const item of cart) {
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(item.productId);
      if (!p) throw new Error('Not found');
      if (p.quantity < item.qty) throw new Error('Stock');
    }
    db.raw.exec('INSERT INTO orders (employee_id, notes) VALUES (?, ?)', [req.session.user.id, req.body.notes || '']);
    const oid = db.raw.exec('SELECT MAX(id) as id FROM orders')[0].id;
    for (const item of cart) {
      const p = db.prepare('SELECT price FROM products WHERE id = ?').get(item.productId);
      db.raw.exec('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)', [oid, item.productId, item.qty, p.price]);
      db.raw.exec('UPDATE products SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [item.qty, item.productId]);
    }
    return oid;
  });
  try {
    const oid = placeOrder();
    req.session._cart = [];
    req.flash('success', 'Order #' + oid + ' placed!');
    res.redirect('/orders/' + oid);
  } catch (e) {
    req.flash('error', e.message);
    console.error('[CHECKOUT ERROR]', e.message);
    res.redirect('/orders/cart');
  }
});

router.get('/', reqAuth, (req, res) => {
  const db = getDB();
  const orders = db.prepare("SELECT o.*, e.display_name, (SELECT COUNT(1) FROM order_items WHERE order_id = o.id) as items_count, (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM order_items WHERE order_id = o.id) as total_amount FROM orders o JOIN employees e ON e.id = o.employee_id ORDER BY o.created_at DESC").all();
  res.render('orders/index', { title: 'All Orders', orders, myOrders: false, statusLabel });
});

router.get('/my', reqAuth, (req, res) => {
  const db = getDB();
  const orders = db.prepare("SELECT o.*, e.display_name, (SELECT COUNT(1) FROM order_items WHERE order_id = o.id) as items_count, (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM order_items WHERE order_id = o.id) as total_amount FROM orders o JOIN employees e ON e.id = o.employee_id WHERE o.employee_id = ? ORDER BY o.created_at DESC").all(req.session.user.id);
  res.render('orders/index', { title: 'My Orders', orders, myOrders: true, statusLabel });
});

router.get('/:id', reqAuth, (req, res) => {
  const db = getDB();
  const o = db.prepare("SELECT o.*, e.display_name, e.email FROM orders o JOIN employees e ON e.id = o.employee_id WHERE o.id = ?").get(req.params.id);
  if (!o) { req.flash('error', 'Not found'); return res.redirect('/orders'); }
  const items = db.prepare("SELECT oi.*, p.name, p.defect_reason, p.image_url FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?").all(req.params.id);
  res.render('orders/detail', { title: 'Order #' + o.id, order: o, items, statusLabel, nextStatus: NEXT_STATUS[o.status] || null });
});

// Cancel order (only pending)
router.post('/:id/cancel', reqAuth, (req, res) => {
  const db = getDB();
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) { req.flash('error', 'Not found'); return res.redirect('/orders'); }
  if (o.status !== 'pending') { req.flash('error', 'Only pending'); return res.redirect('/orders/' + o.id); }
  const cancel = db.transaction(() => {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
    for (const item of items) { db.raw.exec('UPDATE products SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [item.quantity, item.product_id]); }
    db.raw.exec("UPDATE orders SET status = 'cancelled' WHERE id = ?", [o.id]);
  });
  cancel();
  req.flash('success', 'Order #' + o.id + ' cancelled');
  res.redirect('/orders/' + o.id);
});

// Advance order to next status
router.post('/:id/advance', reqAuth, (req, res) => {
  const db = getDB();
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) { req.flash('error', 'Not found'); return res.redirect('/orders'); }
  const next = NEXT_STATUS[o.status];
  if (!next) { req.flash('error', 'Cannot advance'); return res.redirect('/orders/' + o.id); }
  db.raw.exec('UPDATE orders SET status = ? WHERE id = ?', [next, o.id]);
  req.flash('success', 'Order #' + o.id + ' ' + statusLabel(next));
  res.redirect('/orders/' + o.id);
});

module.exports = router;
