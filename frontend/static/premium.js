/* ═══════════════════════════════════════════════════════════════
   ARENA — Premium interactions
   Progression douce, sans dépendance ni framework :
   · halo de lumière qui suit le curseur sur les surfaces
   · barre supérieure qui se densifie au défilement
   · compteurs animés (stats, score de quiz)
   Toutes les améliorations sont facultatives : sans JS, l'UI reste
   complète et fonctionnelle.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const mouvementReduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointeurFin = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ── 0. Numéro éditorial des sections (filigrane CSS) ── */
  document.querySelectorAll('.page-header').forEach((entete) => {
    const num = entete.querySelector('.page-kicker .k-num');
    if (num) entete.dataset.index = num.textContent.trim();
  });

  /* ── 1. Halo qui suit le curseur ── */
  let lumiereCurseur = null;
  if (pointeurFin && !mouvementReduit) {
    lumiereCurseur = document.createElement('div');
    lumiereCurseur.className = 'cursor-light';
    lumiereCurseur.setAttribute('aria-hidden', 'true');
    document.body.appendChild(lumiereCurseur);
  }

  const SURFACES = [
    '.board',
    '.table-wrap',
    '.form-panel',
    '.inline-form',
    '.podium-step',
    '.graph-shell',
    '.quiz-stat',
    '.profil-stat-item',
    '.demande-card',
    '.state-empty',
    '.chart-box',
  ].join(',');

  if (pointeurFin && !mouvementReduit) {
    let surfaceCourante = null;
    let frame = null;
    let x = 0;
    let y = 0;
    let clientX = 0;
    let clientY = 0;

    const peindre = () => {
      frame = null;
      document.documentElement.style.setProperty('--cur-x', clientX + 'px');
      document.documentElement.style.setProperty('--cur-y', clientY + 'px');
      if (!surfaceCourante) return;
      surfaceCourante.style.setProperty('--glow-x', x + 'px');
      surfaceCourante.style.setProperty('--glow-y', y + 'px');
    };

    document.addEventListener('pointermove', (e) => {
      clientX = e.clientX;
      clientY = e.clientY;
      if (lumiereCurseur) lumiereCurseur.classList.add('on');

      const cible = e.target && e.target.closest ? e.target.closest(SURFACES) : null;

      if (cible !== surfaceCourante) {
        if (surfaceCourante) {
          surfaceCourante.style.removeProperty('--glow-x');
          surfaceCourante.style.removeProperty('--glow-y');
        }
        surfaceCourante = cible;
      }

      if (surfaceCourante) {
        const r = surfaceCourante.getBoundingClientRect();
        x = e.clientX - r.left;
        y = e.clientY - r.top;
      }

      if (!frame) frame = requestAnimationFrame(peindre);
    }, { passive: true });

    document.addEventListener('pointerleave', () => {
      if (lumiereCurseur) lumiereCurseur.classList.remove('on');
    });
    window.addEventListener('blur', () => {
      if (lumiereCurseur) lumiereCurseur.classList.remove('on');
    });
  }

  /* ── 2. Topbar au défilement ── */
  const contenu = document.querySelector('.content');
  const topbar = document.querySelector('.topbar');

  if (contenu && topbar) {
    const surDefilement = () => {
      const hauteur = contenu.scrollHeight - contenu.clientHeight;
      const progression = hauteur > 0 ? (contenu.scrollTop / hauteur) * 100 : 0;
      topbar.style.setProperty('--scroll-progress', progression.toFixed(2) + '%');
      topbar.classList.toggle('scrolled', contenu.scrollTop > 8);
    };
    contenu.addEventListener('scroll', surDefilement, { passive: true });
    window.addEventListener('resize', surDefilement);
    surDefilement();
  }

  /* ── 3. Compteurs animés ── */
  const CIBLES = [
    '#statTotal',
    '#statClasses',
    '#statTopScore',
    '#quizScore',
    '#quizFinPoints',
    '#quizFinTotal',
  ];

  const dernierNombre = new WeakMap();
  const enCours = new WeakSet();

  const lireNombre = (texte) => {
    const chiffres = String(texte || '').replace(/[^\d]/g, '');
    return chiffres ? Number(chiffres) : null;
  };

  const poser = (el, valeur) => {
    el.textContent = valeur.toLocaleString('fr-FR');
  };

  const animer = (el, objectif) => {
    if (mouvementReduit || document.hidden || objectif < 10) {
      poser(el, objectif);
      dernierNombre.set(el, objectif);
      return;
    }

    const depart = dernierNombre.has(el) ? dernierNombre.get(el) : 0;
    if (depart === objectif) return;

    enCours.add(el);
    dernierNombre.set(el, objectif);

    const duree = Math.min(820, 320 + Math.abs(objectif - depart) * 1.2);
    const debut = performance.now();
    let termine = false;

    const finir = () => {
      if (termine) return;
      termine = true;
      poser(el, objectif);
      enCours.delete(el);
    };

    const trame = (maintenant) => {
      if (termine) return;
      const p = Math.min(1, (maintenant - debut) / duree);
      const adouci = 1 - Math.pow(1 - p, 3);
      poser(el, Math.round(depart + (objectif - depart) * adouci));

      if (p < 1) {
        requestAnimationFrame(trame);
      } else {
        finir();
      }
    };
    requestAnimationFrame(trame);

    // Filet de sécurité : si l'onglet est masqué, rAF se met en pause.
    // La valeur finale doit toujours être posée, jamais un nombre intermédiaire.
    setTimeout(finir, duree + 140);
  };

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const el = m.target;
      if (!el || el.nodeType !== 1) continue;
      if (enCours.has(el)) continue;

      const objectif = lireNombre(el.textContent);
      if (objectif === null) continue;

      const precedent = dernierNombre.has(el) ? dernierNombre.get(el) : null;
      if (precedent === objectif) continue;

      animer(el, objectif);
    }
  });

  for (const selecteur of CIBLES) {
    const el = document.querySelector(selecteur);
    if (!el) continue;

    const initial = lireNombre(el.textContent);
    if (initial !== null) dernierNombre.set(el, initial);

    observer.observe(el, { childList: true, characterData: true, subtree: true });
  }
})();
