const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const ExcelJS = require('exceljs');

function reqAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function reqAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    req.flash('error', '\u6b0a\u9650\u4e0d\u8db3');
    return res.redirect('/orders/my');
  }
  next();
}

// Status labels
const STATUS_LABELS = {
  'pending': '\u5f85\u8655\u7406',
  'accepted': '\u5df2\u63a5\u53d7',
  'shipped': '\u5df2\u51fa\u8ca8',
  'delivered': '\u5df2\u9001\u9054',
  'cancelled': '\u5df2\u53d6\u6d88'
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
    return p ? { id: p.id, name: p.name, price: p.price, quantity: p.quantity, defect_reason: p.defect_reason, cartQty: item.qty, selectedSize: item.selectedSize || '', selectedColor: item.selectedColor || '' } : null;
  }).filter(Boolean);
  const total = items.reduce((s, i) => s + i.price * i.cartQty, 0);
  // Get user points balance
  const user = db.prepare('SELECT points FROM employees WHERE id = ?').get(req.session.user.id);
  const userPoints = user ? user.points : 0;
  res.render('orders/cart', { title: 'Cart', items, total, userPoints });
});

router.post('/cart/add', reqAuth, (req, res) => {
  function redirectBack() {
    var ref = req.headers.referer || '';
    if (ref.match(/\/products\/\d+($|\?)/)) { return res.redirect(ref); }
    res.redirect('/products');
  }
  const pid = parseInt(req.body.product_id);
  const qty = parseInt(req.body.quantity) || 1;
  if (qty < 1) { req.flash('error', 'Qty > 0'); return redirectBack(); }
  const db = getDB();
  const p = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(pid);
  if (!p) { req.flash('error', 'Not found'); return redirectBack(); }
  if (!req.session._cart) req.session._cart = [];
  const ex = req.session._cart.find(c => c.productId === pid);
  const need = (ex ? ex.qty : 0) + qty;
  if (p.quantity < need) { req.flash('error', '\u5eab\u5b58\u4e0d\u8db3'); return redirectBack(); }
  // Validate size/color if product has them
  var pSizes = []; var pColors = [];
  try { pSizes = JSON.parse(p.sizes || '[]'); } catch(e){}
  try { pColors = JSON.parse(p.colors || '[]'); } catch(e){}
  if (pSizes.length > 0 && !req.body.size) { req.flash('error', '\u8acb\u9078\u64c7\u5c3a\u5bf8'); return redirectBack(); }
  if (pColors.length > 0 && !req.body.color) { req.flash('error', '\u8acb\u9078\u64c7\u984f\u8272'); return redirectBack(); }
  var selSize = req.body.size || '';
  var selColor = req.body.color || '';
  if (ex) { ex.qty += qty; } else { req.session._cart.push({ productId: pid, qty: qty, selectedSize: selSize, selectedColor: selColor }); }
  req.flash('success', '\u5df2\u52a0\u5165\u8cfc\u7269\u8eca\uff01');
  res.redirect('/orders/cart');
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
  var paymentMethod = req.body.payment_method || '';
  if (!paymentMethod) { req.flash('error', '\u8acb\u9078\u64c7\u4ed8\u6b3e\u65b9\u5f0f'); return res.redirect('/orders/cart'); }
  var paymentStatus = (paymentMethod === 'transfer') ? 'pending' : 'paid';
  var usePoints = parseInt(req.body.use_points) || 0;
  const db = getDB();

  const placeOrder = db.transaction(() => {
    // Compute total
    var total = 0;
    for (const item of cart) {
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(item.productId);
      if (!p) throw new Error('Not found');
      if (p.quantity < item.qty) throw new Error('Stock');
      total += p.price * item.qty;
    }

    // Validate points usage
    var employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.session.user.id);
    if (usePoints < 0) usePoints = 0;
    if (usePoints > total) usePoints = total;
    if (usePoints > employee.points) usePoints = employee.points;

    // Calculate actual payment amount after points
    var actualAmount = total - usePoints;
    // Points earned: 1 point per whole dollar spent (after points discount)
    var pointsEarned = Math.floor(actualAmount);

    var insertResult = db.prepare('INSERT INTO orders (employee_id, notes, payment_method, payment_status, points_used, points_earned) VALUES (?, ?, ?, ?, ?, ?)').run(req.session.user.id, req.body.notes || '', paymentMethod, paymentStatus, usePoints, pointsEarned);
    var oid = Number(insertResult.lastInsertRowid);

    for (const item of cart) {
      const p = db.prepare('SELECT price FROM products WHERE id = ?').get(item.productId);
      db.raw.exec('INSERT INTO order_items (order_id, product_id, quantity, unit_price, product_size, product_color) VALUES (?, ?, ?, ?, ?, ?)', [oid, item.productId, item.qty, p.price, item.selectedSize || '', item.selectedColor || '']);
      db.raw.exec('UPDATE products SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [item.qty, item.productId]);
    }

    // Deduct used points from employee
    if (usePoints > 0) {
      var newBalance = employee.points - usePoints;
      db.raw.exec('UPDATE employees SET points = points - ?, points_total_spent = points_total_spent + ? WHERE id = ?', [usePoints, usePoints, req.session.user.id]);
      db.raw.exec('INSERT INTO point_transactions (employee_id, points, balance_after, type, reference_type, reference_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.session.user.id, -usePoints, newBalance, 'spend', 'order', oid, '\u8cfc\u7269\u6d88\u8cbb\u62b5\u6263']);
    }

    // Add earned points
    if (pointsEarned > 0) {
      var balanceAfterSpend = employee.points - usePoints;
      db.raw.exec('UPDATE employees SET points = points + ?, points_total_earned = points_total_earned + ? WHERE id = ?', [pointsEarned, pointsEarned, req.session.user.id]);
      db.raw.exec('INSERT INTO point_transactions (employee_id, points, balance_after, type, reference_type, reference_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.session.user.id, pointsEarned, balanceAfterSpend + pointsEarned, 'earn', 'order', oid, '\u8cfc\u7269\u7a4d\u9ede']);
    }

    return oid;
  });
  try {
    const oid = placeOrder();
    req.session._cart = [];
    req.flash('success', '\u8a02\u55ae #' + oid + ' \u5df2\u5efa\u7acb\uff01');
    res.redirect('/orders/' + oid);
  } catch (e) {
    req.flash('error', e.message);
    console.error('[CHECKOUT ERROR]', e.message);
    res.redirect('/orders/cart');
  }
});

router.get('/', reqAdmin, (req, res) => {
  const db = getDB();
  const orders = db.prepare("SELECT o.*, e.display_name, e.store, (SELECT COUNT(1) FROM order_items WHERE order_id = o.id) as items_count, (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM order_items WHERE order_id = o.id) as total_amount FROM orders o JOIN employees e ON e.id = o.employee_id WHERE o.payment_method != 'transfer' OR o.payment_status = 'paid' ORDER BY o.created_at DESC").all();
  res.render('orders/index', { title: 'All Orders', orders, myOrders: false, statusLabel });
});

router.get('/my', reqAuth, (req, res) => {
  const db = getDB();
  const orders = db.prepare("SELECT o.*, e.display_name, e.store, (SELECT COUNT(1) FROM order_items WHERE order_id = o.id) as items_count, (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM order_items WHERE order_id = o.id) as total_amount FROM orders o JOIN employees e ON e.id = o.employee_id WHERE o.employee_id = ? ORDER BY o.created_at DESC").all(req.session.user.id);
  res.render('orders/index', { title: 'My Orders', orders, myOrders: true, statusLabel });
});

// Export orders to Excel
router.get('/export', reqAdmin, (req, res) => {
  var db = getDB();
  var items = db.prepare("SELECT oi.*, o.employee_id, o.created_at as order_date, e.display_name as employee_name, e.store, p.name as product_name FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN employees e ON e.id = o.employee_id JOIN products p ON p.id = oi.product_id ORDER BY o.id").all();

  var workbook = new ExcelJS.Workbook();
  var sheet = workbook.addWorksheet('\u8a02\u55ae\u660e\u7d30');

  // Style the header row
  sheet.columns = [
    { header: '\u8a02\u55ae\u7de8\u865f', key: 'orderId', width: 14 },
    { header: '\u4e0b\u55ae\u54e1\u5de5', key: 'employee', width: 16 },
    { header: '\u6240\u5c6c\u9580\u5e02', key: 'store', width: 14 },
    { header: '\u4e0b\u55ae\u5546\u54c1', key: 'product', width: 30 },
    { header: '\u4e0b\u55ae\u5546\u54c1\u5c3a\u78bc', key: 'size', width: 14 },
    { header: '\u4e0b\u55ae\u5546\u54c1\u984f\u8272', key: 'color', width: 14 },
    { header: '\u4e0b\u55ae\u5546\u54c1\u6578\u91cf', key: 'qty', width: 14 },
    { header: '\u4e0b\u55ae\u5546\u54c1\u55ae\u50f9', key: 'price', width: 16 },
    { header: '\u4e0b\u55ae\u5546\u54c1\u5c0f\u8a08', key: 'subtotal', width: 16 }
  ];

  // Add header row styling
  var headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC98686' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  items.forEach(function(item) {
    var subtotal = Number(item.unit_price) * Number(item.quantity);
    var row = sheet.addRow({
      orderId: item.order_id,
      employee: item.employee_name,
      store: item.store || '',
      product: item.product_name,
      size: item.product_size || '',
      color: item.product_color || '',
      qty: item.quantity,
      price: Number(item.unit_price).toLocaleString(),
      subtotal: Number(subtotal).toLocaleString()
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=orders_export.xlsx');

  workbook.xlsx.write(res).then(function() {
    res.end();
  });
});


router.get('/:id', reqAuth, (req, res) => {
  const db = getDB();
  const o = db.prepare("SELECT o.*, e.display_name, e.email FROM orders o JOIN employees e ON e.id = o.employee_id WHERE o.id = ?").get(Number(req.params.id));
  if (!o) { req.flash('error', 'Not found'); return res.redirect('/orders'); }
  const items = db.prepare("SELECT oi.*, p.name, p.defect_reason, p.image_url FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?").all(Number(req.params.id));
  res.render('orders/detail', { title: 'Order #' + o.id, order: o, items, statusLabel, nextStatus: NEXT_STATUS[o.status] || null });
});

// Cancel order
router.post('/:id/cancel', reqAuth, (req, res) => {
  const db = getDB();
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!o) { req.flash('error', 'Not found'); return res.redirect('/orders'); }
  // Only admin or the order owner can cancel
  if (req.session.user.role !== 'admin' && o.employee_id !== req.session.user.id) {
    req.flash('error', '\u7121\u6b0a\u53d6\u6d88\u6b64\u8a02\u55ae');
    return res.redirect('/orders/' + o.id);
  }
  // Cannot cancel if already delivered or cancelled
  if (o.status === 'delivered' || o.status === 'cancelled') {
    req.flash('error', '\u8a72\u8a02\u55ae\u5df2\u7121\u6cd5\u53d6\u6d88');
    return res.redirect('/orders/' + o.id);
  }
  // Consumer can only cancel pending orders
  if (req.session.user.role !== 'admin' && o.status !== 'pending') {
    req.flash('error', '\u8a02\u55ae\u5df2\u63a5\u53d7\uff0c\u7121\u6cd5\u53d6\u6d88');
    return res.redirect('/orders/' + o.id);
  }
  const cancel = db.transaction(() => {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
    for (const item of items) { db.raw.exec('UPDATE products SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [item.quantity, item.product_id]); }
    // Refund points if points were used or earned
    if (o.points_used > 0 || o.points_earned > 0) {
      var employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(o.employee_id);
      // Refund used points
      if (o.points_used > 0) {
        db.raw.exec('UPDATE employees SET points = points + ?, points_total_spent = points_total_spent - ? WHERE id = ?', [o.points_used, o.points_used, o.employee_id]);
        db.raw.exec('INSERT INTO point_transactions (employee_id, points, balance_after, type, reference_type, reference_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [o.employee_id, o.points_used, employee.points + o.points_used, 'earn', 'order', o.id, '\u53d6\u6d88\u8a02\u55ae\u9000\u56de\u62b5\u6263\u9ede\u6578']);
      }
      // Revoke earned points
      if (o.points_earned > 0) {
        var balAfterRefund = employee.points + (o.points_used || 0);
        db.raw.exec('UPDATE employees SET points = points - ?, points_total_earned = points_total_earned - ? WHERE id = ?', [o.points_earned, o.points_earned, o.employee_id]);
        db.raw.exec('INSERT INTO point_transactions (employee_id, points, balance_after, type, reference_type, reference_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [o.employee_id, -o.points_earned, balAfterRefund - o.points_earned, 'spend', 'order', o.id, '\u53d6\u6d88\u8a02\u55ae\u6536\u56de\u7a4d\u9ede']);
      }
    }
    db.raw.exec("UPDATE orders SET status = 'cancelled' WHERE id = ?", [o.id]);
  });
  cancel();
  req.flash('success', 'Order #' + o.id + ' cancelled');
  res.redirect('/orders/' + o.id);
});

// Advance order to next status
router.post('/:id/advance', reqAdmin, (req, res) => {
  const db = getDB();
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!o) { req.flash('error', 'Not found'); return res.redirect('/orders'); }
  const next = NEXT_STATUS[o.status];
  if (!next) { req.flash('error', 'Cannot advance'); return res.redirect('/orders/' + o.id); }
  db.raw.exec('UPDATE orders SET status = ? WHERE id = ?', [next, o.id]);
  req.flash('success', 'Order #' + o.id + ' ' + statusLabel(next));
  res.redirect('/orders/' + o.id);
});


// Complete transfer payment
router.post('/:id/pay', reqAuth, (req, res) => {
  const db = getDB();
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!o) { req.flash('error', 'Not found'); return res.redirect('/orders'); }
  if (o.employee_id !== req.session.user.id && req.session.user.role !== 'admin') {
    req.flash('error', '\u7121\u6b0a\u9650\u64cd\u4f5c'); return res.redirect('/orders');
  }
  if (o.payment_method !== 'transfer' || o.payment_status === 'paid') {
    req.flash('error', '\u6b64\u8a02\u55ae\u7121\u9700\u5f59\u6b3e'); return res.redirect('/orders/' + o.id);
  }
  var last5 = (req.body.payment_last5 || '').trim();
  if (!last5 || last5.length !== 5 || !/^\d{5}$/.test(last5)) {
    req.flash('error', '\u8acb\u8f38\u5165\u6b63\u78ba\u7684\u5f59\u6b3e\u5e33\u865f\u5f8c\u4e94\u78bc\uff085 \u4f4d\u6578\u5b57\uff09');
    return res.redirect('/orders/' + o.id);
  }
  db.raw.exec("UPDATE orders SET payment_status = 'paid', payment_last5 = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [last5, o.id]);
  req.flash('success', '\u5f59\u6b3e\u6210\u529f\uff01\u8a02\u55ae #' + o.id + ' \u5df2\u78ba\u8a8d');
  res.redirect('/orders/' + o.id);
});

// Change payment method for unpaid transfer orders
router.post('/:id/change-payment', reqAuth, (req, res) => {
  try {
    const db = getDB();
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
    if (!o) { req.flash('error', 'Not found'); return res.redirect('/orders'); }
    if (o.employee_id !== req.session.user.id && req.session.user.role !== 'admin') {
      req.flash('error', '\u7121\u6b0a\u9650\u64cd\u4f5c'); return res.redirect('/orders');
    }
    if (o.payment_method !== 'transfer' || o.payment_status !== 'pending') {
      req.flash('error', '\u6b64\u8a02\u55ae\u7121\u6cd5\u66f4\u6539\u4ed8\u6b3e\u65b9\u5f0f'); return res.redirect('/orders/' + o.id);
    }
    var newMethod = req.body.payment_method;
    if (newMethod !== 'salary' && newMethod !== 'hq_pickup') {
      req.flash('error', '\u8acb\u9078\u64c7\u6709\u6548\u7684\u4ed8\u6b3e\u65b9\u5f0f'); return res.redirect('/orders/' + o.id);
    }
    db.raw.exec("UPDATE orders SET payment_method = ?, payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [newMethod, o.id]);
    req.flash('success', '\u4ed8\u6b3e\u65b9\u5f0f\u5df2\u66f4\u6539\u70ba ' + (newMethod === 'salary' ? '\u6263\u85aa' : '\u7e3d\u90e8\u53d6\u4ed8'));
    res.redirect('/orders/' + o.id);
  } catch (e) {
    req.flash('error', '\u8b8a\u66f4\u4ed8\u6b3e\u65b9\u5f0f\u5931\u6557\uff1a' + e.message);
    res.redirect('/orders/' + req.params.id);
  }
});

// Batch update orders status
router.post('/batch-status', reqAdmin, (req, res) => {
  var ids = req.body.ids;
  var action = req.body.action;
  if (!ids || ids.length === 0) {
    req.flash('error', '\u8acb\u9078\u64c7\u8a02\u55ae');
    return res.redirect('/orders');
  }
  if (!Array.isArray(ids)) ids = [ids];
  var db = getDB();
  var nextMap = { 'accept': 'accepted', 'ship': 'shipped', 'complete': 'delivered' };
  var nextStatus = nextMap[action];
  if (!nextStatus) { req.flash('error', '\u7121\u6548\u7684\u64cd\u4f5c'); return res.redirect('/orders'); }
  var update = db.transaction(function() {
    ids.forEach(function(id) {
      var o = db.prepare('SELECT status FROM orders WHERE id = ?').get(Number(id));
      if (o) {
        var validNext = { 'pending': 'accepted', 'accepted': 'shipped', 'shipped': 'delivered' };
        if (validNext[o.status] === nextStatus) {
          db.raw.exec('UPDATE orders SET status = ? WHERE id = ?', [nextStatus, Number(id)]);
        }
      }
    });
  });
  update();
  req.flash('success', '\u5df2\u66f4\u65b0 ' + ids.length + ' \u7b46\u8a02\u55ae');
  res.redirect('/orders');
});

module.exports = router;
