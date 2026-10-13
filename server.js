require("dotenv").config();
const express = require("express"), crypto = require("crypto"), fs = require("fs"), path = require("path");
const Razorpay = require("razorpay");
const app = express();
const allowedOrigins = new Set([
  "https://localhost",
  "http://localhost",
  ...(process.env.APP_ALLOWED_ORIGINS || "").split(",").map(origin => origin.trim()).filter(Boolean)
]);
app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (origin && allowedOrigins.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Store-Pin, X-Partner-Id, X-Partner-Pin, X-Admin-Key");
  }
  if (req.method === "OPTIONS") return res.sendStatus(origin && !allowedOrigins.has(origin) ? 403 : 204);
  next();
});
app.use(express.json({ limit: "6mb" }));
app.use(express.static(path.join(__dirname, "public")));

const FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString("hex");
const mk = (id, name, type, area, lat, lng, pin, items) => {
  const salt = crypto.randomBytes(8).toString("hex");
  return { id, name, type, area, lat, lng, salt, pinHash: hashPin(pin, salt), items: items.map(([n, p]) => [n, p, 20, ""]) };
};
const mkP = (id, name, phone, pin, lat, lng) => {
  const salt = crypto.randomBytes(8).toString("hex");
  return { id, name, phone, salt, pinHash: hashPin(pin, salt), lat, lng, at: 0 };
};
function seed() {
  if (process.env.SEED_DEMO === "false") return { stores: [], orders: [], partners: [] };
  return {
    stores: [
      mk(1, "Chennai Hyper Mart", "super", "Anna Nagar", 13.0827, 80.2707, "1234", [["Rice (1 kg)", 62], ["Toor Dal (1 kg)", 150], ["Sunflower Oil (1 L)", 140], ["Milk (500 ml)", 30], ["Tea Powder (250 g)", 110], ["Soap", 38]]),
      mk(2, "Murugan Mini Stores", "mini", "T. Nagar", 13.0674, 80.2376, "1234", [["Eggs (6)", 48], ["Bread", 40], ["Biscuits", 20], ["Onion (1 kg)", 35], ["Tomato (1 kg)", 30], ["Curd (500 ml)", 32]]),
      mk(3, "Lakshmi Provision", "mini", "Adyar", 13.0418, 80.2341, "1234", [["Idli Batter (1 kg)", 55], ["Coconut", 28], ["Sugar (1 kg)", 46], ["Salt (1 kg)", 22], ["Turmeric Powder", 30], ["Detergent", 95]])
    ],
    orders: [],
    partners: [mkP(1, "Karthik", "9000000001", "1234", 13.075, 80.25), mkP(2, "Selvi", "9000000002", "1234", 13.05, 80.23), mkP(3, "Arun", "9000000003", "1234", 13.1, 80.22)]
  };
}
let db; try { db = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { db = seed(); }
db.partners.forEach(p => { if (!p.pinHash) { p.salt = crypto.randomBytes(8).toString("hex"); p.pinHash = hashPin("1234", p.salt); p.phone = p.phone || ""; p.at = 0; } });
const DEMO_STORES = ["Chennai Hyper Mart", "Murugan Mini Stores", "Lakshmi Provision"], DEMO_PHONES = ["9000000001", "9000000002", "9000000003"];
db.stores.forEach(s => { if (s.demo === undefined) s.demo = DEMO_STORES.includes(s.name); });
db.partners.forEach(p => { if (p.demo === undefined) p.demo = DEMO_PHONES.includes(p.phone); });
const save = () => fs.writeFileSync(FILE, JSON.stringify(db));
save();

const rzp = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }) : null;

const km = (a, b) => { const d = x => x * Math.PI / 180, R = 6371, dl = d(b.lat - a.lat), dn = d(b.lng - a.lng);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(d(a.lat)) * Math.cos(d(b.lat)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const pubStore = ({ salt, pinHash, ...s }) => s;
const pubOrder = ({ rzpOrderId, rzpPaymentId, ...o }) => {
  const p = o.stage === 3 && db.partners.find(p => p.id === o.partner);
  return { ...o, partnerPos: p && p.lat != null ? { lat: p.lat, lng: p.lng } : null };
};
const pinOkP = (p, pin) => { const a = Buffer.from(hashPin(String(pin || ""), p.salt)), b = Buffer.from(p.pinHash); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const fails = new Map();
const locked = k => { const f = fails.get(k); return f && f.n >= 5 && Date.now() - f.t < 300000; };
const failed = k => { const f = fails.get(k) || { n: 0, t: 0 }; f.n = (Date.now() - f.t > 300000 ? 0 : f.n) + 1; f.t = Date.now(); fails.set(k, f); };
function authPartner(id, req) {
  const p = db.partners.find(p => String(p.id) === String(id)); if (!p) return null;
  const k = "p" + p.id; if (locked(k)) return null;
  if (!pinOkP(p, req.get("x-partner-pin"))) { failed(k); return null; }
  return p;
}
const visible = o => o.pay === "cod" || o.paid;
const avg = arr => arr.length ? { avg: arr.reduce((a, b) => a + b, 0) / arr.length, count: arr.length } : { avg: 0, count: 0 };
const storeRating = id => avg(db.orders.filter(o => o.storeId === id && o.rating).map(o => o.rating.store));
const partnerRating = id => avg(db.orders.filter(o => o.partner === id && o.rating && o.rating.partner).map(o => o.rating.partner));
const pinOk = (st, req) => {
  const given = Buffer.from(hashPin(req.get("x-store-pin") || "", st.salt)), real = Buffer.from(st.pinHash);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
};
function storeAuth(req, res) {
  const st = db.stores.find(s => s.id === +req.params.id);
  if (!st) { res.status(404).json({ error: "Store not found" }); return null; }
  if (!pinOk(st, req)) { res.status(401).json({ error: "Wrong PIN" }); return null; }
  return st;
}
const newId = () => { let id; do { id = crypto.randomInt(100000, 999999); } while (db.orders.some(o => o.id === id)); return id; };

app.get("/api/state", (req, res) => res.json({ stores: db.stores.map(s => ({ ...pubStore(s), rating: storeRating(s.id) })), partners: db.partners.map(({ id, name }) => ({ id, name, rating: partnerRating(id) })) }));

app.post("/api/stores", (req, res) => {
  const b = req.body || {}, name = String(b.name || "").trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: "Enter your store name" });
  if (!/^\d{4}$/.test(String(b.pin))) return res.status(400).json({ error: "PIN must be 4 digits" });
  const lat = Number.isFinite(+b.lat) ? +b.lat : 13.0827, lng = Number.isFinite(+b.lng) ? +b.lng : 80.2707;
  const id = Math.max(0, ...db.stores.map(s => s.id)) + 1;
  db.stores.push(mk(id, name, b.type === "super" ? "super" : "mini", String(b.area || "Your area").slice(0, 60), lat, lng, b.pin, []));
  save(); res.json({ id });
});

app.get("/api/stores/:id/orders", (req, res) => {
  const st = storeAuth(req, res); if (!st) return;
  res.json(db.orders.filter(o => o.storeId === st.id && visible(o)).map(pubOrder));
});
app.post("/api/stores/:id/items", (req, res) => {
  const st = storeAuth(req, res); if (!st) return;
  const b = req.body || {}, name = String(b.name || "").trim().slice(0, 80), price = +b.price;
  if (!name || !(price > 0)) return res.status(400).json({ error: "Enter product name and price" });
  const photo = typeof b.photo === "string" && b.photo.startsWith("data:image/") && b.photo.length < 300000 ? b.photo : "";
  st.items.push([name, price, Math.max(0, Math.floor(+b.stock) || 0), photo]); save(); res.json({ ok: true });
});
app.patch("/api/stores/:id/items/:i", (req, res) => {
  const st = storeAuth(req, res); if (!st) return;
  const it = st.items[+req.params.i]; if (!it) return res.status(404).json({ error: "Product not found" });
  it[2] = Math.max(0, Math.floor(+(req.body || {}).stock) || 0); save(); res.json({ ok: true });
});
app.delete("/api/stores/:id/items/:i", (req, res) => {
  const st = storeAuth(req, res); if (!st) return;
  if (!st.items[+req.params.i]) return res.status(404).json({ error: "Product not found" });
  st.items.splice(+req.params.i, 1); save(); res.json({ ok: true });
});

app.post("/api/orders", async (req, res) => {
  const b = req.body || {}, st = db.stores.find(s => s.id === +b.storeId);
  if (!st) return res.status(404).json({ error: "Store not found" });
  const name = String(b.name || "").trim().slice(0, 60), addr = String(b.addr || "").trim().slice(0, 200);
  if (!name || !addr) return res.status(400).json({ error: "Name and address are required" });
  if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 50) return res.status(400).json({ error: "Cart is empty" });
  const seen = new Set(), items = [], take = []; let sub = 0;
  for (const [i, q] of b.lines) {
    const it = st.items[i], n = Math.floor(+q);
    if (!it || !(n > 0) || seen.has(i)) return res.status(400).json({ error: "Invalid item in cart" });
    if (n > it[2]) return res.status(409).json({ error: it[0] + ": only " + it[2] + " left" });
    seen.add(i); items.push([it[0], n]); take.push([it, n]); sub += it[1] * n;
  }
  const pos = b.pos && Number.isFinite(+b.pos.lat) && Number.isFinite(+b.pos.lng) ? { lat: +b.pos.lat, lng: +b.pos.lng } : null;
  const fee = pos ? Math.round(20 + 4 * km(pos, st)) : 30, total = sub + fee, pay = b.pay === "online" ? "online" : "cod";
  if (pay === "online" && !rzp) return res.status(503).json({ error: "Online payment is not set up yet. Choose cash on delivery." });
  take.forEach(([it, n]) => { it[2] -= n; });
  const order = { id: newId(), storeId: st.id, name, addr, pos, pay, via: pay === "online" ? (b.via === "upi" ? "upi" : "card") : null, paid: false, total, fee, items, stage: 0, partner: null, at: Date.now() };
  let rz = null;
  if (pay === "online") {
    try {
      const r = await rzp.orders.create({ amount: total * 100, currency: "INR", receipt: "nk" + order.id });
      order.rzpOrderId = r.id; rz = { orderId: r.id, amount: r.amount, key: process.env.RAZORPAY_KEY_ID };
    } catch (e) {
      take.forEach(([it, n]) => { it[2] += n; });
      return res.status(502).json({ error: "Payment service is not responding. Try again." });
    }
  }
  db.orders.unshift(order); save();
  res.json({ order: pubOrder(order), rzp: rz });
});

app.get("/api/orders", (req, res) => {
  const ids = String(req.query.ids || "").split(",").map(Number).filter(Boolean).slice(0, 50);
  res.json(db.orders.filter(o => ids.includes(o.id)).map(pubOrder));
});

app.post("/api/orders/:oid/rating", (req, res) => {
  const o = db.orders.find(o => o.id === +req.params.oid);
  if (!o || o.stage !== 4) return res.status(409).json({ error: "You can rate after the order is delivered" });
  if (o.rating) return res.status(409).json({ error: "You already rated this order" });
  const b = req.body || {}, s = Math.round(+b.store), p = o.partner ? Math.round(+b.partner) : null;
  if (!(s >= 1 && s <= 5) || (o.partner && !(p >= 1 && p <= 5))) return res.status(400).json({ error: "Rating must be 1 to 5 stars" });
  o.rating = { store: s, partner: p, comment: String(b.comment || "").trim().slice(0, 200), at: Date.now() };
  save(); res.json({ ok: true });
});

app.post("/api/payments/verify", (req, res) => {
  const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  const o = db.orders.find(o => o.id === +orderId);
  if (!o || o.pay !== "online" || o.rzpOrderId !== razorpay_order_id || !process.env.RAZORPAY_KEY_SECRET) return res.status(400).json({ error: "Invalid payment" });
  const exp = Buffer.from(crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(razorpay_order_id + "|" + razorpay_payment_id).digest("hex"));
  const got = Buffer.from(String(razorpay_signature || ""));
  if (exp.length !== got.length || !crypto.timingSafeEqual(exp, got)) return res.status(400).json({ error: "Payment verification failed" });
  o.paid = true; o.rzpPaymentId = razorpay_payment_id; save(); res.json({ ok: true });
});

app.patch("/api/orders/:oid", (req, res) => {
  const o = db.orders.find(o => o.id === +req.params.oid);
  if (!o) return res.status(404).json({ error: "Order not found" });
  const act = (req.body || {}).action, wrong = () => res.status(409).json({ error: "This step is not available for the order now" });
  if (act === "accept" || act === "assign") {
    const st = db.stores.find(s => s.id === o.storeId);
    if (!pinOk(st, req)) return res.status(401).json({ error: "Wrong PIN" });
    if (!visible(o)) return res.status(402).json({ error: "Customer has not paid yet" });
    if (act === "accept") { if (o.stage !== 0) return wrong(); o.stage = 1; }
    else {
      if (o.stage !== 1) return wrong();
      const live = db.partners.filter(p => p.lat != null && Date.now() - p.at < 120000), pool = live.length ? live : db.partners;
      const dist = p => p.lat == null ? 1e9 : km(p, st);
      const p = [...pool].sort((a, b) => dist(a) - dist(b))[0];
      if (!p) return res.status(409).json({ error: "No delivery partner available" });
      o.partner = p.id; o.stage = 2; save(); return res.json({ ok: true, partnerName: p.name });
    }
  } else if (act === "pickup" || act === "deliver") {
    if (!o.partner || String(o.partner) !== req.get("x-partner-id") || !authPartner(o.partner, req)) return res.status(403).json({ error: "This order is not assigned to you" });
    if (act === "pickup" && o.stage === 2) o.stage = 3;
    else if (act === "deliver" && o.stage === 3) { o.stage = 4; if (o.pay === "cod") o.paid = true; }
    else return wrong();
  } else return res.status(400).json({ error: "Unknown action" });
  save(); res.json({ ok: true });
});

app.post("/api/partners", (req, res) => {
  const b = req.body || {}, name = String(b.name || "").trim().slice(0, 60), phone = String(b.phone || "").trim();
  if (!name) return res.status(400).json({ error: "Enter your name" });
  if (!/^\d{10}$/.test(phone)) return res.status(400).json({ error: "Phone number must be 10 digits" });
  if (!/^\d{4}$/.test(String(b.pin))) return res.status(400).json({ error: "PIN must be 4 digits" });
  if (db.partners.some(p => p.phone === phone)) return res.status(409).json({ error: "This phone number is already registered" });
  const id = Math.max(0, ...db.partners.map(p => p.id)) + 1;
  db.partners.push(mkP(id, name, phone, b.pin, null, null)); save(); res.json({ id, name });
});
app.post("/api/partners/login", (req, res) => {
  const { phone, pin } = req.body || {}, k = "l" + phone;
  if (locked(k)) return res.status(429).json({ error: "Too many wrong attempts. Try again in 5 minutes." });
  const p = db.partners.find(p => p.phone && p.phone === String(phone));
  if (!p || !pinOkP(p, pin)) { failed(k); return res.status(401).json({ error: "Wrong phone number or PIN" }); }
  fails.delete(k); res.json({ id: p.id, name: p.name });
});
app.post("/api/partners/:pid/location", (req, res) => {
  const p = authPartner(req.params.pid, req); if (!p) return res.status(401).json({ error: "Please login again" });
  const lat = +(req.body || {}).lat, lng = +(req.body || {}).lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "Bad location" });
  p.lat = lat; p.lng = lng; p.at = Date.now(); save(); res.json({ ok: true });
});
app.get("/api/partners/:pid/orders", (req, res) => {
  const p = authPartner(req.params.pid, req); if (!p) return res.status(401).json({ error: "Please login again" });
  res.json(db.orders.filter(o => o.partner === p.id && o.stage >= 2).map(pubOrder));
});

function adminAuth(req, res) {
  const key = process.env.ADMIN_PASSWORD;
  if (!key || key === "choose-a-strong-password" || key.length < 6) { res.status(503).json({ error: "Admin is not set up. Put your own ADMIN_PASSWORD (6+ characters) in the .env file and restart the server." }); return false; }
  if (locked("admin")) { res.status(429).json({ error: "Too many wrong attempts. Try again in 5 minutes." }); return false; }
  const h = x => crypto.createHash("sha256").update(String(x || "")).digest();
  if (!crypto.timingSafeEqual(h(req.get("x-admin-key")), h(key))) { failed("admin"); res.status(401).json({ error: "Wrong admin password" }); return false; }
  fails.delete("admin"); return true;
}
app.get("/api/admin/overview", (req, res) => {
  if (!adminAuth(req, res)) return;
  const sname = id => (db.stores.find(s => s.id === id) || { name: "Deleted store" }).name;
  const vis = db.orders.filter(visible), done = vis.filter(o => o.stage === 4);
  res.json({
    stats: { demo: db.stores.filter(s => s.demo).length + db.partners.filter(p => p.demo).length, stores: db.stores.length, partners: db.partners.length, orders: vis.length, delivered: done.length, sales: done.reduce((a, o) => a + o.total, 0) },
    stores: db.stores.map(s => ({ id: s.id, name: s.name, type: s.type, area: s.area, demo: !!s.demo, rating: storeRating(s.id), items: s.items.length, orders: vis.filter(o => o.storeId === s.id).length })),
    partners: db.partners.map(p => ({ id: p.id, name: p.name, phone: p.phone, demo: !!p.demo, rating: partnerRating(p.id), online: p.lat != null && Date.now() - p.at < 120000 })),
    orders: vis.slice(0, 100).map(o => ({ id: o.id, store: sname(o.storeId), name: o.name, stage: o.stage, total: o.total, pay: o.pay, via: o.via, paid: o.paid }))
  });
});
const newPin = (req, res, list) => {
  if (!adminAuth(req, res)) return;
  const x = list.find(x => x.id === +req.params.id); if (!x) return res.status(404).json({ error: "Not found" });
  const pin = String((req.body || {}).pin || ""); if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: "PIN must be 4 digits" });
  x.salt = crypto.randomBytes(8).toString("hex"); x.pinHash = hashPin(pin, x.salt); save(); res.json({ ok: true });
};
app.post("/api/admin/stores/:id/pin", (req, res) => newPin(req, res, db.stores));
app.post("/api/admin/partners/:id/pin", (req, res) => newPin(req, res, db.partners));
app.post("/api/admin/clear-demo", (req, res) => {
  if (!adminAuth(req, res)) return;
  const ds = db.stores.filter(s => s.demo).map(s => s.id), dp = db.partners.filter(p => p.demo).map(p => p.id);
  if (db.orders.some(o => visible(o) && o.stage < 4 && (ds.includes(o.storeId) || dp.includes(o.partner)))) return res.status(409).json({ error: "Demo stores/partners have orders in progress. Finish them first." });
  db.stores = db.stores.filter(s => !s.demo); db.partners = db.partners.filter(p => !p.demo); save();
  res.json({ removedStores: ds.length, removedPartners: dp.length });
});
app.delete("/api/admin/stores/:id", (req, res) => {
  if (!adminAuth(req, res)) return;
  const id = +req.params.id;
  if (db.orders.some(o => o.storeId === id && visible(o) && o.stage < 4)) return res.status(409).json({ error: "This store has orders in progress. Finish them first." });
  db.stores = db.stores.filter(s => s.id !== id); save(); res.json({ ok: true });
});
app.delete("/api/admin/partners/:id", (req, res) => {
  if (!adminAuth(req, res)) return;
  const id = +req.params.id;
  if (db.orders.some(o => o.partner === id && o.stage >= 2 && o.stage < 4)) return res.status(409).json({ error: "This partner has deliveries in progress." });
  db.partners = db.partners.filter(p => p.id !== id); save(); res.json({ ok: true });
});

app.use((err, req, res, next) => res.status(400).json({ error: "Bad request" }));
app.listen(process.env.PORT || 3000, () => console.log("Namma Kadai running on port " + (process.env.PORT || 3000)));
