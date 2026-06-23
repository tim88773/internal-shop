const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDB } = require('../db');

function reqAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    req.flash('error', '\u6b0a\u9650\u4e0d\u8db3');
    return res.redirect('/dashboard');
  }
  next();
}

// List all members
router.get('/', reqAdmin, (req, res) => {
  const db = getDB();
  const members = db.prepare("SELECT id, username, display_name, email, store, role, points, points_total_earned, points_total_spent, created_at FROM employees ORDER BY created_at DESC").all();
  res.render('members/index', { title: '\u4f1a\u54e1\u7ba1\u7406', members });
});

// Edit member form
router.get('/:id/edit', reqAdmin, (req, res) => {
  const db = getDB();
  const member = db.prepare("SELECT id, username, display_name, email, store, role, points, points_total_earned, points_total_spent, created_at FROM employees WHERE id = ?").get(Number(req.params.id));
  if (!member) { req.flash('error', '\u672a\u627e\u5230\u8be5\u4f1a\u5458'); return res.redirect('/members'); }
  res.render('members/edit', { title: '\u7f16\u8f91\u4f1a\u5458', member });
});

// Update member
router.post('/:id/edit', reqAdmin, (req, res) => {
  const db = getDB();
  const member = db.prepare("SELECT * FROM employees WHERE id = ?").get(Number(req.params.id));
  if (!member) { req.flash('error', '\u672a\u627e\u5230\u8be5\u4f1a\u5458'); return res.redirect('/members'); }

  const { display_name, email, store, password, confirm_password } = req.body;
  var updates = [];
  var params = [];

  if (display_name) { updates.push('display_name = ?'); params.push(display_name); }
  updates.push('email = ?'); params.push(email || null);
  updates.push('store = ?'); params.push(store || '');

  if (password) {
    if (password.length < 4) { req.flash('error', '\u5bc6\u7801\u81f3\u5c11 4 \u7801'); return res.redirect('/members/' + member.id + '/edit'); }
    if (password !== confirm_password) { req.flash('error', '\u4e24\u6b21\u5bc6\u7801\u8f93\u5165\u4e0d\u4e00\u81f4'); return res.redirect('/members/' + member.id + '/edit'); }
    updates.push('password = ?'); params.push(bcrypt.hashSync(password, 10));
  }

  params.push(member.id);
  db.raw.exec('UPDATE employees SET ' + updates.join(', ') + ' WHERE id = ?', params);

  req.flash('success', '\u4f1a\u5458 ' + (display_name || member.display_name) + ' \u5df2\u66f4\u65b0');
  res.redirect('/members');
});

// Point adjustment form
router.get('/:id/points', reqAdmin, (req, res) => {
  const db = getDB();
  const member = db.prepare("SELECT id, username, display_name, email, store, points, points_total_earned, points_total_spent FROM employees WHERE id = ?").get(Number(req.params.id));
  if (!member) { req.flash('error', '\u672a\u627e\u5230\u8be5\u4f1a\u5458'); return res.redirect('/members'); }
  res.render('members/points', { title: '\u79ef\u70b9\u5f02\u52a8', member });
});

// Process point adjustment
router.post('/:id/points', reqAdmin, (req, res) => {
  const db = getDB();
  const member = db.prepare("SELECT * FROM employees WHERE id = ?").get(Number(req.params.id));
  if (!member) { req.flash('error', '\u672a\u627e\u5230\u8be5\u4f1a\u5458'); return res.redirect('/members'); }

  var action = req.body.action;
  var points = parseInt(req.body.points) || 0;
  var note = (req.body.note || '').trim();

  if (points <= 0) {
    req.flash('error', '\u8bf7\u8f93\u5165\u6709\u6548\u7684\u70b9\u6570');
    return res.redirect('/members/' + member.id + '/points');
  }

  if (action === 'deduct') {
    if (points > member.points) {
      req.flash('error', '\u6263\u70b9\u6570\u4e0d\u80fd\u8d85\u8fc7\u5f53\u524d\u4f59\u989d\uff08' + member.points + ' \u70b9\uff09');
      return res.redirect('/members/' + member.id + '/points');
    }
    var newBalance = member.points - points;
    db.raw.exec('UPDATE employees SET points = points - ? WHERE id = ?', [points, member.id]);
    db.raw.exec('INSERT INTO point_transactions (employee_id, points, balance_after, type, reference_type, reference_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [member.id, -points, newBalance, 'admin_deduct', 'admin', 0, note || '\u7ba1\u7406\u5458\u6263\u70b9']);
    req.flash('success', '\u5df2\u6263\u9664 ' + member.display_name + ' ' + points + ' \u70b9\uff0c\u4f59\u989d\uff1a' + newBalance + ' \u70b9');
  } else {
    // Add points
    var newBalance = member.points + points;
    db.raw.exec('UPDATE employees SET points = points + ?, points_total_earned = points_total_earned + ? WHERE id = ?', [points, points, member.id]);
    db.raw.exec('INSERT INTO point_transactions (employee_id, points, balance_after, type, reference_type, reference_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [member.id, points, newBalance, 'admin_add', 'admin', 0, note || '\u7ba1\u7406\u5458\u7ed9\u70b9']);
    req.flash('success', '\u5df2\u7ed9\u4e88 ' + member.display_name + ' ' + points + ' \u70b9\uff0c\u4f59\u989d\uff1a' + newBalance + ' \u70b9');
  }

  res.redirect('/members');
});

// Point transaction history for a member
router.get('/:id/point-history', reqAdmin, (req, res) => {
  const db = getDB();
  const member = db.prepare("SELECT id, username, display_name, email, store, points, points_total_earned, points_total_spent FROM employees WHERE id = ?").get(Number(req.params.id));
  if (!member) { req.flash('error', '\u672a\u627e\u5230\u8be5\u4f1a\u5458'); return res.redirect('/members'); }

  const transactions = db.prepare("SELECT pt.*, o.id as ref_order_id FROM point_transactions pt LEFT JOIN orders o ON o.id = pt.reference_id AND pt.reference_type = 'order' WHERE pt.employee_id = ? ORDER BY pt.created_at DESC").all(member.id);

  res.render('members/point-history', { title: '\u79ef\u70b9\u5f02\u52a8\u5386\u7a0b', member, transactions });
});

module.exports = router;
