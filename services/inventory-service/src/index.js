// services/inventory-service/src/index.js
const express = require("express");
const mongoose = require("mongoose");
const amqp = require("amqplib");

const app = express();
app.use(express.json());

// Configuration
const config = {
  port: process.env.PORT || 3003,
  mongoUrl: process.env.MONGO_URL || "mongodb://localhost:27017/inventory",
  rabbitmqUrl: process.env.RABBITMQ_URL || "amqp://localhost:5672",
};

// MongoDB Schema
const inventorySchema = new mongoose.Schema({
  productId: { type: String, required: true, unique: true },
  productName: { type: String, required: true },
  quantity: { type: Number, required: true, default: 0 },
  reserved: { type: Number, default: 0 },
  available: { type: Number, default: 0 },
  price: { type: Number, required: true },
  updatedAt: { type: Date, default: Date.now },
});

// Virtual field for available quantity
inventorySchema.pre("save", function (next) {
  this.available = this.quantity - this.reserved;
  next();
});

const Inventory = mongoose.model("Inventory", inventorySchema);

// Reservation tracking
const reservationSchema = new mongoose.Schema({
  orderId: { type: String, required: true },
  productId: { type: String, required: true },
  quantity: { type: Number, required: true },
  status: {
    type: String,
    enum: ["reserved", "confirmed", "released"],
    default: "reserved",
  },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
});

const Reservation = mongoose.model("Reservation", reservationSchema);

// RabbitMQ Connection
let channel;

async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect(config.rabbitmqUrl);
    channel = await connection.createChannel();

    await channel.assertQueue("payment.processed", { durable: true });
    await channel.assertQueue("inventory.updated", { durable: true });

    // Listen for successful payments
    channel.consume("payment.processed", async (msg) => {
      if (msg) {
        const payload = JSON.parse(msg.content.toString());
        await handlePaymentProcessed(payload);
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
  const { orderId, status } = payload;

  console.log(
    `📦 Processing inventory for order ${orderId}, payment status: ${status}`
  );

  if (status === "success") {
    // Confirm reservation and deduct inventory
    const reservations = await Reservation.find({
      orderId,
      status: "reserved",
    });

    for (const reservation of reservations) {
      const inventory = await Inventory.findOne({
        productId: reservation.productId,
      });

      if (inventory) {
        inventory.quantity -= reservation.quantity;
        inventory.reserved -= reservation.quantity;
        await inventory.save();

        reservation.status = "confirmed";
        await reservation.save();

        console.log(
          `✅ Inventory updated: ${reservation.productId} - ${reservation.quantity} units`
        );
      }
    }

    // Publish inventory.updated event
    const event = {
      orderId,
      status: "reserved",
      timestamp: new Date().toISOString(),
    };

    channel.sendToQueue(
      "inventory.updated",
      Buffer.from(JSON.stringify(event)),
      {
        persistent: true,
      }
    );
  } else {
    // Release reserved inventory
    await releaseReservation(orderId);
  }
}

async function releaseReservation(orderId) {
  const reservations = await Reservation.find({ orderId, status: "reserved" });

  for (const reservation of reservations) {
    const inventory = await Inventory.findOne({
      productId: reservation.productId,
    });

    if (inventory) {
      inventory.reserved -= reservation.quantity;
      await inventory.save();

      reservation.status = "released";
      await reservation.save();
    }
  }

  console.log(`🔓 Released inventory for order ${orderId}`);
}

// REST API Endpoints
app.post("/api/inventory/reserve", async (req, res) => {
  try {
    const { orderId, items } = req.body;

    const reservations = [];
    const insufficientItems = [];

    // Check availability for all items
    for (const item of items) {
      const inventory = await Inventory.findOne({ productId: item.productId });

      if (!inventory || inventory.available < item.quantity) {
        insufficientItems.push({
          productId: item.productId,
          requested: item.quantity,
          available: inventory ? inventory.available : 0,
        });
      }
    }

    if (insufficientItems.length > 0) {
      // Publish insufficient inventory event
      const event = {
        orderId,
        status: "insufficient",
        items: insufficientItems,
        timestamp: new Date().toISOString(),
      };

      channel.sendToQueue(
        "inventory.updated",
        Buffer.from(JSON.stringify(event)),
        {
          persistent: true,
        }
      );

      return res.status(400).json({
        success: false,
        error: "Insufficient inventory",
        items: insufficientItems,
      });
    }

    // Reserve inventory
    for (const item of items) {
      const inventory = await Inventory.findOne({ productId: item.productId });
      inventory.reserved += item.quantity;
      await inventory.save();

      const reservation = new Reservation({
        orderId,
        productId: item.productId,
        quantity: item.quantity,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
      });

      await reservation.save();
      reservations.push(reservation);
    }

    console.log(`🔒 Inventory reserved for order ${orderId}`);

    res.json({
      success: true,
      message: "Inventory reserved",
      reservations: reservations.map((r) => ({
        productId: r.productId,
        quantity: r.quantity,
        expiresAt: r.expiresAt,
      })),
    });
  } catch (error) {
    console.error("Error reserving inventory:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/inventory/:productId", async (req, res) => {
  try {
    const inventory = await Inventory.findOne({
      productId: req.params.productId,
    });

    if (!inventory) {
      return res
        .status(404)
        .json({ success: false, error: "Product not found" });
    }

    res.json({ success: true, inventory });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/inventory", async (req, res) => {
  try {
    const inventory = await Inventory.find();
    res.json({ success: true, inventory });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/inventory", async (req, res) => {
  try {
    const { productId, productName, quantity, price } = req.body;

    const inventory = new Inventory({
      productId,
      productName,
      quantity,
      price,
    });

    await inventory.save();

    res.status(201).json({ success: true, inventory });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy", service: "inventory-service" });
});

// Cleanup expired reservations (run every 5 minutes)
setInterval(async () => {
  try {
    const expiredReservations = await Reservation.find({
      status: "reserved",
      expiresAt: { $lt: new Date() },
    });

    for (const reservation of expiredReservations) {
      await releaseReservation(reservation.orderId);
    }

    if (expiredReservations.length > 0) {
      console.log(
        `🧹 Cleaned up ${expiredReservations.length} expired reservations`
      );
    }
  } catch (error) {
    console.error("Error cleaning expired reservations:", error);
  }
}, 5 * 60 * 1000);

// Start server
async function start() {
  try {
    await mongoose.connect(config.mongoUrl);
    console.log("✅ Connected to MongoDB");

    await connectRabbitMQ();

    app.listen(config.port, () => {
      console.log(`🚀 Inventory Service running on port ${config.port}`);
    });
  } catch (error) {
    console.error("Failed to start service:", error);
    process.exit(1);
  }
}

start();
