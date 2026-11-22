/* ═══════════════════════════════════════════════════════════════
   ARENA — Réseau social visuel
   - Carte interactive du graphe Neo4j (Cytoscape.js)
     · nœuds = joueurs (taille ∝ score, or = podium)
     · arêtes = amitiés confirmées
     · clic sur un nœud → profil + suggestions mises en évidence
   - Demandes d'ami : reçues (accepter / refuser), envoyées (annuler)
   ═══════════════════════════════════════════════════════════════ */
'use strict';

let _cytoscapeInstance = null;
let _grapheCharge = false;
let _grapheEnCours = false;
let _grapheDonnees = null;

let _cyJoueur = null;          // graphe égo-centré du joueur recherché
let _joueurGrapheId = null;    // dernier ID exploré
let _egoEnCours = false;

const _COULEUR_OR = '#F2B03D';
const _COULEUR_NOEUD = '#6FA7E8';
const _COULEUR_ARETE = 'rgba(245,243,236,0.14)';

function tailleNoeud(score) {
  if (score == null) return 22;
  const max = Math.max(1, score);
  return 22 + Math.min(24, Math.round(24 * Math.sqrt(max / 9500)));
}

function elementsGraphe(donnees) {
  const noeuds = donnees.noeuds.map((n) => ({
    data: {
      id: n.id,
      label: n.pseudo,
      score: n.score,
      niveau: n.niveau,
    },
  }));
  const aretes = donnees.aretes.map((a) => ({
    data: { source: a.a, target: a.b },
  }));
  return noeuds.concat(aretes);
}

async function chargerGraphe() {
  const loading = document.getElementById('grapheLoading');
  const c = document.getElementById('grapheViz');
  if (!c) return;
  if (_grapheEnCours) return;
  _grapheEnCours = true;
  if (loading) loading.style.display = 'grid';

  try {
    const donnees = await api('/api/graphe');
    _grapheDonnees = donnees;
    if (loading) loading.style.display = 'none';

    if (!donnees.noeuds.length) {
      c.innerHTML = '<div class="graph-empty">Aucun joueur en base — créez des joueurs puis actualisez.</div>';
      return;
    }

    const elements = elementsGraphe(donnees);

    // Podium (3 meilleurs scores) → nœuds dorés
    const scores = donnees.noeuds
      .filter((n) => n.score != null)
      .sort((a, b) => b.score - a.score);
    const podiumIds = new Set(scores.slice(0, 3).map((n) => n.id));

    if (_cytoscapeInstance) { _cytoscapeInstance.destroy(); _cytoscapeInstance = null; }

    _cytoscapeInstance = cytoscape({
      container: c,
      elements,
      layout: {
        name: 'cose',
        animate: true,
        animationDuration: 550,
        idealEdgeLength: 104,
        nodeOverlap: 28,
        gravity: 0.9,
        padding: 44,
      },
      style: [
        {
          selector: 'node',
          style: {
            'background-fill': 'radial-gradient',
            'background-gradient-stop-colors': (el) => podiumIds.has(el.id())
              ? '#FFE1A0 #F2B03D #C98712'
              : '#B9D8F8 #6FA7E8 #3F74B8',
            'background-gradient-stop-positions': '0% 48% 100%',
            'background-gradient-direction': 'to-bottom-right',
            'width': (el) => tailleNoeud(el.data('score')),
            'height': (el) => tailleNoeud(el.data('score')),
            'label': 'data(label)',
            'color': '#F5F3EC',
            'font-family': 'Inter, sans-serif',
            'font-size': 10.5,
            'font-weight': 600,
            'text-valign': 'bottom',
            'text-margin-y': 8,
            'text-outline-width': 2.5,
            'text-outline-color': 'rgba(8,9,13,0.92)',
            'border-width': 1.5,
            'border-color': 'rgba(255,255,255,0.5)',
            'underlay-color': (el) => (podiumIds.has(el.id()) ? _COULEUR_OR : _COULEUR_NOEUD),
            'underlay-opacity': 0.11,
            'underlay-padding': 8,
            'underlay-shape': 'ellipse',
            'overlay-opacity': 0,
            'cursor': 'pointer',
            'transition-property': 'border-color, border-width, background-color, opacity, underlay-opacity, underlay-padding',
            'transition-duration': 180,
          },
        },
        {
          selector: 'node.hover',
          style: {
            'border-width': 2.5,
            'border-color': 'rgba(255,255,255,0.82)',
            'underlay-opacity': 0.24,
            'underlay-padding': 11,
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.3,
            'line-color': _COULEUR_ARETE,
            'curve-style': 'bezier',
            'line-opacity': 0.85,
            'overlay-opacity': 0,
            'transition-property': 'line-color, width, line-opacity',
            'transition-duration': 180,
          },
        },
        {
          selector: 'node.selected',
          style: {
            'border-width': 3,
            'border-color': _COULEUR_OR,
            'underlay-opacity': 0.28,
            'underlay-padding': 9,
          },
        },
        {
          selector: 'node.suggest',
          style: {
            'border-width': 2,
            'border-style': 'dashed',
            'border-color': _COULEUR_OR,
            'background-color': _COULEUR_OR,
            'underlay-color': _COULEUR_OR,
            'underlay-opacity': 0.2,
          },
        },
        {
          selector: '.dimmed',
          style: { opacity: 0.25 },
        },
      ],
      minZoom: 0.3,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
    });

    // Interaction : clic → profil + suggestions
    _cytoscapeInstance.on('mouseover', 'node', (evt) => {
      evt.target.addClass('hover');
    });
    _cytoscapeInstance.on('mouseout', 'node', (evt) => {
      evt.target.removeClass('hover');
    });

    _cytoscapeInstance.on('tap', 'node', async (evt) => {
      const noeud = evt.target;
      _cytoscapeInstance.$('node').removeClass('selected suggest');
      _cytoscapeInstance.$('.dimmed').removeClass('dimmed');
      noeud.addClass('selected');

      try {
        const recos = await api(`/api/amis-damis/${encodeURIComponent(noeud.id())}`);
        if (recos.length) {
          // Discrétiser tout ce qui n'est ni le nœud, ni un ami, ni une suggestion
          const voisins = noeud.neighborhood().filter((el) => el.isNode());
          _cytoscapeInstance.$('node')
            .not(noeud)
            .not(voisins)
            .addClass('dimmed');
          recos.forEach((r) => {
            const cible = _cytoscapeInstance.getElementById(r.id);
            if (cible && cible.length) cible.addClass('suggest');
          });
        }
      } catch (_) { /* suggestions optionnelles */ }

      if (typeof showProfil === 'function') showProfil(noeud.id());
    });

    _cytoscapeInstance.on('tap', (evt) => {
      if (evt.target === _cytoscapeInstance) {      // clic dans le vide → reset
        _cytoscapeInstance.$('node').removeClass('selected suggest');
        _cytoscapeInstance.$('.dimmed').removeClass('dimmed');
      }
    });

    _grapheCharge = true;
  } catch (e) {
    if (loading) loading.style.display = 'none';
    c.innerHTML = `<div class="graph-empty">Graphe indisponible : ${e.message}</div>`;
  } finally {
    _grapheEnCours = false;
  }
}

/* ═══════════════════════════════════════════════════════════════
   GRAPHE ÉGO-CENTRÉ — réseau du joueur recherché
   Le joueur est au centre, ses amis directs autour, et les amis
   d'amis (suggestions) en périphérie, reliés à leurs amis communs.
   ═══════════════════════════════════════════════════════════════ */

function detruireCyJoueur() {
  if (_cyJoueur) { _cyJoueur.destroy(); _cyJoueur = null; }
}

/* Construit le voisinage du joueur à partir du graphe complet :
   - amis     : distance 1
   - suggestions : distance 2, hors amis directs (comme Neo4j) */
function construireReseauEgo(donnees, id) {
  const parId = new Map(donnees.noeuds.map((n) => [n.id, n]));
  if (!parId.has(id)) return null;

  const voisins = new Map();          // id → Set(ids voisins)
  for (const a of donnees.aretes) {
    if (!voisins.has(a.a)) voisins.set(a.a, new Set());
    if (!voisins.has(a.b)) voisins.set(a.b, new Set());
    voisins.get(a.a).add(a.b);
    voisins.get(a.b).add(a.a);
  }

  const amis = new Set(voisins.get(id) || []);
  const suggestions = new Map();      // id suggestion → Set(amis communs)
  for (const ami of amis) {
    for (const f of voisins.get(ami) || []) {
      if (f === id || amis.has(f)) continue;
      if (!suggestions.has(f)) suggestions.set(f, new Set());
      suggestions.get(f).add(ami);
    }
  }

  return { parId, amis, suggestions };
}

function elementsEgo(donnees, id, avecSuggestions) {
  const reseau = construireReseauEgo(donnees, id);
  if (!reseau) return null;

  const { parId, amis, suggestions } = reseau;
  const inclus = new Set([id, ...amis]);
  if (avecSuggestions) suggestions.forEach((_, sid) => inclus.add(sid));

  const noeuds = [];
  inclus.forEach((nid) => {
    const n = parId.get(nid);
    if (!n) return;
    const role = nid === id ? 'centre' : amis.has(nid) ? 'ami' : 'suggestion';
    noeuds.push({
      data: { id: nid, label: n.pseudo, score: n.score, niveau: n.niveau, role },
    });
  });

  // Toutes les arêtes entre les nœuds affichés (amitiés acceptées)
  const aretes = [];
  const vues = new Set();
  for (const a of donnees.aretes) {
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

  return {
    elements: noeuds.concat(aretes),
    nbAmis: amis.size,
    nbSuggestions: suggestions.size,
  };
}

function styleGrapheEgo() {
  return [
    {
      selector: 'node',
      style: {
        'background-fill': 'radial-gradient',
        'background-gradient-stop-colors': (el) => (
          el.data('role') === 'centre' ? '#FFE1A0 #F2B03D #C98712'
          : el.data('role') === 'suggestion' ? '#D7D0FF #9B8BE8 #6B5BC4'
          : '#B9D8F8 #6FA7E8 #3F74B8'
        ),
        'background-gradient-stop-positions': '0% 48% 100%',
        'background-gradient-direction': 'to-bottom-right',
        'width': (el) => (el.data('role') === 'centre' ? 58 : el.data('role') === 'ami' ? 36 : 27),
        'height': (el) => (el.data('role') === 'centre' ? 58 : el.data('role') === 'ami' ? 36 : 27),
        'label': 'data(label)',
        'color': '#F5F3EC',
        'font-family': 'Inter, sans-serif',
        'font-size': (el) => (el.data('role') === 'centre' ? 13 : 10.5),
        'font-weight': (el) => (el.data('role') === 'centre' ? 700 : 600),
        'text-valign': 'bottom',
        'text-margin-y': 8,
        'text-outline-width': 2.5,
        'text-outline-color': 'rgba(8,9,13,0.92)',
        'border-width': (el) => (el.data('role') === 'suggestion' ? 1.8 : 1.5),
        'border-style': (el) => (el.data('role') === 'suggestion' ? 'dashed' : 'solid'),
        'border-color': (el) => (
          el.data('role') === 'centre' ? 'rgba(255,255,255,0.75)'
          : el.data('role') === 'suggestion' ? 'rgba(155,139,232,0.9)'
          : 'rgba(255,255,255,0.5)'
        ),
        'underlay-color': (el) => (
          el.data('role') === 'centre' ? _COULEUR_OR
          : el.data('role') === 'suggestion' ? '#9B8BE8'
          : _COULEUR_NOEUD
        ),
        'underlay-opacity': (el) => (el.data('role') === 'centre' ? 0.2 : 0.1),
        'underlay-padding': (el) => (el.data('role') === 'centre' ? 12 : 7),
        'underlay-shape': 'ellipse',
        'overlay-opacity': 0,
        'cursor': 'pointer',
        'transition-property': 'border-color, border-width, underlay-opacity, underlay-padding, opacity',
        'transition-duration': 180,
      },
    },
    {
      selector: 'node.hover',
      style: {
        'border-width': 2.6,
        'border-color': 'rgba(255,255,255,0.85)',
        'underlay-opacity': 0.26,
        'underlay-padding': 11,
      },
    },
    {
      selector: 'edge',
      style: {
        'width': 1.5,
        'line-color': 'rgba(245,243,236,0.18)',
        'curve-style': 'bezier',
        'line-opacity': 0.9,
        'overlay-opacity': 0,
        'transition-property': 'line-color, width, line-opacity',
        'transition-duration': 180,
      },
    },
    {
      selector: 'edge[type="suggestion"]',
      style: {
        'width': 1.1,
        'line-style': 'dashed',
        'line-color': 'rgba(155,139,232,0.5)',
        'line-opacity': 0.8,
      },
    },
    {
      selector: '.dimmed',
      style: { opacity: 0.22 },
    },
  ];
}

async function chargerGrapheJoueur(id, options = {}) {
  const { force = false } = options;
  id = (id || '').trim();
  if (!id) return;

  const section = document.getElementById('grapheJoueurSection');
  const c = document.getElementById('grapheJoueurViz');
  if (!section || !c) return;
  if (_egoEnCours) return;

  _egoEnCours = true;
  _joueurGrapheId = id;

  const loading = document.getElementById('grapheJoueurLoading');
  const vide = document.getElementById('grapheJoueurEmpty');
  const titre = document.getElementById('grapheJoueurTitre');
  const sousTitre = document.getElementById('grapheJoueurSousTitre');
  const toggle = document.getElementById('grapheJoueurSuggestions');

  section.style.display = 'block';
  if (loading) loading.style.display = 'grid';
  if (vide) { vide.style.display = 'none'; vide.textContent = ''; }
  if (titre) titre.textContent = `Réseau de ${id}`;
  if (sousTitre) sousTitre.textContent = 'Chargement…';

  try {
    const donnees = (!force && _grapheDonnees) ? _grapheDonnees : await api('/api/graphe');
    _grapheDonnees = donnees;

    const avecSuggestions = toggle ? toggle.checked : true;
    const reseau = elementsEgo(donnees, id, avecSuggestions);

    if (!reseau) {
      detruireCyJoueur();
      if (loading) loading.style.display = 'none';
      if (vide) {
        vide.textContent = `Joueur « ${id} » introuvable dans le graphe.`;
        vide.style.display = 'grid';
      }
      if (sousTitre) sousTitre.textContent = '';
      return;
    }

    const { nbAmis, nbSuggestions } = reseau;
    if (sousTitre) {
      if (!nbAmis) {
        sousTitre.textContent = 'Aucun ami direct — ajoutez des amis pour étendre ce réseau.';
      } else {
        const amisTxt = `${nbAmis} ami${nbAmis > 1 ? 's' : ''} direct${nbAmis > 1 ? 's' : ''}`;
        const sugTxt = nbSuggestions
          ? `${nbSuggestions} suggestion${nbSuggestions > 1 ? 's' : ''}${avecSuggestions ? '' : ' masquée' + (nbSuggestions > 1 ? 's' : '')}`
          : 'aucune suggestion';
        sousTitre.textContent = `${amisTxt} · ${sugTxt}`;
      }
    }

    detruireCyJoueur();

    _cyJoueur = cytoscape({
      container: c,
      elements: reseau.elements,
      layout: {
        name: 'concentric',
        concentric: (el) => (el.data('role') === 'centre' ? 3 : el.data('role') === 'ami' ? 2 : 1),
        minNodeSpacing: 42,
        spacingFactor: 1.15,
        padding: 46,
        animate: true,
        animationDuration: 500,
      },
      style: styleGrapheEgo(),
      minZoom: 0.3,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
    });

    _cyJoueur.on('layoutstop', () => {
      if (_cyJoueur) _cyJoueur.fit(undefined, 48);
    });

    _cyJoueur.on('mouseover', 'node', (evt) => evt.target.addClass('hover'));
    _cyJoueur.on('mouseout', 'node', (evt) => evt.target.removeClass('hover'));

    // Clic simple → profil ; double-clic → explorer le réseau de ce joueur
    _cyJoueur.on('tap', 'node', (evt) => {
      const nid = evt.target.id();
      if (typeof showProfil === 'function') showProfil(nid);
    });

    _cyJoueur.on('dbltap', 'node', (evt) => {
      const nid = evt.target.id();
      if (nid === _joueurGrapheId) return;
      const input = document.getElementById('amisJoueurId');
      if (input) input.value = nid;
      if (typeof loadAmis === 'function') loadAmis();
    });

    _cyJoueur.on('tap', (evt) => {
      if (evt.target === _cyJoueur) {
        _cyJoueur.$('.dimmed').removeClass('dimmed');
      }
    });

    if (loading) loading.style.display = 'none';
    if (vide) vide.style.display = 'none';
  } catch (e) {
    detruireCyJoueur();
    if (loading) loading.style.display = 'none';
    if (vide) {
      vide.textContent = `Graphe indisponible : ${e.message}`;
      vide.style.display = 'grid';
    }
    if (sousTitre) sousTitre.textContent = '';
  } finally {
    _egoEnCours = false;
  }
}

/* Recharge le graphe du joueur courant (après un ajout/retrait d'ami). */
function rafraichirGrapheJoueur() {
  if (_joueurGrapheId) chargerGrapheJoueur(_joueurGrapheId, { force: true });
}

/* ── Demandes d'ami ── */
async function chargerDemandes() {
  const id = (document.getElementById('demandesId')?.value || '').trim();
  const c = document.getElementById('demandesResult');
  if (!id) { toast('Entrez un identifiant joueur', 'err'); return; }
  if (!c) return;
  c.innerHTML = '<div class="skeleton-block"></div>';

  try {
    const d = await api(`/api/demandes-ami/${encodeURIComponent(id)}`);

    const carte = (p, actions, tag) => `
      <div class="demande-card">
        <div class="player-cell">
          <div class="avatar">${initials(p.pseudo)}</div>
          <span class="player-name">${esc(p.pseudo)}</span>
          <span class="player-id">${esc(p.id)}</span>
        </div>
        ${tag ? `<span class="mutual-tag">${tag}</span>` : ''}
        <div class="demande-actions">${actions}</div>
      </div>`;

    const btnAccepter = (a, b) => `
      <button class="btn-success btn-sm" data-action="accepter-demande" data-a="${esc(a)}" data-b="${esc(b)}">
        <i data-lucide="check" class="icon-xs"></i> Accepter
      </button>`;
    const btnRefuser = (a, b, label = 'Refuser', ico = 'x') => `
      <button class="btn-danger btn-sm" data-action="refuser-demande" data-a="${esc(a)}" data-b="${esc(b)}">
        <i data-lucide="${ico}" class="icon-xs"></i> ${label}
      </button>`;

    let html = '';
    if (d.recues.length) {
      html += `<div class="section-header"><h2 class="section-title">Reçues (${d.recues.length})</h2></div>`;
      html += d.recues.map((p) => carte(p, btnAccepter(p.id, id) + btnRefuser(p.id, id), 'en attente')).join('');
    }
    if (d.envoyees.length) {
      html += `<div class="section-header"><h2 class="section-title">Envoyées (${d.envoyees.length})</h2></div>`;
      html += d.envoyees.map((p) => carte(p, btnRefuser(id, p.id, 'Annuler', 'undo-2'), 'en attente')).join('');
    }
    if (!html) {
      html = emptyState('Aucune demande en attente', 'inbox');
    }
    c.innerHTML = html;
    reinitIcons();
  } catch (e) {
    c.innerHTML = errorState(e.message);
    reinitIcons();
  }
}

async function actionDemande(action, idA, idB) {
  const url = action === 'accepter-demande' ? '/api/demande-ami/accepter'
            : action === 'refuser-demande'   ? '/api/demande-ami/refuser'
            : null;
  if (!url) return;
  try {
    const r = await api(url, {
      method: 'POST',
      body: JSON.stringify({ id_de: idA, id_vers: idB }),
    });
    toast(r.message);
    chargerDemandes();
    // Les amis directs / suggestions peuvent avoir changé
    const idCourant = document.getElementById('amisJoueurId')?.value?.trim();
    if (idCourant) { loadAmisDirects(idCourant); loadAmisReco(idCourant); }
    if (_grapheCharge) chargerGraphe();
    rafraichirGrapheJoueur();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ── Branchement ── */
document.addEventListener('DOMContentLoaded', () => {
  // Demandes d'ami (délégation)
  const zoneDemandes = document.getElementById('demandesResult');
  if (zoneDemandes) {
    zoneDemandes.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'accepter-demande' || btn.dataset.action === 'refuser-demande') {
        actionDemande(btn.dataset.action, btn.dataset.a, btn.dataset.b);
      }
    });
  }

  const btnDemandes = document.getElementById('btnDemandes');
  if (btnDemandes) btnDemandes.addEventListener('click', chargerDemandes);
  const demandesInput = document.getElementById('demandesId');
  if (demandesInput) demandesInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); chargerDemandes(); }
  });

  // Graphe
  const btnGraphe = document.getElementById('grapheRefresh');
  if (btnGraphe) btnGraphe.addEventListener('click', () => {
    chargerGraphe();
    rafraichirGrapheJoueur();
  });

  // Graphe égo-centré du joueur recherché
  const btnEgoFit = document.getElementById('grapheJoueurFit');
  if (btnEgoFit) btnEgoFit.addEventListener('click', () => {
    if (_cyJoueur) _cyJoueur.fit(undefined, 48);
  });

  const btnEgoRefresh = document.getElementById('grapheJoueurRefresh');
  if (btnEgoRefresh) btnEgoRefresh.addEventListener('click', () => {
    if (_joueurGrapheId) chargerGrapheJoueur(_joueurGrapheId, { force: true });
  });

  const toggleEgo = document.getElementById('grapheJoueurSuggestions');
  if (toggleEgo) toggleEgo.addEventListener('change', () => {
    if (_joueurGrapheId) chargerGrapheJoueur(_joueurGrapheId);
  });

  // Le canvas Cytoscape doit suivre la taille de la fenêtre
  window.addEventListener('resize', () => {
    if (_cyJoueur) _cyJoueur.resize();
  });

  // Chargement paresseux quand la page Réseau s'ouvre
  const page = document.getElementById('page-amis');
  if (page) {
    const observer = new MutationObserver(() => {
      if (page.classList.contains('active') && !page._arenaReseauCharge) {
        page._arenaReseauCharge = true;
        if (typeof remplirDatalist === 'function') remplirDatalist();
        if (!_grapheCharge) chargerGraphe();
        // Pré-remplir avec le joueur connecté
        const s = (typeof sessionCourante === 'function') ? sessionCourante() : null;
        if (s) {
          const d = document.getElementById('demandesId');
          if (d && !d.value) d.value = s.joueur_id;
        }
      }
      if (!page.classList.contains('active')) page._arenaReseauCharge = false;
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
  }
});
