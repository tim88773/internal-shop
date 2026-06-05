const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { getDB } = require('../db');

// Multer config for image uploads
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'public', 'uploads'),
  filename: function(req, file, cb) {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, Date.now() + '-' + require('crypto').randomBytes(6).toString('hex') + ext);
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

router.get('/', requireAuth, (req, res) => {
  const db = getDB();
  const categoryId = req.query.category || null;
  const search = req.query.search || '';

  let sql = `
    SELECT p.*, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.is_active = 1
  `;
  const params = [];

  if (categoryId) {
    sql += ' AND p.category_id = ?';
    params.push(Number(categoryId));
  }
  if (search) {
    sql += ' AND (p.name LIKE ? OR p.description LIKE ?)';
    params.push('%' + search + '%', '%' + search + '%');
  }
  sql += ' ORDER BY p.created_at DESC';

  const products = params.length ? db.prepare(sql).all(...params) : db.prepare(sql).all();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();

  res.render('products/index', { title: '商品浏览', products, categories, search, categoryId: categoryId || '' });
});

router.get('/manage', requireAuth, (req, res) => {
  const db = getDB();
  const products = db.prepare(`
    SELECT p.*, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.created_at DESC
  `).all();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();

  res.render('products/manage', { title: '商品管理', products, categories });
});

router.get('/new', requireAuth, (req, res) => {
  const db = getDB();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('products/new', { title: '新增商品', categories, product: {} });
});

router.post('/new', requireAuth, upload.single('image'), (req, res) => {
  const { name, description, price, original_price, category_id, quantity, defect_reason } = req.body;

  if (!name || price === undefined || price === '') {
    req.flash('error', '商品名称与价格为必填');
    return res.redirect('/products/new');
  }

  // Handle uploaded image
  let image_url = '';
  if (req.file) {
    image_url = '/uploads/' + req.file.filename;
  }

  const db = getDB();
  db.raw.exec(
    'INSERT INTO products (name, description, price, original_price, category_id, quantity, defect_reason, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [name, description || '', parseFloat(price) || 0,
     original_price ? parseFloat(original_price) : null,
     category_id ? parseInt(category_id) : null,
     parseInt(quantity) || 0,
     defect_reason || '',
     image_url || null]
  );

  req.flash('success', '商品\u300c' + name + '\u300d已上架');
  res.redirect('/products/manage');
});

router.get('/:id/edit', requireAuth, (req, res) => {
  const db = getDB();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!product) {
    req.flash('error', '找不到该商品');
    return res.redirect('/products/manage');
  }
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('products/edit', { title: '编辑商品', product, categories });
});

router.post('/:id/edit', requireAuth, upload.single('image'), (req, res) => {
  const { name, description, price, original_price, category_id, quantity, defect_reason, is_active } = req.body;

  if (!name || price === undefined || price === '') {
    req.flash('error', '商品名称与价格为必填');
    return res.redirect('/products/' + req.params.id + '/edit');
  }

  const db = getDB();

  // Handle uploaded image
  let image_url_sql = '';
  const params = [name, description || '', parseFloat(price) || 0,
     original_price ? parseFloat(original_price) : null,
     category_id ? parseInt(category_id) : null,
     parseInt(quantity) || 0, defect_reason || '',
     is_active ? 1 : 0];

  if (req.file) {
    image_url_sql = ', image_url = ?';
    params.push('/uploads/' + req.file.filename);
  }

  params.push(parseInt(req.params.id));

  db.raw.exec(
    'UPDATE products SET name = ?, description = ?, price = ?, original_price = ?, category_id = ?, quantity = ?, defect_reason = ?, is_active = ?' + image_url_sql + ', updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    params
  );

  req.flash('success', '商品\u300c' + name + '\u300d已更新');
  res.redirect('/products/manage');
});

router.post('/:id/toggle', requireAuth, (req, res) => {
  const db = getDB();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!product) {
    req.flash('error', '找不到该商品');
    return res.redirect('/products/manage');
  }

  db.raw.exec('UPDATE products SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [product.is_active ? 0 : 1, Number(req.params.id)]);

  const action = product.is_active ? '下架' : '上架';
  req.flash('success', '商品\u300c' + product.name + '\u300d已' + action);
  res.redirect('/products/manage');
});

module.exports = router;
