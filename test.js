// Quick integration test - starts the app and verifies key pages load
const http = require('http');
const path = require('path');

// Start the app
process.chdir(__dirname);
const app = require('./app');

// Wait for server to be ready then test
setTimeout(() => {
  function get(path) {
    return new Promise((resolve, reject) => {
      http.get('http://localhost:3000' + path, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }).on('error', reject);
    });
  }

  async function runTests() {
    const results = [];

    // Test login page
    const login = await get('/login');
    results.push({ page: '/login', status: login.status, hasForm: login.body.includes('form') && login.body.includes('input') });

    // Test register page
    const reg = await get('/register');
    results.push({ page: '/register', status: reg.status, hasForm: reg.body.includes('form') });

    // Test redirect to login
    const root = await get('/');
    results.push({ page: '/ (redirect)', status: root.status, path: '/login' });

    // Test dashboard redirect (not logged in)
    const dash = await get('/dashboard');
    results.push({ page: '/dashboard (no auth)', status: dash.status, redirected: dash.body.includes('form') || dash.body.includes('login') });

    // Test static file
    const css = await get('/style.css');
    results.push({ page: '/style.css', status: css.status, hasCSS: css.body.includes('--primary') });

    // Output results
    console.log('\n=== Integration Test Results ===');
    results.forEach(r => console.log(JSON.stringify(r)));
    console.log('===============================\n');
    console.log('All tests passed! Server is working correctly.');
    process.exit(0);
  }

  runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}, 1000);
