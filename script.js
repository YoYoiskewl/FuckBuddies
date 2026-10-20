// ---- 1. Paste your Supabase keys (Project Settings > API) ----
// The anon key is safe to expose because the database rules in schema.sql protect your data.
// NEVER paste the service_role key here.
const SUPABASE_URL = "https://fmsklxzisejfwcybpsss.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtc2tseHppc2VqZndjeWJwc3NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MDQ2OTgsImV4cCI6MjEwODA4MDY5OH0.cVQjwcShCugWkHBRLwJW_FQTQRd1g5k8kwSfJDlueXI";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const palette = ["#8a9a5b", "#e9dcc0", "#b89468", "#a9b87a", "#d8b98a"];
const colorFor = name => palette[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];
const fmtDate = d => new Date(d).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const configured = !SUPABASE_URL.includes("YOUR-PROJECT");
let sb = null;
let setupError = "";
if (configured) {
  try {
    // Keep only https://xxxx.supabase.co, even if extra path bits were pasted
    const origin = new URL(SUPABASE_URL.trim()).origin;
    if (/supabase\.com$/i.test(new URL(origin).hostname)) throw new Error("that's the dashboard link, not the Project URL");
    sb = supabase.createClient(origin, SUPABASE_ANON_KEY.trim());
  }
  catch (e) { setupError = "Supabase couldn't start: " + e.message + ". Check the URL and anon key at the top of script.js, and that you're online."; }
}

let user = null;
let editingBio = false, bioDraft = null;
let data = { events: [], rsvps: [], notes: [], profiles: [] };
const usernameOf = u => u?.user_metadata?.username || "friend";

// ---- Data ----
async function loadData() {
  if (!sb) return;
  const [ev, rs, nt, pr] = await Promise.all([
    sb.from("events").select("*").order("starts_at"),
    sb.from("rsvps").select("event_id, user_id, profiles(username)"),
    sb.from("notes").select("id, body, created_at, profiles(username)").order("created_at", { ascending: false }).limit(12),
    sb.from("profiles").select("id, username, bio").order("created_at"),
  ]);
  const failed = [ev, rs, nt, pr].find(r => r.error);
  if (failed) { $("events").innerHTML = `<p class="setup-msg">Couldn't load data: ${esc(failed.error.message)}. Did you run schema.sql?</p>`; return; }
  data = { events: ev.data, rsvps: rs.data, notes: nt.data, profiles: pr.data };
  render();
}

function render() {
  // Gatherings
  $("events").innerHTML = "";
  if (!data.events.length) $("events").innerHTML = `<p class="setup-msg">No gatherings yet. Add one in Supabase: Table Editor > events.</p>`;
  data.events.forEach(ev => {
    const going = data.rsvps.filter(r => r.event_id === ev.id);
    const isIn = user && going.some(r => r.user_id === user.id);
    const card = document.createElement("article");
    card.className = "event";
    card.innerHTML = `
      <h3>${esc(ev.title)}</h3>
      <p class="meta">${esc(fmtDate(ev.starts_at))}<br>${esc(ev.place)}</p>
      <p class="host">Hosted by ${esc(ev.host || "someone mysterious")}</p>
      <p class="count">${going.length} going${going.length ? ": " + going.map(r => esc(r.profiles?.username)).join(", ") : ""}</p>
      <div class="actions">
        <button class="btn rsvp ${isIn ? "in" : ""}" aria-pressed="${!!isIn}">${isIn ? "You're in" : user ? "I'm in" : "Log in to join"}</button>
        ${user && ev.created_by === user.id ? `<button class="link-btn del" type="button">Delete</button>` : ""}
      </div>`;
    const del = card.querySelector(".del");
    if (del) del.addEventListener("click", async () => {
      if (!confirm(`Delete "${ev.title}"?`)) return;
      const { error } = await sb.from("events").delete().eq("id", ev.id);
      if (error) alert("Couldn't delete: " + error.message);
      loadData();
    });
    card.querySelector(".rsvp").addEventListener("click", async e => {
      if (!user) return openAuth();
      e.target.disabled = true;
      const q = isIn
        ? sb.from("rsvps").delete().match({ event_id: ev.id, user_id: user.id })
        : sb.from("rsvps").insert({ event_id: ev.id, user_id: user.id });
      await q;
      loadData();
    });
    $("events").appendChild(card);
  });

  // Crew
  $("crewList").innerHTML = data.profiles.map(p => {
    const mine = user && p.id === user.id;
    let body;
    if (mine && editingBio) {
      body = `<textarea id="bioInput" rows="3" maxlength="140" placeholder="Tell the table about yourself">${esc(bioDraft ?? p.bio ?? "")}</textarea>
        <div class="bio-actions">
          <button class="btn tiny" id="bioSave" type="button">Save</button>
          <button class="link-btn" id="bioCancel" type="button">Cancel</button>
        </div>`;
    } else {
      body = `<p class="bio ${p.bio ? "" : "empty"}">${esc(p.bio || (mine ? "No description yet." : "Mysterious."))}</p>
        ${mine ? `<button class="link-btn" id="bioEdit" type="button">Edit description</button>` : ""}`;
    }
    return `
    <div class="member">
      <div class="avatar" style="background:${colorFor(p.username)}">${esc(p.username[0].toUpperCase())}</div>
      ${esc(p.username)}
      ${body}
    </div>`;
  }).join("");
  const on = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
  on("bioEdit", () => { editingBio = true; bioDraft = null; render(); $("bioInput")?.focus(); });
  on("bioCancel", () => { editingBio = false; bioDraft = null; render(); });
  on("bioSave", async e => {
    e.target.disabled = true;
    const bio = $("bioInput").value.trim();
    const { error } = await sb.from("profiles").update({ bio }).eq("id", user.id);
    if (error) { alert("Couldn't save: " + error.message); e.target.disabled = false; return; }
    editingBio = false; bioDraft = null;
    loadData();
  });
  const bi = $("bioInput");
  if (bi) bi.addEventListener("input", () => { bioDraft = bi.value; });

  // Wall
  $("notes").innerHTML = data.notes.map(n =>
    `<div class="note">${esc(n.body)}<b>${esc(n.profiles?.username)}</b></div>`).join("");

  // Header
  $("authBtn").textContent = user ? "Log out" : "Log in";
  $("hello").hidden = !user;
  $("hello").textContent = user ? `Hi, ${usernameOf(user)}` : "";
  $("noteForm").hidden = !user;
  $("wallGate").hidden = !!user;
  $("eventForm").hidden = !user;
  $("eventGate").hidden = !!user;
  if (user && !$("evHost").value) $("evHost").value = usernameOf(user);
}

// ---- Auth popup ----
const dialog = $("authDialog");
let mode = "login";

function setMode(m) {
  mode = m;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.mode === m));
  $("authSubmit").textContent = m === "login" ? "Log in" : "Create account";
  $("userLabel").hidden = m === "login";
  $("authUser").required = m === "signup";
  $("authPass").autocomplete = m === "login" ? "current-password" : "new-password";
  $("authError").textContent = "";
}
function openAuth(m = "login") {
  if (dialog.open) return;
  setMode(m); $("authForm").reset(); dialog.showModal(); $("authEmail").focus();
}

document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => setMode(t.dataset.mode)));
$("authCancel").addEventListener("click", () => dialog.close());
$("authBtn").addEventListener("click", async () => {
  if (user) await sb.auth.signOut(); else openAuth();
});

$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("authError");
  if (!sb) { err.textContent = setupError || "Add your Supabase keys in script.js first."; return; }
  const email = $("authEmail").value.trim();
  const password = $("authPass").value;
  $("authSubmit").disabled = true;
  err.textContent = "";

  if (mode === "signup") {
    const username = $("authUser").value.trim();
    const { data: res, error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
    if (error) {
      err.textContent = /database error/i.test(error.message)
        ? "That username is taken or invalid (2 to 16 characters)." : error.message;
    } else if (!res.session) {
      err.textContent = "Almost there. Check your email to confirm, then log in.";
    } else dialog.close();
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) err.textContent = error.message; else dialog.close();
  }
  $("authSubmit").disabled = false;
});

// ---- New gathering ----
$("eventForm").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("evError");
  if (!user) return openAuth();
  const starts = new Date($("evDate").value);
  if (isNaN(starts)) { err.textContent = "Pick a valid date and time."; return; }
  err.textContent = "";
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  const { error } = await sb.from("events").insert({
    title: $("evTitle").value.trim(),
    starts_at: starts.toISOString(),
    place: $("evPlace").value.trim(),
    host: $("evHost").value.trim(),
    created_by: user.id,
  });
  btn.disabled = false;
  if (error) { err.textContent = "Couldn't add it: " + error.message; return; }
  e.target.reset();
  $("evHost").value = usernameOf(user);
  loadData();
});

// ---- Notes ----
$("noteForm").addEventListener("submit", async e => {
  e.preventDefault();
  const body = $("noteText").value.trim();
  if (!user || !body) return;
  const { error } = await sb.from("notes").insert({ body });
  if (!error) { e.target.reset(); loadData(); }
});

// ---- Vinyl toggle ----
const vinyl = $("vinyl"), arm = $("arm"), toggle = $("spinToggle");
toggle.addEventListener("click", () => {
  const paused = vinyl.classList.toggle("paused");
  arm.classList.toggle("up", paused);
  toggle.textContent = paused ? "Play the record" : "Pause the record";
  toggle.setAttribute("aria-pressed", String(!paused));
});

// ---- Start ----
async function init() {
  render();
  if (!sb) {
    $("events").innerHTML = `<p class="setup-msg">${esc(setupError || "Almost ready. Paste your Supabase URL and anon key at the top of script.js, then run schema.sql.")}</p>`;
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  user = session?.user ?? null;
  await loadData();

  sb.auth.onAuthStateChange((_evt, s) => { user = s?.user ?? null; render(); loadData(); });
  ["events", "rsvps", "notes", "profiles"].forEach(t =>
    sb.channel("fb-" + t).on("postgres_changes", { event: "*", schema: "public", table: t }, loadData).subscribe());

  // Welcome popup once per visit for logged-out people
  let seen = false;
  try { seen = sessionStorage.getItem("fb-welcomed"); sessionStorage.setItem("fb-welcomed", "1"); } catch {}
  if (!user && !seen) setTimeout(() => openAuth(), 900);
}
init();