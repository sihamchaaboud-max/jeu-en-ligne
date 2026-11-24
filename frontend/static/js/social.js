/* ═══════════════════════════════════════════════════════════════
   ARENA — Mon espace : graphe social interactif du joueur connecté

   Le graphe est l'élément central de la page :
   - « Moi » au centre (or)
   - Amis directs (bleu) reliés par des arêtes pleines
   - Suggestions d'amis d'amis (violet, pointillé) reliées à l'ami commun
   - Invitations reçues (vert) / envoyées (gris) en attente, reliées à moi
   Toute la donnée est réelle (MongoDB + Redis + Neo4j) via /api/social/{id}
   et /api/graphe. Les mutations (inviter / accepter / refuser / retirer)
   sont diffusées en temps réel par le canal WebSocket « social ».
   ═══════════════════════════════════════════════════════════════ */
'use strict';

let _moiId = null;         // identifiant du joueur connecté
let _moiCy = null;         // instance Cytoscape du réseau égo-centré
let _moiCyResizeObserver = null;
let _moiEnCours = false;   // garde de ré-entrance du chargement
let _moiData = null;       // dernier espace social reçu (profil + réseaux)
let _moiPanelId = null;    // nœud sélectionné (aperçu flottant)

function _moiSession() {
  return (typeof sessionCourante === 'function') ? sessionCourante() : null;
}

function _moiPageActive() {
  const page = document.getElementById('page-moi');
  return !!(page && page.classList.contains('active'));
}

/* ═══════════════════════════════════════════════════════════════
   CHARGEMENT
   ═══════════════════════════════════════════════════════════════ */
async function chargerMonEspace() {
  const s = _moiSession();
  if (!s || !s.joueur_id) return;
  if (_moiEnCours) return;

  _moiId = s.joueur_id;
  _moiEnCours = true;
  try {
    const data = await api(`/api/social/${encodeURIComponent(_moiId)}`);
    _moiData = data;
    rendreProfilMoi(data);
    rendreInvitationsMoi(data.demandes || { recues: [], envoyees: [] });
    rendreSuggestionsMoi(data.suggestions || []);
    rendreAmisMoi(data.amis || []);
    await chargerMoiGraphe(_moiId);
    if (typeof remplirDatalist === 'function') remplirDatalist();
  } catch (e) {
    const c = document.getElementById('moiProfil');
    if (c) { c.innerHTML = errorState(e.message); reinitIcons(); }
    ['moiInvitations', 'moiSuggestions', 'moiAmis'].forEach((zone) => {
      const el = document.getElementById(zone);
      if (el) el.innerHTML = '';
    });
  } finally {
    _moiEnCours = false;
  }
}

/* ── Profil (privé) ── */
function rendreProfilMoi(data) {
  const c = document.getElementById('moiProfil');
  if (!c) return;
  const p = data.profil || {};
  const st = data.stats || {};
  const inv = (p.inventaire && p.inventaire.length)
    ? p.inventaire.map((e) => `<span class="tag">${esc(e.objet)} &times;${esc(e.qte)}</span>`).join('')
    : '<span class="player-id">Inventaire vide</span>';

  c.innerHTML = `
    <div class="espace-hero">
      <div class="profil-hero espace-hero-identity">
        <div class="profil-avatar">${initials(p.pseudo)}</div>
        <div>
          <div class="profil-name">${esc(p.pseudo)}</div>
          <div class="profil-id">${esc(p.id)}</div>
        </div>
      </div>
      <button class="btn-ghost btn-sm" data-action="mon-profil-public">
        <i data-lucide="id-card" class="icon-xs"></i>
        Ma fiche complète
      </button>
    </div>

    <div class="profil-stats-grid espace-stats">
      <div class="profil-stat-item">
        <div class="profil-stat-value">${esc(p.niveau)}</div>
        <div class="profil-stat-label">Niveau</div>
        <div class="profil-stat-source">MongoDB</div>
      </div>
      <div class="profil-stat-item">
        <div class="profil-stat-value">${fmtScore(p.score)}</div>
        <div class="profil-stat-label">Score total</div>
        <div class="profil-stat-source">Redis</div>
      </div>
      <div class="profil-stat-item">
        <div class="profil-stat-value">${p.rang ? '#' + esc(p.rang) : '—'}</div>
        <div class="profil-stat-label">Rang mondial</div>
        <div class="profil-stat-source">Redis</div>
      </div>
      <div class="profil-stat-item">
        <div class="profil-stat-value">${esc(p.nb_amis)}</div>
        <div class="profil-stat-label">Amis</div>
        <div class="profil-stat-source">Neo4j</div>
      </div>
      <div class="profil-stat-item">
        <div class="profil-stat-value">${esc(st.nb_parties ?? 0)}</div>
        <div class="profil-stat-label">Parties jouées</div>
        <div class="profil-stat-source">MongoDB</div>
      </div>
      <div class="profil-stat-item">
        <div class="profil-stat-value">${fmtScore(st.meilleur_score ?? 0)}</div>
        <div class="profil-stat-label">Record personnel</div>
        <div class="profil-stat-source">MongoDB</div>
      </div>
    </div>

    <div class="profil-section">
      <div class="profil-section-title">Inventaire — MongoDB</div>
      <div class="tag-list">${inv}</div>
    </div>`;
  reinitIcons();
}

/* ═══════════════════════════════════════════════════════════════
   GRAPHE SOCIAL — construction des éléments depuis les données réelles
   ═══════════════════════════════════════════════════════════════ */

/* Assemble nœuds + arêtes du réseau égo-centré.
   - amitiés réelles     → arêtes pleines (type "ami")
   - affinités 2 degrés  → arêtes pointillées (type "suggestion")
   - invitations en attente → arêtes pointillées dirigées (type "invitation-*")
   Renvoie { elements, nbAmis, nbSuggestions, nbRecues, nbEnvoyees }. */
function construireGrapheSocial(donnees, id, social, options) {
  const { avecSuggestions = true, avecInvitations = true } = options || {};
  const parId = new Map((donnees.noeuds || []).map((n) => [n.id, n]));
  if (!parId.has(id)) return null;

  // Adjacence à partir des seules amitiés acceptées
  const voisins = new Map();
  for (const a of donnees.aretes || []) {
    if (!voisins.has(a.a)) voisins.set(a.a, new Set());
    if (!voisins.has(a.b)) voisins.set(a.b, new Set());
    voisins.get(a.a).add(a.b);
    voisins.get(a.b).add(a.a);
  }
  const amis = new Set(voisins.get(id) || []);

  const demandes = (social && social.demandes) || { recues: [], envoyees: [] };
  const recues = new Set((demandes.recues || [])
    .map((d) => d.id).filter((x) => x && x !== id && parId.has(x)));
  const envoyees = new Set((demandes.envoyees || [])
    .map((d) => d.id).filter((x) => x && x !== id && parId.has(x)));

  // Suggestions : on suit la liste recommandée par le backend (amis d'amis),
  // en excluant amis directs et invitations en attente (déjà filtrés côté serveur).
  const suggestions = new Map(); // id → amis_communs
  if (avecSuggestions) {
    for (const s of (social && social.suggestions) || []) {
      if (!s.id || s.id === id) continue;
      if (amis.has(s.id) || recues.has(s.id) || envoyees.has(s.id)) continue;
      if (!parId.has(s.id)) continue;
      suggestions.set(s.id, Number(s.amis_communs) || 0);
    }
  }

  const inclus = new Set([id, ...amis]);
  suggestions.forEach((_, sid) => inclus.add(sid));
  if (avecInvitations) { recues.forEach((x) => inclus.add(x)); envoyees.forEach((x) => inclus.add(x)); }
  else { /* invitations masquées : on ne les inclut ni en nœud ni en arête */ }

  const noeuds = [];
  inclus.forEach((nid) => {
    const n = parId.get(nid);
    if (!n) return;
    const role = nid === id ? 'centre'
      : amis.has(nid) ? 'ami'
      : recues.has(nid) ? 'recue'
      : envoyees.has(nid) ? 'envoyee'
      : 'suggestion';
    noeuds.push({
      data: {
        id: nid,
        label: n.pseudo,
        score: n.score,
        niveau: n.niveau,
        role,
        mutual: suggestions.has(nid) ? suggestions.get(nid) : undefined,
      },
    });
  });

  // Amitiés (et affinités entre nœuds affichés)
  const aretes = [];
  const vues = new Set();
  for (const a of donnees.aretes || []) {
    if (!inclus.has(a.a) || !inclus.has(a.b)) continue;
    const cle = [a.a, a.b].sort().join('|');
    if (vues.has(cle)) continue;
    vues.add(cle);
    const versSuggestion = a.a !== id && a.b !== id
      && (suggestions.has(a.a) || suggestions.has(a.b));
    aretes.push({
      data: {
        id: `e:${cle}`,
        source: a.a,
        target: a.b,
        type: versSuggestion ? 'suggestion' : 'ami',
      },
    });
  }

  // Invitations en attente : arêtes pointillées dirigées vers/depuis moi
  if (avecInvitations) {
    recues.forEach((rid) => aretes.push({
      data: { id: `inv:r:${rid}`, source: rid, target: id, type: 'invitation-recue' },
    }));
    envoyees.forEach((eid) => aretes.push({
      data: { id: `inv:e:${eid}`, source: id, target: eid, type: 'invitation-envoyee' },
    }));
  }

  return {
    elements: positionnerElementsEgo(noeuds.concat(aretes)),
    nbAmis: amis.size,
    nbSuggestions: suggestions.size,
    nbRecues: avecInvitations ? recues.size : 0,
    nbEnvoyees: avecInvitations ? envoyees.size : 0,
  };
}

/* Styles Cytoscape : on repart de la palette égocentrée de reseau.js et on
   ajoute les rôles invitation + l'état « focus ». */
function styleGrapheSocial() {
  const base = (typeof styleGrapheEgo === 'function') ? styleGrapheEgo() : [];
  return base.concat([
    {
      selector: 'node[role="recue"]',
      style: {
        'background-fill': 'radial-gradient',
        'background-gradient-stop-colors': '#B8F0D6 #4CC38A #2E8F62',
        'background-gradient-stop-positions': '0% 48% 100%',
        'border-style': 'dashed',
        'border-width': 2,
        'border-color': 'rgba(76,195,138,0.95)',
        'underlay-color': '#4CC38A',
        'underlay-opacity': 0.16,
        'underlay-padding': 8,
        'width': 30,
        'height': 30,
      },
    },
    {
      selector: 'node[role="envoyee"]',
      style: {
        'background-fill': 'radial-gradient',
        'background-gradient-stop-colors': '#C9CCD6 #8A8FA3 #5A5E6E',
        'background-gradient-stop-positions': '0% 48% 100%',
        'border-style': 'dashed',
        'border-width': 1.8,
        'border-color': 'rgba(138,143,163,0.95)',
        'underlay-color': '#8A8FA3',
        'underlay-opacity': 0.12,
        'underlay-padding': 7,
        'width': 28,
        'height': 28,
      },
    },
    {
      selector: 'edge[type="invitation-recue"]',
      style: {
        'width': 1.8,
        'line-style': 'dashed',
        'line-color': 'rgba(76,195,138,0.72)',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': 'rgba(76,195,138,0.72)',
        'arrow-scale': 0.9,
        'line-opacity': 0.95,
      },
    },
    {
      selector: 'edge[type="invitation-envoyee"]',
      style: {
        'width': 1.6,
        'line-style': 'dashed',
        'line-color': 'rgba(138,143,163,0.7)',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': 'rgba(138,143,163,0.7)',
        'arrow-scale': 0.9,
        'line-opacity': 0.9,
      },
    },
    {
      selector: 'node.focused',
      style: {
        'border-width': 3,
        'border-color': '#F2B03D',
        'underlay-color': '#F2B03D',
        'underlay-opacity': 0.3,
        'underlay-padding': 13,
        'z-index': 100,
      },
    },
    {
      selector: 'edge.edge-focus',
      style: {
        'line-color': 'rgba(242,176,61,0.85)',
        'width': 2.4,
        'line-opacity': 1,
      },
    },
  ]);
}

function detruireMoiCy() {
  if (_moiCyResizeObserver) {
    _moiCyResizeObserver.disconnect();
    _moiCyResizeObserver = null;
  }
  if (_moiCy) { _moiCy.destroy(); _moiCy = null; }
}

/* Charge (ou recharge) le graphe égo-centré du joueur connecté. */
async function chargerMoiGraphe(id) {
  const section = document.getElementById('moiGrapheSection');
  const c = document.getElementById('moiGrapheViz');
  if (!section || !c) return;

  const loading = document.getElementById('moiGrapheLoading');
  const vide = document.getElementById('moiGrapheEmpty');
  const sousTitre = document.getElementById('moiGrapheSousTitre');
  const togSug = document.getElementById('moiGrapheSuggestions');
  const togInv = document.getElementById('moiGrapheInvitations');

  section.style.display = 'block';
  if (loading) loading.style.display = 'grid';
  if (vide) { vide.style.display = 'none'; vide.textContent = ''; }

  try {
    const donnees = await api('/api/graphe');
    const social = (_moiData && _moiData.profil && _moiData.profil.id === id) ? _moiData : null;
    const reseau = construireGrapheSocial(donnees, id, social, {
      avecSuggestions: togSug ? togSug.checked : true,
      avecInvitations: togInv ? togInv.checked : true,
    });

    if (!reseau) {
      detruireMoiCy();
      fermerPanneauNoeud();
      if (loading) loading.style.display = 'none';
      if (vide) {
        vide.textContent = `Joueur « ${id} » introuvable dans le graphe.`;
        vide.style.display = 'grid';
      }
      if (sousTitre) sousTitre.textContent = '';
      return;
    }

    const { nbAmis, nbSuggestions, nbRecues, nbEnvoyees } = reseau;
    if (sousTitre) {
      const parts = [`${nbAmis} ami${nbAmis > 1 ? 's' : ''}`];
      if (nbSuggestions) parts.push(`${nbSuggestions} suggestion${nbSuggestions > 1 ? 's' : ''}`);
      if (nbRecues) parts.push(`${nbRecues} invitation${nbRecues > 1 ? 's' : ''} reçue${nbRecues > 1 ? 's' : ''}`);
      if (nbEnvoyees) parts.push(`${nbEnvoyees} envoyée${nbEnvoyees > 1 ? 's' : ''}`);
      sousTitre.textContent = parts.join(' · ');
    }

    detruireMoiCy();

    const cy = cytoscape({
      container: c,
      elements: reseau.elements,
      layout: {
        name: 'preset',
        fit: true,
        padding: 52,
      },
      style: styleGrapheSocial(),
      minZoom: 0.35,
      maxZoom: 2.6,
      wheelSensitivity: 0.2,
    });
    _moiCy = cy;

    const ajuster = () => {
      if (_moiCy !== cy || !c.clientWidth || !c.clientHeight) return;
      cy.resize();
      cy.fit(undefined, 52);
    };
    cy.on('layoutstop', ajuster);
    ajuster();
    requestAnimationFrame(ajuster);
    if (typeof ResizeObserver !== 'undefined') {
      _moiCyResizeObserver = new ResizeObserver(ajuster);
      _moiCyResizeObserver.observe(c);
    }

    cy.on('mouseover', 'node', (evt) => evt.target.addClass('hover'));
    cy.on('mouseout', 'node', (evt) => evt.target.removeClass('hover'));

    // Clic sur un nœud → aperçu flottant + actions contextuelles
    cy.on('tap', 'node', (evt) => afficherPanneauNoeud(evt.target));
    // Clic dans le vide → fermer l'aperçu
    cy.on('tap', (evt) => { if (evt.target === cy) fermerPanneauNoeud(); });

    // Double-clic → explorer ce joueur dans la page Réseau
    cy.on('dbltap', 'node', (evt) => {
      const nid = evt.target.id();
      if (nid === _moiId) return;
      const input = document.getElementById('amisJoueurId');
      if (input) input.value = nid;
      if (typeof showPage === 'function') showPage('amis');
      if (typeof loadAmis === 'function') loadAmis();
    });

    if (loading) loading.style.display = 'none';
    if (vide) vide.style.display = 'none';

    // Conserver/rétablir la sélection après un rafraîchissement live
    if (_moiPanelId) {
      const n = _moiCy.getElementById(_moiPanelId);
      if (n && n.length) afficherPanneauNoeud(n);
      else fermerPanneauNoeud();
    }
  } catch (e) {
    detruireMoiCy();
    fermerPanneauNoeud();
    if (loading) loading.style.display = 'none';
    if (vide) { vide.textContent = `Graphe indisponible : ${e.message}`; vide.style.display = 'grid'; }
    if (sousTitre) sousTitre.textContent = '';
  }
}

/* ═══════════════════════════════════════════════════════════════
   APERÇU DE NŒUD — panneau flottant avec actions par rôle
   ═══════════════════════════════════════════════════════════════ */
async function afficherPanneauNoeud(node) {
  const panel = document.getElementById('moiNodePanel');
  if (!panel || !node) return;
  const d = node.data();
  _moiPanelId = d.id;

  if (_moiCy) {
    _moiCy.nodes().removeClass('focused');
    _moiCy.edges().removeClass('edge-focus');
    node.addClass('focused');
    node.connectedEdges().addClass('edge-focus');
  }

  panel.hidden = false;
  panel.innerHTML = '<div class="espace-panel-loading">Chargement…</div>';

  let pub = null;
  try { pub = await api(`/api/joueur/${encodeURIComponent(d.id)}`); } catch (e) { pub = null; }
  if (_moiPanelId !== d.id) return;   // la sélection a changé entre-temps

  panel.innerHTML = _htmlPanneau(d, pub);
  reinitIcons();
}

function _htmlPanneau(d, pub) {
  const role = d.role;
  const pseudo = (pub && pub.pseudo) || d.label || d.id;
  const score = (pub && pub.score != null) ? pub.score : d.score;
  const rang = pub ? pub.rang : null;
  const niveau = (pub && pub.niveau != null) ? pub.niveau : d.niveau;

  const roleInfo = {
    centre:     { libelle: 'Moi',                 classe: 'role-centre' },
    ami:        { libelle: 'Ami',                 classe: 'role-ami' },
    suggestion: { libelle: 'Suggestion',          classe: 'role-suggestion' },
    recue:      { libelle: 'Invitation reçue',    classe: 'role-recue' },
    envoyee:    { libelle: 'Invitation envoyée',  classe: 'role-envoyee' },
  }[role] || { libelle: 'Joueur', classe: '' };

  let actions = '';
  if (role === 'suggestion') {
    const mutual = (d.mutual != null)
      ? `<span class="espace-panel-mutual">${esc(d.mutual)} ami${d.mutual > 1 ? 's' : ''} en commun</span>`
      : '';
    actions = `
      ${mutual}
      <button class="btn-success btn-sm" data-paction="inviter" data-id="${esc(d.id)}">
        <i data-lucide="user-plus" class="icon-xs"></i> Inviter
      </button>`;
  } else if (role === 'ami') {
    actions = `
      <button class="btn-ghost btn-sm" data-paction="fiche" data-id="${esc(d.id)}">
        <i data-lucide="id-card" class="icon-xs"></i> Fiche
      </button>
      <button class="btn-danger btn-sm" data-paction="retirer" data-id="${esc(d.id)}">
        <i data-lucide="user-minus" class="icon-xs"></i> Retirer
      </button>`;
  } else if (role === 'recue') {
    actions = `
      <button class="btn-success btn-sm" data-paction="accepter" data-id="${esc(d.id)}">
        <i data-lucide="check" class="icon-xs"></i> Accepter
      </button>
      <button class="btn-danger btn-sm" data-paction="refuser" data-id="${esc(d.id)}">
        <i data-lucide="x" class="icon-xs"></i> Refuser
      </button>`;
  } else if (role === 'envoyee') {
    actions = `
      <span class="espace-panel-mutual">En attente de réponse…</span>
      <button class="btn-danger btn-sm" data-paction="annuler" data-id="${esc(d.id)}">
        <i data-lucide="undo-2" class="icon-xs"></i> Annuler
      </button>`;
  } else {
    actions = `
      <button class="btn-ghost btn-sm" data-paction="fiche" data-id="${esc(d.id)}">
        <i data-lucide="id-card" class="icon-xs"></i> Ma fiche
      </button>`;
  }

  return `
    <button class="espace-panel-close" data-paction="fermer" aria-label="Fermer l'aperçu">
      <i data-lucide="x" class="icon-sm"></i>
    </button>
    <div class="espace-panel-head">
      <div class="avatar">${initials(pseudo)}</div>
      <div class="espace-panel-id">
        <span class="espace-panel-name">${esc(pseudo)}</span>
        <span class="player-id">${esc(d.id)}</span>
      </div>
      <span class="espace-role-tag ${roleInfo.classe}">${roleInfo.libelle}</span>
    </div>
    <div class="espace-panel-stats">
      <span><b>${fmtScore(score ?? 0)}</b><em>pts</em></span>
      <span><b>${rang ? '#' + esc(rang) : '—'}</b><em>rang</em></span>
      <span><b>${esc(niveau ?? 1)}</b><em>niv.</em></span>
    </div>
    <div class="espace-panel-actions">${actions}</div>`;
}

function fermerPanneauNoeud() {
  _moiPanelId = null;
  const panel = document.getElementById('moiNodePanel');
  if (panel) { panel.hidden = true; panel.innerHTML = ''; }
  if (_moiCy) {
    _moiCy.nodes().removeClass('focused');
    _moiCy.edges().removeClass('edge-focus');
  }
}

/* ═══════════════════════════════════════════════════════════════
   LISTES (panneaux complémentaires sous le graphe)
   ═══════════════════════════════════════════════════════════════ */
function _moiCarte(p, meta, actions, cliquable) {
  const cell = `
    <div class="player-cell${cliquable ? ' espace-clickable' : ''}"${cliquable ? ` data-action="espace-profil" data-id="${esc(p.id)}"` : ''}>
      <div class="avatar">${initials(p.pseudo)}</div>
      <div class="espace-card-meta">
        <span class="player-name">${esc(p.pseudo)}</span>
        <span class="player-id">${esc(p.id)}</span>
      </div>
    </div>`;
  return `
    <div class="demande-card">
      ${cell}
      ${meta ? `<span class="mutual-tag">${meta}</span>` : ''}
      <div class="demande-actions">${actions}</div>
    </div>`;
}

function rendreInvitationsMoi(demandes) {
  const c = document.getElementById('moiInvitations');
  if (!c) return;
  const recues = demandes.recues || [];
  const envoyees = demandes.envoyees || [];
  const badge = document.getElementById('moiInvitationsBadge');
  if (badge) badge.textContent = recues.length ? `${recues.length} reçue${recues.length > 1 ? 's' : ''}` : '';

  let html = '';
  if (recues.length) {
    html += `<div class="espace-subhead"><span class="section-title-sm">Reçues (${recues.length})</span></div>`;
    html += recues.map((p) => _moiCarte(
      p,
      'souhaite vous ajouter',
      `<button class="btn-success btn-sm" data-action="espace-accepter" data-a="${esc(p.id)}">
         <i data-lucide="check" class="icon-xs"></i> Accepter
       </button>
       <button class="btn-danger btn-sm" data-action="espace-refuser" data-a="${esc(p.id)}">
         <i data-lucide="x" class="icon-xs"></i> Refuser
       </button>`,
      false
    )).join('');
  }
  if (envoyees.length) {
    html += `<div class="espace-subhead"><span class="section-title-sm">Envoyées (${envoyees.length})</span></div>`;
    html += envoyees.map((p) => _moiCarte(
      p,
      'en attente de réponse',
      `<button class="btn-danger btn-sm" data-action="espace-annuler" data-a="${esc(p.id)}">
         <i data-lucide="undo-2" class="icon-xs"></i> Annuler
       </button>`,
      false
    )).join('');
  }
  if (!html) html = emptyState('Aucune invitation en attente', 'inbox');

  c.innerHTML = html;
  reinitIcons();
}

function rendreSuggestionsMoi(suggestions) {
  const c = document.getElementById('moiSuggestions');
  if (!c) return;
  if (!suggestions.length) {
    c.innerHTML = emptyState('Aucune suggestion pour le moment', 'users');
    reinitIcons();
    return;
  }
  c.innerHTML = suggestions.map((s) => _moiCarte(
    s,
    `${esc(s.amis_communs)} ami${s.amis_communs > 1 ? 's' : ''} en commun`,
    `<button class="btn-success btn-sm" data-action="espace-inviter" data-id="${esc(s.id)}">
       <i data-lucide="user-plus" class="icon-xs"></i> Inviter
     </button>`,
    true
  )).join('');
  reinitIcons();
}

function rendreAmisMoi(amis) {
  const c = document.getElementById('moiAmis');
  if (!c) return;
  if (!amis.length) {
    c.innerHTML = emptyState('Aucun ami — invite des joueurs depuis les suggestions', 'user-x');
    reinitIcons();
    return;
  }
  c.innerHTML = amis.map((a) => _moiCarte(
    a,
    `${a.rang ? '#' + esc(a.rang) : '—'} · ${fmtScore(a.score)} pts`,
    `<button class="btn-danger btn-sm" data-action="espace-retirer" data-id="${esc(a.id)}">
       <i data-lucide="user-minus" class="icon-xs"></i> Retirer
     </button>`,
    true
  )).join('');
  reinitIcons();
}

/* ═══════════════════════════════════════════════════════════════
   ACTIONS (invitations / amitiés) — le graphe se met à jour ensuite
   ═══════════════════════════════════════════════════════════════ */
async function moiInviter(idVers) {
  const s = _moiSession();
  if (!s) return;
  const cible = (idVers || '').trim();
  if (!cible) { toast('Entrez un identifiant joueur', 'err'); return; }
  if (cible === s.joueur_id) { toast('Impossible de s\'inviter soi-même', 'err'); return; }
  try {
    const r = await api('/api/demande-ami', {
      method: 'POST',
      body: JSON.stringify({ id_de: s.joueur_id, id_vers: cible }),
    });
    toast(r.message);
    const inp = document.getElementById('moiInviteId');
    if (inp) inp.value = '';
    await chargerMonEspace();
  } catch (e) { toast(e.message, 'err'); }
}

async function moiRepondreDemande(action, autreId) {
  const s = _moiSession();
  if (!s) return;
  const url = (action === 'espace-accepter' || action === 'accepter') ? '/api/demande-ami/accepter'
            : (action === 'espace-refuser'  || action === 'refuser')  ? '/api/demande-ami/refuser'
            : (action === 'espace-annuler'  || action === 'annuler')  ? '/api/demande-ami/refuser'
            : null;
  if (!url) return;
  // accepter/refuser : l'autre est l'expéditeur, moi le destinataire
  // annuler (demande envoyée) : moi l'expéditeur, l'autre le destinataire
  const expedeMoi = (action === 'espace-annuler' || action === 'annuler');
  const corps = expedeMoi
    ? { id_de: s.joueur_id, id_vers: autreId }
    : { id_de: autreId, id_vers: s.joueur_id };
  try {
    const r = await api(url, { method: 'POST', body: JSON.stringify(corps) });
    toast(r.message);
    await chargerMonEspace();
  } catch (e) { toast(e.message, 'err'); }
}

async function moiRetirerAmi(amiId) {
  const s = _moiSession();
  if (!s) return;
  if (!confirm(`Retirer ${amiId} de tes amis ?`)) return;
  try {
    await api('/api/ami', {
      method: 'DELETE',
      body: JSON.stringify({ id_a: s.joueur_id, id_b: amiId }),
    });
    toast('Amitié supprimée');
    await chargerMonEspace();
  } catch (e) { toast(e.message, 'err'); }
}

/* ═══════════════════════════════════════════════════════════════
   TEMPS RÉEL — événements « social » du canal WebSocket
   ═══════════════════════════════════════════════════════════════ */
function _libelleSocial(msg) {
  switch (msg.evenement) {
    case 'demande_recue':   return `${msg.de_pseudo || msg.de} t'a envoyé une invitation`;
    case 'ami_accepte':     return `${msg.pseudo || 'Un joueur'} a accepté — vous êtes amis`;
    case 'demande_retiree': return 'Une demande d\'ami a été retirée';
    case 'amitie':          return `${msg.par || 'Un joueur'} a rejoint ton réseau`;
    case 'amitie_retiree':  return 'Une amitié a été retirée';
    default:                return 'Ton espace social a été mis à jour';
  }
}

if (typeof onWsMessage === 'function') {
  onWsMessage('social', (msg) => {
    const s = _moiSession();
    if (!s) return;
    const joueurs = Array.isArray(msg.joueurs) ? msg.joueurs : [];
    if (!joueurs.includes(s.joueur_id)) return;   // l'événement ne me concerne pas

    if (_moiPageActive()) {
      chargerMonEspace();                          // rafraîchissement silencieux (graphe inclus)
    } else if (typeof toast === 'function') {
      toast(_libelleSocial(msg));                  // notification hors écran
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   BRANCHEMENTS
   ═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Le tiroir de profil vit dans #page-joueurs (display:none hors de sa page) :
  // on le rattache au body pour qu'il s'ouvre depuis n'importe quelle page.
  const drawer = document.getElementById('profilDrawer');
  const overlay = document.getElementById('drawerOverlay');
  if (drawer && drawer.parentElement !== document.body) document.body.appendChild(drawer);
  if (overlay && overlay.parentElement !== document.body) document.body.appendChild(overlay);

  // Aperçu de nœud : actions contextuelles
  const panel = document.getElementById('moiNodePanel');
  if (panel) panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-paction]');
    if (!b) return;
    const a = b.dataset.paction;
    const id = b.dataset.id;
    if (a === 'fermer') return fermerPanneauNoeud();
    if (a === 'fiche') return (typeof showProfil === 'function') && showProfil(id);
    if (a === 'inviter') return moiInviter(id);
    if (a === 'accepter') return moiRepondreDemande('accepter', id);
    if (a === 'refuser') return moiRepondreDemande('refuser', id);
    if (a === 'annuler') return moiRepondreDemande('annuler', id);
    if (a === 'retirer') return moiRetirerAmi(id);
  });

  // Invitations (listes)
  const zInv = document.getElementById('moiInvitations');
  if (zInv) zInv.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'espace-accepter') moiRepondreDemande('accepter', b.dataset.a);
    else if (b.dataset.action === 'espace-refuser') moiRepondreDemande('refuser', b.dataset.a);
    else if (b.dataset.action === 'espace-annuler') moiRepondreDemande('annuler', b.dataset.a);
  });

  // Suggestions (panneau complémentaire) — invitation en un clic
  const zSug = document.getElementById('moiSuggestions');
  if (zSug) zSug.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'espace-inviter') moiInviter(b.dataset.id);
    else if (b.dataset.action === 'espace-profil' && typeof showProfil === 'function') showProfil(b.dataset.id);
  });

  // Mes amis
  const zAmis = document.getElementById('moiAmis');
  if (zAmis) zAmis.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'espace-retirer') moiRetirerAmi(b.dataset.id);
    else if (b.dataset.action === 'espace-profil' && typeof showProfil === 'function') showProfil(b.dataset.id);
  });

  // Profil
  const zProfil = document.getElementById('moiProfil');
  if (zProfil) zProfil.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action="mon-profil-public"]');
    if (b && _moiId && typeof showProfil === 'function') showProfil(_moiId);
  });

  // Formulaire d'invitation par identifiant
  const btnInv = document.getElementById('moiInviteBtn');
  if (btnInv) btnInv.addEventListener('click', () => {
    moiInviter(document.getElementById('moiInviteId')?.value || '');
  });
  const inpInv = document.getElementById('moiInviteId');
  if (inpInv) inpInv.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); moiInviter(inpInv.value); }
  });

  // Actualisation
  const btnRefresh = document.getElementById('moiRefresh');
  if (btnRefresh) btnRefresh.addEventListener('click', () => chargerMonEspace());
  const btnAmisRefresh = document.getElementById('moiAmisRefresh');
  if (btnAmisRefresh) btnAmisRefresh.addEventListener('click', () => chargerMonEspace());

  // Contrôles du graphe : zoom, recentrage, filtres
  const btnFit = document.getElementById('moiGrapheFit');
  if (btnFit) btnFit.addEventListener('click', () => { if (_moiCy) _moiCy.animate({ fit: { padding: 52 } }, { duration: 380 }); });
  const btnZoomIn = document.getElementById('moiGrapheZoomIn');
  if (btnZoomIn) btnZoomIn.addEventListener('click', () => {
    if (!_moiCy) return;
    _moiCy.zoom({ level: _moiCy.zoom() * 1.25, renderedPosition: { x: _moiCy.width() / 2, y: _moiCy.height() / 2 } });
  });
  const btnZoomOut = document.getElementById('moiGrapheZoomOut');
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => {
    if (!_moiCy) return;
    _moiCy.zoom({ level: _moiCy.zoom() * 0.8, renderedPosition: { x: _moiCy.width() / 2, y: _moiCy.height() / 2 } });
  });
  const togSug = document.getElementById('moiGrapheSuggestions');
  if (togSug) togSug.addEventListener('change', () => { if (_moiId) chargerMoiGraphe(_moiId); });
  const togInv = document.getElementById('moiGrapheInvitations');
  if (togInv) togInv.addEventListener('change', () => { if (_moiId) chargerMoiGraphe(_moiId); });

  window.addEventListener('resize', () => {
    if (!_moiCy) return;
    _moiCy.resize();
    _moiCy.fit(undefined, 52);
  });

  // Lien profond (#moi) : la page est déjà active au chargement, la session vient d'être lue.
  const page = document.getElementById('page-moi');
  if (page && page.classList.contains('active') && _moiSession()) chargerMonEspace();
});
