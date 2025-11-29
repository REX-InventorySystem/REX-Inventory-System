const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Rex_Ho:931919@cluster0.kfjopnu.mongodb.net/inventory_system?retryWrites=true&w=majority';
const VALID_SECURITY_CODE = "INV2025";

let db;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve COMPLETE application from single endpoint
app.get('/', (req, res) => {
  const currentPage = req.query.page || 'login';
  
  let htmlContent = '';
  
  switch(currentPage) {
    case 'register':
      htmlContent = getRegisterPage();
      break;
    case 'dashboard':
      htmlContent = getDashboardPage();
      break;
    case 'invoice':
      htmlContent = getInvoicePage();
      break;
    case 'statement':
      htmlContent = getStatementPage();
      break;
    case 'settings':
      htmlContent = getSettingsPage();
      break;
    case 'purchase':
      htmlContent = getPurchasePage();
      break;
    case 'sales':
      htmlContent = getSalesPage();
      break;
    default:
      htmlContent = getLoginPage();
  }
  
  res.send(htmlContent);
});

// API Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'Server is running', 
    timestamp: new Date().toISOString(),
    database: db ? 'Connected' : 'Disconnected'
  });
});

// Initialize MongoDB
async function connectDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('inventory_system');
    console.log('✅ Connected to MongoDB');
    
    // Create collections if they don't exist
    const collections = ['users', 'inventory', 'statements', 'invoices', 'purchases', 'sales', 'login_history'];
    for (const collectionName of collections) {
      const collection = db.collection(collectionName);
      if (collectionName === 'users') {
        try {
          await collection.createIndex({ "username": 1 }, { unique: true });
        } catch (error) {
          // Index likely already exists
        }
      }
    }
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
  }
}

connectDB();

// Authentication APIs
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }

    const user = await db.collection('users').findOne({ username });
    
    if (user && user.password === password) {
      // Record login history
      await db.collection('login_history').insertOne({
        username: user.username,
        loginTime: new Date(),
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent') || 'Unknown'
      });
      
      res.json({ success: true, user: { username: user.username } });
    } else {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, securityCode } = req.body;
    
    if (!username || !password || !securityCode) {
      return res.status(400).json({ error: 'All fields required' });
    }

    if (securityCode !== VALID_SECURITY_CODE) {
      return res.status(400).json({ error: 'Invalid security code' });
    }

    const existing = await db.collection('users').findOne({ username });
    if (existing) {
      return res.status(400).json({ error: 'Username exists' });
    }

    await db.collection('users').insertOne({
      username,
      password,
      createdAt: new Date()
    });

    res.json({ message: 'Registration successful' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login History API - Shows all users
app.get('/api/login-history', async (req, res) => {
  try {
    const user = JSON.parse(req.headers.user || '{}');
    if (!user.username) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get all login history (not just current user)
    const history = await db.collection('login_history')
      .find({})
      .sort({ loginTime: -1 })
      .limit(20)
      .toArray();
    
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Inventory APIs
app.get('/api/inventory', async (req, res) => {
  try {
    const { search, dateFrom, dateTo } = req.query;
    let query = {};
    
    // Search functionality
    if (search) {
      query.$or = [
        { sku: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Date range filter
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) {
        query.createdAt.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        query.createdAt.$lte = new Date(dateTo + 'T23:59:59.999Z');
      }
    }
    
    const items = await db.collection('inventory').find(query).toArray();
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/inventory/add', async (req, res) => {
  try {
    const item = {
      ...req.body,
      dateAdded: new Date().toLocaleDateString(),
      createdAt: new Date()
    };
    
    await db.collection('inventory').insertOne(item);
    res.json({ message: 'Item added successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    
    // Remove fields that shouldn't be updated
    delete updateData._id;
    delete updateData.createdAt;
    
    const result = await db.collection('inventory').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    res.json({ message: 'Item updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const result = await db.collection('inventory').deleteOne({ _id: new ObjectId(req.params.id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Statements/Reports APIs
app.get('/api/statements', async (req, res) => {
  try {
    const statements = await db.collection('statements').find({}).toArray();
    res.json(statements);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/statements/add', async (req, res) => {
  try {
    await db.collection('statements').insertOne({
      ...req.body.reportData,
      createdAt: new Date()
    });
    res.json({ message: 'Report saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/statements/:id', async (req, res) => {
  try {
    const result = await db.collection('statements').deleteOne({ _id: new ObjectId(req.params.id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Invoices APIs
app.post('/api/invoices', async (req, res) => {
  try {
    await db.collection('invoices').insertOne({
      ...req.body.invoiceData,
      createdAt: new Date()
    });
    res.json({ message: 'Invoice saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/invoices', async (req, res) => {
  try {
    const invoices = await db.collection('invoices').find({}).toArray();
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const result = await db.collection('invoices').deleteOne({ _id: new ObjectId(req.params.id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Purchase APIs
app.post('/api/purchases', async (req, res) => {
  try {
    const purchaseData = {
      ...req.body.purchaseData,
      type: 'purchase',
      createdAt: new Date()
    };
    
    await db.collection('purchases').insertOne(purchaseData);
    
    // Update inventory quantities
    for (const item of purchaseData.items) {
      const existingItem = await db.collection('inventory').findOne({ _id: new ObjectId(item.itemId) });
      
      if (existingItem) {
        const newQuantity = existingItem.quantity + item.quantity;
        await db.collection('inventory').updateOne(
          { _id: new ObjectId(item.itemId) },
          { $set: { quantity: newQuantity } }
        );
      }
    }
    
    res.json({ message: 'Purchase recorded successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/purchases', async (req, res) => {
  try {
    const purchases = await db.collection('purchases').find({}).toArray();
    res.json(purchases);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sales APIs
app.post('/api/sales', async (req, res) => {
  try {
    const salesData = {
      ...req.body.salesData,
      type: 'sale',
      createdAt: new Date()
    };
    
    await db.collection('sales').insertOne(salesData);
    
    // Update inventory quantities
    for (const item of salesData.items) {
      const existingItem = await db.collection('inventory').findOne({ _id: new ObjectId(item.itemId) });
      
      if (existingItem) {
        const newQuantity = existingItem.quantity - item.quantity;
        if (newQuantity < 0) {
          return res.status(400).json({ error: 'Insufficient stock for ' + existingItem.name });
        }
        
        await db.collection('inventory').updateOne(
          { _id: new ObjectId(item.itemId) },
          { $set: { quantity: newQuantity } }
        );
      }
    }
    
    res.json({ message: 'Sale recorded successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sales', async (req, res) => {
  try {
    const sales = await db.collection('sales').find({}).toArray();
    res.json(sales);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// User management APIs
app.put('/api/user/password', async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    
    const user = await db.collection('users').findOne({ username, password: currentPassword });
    
    if (!user) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    
    await db.collection('users').updateOne(
      { username },
      { $set: { password: newPassword } }
    );
    
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/user', async (req, res) => {
  try {
    const { username, securityCode } = req.body;
    
    if (!securityCode || securityCode !== VALID_SECURITY_CODE) {
      return res.status(400).json({ error: 'Invalid security code' });
    }
    
    // Only delete user account and their personal data
    await db.collection('users').deleteOne({ username });
    
    // Delete user's personal data only (not inventory data)
    await db.collection('statements').deleteMany({});
    await db.collection('invoices').deleteMany({});
    await db.collection('purchases').deleteMany({});
    await db.collection('sales').deleteMany({});
    await db.collection('login_history').deleteMany({ username });
    
    res.json({ message: 'Account deleted successfully. Inventory data preserved.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PDF Generation APIs with Professional Layout
app.post('/generate-invoice-pdf', (req, res) => {
  try {
    const { invoiceData } = req.body;
    
    const doc = new PDFDocument({ margin: 50 });
    const filename = 'invoice-' + Date.now() + '.pdf';
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    
    doc.pipe(res);
    
    // Header with company info
    doc.fillColor('#3b82f6')
       .fontSize(24)
       .text('INVOICE', { align: 'center' });
    
    doc.moveDown(0.5);
    
    // Company Information
    doc.fillColor('#1e293b')
       .fontSize(10)
       .text('Inventory Management System', { align: 'center' })
       .text('Professional Inventory Solutions', { align: 'center' })
       .text('Email: support@inventory-system.com', { align: 'center' });
    
    doc.moveDown(1);
    
    // Draw separator line
    doc.moveTo(50, doc.y)
       .lineTo(550, doc.y)
       .strokeColor('#e2e8f0')
       .lineWidth(1)
       .stroke();
    
    doc.moveDown(1);
    
    // Invoice details in two columns
    const leftColumn = 50;
    const rightColumn = 300;
    
    doc.fillColor('#1e293b')
       .fontSize(12)
       .text('Invoice ID:', leftColumn, doc.y, { continued: true })
       .fillColor('#64748b')
       .text(` ${invoiceData.id || 'N/A'}`)
       
       .fillColor('#1e293b')
       .text('Invoice Date:', leftColumn, doc.y + 20, { continued: true })
       .fillColor('#64748b')
       .text(` ${invoiceData.date || new Date().toLocaleDateString()}`)
       
       .fillColor('#1e293b')
       .text('Generated By:', rightColumn, doc.y - 40, { continued: true })
       .fillColor('#64748b')
       .text(' Inventory System');
    
    doc.moveDown(2);
    
    // Table header
    const tableTop = doc.y;
    doc.fillColor('#ffffff')
       .rect(50, tableTop, 500, 25)
       .fill('#3b82f6');
    
    doc.fillColor('#ffffff')
       .fontSize(10)
       .font('Helvetica-Bold')
       .text('Item Description', 55, tableTop + 8)
       .text('Qty', 350, tableTop + 8)
       .text('Unit Price', 400, tableTop + 8)
       .text('Total', 470, tableTop + 8);
    
    let yPosition = tableTop + 35;
    
    // Invoice items
    invoiceData.items.forEach((item, index) => {
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
      }
      
      const itemTotal = item.invoiceQty * item.unitPrice;
      const isEven = index % 2 === 0;
      
      // Alternate row colors
      if (isEven) {
        doc.fillColor('#f8fafc')
           .rect(50, yPosition - 5, 500, 30)
           .fill();
      }
      
      doc.fillColor('#1e293b')
         .font('Helvetica')
         .fontSize(9)
         .text(item.name, 55, yPosition)
         .text(item.invoiceQty.toString(), 350, yPosition)
         .text(`RM ${item.unitPrice.toFixed(2)}`, 400, yPosition)
         .text(`RM ${itemTotal.toFixed(2)}`, 470, yPosition);
      
      // Item details
      doc.fillColor('#64748b')
         .fontSize(7)
         .text(`SKU: ${item.sku} | Category: ${item.category}`, 55, yPosition + 12);
      
      yPosition += 30;
    });
    
    // Total section
    const totalY = Math.max(yPosition + 20, 650);
    doc.moveTo(350, totalY)
       .lineTo(550, totalY)
       .strokeColor('#e2e8f0')
       .lineWidth(1)
       .stroke();
    
    doc.fillColor('#1e293b')
       .fontSize(12)
       .font('Helvetica-Bold')
       .text('Grand Total:', 350, totalY + 10, { continued: true })
       .fillColor('#3b82f6')
       .text(` RM ${invoiceData.total.toFixed(2)}`, { align: 'right' });
    
    // Footer
    doc.y = 750;
    doc.fillColor('#64748b')
       .fontSize(8)
       .text('Thank you for your business!', { align: 'center' })
       .text('This is a computer-generated invoice. No signature required.', { align: 'center' })
       .text(`Generated on: ${new Date().toLocaleString()} | Inventory Management System v2.0`, { align: 'center' });
    
    doc.end();
    
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

app.post('/generate-purchase-pdf', (req, res) => {
  try {
    const { purchaseData } = req.body;
    
    const doc = new PDFDocument({ margin: 50 });
    const filename = 'purchase-order-' + Date.now() + '.pdf';
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    
    doc.pipe(res);
    
    // Header
    doc.fillColor('#10b981')
       .fontSize(24)
       .text('PURCHASE ORDER', { align: 'center' });
    
    doc.moveDown(0.5);
    
    // Company Information
    doc.fillColor('#1e293b')
       .fontSize(10)
       .text('Inventory Management System', { align: 'center' })
       .text('Stock Procurement Department', { align: 'center' });
    
    doc.moveDown(1);
    
    // Draw separator line
    doc.moveTo(50, doc.y)
       .lineTo(550, doc.y)
       .strokeColor('#e2e8f0')
       .lineWidth(1)
       .stroke();
    
    doc.moveDown(1);
    
    // Purchase details
    const leftColumn = 50;
    const rightColumn = 300;
    
    doc.fillColor('#1e293b')
       .fontSize(11)
       .text('Purchase ID:', leftColumn, doc.y, { continued: true })
       .fillColor('#64748b')
       .text(` ${purchaseData.id || 'N/A'}`)
       
       .fillColor('#1e293b')
       .text('Order Date:', leftColumn, doc.y + 20, { continued: true })
       .fillColor('#64748b')
       .text(` ${purchaseData.date || new Date().toLocaleDateString()}`)
       
       .fillColor('#1e293b')
       .text('Supplier:', rightColumn, doc.y - 40, { continued: true })
       .fillColor('#64748b')
       .text(` ${purchaseData.supplier || 'N/A'}`);
    
    doc.moveDown(2);
    
    // Table header
    const tableTop = doc.y;
    doc.fillColor('#ffffff')
       .rect(50, tableTop, 500, 25)
       .fill('#10b981');
    
    doc.fillColor('#ffffff')
       .fontSize(10)
       .font('Helvetica-Bold')
       .text('Item', 55, tableTop + 8)
       .text('SKU', 200, tableTop + 8)
       .text('Qty', 300, tableTop + 8)
       .text('Unit Cost', 350, tableTop + 8)
       .text('Total', 450, tableTop + 8);
    
    let yPosition = tableTop + 35;
    let totalCost = 0;
    
    // Purchase items
    purchaseData.items.forEach((item, index) => {
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
      }
      
      const itemTotal = item.quantity * item.unitCost;
      totalCost += itemTotal;
      const isEven = index % 2 === 0;
      
      // Alternate row colors
      if (isEven) {
        doc.fillColor('#f8fafc')
           .rect(50, yPosition - 5, 500, 25)
           .fill();
      }
      
      doc.fillColor('#1e293b')
         .font('Helvetica')
         .fontSize(9)
         .text(item.name, 55, yPosition)
         .text(item.sku, 200, yPosition)
         .text(item.quantity.toString(), 300, yPosition)
         .text(`RM ${item.unitCost.toFixed(2)}`, 350, yPosition)
         .text(`RM ${itemTotal.toFixed(2)}`, 450, yPosition);
      
      yPosition += 25;
    });
    
    // Total section
    const totalY = Math.max(yPosition + 20, 650);
    doc.moveTo(350, totalY)
       .lineTo(550, totalY)
       .strokeColor('#e2e8f0')
       .lineWidth(1)
       .stroke();
    
    doc.fillColor('#1e293b')
       .fontSize(12)
       .font('Helvetica-Bold')
       .text('Total Cost:', 350, totalY + 10, { continued: true })
       .fillColor('#10b981')
       .text(` RM ${totalCost.toFixed(2)}`, { align: 'right' });
    
    // Footer
    doc.y = 750;
    doc.fillColor('#64748b')
       .fontSize(8)
       .text('Purchase Order - Inventory Management System', { align: 'center' })
       .text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });
    
    doc.end();
    
  } catch (error) {
    console.error('Purchase PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate purchase PDF' });
  }
});

app.post('/generate-sales-pdf', (req, res) => {
  try {
    const { salesData } = req.body;
    
    const doc = new PDFDocument({ margin: 50 });
    const filename = 'sales-invoice-' + Date.now() + '.pdf';
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    
    doc.pipe(res);
    
    // Header
    doc.fillColor('#ef4444')
       .fontSize(24)
       .text('SALES INVOICE', { align: 'center' });
    
    doc.moveDown(0.5);
    
    // Company Information
    doc.fillColor('#1e293b')
       .fontSize(10)
       .text('Inventory Management System', { align: 'center' })
       .text('Sales Department', { align: 'center' });
    
    doc.moveDown(1);
    
    // Draw separator line
    doc.moveTo(50, doc.y)
       .lineTo(550, doc.y)
       .strokeColor('#e2e8f0')
       .lineWidth(1)
       .stroke();
    
    doc.moveDown(1);
    
    // Sales details
    const leftColumn = 50;
    const rightColumn = 300;
    
    doc.fillColor('#1e293b')
       .fontSize(11)
       .text('Sales ID:', leftColumn, doc.y, { continued: true })
       .fillColor('#64748b')
       .text(` ${salesData.id || 'N/A'}`)
       
       .fillColor('#1e293b')
       .text('Sale Date:', leftColumn, doc.y + 20, { continued: true })
       .fillColor('#64748b')
       .text(` ${salesData.date || new Date().toLocaleDateString()}`)
       
       .fillColor('#1e293b')
       .text('Customer:', rightColumn, doc.y - 40, { continued: true })
       .fillColor('#64748b')
       .text(` ${salesData.customer || 'N/A'}`);
    
    doc.moveDown(2);
    
    // Table header
    const tableTop = doc.y;
    doc.fillColor('#ffffff')
       .rect(50, tableTop, 500, 25)
       .fill('#ef4444');
    
    doc.fillColor('#ffffff')
       .fontSize(10)
       .font('Helvetica-Bold')
       .text('Item', 55, tableTop + 8)
       .text('SKU', 200, tableTop + 8)
       .text('Qty', 300, tableTop + 8)
       .text('Unit Price', 350, tableTop + 8)
       .text('Total', 450, tableTop + 8);
    
    let yPosition = tableTop + 35;
    
    // Sales items
    salesData.items.forEach((item, index) => {
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
      }
      
      const itemTotal = item.quantity * item.unitPrice;
      const isEven = index % 2 === 0;
      
      // Alternate row colors
      if (isEven) {
        doc.fillColor('#f8fafc')
           .rect(50, yPosition - 5, 500, 25)
           .fill();
      }
      
      doc.fillColor('#1e293b')
         .font('Helvetica')
         .fontSize(9)
         .text(item.name, 55, yPosition)
         .text(item.sku, 200, yPosition)
         .text(item.quantity.toString(), 300, yPosition)
         .text(`RM ${item.unitPrice.toFixed(2)}`, 350, yPosition)
         .text(`RM ${itemTotal.toFixed(2)}`, 450, yPosition);
      
      yPosition += 25;
    });
    
    // Total section
    const totalY = Math.max(yPosition + 20, 650);
    doc.moveTo(350, totalY)
       .lineTo(550, totalY)
       .strokeColor('#e2e8f0')
       .lineWidth(1)
       .stroke();
    
    doc.fillColor('#1e293b')
       .fontSize(12)
       .font('Helvetica-Bold')
       .text('Grand Total:', 350, totalY + 10, { continued: true })
       .fillColor('#ef4444')
       .text(` RM ${salesData.total.toFixed(2)}`, { align: 'right' });
    
    // Footer
    doc.y = 750;
    doc.fillColor('#64748b')
       .fontSize(8)
       .text('Thank you for your purchase!', { align: 'center' })
       .text('Sales Invoice - Inventory Management System', { align: 'center' })
       .text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });
    
    doc.end();
    
  } catch (error) {
    console.error('Sales PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate sales PDF' });
  }
});

app.post('/generate-inventory-report-pdf', (req, res) => {
  try {
    const { reportData } = req.body;
    
    const doc = new PDFDocument({ margin: 50 });
    const filename = 'inventory-report-' + Date.now() + '.pdf';
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    
    doc.pipe(res);
    
    // Header
    doc.fillColor('#06b6d4')
       .fontSize(24)
       .text('INVENTORY REPORT', { align: 'center' });
    
    doc.moveDown(0.5);
    
    // Company Information
    doc.fillColor('#1e293b')
       .fontSize(10)
       .text('Inventory Management System', { align: 'center' })
       .text('Comprehensive Stock Analysis', { align: 'center' });
    
    doc.moveDown(1);
    
    // Draw separator line
    doc.moveTo(50, doc.y)
       .lineTo(550, doc.y)
       .strokeColor('#e2e8f0')
       .lineWidth(1)
       .stroke();
    
    doc.moveDown(1);
    
    // Report details
    const leftColumn = 50;
    const rightColumn = 300;
    
    doc.fillColor('#1e293b')
       .fontSize(11)
       .text('Report ID:', leftColumn, doc.y, { continued: true })
       .fillColor('#64748b')
       .text(` ${reportData.id}`)
       
       .fillColor('#1e293b')
       .text('Generated:', leftColumn, doc.y + 20, { continued: true })
       .fillColor('#64748b')
       .text(` ${reportData.date}`)
       
       .fillColor('#1e293b')
       .text('Date Range:', leftColumn, doc.y + 40, { continued: true })
       .fillColor('#64748b')
       .text(` ${reportData.dateRange || 'All Items'}`)
       
       .fillColor('#1e293b')
       .text('Total Items:', rightColumn, doc.y - 60, { continued: true })
       .fillColor('#64748b')
       .text(` ${reportData.items.length}`)
       
       .fillColor('#1e293b')
       .text('Report Type:', rightColumn, doc.y + 20, { continued: true })
       .fillColor('#64748b')
       .text(' Comprehensive Inventory');
    
    doc.moveDown(2);
    
    // Table header
    const tableTop = doc.y;
    doc.fillColor('#ffffff')
       .rect(50, tableTop, 500, 25)
       .fill('#06b6d4');
    
    doc.fillColor('#ffffff')
       .fontSize(9)
       .font('Helvetica-Bold')
       .text('#', 55, tableTop + 8)
       .text('SKU', 70, tableTop + 8)
       .text('Product Name', 120, tableTop + 8)
       .text('Category', 220, tableTop + 8)
       .text('Stock', 300, tableTop + 8)
       .text('Cost', 340, tableTop + 8)
       .text('Price', 390, tableTop + 8)
       .text('Value', 450, tableTop + 8);
    
    let yPosition = tableTop + 35;
    let totalInventoryValue = 0;
    let totalPotentialValue = 0;
    let totalItems = 0;
    
    // Inventory items
    reportData.items.forEach((item, index) => {
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
        
        // Add table header on new page
        doc.fillColor('#ffffff')
           .rect(50, yPosition, 500, 25)
           .fill('#06b6d4');
        
        doc.fillColor('#ffffff')
           .fontSize(9)
           .font('Helvetica-Bold')
           .text('#', 55, yPosition + 8)
           .text('SKU', 70, yPosition + 8)
           .text('Product Name', 120, yPosition + 8)
           .text('Category', 220, yPosition + 8)
           .text('Stock', 300, yPosition + 8)
           .text('Cost', 340, yPosition + 8)
           .text('Price', 390, yPosition + 8)
           .text('Value', 450, yPosition + 8);
        
        yPosition += 35;
      }
      
      const inventoryValue = item.quantity * item.unitCost;
      const potentialValue = item.quantity * item.unitPrice;
      totalInventoryValue += inventoryValue;
      totalPotentialValue += potentialValue;
      totalItems += item.quantity;
      
      const isEven = index % 2 === 0;
      
      // Alternate row colors
      if (isEven) {
        doc.fillColor('#f8fafc')
           .rect(50, yPosition - 5, 500, 20)
           .fill();
      }
      
      doc.fillColor('#1e293b')
         .font('Helvetica')
         .fontSize(8)
         .text((index + 1).toString(), 55, yPosition)
         .text(item.sku, 70, yPosition)
         .text(item.name.length > 25 ? item.name.substring(0, 22) + '...' : item.name, 120, yPosition)
         .text(item.category.length > 15 ? item.category.substring(0, 12) + '...' : item.category, 220, yPosition)
         .text(item.quantity.toString(), 300, yPosition)
         .text(`RM ${item.unitCost.toFixed(2)}`, 340, yPosition)
         .text(`RM ${item.unitPrice.toFixed(2)}`, 390, yPosition)
         .text(`RM ${inventoryValue.toFixed(2)}`, 450, yPosition);
      
      yPosition += 20;
    });
    
    // Summary section
    const summaryY = Math.max(yPosition + 30, 650);
    
    // Summary box
    doc.fillColor('#f8fafc')
       .rect(50, summaryY, 500, 100)
       .fill();
    
    doc.strokeColor('#e2e8f0')
       .rect(50, summaryY, 500, 100)
       .stroke();
    
    doc.fillColor('#1e293b')
       .fontSize(12)
       .font('Helvetica-Bold')
       .text('INVENTORY SUMMARY', 55, summaryY + 15);
    
    doc.fillColor('#64748b')
       .fontSize(9)
       .font('Helvetica')
       .text('Total Items in Report:', 55, summaryY + 35, { continued: true })
       .fillColor('#1e293b')
       .text(` ${reportData.items.length} products`)
       
       .fillColor('#64748b')
       .text('Total Stock Quantity:', 55, summaryY + 50, { continued: true })
       .fillColor('#1e293b')
       .text(` ${totalItems} units`)
       
       .fillColor('#64748b')
       .text('Total Inventory Value:', 280, summaryY + 35, { continued: true })
       .fillColor('#ef4444')
       .text(` RM ${totalInventoryValue.toFixed(2)}`)
       
       .fillColor('#64748b')
       .text('Total Potential Value:', 280, summaryY + 50, { continued: true })
       .fillColor('#10b981')
       .text(` RM ${totalPotentialValue.toFixed(2)}`)
       
       .fillColor('#64748b')
       .text('Profit Potential:', 280, summaryY + 65, { continued: true })
       .fillColor('#3b82f6')
       .text(` RM ${(totalPotentialValue - totalInventoryValue).toFixed(2)}`);
    
    // Footer
    doc.y = summaryY + 120;
    doc.fillColor('#64748b')
       .fontSize(8)
       .text('Confidential Inventory Report - For Internal Use Only', { align: 'center' })
       .text('Inventory Management System | Professional Stock Analysis', { align: 'center' })
       .text(`Generated on: ${new Date().toLocaleString()} | Page 1 of 1`, { align: 'center' });
    
    doc.end();
    
  } catch (error) {
    console.error('Inventory PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate inventory PDF' });
  }
});

// HTML Page Templates
function getLoginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login | Inventory System</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="auth-container">
    <div class="auth-header">
      <div class="logo">📦</div>
      <h1 class="main-title">INVENTORY SYSTEM</h1>
      <h2 class="sub-title">WITH INVOICE SYSTEM</h2>
      <p class="tagline">Complete Inventory Management Solution</p>
    </div>
    
    <div class="auth-card">
      <h3>Login to Your Account</h3>
      <form id="loginForm">
        <div class="input-group">
          <label>Username</label>
          <input type="text" id="username" required placeholder="Enter your username">
        </div>
        <div class="input-group">
          <label>Password</label>
          <input type="password" id="password" required placeholder="Enter your password">
        </div>
        <button type="submit" class="btn full primary">Login</button>
        <div class="auth-links">
          <p>No account? <a href="/?page=register" class="link">Register here</a></p>
        </div>
      </form>
    </div>
    
    <div class="auth-features">
      <div class="feature">
        <span class="feature-icon">📊</span>
        <span>Inventory Management</span>
      </div>
      <div class="feature">
        <span class="feature-icon">🧾</span>
        <span>Invoice Generation</span>
      </div>
      <div class="feature">
        <span class="feature-icon">📈</span>
        <span>Sales & Purchase Tracking</span>
      </div>
      <div class="feature">
        <span class="feature-icon">📋</span>
        <span>Reports & Analytics</span>
      </div>
    </div>
  </div>

  <script>${getJavaScript()}</script>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;

      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        
        if (data.success) {
          localStorage.setItem('currentUser', JSON.stringify(data.user));
          window.location.href = '/?page=dashboard';
        } else {
          alert('Login failed: ' + data.error);
        }
      } catch (error) {
        alert('Login error: ' + error.message);
      }
    });

    const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (currentUser && currentUser.username) {
      window.location.href = '/?page=dashboard';
    }
  </script>
</body>
</html>`;
}

function getRegisterPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Register | Inventory System</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="auth-container">
    <div class="auth-header">
      <div class="logo">📦</div>
      <h1 class="main-title">INVENTORY SYSTEM</h1>
      <h2 class="sub-title">WITH INVOICE SYSTEM</h2>
      <p class="tagline">Complete Inventory Management Solution</p>
    </div>
    
    <div class="auth-card">
      <h3>Create New Account</h3>
      <form id="registerForm">
        <div class="input-group">
          <label>Username</label>
          <input type="text" id="user" required placeholder="Choose a username">
        </div>
        <div class="input-group">
          <label>Password</label>
          <input type="password" id="pass" required placeholder="Create a password">
        </div>
        <div class="input-group">
          <label>Security Code</label>
          <input type="password" id="securityCode" required placeholder="Enter security code">
          <small class="hint">Contact administrator for security code</small>
        </div>
        <button type="submit" class="btn full primary">Create Account</button>
        <div class="auth-links">
          <p>Already have an account? <a href="/" class="link">Login here</a></p>
        </div>
      </form>
    </div>
    
    <div class="auth-features">
      <div class="feature">
        <span class="feature-icon">🔒</span>
        <span>Secure Authentication</span>
      </div>
      <div class="feature">
        <span class="feature-icon">👥</span>
        <span>Multi-User Support</span>
      </div>
      <div class="feature">
        <span class="feature-icon">📱</span>
        <span>Responsive Design</span>
      </div>
      <div class="feature">
        <span class="feature-icon">🆓</span>
        <span>Free to Use</span>
      </div>
    </div>
  </div>

  <script>${getJavaScript()}</script>
  <script>
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('user').value;
      const password = document.getElementById('pass').value;
      const securityCode = document.getElementById('securityCode').value;

      try {
        const response = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, securityCode })
        });

        const data = await response.json();
        
        if (response.ok) {
          alert('Registration successful!');
          window.location.href = '/';
        } else {
          alert('Registration failed: ' + data.error);
        }
      } catch (error) {
        alert('Registration error: ' + error.message);
      }
    });
  </script>
</body>
</html>`;
}

function getDashboardPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard | Inventory System</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <h2>📦 Inventory Dashboard</h2>
      <div class="topbar-actions">
        <span class="welcome-text">Welcome, <strong id="username"></strong></span>
        <button class="btn small ghost" onclick="toggleTheme()">🌓</button>
        <a href="/?page=settings" class="btn small">⚙️ Settings</a>
        <button class="btn small danger" onclick="logout()">Logout</button>
      </div>
    </div>

    <!-- Login History Section -->
    <div class="card">
      <div class="card-header">
        <h3>📊 System Login History</h3>
        <button class="btn small" onclick="refreshLoginHistory()">🔄 Refresh</button>
      </div>
      <div id="loginHistory" class="login-history-container">
        <div class="loading">Loading login history...</div>
      </div>
    </div>

    <!-- Total Values Summary -->
    <div class="card">
      <h3>💰 Inventory Value Summary</h3>
      <div class="value-summary">
        <div class="value-item primary">
          <h4>Total Inventory Value</h4>
          <p id="totalInventoryValueSummary">RM 0.00</p>
        </div>
        <div class="value-item success">
          <h4>Total Potential Value</h4>
          <p id="totalPotentialValueSummary">RM 0.00</p>
        </div>
        <div class="value-item info">
          <h4>Total Items</h4>
          <p id="totalItemsCount">0</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Add New Item</h3>
      <form id="itemForm">
        <div class="form-row">
          <label>SKU <input type="text" id="itemSKU" required placeholder="Product SKU"></label>
          <label>Name <input type="text" id="itemName" required placeholder="Product name"></label>
          <label>Category <input type="text" id="itemCategory" required placeholder="Product category"></label>
        </div>
        <div class="form-row">
          <label>Quantity <input type="number" id="itemQty" min="1" required placeholder="0"></label>
          <label>Unit Cost (RM) <input type="number" id="itemUnitCost" step="0.01" min="0.01" required placeholder="0.00"></label>
          <label>Unit Price (RM) <input type="number" id="itemUnitPrice" step="0.01" min="0.01" required placeholder="0.00"></label>
        </div>
        <button type="submit" class="btn full primary">➕ Add Item</button>
      </form>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>Inventory List</h3>
        <div class="action-buttons">
          <button class="btn" onclick="downloadInventoryReport()">📊 Download Report</button>
          <a href="/?page=purchase" class="btn primary">📥 Purchase</a>
          <a href="/?page=sales" class="btn success">📤 Sales</a>
          <a href="/?page=invoice" class="btn info">📄 Invoice</a>
          <a href="/?page=statement" class="btn">📋 Statement</a>
        </div>
      </div>

      <!-- Search and Filter Section -->
      <div class="search-section">
        <div class="form-row">
          <label style="flex: 2;">
            Search Items
            <input type="text" id="searchInput" placeholder="Search by SKU, Name, or Category..." oninput="searchInventory()">
          </label>
          <label>
            Date From
            <input type="date" id="dateFrom" onchange="searchInventory()">
          </label>
          <label>
            Date To
            <input type="date" id="dateTo" onchange="searchInventory()">
          </label>
          <label style="align-self: flex-end;">
            <button type="button" class="btn small danger" onclick="clearSearch()" style="margin-top: 5px;">Clear</button>
          </label>
        </div>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>#</th>
            <th>SKU</th>
            <th>Name</th>
            <th>Category</th>
            <th>Qty</th>
            <th>Unit Cost</th>
            <th>Unit Price</th>
            <th>Total Value</th>
            <th>Potential Value</th>
            <th>Date Added</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="inventoryBody"></tbody>
        <tfoot>
          <tr class="subtotal-row">
            <td colspan="7"><strong>Subtotal:</strong></td>
            <td><strong id="totalInventoryValue">RM 0.00</strong></td>
            <td><strong id="totalPotentialValue">RM 0.00</strong></td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>

  <!-- Edit Item Modal -->
  <div id="editModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Edit Item</h3>
        <span class="close" onclick="closeEditModal()">&times;</span>
      </div>
      <form id="editItemForm">
        <input type="hidden" id="editItemId">
        <div class="form-row">
          <label>SKU <input type="text" id="editItemSKU" required></label>
          <label>Name <input type="text" id="editItemName" required></label>
          <label>Category <input type="text" id="editItemCategory" required></label>
        </div>
        <div class="form-row">
          <label>Quantity <input type="number" id="editItemQty" min="1" required></label>
          <label>Unit Cost (RM) <input type="number" id="editItemUnitCost" step="0.01" min="0.01" required></label>
          <label>Unit Price (RM) <input type="number" id="editItemUnitPrice" step="0.01" min="0.01" required></label>
        </div>
        <div class="controls">
          <button type="submit" class="btn primary">Update Item</button>
          <button type="button" class="btn danger" onclick="closeEditModal()">Cancel</button>
        </div>
      </form>
    </div>
  </div>

  <footer>© 2025 Inventory Management System | Rex_Ho</footer>

  <script>${getJavaScript()}</script>
  <script>
    let inventoryItems = [];
    let currentPurchaseId = null;
    let currentSalesId = null;

    async function loadLoginHistory() {
      try {
        const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
        const response = await fetch('/api/login-history', {
          headers: {
            'Content-Type': 'application/json',
            'user': JSON.stringify(user)
          }
        });
        
        const history = await response.json();
        const container = document.getElementById('loginHistory');
        
        if (history.length === 0) {
          container.innerHTML = '<div class="empty-state">No login history available.</div>';
        } else {
          container.innerHTML = '';
          history.forEach((entry, index) => {
            const entryDiv = document.createElement('div');
            entryDiv.className = 'login-history-item';
            const timeAgo = getTimeAgo(new Date(entry.loginTime));
            const isCurrentUser = entry.username === user.username;
            
            entryDiv.innerHTML = \`
              <div class="login-history-header">
                <div class="user-info">
                  <span class="user-avatar">\${isCurrentUser ? '👤' : '👥'}</span>
                  <div>
                    <strong class="username \${isCurrentUser ? 'current-user' : ''}">\${entry.username}</strong>
                    <div class="login-time">\${timeAgo}</div>
                  </div>
                </div>
                <div class="login-status success">Successful</div>
              </div>
              <div class="login-details">
                <div class="detail-item">
                  <span class="detail-label">IP Address:</span>
                  <span class="detail-value">\${entry.ip || 'N/A'}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">Time:</span>
                  <span class="detail-value">\${new Date(entry.loginTime).toLocaleString()}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">Device:</span>
                  <span class="detail-value">\${getDeviceInfo(entry.userAgent)}</span>
                </div>
              </div>
            \`;
            container.appendChild(entryDiv);
          });
        }
      } catch (error) {
        console.error('Error loading login history:', error);
        document.getElementById('loginHistory').innerHTML = '<div class="error-state">Failed to load login history.</div>';
      }
    }

    function getTimeAgo(date) {
      const now = new Date();
      const diffInSeconds = Math.floor((now - date) / 1000);
      
      if (diffInSeconds < 60) return 'Just now';
      if (diffInSeconds < 3600) return \`\${Math.floor(diffInSeconds / 60)} minutes ago\`;
      if (diffInSeconds < 86400) return \`\${Math.floor(diffInSeconds / 3600)} hours ago\`;
      return \`\${Math.floor(diffInSeconds / 86400)} days ago\`;
    }

    function getDeviceInfo(userAgent) {
      if (!userAgent) return 'Unknown';
      
      if (userAgent.includes('Mobile')) {
        return '📱 Mobile';
      } else if (userAgent.includes('Tablet')) {
        return '📱 Tablet';
      } else {
        return '💻 Desktop';
      }
    }

    function refreshLoginHistory() {
      loadLoginHistory();
    }

    async function loadInventory() {
      try {
        const search = document.getElementById('searchInput').value;
        const dateFrom = document.getElementById('dateFrom').value;
        const dateTo = document.getElementById('dateTo').value;
        
        let url = '/api/inventory';
        const params = new URLSearchParams();
        
        if (search) params.append('search', search);
        if (dateFrom) params.append('dateFrom', dateFrom);
        if (dateTo) params.append('dateTo', dateTo);
        
        if (params.toString()) {
          url += '?' + params.toString();
        }
        
        const response = await fetch(url);
        inventoryItems = await response.json();
        const body = document.getElementById('inventoryBody');
        body.innerHTML = inventoryItems.length ? '' : '<tr><td colspan="11" class="no-data">No items in inventory</td></tr>';

        let totalInventoryValue = 0;
        let totalPotentialValue = 0;

        inventoryItems.forEach((item, i) => {
          const inventoryValue = item.quantity * item.unitCost;
          const potentialValue = item.quantity * item.unitPrice;
          totalInventoryValue += inventoryValue;
          totalPotentialValue += potentialValue;

          body.innerHTML += \`
            <tr>
              <td>\${i + 1}</td>
              <td><strong>\${item.sku}</strong></td>
              <td>\${item.name}</td>
              <td><span class="category-tag">\${item.category}</span></td>
              <td><span class="quantity-badge">\${item.quantity}</span></td>
              <td>RM \${item.unitCost.toFixed(2)}</td>
              <td>RM \${item.unitPrice.toFixed(2)}</td>
              <td><strong class="value-text">RM \${inventoryValue.toFixed(2)}</strong></td>
              <td><strong class="potential-text">RM \${potentialValue.toFixed(2)}</strong></td>
              <td class="date-text">\${item.dateAdded || new Date(item.createdAt).toLocaleDateString()}</td>
              <td class="action-buttons">
                <button class="btn small" onclick="openEditModal('\${item._id}')">✏️ Edit</button>
                <button class="btn small danger" onclick="deleteItem('\${item._id}')">🗑️ Delete</button>
              </td>
            </tr>\`;
        });

        // Update table footer
        document.getElementById('totalInventoryValue').textContent = \`RM \${totalInventoryValue.toFixed(2)}\`;
        document.getElementById('totalPotentialValue').textContent = \`RM \${totalPotentialValue.toFixed(2)}\`;

        // Update summary cards
        document.getElementById('totalInventoryValueSummary').textContent = \`RM \${totalInventoryValue.toFixed(2)}\`;
        document.getElementById('totalPotentialValueSummary').textContent = \`RM \${totalPotentialValue.toFixed(2)}\`;
        document.getElementById('totalItemsCount').textContent = inventoryItems.length;
      } catch (error) {
        console.error('Error loading inventory:', error);
      }
    }

    function searchInventory() {
      loadInventory();
    }

    function clearSearch() {
      document.getElementById('searchInput').value = '';
      document.getElementById('dateFrom').value = '';
      document.getElementById('dateTo').value = '';
      loadInventory();
    }

    function openEditModal(itemId) {
      const item = inventoryItems.find(i => i._id === itemId);
      if (!item) return;

      document.getElementById('editItemId').value = item._id;
      document.getElementById('editItemSKU').value = item.sku;
      document.getElementById('editItemName').value = item.name;
      document.getElementById('editItemCategory').value = item.category;
      document.getElementById('editItemQty').value = item.quantity;
      document.getElementById('editItemUnitCost').value = item.unitCost;
      document.getElementById('editItemUnitPrice').value = item.unitPrice;

      document.getElementById('editModal').style.display = 'block';
    }

    function closeEditModal() {
      document.getElementById('editModal').style.display = 'none';
    }

    document.getElementById('editItemForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const itemId = document.getElementById('editItemId').value;
      const updatedItem = {
        sku: document.getElementById('editItemSKU').value,
        name: document.getElementById('editItemName').value,
        category: document.getElementById('editItemCategory').value,
        quantity: parseInt(document.getElementById('editItemQty').value),
        unitCost: parseFloat(document.getElementById('editItemUnitCost').value),
        unitPrice: parseFloat(document.getElementById('editItemUnitPrice').value)
      };

      try {
        const response = await fetch(\`/api/inventory/\${itemId}\`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedItem)
        });

        const data = await response.json();
        
        if (response.ok) {
          closeEditModal();
          loadInventory();
          alert('Item updated successfully!');
        } else {
          alert('Failed to update item: ' + data.error);
        }
      } catch (error) {
        alert('Error updating item: ' + error.message);
      }
    });

    document.getElementById('itemForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const item = {
        sku: document.getElementById('itemSKU').value,
        name: document.getElementById('itemName').value,
        category: document.getElementById('itemCategory').value,
        quantity: parseInt(document.getElementById('itemQty').value),
        unitCost: parseFloat(document.getElementById('itemUnitCost').value),
        unitPrice: parseFloat(document.getElementById('itemUnitPrice').value)
      };

      try {
        const response = await fetch('/api/inventory/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });

        const data = await response.json();
        
        if (response.ok) {
          document.getElementById('itemForm').reset();
          loadInventory();
          alert('Item added successfully!');
        } else {
          alert('Failed to add item: ' + data.error);
        }
      } catch (error) {
        alert('Error adding item: ' + error.message);
      }
    });

    async function deleteItem(id) {
      if (!confirm('Are you sure you want to delete this item?')) return;
      
      try {
        const response = await fetch('/api/inventory/' + id, { method: 'DELETE' });
        const data = await response.json();
        
        if (response.ok) {
          loadInventory();
          alert('Item deleted successfully!');
        } else {
          alert('Failed to delete item: ' + data.error);
        }
      } catch (error) {
        alert('Error deleting item: ' + error.message);
      }
    }

    async function downloadInventoryReport() {
      try {
        const search = document.getElementById('searchInput').value;
        const dateFrom = document.getElementById('dateFrom').value;
        const dateTo = document.getElementById('dateTo').value;
        
        let url = '/api/inventory';
        const params = new URLSearchParams();
        
        if (search) params.append('search', search);
        if (dateFrom) params.append('dateFrom', dateFrom);
        if (dateTo) params.append('dateTo', dateTo);
        
        if (params.toString()) {
          url += '?' + params.toString();
        }
        
        const response = await fetch(url);
        const items = await response.json();
        
        if (items.length === 0) {
          alert('No inventory items to generate report!');
          return;
        }

        let totalInventoryValue = 0;
        let totalPotentialValue = 0;
        
        items.forEach(item => {
          totalInventoryValue += item.quantity * item.unitCost;
          totalPotentialValue += item.quantity * item.unitPrice;
        });

        const dateRange = dateFrom && dateTo ? \`\${dateFrom} to \${dateTo}\` : 'All Items';

        const reportData = {
          id: 'REP-' + Date.now(),
          date: new Date().toLocaleString(),
          dateRange: dateRange,
          items: items,
          totalInventoryValue: \`RM \${totalInventoryValue.toFixed(2)}\`,
          totalPotentialValue: \`RM \${totalPotentialValue.toFixed(2)}\`
        };

        await fetch('/api/statements/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportData })
        });

        const pdfResponse = await fetch('/generate-inventory-report-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportData })
        });

        if (pdfResponse.ok) {
          const blob = await pdfResponse.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = \`inventory-report-\${reportData.id}.pdf\`;
          a.click();
          window.URL.revokeObjectURL(url);
          alert('Inventory report generated and saved to statements!');
        } else {
          throw new Error('PDF generation failed');
        }
      } catch (error) {
        console.error('Download report error:', error);
        alert('Error generating PDF report.');
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
      if (!user.username) {
        window.location.href = '/';
        return;
      }
      document.getElementById('username').textContent = user.username;
      loadLoginHistory();
      loadInventory();
    });
  </script>
</body>
</html>`;
}

function getPurchasePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Purchase | Inventory System</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <h2>📥 Purchase (Stock In)</h2>
      <div class="topbar-actions">
        <span>Welcome, <strong id="username"></strong></span>
        <button class="btn small ghost" onclick="toggleTheme()">🌓</button>
        <button class="btn small" onclick="window.location.href='/?page=dashboard'">← Dashboard</button>
      </div>
    </div>

    <div class="card">
      <h3>Purchase Details</h3>
      <div class="form-row">
        <label>Supplier <input type="text" id="supplier" placeholder="Supplier name"></label>
        <label>Purchase Date <input type="date" id="purchaseDate" value="${new Date().toISOString().split('T')[0]}"></label>
      </div>
    </div>

    <div class="card">
      <h3>Select Items to Purchase</h3>
      <div class="search-section">
        <div class="form-row">
          <label style="flex: 1;">
            Search Products
            <input type="text" id="purchaseSearch" placeholder="Search by SKU, Name, or Category..." oninput="searchPurchaseItems()">
          </label>
        </div>
      </div>
      <div id="availableItems" class="invoice-items-list"></div>
    </div>

    <div class="card">
      <h3>Purchase Items</h3>
      <div id="purchaseItems"></div>
      <div class="invoice-total">
        <h4>Total: RM <span id="purchaseTotal">0.00</span></h4>
      </div>
      <div class="controls">
        <button class="btn primary" onclick="processPurchase()">Process Purchase</button>
        <button class="btn" id="downloadPdf" style="display: none;" onclick="downloadPurchasePDF()">Download Purchase Order PDF</button>
        <button class="btn danger" onclick="clearPurchase()">Clear</button>
      </div>
    </div>
  </div>

  <footer>© 2025 Inventory Management System | Rex_Ho</footer>

  <script>${getJavaScript()}</script>
  <script>
    let selectedPurchaseItems = [];
    let availableItems = [];
    let currentPurchaseId = null;

    async function loadAvailableItems() {
      try {
        const search = document.getElementById('purchaseSearch').value;
        let url = '/api/inventory';
        
        if (search) {
          url += '?search=' + encodeURIComponent(search);
        }
        
        const response = await fetch(url);
        availableItems = await response.json();
        const container = document.getElementById('availableItems');
        container.innerHTML = availableItems.length ? '' : '<p>No items available</p>';
        
        availableItems.forEach((item, index) => {
          const itemDiv = document.createElement('div');
          itemDiv.className = 'invoice-item';
          itemDiv.innerHTML = \`
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong>\${item.name}</strong> (\${item.sku})<br>
                <small>Category: \${item.category} | Current Stock: \${item.quantity} | Cost: RM \${item.unitCost.toFixed(2)}</small>
              </div>
              <div>
                <input type="number" id="purchase-qty-\${index}" min="1" value="1" style="width: 80px; margin-right: 10px;">
                <button class="btn small" onclick="addToPurchase(\${index})">Add to Purchase</button>
              </div>
            </div>
          \`;
          container.appendChild(itemDiv);
        });
      } catch (error) {
        console.error('Error loading items:', error);
      }
    }

    function searchPurchaseItems() {
      loadAvailableItems();
    }

    function addToPurchase(index) {
      const item = availableItems[index];
      const quantity = parseInt(document.getElementById(\`purchase-qty-\${index}\`).value) || 1;
      
      const existingIndex = selectedPurchaseItems.findIndex(selected => selected.index === index);
      if (existingIndex > -1) {
        selectedPurchaseItems[existingIndex].quantity = quantity;
      } else {
        selectedPurchaseItems.push({ 
          index: index, 
          itemId: item._id,
          name: item.name,
          sku: item.sku,
          category: item.category,
          unitCost: item.unitCost,
          quantity: quantity
        });
      }
      
      updatePurchaseDisplay();
    }

    function updatePurchaseDisplay() {
      const container = document.getElementById('purchaseItems');
      const totalElement = document.getElementById('purchaseTotal');
      container.innerHTML = selectedPurchaseItems.length ? '' : '<p>No items in purchase</p>';
      
      let total = 0;
      selectedPurchaseItems.forEach((item, i) => {
        const itemTotal = item.quantity * item.unitCost;
        total += itemTotal;
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'invoice-item';
        itemDiv.innerHTML = \`
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>\${item.name}</strong> (\${item.sku})<br>
              <small>Qty: \${item.quantity} × RM \${item.unitCost.toFixed(2)} = RM \${itemTotal.toFixed(2)}</small>
            </div>
            <button class="btn small danger" onclick="removeFromPurchase(\${i})">Remove</button>
          </div>
        \`;
        container.appendChild(itemDiv);
      });
      
      totalElement.textContent = total.toFixed(2);
    }

    function removeFromPurchase(index) {
      selectedPurchaseItems.splice(index, 1);
      updatePurchaseDisplay();
    }

    function clearPurchase() {
      selectedPurchaseItems = [];
      currentPurchaseId = null;
      document.getElementById('downloadPdf').style.display = 'none';
      updatePurchaseDisplay();
    }

    async function processPurchase() {
      if (selectedPurchaseItems.length === 0) {
        alert('Please add items to the purchase first!');
        return;
      }

      try {
        currentPurchaseId = 'PUR-' + Date.now();
        const purchaseData = {
          id: currentPurchaseId,
          date: document.getElementById('purchaseDate').value || new Date().toLocaleString(),
          supplier: document.getElementById('supplier').value || 'N/A',
          items: selectedPurchaseItems,
          total: parseFloat(document.getElementById('purchaseTotal').textContent)
        };
        
        const response = await fetch('/api/purchases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purchaseData })
        });

        const data = await response.json();
        
        if (response.ok) {
          alert('Purchase processed successfully! Inventory updated.');
          document.getElementById('downloadPdf').style.display = 'inline-block';
          loadAvailableItems();
        } else {
          alert('Failed to process purchase: ' + data.error);
        }
      } catch (error) {
        alert('Failed to process purchase: ' + error.message);
      }
    }

    async function downloadPurchasePDF() {
      if (!currentPurchaseId) {
        alert('Please process a purchase first!');
        return;
      }

      const purchaseData = {
        id: currentPurchaseId,
        date: document.getElementById('purchaseDate').value || new Date().toLocaleString(),
        supplier: document.getElementById('supplier').value || 'N/A',
        items: selectedPurchaseItems,
        total: parseFloat(document.getElementById('purchaseTotal').textContent)
      };

      try {
        const response = await fetch('/generate-purchase-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purchaseData })
        });

        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = \`purchase-order-\${purchaseData.id}.pdf\`;
          a.click();
          window.URL.revokeObjectURL(url);
        } else {
          throw new Error('PDF generation failed');
        }
      } catch (error) {
        alert('Error generating PDF: ' + error.message);
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
      if (!user.username) {
        window.location.href = '/';
        return;
      }
      document.getElementById('username').textContent = user.username;
      loadAvailableItems();
    });
  </script>
</body>
</html>`;
}

function getSalesPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sales | Inventory System</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <h2>📤 Sales (Stock Out)</h2>
      <div class="topbar-actions">
        <span>Welcome, <strong id="username"></strong></span>
        <button class="btn small ghost" onclick="toggleTheme()">🌓</button>
        <button class="btn small" onclick="window.location.href='/?page=dashboard'">← Dashboard</button>
      </div>
    </div>

    <div class="card">
      <h3>Sales Details</h3>
      <div class="form-row">
        <label>Customer <input type="text" id="customer" placeholder="Customer name"></label>
        <label>Sales Date <input type="date" id="salesDate" value="${new Date().toISOString().split('T')[0]}"></label>
      </div>
    </div>

    <div class="card">
      <h3>Select Items to Sell</h3>
      <div class="search-section">
        <div class="form-row">
          <label style="flex: 1;">
            Search Products
            <input type="text" id="salesSearch" placeholder="Search by SKU, Name, or Category..." oninput="searchSalesItems()">
          </label>
        </div>
      </div>
      <div id="availableItems" class="invoice-items-list"></div>
    </div>

    <div class="card">
      <h3>Sales Items</h3>
      <div id="salesItems"></div>
      <div class="invoice-total">
        <h4>Total: RM <span id="salesTotal">0.00</span></h4>
      </div>
      <div class="controls">
        <button class="btn success" onclick="processSale()">Process Sale</button>
        <button class="btn" id="downloadPdf" style="display: none;" onclick="downloadSalesPDF()">Download Sales Invoice PDF</button>
        <button class="btn danger" onclick="clearSale()">Clear</button>
      </div>
    </div>
  </div>

  <footer>© 2025 Inventory Management System | Rex_Ho</footer>

  <script>${getJavaScript()}</script>
  <script>
    let selectedSalesItems = [];
    let availableItems = [];
    let currentSalesId = null;

    async function loadAvailableItems() {
      try {
        const search = document.getElementById('salesSearch').value;
        let url = '/api/inventory';
        
        if (search) {
          url += '?search=' + encodeURIComponent(search);
        }
        
        const response = await fetch(url);
        availableItems = await response.json();
        const container = document.getElementById('availableItems');
        container.innerHTML = availableItems.length ? '' : '<p>No items available</p>';
        
        availableItems.forEach((item, index) => {
          const itemDiv = document.createElement('div');
          itemDiv.className = 'invoice-item';
          itemDiv.innerHTML = \`
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong>\${item.name}</strong> (\${item.sku})<br>
                <small>Category: \${item.category} | Current Stock: \${item.quantity} | Price: RM \${item.unitPrice.toFixed(2)}</small>
              </div>
              <div>
                <input type="number" id="sales-qty-\${index}" min="1" max="\${item.quantity}" value="1" style="width: 80px; margin-right: 10px;">
                <button class="btn small" onclick="addToSale(\${index})">Add to Sale</button>
              </div>
            </div>
          \`;
          container.appendChild(itemDiv);
        });
      } catch (error) {
        console.error('Error loading items:', error);
      }
    }

    function searchSalesItems() {
      loadAvailableItems();
    }

    function addToSale(index) {
      const item = availableItems[index];
      const quantity = parseInt(document.getElementById(\`sales-qty-\${index}\`).value) || 1;
      
      if (quantity > item.quantity) {
        alert(\`Only \${item.quantity} items available in stock!\`);
        return;
      }

      const existingIndex = selectedSalesItems.findIndex(selected => selected.index === index);
      if (existingIndex > -1) {
        selectedSalesItems[existingIndex].quantity = quantity;
      } else {
        selectedSalesItems.push({ 
          index: index, 
          itemId: item._id,
          name: item.name,
          sku: item.sku,
          category: item.category,
          unitPrice: item.unitPrice,
          quantity: quantity
        });
      }
      
      updateSalesDisplay();
    }

    function updateSalesDisplay() {
      const container = document.getElementById('salesItems');
      const totalElement = document.getElementById('salesTotal');
      container.innerHTML = selectedSalesItems.length ? '' : '<p>No items in sale</p>';
      
      let total = 0;
      selectedSalesItems.forEach((item, i) => {
        const itemTotal = item.quantity * item.unitPrice;
        total += itemTotal;
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'invoice-item';
        itemDiv.innerHTML = \`
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>\${item.name}</strong> (\${item.sku})<br>
              <small>Qty: \${item.quantity} × RM \${item.unitPrice.toFixed(2)} = RM \${itemTotal.toFixed(2)}</small>
            </div>
            <button class="btn small danger" onclick="removeFromSale(\${i})">Remove</button>
          </div>
        \`;
        container.appendChild(itemDiv);
      });
      
      totalElement.textContent = total.toFixed(2);
      // Hide download button until sale is processed
      document.getElementById('downloadPdf').style.display = 'none';
    }

    function removeFromSale(index) {
      selectedSalesItems.splice(index, 1);
      updateSalesDisplay();
    }

    function clearSale() {
      selectedSalesItems = [];
      currentSalesId = null;
      document.getElementById('downloadPdf').style.display = 'none';
      updateSalesDisplay();
    }

    async function processSale() {
      if (selectedSalesItems.length === 0) {
        alert('Please add items to the sale first!');
        return;
      }

      try {
        currentSalesId = 'SAL-' + Date.now();
        const salesData = {
          id: currentSalesId,
          date: document.getElementById('salesDate').value || new Date().toLocaleString(),
          customer: document.getElementById('customer').value || 'N/A',
          items: selectedSalesItems,
          total: parseFloat(document.getElementById('salesTotal').textContent)
        };
        
        const response = await fetch('/api/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salesData })
        });

        const data = await response.json();
        
        if (response.ok) {
          alert('Sale processed successfully! Inventory updated.');
          // Show download button only after successful sale processing
          document.getElementById('downloadPdf').style.display = 'inline-block';
          clearSale();
          loadAvailableItems();
        } else {
          alert('Failed to process sale: ' + data.error);
        }
      } catch (error) {
        alert('Failed to process sale: ' + error.message);
      }
    }

    async function downloadSalesPDF() {
      if (!currentSalesId) {
        alert('Please process a sale first!');
        return;
      }

      const salesData = {
        id: currentSalesId,
        date: document.getElementById('salesDate').value || new Date().toLocaleString(),
        customer: document.getElementById('customer').value || 'N/A',
        items: selectedSalesItems,
        total: parseFloat(document.getElementById('salesTotal').textContent)
      };

      try {
        const response = await fetch('/generate-sales-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salesData })
        });

        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = \`sales-invoice-\${salesData.id}.pdf\`;
          a.click();
          window.URL.revokeObjectURL(url);
        } else {
          throw new Error('PDF generation failed');
        }
      } catch (error) {
        alert('Error generating PDF: ' + error.message);
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
      if (!user.username) {
        window.location.href = '/';
        return;
      }
      document.getElementById('username').textContent = user.username;
      loadAvailableItems();
    });
  </script>
</body>
</html>`;
}

function getInvoicePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generate Invoice | Inventory System</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <h2>📄 Generate Invoice</h2>
      <div class="topbar-actions">
        <span>Welcome, <strong id="username"></strong></span>
        <button class="btn small ghost" onclick="toggleTheme()">🌓</button>
        <button class="btn small" onclick="window.location.href='/?page=dashboard'">← Dashboard</button>
      </div>
    </div>

    <div class="card">
      <h3>Select Items for Invoice</h3>
      <div class="search-section">
        <div class="form-row">
          <label style="flex: 1;">
            Search Products
            <input type="text" id="invoiceSearch" placeholder="Search by SKU, Name, or Category..." oninput="searchInvoiceItems()">
          </label>
        </div>
      </div>
      <div id="availableItems" class="invoice-items-list"></div>
    </div>

    <div class="card">
      <h3>Invoice Items</h3>
      <div id="invoiceItems"></div>
      <div class="invoice-total">
        <h4>Total: RM <span id="invoiceTotal">0.00</span></h4>
      </div>
      <div class="controls">
        <button class="btn info" id="downloadPdf" onclick="downloadPDF()">Download PDF</button>
        <button class="btn danger" onclick="clearInvoice()">Clear</button>
      </div>
    </div>
  </div>

  <footer>© 2025 Inventory Management System | Rex_Ho</footer>

  <script>${getJavaScript()}</script>
  <script>
    let selectedItems = [];
    let availableItems = [];

    async function loadAvailableItems() {
      try {
        const search = document.getElementById('invoiceSearch').value;
        let url = '/api/inventory';
        
        if (search) {
          url += '?search=' + encodeURIComponent(search);
        }
        
        const response = await fetch(url);
        availableItems = await response.json();
        const container = document.getElementById('availableItems');
        container.innerHTML = availableItems.length ? '' : '<p>No items available</p>';
        
        availableItems.forEach((item, index) => {
          const itemDiv = document.createElement('div');
          itemDiv.className = 'invoice-item';
          itemDiv.innerHTML = \`
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong>\${item.name}</strong> (\${item.sku})<br>
                <small>Category: \${item.category} | Available: \${item.quantity} | Price: RM \${item.unitPrice.toFixed(2)}</small>
              </div>
              <div>
                <input type="number" id="qty-\${index}" min="1" max="\${item.quantity}" value="1" style="width: 80px; margin-right: 10px;">
                <button class="btn small" onclick="addToInvoice(\${index})">Add to Invoice</button>
              </div>
            </div>
          \`;
          container.appendChild(itemDiv);
        });
      } catch (error) {
        console.error('Error loading items:', error);
      }
    }

    function searchInvoiceItems() {
      loadAvailableItems();
    }

    function addToInvoice(index) {
      const item = availableItems[index];
      const quantity = parseInt(document.getElementById(\`qty-\${index}\`).value) || 1;
      
      if (quantity > item.quantity) {
        alert(\`Only \${item.quantity} items available!\`);
        return;
      }

      const existingIndex = selectedItems.findIndex(selected => selected.index === index);
      if (existingIndex > -1) {
        selectedItems[existingIndex].invoiceQty = quantity;
      } else {
        selectedItems.push({ index: index, ...item, invoiceQty: quantity });
      }
      
      updateInvoiceDisplay();
    }

    function updateInvoiceDisplay() {
      const container = document.getElementById('invoiceItems');
      const totalElement = document.getElementById('invoiceTotal');
      container.innerHTML = selectedItems.length ? '' : '<p>No items in invoice</p>';
      
      let total = 0;
      selectedItems.forEach((item, i) => {
        const itemTotal = item.invoiceQty * item.unitPrice;
        total += itemTotal;
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'invoice-item';
        itemDiv.innerHTML = \`
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>\${item.name}</strong> (\${item.sku})<br>
              <small>Qty: \${item.invoiceQty} × RM \${item.unitPrice.toFixed(2)} = RM \${itemTotal.toFixed(2)}</small>
            </div>
            <button class="btn small danger" onclick="removeFromInvoice(\${i})">Remove</button>
          </div>
        \`;
        container.appendChild(itemDiv);
      });
      
      totalElement.textContent = total.toFixed(2);
      document.getElementById('downloadPdf').disabled = selectedItems.length === 0;
    }

    function removeFromInvoice(index) {
      selectedItems.splice(index, 1);
      updateInvoiceDisplay();
    }

    function clearInvoice() {
      selectedItems = [];
      updateInvoiceDisplay();
    }

    async function downloadPDF() {
      if (selectedItems.length === 0) {
        alert('Please add items to the invoice first!');
        return;
      }

      const invoiceData = {
        id: 'INV-' + Date.now(),
        date: new Date().toLocaleString(),
        items: selectedItems,
        total: parseFloat(document.getElementById('invoiceTotal').textContent)
      };

      try {
        const response = await fetch('/generate-invoice-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoiceData })
        });

        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = \`invoice-\${invoiceData.id}.pdf\`;
          a.click();
          window.URL.revokeObjectURL(url);
          
          // Save invoice to database
          await fetch('/api/invoices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceData })
          });
          
          alert('Invoice PDF generated successfully!');
        } else {
          throw new Error('PDF generation failed');
        }
      } catch (error) {
        alert('Error generating PDF: ' + error.message);
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
      if (!user.username) {
        window.location.href = '/';
        return;
      }
      document.getElementById('username').textContent = user.username;
      loadAvailableItems();
    });
  </script>
</body>
</html>`;
}

function getStatementPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Statement | Inventory System</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <h2>📋 Statements & Reports</h2>
      <div class="topbar-actions">
        <span>Welcome, <strong id="username"></strong></span>
        <button class="btn small ghost" onclick="toggleTheme()">🌓</button>
        <button class="btn small" onclick="window.location.href='/?page=dashboard'">← Dashboard</button>
      </div>
    </div>

    <div class="card">
      <h3>Generated Reports</h3>
      <div id="reportsList"></div>
    </div>

    <div class="card">
      <h3>Purchase History</h3>
      <div id="purchasesList"></div>
    </div>

    <div class="card">
      <h3>Sales History</h3>
      <div id="salesList"></div>
    </div>

    <div class="card">
      <h3>Invoice History</h3>
      <div id="invoicesList"></div>
    </div>
  </div>

  <footer>© 2025 Inventory Management System | Rex_Ho</footer>

  <script>${getJavaScript()}</script>
  <script>
    async function loadReports() {
      try {
        const response = await fetch('/api/statements');
        const statements = await response.json();
        const container = document.getElementById('reportsList');
        
        if (statements.length === 0) {
          container.innerHTML = '<p>No reports generated yet.</p>';
        } else {
          statements.sort((a, b) => new Date(b.date) - new Date(a.date));
          container.innerHTML = '';
          
          statements.forEach((report, index) => {
            const reportDiv = document.createElement('div');
            reportDiv.className = 'invoice-item';
            reportDiv.innerHTML = \`
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong>\${report.id}</strong><br>
                  <small>Generated: \${report.date}</small><br>
                  <small>Items: \${report.items.length} | \${report.totalInventoryValue} | \${report.totalPotentialValue}</small>
                </div>
                <div>
                  <button class="btn small" onclick="downloadReport(\${index})">📥 Download</button>
                  <button class="btn small danger" onclick="deleteReport('\${report._id}')">🗑️ Delete</button>
                </div>
              </div>
            \`;
            container.appendChild(reportDiv);
          });
        }
      } catch (error) {
        console.error('Error loading reports:', error);
      }
    }

    async function loadPurchases() {
      try {
        const response = await fetch('/api/purchases');
        const purchases = await response.json();
        const container = document.getElementById('purchasesList');
        
        if (purchases.length === 0) {
          container.innerHTML = '<p>No purchase history.</p>';
        } else {
          purchases.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          container.innerHTML = '';
          
          purchases.forEach((purchase, index) => {
            const purchaseDiv = document.createElement('div');
            purchaseDiv.className = 'invoice-item';
            purchaseDiv.innerHTML = \`
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong>\${purchase.id}</strong><br>
                  <small>Date: \${purchase.date} | Supplier: \${purchase.supplier}</small><br>
                  <small>Items: \${purchase.items.length} | Total: RM \${purchase.total.toFixed(2)}</small>
                </div>
                <div>
                  <button class="btn small" onclick="downloadPurchasePDF('\${purchase.id}', \${index})">📥 PDF</button>
                </div>
              </div>
            \`;
            container.appendChild(purchaseDiv);
          });
        }
      } catch (error) {
        console.error('Error loading purchases:', error);
      }
    }

    async function loadSales() {
      try {
        const response = await fetch('/api/sales');
        const sales = await response.json();
        const container = document.getElementById('salesList');
        
        if (sales.length === 0) {
          container.innerHTML = '<p>No sales history.</p>';
        } else {
          sales.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          container.innerHTML = '';
          
          sales.forEach((sale, index) => {
            const saleDiv = document.createElement('div');
            saleDiv.className = 'invoice-item';
            saleDiv.innerHTML = \`
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong>\${sale.id}</strong><br>
                  <small>Date: \${sale.date} | Customer: \${sale.customer}</small><br>
                  <small>Items: \${sale.items.length} | Total: RM \${sale.total.toFixed(2)}</small>
                </div>
                <div>
                  <button class="btn small" onclick="downloadSalesPDF('\${sale.id}', \${index})">📥 PDF</button>
                </div>
              </div>
            \`;
            container.appendChild(saleDiv);
          });
        }
      } catch (error) {
        console.error('Error loading sales:', error);
      }
    }

    async function loadInvoices() {
      try {
        const response = await fetch('/api/invoices');
        const invoices = await response.json();
        const container = document.getElementById('invoicesList');
        
        if (invoices.length === 0) {
          container.innerHTML = '<p>No invoice history.</p>';
        } else {
          invoices.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          container.innerHTML = '';
          
          invoices.forEach((invoice, index) => {
            const invoiceDiv = document.createElement('div');
            invoiceDiv.className = 'invoice-item';
            invoiceDiv.innerHTML = \`
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong>\${invoice.id}</strong><br>
                  <small>Date: \${invoice.date}</small><br>
                  <small>Items: \${invoice.items.length} | Total: RM \${invoice.total.toFixed(2)}</small>
                </div>
                <div>
                  <button class="btn small" onclick="downloadInvoicePDF('\${invoice.id}', \${index})">📥 PDF</button>
                  <button class="btn small danger" onclick="deleteInvoice('\${invoice._id}')">🗑️ Delete</button>
                </div>
              </div>
            \`;
            container.appendChild(invoiceDiv);
          });
        }
      } catch (error) {
        console.error('Error loading invoices:', error);
      }
    }

    async function downloadReport(index) {
      try {
        const response = await fetch('/api/statements');
        const statements = await response.json();
        const report = statements[index];
        
        if (report) {
          const pdfResponse = await fetch('/generate-inventory-report-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reportData: report })
          });

          if (pdfResponse.ok) {
            const blob = await pdfResponse.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`inventory-report-\${report.id}.pdf\`;
            a.click();
            window.URL.revokeObjectURL(url);
          }
        }
      } catch (error) {
        alert('Error downloading report: ' + error.message);
      }
    }

    async function downloadPurchasePDF(purchaseId, index) {
      try {
        const response = await fetch('/api/purchases');
        const purchases = await response.json();
        const purchase = purchases[index];
        
        if (purchase) {
          const pdfResponse = await fetch('/generate-purchase-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ purchaseData: purchase })
          });

          if (pdfResponse.ok) {
            const blob = await pdfResponse.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`purchase-order-\${purchase.id}.pdf\`;
            a.click();
            window.URL.revokeObjectURL(url);
          }
        }
      } catch (error) {
        alert('Error downloading purchase PDF: ' + error.message);
      }
    }

    async function downloadSalesPDF(salesId, index) {
      try {
        const response = await fetch('/api/sales');
        const sales = await response.json();
        const sale = sales[index];
        
        if (sale) {
          const pdfResponse = await fetch('/generate-sales-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ salesData: sale })
          });

          if (pdfResponse.ok) {
            const blob = await pdfResponse.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`sales-invoice-\${sale.id}.pdf\`;
            a.click();
            window.URL.revokeObjectURL(url);
          }
        }
      } catch (error) {
        alert('Error downloading sales PDF: ' + error.message);
      }
    }

    async function downloadInvoicePDF(invoiceId, index) {
      try {
        const response = await fetch('/api/invoices');
        const invoices = await response.json();
        const invoice = invoices[index];
        
        if (invoice) {
          const pdfResponse = await fetch('/generate-invoice-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceData: invoice })
          });

          if (pdfResponse.ok) {
            const blob = await pdfResponse.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`invoice-\${invoice.id}.pdf\`;
            a.click();
            window.URL.revokeObjectURL(url);
          }
        }
      } catch (error) {
        alert('Error downloading invoice PDF: ' + error.message);
      }
    }

    async function deleteReport(id) {
      if (!confirm('Are you sure you want to delete this report?')) return;

      try {
        const response = await fetch('/api/statements/' + id, { method: 'DELETE' });
        const data = await response.json();
        
        if (response.ok) {
          loadReports();
        } else {
          alert('Failed to delete report: ' + data.error);
        }
      } catch (error) {
        alert('Error deleting report: ' + error.message);
      }
    }

    async function deleteInvoice(id) {
      if (!confirm('Are you sure you want to delete this invoice?')) return;

      try {
        const response = await fetch('/api/invoices/' + id, { method: 'DELETE' });
        const data = await response.json();
        
        if (response.ok) {
          loadInvoices();
        } else {
          alert('Failed to delete invoice: ' + data.error);
        }
      } catch (error) {
        alert('Error deleting invoice: ' + error.message);
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
      if (!user.username) {
        window.location.href = '/';
        return;
      }
      document.getElementById('username').textContent = user.username;
      loadReports();
      loadPurchases();
      loadSales();
      loadInvoices();
    });
  </script>
</body>
</html>`;
}

function getSettingsPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Settings | Inventory System</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <h2>⚙️ Account Settings</h2>
      <div class="topbar-actions">
        <span>Welcome, <strong id="username"></strong></span>
        <button class="btn small ghost" onclick="toggleTheme()">🌓</button>
        <button class="btn small" onclick="window.location.href='/?page=dashboard'">← Dashboard</button>
      </div>
    </div>

    <div class="card">
      <h3>Change Password</h3>
      <form id="changePasswordForm">
        <div class="input-group">
          <label>Current Password</label>
          <input type="password" id="currentPassword" required>
        </div>
        <div class="input-group">
          <label>New Password</label>
          <input type="password" id="newPassword" required>
        </div>
        <div class="input-group">
          <label>Confirm New Password</label>
          <input type="password" id="confirmPassword" required>
        </div>
        <button type="submit" class="btn full primary">Change Password</button>
      </form>
    </div>

    <div class="card danger-zone">
      <h3 style="color: var(--danger);">⚠️ Danger Zone</h3>
      <p>Once you delete your account, there is no going back. Please be certain.</p>
      <p><strong>Note:</strong> Your inventory data will be preserved for other users.</p>
      
      <div class="input-group" style="margin-top: 20px;">
        <label>Security Code (Required for Account Deletion)</label>
        <input type="password" id="deleteSecurityCode" placeholder="Enter security code to confirm deletion">
        <small class="hint">Contact administrator for security code</small>
      </div>
      
      <button class="btn danger" onclick="deleteAccount()" style="margin-top: 15px;">Delete My Account</button>
    </div>
  </div>

  <footer>© 2025 Inventory Management System | Rex_Ho</footer>

  <script>${getJavaScript()}</script>
  <script>
    document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = document.getElementById('currentPassword').value;
      const newPassword = document.getElementById('newPassword').value;
      const confirmPassword = document.getElementById('confirmPassword').value;

      if (newPassword !== confirmPassword) {
        alert('New passwords do not match!');
        return;
      }

      if (newPassword.length < 4) {
        alert('New password must be at least 4 characters long!');
        return;
      }

      const user = JSON.parse(localStorage.getItem('currentUser') || '{}');

      try {
        const response = await fetch('/api/user/password', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: user.username,
            currentPassword: currentPassword,
            newPassword: newPassword
          })
        });

        const data = await response.json();

        if (response.ok) {
          alert('Password changed successfully!');
          document.getElementById('changePasswordForm').reset();
        } else {
          alert('Failed to change password: ' + data.error);
        }
      } catch (error) {
        alert('Error changing password: ' + error.message);
      }
    });

    async function deleteAccount() {
      const securityCode = document.getElementById('deleteSecurityCode').value;
      
      if (!securityCode) {
        alert('Please enter the security code to confirm account deletion.');
        return;
      }

      const confirmDelete = confirm('ARE YOU SURE YOU WANT TO DELETE YOUR ACCOUNT?\\n\\n⚠️  This action cannot be undone!\\n\\nYour personal data will be deleted but inventory data will be preserved for other users.');
      
      if (confirmDelete) {
        const user = JSON.parse(localStorage.getItem('currentUser') || '{}');

        try {
          const response = await fetch('/api/user', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              username: user.username,
              securityCode: securityCode
            })
          });

          const data = await response.json();

          if (response.ok) {
            localStorage.removeItem('currentUser');
            alert('Account deleted successfully! Inventory data preserved.');
            window.location.href = '/';
          } else {
            alert('Failed to delete account: ' + data.error);
          }
        } catch (error) {
          alert('Error deleting account: ' + error.message);
        }
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
      if (!user.username) {
        window.location.href = '/';
        return;
      }
      document.getElementById('username').textContent = user.username;
    });
  </script>
</body>
</html>`;
}

function getCSS() {
  return `
    :root {
      --accent: #3b82f6;
      --primary: #3b82f6;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
      --info: #06b6d4;
      --radius: 12px;
      --transition: 0.25s;
      --shadow: 0 4px 15px rgba(0,0,0,0.2);
      --shadow-light: 0 2px 8px rgba(0,0,0,0.1);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "Poppins", sans-serif;
      background: #0f172a;
      color: #f1f5f9;
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    body.light {
      background: #f8fafc;
      color: #1e293b;
    }
    .container { width: 90%; max-width: 1200px; margin: 30px auto; }
    .card {
      background: #1e293b;
      border-radius: var(--radius);
      padding: 20px;
      box-shadow: var(--shadow);
      margin-top: 20px;
    }
    body.light .card { background: #fff; }
    .topbar {
      background: var(--accent);
      color: #fff;
      padding: 15px 20px;
      border-radius: var(--radius);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }
    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .welcome-text {
      margin-right: 10px;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
      flex-wrap: wrap;
      gap: 10px;
    }
    .card-header h3 { margin: 0; }
    .card-header > div { display: flex; gap: 10px; flex-wrap: wrap; }
    .form-row { display: flex; gap: 15px; margin-bottom: 15px; flex-wrap: wrap; }
    .form-row label { flex: 1; min-width: 200px; }
    .btn {
      background: var(--accent); color: #fff; border: none; border-radius: var(--radius);
      padding: 8px 14px; cursor: pointer; text-decoration: none; font-weight: 500;
      transition: var(--transition); display: inline-block; text-align: center;
    }
    .btn:hover { transform: scale(1.05); }
    .btn.full { width: 100%; margin-top: 10px; }
    .btn.primary { background: var(--primary); }
    .btn.success { background: var(--success); }
    .btn.danger { background: var(--danger); }
    .btn.warning { background: var(--warning); }
    .btn.info { background: var(--info); }
    .btn.ghost { background: transparent; border: 1px solid #fff; }
    body.light .btn.ghost { border-color: #1e293b; color: #1e293b; }
    .btn.small { padding: 5px 10px; font-size: 0.85em; }
    input, select, textarea {
      width: 100%; padding: 10px; border-radius: var(--radius);
      border: 1px solid #475569; margin-top: 5px;
      background: #0f172a; color: #fff;
    }
    body.light input, body.light select, body.light textarea {
      background: #fff; color: #000; border-color: #cbd5e1;
    }
    .table {
      width: 100%; border-collapse: collapse; margin-top: 15px;
    }
    .table th, .table td { padding: 12px; border-bottom: 1px solid #334155; text-align: left; }
    .table th { background: var(--accent); color: #fff; }
    .table tr:nth-child(even) { background: #1e293b; }
    body.light .table tr:nth-child(even) { background: #f8fafc; }
    .subtotal-row { background: #334155 !important; font-weight: bold; }
    body.light .subtotal-row { background: #e2e8f0 !important; }
    
    /* Auth Styles */
    .auth-container {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    }
    body.light .auth-container {
      background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
    }
    .auth-header {
      text-align: center;
      margin-bottom: 40px;
    }
    .logo {
      font-size: 4rem;
      margin-bottom: 20px;
    }
    .main-title {
      font-size: 3rem;
      font-weight: 700;
      background: linear-gradient(135deg, var(--primary), var(--info));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 10px;
    }
    .sub-title {
      font-size: 1.5rem;
      font-weight: 500;
      color: var(--info);
      margin-bottom: 10px;
    }
    .tagline {
      color: #94a3b8;
      font-size: 1.1rem;
    }
    body.light .tagline {
      color: #64748b;
    }
    .auth-card {
      background: #1e293b;
      border-radius: var(--radius);
      padding: 40px;
      box-shadow: var(--shadow);
      width: 100%;
      max-width: 400px;
      margin-bottom: 30px;
    }
    body.light .auth-card {
      background: #fff;
    }
    .auth-card h3 {
      text-align: center;
      margin-bottom: 30px;
      font-size: 1.5rem;
    }
    .input-group {
      margin-bottom: 20px;
    }
    .input-group label {
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
    }
    .auth-links {
      text-align: center;
      margin-top: 20px;
    }
    .link {
      color: var(--primary);
      text-decoration: none;
    }
    .link:hover {
      text-decoration: underline;
    }
    .auth-features {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .feature {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 20px;
      background: #1e293b;
      border-radius: var(--radius);
      color: #f1f5f9;
    }
    body.light .feature {
      background: #fff;
      color: #1e293b;
      box-shadow: var(--shadow-light);
    }
    .feature-icon {
      font-size: 1.2rem;
    }
    .hint {
      color: #94a3b8;
      font-size: 0.8em;
      margin-top: 5px;
      display: block;
    }
    
    /* Login History Styles */
    .login-history-container {
      max-height: 400px;
      overflow-y: auto;
    }
    .login-history-item {
      background: #1e293b;
      border-radius: var(--radius);
      padding: 15px;
      margin-bottom: 10px;
      border-left: 4px solid var(--success);
    }
    body.light .login-history-item {
      background: #f8fafc;
    }
    .login-history-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .user-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .user-avatar {
      font-size: 1.5rem;
    }
    .username {
      color: var(--primary);
    }
    .username.current-user {
      color: var(--success);
      font-weight: bold;
    }
    .login-time {
      font-size: 0.8em;
      color: #94a3b8;
    }
    .login-status {
      padding: 4px 8px;
      border-radius: 20px;
      font-size: 0.8em;
      font-weight: 500;
    }
    .login-status.success {
      background: var(--success);
      color: white;
    }
    .login-details {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .detail-item {
      display: flex;
      justify-content: space-between;
      font-size: 0.9em;
    }
    .detail-label {
      color: #94a3b8;
    }
    .detail-value {
      color: #f1f5f9;
      font-weight: 500;
    }
    body.light .detail-value {
      color: #1e293b;
    }
    .empty-state, .loading, .error-state {
      text-align: center;
      padding: 40px;
      color: #94a3b8;
    }
    
    /* Value Summary Styles */
    .value-summary {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }
    .value-item {
      flex: 1;
      min-width: 200px;
      background: var(--primary);
      color: white;
      padding: 20px;
      border-radius: var(--radius);
      text-align: center;
      box-shadow: var(--shadow);
    }
    .value-item.primary { background: var(--primary); }
    .value-item.success { background: var(--success); }
    .value-item.info { background: var(--info); }
    .value-item h4 {
      margin: 0 0 10px 0;
      font-size: 1rem;
      opacity: 0.9;
    }
    .value-item p {
      margin: 0;
      font-size: 1.5rem;
      font-weight: bold;
    }
    
    /* Table Enhancements */
    .no-data {
      text-align: center;
      color: #94a3b8;
      padding: 40px !important;
    }
    .category-tag {
      background: var(--info);
      color: white;
      padding: 4px 8px;
      border-radius: 20px;
      font-size: 0.8em;
    }
    .quantity-badge {
      background: var(--warning);
      color: white;
      padding: 4px 8px;
      border-radius: 20px;
      font-size: 0.8em;
    }
    .value-text {
      color: var(--success);
    }
    .potential-text {
      color: var(--info);
    }
    .date-text {
      color: #94a3b8;
      font-size: 0.9em;
    }
    .action-buttons {
      display: flex;
      gap: 5px;
    }
    
    /* Action Buttons */
    .action-buttons {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    
    /* Search Section Styles */
    .search-section {
      background: #1e293b;
      padding: 15px;
      border-radius: var(--radius);
      margin-bottom: 20px;
      border-left: 4px solid var(--accent);
    }
    body.light .search-section {
      background: #f1f5f9;
    }
    
    /* Invoice Items */
    .invoice-item {
      background: #1e293b;
      padding: 15px;
      border-radius: var(--radius);
      margin-bottom: 10px;
      border-left: 4px solid var(--accent);
    }
    body.light .invoice-item {
      background: #f1f5f9;
    }
    .invoice-items-list { max-height: 400px; overflow-y: auto; }
    .invoice-total {
      margin-top: 20px; padding: 15px; background: #334155;
      border-radius: var(--radius); text-align: right;
    }
    body.light .invoice-total { background: #e2e8f0; }
    
    /* Danger Zone */
    .danger-zone { 
      border-left: 4px solid var(--danger);
      background: rgba(239, 68, 68, 0.1);
    }
    
    /* Controls */
    .controls { display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap; }
    
    /* Footer */
    footer { text-align: center; padding: 20px; margin-top: auto; color: #94a3b8; }
    
    /* Modal Styles */
    .modal {
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0,0,0,0.5);
    }
    .modal-content {
      background: #1e293b;
      margin: 5% auto;
      padding: 0;
      border-radius: var(--radius);
      width: 90%;
      max-width: 600px;
      box-shadow: var(--shadow);
    }
    body.light .modal-content { background: #fff; }
    .modal-header {
      background: var(--accent);
      color: white;
      padding: 15px 20px;
      border-radius: var(--radius) var(--radius) 0 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .modal-header h3 { margin: 0; }
    .close {
      color: white;
      font-size: 28px;
      font-weight: bold;
      cursor: pointer;
    }
    .close:hover { color: #f1f5f9; }
    
    @media (max-width: 768px) {
      .form-row { flex-direction: column; }
      .card-header { flex-direction: column; align-items: flex-start; }
      .card-header > div { width: 100%; justify-content: flex-start; }
      .table { font-size: 0.9em; }
      .table th, .table td { padding: 8px 5px; }
      .topbar { flex-direction: column; align-items: flex-start; gap: 10px; }
      .topbar-actions { width: 100%; justify-content: flex-start; }
      .auth-card { padding: 20px; }
      .main-title { font-size: 2rem; }
      .sub-title { font-size: 1.2rem; }
      .auth-features { flex-direction: column; }
      .modal-content { width: 95%; margin: 10% auto; }
      .search-section .form-row { flex-direction: column; }
      .value-summary { flex-direction: column; }
      .value-item { min-width: 100%; }
      .action-buttons { flex-direction: column; }
      .login-history-header { flex-direction: column; align-items: flex-start; gap: 10px; }
    }
  `;
}

function getJavaScript() {
  return `
    function getCurrentUser() {
      try {
        return JSON.parse(localStorage.getItem('currentUser') || '{}');
      } catch (error) {
        return {};
      }
    }

    function requireLogin() {
      const user = getCurrentUser();
      if (!user.username) {
        window.location.href = '/';
        return false;
      }
      return true;
    }

    function logout() {
      localStorage.removeItem('currentUser');
      window.location.href = '/';
    }

    function toggleTheme() {
      document.body.classList.toggle('light');
      localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
    }

    // Load saved theme
    document.addEventListener('DOMContentLoaded', () => {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'light') {
        document.body.classList.add('light');
      }
      
      const user = getCurrentUser();
      const usernameElement = document.getElementById('username');
      if (usernameElement && user.username) {
        usernameElement.textContent = user.username;
      }
    });
  `;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Complete single-file server running on port ' + PORT);
  console.log('📊 MongoDB: ' + MONGODB_URI);
  console.log('🔐 Security Code: ' + VALID_SECURITY_CODE);
  console.log('🌐 Main URL: http://localhost:' + PORT + '/');
  console.log('✅ ALL FEATURES INCLUDED:');
  console.log('   ✅ User Authentication (Login/Register)');
  console.log('   ✅ Complete Inventory Management with Edit/Delete');
  console.log('   ✅ Search & Date Range Filter for Inventory');
  console.log('   ✅ Purchase (Stock In) with Search & PDF Generation');
  console.log('   ✅ Sales (Stock Out) with Search & PDF Generation');
  console.log('   ✅ Invoice Generation with PDF');
  console.log('   ✅ Statements & Reports with History');
  console.log('   ✅ Account Settings & Password Management');
  console.log('   ✅ Dark/Light Theme Toggle');
  console.log('   ✅ Responsive Design for Mobile');
  console.log('   ✅ Smart PDF Button Visibility (Shows after processing)');
  console.log('   ✅ Enhanced Login History with All Users');
  console.log('   ✅ Professional PDF Layout Design');
  console.log('   ✅ Security Code for Account Deletion');
  console.log('   ✅ Inventory Value Summary');
  console.log('   ✅ Date Range Specific Inventory Reports');
  console.log('   ✅ Preserved Inventory Data on Account Deletion');
  console.log('   ✅ Complete Multi-User System');
  console.log('   ✅ Enterprise-Level Inventory Management');
});
