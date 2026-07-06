
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000; // Bind dynamically for Render
const SECRET_KEY = process.env.JWT_SECRET || 'VEDA_INV_PRO_SECRET_KEY';

// Middleware to parse JSON bodies and enable CORS
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Connect to SQLite Database
const db = new sqlite3.Database('./inventory.db', (err) => {
  if (err) {
    console.error('Error connecting to database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
  }
});

// Initialize Database Tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, name TEXT, photo TEXT, barcode TEXT, ratePurchase REAL, rateWholesaler REAL, rateRetailer REAL, rateCustomer REAL, quantity INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS parties (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, name TEXT, mobile TEXT, address TEXT, type TEXT, category TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, type TEXT, party_id INTEGER, totalAmount REAL, date TEXT, invoiceNumber TEXT, paymentType TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS transaction_items (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id INTEGER, item_id INTEGER, quantity INTEGER, rate REAL)`);
  db.run(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, name TEXT, address TEXT, mobile TEXT, email TEXT, upiId TEXT, logo TEXT)`);
  db.run(`ALTER TABLE transactions ADD COLUMN customerName TEXT`, (err) => { /* Ignore if already exists */ });
  
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT, primary_user_id INTEGER, status TEXT, validity_date TEXT, max_sub_users INTEGER DEFAULT 3, business_name TEXT, email TEXT, mobile TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT, timestamp TEXT)`);

  // Fallbacks to add columns to existing tables without wiping data
  db.run(`ALTER TABLE items ADD COLUMN tenant_id INTEGER`, (err) => {});
  db.run(`ALTER TABLE parties ADD COLUMN tenant_id INTEGER`, (err) => {});
  db.run(`ALTER TABLE transactions ADD COLUMN tenant_id INTEGER`, (err) => {});
  db.run(`ALTER TABLE settings ADD COLUMN tenant_id INTEGER`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN max_sub_users INTEGER DEFAULT 3`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN business_name TEXT`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN email TEXT`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN mobile TEXT`, (err) => {});

  db.get('SELECT * FROM settings', (err, row) => {
    if (!row) {
      db.run('INSERT INTO settings (name) VALUES (?)', ['VEDAPRO']);
    }
  });
});

// ---------------------------
// AUTHENTICATION MIDDLEWARE
// ---------------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  jwt.verify(token, SECRET_KEY, (err, decodedUser) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token. Please log in again.' });
    
    // Check account validity status
    const userId = decodedUser.role === 'PRIMARY' ? decodedUser.id : decodedUser.primary_user_id;
    db.get('SELECT status, validity_date FROM users WHERE id = ?', [userId], (dbErr, dbUser) => {
      if (dbErr || !dbUser) {
        return res.status(401).json({ error: 'User account not found.' });
      }
      if (dbUser.status === 'PENDING') {
        return res.status(403).json({ error: 'Your account is blocked.' });
      }
      if (dbUser.validity_date && new Date(dbUser.validity_date) < new Date()) {
        return res.status(403).json({ error: 'Your subscription has expired.' });
      }
      
      req.user = decodedUser;
      req.tenant_id = decodedUser.role === 'PRIMARY' ? decodedUser.id : decodedUser.primary_user_id;
      next();
    });
  });
}

// ---------------------------
// AUTH & USER ENDPOINTS
// ---------------------------

// 1. Registration (Creates an ACTIVE account with 1 month validity)
app.post('/api/auth/register', async (req, res) => {
  const { business_name, email, mobile, password } = req.body;
  if (!business_name || !email || !mobile || !password) {
    return res.status(400).json({ error: 'All fields (business_name, email, mobile, password) are required.' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    // 1 Month Validity (30 Days)
    const validityDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    db.run(
      'INSERT INTO users (username, password, role, status, validity_date, business_name, email, mobile) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [email, hashedPassword, 'PRIMARY', 'ACTIVE', validityDate, business_name, email, mobile],
      function (err) {
        if (err) return res.status(400).json({ error: 'Email address may already be registered.' });
        
        const tenant_id = this.lastID;
        // Auto seed the settings table
        db.run(
          'INSERT INTO settings (tenant_id, name, email, mobile) VALUES (?, ?, ?, ?)',
          [tenant_id, business_name, email, mobile],
          (settingsErr) => {
            if (settingsErr) console.error('Error seeding settings:', settingsErr.message);
          }
        );
        
        res.json({ 
          message: 'Registration successful! Your account is active for 1 month.', 
          validity_date: validityDate 
        });
      }
    );
  } catch (e) { 
    res.status(500).json({ error: 'Server error during registration.' }); 
  }
});

// 2. Login (Checks Status & Validity Date)
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'Invalid username or password' });
    
    if (await bcrypt.compare(password, user.password)) {
      if (user.status === 'PENDING') {
        return res.status(403).json({ error: 'Your account is blocked until activated by support.' });
      }
      if (user.validity_date && new Date(user.validity_date) < new Date()) {
        return res.status(403).json({ error: 'Your subscription has expired.' });
      }
      
      const token = jwt.sign({ id: user.id, username: user.username, role: user.role, primary_user_id: user.primary_user_id }, SECRET_KEY);
      res.json({ token, user: { username: user.username, role: user.role, validity_date: user.validity_date, status: user.status } });
    } else {
      res.status(403).json({ error: 'Invalid username or password' });
    }
  });
});

// 3. Create Sub-Users (Max 3, by Primary User only)
app.post('/api/auth/subusers', authenticateToken, async (req, res) => {
  if (req.user.role !== 'PRIMARY') return res.status(403).json({ error: 'Only primary users can add staff.' });
  
  const { username, password, assignedRole } = req.body; // e.g., 'SALES', 'MARKETING'
  
  db.get('SELECT max_sub_users FROM users WHERE id = ?', [req.user.id], (err, primaryUserRow) => {
    const maxAllowed = primaryUserRow ? primaryUserRow.max_sub_users : 3;
    db.get('SELECT COUNT(*) as count FROM users WHERE primary_user_id = ?', [req.user.id], async (err, row) => {
      if (row.count >= maxAllowed) return res.status(400).json({ error: `Maximum of ${maxAllowed} staff allowed per account. Contact support to upgrade.` });
      
      const hashedPassword = await bcrypt.hash(password, 10);
      db.run(
        'INSERT INTO users (username, password, role, primary_user_id, status) VALUES (?, ?, ?, ?, ?)',
        [username, hashedPassword, assignedRole, req.user.id, 'ACTIVE'],
        function(err) {
          if (err) return res.status(400).json({ error: 'Failed to create sub-user (username may already exist).' });
          res.json({ success: true, message: 'Sub-user created successfully.' });
        }
      );
    });
  });
});

// ---------------------------
// API ENDPOINTS
// ---------------------------

app.get('/api/items', authenticateToken, (req, res) => {
  db.all('SELECT * FROM items WHERE tenant_id = ?', [req.tenant_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/items', authenticateToken, (req, res) => {
  const { name, photo, barcode, ratePurchase, rateWholesaler, rateRetailer, rateCustomer, quantity } = req.body;
  db.run(
    'INSERT INTO items (tenant_id, name, photo, barcode, ratePurchase, rateWholesaler, rateRetailer, rateCustomer, quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [req.tenant_id, name, photo, barcode, ratePurchase, rateWholesaler, rateRetailer, rateCustomer, quantity],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

app.put('/api/items/:id', authenticateToken, (req, res) => {
  const { name, photo, barcode, ratePurchase, rateWholesaler, rateRetailer, rateCustomer, quantity } = req.body;
  db.run(
    'UPDATE items SET name = ?, photo = ?, barcode = ?, ratePurchase = ?, rateWholesaler = ?, rateRetailer = ?, rateCustomer = ?, quantity = ? WHERE id = ? AND tenant_id = ?',
    [name, photo, barcode, ratePurchase, rateWholesaler, rateRetailer, rateCustomer, quantity, req.params.id, req.tenant_id],
    (err) => err ? res.status(500).json({ error: err.message }) : res.json({ success: true })
  );
});

app.delete('/api/items/:id', authenticateToken, (req, res) => {
  db.run('DELETE FROM items WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenant_id], (err) => {
    err ? res.status(500).json({ error: err.message }) : res.json({ success: true });
  });
});

app.get('/api/parties', authenticateToken, (req, res) => {
  db.all('SELECT * FROM parties WHERE tenant_id = ?', [req.tenant_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/parties', authenticateToken, (req, res) => {
  const { name, mobile, address, type, category } = req.body;
  db.run(
    'INSERT INTO parties (tenant_id, name, mobile, address, type, category) VALUES (?, ?, ?, ?, ?, ?)',
    [req.tenant_id, name, mobile, address, type, category],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

app.put('/api/parties/:id', authenticateToken, (req, res) => {
  const { name, mobile, address, type, category } = req.body;
  db.run(
    'UPDATE parties SET name = ?, mobile = ?, address = ?, type = ?, category = ? WHERE id = ? AND tenant_id = ?',
    [name, mobile, address, type, category, req.params.id, req.tenant_id],
    (err) => err ? res.status(500).json({ error: err.message }) : res.json({ success: true })
  );
});

app.delete('/api/parties/:id', authenticateToken, (req, res) => {
  db.run('DELETE FROM parties WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenant_id], (err) => {
    err ? res.status(500).json({ error: err.message }) : res.json({ success: true });
  });
});

app.get('/api/transactions', authenticateToken, (req, res) => {
  db.all('SELECT * FROM transactions WHERE tenant_id = ?', [req.tenant_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.all('SELECT * FROM transaction_items', [], (err, items) => {
      if (err) return res.status(500).json({ error: err.message });
      
      const transactionsWithItems = rows.map(tx => ({
        ...tx,
        items: items.filter(item => item.transaction_id === tx.id)
      }));
      res.json(transactionsWithItems);
    });
  });
});

app.post('/api/transactions', authenticateToken, (req, res) => {
  const { transaction, items } = req.body;
  const { type, party_id, totalAmount, date, invoiceNumber, paymentType, customerName } = transaction;

  db.run(
    'INSERT INTO transactions (tenant_id, type, party_id, totalAmount, date, invoiceNumber, paymentType, customerName) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [req.tenant_id, type, party_id, totalAmount, date, invoiceNumber, paymentType, customerName],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      const transaction_id = this.lastID;

      if (items && items.length > 0) {
        const stmt = db.prepare('INSERT INTO transaction_items (transaction_id, item_id, quantity, rate) VALUES (?, ?, ?, ?)');
        items.forEach((item) => {
          stmt.run([transaction_id, item.item_id, item.quantity, item.rate]);
          
          // Manage Stock Quantity
          if (type === 'Sale') {
             db.run('UPDATE items SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.item_id]);
          } else if (type === 'Purchase') {
             db.run('UPDATE items SET quantity = quantity + ? WHERE id = ?', [item.quantity, item.item_id]);
          }
        });
        stmt.finalize();
      }

      res.json({ id: transaction_id });
    }
  );
});

app.put('/api/transactions/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { transaction, items } = req.body;
  db.get('SELECT * FROM transactions WHERE id = ? AND tenant_id = ?', [id, req.tenant_id], (err, oldTx) => {
    if (!oldTx) return res.status(404).json({ error: 'Not found' });
    db.all('SELECT * FROM transaction_items WHERE transaction_id = ?', [id], (err, oldItems) => {
      oldItems.forEach(item => {
        if (oldTx.type === 'Sale') db.run('UPDATE items SET quantity = quantity + ? WHERE id = ?', [item.quantity, item.item_id]);
        else if (oldTx.type === 'Purchase') db.run('UPDATE items SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.item_id]);
      });
      db.run('DELETE FROM transaction_items WHERE transaction_id = ?', [id]);
      const { type, party_id, totalAmount, date, invoiceNumber, paymentType, customerName } = transaction;
      db.run(
        'UPDATE transactions SET type = ?, party_id = ?, totalAmount = ?, date = ?, invoiceNumber = ?, paymentType = ?, customerName = ? WHERE id = ?',
        [type, party_id, totalAmount, date, invoiceNumber, paymentType, customerName, id],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          if (items && items.length > 0) {
            const stmt = db.prepare('INSERT INTO transaction_items (transaction_id, item_id, quantity, rate) VALUES (?, ?, ?, ?)');
            items.forEach((item) => {
              stmt.run([id, item.item_id, item.quantity, item.rate]);
              if (type === 'Sale') db.run('UPDATE items SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.item_id]);
              else if (type === 'Purchase') db.run('UPDATE items SET quantity = quantity + ? WHERE id = ?', [item.quantity, item.item_id]);
            });
            stmt.finalize();
          }
          res.json({ success: true });
        }
      );
    });
  });
});

app.delete('/api/transactions/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM transactions WHERE id = ? AND tenant_id = ?', [id, req.tenant_id], (err, tx) => {
    if (!tx) return res.status(404).json({ error: 'Not found' });
    db.all('SELECT * FROM transaction_items WHERE transaction_id = ?', [id], (err, oldItems) => {
      oldItems.forEach(item => {
        if (tx.type === 'Sale') db.run('UPDATE items SET quantity = quantity + ? WHERE id = ?', [item.quantity, item.item_id]);
        else if (tx.type === 'Purchase') db.run('UPDATE items SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.item_id]);
      });
      db.run('DELETE FROM transaction_items WHERE transaction_id = ?', [id]);
      db.run('DELETE FROM transactions WHERE id = ? AND tenant_id = ?', [id, req.tenant_id], (err) => err ? res.status(500).json({ error: err.message }) : res.json({ success: true }));
    });
  });
});

app.delete('/api/transactions-clear', authenticateToken, (req, res) => {
  db.run('DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM transactions WHERE tenant_id = ?)', [req.tenant_id], () => {
     db.run('DELETE FROM transactions WHERE tenant_id = ?', [req.tenant_id], (err) => {
        err ? res.status(500).json({ error: err.message }) : res.json({ success: true });
     });
  });
});

app.get('/api/settings', authenticateToken, (req, res) => {
  db.get('SELECT * FROM settings WHERE tenant_id = ? ORDER BY id ASC LIMIT 1', [req.tenant_id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || {});
  });
});

app.post('/api/settings', authenticateToken, (req, res) => {
  const { name, address, mobile, email, upiId, logo } = req.body;
  
  db.get('SELECT id FROM settings WHERE tenant_id = ? ORDER BY id ASC LIMIT 1', [req.tenant_id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row) {
      db.run(
        'UPDATE settings SET name = ?, address = ?, mobile = ?, email = ?, upiId = ?, logo = ? WHERE id = ? AND tenant_id = ?',
        [name, address, mobile, email, upiId, logo, row.id, req.tenant_id],
        function (err) {
           if (err) return res.status(500).json({ error: err.message });
           res.json({ success: true });
        }
      );
    } else {
      db.run(
        'INSERT INTO settings (tenant_id, name, address, mobile, email, upiId, logo) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.tenant_id, name, address, mobile, email, upiId, logo],
        function (err) {
           if (err) return res.status(500).json({ error: err.message });
           res.json({ success: true });
        }
      );
    }
  });
});

// ---------------------------
// SUPER ADMIN MANAGEMENT
// ---------------------------

// Get all registered clients (Pending, Active, Expired)
app.get('/api/admin/clients', (req, res) => {
  db.all('SELECT id, username, status, validity_date, max_sub_users, business_name, email, mobile FROM users WHERE role = "PRIMARY"', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Update client (Activate, Change Expiry Date, Upgrade Sub-user limits)
app.put('/api/admin/clients/:id', (req, res) => {
  const { status, validity_date, max_sub_users } = req.body;
  db.run(
    'UPDATE users SET status = ?, validity_date = ?, max_sub_users = ? WHERE id = ?',
    [status, validity_date, max_sub_users, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'Client subscription updated successfully.' });
    }
  );
});

// Broadcast notifications to all users
app.post('/api/admin/notifications', (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Notification message is required.' });
  db.run(
    'INSERT INTO notifications (message, timestamp) VALUES (?, ?)',
    [message, new Date().toISOString()],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'Notification broadcasted successfully.' });
    }
  );
});

// Get broadcast notifications (fetch by mobile devices)
app.get('/api/notifications', (req, res) => {
  db.all('SELECT * FROM notifications ORDER BY id DESC LIMIT 50', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Serve Admin Control Dashboard
app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VEDAINVPRO Admin Portal</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-gradient: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
      --card-bg: rgba(30, 41, 59, 0.7);
      --card-border: rgba(255, 255, 255, 0.08);
      --accent-color: #6366f1;
      --accent-hover: #4f46e5;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --success: #10b981;
      --danger: #ef4444;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Outfit', sans-serif;
    }
    body {
      background: var(--bg-gradient);
      color: var(--text-main);
      min-height: 100vh;
      padding: 2rem;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2.5rem;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 1.5rem;
    }
    h1 {
      font-size: 2rem;
      font-weight: 700;
      background: linear-gradient(to right, #818cf8, #c084fc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2.5rem;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.5rem;
      backdrop-filter: blur(12px);
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
      transition: transform 0.2s;
    }
    .stat-card:hover {
      transform: translateY(-4px);
    }
    .stat-label {
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .stat-value {
      font-size: 2.25rem;
      font-weight: 700;
      color: var(--text-main);
    }
    .main-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 2rem;
    }
    @media (max-width: 900px) {
      .main-grid {
        grid-template-columns: 1fr;
      }
    }
    .panel {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 2rem;
      backdrop-filter: blur(12px);
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
      margin-bottom: 2rem;
    }
    .panel-title {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
      border-left: 4px solid var(--accent-color);
      padding-left: 0.75rem;
    }
    .table-container {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    th {
      padding: 1rem;
      color: var(--text-muted);
      font-weight: 600;
      border-bottom: 1px solid var(--card-border);
      font-size: 0.875rem;
    }
    td {
      padding: 1.2rem 1rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      font-size: 0.95rem;
    }
    tr:hover {
      background: rgba(255, 255, 255, 0.02);
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.6rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-active {
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
    }
    .badge-expired {
      background: rgba(239, 68, 68, 0.15);
      color: var(--danger);
    }
    .btn {
      display: inline-block;
      padding: 0.6rem 1.2rem;
      background: var(--accent-color);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
      font-size: 0.875rem;
    }
    .btn:hover {
      background: var(--accent-hover);
    }
    .btn:active {
      transform: scale(0.98);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-main);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.15);
    }
    .form-group {
      margin-bottom: 1.25rem;
    }
    label {
      display: block;
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      font-weight: 600;
    }
    input, textarea {
      width: 100%;
      padding: 0.75rem 1rem;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      color: #fff;
      font-size: 0.95rem;
      transition: border-color 0.2s;
    }
    input:focus, textarea:focus {
      outline: none;
      border-color: var(--accent-color);
    }
    .date-extend-container {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .date-input {
      width: 130px;
      padding: 0.4rem 0.6rem;
      font-size: 0.875rem;
    }
    .btn-action {
      padding: 0.4rem 0.8rem;
      font-size: 0.75rem;
    }
    .notification-item {
      padding: 1rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }
    .notification-time {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>VEDAINVPRO Admin Portal</h1>
      <span style="font-size: 0.875rem; color: var(--text-muted)">Security Level: Root Admin</span>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Mobile Installs</div>
        <div class="stat-value" id="stat-total">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Users</div>
        <div class="stat-value" id="stat-active" style="color: var(--success)">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Expired Subscriptions</div>
        <div class="stat-value" id="stat-expired" style="color: var(--danger)">0</div>
      </div>
    </div>

    <div class="main-grid">
      <!-- Clients Panel -->
      <div class="panel">
        <div class="panel-title">Registered Mobile Users</div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Business Info</th>
                <th>Contact info</th>
                <th>Expiry Date</th>
                <th>Status</th>
                <th>Validity Extender</th>
              </tr>
            </thead>
            <tbody id="clients-tbody">
              <!-- Dynamically Populated -->
            </tbody>
          </table>
        </div>
      </div>

      <!-- Control Panel -->
      <div>
        <!-- Send Notification -->
        <div class="panel">
          <div class="panel-title">Broadcast Notification</div>
          <div class="form-group">
            <label for="notif-message">Push Message to All Devices</label>
            <textarea id="notif-message" rows="4" placeholder="Enter message text..."></textarea>
          </div>
          <button class="btn" style="width: 100%" onclick="sendNotification()">Broadcast Message</button>
        </div>

        <!-- Recent Broadcasts -->
        <div class="panel">
          <div class="panel-title">Broadcast History</div>
          <div id="notif-history">
            <!-- Dynamically Populated -->
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    async function loadDashboard() {
      try {
        // Fetch clients
        const clientsRes = await fetch('/api/admin/clients');
        const clients = await clientsRes.json();
        
        // Calculate statistics
        const total = clients.length;
        let active = 0;
        let expired = 0;
        const todayStr = new Date().toISOString().split('T')[0];

        const tbody = document.getElementById('clients-tbody');
        tbody.innerHTML = '';

        clients.forEach(c => {
          const isExpired = c.validity_date && new Date(c.validity_date) < new Date();
          if (isExpired) expired++;
          else active++;

          const tr = document.createElement('tr');
          tr.innerHTML = \`
            <td>
              <div style="font-weight: 600">\${c.business_name || 'N/A'}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted)">User ID: \${c.username}</div>
            </td>
            <td>
              <div>\${c.mobile || 'N/A'}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted)">\${c.email || 'N/A'}</div>
            </td>
            <td>\${c.validity_date || 'No Expiry'}</td>
            <td>
              <span class="badge \${isExpired ? 'badge-expired' : 'badge-active'}">
                \${isExpired ? 'Expired' : 'Active'}
              </span>
            </td>
            <td>
              <div class="date-extend-container">
                <input type="date" class="date-input" id="date-\${c.id}" value="\${c.validity_date || ''}">
                <button class="btn btn-action" onclick="extendValidity(\${c.id}, '\${c.status}', \${c.max_sub_users})">Extend</button>
              </div>
            </td>
          \`;
          tbody.appendChild(tr);
        });

        document.getElementById('stat-total').innerText = total;
        document.getElementById('stat-active').innerText = active;
        document.getElementById('stat-expired').innerText = expired;

        // Fetch notifications
        const notifRes = await fetch('/api/notifications');
        const notifications = await notifRes.json();
        const historyContainer = document.getElementById('notif-history');
        historyContainer.innerHTML = '';

        notifications.slice(0, 5).forEach(n => {
          const div = document.createElement('div');
          div.className = 'notification-item';
          div.innerHTML = \`
            <div>\${n.message}</div>
            <div class="notification-time">\${new Date(n.timestamp).toLocaleString()}</div>
          \`;
          historyContainer.appendChild(div);
        });
      } catch (e) {
        console.error('Error loading dashboard:', e);
      }
    }

    async function extendValidity(id, status, maxSubUsers) {
      const dateInput = document.getElementById('date-' + id);
      const newDate = dateInput.value;
      if (!newDate) return alert('Please select a validity date');

      try {
        const res = await fetch('/api/admin/clients/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ACTIVE', validity_date: newDate, max_sub_users: maxSubUsers })
        });
        const data = await res.json();
        if (data.success) {
          alert('Validity period extended successfully!');
          loadDashboard();
        } else {
          alert('Failed: ' + data.error);
        }
      } catch (e) {
        alert('Network Error');
      }
    }

    async function sendNotification() {
      const msgTextarea = document.getElementById('notif-message');
      const message = msgTextarea.value;
      if (!message.trim()) return alert('Please enter a notification message');

      try {
        const res = await fetch('/api/admin/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message })
        });
        const data = await res.json();
        if (data.success) {
          alert('Notification broadcasted successfully!');
          msgTextarea.value = '';
          loadDashboard();
        } else {
          alert('Failed: ' + data.error);
        }
      } catch (e) {
        alert('Network Error');
      }
    }

    // Initial Load
    loadDashboard();
  </script>
</body>
</html>
  `);
});

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
});
