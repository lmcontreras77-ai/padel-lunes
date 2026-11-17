import { getStore } from "@netlify/blobs";

// Estado inicial: vacío.
const SEED = {"marks":{},"guests":{}};

const KEY = "state";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GID = /^[a-z0-9]{1,12}$/;
const MARKS = new Set(["", "ok", "maybe", "no"]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// Aplica cada cambio celda por celda, así dos jugadores que guardan a la vez no se pisan.
function apply(state, changes) {
  for (const [id, val] of Object.entries(changes)) {
    const [t, k, x] = String(id).split("|");
    if (!DATE.test(k || "")) continue;
    if (t === "mark") {
      if (!/^[0-7]$/.test(x) || !MARKS.has(val)) continue;
      state.marks[k] = { ...(state.marks[k] || {}) };
      if (val) state.marks[k][x] = val; else delete state.marks[k][x];
      if (!Object.keys(state.marks[k]).length) delete state.marks[k];
    } else if (t === "guest") {
      if (!GID.test(x || "")) continue;
      state.guests[k] = { ...(state.guests[k] || {}) };
      if (val === "") delete state.guests[k][x];
      else {
        let g; try { g = JSON.parse(val); } catch { continue; }
        const n = String(g?.n || "").trim().slice(0, 20);
        const by = Number(g?.by);
        if (!n || !(by >= 0 && by <= 7)) continue;
        state.guests[k][x] = { n, s: g.s === "maybe" ? "maybe" : "ok", by };
      }
      if (!Object.keys(state.guests[k]).length) delete state.guests[k];
    }
  }
  return state;
}

export default async (req) => {
  const store = getStore({ name: "padel-lunes", consistency: "strong" });

  if (req.method === "GET") {
    const data = await store.get(KEY, { type: "json" });
    return json(data || SEED);
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const changes = body && typeof body.changes === "object" ? body.changes : null;
    if (!changes || Object.keys(changes).length > 300) return json({ error: "bad changes" }, 400);

    // Escritura condicional con reintentos: si otro guardó justo antes, se vuelve a leer y se aplica encima.
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await store.getWithMetadata(KEY, { type: "json" });
      const state = structuredClone(current?.data || SEED);
      state.marks ||= {}; state.guests ||= {};
      apply(state, changes);
      const opts = current ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
      const res = await store.setJSON(KEY, state, opts);
      if (res?.modified !== false) return json(state);
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));
    }
    return json({ error: "busy" }, 503);
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/state" };
