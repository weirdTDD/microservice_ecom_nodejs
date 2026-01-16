// services/payment-service/src/index.js
const express = require("express");
const { Pool } = require("pg");
const amqp = require("amqplib");

const app = express();
app.use(express.json());

// Configuration
const config = {
  port: process.env.PORT || 3002,
  pgConfig: {
    host: process.env.PG_HOST || "localhost",
    port: process.env.PG_PORT || 5432,
    database: process.env.PG_DATABASE || "payments",
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "postgres",
  },
  rabbitmqUrl: process.env.RABBITMQ_URL || "amqp://localhost:5672",
};

// PostgreSQL Setup
const pool = new Pool(config.pgConfig);

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        payment_id VARCHAR(100) UNIQUE NOT NULL,
        order_id VARCHAR(100) NOT NULL,
        user_id VARCHAR(100) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        payment_method VARCHAR(50),
        transaction_id VARCHAR(200),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Database tables initialized");
  } finally {
    client.release();
  }
}

// RabbitMQ Connection
let channel;

async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect(config.rabbitmqUrl);
    channel = await connection.createChannel();

    await channel.assertQueue("order.created", { durable: true });
    await channel.assertQueue("payment.processed", { durable: true });

    // Listen for new orders
    channel.consume("order.created", async (msg) => {
      if (msg) {
        const payload = JSON.parse(msg.content.toString());
        await processOrderPayment(payload);
        channel.ack(msg);
      }
    });

    console.log("✅ Connected to RabbitMQ");
  } catch (error) {
    console.error("❌ RabbitMQ connection error:", error);
    setTimeout(connectRabbitMQ, 5000);
  }
}

// Payment Processing Logic
async function processOrderPayment(orderData) {
  const { orderId, userId, totalAmount } = orderData;

  console.log(`💳 Processing payment for order ${orderId}`);

  const client = await pool.connect();
  try {
    const paymentId = `PAY-${Date.now()}`;

    // Simulate payment processing (replace with real payment gateway)
    const paymentSuccess = await simulatePaymentGateway(totalAmount);

    const status = paymentSuccess ? "success" : "failed";
    const transactionId = paymentSuccess ? `TXN-${Date.now()}` : null;

    // Store payment record
    await client.query(
      `INSERT INTO payments (payment_id, order_id, user_id, amount, status, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [paymentId, orderId, userId, totalAmount, status, transactionId]
    );

    // Publish payment.processed event
    const event = {
      orderId,
      paymentId,
      status,
      amount: totalAmount,
      transactionId,
      timestamp: new Date().toISOString(),
    };

    channel.sendToQueue(
      "payment.processed",
      Buffer.from(JSON.stringify(event)),
      {
        persistent: true,
      }
    );

    console.log(
      `${status === "success" ? "✅" : "❌"} Payment ${paymentId} ${status}`
    );
  } catch (error) {
    console.error("Error processing payment:", error);
  } finally {
    client.release();
  }
}

// Simulate Payment Gateway (replace with Stripe, PayPal, etc.)
async function simulatePaymentGateway(amount) {
  return new Promise((resolve) => {
    setTimeout(() => {
      // 90% success rate for simulation
      const success = Math.random() > 0.1;
      resolve(success);
    }, 1000);
  });
}

// REST API Endpoints
app.get("/api/payments/:paymentId", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM payments WHERE payment_id = $1",
      [req.params.paymentId]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Payment not found" });
    }

    res.json({ success: true, payment: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/payments/order/:orderId", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM payments WHERE order_id = $1",
      [req.params.orderId]
    );

    res.json({ success: true, payments: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/payments/retry/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    // Get order details (in real scenario, fetch from order service)
    const result = await pool.query(
      "SELECT * FROM payments WHERE order_id = $1 AND status = $2",
      [orderId, "failed"]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "No failed payment found" });
    }

    // Trigger retry (publish to queue)
    const orderEvent = {
      orderId,
      userId: result.rows[0].user_id,
      totalAmount: parseFloat(result.rows[0].amount),
    };

    await processOrderPayment(orderEvent);

    res.json({ success: true, message: "Payment retry initiated" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy", service: "payment-service" });
});

// Start server
async function start() {
  try {
    await initDatabase();
    await connectRabbitMQ();

    app.listen(config.port, () => {
      console.log(`🚀 Payment Service running on port ${config.port}`);
    });
  } catch (error) {
    console.error("Failed to start service:", error);
    process.exit(1);
  }
}

start();
