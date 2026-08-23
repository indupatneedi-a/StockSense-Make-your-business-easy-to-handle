import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      appName: "StockSense",
      tagline: "Track, Trade & Manage Business Stocks with Precision Intelligence",
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // Chat endpoint
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history = [], storeContext } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      const client = getGeminiClient();

      if (!client) {
        // Fallback intelligent response if API key is not yet set in environment
        return res.json({
          reply: `I'm your **StockSense AI Assistant**! I can help you monitor inventory valuation, check stock on hand, record stock-in purchases, adjust inventory quantities, and register sales.\n\n*(Note: To enable live Gemini AI reasoning, configure GEMINI_API_KEY in your environment).*`,
          action: null,
        });
      }

      const systemInstruction = `You are "StockSense AI", an intelligent business management and inventory assistant whose core mission is: "Make your business easy to handle".
Your job is to help business owners track inventory & stock of physical goods, check product details and stock valuation, add new products, update/adjust stock quantities, record purchases/stock-in, record sales billing, and make day-to-day business operations effortless.
Note: This application is for physical goods, products, and retail/wholesale business management (not financial stocks or stock market shares).

Current Business Inventory & State Context:
- Business Name: ${storeContext?.businessName || "My Business"}
- Tagline: "Make your business easy to handle"
- Currency: ${storeContext?.currencySymbol || "₹"}
- Total Products: ${storeContext?.productsCount || 0}
- Low/Out of Stock count: ${storeContext?.lowStockCount || 0}
- Current Products List: ${JSON.stringify(storeContext?.products || [])}
- Categories: ${JSON.stringify(storeContext?.categories || [])}
- Suppliers: ${JSON.stringify(storeContext?.suppliers || [])}
- Recent Sales Summary: ${JSON.stringify(storeContext?.recentSalesSummary || {})}

Guidelines:
1. Always be polite, clear, concise, and professional.
2. If the user asks about stock details (e.g. "how many units of item X do I have?", "check stock of item Y", "what items are low in stock?"), examine the current products list and give exact stock counts, valuation, buying & selling prices, and status.
3. If the user asks to ADD A NEW PRODUCT (e.g. "add product Wireless Mouse buy price 400 sell price 650 initial stock 25", "create item Cotton Shirts"):
   Return a structured action with actionType: "ADD_PRODUCT" and complete details.
4. If the user asks to ADJUST / UPDATE STOCK (e.g. "add 20 units to item X", "set inventory of item Y to 50", "increase stock by 10"):
   Return a structured action with actionType: "ADJUST_STOCK" or "RECORD_PURCHASE".
5. If the user asks to RECORD A SALE / BILL (e.g. "sold 2 units of item X to customer for ₹500 cash"):
   Return a structured action with actionType: "RECORD_SALE".
6. Always answer in clear, formatted Markdown.`;

      const response = await client.models.generateContent({
        model: "gemini-3.7-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `User request: ${message}\n\nPlease respond in JSON format with two fields:
1. "reply": Markdown formatted friendly text response to the user.
2. "action": Optional action object if the user intended to add product, adjust stock, or record sale. If no action, set to null.
Action Schema:
- ADD_PRODUCT: { "actionType": "ADD_PRODUCT", "name": string, "category": string, "unitType": string, "purchasePrice": number, "sellingPrice": number, "initialStock": number, "minStockLevel": number }
- ADJUST_STOCK: { "actionType": "ADJUST_STOCK", "productName": string, "productId": string (if known), "newQuantity": number, "delta": number, "reason": string }
- RECORD_PURCHASE: { "actionType": "RECORD_PURCHASE", "productName": string, "productId": string (if known), "quantity": number, "purchasePricePerUnit": number, "supplierName": string }
- RECORD_SALE: { "actionType": "RECORD_SALE", "productName": string, "productId": string (if known), "quantity": number, "sellingPricePerUnit": number, "paymentMethod": string, "customerName": string }`,
              },
            ],
          },
        ],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING },
              action: {
                type: Type.OBJECT,
                properties: {
                  actionType: { type: Type.STRING },
                  name: { type: Type.STRING },
                  productName: { type: Type.STRING },
                  productId: { type: Type.STRING },
                  category: { type: Type.STRING },
                  unitType: { type: Type.STRING },
                  purchasePrice: { type: Type.NUMBER },
                  sellingPrice: { type: Type.NUMBER },
                  initialStock: { type: Type.NUMBER },
                  minStockLevel: { type: Type.NUMBER },
                  newQuantity: { type: Type.NUMBER },
                  delta: { type: Type.NUMBER },
                  quantity: { type: Type.NUMBER },
                  purchasePricePerUnit: { type: Type.NUMBER },
                  sellingPricePerUnit: { type: Type.NUMBER },
                  supplierName: { type: Type.STRING },
                  customerName: { type: Type.STRING },
                  paymentMethod: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
              },
            },
            required: ["reply"],
          },
        },
      });

      const parsed = JSON.parse(response.text || "{}");
      return res.json({
        reply: parsed.reply || "I have reviewed your store inventory details.",
        action: parsed.action || null,
      });
    } catch (err: any) {
      console.error("Gemini Chat API Error:", err);
      return res.status(500).json({
        error: "Failed to generate AI response",
        details: err?.message || String(err),
      });
    }
  });

  // Vite middleware in dev, static files in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Stock Sense server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
