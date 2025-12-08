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
    case 'reference':
      htmlContent = getReferencePage();
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

// Counter for sequential numbers
async function getNextSequence(collectionName) {
  try {
    const counters = db.collection('counters');
    
    const result = await counters.findOneAndUpdate(
      { _id: collectionName },
      { $inc: { sequence_value: 1 } },
      { 
        upsert: true,
        returnDocument: 'after'
      }
    );
    
    return result.value ? result.value.sequence_value.toString().padStart(13, '0') : '1'.padStart(13, '0');
  } catch (error) {
    console.error('Error getting sequence:', error);
    return Date.now().toString().slice(-13).padStart(13, '0');
  }
}

// Initialize MongoDB
async function connectDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('inventory_system');
    console.log('✅ Connected to MongoDB');
    
    // Create collections if they don't exist
    const collections = ['users', 'inventory', 'statements', 'reference_reports', 'purchases', 'sales', 'login_history', 'counters'];
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
    
    // Initialize counters
    await initializeCounters();
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
  }
}

async function initializeCounters() {
  try {
    const counters = db.collection('counters');
    await counters.updateOne({ _id: 'reference_reports' }, { $setOnInsert: { sequence_value: 1 } }, { upsert: true });
    await counters.updateOne({ _id: 'purchases' }, { $setOnInsert: { sequence_value: 1 } }, { upsert: true });
    await counters.updateOne({ _id: 'sales' }, { $setOnInsert: { sequence_value: 1 } }, { upsert: true });
    console.log('✅ Counters initialized');
  } catch (error) {
    console.error('Error initializing counters:', error);
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

app.get('/api/login-history', async (req, res) => {
  try {
    const user = JSON.parse(req.headers.user || '{}');
    if (!user.username) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

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

// ==========================================
// REFACTORED INVENTORY APIs (NEW SCHEMA)
// ==========================================

app.get('/api/inventory', async (req, res) => {
  try {
    const { search, dateFrom, dateTo } = req.query;
    let query = {};
    
    // Search functionality using NEW FIELD NAMES
    if (search) {
      query.$or = [
        { ref_code: { $regex: search, $options: 'i' } }, // Changed from 'sku'
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo + 'T23:59:59.999Z');
    }
    
    const items = await db.collection('inventory').find(query).toArray();
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/inventory/add', async (req, res) => {
  try {
    // We expect the frontend to send ref_code, qty_on_hand, etc.
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

// ==========================================
// REFACTORED PURCHASE & SALES APIs
// ==========================================

app.post('/api/purchases', async (req, res) => {
  try {
    const purchaseNumber = await getNextSequence('purchases');
    const purchaseData = {
      ...req.body.purchaseData,
      purchaseNumber: `PUR-${purchaseNumber}`,
      type: 'purchase',
      createdAt: new Date()
    };
    
    purchaseData.items = purchaseData.items.map(item => ({
      ...item,
      itemId: typeof item.itemId === 'string' ? new ObjectId(item.itemId) : item.itemId
    }));
    
    const result = await db.collection('purchases').insertOne(purchaseData);
    
    // Update inventory quantities using NEW SCHEMA
    for (const item of purchaseData.items) {
      const existingItem = await db.collection('inventory').findOne({ _id: item.itemId });
      
      if (existingItem) {
        // Use 'qty_on_hand'
        const newQuantity = (existingItem.qty_on_hand || 0) + (item.quantity || 0);
        await db.collection('inventory').updateOne(
          { _id: item.itemId },
          { $set: { qty_on_hand: newQuantity } }
        );
      }
    }
    
    res.json({ 
      message: 'Purchase recorded successfully',
      purchaseNumber: purchaseData.purchaseNumber,
      purchaseData: purchaseData,
      id: result.insertedId.toString()
    });
  } catch (error) {
    console.error('Purchase error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sales', async (req, res) => {
  try {
    const salesNumber = await getNextSequence('sales');
    const salesData = {
      ...req.body.salesData,
      salesNumber: `SAL-${salesNumber}`,
      type: 'sale',
      createdAt: new Date()
    };
    
    salesData.items = salesData.items.map(item => ({
      ...item,
      itemId: typeof item.itemId === 'string' ? new ObjectId(item.itemId) : item.itemId
    }));
    
    const result = await db.collection('sales').insertOne(salesData);
    
    // Update inventory quantities using NEW SCHEMA
    for (const item of salesData.items) {
      const existingItem = await db.collection('inventory').findOne({ _id: item.itemId });
      
      if (existingItem) {
        // Use 'qty_on_hand'
        const newQuantity = (existingItem.qty_on_hand || 0) - (item.quantity || 0);
        if (newQuantity < 0) {
          return res.status(400).json({ error: 'Insufficient stock for ' + existingItem.name });
        }
        
        await db.collection('inventory').updateOne(
          { _id: item.itemId },
          { $set: { qty_on_hand: newQuantity } }
        );
      }
    }
    
    res.json({ 
      message: 'Sale recorded successfully',
      salesNumber: salesData.salesNumber,
      salesData: salesData,
      id: result.insertedId.toString()
    });
  } catch (error) {
    console.error('Sales error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Standard Getters for History
app.get('/api/purchases', async (req, res) => {
  try {
    const purchases = await db.collection('purchases').find({}).sort({ createdAt: -1 }).toArray();
    res.json(purchases);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/purchases/:id', async (req, res) => {
  try {
    const purchase = await db.collection('purchases').findOne({ _id: new ObjectId(req.params.id) });
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    res.json(purchase);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/purchases/:id', async (req, res) => {
  try {
    const result = await db.collection('purchases').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Purchase not found' });
    res.json({ message: 'Purchase deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sales', async (req, res) => {
  try {
    const sales = await db.collection('sales').find({}).sort({ createdAt: -1 }).toArray();
    res.json(sales);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sales/:id', async (req, res) => {
  try {
    const sale = await db.collection('sales').findOne({ _id: new ObjectId(req.params.id) });
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    res.json(sale);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/sales/:id', async (req, res) => {
  try {
    const result = await db.collection('sales').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Sale not found' });
    res.json({ message: 'Sale deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reference Reports (Reference Code Logic applied here too)
app.get('/api/reference-reports', async (req, res) => {
  try {
    const referenceReports = await db.collection('reference_reports').find({}).toArray();
    res.json(referenceReports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reference-reports/:id', async (req, res) => {
  try {
    const referenceReport = await db.collection('reference_reports').findOne({ 
      _id: new ObjectId(req.params.id) 
    });
    if (!referenceReport) return res.status(404).json({ error: 'Reference report not found' });
    res.json(referenceReport);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/reference-reports/add', async (req, res) => {
  try {
    const reportNumber = await getNextSequence('reference_reports');
    const referenceReportData = {
      ...req.body.referenceData,
      reportNumber: `REF-${reportNumber}`,
      createdAt: new Date()
    };
    
    const result = await db.collection('reference_reports').insertOne(referenceReportData);
    
    res.json({ 
      message: 'Reference report saved successfully',
      reportNumber: referenceReportData.reportNumber,
      referenceData: referenceReportData,
      id: result.insertedId.toString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/reference-reports/:id', async (req, res) => {
  try {
    const result = await db.collection('reference_reports').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Report not found' });
    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Statements
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
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Report not found' });
    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// User Management
app.put('/api/user/password', async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    const user = await db.collection('users').findOne({ username, password: currentPassword });
    if (!user) return res.status(400).json({ error: 'Current password is incorrect' });
    
    await db.collection('users').updateOne({ username }, { $set: { password: newPassword } });
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
    
    await db.collection('users').deleteOne({ username });
    await db.collection('statements').deleteMany({});
    await db.collection('reference_reports').deleteMany({});
    await db.collection('purchases').deleteMany({});
    await db.collection('sales').deleteMany({});
    await db.collection('login_history').deleteMany({ username });
    
    res.json({ message: 'Account deleted successfully. Inventory data preserved.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// REFACTORED PDF GENERATION (NEW SCHEMA)
// ==========================================

app.post('/generate-reference-report-pdf', (req, res) => {
  try {
    const { referenceData } = req.body;
    if (!referenceData || !referenceData.items || !Array.isArray(referenceData.items)) {
      return res.status(400).json({ error: 'Invalid reference data' });
    }
    
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `reference-report-${referenceData.reportNumber || Date.now()}.pdf`;
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    
    // Header
    doc.fillColor('#3b82f6').fontSize(24).text('REFERENCE REPORT', { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor('#1e293b').fontSize(10).text('Inventory Management System', { align: 'center' })
       .text('Professional Inventory Solutions', { align: 'center' });
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.moveDown(1);
    
    // Info
    doc.fillColor('#1e293b').fontSize(12).text('Reference Number:', 50, doc.y, { continued: true })
       .fillColor('#3b82f6').font('Helvetica-Bold').text(` ${referenceData.reportNumber || 'REF-N/A'}`)
       .fillColor('#1e293b').font('Helvetica').text('Report Date:', 50, doc.y + 20, { continued: true })
       .fillColor('#64748b').text(` ${referenceData.date || new Date().toLocaleDateString()}`);
    
    doc.moveDown(2);
    
    // Table Header
    const tableTop = doc.y;
    doc.fillColor('#ffffff').rect(50, tableTop, 500, 25).fill('#3b82f6');
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
       .text('Item Description', 55, tableTop + 8)
       .text('Ref Code', 200, tableTop + 8) // Changed from SKU
       .text('Qty', 350, tableTop + 8)
       .text('Unit Price', 400, tableTop + 8)
       .text('Total', 470, tableTop + 8);
    
    let yPosition = tableTop + 35;
    let itemsPerPage = 15;
    const displayItems = referenceData.items.slice(0, itemsPerPage);
    
    displayItems.forEach((item, index) => {
      const quantity = item.invoiceQty || item.qty_on_hand || item.quantity || 1;
      const unitPrice = item.sell_price || item.unitPrice || 0;
      const itemTotal = quantity * unitPrice;
      const isEven = index % 2 === 0;
      
      if (isEven) {
        doc.fillColor('#f8fafc').rect(50, yPosition - 5, 500, 30).fill();
      }
      
      doc.fillColor('#1e293b').font('Helvetica').fontSize(9)
         .text(item.name || 'Unnamed Item', 55, yPosition)
         .text(item.ref_code || item.sku || 'N/A', 200, yPosition) // Use ref_code
         .text(quantity.toString(), 350, yPosition)
         .text(`RM ${unitPrice.toFixed(2)}`, 400, yPosition)
         .text(`RM ${itemTotal.toFixed(2)}`, 470, yPosition);
      
      yPosition += 30;
    });
    
    // Total
    const totalY = Math.min(yPosition + 20, 650);
    doc.moveTo(350, totalY).lineTo(550, totalY).strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.fillColor('#1e293b').fontSize(12).font('Helvetica-Bold')
       .text('Grand Total:', 350, totalY + 10, { continued: true })
       .fillColor('#3b82f6').text(` RM ${(referenceData.total || 0).toFixed(2)}`, { align: 'right' });
    
    doc.end();
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

app.post('/generate-purchase-pdf', (req, res) => {
  try {
    const { purchaseData } = req.body;
    if (!purchaseData || !purchaseData.items) return res.status(400).json({ error: 'Invalid data' });
    
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `purchase-order-${purchaseData.purchaseNumber || Date.now()}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    
    doc.fillColor('#10b981').fontSize(24).text('PURCHASE ORDER', { align: 'center' });
    doc.moveDown(1);
    
    // Info
    doc.fillColor('#1e293b').fontSize(12).text('Purchase Number:', 50, doc.y, { continued: true })
       .fillColor('#10b981').font('Helvetica-Bold').text(` ${purchaseData.purchaseNumber}`)
       .fillColor('#1e293b').font('Helvetica').text('Supplier:', 50, doc.y + 20, { continued: true })
       .fillColor('#64748b').text(` ${purchaseData.supplier}`);
    
    doc.moveDown(2);
    
    // Table
    const tableTop = doc.y;
    doc.fillColor('#ffffff').rect(50, tableTop, 500, 25).fill('#10b981');
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
       .text('Item', 55, tableTop + 8)
       .text('Ref Code', 200, tableTop + 8)
       .text('Qty', 300, tableTop + 8)
       .text('Cost', 350, tableTop + 8)
       .text('Total', 450, tableTop + 8);
       
    let yPosition = tableTop + 35;
    let totalCost = 0;
    const displayItems = purchaseData.items.slice(0, 15);
    
    displayItems.forEach((item, index) => {
      const quantity = item.quantity || 1;
      const cost = item.buy_price || item.unitCost || 0;
      const itemTotal = quantity * cost;
      totalCost += itemTotal;
      
      if (index % 2 === 0) doc.fillColor('#f8fafc').rect(50, yPosition - 5, 500, 25).fill();
      
      doc.fillColor('#1e293b').font('Helvetica').fontSize(9)
         .text(item.name, 55, yPosition)
         .text(item.ref_code || item.sku || 'N/A', 200, yPosition)
         .text(quantity.toString(), 300, yPosition)
         .text(`RM ${cost.toFixed(2)}`, 350, yPosition)
         .text(`RM ${itemTotal.toFixed(2)}`, 450, yPosition);
         
      yPosition += 25;
    });
    
    doc.text(`Total Cost: RM ${totalCost.toFixed(2)}`, 350, yPosition + 20, { align: 'right' });
    doc.end();
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

app.post('/generate-sales-pdf', (req, res) => {
  try {
    const { salesData } = req.body;
    if (!salesData || !salesData.items) return res.status(400).json({ error: 'Invalid data' });
    
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `sales-invoice-${salesData.salesNumber || Date.now()}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    
    doc.fillColor('#ef4444').fontSize(24).text('SALES INVOICE', { align: 'center' });
    doc.moveDown(1);
    
    // Info
    doc.fillColor('#1e293b').fontSize(12).text('Sales Number:', 50, doc.y, { continued: true })
       .fillColor('#ef4444').font('Helvetica-Bold').text(` ${salesData.salesNumber}`)
       .fillColor('#1e293b').font('Helvetica').text('Customer:', 50, doc.y + 20, { continued: true })
       .fillColor('#64748b').text(` ${salesData.customer}`);
    
    doc.moveDown(2);
    
    // Table
    const tableTop = doc.y;
    doc.fillColor('#ffffff').rect(50, tableTop, 500, 25).fill('#ef4444');
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
       .text('Item', 55, tableTop + 8)
       .text('Ref Code', 200, tableTop + 8)
       .text('Qty', 300, tableTop + 8)
       .text('Price', 350, tableTop + 8)
       .text('Total', 450, tableTop + 8);
       
    let yPosition = tableTop + 35;
    let itemsPerPage = 15;
    const displayItems = salesData.items.slice(0, itemsPerPage);
    
    displayItems.forEach((item, index) => {
      const quantity = item.quantity || 1;
      const price = item.sell_price || item.unitPrice || 0;
      const itemTotal = quantity * price;
      
      if (index % 2 === 0) doc.fillColor('#f8fafc').rect(50, yPosition - 5, 500, 25).fill();
      
      doc.fillColor('#1e293b').font('Helvetica').fontSize(9)
         .text(item.name, 55, yPosition)
         .text(item.ref_code || item.sku || 'N/A', 200, yPosition)
         .text(quantity.toString(), 300, yPosition)
         .text(`RM ${price.toFixed(2)}`, 350, yPosition)
         .text(`RM ${itemTotal.toFixed(2)}`, 450, yPosition);
         
      yPosition += 25;
    });
    
    doc.text(`Grand Total: RM ${(salesData.total || 0).toFixed(2)}`, 350, yPosition + 20, { align: 'right' });
    doc.end();
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

app.post('/generate-inventory-report-pdf', (req, res) => {
  try {
    const { reportData } = req.body;
    if (!reportData || !reportData.items) return res.status(400).json({ error: 'Invalid data' });
    
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `inventory-report-${reportData.id || Date.now()}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    
    doc.fillColor('#06b6d4').fontSize(24).text('INVENTORY REPORT', { align: 'center' });
    doc.moveDown(1);
    
    // Table
    const tableTop = doc.y;
    doc.fillColor('#ffffff').rect(50, tableTop, 500, 25).fill('#06b6d4');
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
       .text('#', 55, tableTop + 8)
       .text('Ref Code', 70, tableTop + 8)
       .text('Name', 130, tableTop + 8)
       .text('Stock', 300, tableTop + 8)
       .text('Cost', 340, tableTop + 8)
       .text('Price', 390, tableTop + 8)
       .text('Value', 450, tableTop + 8);
    
    let yPosition = tableTop + 35;
    let totalInventoryValue = 0;
    const displayItems = reportData.items.slice(0, 20);
    
    displayItems.forEach((item, index) => {
      // Use NEW SCHEMA fields for report
      const quantity = item.qty_on_hand || item.quantity || 0;
      const cost = item.buy_price || item.unitCost || 0;
      const price = item.sell_price || item.unitPrice || 0;
      const val = quantity * cost;
      totalInventoryValue += val;
      
      if (index % 2 === 0) doc.fillColor('#f8fafc').rect(50, yPosition - 5, 500, 20).fill();
      
      doc.fillColor('#1e293b').font('Helvetica').fontSize(8)
         .text((index + 1).toString(), 55, yPosition)
         .text(item.ref_code || item.sku || 'N/A', 70, yPosition)
         .text(item.name.substring(0, 20), 130, yPosition)
         .text(quantity.toString(), 300, yPosition)
         .text(`RM ${cost.toFixed(2)}`, 340, yPosition)
         .text(`RM ${price.toFixed(2)}`, 390, yPosition)
         .text(`RM ${val.toFixed(2)}`, 450, yPosition);
         
      yPosition += 20;
    });
    
    doc.text(`Total Inventory Value: RM ${totalInventoryValue.toFixed(2)}`, 350, yPosition + 20);
    doc.end();
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// HTML Page Templates
function getLoginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login | Secure Inventory</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="auth-container">
    <div class="auth-overlay"></div>
    <div class="auth-content">
      <div class="auth-header">
        <div class="logo">🔐</div>
        <h1 class="main-title">SECURE INVENTORY SYSTEM</h1>
        <p class="subtitle">Security & Tracking Focused</p>
      </div>
      <div class="auth-card">
        <form id="loginForm">
          <div class="input-group">
            <label>Username</label>
            <input type="text" id="username" required>
          </div>
          <div class="input-group">
            <label>Password</label>
            <input type="password" id="password" required>
          </div>
          <button type="submit" class="btn full primary">Login</button>
          <div class="auth-links">
            <p>No account? <a href="/?page=register" class="link">Register here</a></p>
          </div>
        </form>
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
  </script>
</body>
</html>`;
}

function getRegisterPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Register | Secure Inventory</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="auth-container">
    <div class="auth-overlay"></div>
    <div class="auth-content">
      <div class="auth-header">
        <div class="logo">🔐</div>
        <h1 class="main-title">CREATE ACCOUNT</h1>
      </div>
      <div class="auth-card">
        <form id="registerForm">
          <div class="input-group">
            <label>Username</label>
            <input type="text" id="user" required>
          </div>
          <div class="input-group">
            <label>Password</label>
            <input type="password" id="pass" required>
          </div>
          <div class="input-group">
            <label>Security Code</label>
            <input type="password" id="securityCode" required>
            <small class="hint">Contact admin for code</small>
          </div>
          <button type="submit" class="btn full primary">Create Account</button>
          <div class="auth-links">
            <p>Already have an account? <a href="/" class="link">Login here</a></p>
          </div>
        </form>
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
  <title>Dashboard | Secure Inventory</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <h2>🔐 Security Dashboard</h2>
      <div class="topbar-actions">
        <span class="welcome-text">User: <strong id="username"></strong></span>
        <button class="btn small ghost" onclick="toggleTheme()">🌓</button>
        <a href="/?page=settings" class="btn small">⚙️ Settings</a>
        <button class="btn small danger" onclick="logout()">Logout</button>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>📊 Audit Log (Security)</h3>
        <button class="btn small" onclick="refreshLoginHistory()">🔄 Refresh</button>
      </div>
      <div id="loginHistory" class="login-history-container">
        <div class="loading">Loading security logs...</div>
      </div>
    </div>

    <div class="card">
      <h3>Add New Stock Item</h3>
      <form id="itemForm">
        <div class="form-row">
          <label>Ref Code (SKU) <input type="text" id="itemSKU" required placeholder="REF-001"></label>
          <label>Name <input type="text" id="itemName" required placeholder="Item Name"></label>
          <label>Category <input type="text" id="itemCategory" required placeholder="Group"></label>
        </div>
        <div class="form-row">
          <label>Qty On Hand <input type="number" id="itemQty" min="1" required placeholder="0"></label>
          <label>Buy Price (RM) <input type="number" id="itemUnitCost" step="0.01" min="0.01" required placeholder="0.00"></label>
          <label>Sell Price (RM) <input type="number" id="itemUnitPrice" step="0.01" min="0.01" required placeholder="0.00"></label>
        </div>
        <button type="submit" class="btn full primary">➕ Add Stock</button>
      </form>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>Stock Database</h3>
        <div class="action-buttons">
          <button class="btn" onclick="downloadInventoryReport()">📊 Report</button>
          <a href="/?page=purchase" class="btn primary">📥 Stock In</a>
          <a href="/?page=sales" class="btn success">📤 Stock Out</a>
          <a href="/?page=reference" class="btn info">📋 Ref Report</a>
          <a href="/?page=statement" class="btn">📑 History</a>
        </div>
      </div>

      <div class="search-section">
        <div class="form-row">
          <label style="flex: 2;">
            Search Database
            <input type="text" id="searchInput" placeholder="Search Ref Code, Name..." oninput="searchInventory()">
          </label>
        </div>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Ref Code</th>
            <th>Name</th>
            <th>Category</th>
            <th>Qty</th>
            <th>Buy Price</th>
            <th>Sell Price</th>
            <th>Stock Value</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="inventoryBody"></tbody>
      </table>
    </div>
  </div>

  <div id="editModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Edit Stock</h3>
        <span class="close" onclick="closeEditModal()">&times;</span>
      </div>
      <form id="editItemForm">
        <input type="hidden" id="editItemId">
        <div class="form-row">
          <label>Ref Code <input type="text" id="editItemSKU" required></label>
          <label>Name <input type="text" id="editItemName" required></label>
          <label>Category <input type="text" id="editItemCategory" required></label>
        </div>
        <div class="form-row">
          <label>Qty <input type="number" id="editItemQty" min="1" required></label>
          <label>Buy Price <input type="number" id="editItemUnitCost" step="0.01" required></label>
          <label>Sell Price <input type="number" id="editItemUnitPrice" step="0.01" required></label>
        </div>
        <button type="submit" class="btn primary">Update</button>
      </form>
    </div>
  </div>

  <script>${getJavaScript()}</script>
  <script>
    let inventoryItems = [];

    // Login History Loader
    async function loadLoginHistory() {
      try {
        const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
        const response = await fetch('/api/login-history', {
          headers: { 'Content-Type': 'application/json', 'user': JSON.stringify(user) }
        });
        const history = await response.json();
        const container = document.getElementById('loginHistory');
        if (history.length === 0) {
          container.innerHTML = '<div class="empty-state">No logs.</div>';
        } else {
          container.innerHTML = '';
          history.forEach(entry => {
            const entryDiv = document.createElement('div');
            entryDiv.className = 'login-history-item';
            entryDiv.innerHTML = \`
              <div class="login-history-header">
                <strong>\${entry.username}</strong>
                <span class="login-status success">Logged In</span>
              </div>
              <div style="font-size:0.8em; color:#aaa;">
                IP: \${entry.ip || 'N/A'} | Time: \${new Date(entry.loginTime).toLocaleString()}
              </div>
            \`;
            container.appendChild(entryDiv);
          });
        }
      } catch (error) { console.error(error); }
    }

    function refreshLoginHistory() { loadLoginHistory(); }

    // ===============================================
    // FRONTEND LOGIC UPDATED FOR NEW SCHEMA
    // ===============================================
    async function loadInventory() {
      try {
        const search = document.getElementById('searchInput').value;
        let url = '/api/inventory?search=' + encodeURIComponent(search);
        
        const response = await fetch(url);
        inventoryItems = await response.json();
        const body = document.getElementById('inventoryBody');
        body.innerHTML = inventoryItems.length ? '' : '<tr><td colspan="9" class="no-data">No data found</td></tr>';

        inventoryItems.forEach((item, i) => {
          // MAPPING NEW FIELDS
          const ref = item.ref_code || 'N/A';
          const qty = item.qty_on_hand || 0;
          const buy = item.buy_price || 0;
          const sell = item.sell_price || 0;
          const totalVal = qty * buy;

          body.innerHTML += \`
            <tr>
              <td>\${i + 1}</td>
              <td><strong>\${ref}</strong></td>
              <td>\${item.name || 'Unnamed'}</td>
              <td><span class="category-tag">\${item.category || '-'}</span></td>
              <td><span class="quantity-badge">\${qty}</span></td>
              <td>RM \${buy.toFixed(2)}</td>
              <td>RM \${sell.toFixed(2)}</td>
              <td><strong class="value-text">RM \${totalVal.toFixed(2)}</strong></td>
              <td>
                <button class="btn small" onclick="openEditModal('\${item._id}')">✏️</button>
                <button class="btn small danger" onclick="deleteItem('\${item._id}')">🗑️</button>
              </td>
            </tr>\`;
        });
      } catch (error) { console.error(error); }
    }

    function searchInventory() { loadInventory(); }

    // ADD ITEM - Sends new keys
    document.getElementById('itemForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const item = {
        ref_code: document.getElementById('itemSKU').value,     // Mapped to ref_code
        name: document.getElementById('itemName').value,
        category: document.getElementById('itemCategory').value,
        qty_on_hand: parseInt(document.getElementById('itemQty').value) || 0, // Mapped to qty_on_hand
        buy_price: parseFloat(document.getElementById('itemUnitCost').value) || 0, // Mapped to buy_price
        sell_price: parseFloat(document.getElementById('itemUnitPrice').value) || 0 // Mapped to sell_price
      };

      try {
        const response = await fetch('/api/inventory/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });
        if (response.ok) {
          document.getElementById('itemForm').reset();
          loadInventory();
          alert('Stock added successfully');
        } else { alert('Error adding item'); }
      } catch (error) { alert('Error: ' + error.message); }
    });

    // EDIT MODAL - Reads/Writes new keys
    function openEditModal(itemId) {
      const item = inventoryItems.find(i => i._id === itemId);
      if (!item) return;
      document.getElementById('editItemId').value = item._id;
      document.getElementById('editItemSKU').value = item.ref_code || '';
      document.getElementById('editItemName').value = item.name || '';
      document.getElementById('editItemCategory').value = item.category || '';
      document.getElementById('editItemQty').value = item.qty_on_hand || 0;
      document.getElementById('editItemUnitCost').value = item.buy_price || 0;
      document.getElementById('editItemUnitPrice').value = item.sell_price || 0;
      document.getElementById('editModal').style.display = 'block';
    }

    function closeEditModal() { document.getElementById('editModal').style.display = 'none'; }

    document.getElementById('editItemForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const itemId = document.getElementById('editItemId').value;
      const updatedItem = {
        ref_code: document.getElementById('editItemSKU').value,
        name: document.getElementById('editItemName').value,
        category: document.getElementById('editItemCategory').value,
        qty_on_hand: parseInt(document.getElementById('editItemQty').value),
        buy_price: parseFloat(document.getElementById('editItemUnitCost').value),
        sell_price: parseFloat(document.getElementById('editItemUnitPrice').value)
      };

      const response = await fetch(\`/api/inventory/\${itemId}\`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedItem)
      });
      if (response.ok) {
        closeEditModal();
        loadInventory();
        alert('Updated successfully');
      }
    });

    async function deleteItem(id) {
      if(!confirm('Delete this item?')) return;
      await fetch('/api/inventory/' + id, { method: 'DELETE' });
      loadInventory();
    }

    async function downloadInventoryReport() {
      // Simplified report generation for dashboard button
      const response = await fetch('/api/inventory');
      const items = await response.json();
      const reportData = {
        id: 'REP-' + Date.now(),
        date: new Date().toLocaleString(),
        items: items
      };
      
      // Save report
      await fetch('/api/statements/add', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ reportData })
      });

      // Generate PDF
      const pdfResponse = await fetch('/generate-inventory-report-pdf', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ reportData })
      });
      
      if(pdfResponse.ok) {
        const blob = await pdfResponse.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'inventory_report.pdf';
        a.click();
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
      if (!user.username) { window.location.href = '/'; return; }
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
  <title>Stock In | Secure Inventory</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <h2>📥 Stock In (Purchase)</h2>
      <button class="btn small" onclick="window.location.href='/?page=dashboard'">← Back</button>
    </div>
    <div class="card">
      <div class="form-row">
        <label>Supplier <input type="text" id="supplier" placeholder="Supplier Name"></label>
      </div>
      <h3>Select Stock</h3>
      <div id="availableItems" class="invoice-items-list"></div>
    </div>
    <div class="card">
      <h3>Purchase List</h3>
      <div id="purchaseItems"></div>
      <div class="invoice-total">Total: RM <span id="purchaseTotal">0.00</span></div>
      <button class="btn primary full" onclick="processPurchase()">Confirm Purchase</button>
    </div>
  </div>
  <script>${getJavaScript()}</script>
  <script>
    let selectedItems = [];
    let availableItems = [];

    async function loadAvailable() {
      const res = await fetch('/api/inventory');
      availableItems = await res.json();
      const container = document.getElementById('availableItems');
      container.innerHTML = '';
      availableItems.forEach((item, idx) => {
        // Use new keys
        const ref = item.ref_code || 'N/A';
        const cost = item.buy_price || 0;
        container.innerHTML += \`
          <div class="invoice-item" style="display:flex; justify-content:space-between;">
            <div><strong>\${item.name}</strong> (\${ref}) <br> Cost: RM \${cost}</div>
            <div>
              <input type="number" id="qty-\${idx}" value="1" style="width:60px">
              <button class="btn small" onclick="add(\${idx})">Add</button>
            </div>
          </div>\`;
      });
    }

    function add(idx) {
      const item = availableItems[idx];
      const qty = parseInt(document.getElementById(\`qty-\${idx}\`).value) || 1;
      selectedItems.push({
        itemId: item._id,
        name: item.name,
        ref_code: item.ref_code, // Store ref_code
        buy_price: item.buy_price, // Store buy_price
        quantity: qty
      });
      updateDisplay();
    }

    function updateDisplay() {
      const div = document.getElementById('purchaseItems');
      div.innerHTML = '';
      let total = 0;
      selectedItems.forEach((item, i) => {
        const cost = item.buy_price || 0;
        const sub = cost * item.quantity;
        total += sub;
        div.innerHTML += \`
          <div class="invoice-item">
            \${item.name} (x\${item.quantity}) - RM \${sub.toFixed(2)} 
            <button class="btn small danger" onclick="remove(\${i})">X</button>
          </div>\`;
      });
      document.getElementById('purchaseTotal').textContent = total.toFixed(2);
    }

    function remove(i) { selectedItems.splice(i, 1); updateDisplay(); }

    async function processPurchase() {
      const purchaseData = {
        supplier: document.getElementById('supplier').value || 'Unknown',
        items: selectedItems,
        total: parseFloat(document.getElementById('purchaseTotal').textContent)
      };
      
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ purchaseData })
      });
      
      if(res.ok) {
        alert('Purchase success');
        const data = await res.json();
        // Generate PDF
        const pdfRes = await fetch('/generate-purchase-pdf', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ purchaseData: data.purchaseData })
        });
        if(pdfRes.ok) {
          const blob = await pdfRes.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'purchase.pdf';
          a.click();
        }
        window.location.reload();
      }
    }

    loadAvailable();
  </script>
</body>
</html>`;
}

function getSalesPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Stock Out | Secure Inventory</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <h2>📤 Stock Out (Sales)</h2>
      <button class="btn small" onclick="window.location.href='/?page=dashboard'">← Back</button>
    </div>
    <div class="card">
      <div class="form-row">
        <label>Customer <input type="text" id="customer" placeholder="Customer Name"></label>
      </div>
      <h3>Select Stock</h3>
      <div id="availableItems" class="invoice-items-list"></div>
    </div>
    <div class="card">
      <h3>Sales List</h3>
      <div id="salesItems"></div>
      <div class="invoice-total">Total: RM <span id="salesTotal">0.00</span></div>
      <button class="btn success full" onclick="processSale()">Confirm Sale</button>
    </div>
  </div>
  <script>${getJavaScript()}</script>
  <script>
    let selectedItems = [];
    let availableItems = [];

    async function loadAvailable() {
      const res = await fetch('/api/inventory');
      availableItems = await res.json();
      const container = document.getElementById('availableItems');
      container.innerHTML = '';
      availableItems.forEach((item, idx) => {
        const ref = item.ref_code || 'N/A';
        const price = item.sell_price || 0;
        const stock = item.qty_on_hand || 0;
        container.innerHTML += \`
          <div class="invoice-item" style="display:flex; justify-content:space-between;">
            <div><strong>\${item.name}</strong> (\${ref}) <br> Price: RM \${price} | Stock: \${stock}</div>
            <div>
              <input type="number" id="qty-\${idx}" value="1" max="\${stock}" style="width:60px">
              <button class="btn small" onclick="add(\${idx})">Add</button>
            </div>
          </div>\`;
      });
    }

    function add(idx) {
      const item = availableItems[idx];
      const qty = parseInt(document.getElementById(\`qty-\${idx}\`).value) || 1;
      const stock = item.qty_on_hand || 0;
      
      if(qty > stock) { alert('Not enough stock!'); return; }
      
      selectedItems.push({
        itemId: item._id,
        name: item.name,
        ref_code: item.ref_code,
        sell_price: item.sell_price,
        quantity: qty
      });
      updateDisplay();
    }

    function updateDisplay() {
      const div = document.getElementById('salesItems');
      div.innerHTML = '';
      let total = 0;
      selectedItems.forEach((item, i) => {
        const price = item.sell_price || 0;
        const sub = price * item.quantity;
        total += sub;
        div.innerHTML += \`
          <div class="invoice-item">
            \${item.name} (x\${item.quantity}) - RM \${sub.toFixed(2)} 
            <button class="btn small danger" onclick="remove(\${i})">X</button>
          </div>\`;
      });
      document.getElementById('salesTotal').textContent = total.toFixed(2);
    }

    function remove(i) { selectedItems.splice(i, 1); updateDisplay(); }

    async function processSale() {
      const salesData = {
        customer: document.getElementById('customer').value || 'Unknown',
        items: selectedItems,
        total: parseFloat(document.getElementById('salesTotal').textContent)
      };
      
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ salesData })
      });
      
      if(res.ok) {
        alert('Sale success');
        const data = await res.json();
        // Generate PDF
        const pdfRes = await fetch('/generate-sales-pdf', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ salesData: data.salesData })
        });
        if(pdfRes.ok) {
          const blob = await pdfRes.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'invoice.pdf';
          a.click();
        }
        window.location.reload();
      } else {
        const err = await res.json();
        alert('Error: ' + err.error);
      }
    }

    loadAvailable();
  </script>
</body>
</html>`;
}

function getReferencePage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Reference Report | Secure Inventory</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <h2>📋 Reference Report</h2>
      <button class="btn small" onclick="window.location.href='/?page=dashboard'">← Back</button>
    </div>
    <div class="card">
      <h3>Select Items</h3>
      <div id="availableItems" class="invoice-items-list"></div>
    </div>
    <div class="card">
      <h3>Report Items</h3>
      <div id="reportItems"></div>
      <button class="btn info full" onclick="generateReport()">Generate PDF</button>
    </div>
  </div>
  <script>${getJavaScript()}</script>
  <script>
    let selectedItems = [];
    let availableItems = [];

    async function loadAvailable() {
      const res = await fetch('/api/inventory');
      availableItems = await res.json();
      const container = document.getElementById('availableItems');
      container.innerHTML = '';
      availableItems.forEach((item, idx) => {
        const ref = item.ref_code || 'N/A';
        container.innerHTML += \`
          <div class="invoice-item" style="display:flex; justify-content:space-between;">
            <div><strong>\${item.name}</strong> (\${ref})</div>
            <button class="btn small" onclick="add(\${idx})">Add</button>
          </div>\`;
      });
    }

    function add(idx) {
      const item = availableItems[idx];
      selectedItems.push(item);
      updateDisplay();
    }

    function updateDisplay() {
      const div = document.getElementById('reportItems');
      div.innerHTML = '';
      selectedItems.forEach((item, i) => {
        div.innerHTML += \`<div class="invoice-item">\${item.name} <button class="btn small danger" onclick="remove(\${i})">X</button></div>\`;
      });
    }

    function remove(i) { selectedItems.splice(i, 1); updateDisplay(); }

    async function generateReport() {
      const referenceData = {
        date: new Date().toLocaleString(),
        items: selectedItems,
        total: 0 // Calculation handled in PDF logic usually
      };
      
      // Save report record
      const saveRes = await fetch('/api/reference-reports/add', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ referenceData })
      });
      const saveData = await saveRes.json();
      referenceData.reportNumber = saveData.reportNumber;

      const res = await fetch('/generate-reference-report-pdf', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ referenceData })
      });
      
      if(res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'reference.pdf';
        a.click();
      }
    }
    loadAvailable();
  </script>
</body>
</html>`;
}

function getStatementPage() {
    // Simplified Statement Page
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>History | Secure Inventory</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <h2>📑 History & Reports</h2>
      <button class="btn small" onclick="window.location.href='/?page=dashboard'">← Back</button>
    </div>
    <div class="card">
        <h3>Purchase History</h3>
        <div id="purchaseList"></div>
    </div>
    <div class="card">
        <h3>Sales History</h3>
        <div id="salesList"></div>
    </div>
  </div>
  <script>${getJavaScript()}</script>
  <script>
    async function loadHistory() {
        const pRes = await fetch('/api/purchases');
        const purchases = await pRes.json();
        document.getElementById('purchaseList').innerHTML = purchases.map(p => 
            \`<div class="invoice-item">\${p.purchaseNumber} - \${p.supplier} (RM \${(p.total||0).toFixed(2)})</div>\`
        ).join('');

        const sRes = await fetch('/api/sales');
        const sales = await sRes.json();
        document.getElementById('salesList').innerHTML = sales.map(s => 
            \`<div class="invoice-item">\${s.salesNumber} - \${s.customer} (RM \${(s.total||0).toFixed(2)})</div>\`
        ).join('');
    }
    loadHistory();
  </script>
</body>
</html>`;
}

function getSettingsPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head><title>Settings</title><style>${getCSS()}</style></head>
<body>
<div class="container">
    <div class="topbar"><h2>⚙️ Settings</h2><button class="btn small" onclick="window.location.href='/?page=dashboard'">Back</button></div>
    <div class="card">
        <h3>Change Password</h3>
        <form id="pwForm">
            <input type="password" id="cur" placeholder="Current" required>
            <input type="password" id="new" placeholder="New" required>
            <button class="btn primary full">Update</button>
        </form>
    </div>
    <div class="card" style="border-color:red; border-width:1px; border-style:solid;">
        <h3 style="color:red">Delete Account</h3>
        <input type="password" id="delCode" placeholder="Security Code">
        <button class="btn danger full" onclick="delAcc()">DELETE ACCOUNT</button>
    </div>
</div>
<script>${getJavaScript()}</script>
<script>
    document.getElementById('pwForm').addEventListener('submit', async(e)=>{
        e.preventDefault();
        const user = JSON.parse(localStorage.getItem('currentUser'));
        await fetch('/api/user/password', {
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                username: user.username,
                currentPassword: document.getElementById('cur').value,
                newPassword: document.getElementById('new').value
            })
        });
        alert('Done');
    });
    async function delAcc(){
        if(!confirm('Delete?')) return;
        const user = JSON.parse(localStorage.getItem('currentUser'));
        const res = await fetch('/api/user', {
            method:'DELETE',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({username:user.username, securityCode: document.getElementById('delCode').value})
        });
        if(res.ok) { window.location.href='/'; } else { alert('Failed'); }
    }
</script>
</body>
</html>`;
}

function getCSS() {
  return `
    :root { --primary: #3b82f6; --bg: #0f172a; --card: #1e293b; --text: #f1f5f9; }
    body { font-family: sans-serif; background: var(--bg); color: var(--text); margin: 0; }
    body.light { --bg: #f8fafc; --card: #ffffff; --text: #1e293b; }
    .container { max-width: 1000px; margin: 20px auto; padding: 10px; }
    .card { background: var(--card); padding: 20px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .topbar { display: flex; justify-content: space-between; align-items: center; background: var(--primary); padding: 15px; border-radius: 12px; margin-bottom: 20px; color: white; }
    .btn { background: var(--primary); border: none; padding: 10px 15px; color: white; border-radius: 8px; cursor: pointer; }
    .btn.danger { background: #ef4444; }
    .btn.success { background: #10b981; }
    .btn.info { background: #06b6d4; }
    .btn.small { padding: 5px 10px; font-size: 0.8em; }
    .btn.full { width: 100%; margin-top: 10px; }
    input { width: 100%; padding: 10px; margin: 5px 0; background: rgba(0,0,0,0.2); border: 1px solid #444; color: white; border-radius: 6px; box-sizing: border-box;}
    body.light input { background: #f1f5f9; color: black; border-color: #ccc; }
    .form-row { display: flex; gap: 10px; margin-bottom: 10px; }
    .form-row label { flex: 1; }
    .table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    .table th, .table td { padding: 10px; text-align: left; border-bottom: 1px solid #333; }
    .table th { color: var(--primary); }
    .auth-container { height: 100vh; display: flex; justify-content: center; align-items: center; background: #000; }
    .auth-card { width: 350px; background: #1a1a1a; padding: 30px; border-radius: 15px; text-align: center; }
    .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); }
    .modal-content { background: var(--card); width: 90%; max-width: 500px; margin: 100px auto; padding: 20px; border-radius: 10px; }
    .invoice-item { background: rgba(255,255,255,0.05); padding: 10px; margin-bottom: 5px; border-radius: 5px; }
    .login-history-item { border-left: 3px solid #10b981; padding-left: 10px; margin-bottom: 10px; }
  `;
}

function getJavaScript() {
  return `
    function toggleTheme() {
        document.body.classList.toggle('light');
    }
    function logout() {
        localStorage.removeItem('currentUser');
        window.location.href = '/';
    }
  `;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Secure Server running on port ' + PORT);
  console.log('✅ REFACTORED SCHEMA APPLIED (ref_code, qty_on_hand, buy_price, sell_price)');
});
