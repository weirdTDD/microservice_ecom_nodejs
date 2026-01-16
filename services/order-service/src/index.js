// services/order-service/src/index.js
const express = require("express");
const mongoose = require("mongoose");
const amqp = require("amqplib");

const app = express();
app.use(express.json());

// Configuration
const config = {
  port: process.env.PORT || 3001,
  mongoUrl: process.env.MONGO_URL || "mongodb://localhost:27017/orders",
  rabbitmqUrl: process.env.RABBITMQ_URL || "amqp://localhost:5672",
};

// MongoDB Schema
const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  items: [
    {
      productId: String,
      quantity: Number,
      price: Number,
    },
  ],
  totalAmount: { type: Number, required: true },
  status: {
    type: String,
    enum: ["pending", "payment_processing", "confirmed", "failed", "cancelled"],
    default: "pending",
  },
  paymentId: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Order = mongoose.model("Order", orderSchema);

// RabbitMQ Connection
let channel;

async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect(config.rabbitmqUrl);
    channel = await connection.createChannel();

    await channel.assertQueue("order.created", { durable: true });
    await channel.assertQueue("payment.processed", { durable: true });
    await channel.assertQueue("inventory.updated", { durable: true });

    // Listen for payment updates
    channel.consume("payment.processed", async (msg) => {
      if (msg) {
        const payload = JSON.parse(msg.content.toString());
        await handlePaymentProcessed(payload);
        channel.ack(msg);
      }
    });

    // Listen for inventory updates
    channel.consume("inventory.updated", async (msg) => {
      if (msg) {
        const payload = JSON.parse(msg.content.toString());
        await handleInventoryUpdated(payload);
        channel.ack(msg);
      }
    });

    console.log("✅ Connected to RabbitMQ");
  } catch (error) {
    console.error("❌ RabbitMQ connection error:", error);
    setTimeout(connectRabbitMQ, 5000);
  }
}

// Event Handlers
async function handlePaymentProcessed(payload) {
  const { orderId, status, paymentId } = payload;

  const order = await Order.findOne({ orderId });
  if (!order) return;

  if (status === "success") {
    order.status = "confirmed";
    order.paymentId = paymentId;
  } else {
    order.status = "failed";
  }

  order.updatedAt = new Date();
  await order.save();

  console.log(`📦 Order ${orderId} status updated: ${order.status}`);
}

async function handleInventoryUpdated(payload) {
  const { orderId, status } = payload;

  const order = await Order.findOne({ orderId });
  if (!order) return;

  if (status === "reserved") {
    console.log(`✅ Inventory reserved for order ${orderId}`);
  } else if (status === "insufficient") {
    order.status = "cancelled";
    order.updatedAt = new Date();
    await order.save();
    console.log(`❌ Order ${orderId} cancelled - insufficient inventory`);
  }
}

// REST API Endpoints
app.post("/api/orders", async (req, res) => {
  try {
    const { userId, items } = req.body;

    // Calculate total
    const totalAmount = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // Create order
    const order = new Order({
      orderId: `ORD-${Date.now()}`,
      userId,
      items,
      totalAmount,
      status: "pending",
    });

    await order.save();

    // Publish order.created event
    const event = {
      orderId: order.orderId,
      userId: order.userId,
      items: order.items,
      totalAmount: order.totalAmount,
      timestamp: new Date().toISOString(),
    };

    channel.sendToQueue("order.created", Buffer.from(JSON.stringify(event)), {
      persistent: true,
    });

    console.log(`📝 Order created: ${order.orderId}`);

    res.status(201).json({
      success: true,
      order: {
        orderId: order.orderId,
        status: order.status,
        totalAmount: order.totalAmount,
      },
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/orders/:orderId", async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });

    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/orders/user/:userId", async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.params.userId }).sort({
      createdAt: -1,
    });
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy", service: "order-service" });
});

// Start server
async function start() {
  try {
    await mongoose.connect(config.mongoUrl);
    console.log("✅ Connected to MongoDB");

    await connectRabbitMQ();

    app.listen(config.port, () => {
      console.log(`🚀 Order Service running on port ${config.port}`);
    });
  } catch (error) {
    console.error("Failed to start service:", error);
    process.exit(1);
  }
}

start();
