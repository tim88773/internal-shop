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

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    req.flash('error', '????????????');
    return res.redirect('/products');
  }
  next();
}

// Image upload middleware: cover (single) + gallery (multiple)
const uploadFields = upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'gallery', maxCount: 10 }
]);

// Helper: save gallery images to DB
function saveGallery(db, productId, files) {
  if (!files || files.length === 0) return;
  for (var i = 0; i < files.length; i++) {
    var url = '/uploads/' + files[i].filename;
    db.raw.exec(
      'INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)',
      [productId, url, i]
    );
  }
}

// Helper: get all images for a product
function getProductImages(db, productId) {
  return db.prepare(
    'SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order'
  ).all(Number(productId));
}

// GET / — Browse active products (consumer view)
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

  res.render('products/index', { title: '商品瀏覽', products, categories, search, categoryId: categoryId || '' });
});

// GET /manage — Product management panel
router.get('/manage', requireAdmin, (req, res) => {
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

// GET /new — New product form
router.get('/new', requireAdmin, (req, res) => {
  const db = getDB();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('products/new', { title: '新增商品', categories, product: {} });
});

// POST /new — Create product
router.post('/new', requireAdmin, uploadFields, (req, res) => {
  const { name, description, price, original_price, category_id, quantity, defect_reason } = req.body;

  if (!name || price === undefined || price === '') {
    req.flash('error', '商品名稱与價格为必填');
    return res.redirect('/products/new');
  }

  const db = getDB();

  // Handle cover image
  var coverUrl = '';
  if (req.files && req.files.cover && req.files.cover.length > 0) {
    coverUrl = '/uploads/' + req.files.cover[0].filename;
  } else if (req.files && req.files.gallery && req.files.gallery.length > 0) {
    // Use first gallery image as cover if no explicit cover
    coverUrl = '/uploads/' + req.files.gallery[0].filename;
  }

  db.raw.exec(
    'INSERT INTO products (name, description, price, original_price, category_id, quantity, defect_reason, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [name, description || '', parseFloat(price) || 0,
     original_price ? parseFloat(original_price) : null,
     category_id ? Number(category_id) : null,
     parseInt(quantity) || 0,
     defect_reason || '',
     coverUrl || null]
  );

  var pid = db.raw.exec('SELECT MAX(id) as id FROM products')[0].id;

  // Save gallery images
  if (req.files && req.files.gallery) {
    var galleryFiles = req.files.gallery;
    // Skip first if it was used as cover
    var startIdx = (!req.files.cover || req.files.cover.length === 0) && galleryFiles.length > 0 ? 1 : 0;
    for (var i = startIdx; i < galleryFiles.length; i++) {
      var url = '/uploads/' + galleryFiles[i].filename;
      db.raw.exec(
        'INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)',
        [pid, url, i - startIdx]
      );
    }
  }

  req.flash('success', '商品\u300c' + name + '\u300d已上架');
  res.redirect('/products/manage');
});

// GET /:id — Product detail page
router.get('/:id', requireAuth, (req, res) => {
  const db = getDB();
  var pid = Number(req.params.id);
  const product = db.prepare(`
    SELECT p.*, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = ?
  `).get(pid);

  if (!product) {
    req.flash('error', '找不到該商品');
    return res.redirect('/products');
  }

  const images = getProductImages(db, pid);
  const related = db.prepare(
    'SELECT * FROM products WHERE is_active = 1 AND id != ? ORDER BY created_at DESC LIMIT 4'
  ).all(pid);

  // Check if in cart
  var inCart = 0;
  if (req.session._cart) {
    var found = req.session._cart.find(function(c) { return c.productId === pid; });
    if (found) inCart = found.qty;
  }

  res.render('products/detail', { title: product.name, product, images, related, inCart });
});

// GET /:id/edit — Edit product form
router.get('/:id/edit', requireAdmin, (req, res) => {
  const db = getDB();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!product) {
    req.flash('error', '找不到該商品');
    return res.redirect('/products/manage');
  }
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  const images = getProductImages(db, Number(req.params.id));
  res.render('products/edit', { title: '編輯商品', product, categories, images });
});

// POST /:id/edit — Update product
router.post('/:id/edit', requireAdmin, uploadFields, (req, res) => {
  const { name, description, price, original_price, category_id, quantity, defect_reason, is_active } = req.body;

  if (!name || price === undefined || price === '') {
    req.flash('error', '商品名稱与價格为必填');
    return res.redirect('/products/' + req.params.id + '/edit');
  }

  const db = getDB();
  var pid = Number(req.params.id);

  // Build dynamic UPDATE query
  var updates = [];
  var params = [];

  updates.push('name = ?'); params.push(name);
  updates.push('description = ?'); params.push(description || '');
  updates.push('price = ?'); params.push(parseFloat(price) || 0);
  updates.push('original_price = ?'); params.push(original_price ? parseFloat(original_price) : null);
  updates.push('category_id = ?'); params.push(category_id ? Number(category_id) : null);
  updates.push('quantity = ?'); params.push(parseInt(quantity) || 0);
  updates.push('defect_reason = ?'); params.push(defect_reason || '');
  updates.push('is_active = ?'); params.push(is_active ? 1 : 0);

  // Handle cover image
  if (req.files && req.files.cover && req.files.cover.length > 0) {
    updates.push('image_url = ?');
    params.push('/uploads/' + req.files.cover[0].filename);
  }
  // If new gallery uploaded, clear old and replace
  if (req.files && req.files.gallery && req.files.gallery.length > 0) {
    db.raw.exec('DELETE FROM product_images WHERE product_id = ?', [pid]);
    for (var i = 0; i < req.files.gallery.length; i++) {
      var url = '/uploads/' + req.files.gallery[i].filename;
      db.raw.exec(
        'INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)',
        [pid, url, i]
      );
    }
  }

  params.push(pid);
  db.raw.exec(
    'UPDATE products SET ' + updates.join(', ') + ', updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    params
  );

  req.flash('success', '商品\u300c' + name + '\u300d已更新');
  res.redirect('/products/manage');
});

// POST /:id/toggle — Toggle product active status
router.post('/:id/toggle', requireAdmin, (req, res) => {
  const db = getDB();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!product) {
    req.flash('error', '找不到該商品');
    return res.redirect('/products/manage');
  }

  db.raw.exec('UPDATE products SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [product.is_active ? 0 : 1, Number(req.params.id)]);

  const action = product.is_active ? '下架' : '上架';
  req.flash('success', '商品\u300c' + product.name + '\u300d已' + action);
  res.redirect('/products/manage');
});

module.exports = router;
