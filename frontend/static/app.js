/* =====================================================
   ARENA — Application Logic
   All API calls preserved. Only DOM rendering changed.
   ===================================================== */

'use strict';

const API = '';
let _joueursCurrent = [];
let _amisCurrentId  = null;
let _currentPage    = 'dashboard';

/* ── API ── */
async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(err.detail || r.statusText);
  }
  return r.json();
}

/* ── TOAST ── */
function toast(msg, type = 'ok') {
  const t   = document.getElementById('toast');
  const ico = document.getElementById('toastIcon');
  const txt = document.getElementById('toastMsg');
  txt.textContent = msg;
  ico.setAttribute('data-lucide', type === 'ok' ? 'check-circle' : 'alert-circle');
  t.className = 'toast show ' + type;
  lucide.createIcons({ nodes: [ico] });
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 3800);
}

/* ── HELPERS ── */
function initials(name) {
  return (name || '?').substring(0, 2).toUpperCase();
}

function fmtScore(n) {
  if (n == null) return '—';
  return n.toLocaleString('fr-FR');
}

function rankClass(r) {
  if (r === 1) return 'rank-1';
  if (r === 2) return 'rank-2';
  if (r === 3) return 'rank-3';
  return '';
}

function emptyState(msg, icon = 'inbox') {
  return `<div class="state-empty">
    <i data-lucide="${icon}" style="width:32px;height:32px;opacity:.25"></i>
    <span class="state-empty-text">${msg}</span>
  </div>`;
}

function errorState(msg) {
  return `<div class="state-error">
    <i data-lucide="alert-circle" class="icon-xs"></i>
    ${msg}
  </div>`;
}

function reinitIcons() {
  lucide.createIcons();
}

/* ── NAVIGATION ── */
const PAGE_TITLES = {
  dashboard:  'Dashboard',
  joueurs:    'Joueurs',
  classement: 'Classement',
  amis:       'Réseau',
  nouveau:    'Nouveau joueur',
};

function showPage(name) {
  _currentPage = name;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');

  document.querySelectorAll(`[data-page="${name}"]`).forEach(el => el.classList.add('active'));

  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) titleEl.textContent = PAGE_TITLES[name] || name;

  // Auto-load
  if (name === 'dashboard')  { loadStats(); loadTop10(); }
  if (name === 'joueurs')    { loadJoueurs(); }
  if (name === 'classement') { loadTop10Full(); }

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('mobile-open');
}

function refreshCurrent() {
  showPage(_currentPage);
}

/* ── TAB SYSTEM ── */
function initTabs(container) {
  container.querySelectorAll('.tab-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      const bar    = btn.closest('.tab-bar');

      bar.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Find sibling panes
      let el = bar.nextElementSibling;
      while (el) {
        if (el.classList.contains('tab-pane')) {
          el.classList.toggle('active', el.id === target);
        }
        el = el.nextElementSibling;
      }
    });
  });
}

/* ── SIDEBAR TOGGLE ── */
document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

document.getElementById('mobileMenuBtn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.add('mobile-open');
});

/* ── NAV ITEMS ── */
document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
  btn.addEventListener('click', () => showPage(btn.dataset.page));
});

/* ── ALL TAB BARS ── */
document.querySelectorAll('.tab-bar').forEach(initTabs);

/* ── DRAWER ── */
function openDrawer() {
  document.getElementById('profilDrawer').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  document.getElementById('profilDrawer').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

// Legacy alias
function closePanel() { closeDrawer(); }

/* ── STATUS ── */
async function checkStatus() {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  try {
    await api('/api/stats');
    dot.className  = 'status-dot ok';
    text.textContent = '3 bases connectées';
  } catch {
    dot.className  = 'status-dot err';
    text.textContent = 'Connexion échouée';
  }
}

/* ── STATS ── */
async function loadStats() {
  try {
    const d = await api('/api/stats');
    document.getElementById('statTotal').textContent   = d.joueurs_total;
    document.getElementById('statClasses').textContent = d.joueurs_classes;
    if (d.leader) {
      document.getElementById('statLeader').textContent   = d.leader.nom;
      document.getElementById('statTopScore').textContent = fmtScore(d.leader.score);
    }
  } catch (e) { console.error('stats:', e); }
}

/* ── TOP 10 (rendu partagé + WebSocket) ── */
function top10TableHtml(top, colonneRang = 'Rang') {
  return `<div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:52px">${colonneRang}</th>
          <th>Joueur</th>
          <th>Identifiant</th>
          <th style="text-align:right">Score</th>
        </tr>
      </thead>
      <tbody>
        ${top.map(e => `
        <tr>
          <td><span class="rank-num ${rankClass(e.rang)}">${e.rang}</span></td>
          <td>
            <div class="player-cell">
              <div class="avatar">${initials(e.nom)}</div>
              <span class="player-name">${e.nom}</span>
            </div>
          </td>
          <td><span class="player-id">${e.id}</span></td>
          <td style="text-align:right">
            <span class="score-value">${fmtScore(e.score)}</span>
            <span class="score-unit">pts</span>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

/* Mise à jour immédiate des deux tables Top 10 (message WebSocket reçu) */
function majTop10Direct(top) {
  for (const idConteneur of ['top10Container', 'top10Full']) {
    const c = document.getElementById(idConteneur);
    if (c && c.querySelector('.data-table')) {
      c.innerHTML = top10TableHtml(top, idConteneur === 'top10Full' ? 'Rang' : '#');
    }
  }
  reinitIcons();
}

let _ws = null;
let _wsTimer = null;

function connecterWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  try {
    _ws = new WebSocket(`${proto}://${location.host}/ws/top10`);
  } catch (e) { return; }

  _ws.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data);
      if (d.type === 'top10') majTop10Direct(d.top);
    } catch (e) { /* message illisible : ignoré */ }
  };
  _ws.onclose = () => {
    clearTimeout(_wsTimer);
    _wsTimer = setTimeout(connecterWebSocket, 3000);   // reconnexion auto
  };
  _ws.onerror = () => { try { _ws.close(); } catch (e) { /* rien */ } };
}

/* ── TOP 10 (dashboard) ── */
async function loadTop10() {
  const c = document.getElementById('top10Container');
  c.innerHTML = '<div class="skeleton-table"></div>';
  try {
    const top = await api('/api/top10');
    if (!top.length) {
      c.innerHTML = emptyState('Aucun joueur classé', 'trophy');
      return;
    }
    c.innerHTML = top10TableHtml(top, '#');
    reinitIcons();
  } catch (e) {
    c.innerHTML = errorState(e.message);
    reinitIcons();
  }
}

/* ── TOP 10 (classement page) ── */
async function loadTop10Full() {
  const c = document.getElementById('top10Full');
  c.innerHTML = '<div class="skeleton-table"></div>';
  try {
    const top = await api('/api/top10');
    if (!top.length) {
      c.innerHTML = emptyState('Aucun joueur classé', 'trophy');
      return;
    }
    c.innerHTML = top10TableHtml(top, 'Rang');
    reinitIcons();
  } catch (e) {
    c.innerHTML = errorState(e.message);
    reinitIcons();
  }
}

/* ── CLASSEMENT AMIS ── */
async function loadClassementAmis() {
  const id = document.getElementById('classAmisId').value.trim();
  const c  = document.getElementById('classAmisResult');
  if (!id) { toast('Entrez un identifiant joueur', 'err'); return; }
  c.innerHTML = '<div class="skeleton-table" style="margin-top:1rem;height:160px"></div>';
  try {
    const data = await api(`/api/classement-amis/${id}`);
    if (!data.length) {
      c.innerHTML = emptyState('Aucun ami classé pour ce joueur', 'users');
      reinitIcons();
      return;
    }
    c.innerHTML = `<div class="table-wrap" style="margin-top:var(--sp-5)">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:52px">Rang</th>
            <th>Joueur</th>
            <th>ID</th>
            <th style="text-align:right">Score</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(e => `
          <tr>
            <td><span class="rank-num ${rankClass(e.rang)}">${e.rang}</span></td>
            <td>
              <div class="player-cell">
                <div class="avatar">${initials(e.nom)}</div>
                <span class="player-name">${e.nom}</span>
                ${e.id === id ? '<span class="you-tag">vous</span>' : ''}
              </div>
            </td>
            <td><span class="player-id">${e.id}</span></td>
            <td style="text-align:right">
              <span class="score-value">${fmtScore(e.score)}</span>
              <span class="score-unit">pts</span>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
    reinitIcons();
  } catch (e) {
    c.innerHTML = errorState(e.message);
    reinitIcons();
  }
}

/* ── JOUEURS ── */
async function loadJoueurs() {
  const c = document.getElementById('joueursContainer');
  c.innerHTML = '<div class="skeleton-table"></div>';
  try {
    _joueursCurrent = await api('/api/joueurs');
    renderJoueurs(_joueursCurrent);
  } catch (e) {
    c.innerHTML = errorState(e.message);
    reinitIcons();
  }
}

function renderJoueurs(list) {
  const c = document.getElementById('joueursContainer');
  if (!list.length) {
    c.innerHTML = emptyState('Aucun joueur trouvé', 'users');
    reinitIcons();
    return;
  }
  c.innerHTML = `<div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th>Joueur</th>
          <th>Identifiant</th>
          <th>Niveau</th>
          <th style="text-align:right">Score</th>
          <th style="text-align:right">Rang</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(j => `
        <tr class="player-row-action" onclick="showProfil('${j.id}')">
          <td>
            <div class="player-cell">
              <div class="avatar">${initials(j.pseudo)}</div>
              <span class="player-name">${j.pseudo}</span>
            </div>
          </td>
          <td><span class="player-id">${j.id}</span></td>
          <td><span class="player-id">${j.niveau}</span></td>
          <td style="text-align:right">
            <span class="score-value">${fmtScore(j.score)}</span>
            <span class="score-unit">pts</span>
          </td>
          <td style="text-align:right">
            ${j.rang ? `<span class="rank-num ${rankClass(j.rang)}">${j.rang}</span>` : '<span class="player-id">—</span>'}
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
  reinitIcons();
}

function filterJoueurs() {
  const q = document.getElementById('searchJoueur').value.toLowerCase();
  renderJoueurs(_joueursCurrent.filter(j =>
    j.pseudo.toLowerCase().includes(q) || j.id.toLowerCase().includes(q)
  ));
}

/* ── PROFIL (DRAWER) ── */
async function showProfil(id) {
  const title   = document.getElementById('profilTitre');
  const content = document.getElementById('profilContent');

  title.textContent = 'Chargement…';
  content.innerHTML = '<div class="skeleton-block"></div>';
  openDrawer();

  try {
    const j = await api(`/api/joueur/${id}`);
    title.textContent = j.pseudo;

    const invHtml = j.inventaire?.length
      ? j.inventaire.map(e => `<span class="tag">${e.objet} &times;${e.qte}</span>`).join('')
      : '<span class="player-id">Inventaire vide</span>';

    const amisHtml = j.amis?.length
      ? j.amis.map(a => `<span class="tag">${a.pseudo}</span>`).join('')
      : '<span class="player-id">Aucun ami</span>';

    content.innerHTML = `
      <div class="profil-hero">
        <div class="profil-avatar">${initials(j.pseudo)}</div>
        <div>
          <div class="profil-name">${j.pseudo}</div>
          <div class="profil-id">${j.id}</div>
        </div>
      </div>

      <div class="profil-stats-grid">
        <div class="profil-stat-item">
          <div class="profil-stat-value">${j.niveau}</div>
          <div class="profil-stat-label">Niveau</div>
          <div class="profil-stat-source">MongoDB</div>
        </div>
        <div class="profil-stat-item">
          <div class="profil-stat-value">${fmtScore(j.score)}</div>
          <div class="profil-stat-label">Score</div>
          <div class="profil-stat-source">Redis</div>
        </div>
        <div class="profil-stat-item">
          <div class="profil-stat-value">${j.rang ? '#' + j.rang : '—'}</div>
          <div class="profil-stat-label">Rang mondial</div>
          <div class="profil-stat-source">Redis</div>
        </div>
        <div class="profil-stat-item">
          <div class="profil-stat-value">${j.nb_amis}</div>
          <div class="profil-stat-label">Amis</div>
          <div class="profil-stat-source">Neo4j</div>
        </div>
      </div>

      <div class="profil-section">
        <div class="profil-section-title">Inventaire — MongoDB</div>
        <div class="tag-list">${invHtml}</div>
      </div>

      <div class="profil-section">
        <div class="profil-section-title">Amis — Neo4j</div>
        <div class="tag-list">${amisHtml}</div>
      </div>

      <div class="profil-actions">
        <button class="btn-primary btn-sm" onclick="quickAddPoints('${j.id}')">
          <i data-lucide="zap" class="icon-xs"></i>
          +100 pts
        </button>
        <button class="btn-danger" onclick="quickDelete('${j.id}', '${j.pseudo}')">
          <i data-lucide="trash-2" class="icon-xs"></i>
          Supprimer
        </button>
      </div>`;

    reinitIcons();
  } catch (e) {
    content.innerHTML = errorState(e.message);
    reinitIcons();
  }
}

async function quickAddPoints(id) {
  try {
    const r = await api(`/api/score/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ points: 100 }),
    });
    toast(`Score mis à jour — ${fmtScore(r.nouveau_score)} pts · rang #${r.rang}`);
    showProfil(id);
    loadStats();
  } catch (e) { toast(e.message, 'err'); }
}

async function quickDelete(id, pseudo) {
  if (!confirm(`Supprimer ${pseudo} des 3 bases de données ?`)) return;
  try {
    await api(`/api/joueur/${id}`, { method: 'DELETE' });
    toast(`${pseudo} supprimé`);
    closeDrawer();
    loadJoueurs();
    loadStats();
  } catch (e) { toast(e.message, 'err'); }
}

/* ── RÉSEAU / AMIS ── */
async function loadAmis() {
  const id = document.getElementById('amisJoueurId').value.trim();
  if (!id) { toast('Entrez un identifiant joueur', 'err'); return; }
  _amisCurrentId = id;

  const amisTabs = document.getElementById('amisTabs');
  amisTabs.style.display = 'block';

  // init tabs on this container
  amisTabs.querySelectorAll('.tab-bar').forEach(initTabs);

  loadAmisDirects(id);
  loadAmisReco(id);
}

async function loadAmisDirects(id) {
  const c = document.getElementById('amisDirectsResult');
  document.getElementById('amisDirectsTitre').textContent = `Amis de ${id}`;
  c.innerHTML = '<div class="skeleton-table" style="height:120px"></div>';
  try {
    const amis = await api(`/api/amis/${id}`);
    if (!amis.length) {
      c.innerHTML = emptyState('Aucun ami pour le moment', 'user-x');
      reinitIcons();
      return;
    }
    c.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>Joueur</th><th>ID</th>
        <th style="text-align:right">Score</th>
        <th style="text-align:right">Rang</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${amis.map(a => `
        <tr>
          <td>
            <div class="player-cell">
              <div class="avatar">${initials(a.pseudo)}</div>
              <span class="player-name">${a.pseudo}</span>
            </div>
          </td>
          <td><span class="player-id">${a.id}</span></td>
          <td style="text-align:right">
            <span class="score-value">${fmtScore(a.score)}</span>
            <span class="score-unit">pts</span>
          </td>
          <td style="text-align:right">
            ${a.rang ? `<span class="rank-num ${rankClass(a.rang)}">${a.rang}</span>` : '<span class="player-id">—</span>'}
          </td>
          <td style="text-align:right">
            <button class="btn-danger" onclick="supprimerAmi('${id}', '${a.id}')">
              <i data-lucide="user-minus" class="icon-xs"></i>
              Retirer
            </button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
    reinitIcons();
  } catch (e) {
    c.innerHTML = errorState(e.message);
    reinitIcons();
  }
}

async function loadAmisReco(id) {
  const c = document.getElementById('amisRecoResult');
  c.innerHTML = '<div class="skeleton-table" style="height:120px"></div>';
  try {
    const recs = await api(`/api/amis-damis/${id}`);
    if (!recs.length) {
      c.innerHTML = emptyState('Aucune suggestion disponible', 'users');
      reinitIcons();
      return;
    }
    c.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>Joueur</th><th>ID</th>
        <th>Amis en commun</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${recs.map(r => `
        <tr>
          <td>
            <div class="player-cell">
              <div class="avatar">${initials(r.pseudo)}</div>
              <span class="player-name">${r.pseudo}</span>
            </div>
          </td>
          <td><span class="player-id">${r.id}</span></td>
          <td><span class="mutual-tag">${r.amis_communs} en commun</span></td>
          <td style="text-align:right">
            <button class="btn-success" onclick="ajouterAmiDepuisReco('${id}', '${r.id}')">
              <i data-lucide="user-plus" class="icon-xs"></i>
              Ajouter
            </button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
    reinitIcons();
  } catch (e) {
    c.innerHTML = errorState(e.message);
    reinitIcons();
  }
}

async function ajouterAmi() {
  const id  = _amisCurrentId;
  const ami = document.getElementById('newAmiId').value.trim();
  if (!id || !ami) { toast('Entrez les deux identifiants', 'err'); return; }
  try {
    const r = await api('/api/ami', { method: 'POST', body: JSON.stringify({ id_a: id, id_b: ami }) });
    toast(r.message);
    document.getElementById('newAmiId').value = '';
    loadAmisDirects(id);
    loadAmisReco(id);
  } catch (e) { toast(e.message, 'err'); }
}

async function ajouterAmiDepuisReco(id, ami) {
  try {
    const r = await api('/api/ami', { method: 'POST', body: JSON.stringify({ id_a: id, id_b: ami }) });
    toast(r.message);
    loadAmisDirects(id);
    loadAmisReco(id);
  } catch (e) { toast(e.message, 'err'); }
}

async function supprimerAmi(id, ami) {
  try {
    await api('/api/ami', { method: 'DELETE', body: JSON.stringify({ id_a: id, id_b: ami }) });
    toast('Amitié supprimée');
    loadAmisDirects(id);
    loadAmisReco(id);
  } catch (e) { toast(e.message, 'err'); }
}

/* ── CRÉER JOUEUR ── */
async function creerJoueur(e) {
  e.preventDefault();
  const result = document.getElementById('createResult');
  const btn    = e.target.querySelector('button[type="submit"]');
  const data = {
    id:     document.getElementById('newId').value.trim(),
    pseudo: document.getElementById('newPseudo').value.trim(),
    niveau: parseInt(document.getElementById('newNiveau').value) || 1,
    score:  parseInt(document.getElementById('newScore').value)  || 0,
    mot_de_passe: document.getElementById('newMdp').value,
  };
  result.innerHTML = '';
  btn.disabled = true;
  try {
    const r = await api('/api/joueur', { method: 'POST', body: JSON.stringify(data) });
    result.innerHTML = `<div class="state-success"><i data-lucide="check-circle" class="icon-xs"></i>${r.message}</div>`;
    toast('Joueur créé dans les 3 bases');
    e.target.reset();
    document.getElementById('newNiveau').value = '1';
    document.getElementById('newScore').value  = '0';
    loadStats();
    reinitIcons();
  } catch (err) {
    result.innerHTML = `<div class="state-error"><i data-lucide="alert-circle" class="icon-xs"></i>${err.message}</div>`;
    toast(err.message, 'err');
    reinitIcons();
  } finally {
    btn.disabled = false;
  }
}

/* ── AJOUTER POINTS ── */
async function ajouterPoints(e) {
  e.preventDefault();
  const id     = document.getElementById('pointsId').value.trim();
  const pts    = parseInt(document.getElementById('pointsVal').value);
  const result = document.getElementById('pointsResult');
  const btn    = e.target.querySelector('button[type="submit"]');
  result.innerHTML = '';
  btn.disabled = true;
  try {
    const r = await api(`/api/score/${id}`, { method: 'PUT', body: JSON.stringify({ points: pts }) });
    result.innerHTML = `<div class="state-success">
      <i data-lucide="check-circle" class="icon-xs"></i>
      Nouveau score : <strong>${fmtScore(r.nouveau_score)} pts</strong> — rang #${r.rang}
    </div>`;
    toast(`Score mis à jour — ${fmtScore(r.nouveau_score)} pts`);
    loadStats();
    reinitIcons();
  } catch (err) {
    result.innerHTML = `<div class="state-error"><i data-lucide="alert-circle" class="icon-xs"></i>${err.message}</div>`;
    toast(err.message, 'err');
    reinitIcons();
  } finally {
    btn.disabled = false;
  }
}

/* ── BOOT ── */
checkStatus();
showPage('dashboard');
connecterWebSocket();
setInterval(checkStatus, 30_000);
