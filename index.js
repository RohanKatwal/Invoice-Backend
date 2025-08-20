const express = require('express');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

require('dotenv').config();

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(error => console.error('Error connecting to MongoDB:', error));

// Invoice Schema
const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  clientInfo: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    address: { type: String },
    phone: { type: String }
  },
  companyInfo: {
    name: { type: String, default: 'Your Company Name' },
    address: { type: String, default: '123 Business St, City, State 12345' },
    email: { type: String, default: 'hello@yourcompany.com' },
    phone: { type: String, default: '+1 (555) 123-4567' }
  },
  items: [{
    description: { type: String, required: true },
    quantity: { type: Number, required: true },
    rate: { type: Number, required: true },
    amount: { type: Number, required: true }
  }],
  subtotal: { type: Number, required: true },
  tax: { type: Number, default: 0 },
  total: { type: Number, required: true },
  status: { type: String, enum: ['draft', 'sent', 'paid'], default: 'draft' },
  dueDate: { type: Date },
  createdAt: { type: Date, default: Date.now },
  pdfPath: { type: String }
});

const Invoice = mongoose.model('Invoice', invoiceSchema);

// Utility function to generate invoice number
const generateInvoiceNumber = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const timestamp = Date.now().toString().slice(-6);
  return `INV-${year}${month}-${timestamp}`;
};

// PDF Generation Function
const generateInvoicePDF = (invoiceData, outputPath) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // Company Logo and Header
      const logoPath = path.join(__dirname, 'logo.png');
      let logoHeight = 0;
      
      if (fs.existsSync(logoPath)) {
        try {
          // Add logo - adjust size as needed
          doc.image(logoPath, 50, 50, { width: 120, height: 60 });
          logoHeight = 70; // Space for logo + margin
        } catch (logoError) {
          console.warn('Could not load logo:', logoError.message);
          logoHeight = 0;
        }
      }

      // Company Header (positioned after logo)
      const headerY = 50 + logoHeight;
      doc.fontSize(20).text(invoiceData.companyInfo.name, 50, headerY);
      doc.fontSize(12)
         .text(invoiceData.companyInfo.address, 50, headerY + 30)
         .text(invoiceData.companyInfo.email, 50, headerY + 45)
         .text(invoiceData.companyInfo.phone, 50, headerY + 60);

      // Invoice Title and Number (adjust position based on logo)
      const invoiceTitleY = Math.max(50, headerY);
      doc.fontSize(24).text('INVOICE', 400, invoiceTitleY);
      doc.fontSize(12).text(`Invoice #: ${invoiceData.invoiceNumber}`, 400, invoiceTitleY + 30);
      doc.text(`Date: ${new Date(invoiceData.createdAt).toLocaleDateString()}`, 400, invoiceTitleY + 45);
      if (invoiceData.dueDate) {
        doc.text(`Due Date: ${new Date(invoiceData.dueDate).toLocaleDateString()}`, 400, invoiceTitleY + 60);
      }

      // Client Information (adjust position based on header)
      const clientY = Math.max(160, headerY + 100);
      doc.fontSize(16).text('Bill To:', 50, clientY);
      doc.fontSize(12)
         .text(invoiceData.clientInfo.name, 50, clientY + 20)
         .text(invoiceData.clientInfo.email, 50, clientY + 35);
      
      let clientInfoHeight = 55;
      if (invoiceData.clientInfo.address) {
        doc.text(invoiceData.clientInfo.address, 50, clientY + 50);
        clientInfoHeight += 15;
      }
      if (invoiceData.clientInfo.phone) {
        doc.text(invoiceData.clientInfo.phone, 50, clientY + 50 + (invoiceData.clientInfo.address ? 15 : 0));
        clientInfoHeight += 15;
      }

      // Items Table Header (adjust position based on client info)
      const tableTop = clientY + clientInfoHeight + 30;
      doc.fontSize(12);
      
      // Table headers
      doc.text('Description', 50, tableTop);
      doc.text('Qty', 300, tableTop);
      doc.text('Rate', 350, tableTop);
      doc.text('Amount', 450, tableTop);
      
      // Line under headers
      doc.moveTo(50, tableTop + 15)
         .lineTo(550, tableTop + 15)
         .stroke();

      // Items
      let yPosition = tableTop + 30;
      invoiceData.items.forEach((item, index) => {
        doc.text(item.description, 50, yPosition);
        doc.text(item.quantity.toString(), 300, yPosition);
        doc.text(`$${item.rate.toFixed(2)}`, 350, yPosition);
        doc.text(`$${item.amount.toFixed(2)}`, 450, yPosition);
        yPosition += 20;
      });

      // Totals
      yPosition += 20;
      doc.moveTo(350, yPosition)
         .lineTo(550, yPosition)
         .stroke();
      
      yPosition += 10;
      doc.text('Subtotal:', 350, yPosition);
      doc.text(`$${invoiceData.subtotal.toFixed(2)}`, 450, yPosition);
      
      if (invoiceData.tax > 0) {
        yPosition += 20;
        doc.text('Tax:', 350, yPosition);
        doc.text(`$${invoiceData.tax.toFixed(2)}`, 450, yPosition);
      }
      
      yPosition += 20;
      doc.fontSize(14).text('Total:', 350, yPosition);
      doc.text(`$${invoiceData.total.toFixed(2)}`, 450, yPosition);

      // Footer
      doc.fontSize(10)
         .text('Thank you for your business!', 50, yPosition + 80);

      doc.end();
      
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
};

// Ensure invoices directory exists
const invoicesDir = path.join(__dirname, 'invoices');
if (!fs.existsSync(invoicesDir)) {
  fs.mkdirSync(invoicesDir, { recursive: true });
}

// Routes

// Create Invoice
app.post('/api/invoices', async (req, res) => {
  try {
    const { clientInfo, companyInfo, items, tax, dueDate, status } = req.body;

    // Validate required fields
    if (!clientInfo || !clientInfo.name || !clientInfo.email) {
      return res.status(400).json({ error: 'Client name and email are required' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    // Calculate totals
    let subtotal = 0;
    const processedItems = items.map(item => {
      const amount = item.quantity * item.rate;
      subtotal += amount;
      return {
        description: item.description,
        quantity: item.quantity,
        rate: item.rate,
        amount: amount
      };
    });

    const taxAmount = tax || 0;
    const total = subtotal + taxAmount;

    // Create invoice data
    const invoiceData = {
      invoiceNumber: generateInvoiceNumber(),
      clientInfo,
      companyInfo: companyInfo || {},
      items: processedItems,
      subtotal,
      tax: taxAmount,
      total,
      status: status || 'draft',
      dueDate: dueDate ? new Date(dueDate) : null
    };

    // Save to database
    const invoice = new Invoice(invoiceData);
    await invoice.save();

    // Generate PDF
    const pdfFileName = `invoice-${invoice.invoiceNumber}.pdf`;
    const pdfPath = path.join(invoicesDir, pdfFileName);
    
    await generateInvoicePDF(invoice, pdfPath);
    
    // Update invoice with PDF path
    invoice.pdfPath = pdfPath;
    await invoice.save();

    res.status(201).json({
      message: 'Invoice created successfully',
      invoice: {
        id: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.clientInfo.name,
        total: invoice.total,
        status: invoice.status,
        createdAt: invoice.createdAt,
        downloadUrl: `/api/invoices/${invoice._id}/download`
      }
    });

  } catch (error) {
    console.error('Error creating invoice:', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// List All Invoices
app.get('/api/invoices', async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const query = status ? { status } : {};
    
    const invoices = await Invoice.find(query)
      .select('invoiceNumber clientInfo.name total status createdAt dueDate')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Invoice.countDocuments(query);
    
    res.json({
      invoices: invoices.map(invoice => ({
        id: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.clientInfo.name,
        total: invoice.total,
        status: invoice.status,
        createdAt: invoice.createdAt,
        dueDate: invoice.dueDate,
        downloadUrl: `/api/invoices/${invoice._id}/download`
      })),
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// Get Single Invoice
app.get('/api/invoices/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({
      ...invoice.toObject(),
      downloadUrl: `/api/invoices/${invoice._id}/download`
    });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// Download Invoice PDF
app.get('/api/invoices/:id/download', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (!invoice.pdfPath || !fs.existsSync(invoice.pdfPath)) {
      // Regenerate PDF if missing
      const pdfFileName = `invoice-${invoice.invoiceNumber}.pdf`;
      const pdfPath = path.join(invoicesDir, pdfFileName);
      
      await generateInvoicePDF(invoice, pdfPath);
      invoice.pdfPath = pdfPath;
      await invoice.save();
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
    
    const stream = fs.createReadStream(invoice.pdfPath);
    stream.pipe(res);
  } catch (error) {
    console.error('Error downloading invoice:', error);
    res.status(500).json({ error: 'Failed to download invoice' });
  }
});

// Update Invoice Status
app.patch('/api/invoices/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['draft', 'sent', 'paid'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const invoice = await Invoice.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({ message: 'Invoice status updated', invoice });
  } catch (error) {
    console.error('Error updating invoice status:', error);
    res.status(500).json({ error: 'Failed to update invoice status' });
  }
});

// Delete Invoice
app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Delete PDF file if exists
    if (invoice.pdfPath && fs.existsSync(invoice.pdfPath)) {
      fs.unlinkSync(invoice.pdfPath);
    }

    await Invoice.findByIdAndDelete(req.params.id);
    
    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Invoice Generator API running on port index ${PORT}`);
});

module.exports = app;