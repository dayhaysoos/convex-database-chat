import { mutation } from "./_generated/server";

const PRODUCTS = [
  // Electronics (13 products)
  { name: "Wireless Earbuds Pro", description: "Premium noise-canceling wireless earbuds with 24hr battery life", category: "electronics", price: 79.99, stock: 45 },
  { name: "USB-C Hub 7-in-1", description: "Multi-port hub with HDMI, USB-A, SD card slots", category: "electronics", price: 49.99, stock: 32 },
  { name: "Mechanical Keyboard RGB", description: "Full-size mechanical keyboard with customizable RGB lighting", category: "electronics", price: 129.99, stock: 18 },
  { name: "Bluetooth Speaker", description: "Portable waterproof speaker with 360° sound", category: "electronics", price: 59.99, stock: 67 },
  { name: "Webcam HD 1080p", description: "High-definition webcam with built-in microphone", category: "electronics", price: 69.99, stock: 5 },
  { name: "Wireless Mouse", description: "Ergonomic wireless mouse with silent clicks", category: "electronics", price: 29.99, stock: 89 },
  { name: "Phone Stand Adjustable", description: "Aluminum adjustable phone and tablet stand", category: "electronics", price: 24.99, stock: 120 },
  { name: "Power Bank 20000mAh", description: "High-capacity portable charger with fast charging", category: "electronics", price: 44.99, stock: 56 },
  { name: "Smart Watch Fitness", description: "Fitness tracker with heart rate and GPS", category: "electronics", price: 149.99, stock: 23 },
  { name: "Laptop Sleeve 15\"", description: "Padded laptop sleeve with accessory pocket", category: "electronics", price: 34.99, stock: 78 },
  { name: "HDMI Cable 6ft", description: "High-speed HDMI cable with ethernet support", category: "electronics", price: 12.99, stock: 200 },
  { name: "Wireless Charger Pad", description: "Fast wireless charging pad for smartphones", category: "electronics", price: 19.99, stock: 8 },
  { name: "Gaming Headset", description: "Surround sound gaming headset with noise-canceling mic", category: "electronics", price: 89.99, stock: 34 },

  // Clothing (12 products)
  { name: "Cotton T-Shirt Classic", description: "100% cotton crew neck t-shirt, multiple colors", category: "clothing", price: 24.99, stock: 150 },
  { name: "Running Shoes Lightweight", description: "Breathable mesh running shoes with cushioned sole", category: "clothing", price: 89.99, stock: 42 },
  { name: "Winter Jacket Insulated", description: "Water-resistant insulated jacket for cold weather", category: "clothing", price: 149.99, stock: 28 },
  { name: "Denim Jeans Slim Fit", description: "Classic slim fit denim jeans in dark wash", category: "clothing", price: 59.99, stock: 65 },
  { name: "Hoodie Pullover", description: "Soft fleece pullover hoodie with kangaroo pocket", category: "clothing", price: 44.99, stock: 88 },
  { name: "Athletic Shorts", description: "Quick-dry athletic shorts with side pockets", category: "clothing", price: 29.99, stock: 110 },
  { name: "Wool Beanie", description: "Warm knit beanie for winter", category: "clothing", price: 19.99, stock: 75 },
  { name: "Leather Belt", description: "Genuine leather belt with brushed metal buckle", category: "clothing", price: 34.99, stock: 3 },
  { name: "Casual Sneakers", description: "Versatile canvas sneakers for everyday wear", category: "clothing", price: 54.99, stock: 48 },
  { name: "Dress Shirt Oxford", description: "Classic oxford dress shirt, wrinkle-resistant", category: "clothing", price: 49.99, stock: 36 },
  { name: "Yoga Pants", description: "High-waist yoga pants with side pocket", category: "clothing", price: 39.99, stock: 92 },
  { name: "Rain Jacket", description: "Lightweight packable rain jacket", category: "clothing", price: 69.99, stock: 7 },

  // Home (13 products)
  { name: "Coffee Maker Drip", description: "12-cup programmable drip coffee maker", category: "home", price: 69.99, stock: 41 },
  { name: "Desk Lamp LED", description: "Adjustable LED desk lamp with touch dimmer", category: "home", price: 34.99, stock: 62 },
  { name: "Throw Blanket Fleece", description: "Soft fleece throw blanket 50x60 inches", category: "home", price: 39.99, stock: 85 },
  { name: "Kitchen Scale Digital", description: "Precision digital kitchen scale with tare function", category: "home", price: 24.99, stock: 54 },
  { name: "Air Purifier HEPA", description: "HEPA air purifier for rooms up to 300 sq ft", category: "home", price: 129.99, stock: 19 },
  { name: "Cutting Board Set", description: "3-piece bamboo cutting board set", category: "home", price: 29.99, stock: 47 },
  { name: "French Press Coffee", description: "34oz stainless steel French press", category: "home", price: 27.99, stock: 6 },
  { name: "Shower Curtain", description: "Waterproof fabric shower curtain with hooks", category: "home", price: 22.99, stock: 38 },
  { name: "Storage Bins Set", description: "Set of 6 foldable fabric storage bins", category: "home", price: 34.99, stock: 71 },
  { name: "Wall Clock Modern", description: "12-inch silent wall clock, minimalist design", category: "home", price: 29.99, stock: 4 },
  { name: "Candle Set Scented", description: "Set of 3 soy wax scented candles", category: "home", price: 24.99, stock: 96 },
  { name: "Bathroom Mat", description: "Memory foam bathroom mat, non-slip", category: "home", price: 19.99, stock: 83 },
  { name: "Plant Pot Ceramic", description: "6-inch ceramic plant pot with drainage", category: "home", price: 16.99, stock: 112 },

  // Sports (12 products)
  { name: "Yoga Mat Premium", description: "Extra thick non-slip yoga mat 72x24 inches", category: "sports", price: 29.99, stock: 68 },
  { name: "Dumbbells Set 20lb", description: "Pair of 20lb rubber hex dumbbells", category: "sports", price: 59.99, stock: 31 },
  { name: "Tennis Racket Pro", description: "Lightweight graphite tennis racket", category: "sports", price: 89.99, stock: 22 },
  { name: "Resistance Bands Set", description: "5-piece resistance bands with handles", category: "sports", price: 24.99, stock: 95 },
  { name: "Jump Rope Speed", description: "Adjustable speed jump rope with ball bearings", category: "sports", price: 14.99, stock: 140 },
  { name: "Foam Roller", description: "High-density foam roller for muscle recovery", category: "sports", price: 19.99, stock: 57 },
  { name: "Basketball Official", description: "Official size and weight indoor/outdoor basketball", category: "sports", price: 34.99, stock: 9 },
  { name: "Soccer Ball Size 5", description: "Match quality soccer ball, FIFA approved", category: "sports", price: 29.99, stock: 44 },
  { name: "Water Bottle 32oz", description: "Insulated stainless steel water bottle", category: "sports", price: 24.99, stock: 130 },
  { name: "Gym Bag Duffel", description: "Large duffel bag with shoe compartment", category: "sports", price: 44.99, stock: 52 },
  { name: "Exercise Ball 65cm", description: "Anti-burst exercise ball with pump", category: "sports", price: 22.99, stock: 2 },
  { name: "Cycling Gloves", description: "Padded cycling gloves with grip", category: "sports", price: 19.99, stock: 63 },
];

export const seedProducts = mutation({
  args: {},
  handler: async (ctx) => {
    // Check if products already exist
    const existing = await ctx.db.query("products").first();
    if (existing) {
      return { message: "Products already seeded", count: 0 };
    }

    // Insert all products
    for (const product of PRODUCTS) {
      await ctx.db.insert("products", product);
    }

    return { message: "Products seeded successfully", count: PRODUCTS.length };
  },
});

export const clearProducts = mutation({
  args: {},
  handler: async (ctx) => {
    const products = await ctx.db.query("products").collect();
    for (const product of products) {
      await ctx.db.delete(product._id);
    }
    return { message: "Products cleared", count: products.length };
  },
});
