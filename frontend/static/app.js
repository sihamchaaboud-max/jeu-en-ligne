/* ═══════════════════════════════════════════
   JEU EN LIGNE — Frontend JavaScript
   ═══════════════════════════════════════════ */

const API = '';  // même domaine
let _joueursCurrent = [];
let _amisCurrentId  = null;

/* ── Utilitaires ── */
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

function toast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = ''; }, 3500);
}

function avatar(pseudo) {
  return (pseudo || '?').substring(0, 2).toUpperCase();
}

function medalEmoji(rang) {
  return rang === 1 ? '🥇' : rang === 2 ? '🥈' : rang === 3 ? '🥉' : '';
}

/* ── Navigation ── */
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => {
    if (b.getAttribute('onclick')?.includes(name)) b.classList.add('active');
  });

  // Chargement automatique
  if (name === 'dashboard') { loadStats(); loadTop10(); }
  if (name === 'joueurs')   { loadJoueurs(); }
  if (name === 'classement'){ loadTop10Full(); }
}

function switchTab(id, btn) {
  const parent = btn.closest('.tabs').nextElementSibling;
  // Désactiver tous les onglets du groupe
  btn.closest('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  // Trouver les contenus du même groupe
  let el = btn.closest('.tabs').nextElementSibling;
  while (el && el.classList.contains('tab-content')) {
    el.classList.remove('active');
    el = el.nextElementSibling;
  }
  document.getElementById(id).classList.add('active');
}

function closePanel(id) {
  document.getElementById(id).style.display = 'none';
}

/* ── Status ── */
async function checkStatus() {
  try {
    await api('/api/stats');
    document.getElementById('statusDot').className  = 'dot dot-ok';
    document.getElementById('statusText').textContent = '3 bases connectées';
  } catch {
    document.getElementById('statusDot').className  = 'dot dot-err';
    document.getElementById('statusText').textContent = 'Erreur de connexion';
  }
}

/* ── Stats Dashboard ── */
async function loadStats() {
  try {
    const data = await api('/api/stats');
    document.getElementById('statTotal').textContent   = data.joueurs_total;
    document.getElementById('statClasses').textContent  = data.joueurs_classes;
    if (data.leader) {
      document.getElementById('statLeader').textContent   = data.leader.nom;
      document.getElementById('statTopScore').textContent = data.leader.score.toLocaleString() + ' pts';
    }
  } catch (e) {
    console.error('Stats error:', e);
  }
}

/* ── Top 10 (dashboard) ── */
async function loadTop10() {
  const c = document.getElementById('top10Container');
  c.innerHTML = '<div class="loading">Chargement...</div>';
  try {
    const top = await api('/api/top10');
    if (!top.length) { c.innerHTML = '<div class="empty">Aucun joueur classé.</div>'; return; }
    c.innerHTML = `
      <table class="top10-table">
        <thead><tr>
          <th>Rang</th><th>Joueur</th><th>ID</th><th>Score</th>
        </tr></thead>
        <tbody>
          ${top.map(e => `
          <tr>
            <td><span class="rang-badge rang-${e.rang}">${medalEmoji(e.rang) || e.rang}</span></td>
            <td><strong>${e.nom}</strong></td>
            <td style="color:var(--text-muted)">${e.id}</td>
            <td><span class="score-pill">${e.score.toLocaleString()} pts</span></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    c.innerHTML = `<div class="error">Erreur : ${e.message}</div>`;
  }
}

/* ── Top 10 (page classement) ── */
async function loadTop10Full() {
  const c = document.getElementById('top10Full');
  c.innerHTML = '<div class="loading">Chargement...</div>';
  try {
    const top = await api('/api/top10');
    if (!top.length) { c.innerHTML = '<div class="empty">Aucun joueur classé.</div>'; return; }
    c.innerHTML = `
      <table class="top10-table">
        <thead><tr>
          <th>Rang</th><th>Joueur</th><th>ID</th><th>Score</th>
        </tr></thead>
        <tbody>
          ${top.map(e => `
          <tr>
            <td><span class="rang-badge rang-${e.rang}">${medalEmoji(e.rang) || '#' + e.rang}</span></td>
            <td>
              <div style="display:flex;align-items:center;gap:.6rem">
                <div class="joueur-avatar" style="width:32px;height:32px;font-size:.8rem">${avatar(e.nom)}</div>
                <strong>${e.nom}</strong>
              </div>
            </td>
            <td style="color:var(--text-muted)">${e.id}</td>
            <td><span class="score-pill">${e.score.toLocaleString()} pts</span></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    c.innerHTML = `<div class="error">Erreur : ${e.message}</div>`;
  }
}

/* ── Classement entre amis ── */
async function loadClassementAmis() {
  const id  = document.getElementById('classAmisId').value.trim();
  const c   = document.getElementById('classAmisResult');
  if (!id) { toast('Entrez un ID joueur', 'err'); return; }
  c.innerHTML = '<div class="loading">Chargement...</div>';
  try {
    const data = await api(`/api/classement-amis/${id}`);
    if (!data.length) { c.innerHTML = '<div class="empty">Aucun ami classé.</div>'; return; }
    c.innerHTML = `
      <table class="top10-table" style="margin-top:1rem">
        <thead><tr><th>Rang</th><th>Joueur</th><th>ID</th><th>Score</th></tr></thead>
        <tbody>
          ${data.map(e => `
          <tr style="${e.id === id ? 'background:rgba(99,102,241,.08)' : ''}">
            <td><span class="rang-badge rang-${e.rang}">${e.rang}</span></td>
            <td><strong>${e.nom}</strong> ${e.id === id ? '<span style="color:var(--green);font-size:.75rem"> ◄ toi</span>' : ''}</td>
            <td style="color:var(--text-muted)">${e.id}</td>
            <td><span class="score-pill">${e.score.toLocaleString()} pts</span></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    c.innerHTML = `<div class="error">${e.message}</div>`;
  }
}

/* ── Joueurs ── */
async function loadJoueurs() {
  const c = document.getElementById('joueursContainer');
  c.innerHTML = '<div class="loading">Chargement...</div>';
  try {
    _joueursCurrent = await api('/api/joueurs');
    renderJoueurs(_joueursCurrent);
  } catch (e) {
    c.innerHTML = `<div class="error">Erreur : ${e.message}</div>`;
  }
}

function renderJoueurs(list) {
  const c = document.getElementById('joueursContainer');
  if (!list.length) { c.innerHTML = '<div class="empty">Aucun joueur trouvé.</div>'; return; }
  c.innerHTML = `<div class="joueurs-grid">
    ${list.map(j => `
    <div class="joueur-card" onclick="showProfil('${j.id}')">
      <div class="joueur-card-header">
        <div>
          <div class="joueur-card-name">${j.pseudo}</div>
          <div class="joueur-card-id">ID: ${j.id}</div>
        </div>
        <div class="joueur-avatar">${avatar(j.pseudo)}</div>
      </div>
      <div class="joueur-card-stats">
        <span>⚔️ Niv. ${j.niveau}</span>
        <span>⭐ ${j.score?.toLocaleString() ?? '—'} pts</span>
        ${j.rang ? `<span>🏆 #${j.rang}</span>` : ''}
      </div>
    </div>`).join('')}
  </div>`;
}

function filterJoueurs() {
  const q = document.getElementById('searchJoueur').value.toLowerCase();
  renderJoueurs(_joueursCurrent.filter(j =>
    j.pseudo.toLowerCase().includes(q) || j.id.toLowerCase().includes(q)
  ));
}

async function showProfil(id) {
  const panel = document.getElementById('profilPanel');
  const content = document.getElementById('profilContent');
  const titre   = document.getElementById('profilTitre');
  panel.style.display = 'block';
  content.innerHTML = '<div class="loading">Chargement...</div>';
  try {
    const j = await api(`/api/joueur/${id}`);
    titre.textContent = `Profil — ${j.pseudo}`;
    const inv = j.inventaire?.length
      ? `<div class="inventory-list">${j.inventaire.map(e => `<span class="inventory-item">🎒 ${e.objet} x${e.qte}</span>`).join('')}</div>`
      : '<span style="color:var(--text-muted)">Inventaire vide</span>';
    const amisHtml = j.amis?.length
      ? j.amis.map(a => `<span class="inventory-item">👤 ${a.pseudo}</span>`).join('')
      : '<span style="color:var(--text-muted)">Aucun ami</span>';

    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem">
        <div class="joueur-avatar" style="width:56px;height:56px;font-size:1.3rem">${avatar(j.pseudo)}</div>
        <div>
          <div style="font-size:1.3rem;font-weight:800">${j.pseudo}</div>
          <div style="color:var(--text-muted)">ID : ${j.id}</div>
        </div>
      </div>

      <div class="profil-grid">
        <div class="profil-stat">
          <div class="profil-stat-val">Niv. ${j.niveau}</div>
          <div class="profil-stat-label">Niveau (MongoDB)</div>
        </div>
        <div class="profil-stat">
          <div class="profil-stat-val">${j.score?.toLocaleString() ?? '—'} pts</div>
          <div class="profil-stat-label">Score (Redis)</div>
        </div>
        <div class="profil-stat">
          <div class="profil-stat-val">${j.rang ? '#' + j.rang : '—'}</div>
          <div class="profil-stat-label">Rang mondial (Redis)</div>
        </div>
        <div class="profil-stat">
          <div class="profil-stat-val">${j.nb_amis}</div>
          <div class="profil-stat-label">Amis (Neo4j)</div>
        </div>
      </div>

      <div style="margin-top:1rem">
        <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.4rem;text-transform:uppercase;letter-spacing:1px">Inventaire (MongoDB)</div>
        ${inv}
      </div>

      <div style="margin-top:1rem">
        <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.4rem;text-transform:uppercase;letter-spacing:1px">Amis (Neo4j)</div>
        <div class="inventory-list">${amisHtml}</div>
      </div>

      <div style="margin-top:1.5rem;display:flex;gap:.5rem;flex-wrap:wrap">
        <button class="btn-primary" onclick="quickAddPoints('${j.id}')">⚡ +100 pts</button>
        <button class="btn-danger"  onclick="quickDelete('${j.id}', '${j.pseudo}')">🗑 Supprimer</button>
      </div>`;

    panel.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    content.innerHTML = `<div class="error">${e.message}</div>`;
  }
}

async function quickAddPoints(id) {
  try {
    const r = await api(`/api/score/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ points: 100 }),
    });
    toast(`✓ +100 pts → score ${r.nouveau_score} pts (rang #${r.rang})`);
    showProfil(id);
    loadStats();
  } catch (e) { toast(e.message, 'err'); }
}

async function quickDelete(id, pseudo) {
  if (!confirm(`Supprimer ${pseudo} des 3 bases ?`)) return;
  try {
    await api(`/api/joueur/${id}`, { method: 'DELETE' });
    toast(`✓ ${pseudo} supprimé`);
    closePanel('profilPanel');
    loadJoueurs();
    loadStats();
  } catch (e) { toast(e.message, 'err'); }
}

/* ── Amis ── */
async function loadAmis() {
  const id = document.getElementById('amisJoueurId').value.trim();
  if (!id) { toast('Entrez un ID joueur', 'err'); return; }
  _amisCurrentId = id;

  const tabs = document.getElementById('amisTabs');
  const dirDiv = document.getElementById('tab-amis-directs');
  const recoDiv = document.getElementById('tab-amis-reco');
  tabs.style.display    = 'flex';
  dirDiv.style.display  = 'block';
  recoDiv.style.display = 'block';

  // Charger les deux en parallèle
  loadAmisDirects(id);
  loadAmisReco(id);
}

async function loadAmisDirects(id) {
  const c = document.getElementById('amisDirectsResult');
  document.getElementById('amisDirectsTitre').textContent = `Amis directs de ${id}`;
  c.innerHTML = '<div class="loading">Chargement...</div>';
  try {
    const amis = await api(`/api/amis/${id}`);
    if (!amis.length) { c.innerHTML = '<div class="empty">Aucun ami pour le moment.</div>'; return; }
    c.innerHTML = `<div class="amis-list">
      ${amis.map(a => `
      <div class="ami-row">
        <div class="ami-info">
          <div class="ami-avatar">${avatar(a.pseudo)}</div>
          <div>
            <div style="font-weight:600">${a.pseudo}</div>
            <div style="font-size:.75rem;color:var(--text-muted)">${a.id} • ${a.score?.toLocaleString() ?? '—'} pts${a.rang ? ' • #' + a.rang : ''}</div>
          </div>
        </div>
        <div class="ami-actions">
          <button class="btn-danger" onclick="supprimerAmi('${id}', '${a.id}')">Retirer</button>
        </div>
      </div>`).join('')}
    </div>`;
  } catch (e) {
    c.innerHTML = `<div class="error">${e.message}</div>`;
  }
}

async function loadAmisReco(id) {
  const c = document.getElementById('amisRecoResult');
  c.innerHTML = '<div class="loading">Chargement...</div>';
  try {
    const recs = await api(`/api/amis-damis/${id}`);
    if (!recs.length) { c.innerHTML = '<div class="empty">Aucune suggestion disponible.</div>'; return; }
    c.innerHTML = recs.map(r => `
      <div class="reco-row">
        <div class="ami-info">
          <div class="ami-avatar" style="background:linear-gradient(135deg,var(--purple),var(--cyan))">${avatar(r.pseudo)}</div>
          <div>
            <div style="font-weight:600">${r.pseudo}</div>
            <div style="font-size:.75rem;color:var(--text-muted)">${r.id}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:.5rem">
          <span class="commun-badge">👥 ${r.amis_communs} en commun</span>
          <button class="btn-success" style="font-size:.8rem;padding:.3rem .7rem" onclick="ajouterAmiDepuisReco('${id}', '${r.id}')">+ Ajouter</button>
        </div>
      </div>`).join('');
  } catch (e) {
    c.innerHTML = `<div class="error">${e.message}</div>`;
  }
}

async function ajouterAmi() {
  const id  = _amisCurrentId;
  const ami = document.getElementById('newAmiId').value.trim();
  if (!id || !ami) { toast('Entrez les deux IDs', 'err'); return; }
  try {
    const r = await api('/api/ami', { method: 'POST', body: JSON.stringify({ id_a: id, id_b: ami }) });
    toast('✓ ' + r.message);
    document.getElementById('newAmiId').value = '';
    loadAmisDirects(id);
    loadAmisReco(id);
  } catch (e) { toast(e.message, 'err'); }
}

async function ajouterAmiDepuisReco(id, ami) {
  try {
    const r = await api('/api/ami', { method: 'POST', body: JSON.stringify({ id_a: id, id_b: ami }) });
    toast('✓ ' + r.message);
    loadAmisDirects(id);
    loadAmisReco(id);
  } catch (e) { toast(e.message, 'err'); }
}

async function supprimerAmi(id, ami) {
  try {
    await api('/api/ami', { method: 'DELETE', body: JSON.stringify({ id_a: id, id_b: ami }) });
    toast('✓ Amitié supprimée');
    loadAmisDirects(id);
    loadAmisReco(id);
  } catch (e) { toast(e.message, 'err'); }
}

/* ── Créer joueur ── */
async function creerJoueur(e) {
  e.preventDefault();
  const result = document.getElementById('createResult');
  const data = {
    id:     document.getElementById('newId').value.trim(),
    pseudo: document.getElementById('newPseudo').value.trim(),
    niveau: parseInt(document.getElementById('newNiveau').value) || 1,
    score:  parseInt(document.getElementById('newScore').value)  || 0,
  };
  result.innerHTML = '<div class="loading">Création en cours...</div>';
  try {
    const r = await api('/api/joueur', { method: 'POST', body: JSON.stringify(data) });
    result.innerHTML = `<div class="success">✅ ${r.message}</div>`;
    toast('✓ Joueur créé dans les 3 bases !');
    e.target.reset();
    document.getElementById('newNiveau').value = '1';
    document.getElementById('newScore').value  = '0';
    loadStats();
  } catch (err) {
    result.innerHTML = `<div class="error">✗ ${err.message}</div>`;
    toast(err.message, 'err');
  }
}

/* ── Ajouter points ── */
async function ajouterPoints(e) {
  e.preventDefault();
  const id  = document.getElementById('pointsId').value.trim();
  const pts = parseInt(document.getElementById('pointsVal').value);
  const result = document.getElementById('pointsResult');
  try {
    const r = await api(`/api/score/${id}`, { method: 'PUT', body: JSON.stringify({ points: pts }) });
    result.innerHTML = `<div class="success">✅ Nouveau score : <strong>${r.nouveau_score.toLocaleString()} pts</strong> — Rang #${r.rang}</div>`;
    toast(`✓ Score mis à jour → ${r.nouveau_score} pts`);
    loadStats();
  } catch (err) {
    result.innerHTML = `<div class="error">✗ ${err.message}</div>`;
    toast(err.message, 'err');
  }
}

/* ── Init ── */
checkStatus();
showPage('dashboard');
setInterval(checkStatus, 30000);
