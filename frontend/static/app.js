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
  const headers = { 'Content-Type': 'application/json' };
  if (typeof tokenSession === 'function') {
    const token = tokenSession();
    if (token) headers.Authorization = 'Bearer ' + token;
  }
  const r = await fetch(API + path, {
    headers,
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

/* Échappe tout texte inséré dans du HTML (anti-XSS : pseudos et IDs sont saisis par des joueurs) */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
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
    <span class="state-empty-text">${esc(msg)}</span>
  </div>`;
}

function errorState(msg) {
  return `<div class="state-error">
    <i data-lucide="alert-circle" class="icon-xs"></i>
    ${esc(msg)}
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
  moi:        'Mon espace',
  quiz:       'Quiz de calcul',
  nouveau:    'Inscription',
};

function showPage(name) {
  // L'inscription est réservée aux visiteurs : un joueur connecté n'y a pas accès.
  if (name === 'nouveau' && typeof estAuthentifie === 'function' && estAuthentifie()) {
    if (typeof toast === 'function') toast('Déjà connecté : l\'inscription est réservée aux visiteurs.', 'err');
    name = 'dashboard';
  }
  // Mon espace est privé : réservé aux joueurs connectés.
  if (name === 'moi' && !(typeof estAuthentifie === 'function' && estAuthentifie())) {
    if (typeof toast === 'function') toast('Connecte-toi pour ouvrir ton espace.', 'err');
    name = 'dashboard';
  }
  _currentPage = name;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });

  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');

  document.querySelectorAll(`[data-page="${name}"]`).forEach(el => {
    el.classList.add('active');
    el.setAttribute('aria-current', 'page');
  });

  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) titleEl.textContent = PAGE_TITLES[name] || name;

  // Synchronise l'URL sans recharger (partageable)
  if (history.replaceState && location.hash !== '#' + name) {
    history.replaceState(null, '', '#' + name);
  }

  // Auto-load
  if (name === 'dashboard')  { loadStats(); loadTop10(); }
  if (name === 'joueurs')    { loadJoueurs(); }
  if (name === 'classement') { loadTop10Full(); }
  if (name === 'moi' && typeof chargerMonEspace === 'function') chargerMonEspace();

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('mobile-open');
}

function refreshCurrent() {
  showPage(_currentPage);
}

/* L'inscription (création de joueur) n'est visible que hors connexion ;
   « Mon espace » n'est visible qu'une fois connecté. */
function appliquerReglesAuth() {
  const auth = typeof estAuthentifie === 'function' && estAuthentifie();
  const nav = document.getElementById('navInscription');
  if (nav) nav.style.display = auth ? 'none' : '';
  const btn = document.getElementById('btnInscription');
  if (btn) btn.style.display = auth ? 'none' : '';
  const navEspace = document.getElementById('navEspace');
  if (navEspace) navEspace.style.display = auth ? '' : 'none';
  if (auth && _currentPage === 'nouveau') showPage('dashboard');
  if (!auth && _currentPage === 'moi') showPage('dashboard');
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
let _drawerPreviousFocus = null;
let _profilRequete = 0;

function openDrawer() {
  if (!document.getElementById('profilDrawer').classList.contains('open')) {
    _drawerPreviousFocus = document.activeElement;
  }
  document.getElementById('profilDrawer').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  // Le focus va au tiroir : navigation clavier immédiate
  const closeBtn = document.querySelector('#profilDrawer .icon-btn');
  if (closeBtn) closeBtn.focus();
}

function closeDrawer() {
  _profilRequete += 1;
  if (typeof detruireCyProfil === 'function') detruireCyProfil();
  document.getElementById('profilDrawer').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
  document.body.style.overflow = '';
  if (_drawerPreviousFocus && typeof _drawerPreviousFocus.focus === 'function') {
    _drawerPreviousFocus.focus();
    _drawerPreviousFocus = null;
  }
}

/* Échap ferme le tiroir */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('profilDrawer').classList.contains('open')) {
    closeDrawer();
  }
});

/* Échap ferme aussi la sidebar mobile */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('sidebar').classList.remove('mobile-open');
  }
});

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
        <tr data-player-id="${esc(e.id)}">
          <td><span class="rank-num ${rankClass(e.rang)}">${esc(e.rang)}</span></td>
          <td>
            <div class="player-cell">
              <div class="avatar">${initials(e.nom)}</div>
              <span class="player-name">${esc(e.nom)}</span>
            </div>
          </td>
          <td><span class="player-id">${esc(e.id)}</span></td>
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
  if (!c) return;   // le classement complet est rendu par leaderboard.js
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
            <td><span class="rank-num ${rankClass(e.rang)}">${esc(e.rang)}</span></td>
            <td>
              <div class="player-cell">
                <div class="avatar">${initials(e.nom)}</div>
                <span class="player-name">${esc(e.nom)}</span>
                ${e.id === id ? '<span class="you-tag">vous</span>' : ''}
              </div>
            </td>
            <td><span class="player-id">${esc(e.id)}</span></td>
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
        <tr class="player-row-action" data-joueur-id="${esc(j.id)}">
          <td>
            <div class="player-cell">
              <div class="avatar">${initials(j.pseudo)}</div>
              <span class="player-name">${esc(j.pseudo)}</span>
            </div>
          </td>
          <td><span class="player-id">${esc(j.id)}</span></td>
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
  const requete = ++_profilRequete;
  const title   = document.getElementById('profilTitre');
  const content = document.getElementById('profilContent');

  title.textContent = 'Chargement…';
  if (typeof detruireCyProfil === 'function') detruireCyProfil();
  content.innerHTML = '<div class="skeleton-block"></div>';
  openDrawer();

  try {
    const j = await api(`/api/joueur/${id}`);
    if (requete !== _profilRequete) return;
    title.textContent = j.pseudo;

    const invHtml = j.inventaire?.length
      ? j.inventaire.map(e => `<span class="tag">${esc(e.objet)} &times;${esc(e.qte)}</span>`).join('')
      : '<span class="player-id">Inventaire vide</span>';

    const amisHtml = j.amis?.length
      ? j.amis.map(a => `<span class="tag">${esc(a.pseudo)}</span>`).join('')
      : '<span class="player-id">Aucun ami</span>';

    content.innerHTML = `
      <div class="profil-hero">
        <div class="profil-avatar">${initials(j.pseudo)}</div>
        <div>
          <div class="profil-name">${esc(j.pseudo)}</div>
          <div class="profil-id">${esc(j.id)}</div>
        </div>
      </div>

      <div class="profil-stats-grid">
        <div class="profil-stat-item">
          <div class="profil-stat-value">${esc(j.niveau)}</div>
          <div class="profil-stat-label">Niveau</div>
          <div class="profil-stat-source">MongoDB</div>
        </div>
        <div class="profil-stat-item">
          <div class="profil-stat-value">${fmtScore(j.score)}</div>
          <div class="profil-stat-label">Score</div>
          <div class="profil-stat-source">Redis</div>
        </div>
        <div class="profil-stat-item">
          <div class="profil-stat-value">${j.rang ? '#' + esc(j.rang) : '—'}</div>
          <div class="profil-stat-label">Rang mondial</div>
          <div class="profil-stat-source">Redis</div>
        </div>
        <div class="profil-stat-item">
          <div class="profil-stat-value">${esc(j.nb_amis)}</div>
          <div class="profil-stat-label">Amis</div>
          <div class="profil-stat-source">Neo4j</div>
        </div>
      </div>

      <div class="profil-section profil-graphe-section">
        <div class="profil-graphe-heading">
          <div>
            <div class="profil-section-title">Réseau d'amis — Neo4j</div>
            <p class="profil-graphe-sub" id="profilGrapheSousTitre">Chargement du réseau…</p>
          </div>
          <div class="profil-graphe-actions">
            <label class="player-graph-toggle" title="Afficher / masquer les suggestions">
              <input type="checkbox" id="profilGrapheSuggestions" checked/>
              <span>Suggestions</span>
            </label>
            <button class="btn-ghost btn-sm" id="profilGrapheFit" aria-label="Recentrer le réseau">
              <i data-lucide="maximize-2" class="icon-xs"></i>
            </button>
          </div>
        </div>
        <div class="graph-shell profil-graphe-shell">
          <div class="graph-canvas-wrap profil-graphe-wrap">
            <div id="profilGrapheViz" aria-label="Réseau d'amis interactif du joueur"></div>
            <div class="graph-loading" id="profilGrapheLoading">Chargement du réseau…</div>
            <div class="graph-empty" id="profilGrapheEmpty" style="display:none"></div>
          </div>
          <div class="graph-legend profil-graphe-legend">
            <span class="lg-item"><span class="lg-swatch" style="background:#F2B03D"></span> Joueur</span>
            <span class="lg-item"><span class="lg-swatch" style="background:#6FA7E8"></span> Amis</span>
            <span class="lg-item"><span class="lg-swatch lg-swatch-dashed" style="background:#9B8BE8"></span> Suggestions</span>
            <span class="lg-item">Clic sur un nœud → son profil</span>
          </div>
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

      <div class="profil-section">
        <div class="profil-section-title">Historique des parties — MongoDB</div>
        <div id="profilHistorique"></div>
      </div>

      <div class="profil-actions">
        <button class="btn-danger" data-action="delete-player" data-id="${esc(j.id)}" data-pseudo="${esc(j.pseudo)}">
          <i data-lucide="trash-2" class="icon-xs"></i>
          Supprimer
        </button>
      </div>`;

    reinitIcons();
    chargerHistorique(j.id, content.querySelector('#profilHistorique'));
    if (typeof chargerGrapheProfil === 'function') chargerGrapheProfil(j.id);
  } catch (e) {
    if (requete !== _profilRequete) return;
    content.innerHTML = errorState(e.message);
    reinitIcons();
  }
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

  // L'indice de guidance n'a plus lieu d'être une fois les résultats affichés
  const hint = document.getElementById('amisHint');
  if (hint) hint.style.display = 'none';

  // init tabs on this container
  amisTabs.querySelectorAll('.tab-bar').forEach(initTabs);

  loadAmisDirects(id);
  loadAmisReco(id);
  if (typeof chargerGrapheJoueur === 'function') chargerGrapheJoueur(id, { force: true });
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
              <span class="player-name">${esc(a.pseudo)}</span>
            </div>
          </td>
          <td><span class="player-id">${esc(a.id)}</span></td>
          <td style="text-align:right">
            <span class="score-value">${fmtScore(a.score)}</span>
            <span class="score-unit">pts</span>
          </td>
          <td style="text-align:right">
            ${a.rang ? `<span class="rank-num ${rankClass(a.rang)}">${esc(a.rang)}</span>` : '<span class="player-id">—</span>'}
          </td>
          <td style="text-align:right">
            <button class="btn-danger" data-action="remove-ami" data-a="${esc(id)}" data-ami="${esc(a.id)}">
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
              <span class="player-name">${esc(r.pseudo)}</span>
            </div>
          </td>
          <td><span class="player-id">${esc(r.id)}</span></td>
          <td><span class="mutual-tag">${esc(r.amis_communs)} en commun</span></td>
          <td style="text-align:right">
            <button class="btn-success" data-action="add-ami" data-a="${esc(id)}" data-ami="${esc(r.id)}">
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
    if (typeof rafraichirGrapheJoueur === 'function') rafraichirGrapheJoueur();
  } catch (e) { toast(e.message, 'err'); }
}

async function ajouterAmiDepuisReco(id, ami) {
  try {
    const r = await api('/api/ami', { method: 'POST', body: JSON.stringify({ id_a: id, id_b: ami }) });
    toast(r.message);
    loadAmisDirects(id);
    loadAmisReco(id);
    if (typeof rafraichirGrapheJoueur === 'function') rafraichirGrapheJoueur();
  } catch (e) { toast(e.message, 'err'); }
}

async function supprimerAmi(id, ami) {
  try {
    await api('/api/ami', { method: 'DELETE', body: JSON.stringify({ id_a: id, id_b: ami }) });
    toast('Amitié supprimée');
    loadAmisDirects(id);
    loadAmisReco(id);
    if (typeof rafraichirGrapheJoueur === 'function') rafraichirGrapheJoueur();
  } catch (e) { toast(e.message, 'err'); }
}

/* ── CRÉER JOUEUR ── */
async function creerJoueur(e) {
  e.preventDefault();
  const result = document.getElementById('createResult');
  const btn    = e.target.querySelector('button[type="submit"]');
  const motDePasse = document.getElementById('newMdp').value;
  const data = {
    id:     document.getElementById('newId').value.trim(),
    pseudo: document.getElementById('newPseudo').value.trim(),
    niveau: 1,
    score:  0,
    mot_de_passe: motDePasse,
  };
  result.innerHTML = '';
  btn.disabled = true;
  try {
    const r = await api('/api/joueur', { method: 'POST', body: JSON.stringify(data) });

    // Inscription = ouverture de session immédiate : le joueur n'a plus
    // accès au formulaire « ajouter un joueur » une fois connecté.
    if (typeof connecterJoueur === 'function') {
      try {
        await connecterJoueur(data.id, motDePasse);
        result.innerHTML = `<div class="state-success"><i data-lucide="check-circle" class="icon-xs"></i>Compte créé — bienvenue ${data.pseudo} !</div>`;
        toast('Compte créé — tu es connecté');
        e.target.reset();
        loadStats();
        reinitIcons();
        showPage('dashboard');
        return;
      } catch (_) { /* l'inscription a réussi : on propose la connexion manuelle */ }
    }

    result.innerHTML = `<div class="state-success"><i data-lucide="check-circle" class="icon-xs"></i>${r.message}</div>`;
    toast('Compte créé dans les 3 bases');
    e.target.reset();
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

/* ── WEBSOCKET — temps réel ──
   Un seul canal /ws/top10, plusieurs types d'événements :
   {type:"top10"}   → rendu par défaut des tables
   {type:"activite"} → notifications (notifications.js s'abonne via onWsMessage) */
let _wsListeners = [];

function onWsMessage(type, fn) {
  _wsListeners.push({ type, fn });
}

function connecterWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url   = `${proto}://${location.host}/ws/top10`;
  let ws;
  let tentative = 0;

  function connecter() {
    ws = new WebSocket(url);

    ws.onopen = () => {
      tentative = 0;
      // Allumer le badge "En direct" (classe .on — cf. .live-badge.on dans style.css)
      const badge = document.getElementById('liveBadge');
      if (badge) badge.classList.add('on');
    };

    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch (_) { return; }
      // Rendu par défaut du Top 10
      if (msg.type === 'top10') {
        _renderTop10(msg.top, 'top10Container', '#');
        _renderTop10(msg.top, 'top10Full', 'Rang');
        // Mettre à jour les métriques du dashboard
        if (msg.top.length > 0) {
          const leader = msg.top[0];
          const el = document.getElementById('statLeader');
          if (el) el.textContent = leader.nom;
          const sc = document.getElementById('statTopScore');
          if (sc) sc.textContent = fmtScore(leader.score);
        }
      }
      // Abonnés externes (notifications, graphes, etc.)
      _wsListeners.forEach((l) => { if (l.type === msg.type) l.fn(msg); });
    };

    ws.onclose = () => {
      const badge = document.getElementById('liveBadge');
      if (badge) badge.classList.remove('on');
      // Reconnexion exponentielle (max 30 s)
      const delai = Math.min(1000 * 2 ** tentative, 30000);
      tentative++;
      setTimeout(connecter, delai);
    };

    ws.onerror = () => ws.close();
  }

  connecter();
}

function _renderTop10(top, containerId, labelRang) {
  const c = document.getElementById(containerId);
  if (!c || !top.length) return;
  c.innerHTML = `<div class="table-wrap">
    <table class="data-table">
      <thead><tr>
        <th style="width:52px">${labelRang}</th>
        <th>Joueur</th><th>Identifiant</th>
        <th style="text-align:right">Score</th>
      </tr></thead>
      <tbody>
        ${top.map(e => `
        <tr data-player-id="${esc(e.id)}">
          <td><span class="rank-num ${rankClass(e.rang)}">${esc(e.rang)}</span></td>
          <td><div class="player-cell">
            <div class="avatar">${initials(e.nom)}</div>
            <span class="player-name">${esc(e.nom)}</span>
          </div></td>
          <td><span class="player-id">${esc(e.id)}</span></td>
          <td style="text-align:right">
            <span class="score-value">${fmtScore(e.score)}</span>
            <span class="score-unit">pts</span>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
  reinitIcons();
}

/* ── HISTORIQUE dans le drawer de profil ── */
async function chargerHistorique(joueurId, container) {
  container.innerHTML = '<div class="skeleton-table" style="height:80px"></div>';
  try {
    const [historique, stats] = await Promise.all([
      api(`/api/historique/${joueurId}?limite=5`),
      api(`/api/stats-joueur/${joueurId}`),
    ]);

    if (!historique.length) {
      container.innerHTML = '<span class="player-id">Aucune partie jouée</span>';
      return;
    }

    const statsHtml = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3);margin-bottom:var(--sp-4)">
        <div class="profil-stat-item">
          <div class="profil-stat-value">${stats.nb_parties}</div>
          <div class="profil-stat-label">Parties jouées</div>
          <div class="profil-stat-source">MongoDB</div>
        </div>
        <div class="profil-stat-item">
          <div class="profil-stat-value">${fmtScore(stats.meilleur_score)}</div>
          <div class="profil-stat-label">Meilleur score</div>
          <div class="profil-stat-source">MongoDB</div>
        </div>
      </div>`;

    const graphiqueHtml = historique.length >= 2 && typeof dessinerGraphiqueProfil === 'function'
      ? `<div class="chart-box" style="height:150px;margin-bottom:var(--sp-4)">
           <canvas id="profilChart"></canvas>
         </div>`
      : '';

    const rows = historique.map(p => {
      const date = new Date(p.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
      return `<tr>
        <td><span class="player-id">${date}</span></td>
        <td><span class="score-value">${fmtScore(p.points)}</span> <span class="score-unit">pts</span></td>
        <td><span class="player-id">${p.bonnes}/10</span></td>
        <td><span class="player-id">${p.duree}s</span></td>
      </tr>`;
    }).join('');

    container.innerHTML = statsHtml + graphiqueHtml + `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Date</th><th>Score</th><th>Bonnes rép.</th><th>Durée</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    reinitIcons();
    if (graphiqueHtml) dessinerGraphiqueProfil(historique);
  } catch (e) {
    container.innerHTML = `<span class="player-id" style="color:var(--text-disabled)">Historique indisponible</span>`;
  }
}

/* ── DÉLÉGATION D'ÉVÉNEMENTS ──
   Les handlers vivent sur les conteneurs (persists aux re-rendus) ;
   les données transitent par data-attributes, jamais par onclick inline. */
document.getElementById('joueursContainer').addEventListener('click', (e) => {
  const row = e.target.closest('[data-joueur-id]');
  if (row) showProfil(row.dataset.joueurId);
});

document.getElementById('profilContent').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'delete-player') quickDelete(btn.dataset.id, btn.dataset.pseudo);
});

document.getElementById('amisDirectsResult').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="remove-ami"]');
  if (btn) supprimerAmi(btn.dataset.a, btn.dataset.ami);
});

document.getElementById('amisRecoResult').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="add-ami"]');
  if (btn) ajouterAmiDepuisReco(btn.dataset.a, btn.dataset.ami);
});

const _inputAmis = document.getElementById('amisJoueurId');
if (_inputAmis) _inputAmis.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); loadAmis(); }
});

/* ── BOOT ── */
checkStatus();
connecterWebSocket();

// Liens profonds : /#classement ouvre directement la page (et l'historique reste propre)
function pageDepuisHash() {
  const nom = location.hash.replace('#', '');
  return nom && document.getElementById('page-' + nom) ? nom : 'dashboard';
}
showPage(pageDepuisHash());
window.addEventListener('hashchange', () => showPage(pageDepuisHash()));
document.addEventListener('arena:session', appliquerReglesAuth);
appliquerReglesAuth();

setInterval(checkStatus, 30_000);
