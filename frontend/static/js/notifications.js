/* ═══════════════════════════════════════════════════════════════
   ARENA — Notifications temps réel
   - top10    : détecte les changements de rang → flash des lignes
                + toast "passe au rang" (podium ou moi)
   - activite : fin de quiz d'un joueur → toast d'activité
   S'abonne au canal WebSocket via onWsMessage() défini dans app.js.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* dernier rang connu par joueur : {id: rang} */
let _derniersRangs = {};

function estMoi(joueurId) {
  if (typeof sessionCourante !== 'function') return false;
  const s = sessionCourante();
  return !!(s && s.joueur_id === joueurId);
}

function flasherLignes(changements) {
  for (const id of Object.keys(changements)) {
    document.querySelectorAll(`[data-player-id="${CSS.escape(id)}"]`).forEach((tr) => {
      tr.classList.remove('row-flash');
      // Forcer le redémarrage de l'animation
      void tr.offsetWidth;
      tr.classList.add('row-flash');
    });
  }
}

function surTop10(msg) {
  const top = msg.top || [];
  const changements = {};

  for (const e of top) {
    const ancien = _derniersRangs[e.id];
    if (ancien !== undefined && e.rang < ancien) {
      changements[e.id] = { ancien, nouveau: e.rang, nom: e.nom, score: e.score };
    }
    _derniersRangs[e.id] = e.rang;
  }

  // Purger les joueurs sortis du Top 10 (leur rang mémorisé n'a plus de sens)
  const ids = new Set(top.map((e) => e.id));
  for (const id of Object.keys(_derniersRangs)) {
    if (!ids.has(id)) delete _derniersRangs[id];
  }

  // Flash des lignes qui montent
  flasherLignes(changements);

  // Toasts : podium + « moi » uniquement (pas de spam)
  for (const [id, info] of Object.entries(changements)) {
    const notable = info.nouveau <= 3 || estMoi(id);
    if (notable && typeof toast === 'function') {
      const gagne = ancien => ancien - info.nouveau;
      toast(`📈 ${info.nom} passe au rang #${info.nouveau} (+${gagne(info.ancien)})`);
    }
  }
}

function surActivite(msg) {
  if (typeof toast !== 'function') return;
  if (estMoi(msg.joueur_id)) return;        // pas de notification pour soi-même
  toast(`⚡ ${msg.pseudo} termine une partie : +${msg.points} pts (${msg.bonnes}/10)`);
}

/* Le canal WS peut ne pas exister (page quiz seule) : gardes défensives */
if (typeof onWsMessage === 'function') {
  onWsMessage('top10', surTop10);
  onWsMessage('activite', surActivite);
}
