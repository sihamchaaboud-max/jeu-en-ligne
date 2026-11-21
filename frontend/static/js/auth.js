/* ═══════════════════════════════════════════════════════════════
   ARENA — Session & Connexion joueur
   Stockage local : { joueur_id, pseudo, token|null }
   token null  → joueur "héritage" sans mot de passe (identité mémorisée seulement)
   token JWT   → joueur protégé, envoyé en Authorization: Bearer
   Sûr sur les deux pages : toutes les recherches DOM sont gardées.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const SESSION_KEY = 'arena_session';

function lireSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch (_) { return null; }
}

function ecrireSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

function sessionCourante() { return lireSession(); }

function tokenSession() {
  const s = lireSession();
  return (s && s.token) || null;
}

/* ── Modale de connexion ── */
function ouvrirConnexion() {
  const m = document.getElementById('modalConnexion');
  const o = document.getElementById('modalConnexionOverlay');
  if (!m || !o) return;
  const s = lireSession();
  // Pré-remplir avec la dernière identité
  const champId = document.getElementById('loginJoueurId');
  if (champId && s) champId.value = s.joueur_id;
  const champMdp = document.getElementById('loginMdp');
  if (champMdp) champMdp.value = '';
  m.classList.add('open');
  o.classList.add('open');
  if (champId) champId.focus();
}

function fermerConnexion() {
  const m = document.getElementById('modalConnexion');
  const o = document.getElementById('modalConnexionOverlay');
  if (m) m.classList.remove('open');
  if (o) o.classList.remove('open');
}

function basculerModeConnexion(mode) {
  const paneLogin = document.getElementById('loginPane');
  const paneMdp   = document.getElementById('mdpPane');
  const btnLogin  = document.getElementById('btnVersMdp');
  const btnMdp    = document.getElementById('btnVersLogin');
  if (!paneLogin || !paneMdp) return;
  const versMdp = (mode === 'mdp');
  paneLogin.style.display = versMdp ? 'none' : '';
  paneMdp.style.display   = versMdp ? '' : 'none';
  if (btnLogin) btnLogin.style.display = versMdp ? 'none' : '';
  if (btnMdp) btnMdp.style.display = versMdp ? '' : 'none';
}

async function seConnecter(evenement) {
  evenement.preventDefault();
  const id  = (document.getElementById('loginJoueurId')?.value || '').trim();
  const mdp = document.getElementById('loginMdp')?.value || '';
  const err = document.getElementById('loginErreur');
  if (!id) { if (err) err.textContent = 'Entrez un identifiant joueur.'; return; }
  if (err) err.textContent = '';

  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ joueur_id: id, mot_de_passe: mdp }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || 'Connexion impossible');

    const pseudo = d.pseudo || id;
    if (d.sans_mot_de_passe) {
      // Joueur héritage : identité mémorisée, pas de token
      ecrireSession({ joueur_id: id, pseudo, token: null });
      fermerConnexion();
      rafraichirSessionUi();
      if (typeof toast === 'function') toast(`Bienvenue ${pseudo} (mode héritage, sans mot de passe)`);
    } else {
      ecrireSession({ joueur_id: id, pseudo, token: d.token });
      fermerConnexion();
      rafraichirSessionUi();
      if (typeof toast === 'function') toast(`Connecté : ${pseudo}`);
    }
    // Pré-remplit le quiz si présent
    const q = document.getElementById('quizJoueurId');
    if (q && !q.value) q.value = id;
  } catch (e) {
    if (err) err.textContent = e.message;
  }
}

function seDeconnecter() {
  ecrireSession(null);
  rafraichirSessionUi();
  if (typeof toast === 'function') toast('Déconnecté');
}

async function changerMotDePasse(evenement) {
  evenement.preventDefault();
  const s = lireSession();
  const err = document.getElementById('mdpErreur');
  if (!s || !s.token) {
    if (err) err.textContent = 'Connecte-toi avec ton mot de passe actuel pour le changer.';
    return;
  }
  const actuel  = document.getElementById('mdpActuel')?.value || '';
  const nouveau = document.getElementById('mdpNouveau')?.value || '';
  if (nouveau.length < 4) {
    if (err) err.textContent = 'Le nouveau mot de passe doit faire au moins 4 caractères.';
    return;
  }
  try {
    // Vérifier l'ancien mot de passe
    const r1 = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ joueur_id: s.joueur_id, mot_de_passe: actuel }),
    });
    if (!r1.ok) throw new Error('Mot de passe actuel incorrect.');
    // Définir le nouveau (token du joueur lui-même)
    const r2 = await fetch('/api/auth/mot-de-passe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + s.token,
      },
      body: JSON.stringify({ joueur_id: s.joueur_id, mot_de_passe: nouveau }),
    });
    const d2 = await r2.json();
    if (!r2.ok) throw new Error(d2.detail || 'Changement impossible');
    if (err) err.textContent = '';
    if (typeof toast === 'function') toast('Mot de passe mis à jour');
    const f = document.getElementById('formChangerMdp');
    if (f) f.reset();
    basculerModeConnexion('login');
  } catch (e) {
    if (err) err.textContent = e.message;
  }
}

/* ── Rendu de la zone session (topbar) ── */
function rafraichirSessionUi() {
  const zone = document.getElementById('sessionZone');
  if (!zone) return;                       // page quiz sans topbar : rien à faire
  const s = lireSession();

  if (!s) {
    zone.innerHTML = `
      <button class="btn-ghost btn-sm" data-action="ouvrir-connexion" aria-label="Se connecter">
        <i data-lucide="log-in" class="icon-xs"></i>
        Se connecter
      </button>`;
  } else {
    zone.innerHTML = `
      <span class="session-chip" title="${(s.token ? 'Connecté' : 'Mode héritage')}">
        <span class="avatar">${(s.pseudo || '?').substring(0, 2).toUpperCase()}</span>
        <span class="session-name">${s.pseudo || s.joueur_id}</span>
        ${s.token ? '' : '<span class="session-tag">héritage</span>'}
      </span>
      <button class="icon-btn" data-action="deconnexion" title="Se déconnecter" aria-label="Se déconnecter">
        <i data-lucide="log-out" class="icon-sm"></i>
      </button>`;
  }
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [zone] });
}

/* ── Branchements (éléments présents seulement sur certaines pages) ── */
document.addEventListener('DOMContentLoaded', () => {
  rafraichirSessionUi();

  // Délégation pour la zone session + overlay modale
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'ouvrir-connexion') ouvrirConnexion();
    if (btn.dataset.action === 'deconnexion')      seDeconnecter();
    if (btn.dataset.action === 'fermer-connexion') fermerConnexion();
    if (btn.dataset.action === 'vers-mdp')   basculerModeConnexion('mdp');
    if (btn.dataset.action === 'vers-login') basculerModeConnexion('login');
  });

  const overlay = document.getElementById('modalConnexionOverlay');
  if (overlay) overlay.addEventListener('click', fermerConnexion);

  const formLogin = document.getElementById('formLogin');
  if (formLogin) formLogin.addEventListener('submit', seConnecter);

  const formMdp = document.getElementById('formChangerMdp');
  if (formMdp) formMdp.addEventListener('submit', changerMotDePasse);

  // Échap ferme la modale
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fermerConnexion();
  });
});
