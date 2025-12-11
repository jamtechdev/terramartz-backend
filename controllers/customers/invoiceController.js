import { Purchase } from "../../models/customers/purchase.js";
import { User } from "../../models/users.js";
import { Product } from "../../models/seller/product.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

// ✅ Generate Invoice HTML
export const generateInvoice = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const userId = req.user._id || req.user.id;

  if (!orderId) {
    return next(new AppError("Order ID is required", 400));
  }

  // Find order - handle both String and ObjectId formats
  const userIdString = String(userId);
  const order = await Purchase.findOne({
    orderId: orderId,
    $or: [
      { buyer: userIdString },
      { buyer: userId },
    ],
  })
    .populate({
      path: "products.product",
      select: "title slug _id name price",
    })
    .populate({
      path: "products.seller",
      select: "name email shopName",
    })
    .lean();

  if (!order) {
    return next(new AppError("Order not found", 404));
  }

  // Get buyer details
  const buyer = await User.findById(userId).select("name email").lean();

  // Calculate totals
  const subtotal = order.products.reduce(
    (sum, p) => sum + p.price * p.quantity,
    0
  );
  const tax = order.shippingAddress?.taxAmount || 0;
  const shipping = order.shippingAddress?.shippingCost || 0;
  const total = order.totalAmount || subtotal + tax + shipping;

  // Generate HTML invoice
  const invoiceHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice - ${order.orderId}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      padding: 40px;
      background: #f5f5f5;
      color: #333;
    }
    .invoice-container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 2px solid #e5e5e5;
    }
    .logo {
      font-size: 24px;
      font-weight: bold;
      color: #f97316;
    }
    .invoice-title {
      text-align: right;
    }
    .invoice-title h1 {
      font-size: 32px;
      color: #333;
      margin-bottom: 5px;
    }
    .invoice-title p {
      color: #666;
      font-size: 14px;
    }
    .info-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      margin-bottom: 40px;
    }
    .info-box h3 {
      font-size: 14px;
      color: #666;
      text-transform: uppercase;
      margin-bottom: 10px;
      letter-spacing: 1px;
    }
    .info-box p {
      color: #333;
      line-height: 1.6;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    .items-table thead {
      background: #f97316;
      color: white;
    }
    .items-table th {
      padding: 15px;
      text-align: left;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 12px;
      letter-spacing: 0.5px;
    }
    .items-table td {
      padding: 15px;
      border-bottom: 1px solid #e5e5e5;
    }
    .items-table tbody tr:hover {
      background: #f9f9f9;
    }
    .text-right {
      text-align: right;
    }
    .totals {
      margin-left: auto;
      width: 300px;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #e5e5e5;
    }
    .total-row:last-child {
      border-bottom: none;
      border-top: 2px solid #333;
      margin-top: 10px;
      padding-top: 15px;
      font-size: 18px;
      font-weight: bold;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e5e5e5;
      text-align: center;
      color: #666;
      font-size: 12px;
    }
    .status-badge {
      display: inline-block;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-paid {
      background: #10b981;
      color: white;
    }
    .status-pending {
      background: #f59e0b;
      color: white;
    }
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .invoice-container {
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <div class="invoice-container">
    <div class="header">
      <div class="logo">Terramartz Marketplace</div>
      <div class="invoice-title">
        <h1>INVOICE</h1>
        <p>Order #${order.orderId}</p>
      </div>
    </div>

    <div class="info-section">
      <div class="info-box">
        <h3>Bill To</h3>
        <p>
          <strong>${buyer?.name || 'Customer'}</strong><br>
          ${buyer?.email || ''}<br>
          ${order.shippingAddress?.address || ''}<br>
          ${order.shippingAddress?.city || ''}, ${order.shippingAddress?.state || ''} ${order.shippingAddress?.zipCode || ''}<br>
          ${order.shippingAddress?.country || ''}
        </p>
      </div>
      <div class="info-box">
        <h3>Order Details</h3>
        <p>
          <strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}<br>
          <strong>Tracking Number:</strong> ${order.trackingNumber || 'N/A'}<br>
          <strong>Payment Status:</strong> 
          <span class="status-badge ${order.paymentStatus === 'paid' ? 'status-paid' : 'status-pending'}">
            ${order.paymentStatus || 'Pending'}
          </span><br>
          <strong>Order Status:</strong> ${order.status || 'New'}
        </p>
      </div>
    </div>

    <table class="items-table">
      <thead>
        <tr>
          <th>Item</th>
          <th>Quantity</th>
          <th class="text-right">Unit Price</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${order.products.map((item) => `
          <tr>
            <td>
              <strong>${item.product?.title || item.product?.name || 'Product'}</strong>
            </td>
            <td>${item.quantity}</td>
            <td class="text-right">$${item.price.toFixed(2)}</td>
            <td class="text-right">$${(item.price * item.quantity).toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="totals">
      <div class="total-row">
        <span>Subtotal:</span>
        <span>$${subtotal.toFixed(2)}</span>
      </div>
      ${shipping > 0 ? `
      <div class="total-row">
        <span>Shipping:</span>
        <span>$${shipping.toFixed(2)}</span>
      </div>
      ` : ''}
      ${tax > 0 ? `
      <div class="total-row">
        <span>Tax:</span>
        <span>$${tax.toFixed(2)}</span>
      </div>
      ` : ''}
      <div class="total-row">
        <span>Total:</span>
        <span>$${total.toFixed(2)}</span>
      </div>
    </div>

    <div class="footer">
      <p>Thank you for your business!</p>
      <p>Terramartz Marketplace - Fresh Products, Delivered Fresh</p>
    </div>
  </div>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Content-Disposition', `inline; filename="invoice-${order.orderId}.html"`);
  res.send(invoiceHTML);
});

