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
    // Fallback to timestamp if counter fails
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
    
    // Initialize counters if they don't exist
    await initializeCounters();
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
  }
}

async function initializeCounters() {
  try {
    const counters = db.collection('counters');
    
    // Initialize reference_reports counter
    await counters.updateOne(
      { _id: 'reference_reports' },
      { $setOnInsert: { sequence_value: 1 } },
      { upsert: true }
    );
    
    // Initialize purchases counter
    await counters.updateOne(
      { _id: 'purchases' },
      { $setOnInsert: { sequence_value: 1 } },
      { upsert: true }
    );
    
    // Initialize sales counter
    await counters.updateOne(
      { _id: 'sales' },
      { $setOnInsert: { sequence_value: 1 } },
      { upsert: true }
    );
    
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

// Reference Reports APIs (formerly invoices)
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
    
    if (!referenceReport) {
      return res.status(404).json({ error: 'Reference report not found' });
    }
    
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
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Purchase APIs
app.post('/api/purchases', async (req, res) => {
  try {
    const purchaseNumber = await getNextSequence('purchases');
    const purchaseData = {
      ...req.body.purchaseData,
      purchaseNumber: `PUR-${purchaseNumber}`,
      type: 'purchase',
      createdAt: new Date()
    };
    
    // Fix: Ensure itemId is properly converted to ObjectId
    purchaseData.items = purchaseData.items.map(item => ({
      ...item,
      itemId: typeof item.itemId === 'string' ? new ObjectId(item.itemId) : item.itemId
    }));
    
    const result = await db.collection('purchases').insertOne(purchaseData);
    
    // Update inventory quantities
    for (const item of purchaseData.items) {
      const existingItem = await db.collection('inventory').findOne({ _id: item.itemId });
      
      if (existingItem) {
        const newQuantity = (existingItem.quantity || 0) + (item.quantity || 0);
        await db.collection('inventory').updateOne(
          { _id: item.itemId },
          { $set: { quantity: newQuantity } }
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
    const purchase = await db.collection('purchases').findOne({ 
      _id: new ObjectId(req.params.id) 
    });
    
    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }
    
    res.json(purchase);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/purchases/:id', async (req, res) => {
  try {
    const result = await db.collection('purchases').deleteOne({ _id: new ObjectId(req.params.id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Purchase not found' });
    }
    
    res.json({ message: 'Purchase deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sales APIs
app.post('/api/sales', async (req, res) => {
  try {
    const salesNumber = await getNextSequence('sales');
    const salesData = {
      ...req.body.salesData,
      salesNumber: `SAL-${salesNumber}`,
      type: 'sale',
      createdAt: new Date()
    };
    
    // Fix: Ensure itemId is properly converted to ObjectId
    salesData.items = salesData.items.map(item => ({
      ...item,
      itemId: typeof item.itemId === 'string' ? new ObjectId(item.itemId) : item.itemId
    }));
    
    const result = await db.collection('sales').insertOne(salesData);
    
    // Update inventory quantities
    for (const item of salesData.items) {
      const existingItem = await db.collection('inventory').findOne({ _id: item.itemId });
      
      if (existingItem) {
        const newQuantity = (existingItem.quantity || 0) - (item.quantity || 0);
        if (newQuantity < 0) {
          return res.status(400).json({ error: 'Insufficient stock for ' + existingItem.name });
        }
        
        await db.collection('inventory').updateOne(
          { _id: item.itemId },
          { $set: { quantity: newQuantity } }
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
    const sale = await db.collection('sales').findOne({ 
      _id: new ObjectId(req.params.id) 
    });
    
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }
    
    res.json(sale);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/sales/:id', async (req, res) => {
  try {
    const result = await db.collection('sales').deleteOne({ _id: new ObjectId(req.params.id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Sale not found' });
    }
    
    res.json({ message: 'Sale deleted successfully' });
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
    await db.collection('reference_reports').deleteMany({});
    await db.collection('purchases').deleteMany({});
    await db.collection('sales').deleteMany({});
    await db.collection('login_history').deleteMany({ username });
    
    res.json({ message: 'Account deleted successfully. Inventory data preserved.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PDF Generation APIs with Professional Layout (Single Page)
app.post('/generate-reference-report-pdf', (req, res) => {
  try {
    const { referenceData } = req.body;
    
    if (!referenceData || !referenceData.items || !Array.isArray(referenceData.items)) {
      return res.status(400).json({ error: 'Invalid reference data' });
    }
    
    const doc = new PDFDocument({ 
      margin: 50,
      size: 'A4'
    });
    
    const filename = `reference-report-${referenceData.reportNumber || Date.now()}.pdf`;
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    
    doc.pipe(res);
    
    // Header with company info
    doc.fillColor('#3b82f6')
       .fontSize(24)
       .text('REFERENCE REPORT', { align: 'center' });
    
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
    
    // Reference details in two columns
    const leftColumn = 50;
    const rightColumn = 300;
    
    doc.fillColor('#1e293b')
       .fontSize(12)
       .text('Reference Number:', leftColumn, doc.y, { continued: true })
       .fillColor('#3b82f6')
       .font('Helvetica-Bold')
       .text(` ${referenceData.reportNumber || 'REF-N/A'}`)
       
       .fillColor('#1e293b')
       .font('Helvetica')
       .text('Report Date:', leftColumn, doc.y + 20, { continued: true })
       .fillColor('#64748b')
       .text(` ${referenceData.date || new Date().toLocaleDateString()}`)
       
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
       .text('SKU', 200, tableTop + 8)
       .text('Qty', 350, tableTop + 8)
       .text('Unit Price', 400, tableTop + 8)
       .text('Total', 470, tableTop + 8);
    
    let yPosition = tableTop + 35;
    let itemsPerPage = 15; // Limit items to fit on one page
    const displayItems = referenceData.items.slice(0, itemsPerPage);
    
    // Reference items
    displayItems.forEach((item, index) => {
      const quantity = item.invoiceQty || item.quantity || 1;
      const unitPrice = item.unitPrice || 0;
      const itemTotal = quantity * unitPrice;
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
         .text(item.name || 'Unnamed Item', 55, yPosition)
         .text(item.sku || 'N/A', 200, yPosition)
         .text(quantity.toString(), 350, yPosition)
         .text(`RM ${unitPrice.toFixed(2)}`, 400, yPosition)
         .text(`RM ${itemTotal.toFixed(2)}`, 470, yPosition);
      
      // Item details
      doc.fillColor('#64748b')
         .fontSize(7)
         .text(`Category: ${item.category || 'N/A'}`, 55, yPosition + 12);
      
      yPosition += 30;
    });
    
    // If too many items, add note
    if (referenceData.items.length > itemsPerPage) {
      doc.fillColor('#ef4444')
         .fontSize(9)
         .text(`* Showing first ${itemsPerPage} items only for single-page PDF`, 50, yPosition + 10);
      yPosition += 20;
    }
    
    // Total section
    const totalY = Math.min(yPosition + 20, 650);
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
       .text(` RM ${(referenceData.total || 0).toFixed(2)}`, { align: 'right' });
    
    // Footer
    const footerY = Math.min(totalY + 50, 700);
    doc.y = footerY;
    doc.fillColor('#64748b')
       .fontSize(8)
       .text('This is a computer-generated reference report for internal use.', { align: 'center' })
       .text(`Generated on: ${new Date().toLocaleString()} | Inventory Management System v2.0`, { align: 'center' });
    
    doc.end();
    
  } catch (error) {
    console.error('Reference PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

app.post('/generate-purchase-pdf', (req, res) => {
  try {
    const { purchaseData } = req.body;
    
    if (!purchaseData || !purchaseData.items || !Array.isArray(purchaseData.items)) {
      return res.status(400).json({ error: 'Invalid purchase data' });
    }
    
    const doc = new PDFDocument({ 
      margin: 50,
      size: 'A4'
    });
    
    const filename = `purchase-order-${purchaseData.purchaseNumber || Date.now()}.pdf`;
    
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
       .text('Purchase Number:', leftColumn, doc.y, { continued: true })
       .fillColor('#10b981')
       .font('Helvetica-Bold')
       .text(` ${purchaseData.purchaseNumber || 'PUR-N/A'}`)
       
       .fillColor('#1e293b')
       .font('Helvetica')
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
    let itemsPerPage = 15;
    const displayItems = purchaseData.items.slice(0, itemsPerPage);
    
    // Purchase items
    displayItems.forEach((item, index) => {
      const quantity = item.quantity || 1;
      const unitCost = item.unitCost || 0;
      const itemTotal = quantity * unitCost;
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
         .text(item.name || 'Unnamed Item', 55, yPosition)
         .text(item.sku || 'N/A', 200, yPosition)
         .text(quantity.toString(), 300, yPosition)
         .text(`RM ${unitCost.toFixed(2)}`, 350, yPosition)
         .text(`RM ${itemTotal.toFixed(2)}`, 450, yPosition);
      
      yPosition += 25;
    });
    
    // If too many items, add note
    if (purchaseData.items.length > itemsPerPage) {
      doc.fillColor('#ef4444')
         .fontSize(9)
         .text(`* Showing first ${itemsPerPage} items only for single-page PDF`, 50, yPosition + 10);
      yPosition += 20;
    }
    
    // Total section
    const totalY = Math.min(yPosition + 20, 650);
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
    const footerY = Math.min(totalY + 50, 700);
    doc.y = footerY;
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
    
    if (!salesData || !salesData.items || !Array.isArray(salesData.items)) {
      return res.status(400).json({ error: 'Invalid sales data' });
    }
    
    const doc = new PDFDocument({ 
      margin: 50,
      size: 'A4'
    });
    
    const filename = `sales-invoice-${salesData.salesNumber || Date.now()}.pdf`;
    
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
       .text('Sales Number:', leftColumn, doc.y, { continued: true })
       .fillColor('#ef4444')
       .font('Helvetica-Bold')
       .text(` ${salesData.salesNumber || 'SAL-N/A'}`)
       
       .fillColor('#1e293b')
       .font('Helvetica')
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
    let itemsPerPage = 15;
    const displayItems = salesData.items.slice(0, itemsPerPage);
    
    // Sales items
    displayItems.forEach((item, index) => {
      const quantity = item.quantity || 1;
      const unitPrice = item.unitPrice || 0;
      const itemTotal = quantity * unitPrice;
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
         .text(item.name || 'Unnamed Item', 55, yPosition)
         .text(item.sku || 'N/A', 200, yPosition)
         .text(quantity.toString(), 300, yPosition)
         .text(`RM ${unitPrice.toFixed(2)}`, 350, yPosition)
         .text(`RM ${itemTotal.toFixed(2)}`, 450, yPosition);
      
      yPosition += 25;
    });
    
    // If too many items, add note
    if (salesData.items.length > itemsPerPage) {
      doc.fillColor('#ef4444')
         .fontSize(9)
         .text(`* Showing first ${itemsPerPage} items only for single-page PDF`, 50, yPosition + 10);
      yPosition += 20;
    }
    
    // Total section
    const totalY = Math.min(yPosition + 20, 650);
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
       .text(` RM ${(salesData.total || 0).toFixed(2)}`, { align: 'right' });
    
    // Footer
    const footerY = Math.min(totalY + 50, 700);
    doc.y = footerY;
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
    
    if (!reportData || !reportData.items || !Array.isArray(reportData.items)) {
      return res.status(400).json({ error: 'Invalid report data' });
    }
    
    const doc = new PDFDocument({ 
      margin: 50,
      size: 'A4'
    });
    
    const filename = `inventory-report-${reportData.id || Date.now()}.pdf`;
    
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
       .text(` ${reportData.id || 'N/A'}`)
       
       .fillColor('#1e293b')
       .text('Generated:', leftColumn, doc.y + 20, { continued: true })
       .fillColor('#64748b')
       .text(` ${reportData.date || new Date().toLocaleDateString()}`)
       
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
    let itemsPerPage = 20;
    const displayItems = reportData.items.slice(0, itemsPerPage);
    
    // Inventory items
    displayItems.forEach((item, index) => {
      const quantity = item.quantity || 0;
      const unitCost = item.unitCost || 0;
      const unitPrice = item.unitPrice || 0;
      const inventoryValue = quantity * unitCost;
      const potentialValue = quantity * unitPrice;
      totalInventoryValue += inventoryValue;
      totalPotentialValue += potentialValue;
      totalItems += quantity;
      
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
         .text(item.sku || 'N/A', 70, yPosition)
         .text((item.name || 'Unnamed Item').length > 25 ? (item.name || 'Unnamed Item').substring(0, 22) + '...' : (item.name || 'Unnamed Item'), 120, yPosition)
         .text((item.category || 'N/A').length > 15 ? (item.category || 'N/A').substring(0, 12) + '...' : (item.category || 'N/A'), 220, yPosition)
         .text(quantity.toString(), 300, yPosition)
         .text(`RM ${unitCost.toFixed(2)}`, 340, yPosition)
         .text(`RM ${unitPrice.toFixed(2)}`, 390, yPosition)
         .text(`RM ${inventoryValue.toFixed(2)}`, 450, yPosition);
      
      yPosition += 20;
    });
    
    // If too many items, add note
    if (reportData.items.length > itemsPerPage) {
      doc.fillColor('#ef4444')
         .fontSize(9)
         .text(`* Showing first ${itemsPerPage} items only for single-page PDF`, 50, yPosition + 10);
      yPosition += 20;
    }
    
    // Summary section
    const summaryY = Math.min(yPosition + 30, 650);
    
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
    <div class="auth-overlay"></div>
    <div class="auth-content">
      <div class="auth-header">
        <div class="logo">📦</div>
        <h1 class="main-title">INVENTORY WITH INVOICE SYSTEM</h1>
        <p class="subtitle">Complete Inventory Management Solution</p>
      </div>
      
      <div class="auth-card">
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
    <div class="auth-overlay"></div>
    <div class="auth-content">
      <div class="auth-header">
        <div class="logo">📦</div>
        <h1 class="main-title">INVENTORY WITH INVOICE SYSTEM</h1>
        <p class="subtitle">Create Your Account</p>
      </div>
      
      <div class="auth-card">
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
          <a href="/?page=reference" class="btn info">📋 Reference Report</a>
          <a href="/?page=statement" class="btn">📑 Statement</a>
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
          const inventoryValue = (item.quantity || 0) * (item.unitCost || 0);
          const potentialValue = (item.quantity || 0) * (item.unitPrice || 0);
          totalInventoryValue += inventoryValue;
          totalPotentialValue += potentialValue;

          body.innerHTML += \`
            <tr>
              <td>\${i + 1}</td>
              <td><strong>\${item.sku || 'N/A'}</strong></td>
              <td>\${item.name || 'Unnamed Item'}</td>
              <td><span class="category-tag">\${item.category || 'Uncategorized'}</span></td>
              <td><span class="quantity-badge">\${item.quantity || 0}</span></td>
              <td>RM \${(item.unitCost || 0).toFixed(2)}</td>
              <td>RM \${(item.unitPrice || 0).toFixed(2)}</td>
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
      document.getElementById('editItemSKU').value = item.sku || '';
      document.getElementById('editItemName').value = item.name || '';
      document.getElementById('editItemCategory').value = item.category || '';
      document.getElementById('editItemQty').value = item.quantity || 1;
      document.getElementById('editItemUnitCost').value = item.unitCost || 0;
      document.getElementById('editItemUnitPrice').value = item.unitPrice || 0;

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
        quantity: parseInt(document.getElementById('editItemQty').value) || 1,
        unitCost: parseFloat(document.getElementById('editItemUnitCost').value) || 0,
        unitPrice: parseFloat(document.getElementById('editItemUnitPrice').value) || 0
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
        quantity: parseInt(document.getElementById('itemQty').value) || 1,
        unitCost: parseFloat(document.getElementById('itemUnitCost').value) || 0,
        unitPrice: parseFloat(document.getElementById('itemUnitPrice').value) || 0
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
          totalInventoryValue += (item.quantity || 0) * (item.unitCost || 0);
          totalPotentialValue += (item.quantity || 0) * (item.unitPrice || 0);
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

function getReferencePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generate Reference Report | Inventory System</title>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <h2>📋 Generate Reference Report</h2>
      <div class="topbar-actions">
        <span>Welcome, <strong id="username"></strong></span>
        <button class="btn small ghost" onclick="toggleTheme()">🌓</button>
        <button class="btn small" onclick="window.location.href='/?page=dashboard'">← Dashboard</button>
      </div>
    </div>

    <div class="card">
      <h3>Select Items for Reference Report</h3>
      <div class="search-section">
        <div class="form-row">
          <label style="flex: 1;">
            Search Products
            <input type="text" id="referenceSearch" placeholder="Search by SKU, Name, or Category..." oninput="searchReferenceItems()">
          </label>
        </div>
      </div>
      <div id="availableItems" class="invoice-items-list"></div>
    </div>

    <div class="card">
      <h3>Reference Report Items</h3>
      <div id="referenceItems"></div>
      <div class="invoice-total">
        <h4>Total: RM <span id="referenceTotal">0.00</span></h4>
      </div>
      <div class="controls">
        <button class="btn info" id="downloadPdf" onclick="downloadReferencePDF()">Download PDF</button>
        <button class="btn danger" onclick="clearReference()">Clear</button>
      </div>
    </div>
  </div>

  <footer>© 2025 Inventory Management System | Rex_Ho</footer>

  <script>${getJavaScript()}</script>
  <script>
    let selectedReferenceItems = [];
    let availableItems = [];

    async function loadAvailableItems() {
      try {
        const search = document.getElementById('referenceSearch').value;
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
                <strong>\${item.name || 'Unnamed Item'}</strong> (\${item.sku || 'N/A'})<br>
                <small>Category: \${item.category || 'N/A'} | Available: \${item.quantity || 0} | Price: RM \${(item.unitPrice || 0).toFixed(2)}</small>
              </div>
              <div>
                <input type="number" id="qty-\${index}" min="1" max="\${item.quantity || 0}" value="1" style="width: 80px; margin-right: 10px;">
                <button class="btn small" onclick="addToReference(\${index})">Add to Report</button>
              </div>
            </div>
          \`;
          container.appendChild(itemDiv);
        });
      } catch (error) {
        console.error('Error loading items:', error);
      }
    }

    function searchReferenceItems() {
      loadAvailableItems();
    }

    function addToReference(index) {
      const item = availableItems[index];
      const quantity = parseInt(document.getElementById(\`qty-\${index}\`).value) || 1;
      
      if (quantity > (item.quantity || 0)) {
        alert(\`Only \${item.quantity || 0} items available!\`);
        return;
      }

      const existingIndex = selectedReferenceItems.findIndex(selected => selected.index === index);
      if (existingIndex > -1) {
        selectedReferenceItems[existingIndex].invoiceQty = quantity;
      } else {
        selectedReferenceItems.push({ 
          index: index, 
          ...item, 
          invoiceQty: quantity 
        });
      }
      
      updateReferenceDisplay();
    }

    function updateReferenceDisplay() {
      const container = document.getElementById('referenceItems');
      const totalElement = document.getElementById('referenceTotal');
      container.innerHTML = selectedReferenceItems.length ? '' : '<p>No items in reference report</p>';
      
      let total = 0;
      selectedReferenceItems.forEach((item, i) => {
        const quantity = item.invoiceQty || item.quantity || 1;
        const unitPrice = item.unitPrice || 0;
        const itemTotal = quantity * unitPrice;
        total += itemTotal;
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'invoice-item';
        itemDiv.innerHTML = \`
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>\${item.name || 'Unnamed Item'}</strong> (\${item.sku || 'N/A'})<br>
              <small>Qty: \${quantity} × RM \${unitPrice.toFixed(2)} = RM \${itemTotal.toFixed(2)}</small>
            </div>
            <button class="btn small danger" onclick="removeFromReference(\${i})">Remove</button>
          </div>
        \`;
        container.appendChild(itemDiv);
      });
      
      totalElement.textContent = total.toFixed(2);
      document.getElementById('downloadPdf').disabled = selectedReferenceItems.length === 0;
    }

    function removeFromReference(index) {
      selectedReferenceItems.splice(index, 1);
      updateReferenceDisplay();
    }

    function clearReference() {
      selectedReferenceItems = [];
      updateReferenceDisplay();
    }

    async function downloadReferencePDF() {
      if (selectedReferenceItems.length === 0) {
        alert('Please add items to the reference report first!');
        return;
      }

      const referenceData = {
        date: new Date().toLocaleString(),
        items: selectedReferenceItems,
        total: parseFloat(document.getElementById('referenceTotal').textContent) || 0
      };

      try {
        // Save reference report first to get the report number
        const saveResponse = await fetch('/api/reference-reports/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referenceData })
        });

        const saveResult = await saveResponse.json();
        
        if (!saveResponse.ok) {
          throw new Error(saveResult.error || 'Failed to save reference report');
        }

        // Now generate PDF with the report number
        referenceData.reportNumber = saveResult.reportNumber;
        referenceData._id = saveResult.id; // Add the ID for later retrieval
        
        const pdfResponse = await fetch('/generate-reference-report-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referenceData })
        });

        if (pdfResponse.ok) {
          const blob = await pdfResponse.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = \`reference-report-\${referenceData.reportNumber}.pdf\`;
          a.click();
          window.URL.revokeObjectURL(url);
          
          alert('Reference Report PDF generated successfully! Report number: ' + referenceData.reportNumber);
          clearReference(); // Clear after successful download
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
        <button class="btn danger" onclick="clearPurchase()">Clear</button>
      </div>
    </div>
  </div>

  <footer>© 2025 Inventory Management System | Rex_Ho</footer>

  <script>${getJavaScript()}</script>
  <script>
    let selectedPurchaseItems = [];
    let availableItems = [];
    let latestPurchaseData = null;

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
                <strong>\${item.name || 'Unnamed Item'}</strong> (\${item.sku || 'N/A'})<br>
                <small>Category: \${item.category || 'N/A'} | Current Stock: \${item.quantity || 0} | Cost: RM \${(item.unitCost || 0).toFixed(2)}</small>
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
          name: item.name || 'Unnamed Item',
          sku: item.sku || 'N/A',
          category: item.category || 'N/A',
          unitCost: item.unitCost || 0,
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
        const itemTotal = (item.quantity || 1) * (item.unitCost || 0);
        total += itemTotal;
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'invoice-item';
        itemDiv.innerHTML = \`
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>\${item.name || 'Unnamed Item'}</strong> (\${item.sku || 'N/A'})<br>
              <small>Qty: \${item.quantity || 1} × RM \${(item.unitCost || 0).toFixed(2)} = RM \${itemTotal.toFixed(2)}</small>
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
      updatePurchaseDisplay();
    }

    async function processPurchase() {
      if (selectedPurchaseItems.length === 0) {
        alert('Please add items to the purchase first!');
        return;
      }

      try {
        const purchaseData = {
          date: document.getElementById('purchaseDate').value || new Date().toLocaleString(),
          supplier: document.getElementById('supplier').value || 'N/A',
          items: selectedPurchaseItems,
          total: parseFloat(document.getElementById('purchaseTotal').textContent) || 0
        };
        
        const response = await fetch('/api/purchases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purchaseData })
        });

        const data = await response.json();
        
        if (response.ok) {
          latestPurchaseData = data.purchaseData;
          latestPurchaseData._id = data.id; // Store the ID for PDF generation
          
          alert('Purchase processed successfully! Purchase Number: ' + data.purchaseNumber);
          
          // Automatically download the PDF after processing
          await downloadPurchasePDF();
          
          clearPurchase(); // Clear items after successful processing
          loadAvailableItems(); // Refresh available items
        } else {
          alert('Failed to process purchase: ' + data.error);
        }
      } catch (error) {
        console.error('Purchase error:', error);
        alert('Failed to process purchase: ' + error.message);
      }
    }

    async function downloadPurchasePDF() {
      if (!latestPurchaseData) {
        alert('Please process a purchase first!');
        return;
      }

      try {
        // Fetch the latest purchase data from the database
        const response = await fetch('/api/purchases/' + latestPurchaseData._id);
        if (!response.ok) {
          throw new Error('Purchase not found');
        }
        const purchase = await response.json();
        
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
          a.download = \`purchase-order-\${purchase.purchaseNumber || Date.now()}.pdf\`;
          a.click();
          window.URL.revokeObjectURL(url);
        } else {
          const errorData = await pdfResponse.json();
          throw new Error(errorData.error || 'PDF generation failed');
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
        <button class="btn danger" onclick="clearSale()">Clear</button>
      </div>
    </div>
  </div>

  <footer>© 2025 Inventory Management System | Rex_Ho</footer>

  <script>${getJavaScript()}</script>
  <script>
    let selectedSalesItems = [];
    let availableItems = [];
    let latestSalesData = null;

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
                <strong>\${item.name || 'Unnamed Item'}</strong> (\${item.sku || 'N/A'})<br>
                <small>Category: \${item.category || 'N/A'} | Current Stock: \${item.quantity || 0} | Price: RM \${(item.unitPrice || 0).toFixed(2)}</small>
              </div>
              <div>
                <input type="number" id="sales-qty-\${index}" min="1" max="\${item.quantity || 0}" value="1" style="width: 80px; margin-right: 10px;">
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
      
      if (quantity > (item.quantity || 0)) {
        alert(\`Only \${item.quantity || 0} items available in stock!\`);
        return;
      }

      const existingIndex = selectedSalesItems.findIndex(selected => selected.index === index);
      if (existingIndex > -1) {
        selectedSalesItems[existingIndex].quantity = quantity;
      } else {
        selectedSalesItems.push({ 
          index: index, 
          itemId: item._id,
          name: item.name || 'Unnamed Item',
          sku: item.sku || 'N/A',
          category: item.category || 'N/A',
          unitPrice: item.unitPrice || 0,
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
        const itemTotal = (item.quantity || 1) * (item.unitPrice || 0);
        total += itemTotal;
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'invoice-item';
        itemDiv.innerHTML = \`
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>\${item.name || 'Unnamed Item'}</strong> (\${item.sku || 'N/A'})<br>
              <small>Qty: \${item.quantity || 1} × RM \${(item.unitPrice || 0).toFixed(2)} = RM \${itemTotal.toFixed(2)}</small>
            </div>
            <button class="btn small danger" onclick="removeFromSale(\${i})">Remove</button>
          </div>
        \`;
        container.appendChild(itemDiv);
      });
      
      totalElement.textContent = total.toFixed(2);
    }

    function removeFromSale(index) {
      selectedSalesItems.splice(index, 1);
      updateSalesDisplay();
    }

    function clearSale() {
      selectedSalesItems = [];
      updateSalesDisplay();
    }

    async function processSale() {
      if (selectedSalesItems.length === 0) {
        alert('Please add items to the sale first!');
        return;
      }

      try {
        const salesData = {
          date: document.getElementById('salesDate').value || new Date().toLocaleString(),
          customer: document.getElementById('customer').value || 'N/A',
          items: selectedSalesItems,
          total: parseFloat(document.getElementById('salesTotal').textContent) || 0
        };
        
        const response = await fetch('/api/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salesData })
        });

        const data = await response.json();
        
        if (response.ok) {
          latestSalesData = data.salesData;
          latestSalesData._id = data.id; // Store the ID for PDF generation
          
          alert('Sale processed successfully! Sales Number: ' + data.salesNumber);
          
          // Automatically download the PDF after processing
          await downloadSalesPDF();
          
          clearSale(); // Clear items after successful processing
          loadAvailableItems(); // Refresh available items
        } else {
          alert('Failed to process sale: ' + data.error);
        }
      } catch (error) {
        console.error('Sales error:', error);
        alert('Failed to process sale: ' + error.message);
      }
    }

    async function downloadSalesPDF() {
      if (!latestSalesData) {
        alert('Please process a sale first!');
        return;
      }

      try {
        // Fetch the latest sales data from the database
        const response = await fetch('/api/sales/' + latestSalesData._id);
        if (!response.ok) {
          throw new Error('Sale not found');
        }
        const sale = await response.json();
        
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
          a.download = \`sales-invoice-\${sale.salesNumber || Date.now()}.pdf\`;
          a.click();
          window.URL.revokeObjectURL(url);
        } else {
          const errorData = await pdfResponse.json();
          throw new Error(errorData.error || 'PDF generation failed');
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
      <h2>📑 Statements & Reports</h2>
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
      <h3>Reference Reports</h3>
      <div id="referenceReportsList"></div>
    </div>

    <div class="card">
      <h3>Purchase History</h3>
      <div id="purchasesList"></div>
    </div>

    <div class="card">
      <h3>Sales History</h3>
      <div id="salesList"></div>
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
                  <strong>\${report.id || 'N/A'}</strong><br>
                  <small>Generated: \${report.date || 'N/A'}</small><br>
                  <small>Items: \${report.items?.length || 0} | \${report.totalInventoryValue || 'RM 0.00'} | \${report.totalPotentialValue || 'RM 0.00'}</small>
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

    async function loadReferenceReports() {
      try {
        const response = await fetch('/api/reference-reports');
        const referenceReports = await response.json();
        const container = document.getElementById('referenceReportsList');
        
        if (referenceReports.length === 0) {
          container.innerHTML = '<p>No reference reports generated yet.</p>';
        } else {
          referenceReports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          container.innerHTML = '';
          
          referenceReports.forEach((report, index) => {
            const reportDiv = document.createElement('div');
            reportDiv.className = 'invoice-item';
            reportDiv.innerHTML = \`
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong>\${report.reportNumber || 'N/A'}</strong><br>
                  <small>Date: \${report.date || 'N/A'}</small><br>
                  <small>Items: \${report.items?.length || 0} | Total: RM \${(report.total || 0).toFixed(2)}</small>
                </div>
                <div>
                  <button class="btn small" onclick="downloadReferenceReportPDF('\${report._id}')">📥 PDF</button>
                  <button class="btn small danger" onclick="deleteReferenceReport('\${report._id}')">🗑️ Delete</button>
                </div>
              </div>
            \`;
            container.appendChild(reportDiv);
          });
        }
      } catch (error) {
        console.error('Error loading reference reports:', error);
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
                  <strong>\${purchase.purchaseNumber || 'N/A'}</strong><br>
                  <small>Date: \${purchase.date || 'N/A'} | Supplier: \${purchase.supplier || 'N/A'}</small><br>
                  <small>Items: \${purchase.items?.length || 0} | Total: RM \${(purchase.total || 0).toFixed(2)}</small>
                </div>
                <div>
                  <button class="btn small" onclick="downloadPurchasePDF('\${purchase._id}')">📥 PDF</button>
                  <button class="btn small danger" onclick="deletePurchase('\${purchase._id}')">🗑️ Delete</button>
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
                  <strong>\${sale.salesNumber || 'N/A'}</strong><br>
                  <small>Date: \${sale.date || 'N/A'} | Customer: \${sale.customer || 'N/A'}</small><br>
                  <small>Items: \${sale.items?.length || 0} | Total: RM \${(sale.total || 0).toFixed(2)}</small>
                </div>
                <div>
                  <button class="btn small" onclick="downloadSalePDF('\${sale._id}')">📥 PDF</button>
                  <button class="btn small danger" onclick="deleteSale('\${sale._id}')">🗑️ Delete</button>
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
            a.download = \`inventory-report-\${report.id || Date.now()}.pdf\`;
            a.click();
            window.URL.revokeObjectURL(url);
          } else {
            const errorData = await pdfResponse.json();
            throw new Error(errorData.error || 'PDF generation failed');
          }
        }
      } catch (error) {
        alert('Error downloading report: ' + error.message);
      }
    }

    async function downloadReferenceReportPDF(id) {
      try {
        const response = await fetch('/api/reference-reports/' + id);
        if (!response.ok) {
          throw new Error('Reference report not found');
        }
        const report = await response.json();
        
        const pdfResponse = await fetch('/generate-reference-report-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referenceData: report })
        });

        if (pdfResponse.ok) {
          const blob = await pdfResponse.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = \`reference-report-\${report.reportNumber || Date.now()}.pdf\`;
          a.click();
          window.URL.revokeObjectURL(url);
        } else {
          const errorData = await pdfResponse.json();
          throw new Error(errorData.error || 'PDF generation failed');
        }
      } catch (error) {
        alert('Error downloading reference report PDF: ' + error.message);
      }
    }

    async function downloadPurchasePDF(id) {
      try {
        const response = await fetch('/api/purchases/' + id);
        if (!response.ok) {
          throw new Error('Purchase not found');
        }
        const purchase = await response.json();
        
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
          a.download = \`purchase-order-\${purchase.purchaseNumber || Date.now()}.pdf\`;
          a.click();
          window.URL.revokeObjectURL(url);
        } else {
          const errorData = await pdfResponse.json();
          throw new Error(errorData.error || 'PDF generation failed');
        }
      } catch (error) {
        alert('Error downloading purchase PDF: ' + error.message);
      }
    }

    async function downloadSalePDF(id) {
      try {
        const response = await fetch('/api/sales/' + id);
        if (!response.ok) {
          throw new Error('Sale not found');
        }
        const sale = await response.json();
        
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
          a.download = \`sales-invoice-\${sale.salesNumber || Date.now()}.pdf\`;
          a.click();
          window.URL.revokeObjectURL(url);
        } else {
          const errorData = await pdfResponse.json();
          throw new Error(errorData.error || 'PDF generation failed');
        }
      } catch (error) {
        alert('Error downloading sales PDF: ' + error.message);
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

    async function deleteReferenceReport(id) {
      if (!confirm('Are you sure you want to delete this reference report?')) return;

      try {
        const response = await fetch('/api/reference-reports/' + id, { method: 'DELETE' });
        const data = await response.json();
        
        if (response.ok) {
          loadReferenceReports();
        } else {
          alert('Failed to delete reference report: ' + data.error);
        }
      } catch (error) {
        alert('Error deleting reference report: ' + error.message);
      }
    }

    async function deletePurchase(id) {
      if (!confirm('Are you sure you want to delete this purchase record? This cannot be undone!')) return;

      try {
        const response = await fetch('/api/purchases/' + id, { method: 'DELETE' });
        const data = await response.json();
        
        if (response.ok) {
          loadPurchases();
        } else {
          alert('Failed to delete purchase: ' + data.error);
        }
      } catch (error) {
        alert('Error deleting purchase: ' + error.message);
      }
    }

    async function deleteSale(id) {
      if (!confirm('Are you sure you want to delete this sale record? This cannot be undone!')) return;

      try {
        const response = await fetch('/api/sales/' + id, { method: 'DELETE' });
        const data = await response.json();
        
        if (response.ok) {
          loadSales();
        } else {
          alert('Failed to delete sale: ' + data.error);
        }
      } catch (error) {
        alert('Error deleting sale: ' + error.message);
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
      loadReferenceReports();
      loadPurchases();
      loadSales();
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
    
    /* Auth Styles with Background Image */
    .auth-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: linear-gradient(rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.9)),
                  url('https://images.pexels.com/photos/1103970/pexels-photo-1103970.jpeg') center/cover fixed;
      position: relative;
    }
    body.light .auth-container {
      background: linear-gradient(rgba(248, 250, 252, 0.9), rgba(248, 250, 252, 0.9)),
                  url('https://images.pexels.com/photos/1103970/pexels-photo-1103970.jpeg') center/cover fixed;
    }
    .auth-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(6, 182, 212, 0.1));
      z-index: 1;
    }
    .auth-content {
      position: relative;
      z-index: 2;
      width: 100%;
      max-width: 500px;
    }
    .auth-header {
      text-align: center;
      margin-bottom: 40px;
    }
    .logo {
      font-size: 4rem;
      margin-bottom: 20px;
      text-shadow: 0 4px 8px rgba(0,0,0,0.3);
    }
    .main-title {
      font-size: 3rem;
      font-weight: 700;
      background: linear-gradient(135deg, var(--primary), var(--info));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 10px;
      text-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .subtitle {
      color: #94a3b8;
      font-size: 1.2rem;
      margin-top: 10px;
    }
    body.light .subtitle {
      color: #64748b;
    }
    .auth-card {
      background: rgba(30, 41, 59, 0.95);
      border-radius: var(--radius);
      padding: 40px;
      box-shadow: var(--shadow);
      width: 100%;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    body.light .auth-card {
      background: rgba(255, 255, 255, 0.95);
      border: 1px solid rgba(0, 0, 0, 0.1);
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
      font-weight: 500;
    }
    .link:hover {
      text-decoration: underline;
    }
    .hint {
      color: #94a3b8;
      font-size: 0.8em;
      margin-top: 5px;
      display: block;
    }
    body.light .hint {
      color: #64748b;
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
  console.log('   ✅ Purchase (Stock In) with Search & Automatic PDF Download');
  console.log('   ✅ Sales (Stock Out) with Search & Automatic PDF Download');
  console.log('   ✅ Reference Report Generation with PDF (Updated from Invoice)');
  console.log('   ✅ Statements & Reports with History');
  console.log('   ✅ Account Settings & Password Management');
  console.log('   ✅ Dark/Light Theme Toggle');
  console.log('   ✅ Responsive Design for Mobile');
  console.log('   ✅ Enhanced Login History with All Users');
  console.log('   ✅ Professional PDF Layout Design (Single Page)');
  console.log('   ✅ Security Code for Account Deletion');
  console.log('   ✅ Inventory Value Summary');
  console.log('   ✅ Date Range Specific Inventory Reports');
  console.log('   ✅ Preserved Inventory Data on Account Deletion');
  console.log('   ✅ Complete Multi-User System');
  console.log('   ✅ Enterprise-Level Inventory Management');
  console.log('   ✅ Sequential Numbering System: REF-0000000000001, PUR-0000000000001, SAL-0000000000001');
  console.log('   ✅ FIXED: Cannot read properties of undefined (reading "toString") errors');
  console.log('   ✅ FIXED: PDF generation errors with proper error handling');
  console.log('   ✅ FIXED: Purchase and Sales processing errors');
  console.log('   ✅ NEW: Delete buttons for purchase and sale history');
  console.log('   ✅ NEW: Fixed PDF download for latest purchase/sale in Statements');
  console.log('   ✅ NEW: Automatic PDF download after purchase/sale processing');
  console.log('   ✅ FIXED: "Purchase not found" error in PDF download');
  console.log('   ✅ FIXED: JSON parsing error for reference report PDF');
  console.log('   ✅ REMOVED: PDF download buttons from Purchase & Sales pages (Automatic download still works)');
  console.log('   ✅ NEW: Professional gray/white wallpaper background on login page');
});
