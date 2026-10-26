// ImageIT3D + LaunchIT3D local server
// Serves the web app from /public and passes requests to Meshy's Text to 3D API.
// The Meshy API key stays on this server and is never sent to the browser.
import "dotenv/config";
import express from "express";

const KEY = process.env.MESHY_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const PORT = process.env.PORT || 3000;
const MESHY = "https://api.meshy.ai/openapi/v2/text-to-3d";
const MAX_PER_HOUR = Number(process.env.MESHY_MAX_PER_HOUR || 10); // protects your credits

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static("public"));

// These are public browser credentials. Never put a Supabase service-role key here.
app.get("/api/config", (req, res) => res.json({
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY
}));

const meshy = (path = "", init = {}) =>
  fetch(MESHY + path, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) }
  });

// Wrap async routes so errors return JSON instead of crashing the server.
const route = fn => (req, res) =>
  fn(req, res).catch(err => {
    console.error(err);
    res.status(500).json({ error: "Something went wrong talking to Meshy. Try again." });
  });

const validId = id => /^[A-Za-z0-9-]{8,64}$/.test(id);

// Simple per-IP limit on new generations.
const hits = new Map();
function allowed(ip) {
  const now = Date.now(), recent = (hits.get(ip) || []).filter(t => now - t < 3600_000);
  if (recent.length >= MAX_PER_HOUR) return false;
  recent.push(now); hits.set(ip, recent); return true;
}

// The page calls this first and only shows the Meshy panel when it returns ok.
app.get("/api/meshy/health", (req, res) => res.json({ ok: Boolean(KEY) }));

// Start a preview task. Preview = geometry only, which is all a 3D print needs.
app.post("/api/meshy/preview", route(async (req, res) => {
  if (!KEY) return res.status(503).json({ error: "The server has no Meshy API key. Add MESHY_API_KEY to .env." });
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) return res.status(400).json({ error: "Describe the model first." });
  if (prompt.length > 800) return res.status(400).json({ error: "Keep the description under 800 characters." });
  if (!allowed(req.ip)) return res.status(429).json({ error: `Limit of ${MAX_PER_HOUR} generations per hour reached. Try again later.` });

  const r = await meshy("", {
    method: "POST",
    body: JSON.stringify({
      mode: "preview",
      prompt,
      ai_model: "latest",
      should_remesh: true,        // keeps triangle counts manageable for the browser checks
      target_polycount: 100000,
      target_formats: ["glb", "stl"],
      moderation: true
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = { 401: "Meshy rejected the API key.", 402: "The Meshy account is out of credits or needs a paid plan.", 429: "Meshy is rate limiting requests. Wait a minute." }[r.status];
    return res.status(r.status).json({ error: msg || data.message || "Meshy didn't accept the request." });
  }
  res.json({ taskId: data.result });
}));

// Check progress. Returns only what the page needs, never Meshy's signed file URLs.
app.get("/api/meshy/tasks/:id", route(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "Invalid task id." });
  const r = await meshy("/" + req.params.id);
  const t = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(r.status).json({ error: t.message || "Couldn't read the Meshy task." });
  res.json({
    status: t.status,
    progress: t.progress,
    thumbnail: t.thumbnail_url || null,
    error: t.task_error?.message || "",
    formats: Object.keys(t.model_urls || {})
  });
}));

// Download the finished model through this server (avoids browser CORS issues
// and only ever fetches URLs that Meshy itself returned for this task).
app.get("/api/meshy/tasks/:id/model", route(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "Invalid task id." });
  const format = ["glb", "stl", "obj"].includes(req.query.format) ? req.query.format : "glb";
  const r = await meshy("/" + req.params.id);
  const t = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(r.status).json({ error: t.message || "Couldn't read the Meshy task." });
  if (t.status !== "SUCCEEDED") return res.status(409).json({ error: "The model isn't finished yet." });
  const url = t.model_urls?.[format];
  if (!url) return res.status(404).json({ error: `Meshy didn't produce a ${format.toUpperCase()} file for this task.` });
  const file = await fetch(url);
  if (!file.ok) return res.status(502).json({ error: "Couldn't download the file from Meshy." });
  res.set("Content-Type", { glb: "model/gltf-binary", stl: "model/stl", obj: "text/plain" }[format]);
  res.set("Content-Disposition", `attachment; filename="model.${format}"`);
  res.send(Buffer.from(await file.arrayBuffer()));
}));

app.listen(PORT, () => {
  console.log(`ImageIT3D running at http://localhost:${PORT}`);
  if (!KEY) console.warn("MESHY_API_KEY is not set. The app works, but the Meshy panel stays hidden.");
});
