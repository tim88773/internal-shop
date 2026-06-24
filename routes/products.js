const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { getDB } = require('../db');

// Upload directory: use DATA_DIR volume on Railway, local public/uploads otherwise
var UPLOAD_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'uploads')
  : path.join(__dirname, '..', 'public', 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer config for image uploads
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
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
    req.flash('error', '\u6b0a\u9650\u4e0d\u8db3');
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

  res.render('products/index', { title: '\u5546\u54c1\u700f\u89bd', products, categories, search, categoryId: categoryId || '' });
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

  res.render('products/manage', { title: '\u5546\u54c1\u7ba1\u7406', products, categories });
});

// GET /new — New product form
router.get('/new', requireAdmin, (req, res) => {
  const db = getDB();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('products/new', { title: '\u65b0\u589e\u5546\u54c1', categories, product: {} });
});

// POST /new — Create product
router.post('/new', requireAdmin, uploadFields, (req, res) => {
  const { name, description, price, original_price, category_id, quantity, defect_reason } = req.body;

  if (!name || price === undefined || price === '') {
    req.flash('error', '\u5546\u54c1\u540d\u7a31\u8207\u50f9\u683c\u70ba\u5fc5\u586b');
    return res.redirect('/products/new');
  }

  const db = getDB();

  // Handle cover image
  var coverUrl = '';
  if (req.files && req.files.cover && req.files.cover.length > 0) {
    coverUrl = '/uploads/' + req.files.cover[0].filename;
  } else if (req.files && req.files.gallery && req.files.gallery.length > 0) {
    coverUrl = '/uploads/' + req.files.gallery[0].filename;
  }

  var storeVal = req.body.store || '';
  var sizesArr = (req.body.sizes || '').split(',').map(function(s){return s.trim();}).filter(function(s){return s;});
  var colorsArr = (req.body.colors || '').split(',').map(function(s){return s.trim();}).filter(function(s){return s;});
  var allowPts = req.body.allow_points_discount ? 1 : 0;
  var earnPts = req.body.earn_points ? 1 : 0;

  var insertResult = db.prepare('INSERT INTO products (name, description, price, original_price, category_id, quantity, defect_reason, store, image_url, sizes, colors, allow_points_discount, earn_points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    name, description || '', parseFloat(price) || 0,
    original_price ? parseFloat(original_price) : null,
    category_id ? Number(category_id) : null,
    parseInt(quantity) || 0,
    defect_reason || '',
    storeVal,
    coverUrl || null,
    JSON.stringify(sizesArr),
    JSON.stringify(colorsArr),
    allowPts,
    earnPts
  );

  var pid = Number(insertResult.lastInsertRowid);

  // Save gallery images
  if (req.files && req.files.gallery) {
    var galleryFiles = req.files.gallery;
    var startIdx = (!req.files.cover || req.files.cover.length === 0) && galleryFiles.length > 0 ? 1 : 0;
    for (var i = startIdx; i < galleryFiles.length; i++) {
      var url = '/uploads/' + galleryFiles[i].filename;
      db.raw.exec(
        'INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)',
        [pid, url, i - startIdx]
      );
    }
  }

  req.flash('success', '\u5546\u54c1\u300c' + name + '\u300d\u5df2\u4e0a\u67b6');
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
    req.flash('error', '\u627e\u4e0d\u5230\u8a72\u5546\u54c1');
    return res.redirect('/products');
  }

  const images = getProductImages(db, pid);
  const related = db.prepare(
    'SELECT * FROM products WHERE is_active = 1 AND id != ? ORDER BY created_at DESC LIMIT 4'
  ).all(pid);

  // Check if in cart (from DB cart)
  var inCart = 0;
  var cartItem = db.prepare('SELECT quantity FROM cart_items WHERE employee_id = ? AND product_id = ?').get(req.session.user.id, pid);
  if (cartItem) inCart = cartItem.quantity;

  // Parse sizes and colors
  var productSizes = []; var productColors = [];
  try { productSizes = JSON.parse(product.sizes || '[]'); } catch(e) {}
  try { productColors = JSON.parse(product.colors || '[]'); } catch(e) {}
  res.render('products/detail', { title: product.name, product, images, related, inCart, productSizes: productSizes, productColors: productColors });
});

// GET /:id/edit — Edit product form
router.get('/:id/edit', requireAdmin, (req, res) => {
  const db = getDB();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!product) {
    req.flash('error', '\u627e\u4e0d\u5230\u8a72\u5546\u54c1');
    return res.redirect('/products/manage');
  }
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  const images = getProductImages(db, Number(req.params.id));
  var pSizes = []; var pColors = [];
  try { pSizes = JSON.parse(product.sizes || '').join(', '); } catch(e) {}
  try { pColors = JSON.parse(product.colors || '').join(', '); } catch(e) {}
  res.render('products/edit', { title: '\u7de8\u8f2f\u5546\u54c1', product, categories, images, editSizes: pSizes, editColors: pColors });
});

// POST /:id/edit — Update product
router.post('/:id/edit', requireAdmin, uploadFields, (req, res) => {
  const { name, description, price, original_price, category_id, quantity, defect_reason, is_active } = req.body;

  if (!name || price === undefined || price === '') {
    req.flash('error', '\u5546\u54c1\u540d\u7a31\u8207\u50f9\u683c\u70ba\u5fc5\u586b');
    return res.redirect('/products/' + req.params.id + '/edit');
  }

  const db = getDB();
  var pid = Number(req.params.id);

  var updates = [];
  var params = [];

  updates.push('name = ?'); params.push(name);
  updates.push('description = ?'); params.push(description || '');
  updates.push('price = ?'); params.push(parseFloat(price) || 0);
  updates.push('original_price = ?'); params.push(original_price ? parseFloat(original_price) : null);
  updates.push('category_id = ?'); params.push(category_id ? Number(category_id) : null);
  updates.push('quantity = ?'); params.push(parseInt(quantity) || 0);
  updates.push('defect_reason = ?'); params.push(defect_reason || '');
  updates.push('store = ?'); params.push(req.body.store || '');
  updates.push('is_active = ?'); params.push(is_active ? 1 : 0);
  var sizesArr2 = (req.body.sizes || '').split(',').map(function(s){return s.trim();}).filter(function(s){return s;});
  var colorsArr2 = (req.body.colors || '').split(',').map(function(s){return s.trim();}).filter(function(s){return s;});
  updates.push('sizes = ?'); params.push(JSON.stringify(sizesArr2));
  updates.push('colors = ?'); params.push(JSON.stringify(colorsArr2));
  updates.push('allow_points_discount = ?'); params.push(req.body.allow_points_discount ? 1 : 0);
  updates.push('earn_points = ?'); params.push(req.body.earn_points ? 1 : 0);

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

  req.flash('success', '\u5546\u54c1\u300c' + name + '\u300d\u5df2\u66f4\u65b0');
  res.redirect('/products/manage');
});

// POST /:id/toggle — Toggle product active status
router.post('/:id/toggle', requireAdmin, (req, res) => {
  const db = getDB();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!product) {
    req.flash('error', '\u627e\u4e0d\u5230\u8a72\u5546\u54c1');
    return res.redirect('/products/manage');
  }

  db.raw.exec('UPDATE products SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [product.is_active ? 0 : 1, Number(req.params.id)]);

  const action = product.is_active ? '\u4e0b\u67b6' : '\u4e0a\u67b6';
  req.flash('success', '\u5546\u54c1\u300c' + product.name + '\u300d\u5df2' + action);
  res.redirect('/products/manage');
});

module.exports = router;
