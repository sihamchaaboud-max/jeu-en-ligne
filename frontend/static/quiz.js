/* ═══════════════════════════════════════════════════════════════
   ARENA — Quiz de calcul mental
   Parle à l'API : POST /api/quiz/start et POST /api/quiz/answer
   Nouveautés V2 :
   - mode "entrainement" (toggle) : aucun score compté, aucun historique
   - points de progression (10 segments) + série de bonnes réponses
   - retour animé (flash vert/rouge) sur le champ de réponse
   - écran de fin : record personnel + distinction entraînement
   - identité pré-remplie depuis la session (auth.js)
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  let partieId = null;
  let joueurCourant = "";
  let tokenCourant = null;
  let modeCourant = "classe";
  let nbQuestions = 10;
  let tempsLimite = 10;
  let debutQuestion = 0;
  let minuteur = null;
  let occupe = false;          // évite d'envoyer deux fois la même réponse
  let effacerRetour = null;
  let serie = 0;               // bonnes réponses consécutives
  let resultats = [];          // true/false par question (pour les points de progression)

  const $ = (id) => document.getElementById(id);

  // ─────────────────────────────────────────────
  // Utilitaires
  // ─────────────────────────────────────────────
  function montrer(nom) {
    for (const id of ["quizDebut", "quizJeu", "quizFin"]) {
      $(id).classList.toggle("quiz-hidden", id !== nom);
    }
  }

  function afficherErreur(message) {
    $("quizErreur").textContent = message;
  }

  async function appelerApi(url, donnees) {
    const headers = { "Content-Type": "application/json" };
    if (tokenCourant) headers["Authorization"] = "Bearer " + tokenCourant;
    const options = {
      method: "POST",
      headers,
      body: JSON.stringify(donnees),
    };
    const reponse = await fetch(url, options);
    const json = await reponse.json();
    if (!reponse.ok) {
      throw new Error(json.detail || "Erreur du serveur");
    }
    return json;
  }

  // ─────────────────────────────────────────────
  // Progression : points + série
  // ─────────────────────────────────────────────
  function construirePoints() {
    const zone = $("quizDots");
    if (!zone) return;
    zone.innerHTML = "";
    for (let i = 0; i < nbQuestions; i++) {
      const dot = document.createElement("span");
      dot.className = "quiz-dot";
      dot.setAttribute("aria-hidden", "true");
      zone.appendChild(dot);
    }
  }

  function majPoints() {
    const zone = $("quizDots");
    if (!zone) return;
    [...zone.children].forEach((dot, i) => {
      dot.classList.toggle("done", i < resultats.length);
      dot.classList.toggle("rated", i < resultats.length && resultats[i] === true);
      dot.classList.toggle("current", i === resultats.length && !partieFinie());
    });
  }

  function partieFinie() {
    return resultats.length >= nbQuestions;
  }

  function majSerie(correct) {
    serie = correct ? serie + 1 : 0;
    const el = $("quizStreak");
    if (!el) return;
    if (serie >= 2) {
      el.textContent = `🔥 série de ${serie}`;
      el.className = "quiz-streak " + (serie >= 5 ? "s3" : serie >= 3 ? "s2" : "s1");
    } else {
      el.textContent = "";
      el.className = "quiz-streak";
    }
  }

  function flashReponse(correct) {
    const champ = $("quizReponse");
    if (!champ) return;
    champ.classList.remove("flash-ok", "flash-ko");
    void champ.offsetWidth;                    // redémarre l'animation
    champ.classList.add(correct ? "flash-ok" : "flash-ko");
  }

  // ─────────────────────────────────────────────
  // Connexion (si le joueur a un mot de passe)
  // ─────────────────────────────────────────────
  async function connecter(joueurId, motDePasse) {
    tokenCourant = null;
    if (!motDePasse) {
      // Session existante (auth.js) : on réutilise son token si compatible
      if (typeof tokenSession === "function") {
        const t = tokenSession();
        const s = (typeof sessionCourante === "function") ? sessionCourante() : null;
        if (t && s && s.joueur_id === joueurId) tokenCourant = t;
      }
      return;
    }

    const reponse = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joueur_id: joueurId, mot_de_passe: motDePasse }),
    });
    const json = await reponse.json();
    if (!reponse.ok) {
      throw new Error(json.detail || "Connexion impossible");
    }
    if (json.sans_mot_de_passe) return;   // joueur du seed sans mot de passe
    tokenCourant = json.token;
  }

  // ─────────────────────────────────────────────
  // Début de partie
  // ─────────────────────────────────────────────
  async function commencer(evenement) {
    evenement.preventDefault();
    const joueurId = $("quizJoueurId").value.trim();
    const motDePasse = $("quizMdp").value;
    const mode = $("quizModeEntrainement") && $("quizModeEntrainement").checked
      ? "entrainement" : "classe";
    if (!joueurId) return;
    afficherErreur("");

    try {
      await connecter(joueurId, motDePasse);
      const d = await appelerApi("/api/quiz/start", { joueur_id: joueurId, mode: mode });
      joueurCourant = joueurId;
      partieId = d.partie_id;
      modeCourant = d.mode || "classe";
      nbQuestions = d.nb_questions;
      tempsLimite = d.temps_limite;

      serie = 0;
      resultats = [];
      $("quizPseudo").textContent = d.pseudo + (modeCourant === "entrainement" ? " · entraînement" : "");
      $("quizScore").textContent = "0";
      $("quizRetour").textContent = "";
      construirePoints();
      majSerie(false);
      montrer("quizJeu");
      afficherQuestion(d.numero, d.question);
    } catch (e) {
      afficherErreur(e.message);
    }
  }

  // ─────────────────────────────────────────────
  // Questions et chrono
  // ─────────────────────────────────────────────
  function afficherQuestion(numero, texte) {
    $("quizNumero").textContent = `${numero}/${nbQuestions}`;
    $("quizQuestion").textContent = `${texte} = ?`;
    const champ = $("quizReponse");
    champ.value = "";
    champ.focus();
    occupe = false;
    majPoints();
    lancerChrono();
  }

  function lancerChrono() {
    clearInterval(minuteur);
    debutQuestion = performance.now();

    minuteur = setInterval(() => {
      const ecoule = (performance.now() - debutQuestion) / 1000;
      const reste = Math.max(0, tempsLimite - ecoule);

      $("quizBarre").style.width = `${(reste / tempsLimite) * 100}%`;
      $("quizBarre").classList.toggle("urgent", reste < 3);
      $("quizTemps").textContent = reste.toFixed(1);

      if (reste <= 0) {
        clearInterval(minuteur);
        envoyer("");            // temps écoulé : réponse vide, 0 point
      }
    }, 50);
  }

  // ─────────────────────────────────────────────
  // Envoi d'une réponse
  // ─────────────────────────────────────────────
  async function envoyer(valeur) {
    if (occupe) return;
    occupe = true;
    clearInterval(minuteur);

    try {
      const d = await appelerApi("/api/quiz/answer", {
        partie_id: partieId,
        reponse: valeur,
      });

      $("quizScore").textContent = d.score_partie;
      majSerie(d.correct);
      resultats.push(d.correct);
      flashReponse(d.correct);
      afficherRetour(d);

      if (d.termine) {
        majPoints();
        afficherFin(d);
      } else {
        afficherQuestion(d.numero, d.question);
      }
    } catch (e) {
      partieId = null;
      montrer("quizDebut");
      afficherErreur(e.message);
    }
  }

  function validerSaisie(evenement) {
    evenement.preventDefault();
    const valeur = $("quizReponse").value.trim();
    if (valeur === "") return;
    envoyer(valeur);
  }

  // Message sur la réponse précédente (la question suivante est déjà affichée)
  function afficherRetour(d) {
    const zone = $("quizRetour");
    if (d.correct) {
      zone.textContent = `✓ Bravo ! +${d.points} pts (${d.temps} s)` +
        (d.temps <= 3 ? " — réflexe éclair !" : "");
      zone.className = "quiz-retour ok";
    } else {
      zone.textContent = `✗ Raté. La bonne réponse était ${d.bonne_reponse}`;
      zone.className = "quiz-retour ko";
    }
    clearTimeout(effacerRetour);
    effacerRetour = setTimeout(() => {
      zone.textContent = "";
    }, 2500);
  }

  // ─────────────────────────────────────────────
  // Fin de partie
  // ─────────────────────────────────────────────
  async function afficherFin(d) {
    partieId = null;
    $("quizFinPoints").textContent = d.score_partie;

    const cellTotal = $("quizFinTotal");
    const cellRang  = $("quizFinRang");
    const note      = $("quizFinNote");

    if (d.entrainement) {
      // Mode entraînement : rien n'a été compté
      if (cellTotal) cellTotal.textContent = "—";
      if (cellRang) cellRang.textContent = "—";
      if (note) {
        note.textContent = "Partie d'entraînement : aucun score n'a été compté.";
        note.style.display = "";
      }
    } else {
      if (cellTotal) cellTotal.textContent = d.nouveau_score;
      if (cellRang) cellRang.textContent = d.rang ? `${d.rang}` : "—";
      if (note) note.style.display = "none";

      // Record personnel (MongoDB)
      try {
        const stats = await fetch(`/api/stats-joueur/${encodeURIComponent(joueurCourant)}`)
          .then((r) => r.json());
        const cellRecord = $("quizFinRecord");
        if (cellRecord) {
          const record = stats.meilleur_score || 0;
          cellRecord.textContent = record;
          // Le record vient d'être battu si la meilleure partie EST celle-ci
          cellRecord.parentElement.classList.toggle("record-battu", d.score_partie >= record && record > 0);
        }
      } catch (_) { /* record optionnel */ }

      // Met à jour le Top 10 du dashboard avec le nouveau score
      try {
        if (typeof loadTop10 === "function") loadTop10();
      } catch (e) { /* sans importance */ }
      document.dispatchEvent(new CustomEvent("arena:quiz-fini", {
        detail: { joueur: joueurCourant, points: d.score_partie },
      }));
    }

    montrer("quizFin");
    $("quizFin").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function rejouer() {
    afficherErreur("");
    montrer("quizDebut");
    $("quizJoueurId").value = joueurCourant;
    $("quizJoueurId").focus();
  }

  function voirClassement() {
    if (typeof showPage === "function") showPage("classement");
    try {
      if (typeof loadTop10Full === "function") loadTop10Full();
    } catch (e) { /* sans importance */ }
  }

  // Si le joueur quitte la page pendant une partie : on abandonne proprement
  function abandonner() {
    clearInterval(minuteur);
    partieId = null;
    occupe = false;
    montrer("quizDebut");
    afficherErreur("Partie abandonnée : le score n'a pas été enregistré.");
  }

  // ─────────────────────────────────────────────
  // Branchements
  // ─────────────────────────────────────────────
  $("quizFormDebut").addEventListener("submit", commencer);
  $("quizFormReponse").addEventListener("submit", validerSaisie);
  $("quizRejouer").addEventListener("click", rejouer);
  $("quizVoirClassement").addEventListener("click", voirClassement);

  // Identité pré-remplie depuis la session (auth.js chargé avant)
  const session = (typeof sessionCourante === "function") ? sessionCourante() : null;
  if (session) {
    const champId = $("quizJoueurId");
    if (champId && !champId.value) {
      champId.value = session.joueur_id;
      if (!$("quizMdp").value) champId.focus();
    }
  }

  // Titre de la barre du haut pour la page quiz
  const boutonMenu = document.querySelector('.nav-item[data-page="quiz"]');
  if (boutonMenu) {
    boutonMenu.addEventListener("click", () => {
      const titre = $("topbarTitle");
      if (titre) titre.textContent = "Quiz de calcul";
      $("quizJoueurId").focus();
    });
  }

  // Détecte quand la page quiz n'est plus affichée
  new MutationObserver(() => {
    const visible = $("page-quiz").classList.contains("active");
    if (!visible && partieId) abandonner();
  }).observe($("page-quiz"), { attributes: true, attributeFilter: ["class"] });
})();
