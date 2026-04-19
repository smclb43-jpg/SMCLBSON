const STORAGE_KEY = "aftem_mobile_station_demo_v2";
const STATION_KEY = "aftem_mobile_station_name";
const API_KEY = "aftem_mobile_station_api_url";
const STATIONS = [
  { label: "Kesim", code: "Kesim" },
  { label: "Rodaj", code: "Rodaj" },
  { label: "Temper", code: "Temper" },
  { label: "Basım", code: "Basim" },
  { label: "Robot", code: "Robot" }
];

const demoJobs = [
  { id: 1, orderNo: "SIP-20260418-001", customer: "SAMI", project: "CELEBI", glassType: "4 MM DC", qty: 11, m2: 11, stage: "Kesim", route: ["Kesim", "Rodaj", "Temper"] },
  { id: 2, orderNo: "SIP-20260418-002", customer: "YILMAZ", project: "ANKARA", glassType: "4+16+4 ISICAM", qty: 8, m2: 14.4, stage: "Kesim", route: ["Kesim", "Basim", "Robot"] },
  { id: 3, orderNo: "SIP-20260418-003", customer: "ALTIN", project: "FABRIKA", glassType: "6 MM FUME", qty: 5, m2: 7.2, stage: "Rodaj", route: ["Kesim", "Rodaj", "Robot"] }
];

const state = {
  jobs: loadJobs(),
  station: localStorage.getItem(STATION_KEY) || "Kesim",
  search: "",
  selectedIds: new Set()
};

const searchInput = document.getElementById("searchInput");
const jobList = document.getElementById("jobList");
const emptyState = document.getElementById("emptyState");
const jobTemplate = document.getElementById("jobCardTemplate");
const connectionBadge = document.getElementById("connectionBadge");
const loginScreen = document.getElementById("loginScreen");
const loginStationSelect = document.getElementById("loginStationSelect");
const loginApiUrlInput = document.getElementById("loginApiUrlInput");
const currentStationSubtitle = document.getElementById("currentStationSubtitle");

loginStationSelect.value = displayLabel(state.station);
loginApiUrlInput.value = localStorage.getItem(API_KEY) || "";

function stationCode(value) {
  const text = String(value || "").trim();
  const item = STATIONS.find((entry) => entry.code === text || entry.label === text);
  return item ? item.code : text || "Kesim";
}

function displayLabel(value) {
  const code = stationCode(value);
  const item = STATIONS.find((entry) => entry.code === code);
  return item ? item.label : code;
}

function loadJobs() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(demoJobs));
    return [...demoJobs];
  }
  try { return JSON.parse(raw); } catch { return [...demoJobs]; }
}

function saveJobs() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.jobs));
}

function getApiBase() {
  return (localStorage.getItem(API_KEY) || "").trim().replace(/\/+$/, "");
}

function fmt(value) {
  return String(Number(value).toLocaleString("tr-TR", { maximumFractionDigits: 2 }));
}

function nextStage(job) {
  const index = (job.route || []).indexOf(job.stage);
  if (index === -1 || index === job.route.length - 1) return null;
  return job.route[index + 1];
}

function filteredJobs() {
  const q = state.search.trim().toLowerCase();
  return state.jobs.filter(job => {
    const matchesStation = stationCode(job.stage) === stationCode(state.station);
    const haystack = `${job.orderNo} ${job.customer} ${job.project} ${job.glassType || ""}`.toLowerCase();
    return matchesStation && (!q || haystack.includes(q));
  });
}

function updateSummary(rows) {
  document.getElementById("activeCount").textContent = rows.length;
  document.getElementById("totalQty").textContent = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  document.getElementById("totalM2").textContent = fmt(rows.reduce((sum, row) => sum + Number(row.m2 || 0), 0));
  document.getElementById("listTitle").textContent = `${displayLabel(state.station)} Listesi`;
}

function render() {
  const rows = filteredJobs();
  jobList.innerHTML = "";
  updateSummary(rows);
  currentStationSubtitle.textContent = `${displayLabel(state.station)} İstasyonu`;
  emptyState.style.display = rows.length ? "none" : "block";

  rows.forEach(job => {
    const node = jobTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".job-selector").checked = state.selectedIds.has(job.id);
    node.querySelector(".job-selector").addEventListener("change", (event) => {
      if (event.target.checked) state.selectedIds.add(job.id); else state.selectedIds.delete(job.id);
    });
    node.querySelector(".job-order").textContent = job.orderNo;
    node.querySelector(".job-stage").textContent = displayLabel(job.stage);
    node.querySelector(".job-customer").textContent = job.customer || "-";
    node.querySelector(".job-project").textContent = job.project || "-";
    node.querySelector(".job-glass-type").textContent = job.glassType || "-";
    node.querySelector(".job-qty").textContent = job.qty ?? 0;
    node.querySelector(".job-m2").textContent = fmt(job.m2 ?? 0);
    node.querySelector(".inline-finish-btn").addEventListener("click", () => finishJobs([job.id]));
    jobList.appendChild(node);
  });
}

async function finishJobs(ids) {
  if (!ids.length) return;
  const apiBase = getApiBase();
  if (apiBase) {
    try {
      const response = await fetch(`${apiBase}/api/stations/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, stage: stationCode(state.station) })
      });
      if (!response.ok) throw new Error("Sunucu islemi tamamlayamadi");
      await loadFromApi();
      state.selectedIds.clear();
      render();
      return;
    } catch {
      connectionBadge.textContent = "Baglanti Hatasi";
      connectionBadge.className = "badge warn";
    }
  }
  state.jobs = state.jobs.map(job => {
    if (!ids.includes(job.id)) return job;
    const next = nextStage(job);
    return { ...job, stage: next || "Tamamlandi" };
  });
  state.selectedIds.clear();
  saveJobs();
  render();
}

function openLogin() {
  loginStationSelect.value = displayLabel(state.station || "Kesim");
  loginApiUrlInput.value = localStorage.getItem(API_KEY) || "";
  loginScreen.classList.add("visible");
}

function closeLogin() {
  loginScreen.classList.remove("visible");
}

async function loadFromApi() {
  const apiBase = getApiBase();
  if (!apiBase) {
    connectionBadge.textContent = "Demo Mod";
    connectionBadge.className = "badge warn";
    return false;
  }
  try {
    const query = new URLSearchParams({ stage: stationCode(state.station), q: state.search || "" });
    const response = await fetch(`${apiBase}/api/stations/jobs?${query.toString()}`);
    if (!response.ok) throw new Error("Sunucuya ulasilamadi");
    const payload = await response.json();
    state.jobs = (payload.jobs || []).map(job => ({ ...job, glassType: job.glassType || "-" }));
    connectionBadge.textContent = "Canli Bagli";
    connectionBadge.className = "badge live";
    return true;
  } catch {
    connectionBadge.textContent = "Demo Mod";
    connectionBadge.className = "badge warn";
    return false;
  }
}

document.getElementById("loginContinueBtn").addEventListener("click", () => {
  state.station = stationCode(loginStationSelect.value);
  localStorage.setItem(STATION_KEY, state.station);
  localStorage.setItem(API_KEY, loginApiUrlInput.value.trim());
  state.selectedIds.clear();
  closeLogin();
  loadFromApi().then(render);
});

document.getElementById("refreshBtn").addEventListener("click", () => loadFromApi().then(render));
document.getElementById("changeStationBtn").addEventListener("click", openLogin);
document.getElementById("selectAllBtn").addEventListener("click", () => {
  filteredJobs().forEach(job => state.selectedIds.add(job.id));
  render();
});
document.getElementById("clearSelectionBtn").addEventListener("click", () => {
  state.selectedIds.clear();
  render();
});
document.getElementById("finishSelectedBtn").addEventListener("click", () => finishJobs([...state.selectedIds]));
searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  loadFromApi().then(render);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

if (!localStorage.getItem(STATION_KEY)) openLogin();
loadFromApi().then(render);
