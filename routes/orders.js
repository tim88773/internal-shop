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
  res.render('orders/cart', { title: 'Cart', items, total });
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
  if (p.quantity < need) { req.flash('error', '庫存不足'); return redirectBack(); }
  // Validate size/color if product has them
  var pSizes = []; var pColors = [];
  try { pSizes = JSON.parse(p.sizes || '[]'); } catch(e){}
  try { pColors = JSON.parse(p.colors || '[]'); } catch(e){}
  if (pSizes.length > 0 && !req.body.size) { req.flash('error', '請選擇尺寸'); return redirectBack(); }
  if (pColors.length > 0 && !req.body.color) { req.flash('error', '請選擇顏色'); return redirectBack(); }
  var selSize = req.body.size || '';
  var selColor = req.body.color || '';
  if (ex) { ex.qty += qty; } else { req.session._cart.push({ productId: pid, qty: qty, selectedSize: selSize, selectedColor: selColor }); }
  req.flash('success', '已加入購物車！');
  redirectBack();
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
  if (!paymentMethod) { req.flash('error', '請選擇付款方式'); return res.redirect('/orders/cart'); }
  var paymentStatus = (paymentMethod === 'transfer') ? 'pending' : 'paid';
  const db = getDB();
  const placeOrder = db.transaction(() => {
    for (const item of cart) {
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(item.productId);
      if (!p) throw new Error('Not found');
      if (p.quantity < item.qty) throw new Error('Stock');
    }
    var insertResult = db.prepare('INSERT INTO orders (employee_id, notes, payment_method, payment_status) VALUES (?, ?, ?, ?)').run(req.session.user.id, req.body.notes || '', paymentMethod, paymentStatus);
    var oid = Number(insertResult.lastInsertRowid);
    for (const item of cart) {
      const p = db.prepare('SELECT price FROM products WHERE id = ?').get(item.productId);
      db.raw.exec('INSERT INTO order_items (order_id, product_id, quantity, unit_price, product_size, product_color) VALUES (?, ?, ?, ?, ?, ?)', [oid, item.productId, item.qty, p.price, item.selectedSize || '', item.selectedColor || '']);
      db.raw.exec('UPDATE products SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [item.qty, item.productId]);
    }
    return oid;
  });
  try {
    const oid = placeOrder();
    req.session._cart = [];
    req.flash('success', '訂單 #' + oid + ' 已建立！');
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
  var sheet = workbook.addWorksheet('訂單明細');

  // Style the header row
  sheet.columns = [
    { header: '訂單編號', key: 'orderId', width: 14 },
    { header: '下單員工', key: 'employee', width: 16 },
    { header: '所屬門市', key: 'store', width: 14 },
    { header: '下單商品', key: 'product', width: 30 },
    { header: '下單商品尺碼', key: 'size', width: 14 },
    { header: '下單商品顏色', key: 'color', width: 14 },
    { header: '下單商品數量', key: 'qty', width: 14 },
    { header: '下單商品單價', key: 'price', width: 16 },
    { header: '下單商品小計', key: 'subtotal', width: 16 }
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
    req.flash('error', '無權限操作'); return res.redirect('/orders');
  }
  if (o.payment_method !== 'transfer' || o.payment_status === 'paid') {
    req.flash('error', '此訂單無需匯款'); return res.redirect('/orders/' + o.id);
  }
  var last5 = (req.body.payment_last5 || '').trim();
  if (!last5 || last5.length !== 5 || !/^\\d{5}$/.test(last5)) {
    req.flash('error', '請輸入正確的匯款帳號後五碼（5 位數字）');
    return res.redirect('/orders/' + o.id);
  }
  db.raw.exec("UPDATE orders SET payment_status = 'paid', payment_last5 = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [last5, o.id]);
  req.flash('success', '匯款成功！訂單 #' + o.id + ' 已確認');
  res.redirect('/orders/' + o.id);
});

// Change payment method for unpaid transfer orders
router.post('/:id/change-payment', reqAuth, (req, res) => {
  const db = getDB();
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!o) { req.flash('error', 'Not found'); return res.redirect('/orders'); }
  if (o.employee_id !== req.session.user.id && req.session.user.role !== 'admin') {
    req.flash('error', '無權限操作'); return res.redirect('/orders');
  }
  if (o.payment_method !== 'transfer' || o.payment_status !== 'pending') {
    req.flash('error', '此訂單無法更改付款方式'); return res.redirect('/orders/' + o.id);
  }
  var newMethod = req.body.payment_method;
  if (newMethod !== 'salary' && newMethod !== 'hq_pickup') {
    req.flash('error', '請選擇有效的付款方式'); return res.redirect('/orders/' + o.id);
  }
  db.raw.exec("UPDATE orders SET payment_method = ?, payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [newMethod, o.id]);
  req.flash('success', '付款方式已更改為 ' + (newMethod === 'salary' ? '扣薪' : '總部取付'));
  res.redirect('/orders/' + o.id);
});

// Batch update orders status
router.post('/batch-status', reqAdmin, (req, res) => {
  var ids = req.body.ids;
  var action = req.body.action;
  if (!ids || ids.length === 0) {
    req.flash('error', '請選擇訂單');
    return res.redirect('/orders');
  }
  if (!Array.isArray(ids)) ids = [ids];
  var db = getDB();
  var nextMap = { 'accept': 'accepted', 'ship': 'shipped', 'complete': 'delivered' };
  var nextStatus = nextMap[action];
  if (!nextStatus) { req.flash('error', '無效的操作'); return res.redirect('/orders'); }
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
  req.flash('success', '已更新 ' + ids.length + ' 筆訂單');
  res.redirect('/orders');
});

module.exports = router;
