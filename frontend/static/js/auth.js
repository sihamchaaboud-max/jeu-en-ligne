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

/* Une session est « authentifiée » uniquement après un passage par le
   formulaire de connexion (auth: true). Un ancien enregistrement local
   sans ce marqueur ne doit pas afficher le bouton de déconnexion. */
function estAuthentifie() {
  const s = lireSession();
  return !!(s && (s.auth === true || s.token));
}

/* ── Modale de connexion (injectée sur les pages qui ne l'ont pas) ── */
function injecterModalConnexion() {
  if (document.getElementById('modalConnexion')) return;

  const html = `
  <div class="modal-overlay" id="modalConnexionOverlay"></div>
  <div class="modal" id="modalConnexion" role="dialog" aria-modal="true" aria-labelledby="modalConnexionTitre">
    <div class="modal-header">
      <h3 class="modal-title" id="modalConnexionTitre">Connexion</h3>
      <button class="icon-btn" data-action="fermer-connexion" aria-label="Fermer">
        <i data-lucide="x" class="icon-sm"></i>
      </button>
    </div>
    <div class="modal-body">
      <form id="formLogin" class="form-body" novalidate>
        <div class="field-group">
          <label class="field-label" for="loginJoueurId">Identifiant joueur</label>
          <input type="text" id="loginJoueurId" class="field-input" placeholder="ex : j1" autocomplete="off"/>
        </div>
        <div class="field-group">
          <label class="field-label" for="loginMdp">Mot de passe</label>
          <input type="password" id="loginMdp" class="field-input" placeholder="laisser vide si vous n'en avez pas" autocomplete="off"/>
          <span class="field-hint">Sans mot de passe : connexion en mode héritage (identité mémorisée seulement)</span>
        </div>
        <p id="loginErreur" class="quiz-erreur" role="alert"></p>
        <button type="submit" class="btn-primary btn-full">
          <i data-lucide="log-in" class="icon-xs"></i>
          Se connecter
        </button>
      </form>

      <form id="formChangerMdp" class="form-body" style="display:none" novalidate>
        <div class="field-group">
          <label class="field-label" for="mdpActuel">Mot de passe actuel</label>
          <input type="password" id="mdpActuel" class="field-input" autocomplete="off"/>
        </div>
        <div class="field-group">
          <label class="field-label" for="mdpNouveau">Nouveau mot de passe</label>
          <input type="password" id="mdpNouveau" class="field-input" autocomplete="off"/>
          <span class="field-hint">4 caractères minimum</span>
        </div>
        <p id="mdpErreur" class="quiz-erreur" role="alert"></p>
        <button type="submit" class="btn-primary btn-full">
          <i data-lucide="key-round" class="icon-xs"></i>
          Mettre à jour
        </button>
      </form>
    </div>
    <div class="modal-footer">
      <span>Identité stockée localement, jamais envoyée à un tiers.</span>
      <button class="link-btn" data-action="vers-mdp" id="btnVersMdp">Changer mon mot de passe</button>
      <button class="link-btn" data-action="vers-login" id="btnVersLogin" style="display:none">← Connexion</button>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/* Nettoie les sessions héritées d'anciennes versions : sans marqueur
   d'authentification ni token, elles ne valent pas une connexion. */
function normaliserSession() {
  const s = lireSession();
  if (s && s.auth !== true && !s.token) ecrireSession(null);
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
  const err = document.getElementById('loginErreur');
  if (err) err.textContent = '';
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

/* Connexion réutilisable (formulaire de login, inscription automatique). */
async function connecterJoueur(joueurId, motDePasse) {
  const id = (joueurId || '').trim();
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ joueur_id: id, mot_de_passe: motDePasse || '' }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || 'Connexion impossible');

  const pseudo = d.pseudo || id;
  ecrireSession({
    joueur_id: id,
    pseudo,
    token: d.token || null,
    auth: true,
  });
  fermerConnexion();
  rafraichirSessionUi();

  // Prévient les modules (quiz, règles d'inscription) que la session a changé
  document.dispatchEvent(new CustomEvent('arena:session', { detail: lireSession() }));
  return d;
}

async function seConnecter(evenement) {
  evenement.preventDefault();
  const id  = (document.getElementById('loginJoueurId')?.value || '').trim();
  const mdp = document.getElementById('loginMdp')?.value || '';
  const err = document.getElementById('loginErreur');
  if (!id) { if (err) err.textContent = 'Entrez un identifiant joueur.'; return; }
  if (err) err.textContent = '';

  try {
    const d = await connecterJoueur(id, mdp);
    const pseudo = d.pseudo || id;
    if (typeof toast === 'function') {
      if (d.sans_mot_de_passe) toast(`Bienvenue ${pseudo} (mode héritage, sans mot de passe)`);
      else toast(`Connecté : ${pseudo}`);
    }
  } catch (e) {
    if (err) err.textContent = e.message;
  }
}

function seDeconnecter() {
  ecrireSession(null);
  rafraichirSessionUi();
  document.dispatchEvent(new CustomEvent('arena:session', { detail: null }));
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
  if (!zone) return;
  const s = lireSession();

  // Pas de bouton « Se déconnecter » avant une vraie connexion :
  // une simple session locale héritée ne suffit pas.
  if (!estAuthentifie()) {
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
      <button class="icon-btn" data-action="ouvrir-espace" title="Mon espace — profil & réseau" aria-label="Ouvrir mon espace">
        <i data-lucide="user-round" class="icon-sm"></i>
      </button>
      <button class="icon-btn" data-action="deconnexion" title="Se déconnecter" aria-label="Se déconnecter">
        <i data-lucide="log-out" class="icon-sm"></i>
      </button>`;
  }
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [zone] });
}

/* ── Branchements (éléments présents seulement sur certaines pages) ── */
document.addEventListener('DOMContentLoaded', () => {
  injecterModalConnexion();
  normaliserSession();
  rafraichirSessionUi();

  // app.js (chargé avant auth.js) a déjà appliqué ses règles d'affichage
  // sans pouvoir connaître la session : on les rejoue une fois l'état lu.
  document.dispatchEvent(new CustomEvent('arena:session', { detail: lireSession() }));

  // Délégation pour la zone session + overlay modale
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'ouvrir-connexion') ouvrirConnexion();
    if (btn.dataset.action === 'ouvrir-espace') {
      if (typeof showPage === 'function') showPage('moi');
    }
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
