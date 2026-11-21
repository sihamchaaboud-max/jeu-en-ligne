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
  if (btnGraphe) btnGraphe.addEventListener('click', chargerGraphe);

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
