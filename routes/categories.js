const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// List all categories
router.get('/', requireAuth, (req, res) => {
  const db = getDB();
  const categories = db.prepare(`
    SELECT c.*, (SELECT COUNT(1) FROM products WHERE category_id = c.id) as product_count
    FROM categories c
    ORDER BY c.name
  `).all();
  res.render('categories/index', { title: '分類管理', categories });
});

// New category form
router.get('/new', requireAuth, (req, res) => {
  res.render('categories/new', { title: '新增分類' });
});

// Create category
router.post('/new', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', '請輸入分類名稱');
    return res.redirect('/categories/new');
  }

  const db = getDB();
  try {
    db.raw.exec('INSERT INTO categories (name) VALUES (?)', [name.trim()]);
    req.flash('success', '分類「' + name.trim() + '」已建立');
    res.redirect('/categories');
  } catch (e) {
    req.flash('error', '分類名稱已存在');
    res.redirect('/categories/new');
  }
});

// Edit category form
router.get('/:id/edit', requireAuth, (req, res) => {
  const db = getDB();
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!category) {
    req.flash('error', '找不到該分類');
    return res.redirect('/categories');
  }
  res.render('categories/edit', { title: '編輯分類', category });
});

// Update category
router.post('/:id/edit', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', '請輸入分類名稱');
    return res.redirect('/categories/' + req.params.id + '/edit');
  }

  const db = getDB();
  try {
    db.raw.exec('UPDATE categories SET name = ? WHERE id = ?', [name.trim(), req.params.id]);
    req.flash('success', '分類已更新');
    res.redirect('/categories');
  } catch (e) {
    req.flash('error', '分類名稱已存在');
    res.redirect('/categories/' + req.params.id + '/edit');
  }
});

// Delete category
router.post('/:id/delete', requireAuth, (req, res) => {
  const db = getDB();
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) {
    req.flash('error', '找不到該分類');
    return res.redirect('/categories');
  }

  // Check if category has products
  const count = db.prepare('SELECT COUNT(1) as cnt FROM products WHERE category_id = ?').get(req.params.id);
  if (count.cnt > 0) {
    req.flash('error', '該分類下還有 ' + count.cnt + ' 個商品，無法刪除');
    return res.redirect('/categories');
  }

  db.raw.exec('DELETE FROM categories WHERE id = ?', [req.params.id]);
  req.flash('success', '分類「' + cat.name + '」已刪除');
  res.redirect('/categories');
});

module.exports = router;
