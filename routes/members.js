const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDB } = require('../db');

function reqAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    req.flash('error', '權限不足');
    return res.redirect('/dashboard');
  }
  next();
}

// 會員列表
router.get('/', reqAdmin, (req, res) => {
  const db = getDB();
  const members = db.prepare("SELECT id, username, display_name, email, store, role, points, points_total_earned, points_total_spent, created_at FROM employees ORDER BY created_at DESC").all();
  res.render('members/index', { title: '會員管理', members });
});

// 編輯會員表單
router.get('/:id/edit', reqAdmin, (req, res) => {
  const db = getDB();
  const member = db.prepare("SELECT id, username, display_name, email, store, role, points, points_total_earned, points_total_spent, created_at FROM employees WHERE id = ?").get(Number(req.params.id));
  if (!member) { req.flash('error', '找不到該會員'); return res.redirect('/members'); }
  res.render('members/edit', { title: '編輯會員', member });
});

// 更新會員
router.post('/:id/edit', reqAdmin, (req, res) => {
  const db = getDB();
  const member = db.prepare("SELECT * FROM employees WHERE id = ?").get(Number(req.params.id));
  if (!member) { req.flash('error', '找不到該會員'); return res.redirect('/members'); }

  const { display_name, email, store, password, confirm_password } = req.body;
  var updates = [];
  var params = [];

  if (display_name) { updates.push('display_name = ?'); params.push(display_name); }
  updates.push('email = ?'); params.push(email || null);
  updates.push('store = ?'); params.push(store || '');

  if (password) {
    if (password.length < 4) { req.flash('error', '密碼至少 4 碼'); return res.redirect('/members/' + member.id + '/edit'); }
    if (password !== confirm_password) { req.flash('error', '兩次密碼輸入不一致'); return res.redirect('/members/' + member.id + '/edit'); }
    updates.push('password = ?'); params.push(bcrypt.hashSync(password, 10));
  }

  params.push(member.id);
  db.raw.exec('UPDATE employees SET ' + updates.join(', ') + ' WHERE id = ?', params);

  req.flash('success', '會員 ' + (display_name || member.display_name) + ' 已更新');
  res.redirect('/members');
});

// 點數調整表單
router.get('/:id/points', reqAdmin, (req, res) => {
  const db = getDB();
  const member = db.prepare("SELECT id, username, display_name, email, store, points, points_total_earned, points_total_spent FROM employees WHERE id = ?").get(Number(req.params.id));
  if (!member) { req.flash('error', '找不到該會員'); return res.redirect('/members'); }
  res.render('members/points', { title: '點數異動', member });
});

// 處理點數調整
router.post('/:id/points', reqAdmin, (req, res) => {
  const db = getDB();
  const member = db.prepare("SELECT * FROM employees WHERE id = ?").get(Number(req.params.id));
  if (!member) { req.flash('error', '找不到該會員'); return res.redirect('/members'); }

  var action = req.body.action;
  var points = parseInt(req.body.points) || 0;
  var note = (req.body.note || '').trim();

  if (points <= 0) {
    req.flash('error', '請輸入有效的點數');
    return res.redirect('/members/' + member.id + '/points');
  }

  if (action === 'deduct') {
    if (points > member.points) {
      req.flash('error', '扣點數不能超過目前餘額（' + member.points + ' 點）');
      return res.redirect('/members/' + member.id + '/points');
    }
    var newBalance = member.points - points;
    db.raw.exec('UPDATE employees SET points = points - ? WHERE id = ?', [points, member.id]);
    db.raw.exec('INSERT INTO point_transactions (employee_id, points, balance_after, type, reference_type, reference_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [member.id, -points, newBalance, 'admin_deduct', 'admin', 0, note || '管理員扣點']);
    req.flash('success', '已扣除 ' + member.display_name + ' ' + points + ' 點，餘額：' + newBalance + ' 點');
  } else {
    // 給點
    var newBalance = member.points + points;
    db.raw.exec('UPDATE employees SET points = points + ?, points_total_earned = points_total_earned + ? WHERE id = ?', [points, points, member.id]);
    db.raw.exec('INSERT INTO point_transactions (employee_id, points, balance_after, type, reference_type, reference_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [member.id, points, newBalance, 'admin_add', 'admin', 0, note || '管理員給點']);
    req.flash('success', '已給予 ' + member.display_name + ' ' + points + ' 點，餘額：' + newBalance + ' 點');
  }

  res.redirect('/members');
});

// 會員點數異動歷程
router.get('/:id/point-history', reqAdmin, (req, res) => {
  const db = getDB();
  const member = db.prepare("SELECT id, username, display_name, email, store, points, points_total_earned, points_total_spent FROM employees WHERE id = ?").get(Number(req.params.id));
  if (!member) { req.flash('error', '找不到該會員'); return res.redirect('/members'); }

  const transactions = db.prepare("SELECT pt.*, o.id as ref_order_id FROM point_transactions pt LEFT JOIN orders o ON o.id = pt.reference_id AND pt.reference_type = 'order' WHERE pt.employee_id = ? ORDER BY pt.created_at DESC").all(member.id);

  res.render('members/point-history', { title: '點數異動歷程', member, transactions });
});

module.exports = router;