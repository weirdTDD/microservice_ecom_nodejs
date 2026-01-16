// api-gateway/src/index.js
const express = require("express");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const cors = require("cors");

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Configuration
const config = {
  port: process.env.PORT || 8080,
  services: {
    order: process.env.ORDER_SERVICE_URL || "http://localhost:3001",
    payment: process.env.PAYMENT_SERVICE_URL || "http://localhost:3002",
    inventory: process.env.INVENTORY_SERVICE_URL || "http://localhost:3003",
  },
};

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

app.use("/api/", limiter);

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Authentication middleware (simplified - add JWT in production)
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "No authorization header" });
  }

  // In production, verify JWT token here
  const userId = authHeader.replace("Bearer ", "");
  req.userId = userId;
  next();
};

// Proxy helper function
async function proxyRequest(serviceUrl, path, method, data, headers) {
  try {
    const response = await axios({
      method,
      url: `${serviceUrl}${path}`,
      data,
      headers,
      timeout: 10000,
    });

    return response.data;
  } catch (error) {
    if (error.response) {
      throw {
        status: error.response.status,
        data: error.response.data,
      };
    }
    throw {
      status: 503,
      data: { error: "Service unavailable" },
    };
  }
}

// ===== ORDER SERVICE ROUTES =====
app.post("/api/orders", authenticate, async (req, res) => {
  try {
    const result = await proxyRequest(
      config.services.order,
      "/api/orders",
      "POST",
      { ...req.body, userId: req.userId },
      req.headers
    );
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 500).json(error.data);
  }
});

app.get("/api/orders/:orderId", authenticate, async (req, res) => {
  try {
    const result = await proxyRequest(
      config.services.order,
      `/api/orders/${req.params.orderId}`,
      "GET",
      null,
      req.headers
    );
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error.data);
  }
});

app.get("/api/orders/user/:userId", authenticate, async (req, res) => {
  try {
    const result = await proxyRequest(
      config.services.order,
      `/api/orders/user/${req.params.userId}`,
      "GET",
      null,
      req.headers
    );
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error.data);
  }
});

// ===== PAYMENT SERVICE ROUTES =====
app.get("/api/payments/:paymentId", authenticate, async (req, res) => {
  try {
    const result = await proxyRequest(
      config.services.payment,
      `/api/payments/${req.params.paymentId}`,
      "GET",
      null,
      req.headers
    );
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error.data);
  }
});

app.get("/api/payments/order/:orderId", authenticate, async (req, res) => {
  try {
    const result = await proxyRequest(
      config.services.payment,
      `/api/payments/order/${req.params.orderId}`,
      "GET",
      null,
      req.headers
    );
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error.data);
  }
});

app.post("/api/payments/retry/:orderId", authenticate, async (req, res) => {
  try {
    const result = await proxyRequest(
      config.services.payment,
      `/api/payments/retry/${req.params.orderId}`,
      "POST",
      req.body,
      req.headers
    );
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error.data);
  }
});

// ===== INVENTORY SERVICE ROUTES =====
app.get("/api/inventory", async (req, res) => {
  try {
    const result = await proxyRequest(
      config.services.inventory,
      "/api/inventory",
      "GET",
      null,
      req.headers
    );
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error.data);
  }
});

app.get("/api/inventory/:productId", async (req, res) => {
  try {
    const result = await proxyRequest(
      config.services.inventory,
      `/api/inventory/${req.params.productId}`,
      "GET",
      null,
      req.headers
    );
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error.data);
  }
});

app.post("/api/inventory", authenticate, async (req, res) => {
  try {
    const result = await proxyRequest(
      config.services.inventory,
      "/api/inventory",
      "POST",
      req.body,
      req.headers
    );
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 500).json(error.data);
  }
});

app.post("/api/inventory/reserve", authenticate, async (req, res) => {
  try {
    const result = await proxyRequest(
      config.services.inventory,
      "/api/inventory/reserve",
      "POST",
      req.body,
      req.headers
    );
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error.data);
  }
});

// ===== COMPOSITE ENDPOINT =====
// Create order with inventory check
app.post("/api/orders/complete", authenticate, async (req, res) => {
  try {
    const { items } = req.body;

    // Step 1: Reserve inventory
    const reservationResult = await proxyRequest(
      config.services.inventory,
      "/api/inventory/reserve",
      "POST",
      { orderId: `TEMP-${Date.now()}`, items },
      req.headers
    );

    if (!reservationResult.success) {
      return res.status(400).json(reservationResult);
    }

    // Step 2: Create order
    const orderResult = await proxyRequest(
      config.services.order,
      "/api/orders",
      "POST",
      { ...req.body, userId: req.userId },
      req.headers
    );

    res.status(201).json({
      success: true,
      order: orderResult.order,
      reservation: reservationResult.reservations,
    });
  } catch (error) {
    res.status(error.status || 500).json(error.data);
  }
});

// ===== HEALTH CHECK =====
app.get("/health", async (req, res) => {
  const services = {
    gateway: "healthy",
    order: "unknown",
    payment: "unknown",
    inventory: "unknown",
  };

  // Check all services
  try {
    await axios.get(`${config.services.order}/health`, { timeout: 3000 });
    services.order = "healthy";
  } catch (e) {
    services.order = "unhealthy";
  }

  try {
    await axios.get(`${config.services.payment}/health`, { timeout: 3000 });
    services.payment = "healthy";
  } catch (e) {
    services.payment = "unhealthy";
  }

  try {
    await axios.get(`${config.services.inventory}/health`, { timeout: 3000 });
    services.inventory = "healthy";
  } catch (e) {
    services.inventory = "unhealthy";
  }

  const allHealthy = Object.values(services).every((s) => s === "healthy");

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? "healthy" : "degraded",
    services,
    timestamp: new Date().toISOString(),
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Start server
app.listen(config.port, () => {
  console.log(`🚀 API Gateway running on port ${config.port}`);
  console.log(`📡 Order Service: ${config.services.order}`);
  console.log(`💳 Payment Service: ${config.services.payment}`);
  console.log(`📦 Inventory Service: ${config.services.inventory}`);
});
