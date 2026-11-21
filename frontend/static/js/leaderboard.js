/* ═══════════════════════════════════════════════════════════════
   ARENA — Classement avancé
   - Podium (top 3) du classement mondial
   - Classement complet paginé (au-delà du Top 10)
   - Fenêtre "autour de moi" (rang N-3 … N+3)
   - Datalist de recherche de joueurs (autocomplétion native)
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ── Podium ── */
function renderPodium(conteneurId, top) {
  const c = document.getElementById(conteneurId);
  if (!c) return;
  if (!top || !top.length) { c.innerHTML = ''; return; }

  const trois = top.slice(0, 3);
  const medailles = { 1: '🥇', 2: '🥈', 3: '🥉' };
  c.innerHTML = trois.map((e) => `
    <div class="podium-step podium-${e.rang}">
      <div class="podium-medal">${medailles[e.rang]}</div>
      <span class="podium-name">${esc(e.nom)}</span>
      <span class="podium-score">${fmtScore(e.score)} <span class="score-unit">pts</span></span>
    </div>`).join('');
}

/* ── Classement global paginé ── */
const _classementEtat = { page: 1, parPage: 20 };

function renderTableClassement(entrees, conteneurId) {
  const c = document.getElementById(conteneurId);
  if (!c) return;
  if (!entrees.length) {
    c.innerHTML = emptyState('Aucun joueur classé sur cette page', 'trophy');
    reinitIcons();
    return;
  }
  c.innerHTML = `<div class="table-wrap">
    <table class="data-table">
      <thead><tr>
        <th style="width:52px">Rang</th>
        <th>Joueur</th><th>Identifiant</th>
        <th style="text-align:right">Score</th>
      </tr></thead>
      <tbody>
        ${entrees.map((e) => `
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

async function chargerClassementPage(page = 1) {
  _classementEtat.page = page;
  const c = document.getElementById('classementGlobal');
  const pager = document.getElementById('pagerGlobal');
  if (!c) return;
  c.innerHTML = '<div class="skeleton-table"></div>';

  try {
    const d = await api(`/api/classement?page=${page}&par_page=${_classementEtat.parPage}`);
    renderTableClassement(d.entrees, 'classementGlobal');

    if (pager) {
      pager.style.display = d.total > d.par_page ? '' : 'none';
      const info = document.getElementById('pagerInfo');
      if (info) info.textContent = `page ${d.page} / ${Math.max(1, Math.ceil(d.total / d.par_page))}`;
      const prec = document.getElementById('pagerPrec');
      const suiv = document.getElementById('pagerSuiv');
      if (prec) prec.disabled = d.page <= 1;
      if (suiv) suiv.disabled = d.page >= Math.ceil(d.total / d.par_page);
    }
  } catch (e) {
    c.innerHTML = errorState(e.message);
    reinitIcons();
  }
}

/* ── Fenêtre "autour de moi" ── */
async function chargerAutour() {
  const id = (document.getElementById('autourId')?.value || '').trim();
  const c  = document.getElementById('autourResult');
  if (!id) { toast('Entrez un identifiant joueur', 'err'); return; }
  if (!c) return;
  c.innerHTML = '<div class="skeleton-table" style="height:160px"></div>';

  try {
    const d = await api(`/api/classement-autour/${encodeURIComponent(id)}?rayon=3`);
    if (d.rang === null) {
      c.innerHTML = emptyState(d.message || 'Joueur non classé', 'trophy');
      reinitIcons();
      return;
    }
    const ligneCentre = (e) => e.id === id
      ? '<span class="you-tag">vous</span>' : '';
    c.innerHTML = `<div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th style="width:52px">Rang</th>
          <th>Joueur</th><th>ID</th>
          <th style="text-align:right">Score</th>
        </tr></thead>
        <tbody>
          ${d.entrees.map((e) => `
          <tr data-player-id="${esc(e.id)}" ${e.id === id ? 'style="outline:1px solid var(--accent-border)"' : ''}>
            <td><span class="rank-num ${rankClass(e.rang)}">${esc(e.rang)}</span></td>
            <td><div class="player-cell">
              <div class="avatar">${initials(e.nom)}</div>
              <span class="player-name">${esc(e.nom)}</span>
              ${ligneCentre(e)}
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
  } catch (e) {
    c.innerHTML = errorState(e.message);
    reinitIcons();
  }
}

/* ── Datalist de recherche (autocomplétion native des IDs) ── */
async function remplirDatalist() {
  const dl = document.getElementById('listeJoueurs');
  if (!dl || dl.children.length) return;      // déjà rempli
  try {
    const joueurs = await api('/api/joueurs');
    dl.innerHTML = joueurs
      .map((j) => `<option value="${esc(j.id)}">${esc(j.pseudo)}</option>`)
      .join('');
  } catch (_) { /* pas bloquant */ }
}

/* ── Délégation + branchement ── */
document.addEventListener('DOMContentLoaded', () => {
  const pager = document.getElementById('pagerGlobal');
  if (pager) {
    pager.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      if (btn.id === 'pagerPrec') chargerClassementPage(_classementEtat.page - 1);
      if (btn.id === 'pagerSuiv') chargerClassementPage(_classementEtat.page + 1);
    });
  }

  const btnAutour = document.getElementById('btnAutour');
  if (btnAutour) btnAutour.addEventListener('click', chargerAutour);
  const autourInput = document.getElementById('autourId');
  if (autourInput) autourInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); chargerAutour(); }
  });

  const btnRefreshClassement = document.getElementById('btnRefreshClassement');
  if (btnRefreshClassement) btnRefreshClassement.addEventListener('click', () => chargerClassementPage(_classementEtat.page));

  // Le classement paginé + podium se chargent à l'ouverture de la page Classement
  const observer = new MutationObserver(() => {
    const page = document.getElementById('page-classement');
    if (page && page.classList.contains('active') && !page._arenaCharge) {
      page._arenaCharge = true;
      chargerClassementPage(1);
      api('/api/top10').then((top) => renderPodium('podiumGlobal', top)).catch(() => {});
      remplirDatalist();
    }
    if (page && !page.classList.contains('active')) page._arenaCharge = false;
  });
  const pageClassement = document.getElementById('page-classement');
  if (pageClassement) {
    observer.observe(pageClassement, { attributes: true, attributeFilter: ['class'] });
    // Si la page est active dès l'arrivée (lien direct #classement)
    if (pageClassement.classList.contains('active')) {
      chargerClassementPage(1);
      api('/api/top10').then((top) => renderPodium('podiumGlobal', top)).catch(() => {});
      remplirDatalist();
      pageClassement._arenaCharge = true;
    }
  }
});
