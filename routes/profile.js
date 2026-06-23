const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDB } = require('../db');

function reqAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

router.get('/', reqAuth, (req, res) => {
  const db = getDB();
  const user = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.session.user.id);
  if (!user) { req.flash('error', 'User not found'); return res.redirect('/dashboard'); }

  // Get order statistics
  var orderStats = db.prepare("SELECT COUNT(1) as order_count, COALESCE(SUM(oi.quantity * oi.unit_price), 0) as total_spent, COALESCE(SUM(o.points_used), 0) as total_points_used FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.employee_id = ? AND o.status != 'cancelled'").get(user.id);

  // Get recent orders
  var recentOrders = db.prepare("SELECT o.id, o.created_at, o.status, o.points_used, o.points_earned, (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM order_items WHERE order_id = o.id) as total_amount FROM orders o WHERE o.employee_id = ? ORDER BY o.created_at DESC LIMIT 5").all(user.id);

  res.render('profile', { title: '會員資料', user, orderStats, recentOrders });
});

router.post('/', reqAuth, (req, res) => {
  const db = getDB();
  const { display_name, email, store, password, confirm_password } = req.body;

  if (!display_name) { req.flash('error', '請輸入顯示名稱'); return res.redirect('/profile'); }

  var updates = [];
  var params = [];

  updates.push('display_name = ?'); params.push(display_name);
  updates.push('email = ?'); params.push(email || null);
  updates.push('store = ?'); params.push(store || '');

  if (password) {
    if (password.length < 4) { req.flash('error', '密碼至少 4 碼'); return res.redirect('/profile'); }
    if (password !== confirm_password) { req.flash('error', '兩次密碼輸入不一致'); return res.redirect('/profile'); }
    updates.push('password = ?'); params.push(bcrypt.hashSync(password, 10));
  }

  params.push(req.session.user.id);
  db.raw.exec('UPDATE employees SET ' + updates.join(', ') + ' WHERE id = ?', params);

  // Update session
  req.session.user.display_name = display_name;
  req.session.user.store = store || '';

  req.flash('success', '會員資料已更新');
  res.redirect('/profile');
});

// Point history page
router.get('/point-history', reqAuth, (req, res) => {
  const db = getDB();
  const user = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.session.user.id);
  if (!user) { req.flash('error', 'User not found'); return res.redirect('/dashboard'); }

  const transactions = db.prepare("SELECT pt.*, o.id as ref_order_id FROM point_transactions pt LEFT JOIN orders o ON o.id = pt.reference_id AND pt.reference_type = 'order' WHERE pt.employee_id = ? ORDER BY pt.created_at DESC").all(user.id);

  res.render('profile/point-history', { title: '積點異動歷程', user, transactions });
});

module.exports = router;
