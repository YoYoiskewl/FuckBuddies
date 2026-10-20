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
let data = { events: [], rsvps: [], notes: [], profiles: [] };
const usernameOf = u => u?.user_metadata?.username || "friend";

// ---- Data ----
async function loadData() {
  if (!sb) return;
  const [ev, rs, nt, pr] = await Promise.all([
    sb.from("events").select("*").order("starts_at"),
    sb.from("rsvps").select("event_id, user_id, profiles(username)"),
    sb.from("notes").select("id, body, created_at, profiles(username)").order("created_at", { ascending: false }).limit(12),
    sb.from("profiles").select("username").order("created_at"),
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
      <p class="count">${going.length} going${going.length ? ": " + going.map(r => esc(r.profiles?.username)).join(", ") : ""}</p>
      <button class="btn ${isIn ? "in" : ""}" aria-pressed="${!!isIn}">${isIn ? "You're in" : user ? "I'm in" : "Log in to join"}</button>`;
    card.querySelector("button").addEventListener("click", async e => {
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
  $("crewList").innerHTML = data.profiles.map(p => `
    <div class="member">
      <div class="avatar" style="background:${colorFor(p.username)}">${esc(p.username[0].toUpperCase())}</div>
      ${esc(p.username)}
    </div>`).join("");

  // Wall
  $("notes").innerHTML = data.notes.map(n =>
    `<div class="note">${esc(n.body)}<b>${esc(n.profiles?.username)}</b></div>`).join("");

  // Header
  $("authBtn").textContent = user ? "Log out" : "Log in";
  $("hello").hidden = !user;
  $("hello").textContent = user ? `Hi, ${usernameOf(user)}` : "";
  $("noteForm").hidden = !user;
  $("wallGate").hidden = !!user;
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
  ["rsvps", "notes", "profiles"].forEach(t =>
    sb.channel("fb-" + t).on("postgres_changes", { event: "*", schema: "public", table: t }, loadData).subscribe());

  // Welcome popup once per visit for logged-out people
  let seen = false;
  try { seen = sessionStorage.getItem("fb-welcomed"); sessionStorage.setItem("fb-welcomed", "1"); } catch {}
  if (!user && !seen) setTimeout(() => openAuth(), 900);
}
init();