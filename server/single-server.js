const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection
// REPLACE WITH HIS MONGODB URI
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
    
    const collections = ['users', 'inventory', 'statements', 'reference_reports', 'purchases', 'sales', 'login_history', 'counters'];
    for (const collectionName of collections) {
      const collection = db.collection(collectionName);
      if (collectionName === 'users') {
        try {
          await collection.createIndex({ "username": 1 }, { unique: true });
        } catch (error) { }
      }
    }
    
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
    if (!username || !password) return res.status(400).json({ success: false, error: 'Username and password required' });

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
    if (!username || !password || !securityCode) return res.status(400).json({ error: 'All fields required' });
    if (securityCode !== VALID_SECURITY_CODE) return res.status(400).json({ error: 'Invalid security code' });

    const existing = await db.collection('users').findOne({ username });
    if (existing) return res.status(400).json({ error: 'Username exists' });

    await db.collection('users').insertOne({ username, password, createdAt: new Date() });
    res.json({ message: 'Registration successful' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/login-history', async (req, res) => {
  try {
    const user = JSON.parse(req.headers.user || '{}');
    if (!user.username) return res.status(401).json({ error: 'Unauthorized' });

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
// REFACTORED INVENTORY API (New Schema)
// ==========================================

app.get('/api/inventory', async (req, res) => {
  try {
    const { search, dateFrom, dateTo } = req.query;
    let query = {};
    
    // SEARCH: Using 'ref_code' instead of 'sku'
    if (search) {
      query.$or = [
        { ref_code: { $regex: search, $options: 'i' } },
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
    // Stores data using NEW keys (ref_code, qty_on_hand, buy_price, sell_price)
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
    
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Item not found' });
    res.json({ message: 'Item updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const result = await db.collection('inventory').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Item not found' });
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reference Reports APIs
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
    const referenceReport = await db.collection('reference_reports').findOne({ _id: new ObjectId(req.params.id) });
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

// Purchase APIs (Stock In)
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
    
    // UPDATE INVENTORY: Using 'qty_on_hand'
    for (const item of purchaseData.items) {
      const existingItem = await db.collection('inventory').findOne({ _id: item.itemId });
      
      if (existingItem) {
        // NEW SCHEMA LOGIC
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

// Sales APIs (Stock Out)
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
    
    // UPDATE INVENTORY: Using 'qty_on_hand'
    for (const item of salesData.items) {
      const existingItem = await db.collection('inventory').findOne({ _id: item.itemId });
      
      if (existingItem) {
        // NEW SCHEMA LOGIC
        const newQuantity = (existingItem.qty_on_hand || 0) - (item.quantity || 0);
        if (newQuantity < 0) return res.status(400).json({ error: 'Insufficient stock for ' + existingItem.name });
        
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
    await db.collection('statements').insertOne({ ...req.body.reportData, createdAt: new Date() });
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
    if (!securityCode || securityCode !== VALID_SECURITY_CODE) return res.status(400).json({ error: 'Invalid security code' });
    
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
// REFACTORED PDF GENERATION (Uses New Schema)
// ==========================================

app.post('/generate-reference-report-pdf', (req, res) => {
  try {
    const { referenceData } = req.body;
    if (!referenceData || !referenceData.items || !Array.isArray(referenceData.items)) return res.status(400).json({ error: 'Invalid reference data' });
    
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `reference-report-${referenceData.reportNumber || Date.now()}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    
    // Header
    doc.fillColor('#3b82f6').fontSize(24).text('REFERENCE REPORT', { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor('#1e293b').fontSize(10)
       .text('Inventory Management System', { align: 'center' })
       .text('Professional Inventory Solutions', { align: 'center' });
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.moveDown(1);
    
    // Details
    const leftColumn = 50, rightColumn = 300;
    doc.fillColor('#1e293b').fontSize(12)
       .text('Reference Number:', leftColumn, doc.y, { continued: true })
       .fillColor('#3b82f6').font('Helvetica-Bold').text(` ${referenceData.reportNumber || 'REF-N/A'}`)
       .fillColor('#1e293b').font('Helvetica').text('Report Date:', leftColumn, doc.y + 20, { continued: true })
       .fillColor('#64748b').text(` ${referenceData.date || new Date().toLocaleDateString()}`);
    doc.moveDown(2);
    
    // Table
    const tableTop = doc.y;
    doc.fillColor('#ffffff').rect(50, tableTop, 500, 25).fill('#3b82f6');
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
       .text('Item Description', 55, tableTop + 8)
       .text('REF Code', 200, tableTop + 8) // CHANGED
       .text('Qty', 350, tableTop + 8)
       .text('Sell Price', 400, tableTop + 8) // CHANGED
       .text('Total', 470, tableTop + 8);
    
    let yPosition = tableTop + 35;
    let itemsPerPage = 15;
    const displayItems = referenceData.items.slice(0, itemsPerPage);
    
    displayItems.forEach((item, index) => {
      // Logic handles both Reference (invoiceQty) and Inventory sources
      const quantity = item.invoiceQty || item.quantity || 1;
      const unitPrice = item.sell_price || item.unitPrice || 0; // UPDATED
      const itemTotal = quantity * unitPrice;
      const isEven = index % 2 === 0;
      
      if (isEven) doc.fillColor('#f8fafc').rect(50, yPosition - 5, 500, 30).fill();
      
      doc.fillColor('#1e293b').font('Helvetica').fontSize(9)
         .text(item.name || 'Unnamed Item', 55, yPosition)
         .text(item.ref_code || item.sku || 'N/A', 200, yPosition) // UPDATED
         .text(quantity.toString(), 350, yPosition)
         .text(`RM ${unitPrice.toFixed(2)}`, 400, yPosition)
         .text(`RM ${itemTotal.toFixed(2)}`, 470, yPosition);
      
      doc.fillColor('#64748b').fontSize(7).text(`Category: ${item.category || 'N/A'}`, 55, yPosition + 12);
      yPosition += 30;
    });
    
    if (referenceData.items.length > itemsPerPage) {
      doc.fillColor('#ef4444').fontSize(9).text(`* Showing first ${itemsPerPage} items only for single-page PDF`, 50, yPosition + 10);
      yPosition += 20;
    }
    
    const totalY = Math.min(yPosition + 20, 650);
    doc.moveTo(350, totalY).lineTo(550, totalY).strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.fillColor('#1e293b').fontSize(12).font('Helvetica-Bold')
       .text('Grand Total:', 350, totalY + 10, { continued: true })
       .fillColor('#3b82f6').text(` RM ${(referenceData.total || 0).toFixed(2)}`, { align: 'right' });
    
    doc.end();
  } catch (error) {
    console.error('Reference PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

app.post('/generate-purchase-pdf', (req, res) => {
  try {
    const { purchaseData } = req.body;
    if (!purchaseData || !purchaseData.items || !Array.isArray(purchaseData.items)) return res.status(400).json({ error: 'Invalid purchase data' });
    
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `purchase-order-${purchaseData.purchaseNumber || Date.now()}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    
    doc.fillColor('#10b981').fontSize(24).text('PURCHASE ORDER', { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor('#1e293b').fontSize(10).text('Inventory Management System', { align: 'center' });
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.moveDown(1);
    
    const leftColumn = 50, rightColumn = 300;
    doc.fillColor('#1e293b').fontSize(11)
       .text('Purchase Number:', leftColumn, doc.y, { continued: true })
       .fillColor('#10b981').font('Helvetica-Bold').text(` ${purchaseData.purchaseNumber || 'PUR-N/A'}`)
       .fillColor('#1e293b').font('Helvetica').text('Order Date:', leftColumn, doc.y + 20, { continued: true })
       .fillColor('#64748b').text(` ${purchaseData.date || new Date().toLocaleDateString()}`)
       .fillColor('#1e293b').text('Supplier:', rightColumn, doc.y - 40, { continued: true })
       .fillColor('#64748b').text(` ${purchaseData.supplier || 'N/A'}`);
    doc.moveDown(2);
    
    const tableTop = doc.y;
    doc.fillColor('#ffffff').rect(50, tableTop, 500, 25).fill('#10b981');
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
       .text('Item', 55, tableTop + 8)
       .text('REF Code', 200, tableTop + 8) // CHANGED
       .text('Qty', 300, tableTop + 8)
       .text('Buy Price', 350, tableTop + 8) // CHANGED
       .text('Total', 450, tableTop + 8);
    
    let yPosition = tableTop + 35;
    let totalCost = 0;
    let itemsPerPage = 15;
    const displayItems = purchaseData.items.slice(0, itemsPerPage);
    
    displayItems.forEach((item, index) => {
      const quantity = item.quantity || 1;
      const unitCost = item.buy_price || item.unitCost || 0; // UPDATED
      const itemTotal = quantity * unitCost;
      totalCost += itemTotal;
      const isEven = index % 2 === 0;
      
      if (isEven) doc.fillColor('#f8fafc').rect(50, yPosition - 5, 500, 25).fill();
      
      doc.fillColor('#1e293b').font('Helvetica').fontSize(9)
         .text(item.name || 'Unnamed Item', 55, yPosition)
         .text(item.ref_code || item.sku || 'N/A', 200, yPosition) // UPDATED
         .text(quantity.toString(), 300, yPosition)
         .text(`RM ${unitCost.toFixed(2)}`, 350, yPosition)
         .text(`RM ${itemTotal.toFixed(2)}`, 450, yPosition);
      
      yPosition += 25;
    });
    
    if (purchaseData.items.length > itemsPerPage) {
      doc.fillColor('#ef4444').fontSize(9).text(`* Showing first ${itemsPerPage} items only for single-page PDF`, 50, yPosition + 10);
      yPosition += 20;
    }
    
    const totalY = Math.min(yPosition + 20, 650);
    doc.moveTo(350, totalY).lineTo(550, totalY).strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.fillColor('#1e293b').fontSize(12).font('Helvetica-Bold')
       .text('Total Cost:', 350, totalY + 10, { continued: true })
       .fillColor('#10b981').text(` RM ${totalCost.toFixed(2)}`, { align: 'right' });
    
    doc.end();
  } catch (error) {
    console.error('Purchase PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate purchase PDF' });
  }
});

app.post('/generate-sales-pdf', (req, res) => {
  try {
    const { salesData } = req.body;
    if (!salesData || !salesData.items || !Array.isArray(salesData.items)) return res.status(400).json({ error: 'Invalid sales data' });
    
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `sales-invoice-${salesData.salesNumber || Date.now()}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    
    doc.fillColor('#ef4444').fontSize(24).text('SALES INVOICE', { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor('#1e293b').fontSize(10).text('Inventory Management System', { align: 'center' });
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.moveDown(1);
    
    const leftColumn = 50, rightColumn = 300;
    doc.fillColor('#1e293b').fontSize(11)
       .text('Sales Number:', leftColumn, doc.y, { continued: true })
       .fillColor('#ef4444').font('Helvetica-Bold').text(` ${salesData.salesNumber || 'SAL-N/A'}`)
       .fillColor('#1e293b').font('Helvetica').text('Sale Date:', leftColumn, doc.y + 20, { continued: true })
       .fillColor('#64748b').text(` ${salesData.date || new Date().toLocaleDateString()}`)
       .fillColor('#1e293b').text('Customer:', rightColumn, doc.y - 40, { continued: true })
       .fillColor('#64748b').text(` ${salesData.customer || 'N/A'}`);
    doc.moveDown(2);
    
    const tableTop = doc.y;
    doc.fillColor('#ffffff').rect(50, tableTop, 500, 25).fill('#ef4444');
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
       .text('Item', 55, tableTop + 8)
       .text('REF Code', 200, tableTop + 8) // CHANGED
       .text('Qty', 300, tableTop + 8)
       .text('Sell Price', 350, tableTop + 8) // CHANGED
       .text('Total', 450, tableTop + 8);
    
    let yPosition = tableTop + 35;
    let itemsPerPage = 15;
    const displayItems = salesData.items.slice(0, itemsPerPage);
    
    displayItems.forEach((item, index) => {
      const quantity = item.quantity || 1;
      const unitPrice = item.sell_price || item.unitPrice || 0; // UPDATED
      const itemTotal = quantity * unitPrice;
      const isEven = index % 2 === 0;
      
      if (isEven) doc.fillColor('#f8fafc').rect(50, yPosition - 5, 500, 25).fill();
      
      doc.fillColor('#1e293b').font('Helvetica').fontSize(9)
         .text(item.name || 'Unnamed Item', 55, yPosition)
         .text(item.ref_code || item.sku || 'N/A', 200, yPosition) // UPDATED
         .text(quantity.toString(), 300, yPosition)
         .text(`RM ${unitPrice.toFixed(2)}`, 350, yPosition)
         .text(`RM ${itemTotal.toFixed(2)}`, 450, yPosition);
      
      yPosition += 25;
    });
    
    if (salesData.items.length > itemsPerPage) {
      doc.fillColor('#ef4444').fontSize(9).text(`* Showing first ${itemsPerPage} items only for single-page PDF`, 50, yPosition + 10);
      yPosition += 20;
    }
    
    const totalY = Math.min(yPosition + 20, 650);
    doc.moveTo(350, totalY).lineTo(550, totalY).strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.fillColor('#1e293b').fontSize(12).font('Helvetica-Bold')
       .text('Grand Total:', 350, totalY + 10, { continued: true })
       .fillColor('#ef4444').text(` RM ${(salesData.total || 0).toFixed(2)}`, { align: 'right' });
    
    doc.end();
  } catch (error) {
    console.error('Sales PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate sales PDF' });
  }
});

app.post('/generate-inventory-report-pdf', (req, res) => {
  try {
    const { reportData } = req.body;
    if (!reportData || !reportData.items || !Array.isArray(reportData.items)) return res.status(400).json({ error: 'Invalid report data' });
    
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `inventory-report-${reportData.id || Date.now()}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    
    doc.fillColor('#06b6d4').fontSize(24).text('INVENTORY REPORT', { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor('#1e293b').fontSize(10).text('Inventory Management System', { align: 'center' });
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.moveDown(1);
    
    const leftColumn = 50, rightColumn = 300;
    doc.fillColor('#1e293b').fontSize(11)
       .text('Report ID:', leftColumn, doc.y, { continued: true })
       .fillColor('#64748b').text(` ${reportData.id || 'N/A'}`)
       .fillColor('#1e293b').text('Generated:', leftColumn, doc.y + 20, { continued: true })
       .fillColor('#64748b').text(` ${reportData.date || new Date().toLocaleDateString()}`)
       .fillColor('#1e293b').text('Total Items:', rightColumn, doc.y - 20, { continued: true })
       .fillColor('#64748b').text(` ${reportData.items.length}`);
    doc.moveDown(2);
    
    const tableTop = doc.y;
    doc.fillColor('#ffffff').rect(50, tableTop, 500, 25).fill('#06b6d4');
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
       .text('#', 55, tableTop + 8)
       .text('REF Code', 70, tableTop + 8) // CHANGED
       .text('Product Name', 120, tableTop + 8)
       .text('Category', 220, tableTop + 8)
       .text('Stock', 300, tableTop + 8)
       .text('Buy', 340, tableTop + 8) // CHANGED
       .text('Sell', 390, tableTop + 8) // CHANGED
       .text('Value', 450, tableTop + 8);
    
    let yPosition = tableTop + 35;
    let totalInventoryValue = 0;
    let totalPotentialValue = 0;
    let totalItems = 0;
    let itemsPerPage = 20;
    const displayItems = reportData.items.slice(0, itemsPerPage);
    
    displayItems.forEach((item, index) => {
      // READ NEW KEYS FOR REPORT
      const quantity = item.qty_on_hand || item.quantity || 0;
      const unitCost = item.buy_price || item.unitCost || 0;
      const unitPrice = item.sell_price || item.unitPrice || 0;
      
      const inventoryValue = quantity * unitCost;
      const potentialValue = quantity * unitPrice;
      totalInventoryValue += inventoryValue;
      totalPotentialValue += potentialValue;
      totalItems += quantity;
      
      const isEven = index % 2 === 0;
      if (isEven) doc.fillColor('#f8fafc').rect(50, yPosition - 5, 500, 20).fill();
      
      doc.fillColor('#1e293b').font('Helvetica').fontSize(8)
         .text((index + 1).toString(), 55, yPosition)
         .text(item.ref_code || item.sku || 'N/A', 70, yPosition) // CHANGED
         .text((item.name || 'Unnamed').substring(0, 22), 120, yPosition)
         .text((item.category || 'N/A').substring(0, 12), 220, yPosition)
         .text(quantity.toString(), 300, yPosition)
         .text(`RM ${unitCost.toFixed(2)}`, 340, yPosition)
         .text(`RM ${unitPrice.toFixed(2)}`, 390, yPosition)
         .text(`RM ${inventoryValue.toFixed(2)}`, 450, yPosition);
      yPosition += 20;
    });
    
    if (reportData.items.length > itemsPerPage) {
      doc.fillColor('#ef4444').fontSize(9).text(`* Showing first ${itemsPerPage} items only for single-page PDF`, 50, yPosition + 10);
      yPosition += 20;
    }
    
    // Summary
    const summaryY = Math.min(yPosition + 30, 650);
    doc.fillColor('#f8fafc').rect(50, summaryY, 500, 100).fill();
    doc.strokeColor('#e2e8f0').rect(50, summaryY, 500, 100).stroke();
    doc.fillColor('#1e293b').fontSize(12).font('Helvetica-Bold').text('INVENTORY SUMMARY', 55, summaryY + 15);
    
    doc.fillColor('#64748b').fontSize(9).font('Helvetica')
       .text('Total Items in Report:', 55, summaryY + 35, { continued: true }).fillColor('#1e293b').text(` ${reportData.items.length} products`)
       .fillColor('#64748b').text('Total Stock Quantity:', 55, summaryY + 50, { continued: true }).fillColor('#1e293b').text(` ${totalItems} units`)
       .fillColor('#64748b').text('Total Inventory Value:', 280, summaryY + 35, { continued: true }).fillColor('#ef4444').text(` RM ${totalInventoryValue.toFixed(2)}`)
       .fillColor('#64748b').text('Profit Potential:', 280, summaryY + 50, { continued: true }).fillColor('#3b82f6').text(` RM ${(totalPotentialValue - totalInventoryValue).toFixed(2)}`);
    
    doc.end();
  } catch (error) {
    console.error('Inventory PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate inventory PDF' });
  }
});

// HTML TEMPLATES
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
    <div class="auth-overlay"></div>
    <div class="auth-content">
      <div class="auth-header"><div class="logo">📦</div><h1 class="main-title">INVENTORY SYSTEM</h1></div>
      <div class="auth-card">
        <form id="loginForm">
          <div class="input-group"><label>Username</label><input type="text" id="username" required></div>
          <div class="input-group"><label>Password</label><input type="password" id="password" required></div>
          <button type="submit" class="btn full primary">Login</button>
          <div class="auth-links"><p>No account? <a href="/?page=register" class="link">Register here</a></p></div>
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
        const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const data = await response.json();
        if (data.success) { localStorage.setItem('currentUser', JSON.stringify(data.user)); window.location.href = '/?page=dashboard'; } else { alert('Login failed: ' + data.error); }
      } catch (error) { alert('Login error: ' + error.message); }
    });
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (currentUser && currentUser.username) window.location.href = '/?page=dashboard';
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
    <div class="auth-overlay"></div>
    <div class="auth-content">
      <div class="auth-header"><div class="logo">📦</div><h1 class="main-title">INVENTORY SYSTEM</h1></div>
      <div class="auth-card">
        <form id="registerForm">
          <div class="input-group"><label>Username</label><input type="text" id="user" required></div>
          <div class="input-group"><label>Password</label><input type="password" id="pass" required></div>
          <div class="input-group"><label>Security Code</label><input type="password" id="securityCode" required></div>
          <button type="submit" class="btn full primary">Create Account</button>
          <div class="auth-links"><p>Already have an account? <a href="/" class="link">Login here</a></p></div>
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
        const response = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, securityCode }) });
        const data = await response.json();
        if (response.ok) { alert('Registration successful!'); window.location.href = '/'; } else { alert('Registration failed: ' + data.error); }
      } catch (error) { alert('Registration error: ' + error.message); }
    });
  </script>
</body>
</html>`;
}

// ==========================================
// REFACTORED DASHBOARD (Uses New Schema)
// ==========================================
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

    <div class="card">
      <div class="card-header">
        <h3>📊 System Login History</h3>
        <button class="btn small" onclick="refreshLoginHistory()">🔄 Refresh</button>
      </div>
      <div id="loginHistory" class="login-history-container"><div class="loading">Loading login history...</div></div>
    </div>

    <div class="card">
      <h3>💰 Inventory Value Summary</h3>
      <div class="value-summary">
        <div class="value-item primary"><h4>Total Inventory Value</h4><p id="totalInventoryValueSummary">RM 0.00</p></div>
        <div class="value-item success"><h4>Total Potential Value</h4><p id="totalPotentialValueSummary">RM 0.00</p></div>
        <div class="value-item info"><h4>Total Items</h4><p id="totalItemsCount">0</p></div>
      </div>
    </div>

    <div class="card">
      <h3>Add New Item</h3>
      <form id="itemForm">
        <div class="form-row">
          <label>Ref Code / SKU <input type="text" id="itemRef" required placeholder="Product Ref Code"></label>
          <label>Name <input type="text" id="itemName" required placeholder="Product name"></label>
          <label>Category <input type="text" id="itemCategory" required placeholder="Product category"></label>
        </div>
        <div class="form-row">
          <label>Qty On Hand <input type="number" id="itemQtyHand" min="1" required placeholder="0"></label>
          <label>Buy Price (RM) <input type="number" id="itemBuyPrice" step="0.01" min="0.01" required placeholder="0.00"></label>
          <label>Sell Price (RM) <input type="number" id="itemSellPrice" step="0.01" min="0.01" required placeholder="0.00"></label>
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
          <a href="/?page=reference" class="btn info">📋 Reference Report</a>
          <a href="/?page=statement" class="btn">📑 Statement</a>
        </div>
      </div>

      <div class="search-section">
        <div class="form-row">
          <label style="flex: 2;">Search Items <input type="text" id="searchInput" placeholder="Search by Ref Code, Name..." oninput="searchInventory()"></label>
          <label>Date From <input type="date" id="dateFrom" onchange="searchInventory()"></label>
          <label>Date To <input type="date" id="dateTo" onchange="searchInventory()"></label>
          <label style="align-self: flex-end;"><button type="button" class="btn small danger" onclick="clearSearch()" style="margin-top: 5px;">Clear</button></label>
        </div>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Ref Code</th> <th>Name</th>
            <th>Category</th>
            <th>Qty Hand</th> <th>Buy Price</th> <th>Sell Price</th> <th>Total Value</th>
            <th>Potential Value</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="inventoryBody"></tbody>
        <tfoot>
          <tr class="subtotal-row">
            <td colspan="7"><strong>Subtotal:</strong></td>
            <td><strong id="totalInventoryValue">RM 0.00</strong></td>
            <td><strong id="totalPotentialValue">RM 0.00</strong></td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>

  <div id="editModal" class="modal">
    <div class="modal-content">
      <div class="modal-header"><h3>Edit Item</h3><span class="close" onclick="closeEditModal()">&times;</span></div>
      <form id="editItemForm">
        <input type="hidden" id="editItemId">
        <div class="form-row">
          <label>Ref Code <input type="text" id="editItemRef" required></label>
          <label>Name <input type="text" id="editItemName" required></label>
          <label>Category <input type="text" id="editItemCategory" required></label>
        </div>
        <div class="form-row">
          <label>Qty On Hand <input type="number" id="editItemQtyHand" min="1" required></label>
          <label>Buy Price (RM) <input type="number" id="editItemBuyPrice" step="0.01" min="0.01" required></label>
          <label>Sell Price (RM) <input type="number" id="editItemSellPrice" step="0.01" min="0.01" required></label>
        </div>
        <div class="controls"><button type="submit" class="btn primary">Update Item</button><button type="button" class="btn danger" onclick="closeEditModal()">Cancel</button></div>
      </form>
    </div>
  </div>

  <script>${getJavaScript()}</script>
  <script>
    let inventoryItems = [];

    // Login History Logic (Same as before)
    async function loadLoginHistory() {
      try {
        const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
        const response = await fetch('/api/login-history', { headers: { 'Content-Type': 'application/json', 'user': JSON.stringify(user) } });
        const history = await response.json();
        const container = document.getElementById('loginHistory');
        if (history.length === 0) { container.innerHTML = '<div class="empty-state">No login history available.</div>'; } 
        else {
          container.innerHTML = '';
          history.forEach(entry => {
            container.innerHTML += '<div class="login-history-item"><div class="login-history-header"><strong>' + entry.username + '</strong><span class="login-time">' + new Date(entry.loginTime).toLocaleString() + '</span></div><div class="login-details"><span class="detail-value">IP: ' + (entry.ip || 'N/A') + '</span></div></div>';
          });
        }
      } catch (error) { console.error(error); }
    }
    function refreshLoginHistory() { loadLoginHistory(); }

    // INVENTORY LOGIC: MAPPED TO NEW SCHEMA
    async function loadInventory() {
      try {
        const search = document.getElementById('searchInput').value;
        const dateFrom = document.getElementById('dateFrom').value;
        const dateTo = document.getElementById('dateTo').value;
        let url = '/api/inventory?';
        if (search) url += 'search=' + search + '&';
        if (dateFrom) url += 'dateFrom=' + dateFrom + '&';
        if (dateTo) url += 'dateTo=' + dateTo;
        
        const response = await fetch(url);
        inventoryItems = await response.json();
        const body = document.getElementById('inventoryBody');
        body.innerHTML = inventoryItems.length ? '' : '<tr><td colspan="10" class="no-data">No items in inventory</td></tr>';

        let totalInventoryValue = 0;
        let totalPotentialValue = 0;

        inventoryItems.forEach((item, i) => {
          // READ NEW SCHEMA KEYS
          const qty = item.qty_on_hand || 0;
          const cost = item.buy_price || 0;
          const price = item.sell_price || 0;
          
          const inventoryValue = qty * cost;
          const potentialValue = qty * price;
          totalInventoryValue += inventoryValue;
          totalPotentialValue += potentialValue;

          body.innerHTML += \`
            <tr>
              <td>\${i + 1}</td>
              <td><strong>\${item.ref_code || 'N/A'}</strong></td>
              <td>\${item.name || 'Unnamed'}</td>
              <td><span class="category-tag">\${item.category || 'N/A'}</span></td>
              <td><span class="quantity-badge">\${qty}</span></td>
              <td>RM \${cost.toFixed(2)}</td>
              <td>RM \${price.toFixed(2)}</td>
              <td><strong class="value-text">RM \${inventoryValue.toFixed(2)}</strong></td>
              <td><strong class="potential-text">RM \${potentialValue.toFixed(2)}</strong></td>
              <td class="action-buttons">
                <button class="btn small" onclick="openEditModal('\${item._id}')">✏️ Edit</button>
                <button class="btn small danger" onclick="deleteItem('\${item._id}')">🗑️ Delete</button>
              </td>
            </tr>\`;
        });

        document.getElementById('totalInventoryValue').textContent = \`RM \${totalInventoryValue.toFixed(2)}\`;
        document.getElementById('totalPotentialValue').textContent = \`RM \${totalPotentialValue.toFixed(2)}\`;
        document.getElementById('totalInventoryValueSummary').textContent = \`RM \${totalInventoryValue.toFixed(2)}\`;
        document.getElementById('totalPotentialValueSummary').textContent = \`RM \${totalPotentialValue.toFixed(2)}\`;
        document.getElementById('totalItemsCount').textContent = inventoryItems.length;
      } catch (error) { console.error(error); }
    }

    function searchInventory() { loadInventory(); }
    function clearSearch() { document.getElementById('searchInput').value = ''; loadInventory(); }

    // EDIT ITEM: MAPPED TO NEW SCHEMA
    function openEditModal(itemId) {
      const item = inventoryItems.find(i => i._id === itemId);
      if (!item) return;
      document.getElementById('editItemId').value = item._id;
      document.getElementById('editItemRef').value = item.ref_code || '';
      document.getElementById('editItemName').value = item.name || '';
      document.getElementById('editItemCategory').value = item.category || '';
      document.getElementById('editItemQtyHand').value = item.qty_on_hand || 1;
      document.getElementById('editItemBuyPrice').value = item.buy_price || 0;
      document.getElementById('editItemSellPrice').value = item.sell_price || 0;
      document.getElementById('editModal').style.display = 'block';
    }
    function closeEditModal() { document.getElementById('editModal').style.display = 'none'; }

    document.getElementById('editItemForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const itemId = document.getElementById('editItemId').value;
      const updatedItem = {
        ref_code: document.getElementById('editItemRef').value,
        name: document.getElementById('editItemName').value,
        category: document.getElementById('editItemCategory').value,
        qty_on_hand: parseInt(document.getElementById('editItemQtyHand').value) || 0,
        buy_price: parseFloat(document.getElementById('editItemBuyPrice').value) || 0,
        sell_price: parseFloat(document.getElementById('editItemSellPrice').value) || 0
      };

      try {
        const response = await fetch(\`/api/inventory/\${itemId}\`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedItem) });
        if (response.ok) { closeEditModal(); loadInventory(); alert('Item updated successfully!'); } 
        else { alert('Failed to update item'); }
      } catch (error) { alert(error.message); }
    });

    // ADD ITEM: SENDING NEW SCHEMA KEYS
    document.getElementById('itemForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const item = {
        ref_code: document.getElementById('itemRef').value,
        name: document.getElementById('itemName').value,
        category: document.getElementById('itemCategory').value,
        qty_on_hand: parseInt(document.getElementById('itemQtyHand').value) || 1,
        buy_price: parseFloat(document.getElementById('itemBuyPrice').value) || 0,
        sell_price: parseFloat(document.getElementById('itemSellPrice').value) || 0
      };

      try {
        const response = await fetch('/api/inventory/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
        if (response.ok) { document.getElementById('itemForm').reset(); loadInventory(); alert('Item added successfully!'); }
        else { alert('Failed to add item'); }
      } catch (error) { alert(error.message); }
    });

    async function deleteItem(id) {
      if (!confirm('Are you sure?')) return;
      try {
        const response = await fetch('/api/inventory/' + id, { method: 'DELETE' });
        if (response.ok) { loadInventory(); alert('Item deleted!'); } else { alert('Failed'); }
      } catch (error) { alert(error.message); }
    }

    async function downloadInventoryReport() {
      if (inventoryItems.length === 0) { alert('No items!'); return; }
      
      let totalInventoryValue = 0;
      let totalPotentialValue = 0;
      inventoryItems.forEach(item => {
        totalInventoryValue += (item.qty_on_hand || 0) * (item.buy_price || 0);
        totalPotentialValue += (item.qty_on_hand || 0) * (item.sell_price || 0);
      });

      const reportData = {
        id: 'REP-' + Date.now(),
        date: new Date().toLocaleString(),
        items: inventoryItems,
        totalInventoryValue: \`RM \${totalInventoryValue.toFixed(2)}\`,
        totalPotentialValue: \`RM \${totalPotentialValue.toFixed(2)}\`
      };

      await fetch('/api/statements/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportData }) });
      const pdfResponse = await fetch('/generate-inventory-report-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportData }) });
      
      if (pdfResponse.ok) {
        const blob = await pdfResponse.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = \`inventory-report-\${reportData.id}.pdf\`; a.click();
        window.URL.revokeObjectURL(url);
      } else { alert('PDF Error'); }
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

function getReferencePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reference Report</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar"><h2>📋 Generate Reference Report</h2><button class="btn small" onclick="window.location.href='/?page=dashboard'">← Dashboard</button></div>
    <div class="card">
      <h3>Select Items</h3>
      <div class="search-section"><input type="text" id="referenceSearch" placeholder="Search..." oninput="loadAvailableItems()"></div>
      <div id="availableItems" class="invoice-items-list"></div>
    </div>
    <div class="card">
      <h3>Report Items</h3>
      <div id="referenceItems"></div>
      <div class="invoice-total"><h4>Total: RM <span id="referenceTotal">0.00</span></h4></div>
      <button class="btn info" onclick="downloadReferencePDF()">Download PDF</button>
    </div>
  </div>
  <script>${getJavaScript()}</script>
  <script>
    let selectedReferenceItems = [];
    let availableItems = [];

    async function loadAvailableItems() {
      const search = document.getElementById('referenceSearch').value;
      const response = await fetch('/api/inventory?search=' + search);
      availableItems = await response.json();
      const container = document.getElementById('availableItems');
      container.innerHTML = '';
      
      availableItems.forEach((item, index) => {
        container.innerHTML += \`
          <div class="invoice-item">
            <div style="display: flex; justify-content: space-between;">
              <div>
                <strong>\${item.name}</strong> (\${item.ref_code})<br>
                <small>Qty Hand: \${item.qty_on_hand} | Sell Price: RM \${(item.sell_price || 0).toFixed(2)}</small>
              </div>
              <button class="btn small" onclick="addToReference(\${index})">Add</button>
            </div>
          </div>\`;
      });
    }

    function addToReference(index) {
      const item = availableItems[index];
      const existing = selectedReferenceItems.find(i => i._id === item._id);
      if (existing) { existing.invoiceQty = (existing.invoiceQty || 1) + 1; } 
      else { selectedReferenceItems.push({ ...item, invoiceQty: 1 }); }
      updateReferenceDisplay();
    }

    function updateReferenceDisplay() {
      const container = document.getElementById('referenceItems');
      let total = 0;
      container.innerHTML = '';
      selectedReferenceItems.forEach((item, i) => {
        const itemTotal = item.invoiceQty * (item.sell_price || 0);
        total += itemTotal;
        container.innerHTML += \`
          <div class="invoice-item">
            <div style="display: flex; justify-content: space-between;">
              <div><strong>\${item.name}</strong><br>Qty: \${item.invoiceQty} x RM \${item.sell_price.toFixed(2)}</div>
              <button class="btn small danger" onclick="removeFromReference(\${i})">Remove</button>
            </div>
          </div>\`;
      });
      document.getElementById('referenceTotal').textContent = total.toFixed(2);
    }

    function removeFromReference(index) { selectedReferenceItems.splice(index, 1); updateReferenceDisplay(); }

    async function downloadReferencePDF() {
      if (selectedReferenceItems.length === 0) return alert('No items!');
      const referenceData = {
        date: new Date().toLocaleString(),
        items: selectedReferenceItems,
        total: parseFloat(document.getElementById('referenceTotal').textContent)
      };
      
      // Save then download logic
      const saveResponse = await fetch('/api/reference-reports/add', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({referenceData})});
      const saveResult = await saveResponse.json();
      referenceData.reportNumber = saveResult.reportNumber;

      const pdfResponse = await fetch('/generate-reference-report-pdf', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({referenceData})});
      if (pdfResponse.ok) {
        const blob = await pdfResponse.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'ref-report.pdf'; a.click();
        selectedReferenceItems = []; updateReferenceDisplay();
      }
    }
    loadAvailableItems();
  </script>
</body>
</html>`;
}

function getPurchasePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Purchase</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar"><h2>📥 Purchase (Stock In)</h2><button class="btn small" onclick="window.location.href='/?page=dashboard'">← Dashboard</button></div>
    <div class="card">
      <div class="form-row"><label>Supplier <input type="text" id="supplier"></label><label>Date <input type="date" id="purchaseDate"></label></div>
      <div class="search-section"><input type="text" id="purchaseSearch" placeholder="Search..." oninput="loadAvailableItems()"></div>
      <div id="availableItems" class="invoice-items-list"></div>
    </div>
    <div class="card">
      <h3>Cart</h3>
      <div id="purchaseItems"></div>
      <h4>Total: RM <span id="purchaseTotal">0.00</span></h4>
      <button class="btn primary" onclick="processPurchase()">Process Purchase</button>
    </div>
  </div>
  <script>${getJavaScript()}</script>
  <script>
    let selectedItems = [];
    let availableItems = [];

    async function loadAvailableItems() {
      const search = document.getElementById('purchaseSearch').value;
      const response = await fetch('/api/inventory?search=' + search);
      availableItems = await response.json();
      const container = document.getElementById('availableItems');
      container.innerHTML = '';
      availableItems.forEach((item, index) => {
        container.innerHTML += \`
          <div class="invoice-item">
            <div style="display: flex; justify-content: space-between;">
              <div><strong>\${item.name}</strong> (\${item.ref_code})<br>Buy Price: RM \${(item.buy_price||0).toFixed(2)}</div>
              <div><input type="number" id="qty-\${index}" value="1" style="width:50px"> <button class="btn small" onclick="add(\${index})">Add</button></div>
            </div>
          </div>\`;
      });
    }

    function add(index) {
      const item = availableItems[index];
      const qty = parseInt(document.getElementById('qty-'+index).value) || 1;
      selectedItems.push({ itemId: item._id, name: item.name, ref_code: item.ref_code, buy_price: item.buy_price, quantity: qty });
      updateDisplay();
    }

    function updateDisplay() {
      const container = document.getElementById('purchaseItems');
      let total = 0;
      container.innerHTML = '';
      selectedItems.forEach((item, i) => {
        total += item.quantity * (item.buy_price || 0);
        container.innerHTML += \`<div class="invoice-item"><strong>\${item.name}</strong> - \${item.quantity} x RM \${(item.buy_price||0).toFixed(2)} <button class="btn small danger" onclick="remove(\${i})">X</button></div>\`;
      });
      document.getElementById('purchaseTotal').textContent = total.toFixed(2);
    }
    function remove(i) { selectedItems.splice(i, 1); updateDisplay(); }

    async function processPurchase() {
      if(selectedItems.length === 0) return alert('No items');
      const purchaseData = {
        date: document.getElementById('purchaseDate').value,
        supplier: document.getElementById('supplier').value,
        items: selectedItems,
        total: parseFloat(document.getElementById('purchaseTotal').textContent)
      };
      
      const response = await fetch('/api/purchases', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({purchaseData})});
      const data = await response.json();
      if(response.ok) {
        // Auto Download PDF
        purchaseData.purchaseNumber = data.purchaseNumber;
        const pdf = await fetch('/generate-purchase-pdf', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({purchaseData})});
        const blob = await pdf.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'purchase.pdf'; a.click();
        
        selectedItems = []; updateDisplay(); alert('Purchase Success!'); loadAvailableItems();
      }
    }
    loadAvailableItems();
  </script>
</body>
</html>`;
}

function getSalesPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Sales</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar"><h2>📤 Sales (Stock Out)</h2><button class="btn small" onclick="window.location.href='/?page=dashboard'">← Dashboard</button></div>
    <div class="card">
      <div class="form-row"><label>Customer <input type="text" id="customer"></label><label>Date <input type="date" id="salesDate"></label></div>
      <div class="search-section"><input type="text" id="salesSearch" placeholder="Search..." oninput="loadAvailableItems()"></div>
      <div id="availableItems" class="invoice-items-list"></div>
    </div>
    <div class="card">
      <h3>Cart</h3>
      <div id="salesItems"></div>
      <h4>Total: RM <span id="salesTotal">0.00</span></h4>
      <button class="btn success" onclick="processSale()">Process Sale</button>
    </div>
  </div>
  <script>${getJavaScript()}</script>
  <script>
    let selectedItems = [];
    let availableItems = [];

    async function loadAvailableItems() {
      const search = document.getElementById('salesSearch').value;
      const response = await fetch('/api/inventory?search=' + search);
      availableItems = await response.json();
      const container = document.getElementById('availableItems');
      container.innerHTML = '';
      availableItems.forEach((item, index) => {
        container.innerHTML += \`
          <div class="invoice-item">
            <div style="display: flex; justify-content: space-between;">
              <div><strong>\${item.name}</strong> (\${item.ref_code})<br>Stock: \${item.qty_on_hand} | Price: RM \${(item.sell_price||0).toFixed(2)}</div>
              <div><input type="number" id="qty-\${index}" value="1" style="width:50px"> <button class="btn small" onclick="add(\${index})">Add</button></div>
            </div>
          </div>\`;
      });
    }

    function add(index) {
      const item = availableItems[index];
      const qty = parseInt(document.getElementById('qty-'+index).value) || 1;
      if (qty > item.qty_on_hand) return alert('Not enough stock!');
      selectedItems.push({ itemId: item._id, name: item.name, ref_code: item.ref_code, sell_price: item.sell_price, quantity: qty });
      updateDisplay();
    }

    function updateDisplay() {
      const container = document.getElementById('salesItems');
      let total = 0;
      container.innerHTML = '';
      selectedItems.forEach((item, i) => {
        total += item.quantity * (item.sell_price || 0);
        container.innerHTML += \`<div class="invoice-item"><strong>\${item.name}</strong> - \${item.quantity} x RM \${(item.sell_price||0).toFixed(2)} <button class="btn small danger" onclick="remove(\${i})">X</button></div>\`;
      });
      document.getElementById('salesTotal').textContent = total.toFixed(2);
    }
    function remove(i) { selectedItems.splice(i, 1); updateDisplay(); }

    async function processSale() {
      if(selectedItems.length === 0) return alert('No items');
      const salesData = {
        date: document.getElementById('salesDate').value,
        customer: document.getElementById('customer').value,
        items: selectedItems,
        total: parseFloat(document.getElementById('salesTotal').textContent)
      };
      
      const response = await fetch('/api/sales', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({salesData})});
      const data = await response.json();
      if(response.ok) {
        // Auto Download PDF
        salesData.salesNumber = data.salesNumber;
        const pdf = await fetch('/generate-sales-pdf', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({salesData})});
        const blob = await pdf.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'invoice.pdf'; a.click();
        
        selectedItems = []; updateDisplay(); alert('Sale Success!'); loadAvailableItems();
      }
    }
    loadAvailableItems();
  </script>
</body>
</html>`;
}

function getStatementPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Statements</title><style>${getCSS()}</style></head>
<body>
  <div class="container">
    <div class="topbar"><h2>📑 Statements</h2><button class="btn small" onclick="window.location.href='/?page=dashboard'">← Dashboard</button></div>
    <div class="card"><h3>Generated Reports</h3><div id="reportsList"></div></div>
    <div class="card"><h3>Purchase History</h3><div id="purchasesList"></div></div>
    <div class="card"><h3>Sales History</h3><div id="salesList"></div></div>
  </div>
  <script>${getJavaScript()}</script>
  <script>
    async function loadAll() {
      const rRep = await fetch('/api/statements').then(r => r.json());
      document.getElementById('reportsList').innerHTML = rRep.map(r => '<div>Report: ' + r.id + ' <button class="btn small" onclick="dlReport(\\''+r._id+'\\')">PDF</button></div>').join('');
      
      const rPur = await fetch('/api/purchases').then(r => r.json());
      document.getElementById('purchasesList').innerHTML = rPur.map(p => '<div>' + p.purchaseNumber + ' <button class="btn small" onclick="dlPur(\\''+p._id+'\\')">PDF</button></div>').join('');
      
      const rSal = await fetch('/api/sales').then(r => r.json());
      document.getElementById('salesList').innerHTML = rSal.map(s => '<div>' + s.salesNumber + ' <button class="btn small" onclick="dlSal(\\''+s._id+'\\')">PDF</button></div>').join('');
    }
    
    // Quick download handlers - reusing endpoints
    async function dlPur(id) {
       const p = await fetch('/api/purchases/'+id).then(r=>r.json());
       const res = await fetch('/generate-purchase-pdf', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({purchaseData:p}) });
       if(res.ok) window.open(URL.createObjectURL(await res.blob()));
    }
    async function dlSal(id) {
       const s = await fetch('/api/sales/'+id).then(r=>r.json());
       const res = await fetch('/generate-sales-pdf', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({salesData:s}) });
       if(res.ok) window.open(URL.createObjectURL(await res.blob()));
    }
    
    loadAll();
  </script>
</body>
</html>`;
}

function getSettingsPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Settings</title><style>${getCSS()}</style></head>
<body>
  <div class="container">
    <div class="topbar"><h2>⚙️ Settings</h2><button class="btn small" onclick="window.location.href='/?page=dashboard'">← Dashboard</button></div>
    <div class="card">
       <h3>Change Password</h3>
       <form id="pwForm">
         <input type="password" id="curPw" placeholder="Current" required>
         <input type="password" id="newPw" placeholder="New" required>
         <button type="submit" class="btn primary">Update</button>
       </form>
    </div>
  </div>
  <script>${getJavaScript()}</script>
  <script>
    document.getElementById('pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = JSON.parse(localStorage.getItem('currentUser')||'{}');
      const res = await fetch('/api/user/password', { method:'PUT', headers:{'Content-Type':'application/json'}, 
        body: JSON.stringify({ username: user.username, currentPassword: document.getElementById('curPw').value, newPassword: document.getElementById('newPw').value }) 
      });
      if(res.ok) alert('Password updated'); else alert('Error');
    });
  </script>
</body>
</html>`;
}

function getCSS() {
  return `
    :root { --accent: #3b82f6; --primary: #3b82f6; --success: #10b981; --danger: #ef4444; --info: #06b6d4; --radius: 12px; }
    body { font-family: "Poppins", sans-serif; background: #0f172a; color: #f1f5f9; margin: 0; min-height: 100vh; }
    body.light { background: #f8fafc; color: #1e293b; }
    .container { width: 90%; max-width: 1200px; margin: 30px auto; }
    .card { background: #1e293b; border-radius: var(--radius); padding: 20px; margin-top: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
    body.light .card { background: #fff; }
    .topbar { background: var(--accent); color: white; padding: 15px; border-radius: var(--radius); display: flex; justify-content: space-between; align-items: center; }
    .btn { background: var(--accent); color: white; border: none; padding: 8px 14px; border-radius: var(--radius); cursor: pointer; text-decoration: none; }
    .btn.primary { background: var(--primary); } .btn.success { background: var(--success); } .btn.danger { background: var(--danger); }
    input { width: 100%; padding: 10px; border-radius: var(--radius); background: #0f172a; color: white; border: 1px solid #475569; margin-top: 5px; }
    body.light input { background: #fff; color: black; border-color: #cbd5e1; }
    .table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    .table th, .table td { padding: 12px; border-bottom: 1px solid #334155; text-align: left; }
    .table th { background: var(--accent); color: white; }
    .form-row { display: flex; gap: 15px; margin-bottom: 15px; } .form-row label { flex: 1; }
    .value-summary { display: flex; gap: 20px; } .value-item { flex: 1; padding: 20px; border-radius: var(--radius); text-align: center; color: white; }
    .primary { background: var(--primary); } .success { background: var(--success); } .info { background: var(--info); }
    .auth-container { height: 100vh; display: flex; justify-content: center; align-items: center; background: url('https://images.pexels.com/photos/1103970/pexels-photo-1103970.jpeg') center/cover; }
    .auth-card { background: rgba(30,41,59,0.95); padding: 40px; border-radius: var(--radius); width: 100%; max-width: 400px; }
    .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); }
    .modal-content { background: #1e293b; margin: 10% auto; padding: 20px; width: 90%; max-width: 500px; border-radius: var(--radius); }
    .login-history-item { background: #334155; padding: 10px; margin-bottom: 5px; border-radius: 8px; }
    .invoice-item { background: #334155; padding: 10px; margin-bottom: 5px; border-radius: 8px; border-left: 4px solid var(--accent); }
  `;
}

function getJavaScript() {
  return `
    function getCurrentUser() { try { return JSON.parse(localStorage.getItem('currentUser') || '{}'); } catch (e) { return {}; } }
    function logout() { localStorage.removeItem('currentUser'); window.location.href = '/'; }
    function toggleTheme() { document.body.classList.toggle('light'); localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark'); }
    document.addEventListener('DOMContentLoaded', () => { if(localStorage.getItem('theme') === 'light') document.body.classList.add('light'); });
  `;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Server running on port ' + PORT);
  console.log('✅ SCHEMA UPDATED: SKU->ref_code, Quantity->qty_on_hand');
});
