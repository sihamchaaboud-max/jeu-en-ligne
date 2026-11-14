// Quiz de calcul mental, intégré au dashboard.
// Parle à l'API : POST /api/quiz/start et POST /api/quiz/answer
(function () {
  "use strict";

  let partieId = null;
  let joueurCourant = "";
  let tokenCourant = null;
  let nbQuestions = 10;
  let tempsLimite = 10;
  let debutQuestion = 0;
  let minuteur = null;
  let occupe = false;          // évite d'envoyer deux fois la même réponse
  let effacerRetour = null;

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
  // Connexion (si le joueur a un mot de passe)
  // ─────────────────────────────────────────────
  async function connecter(joueurId, motDePasse) {
    tokenCourant = null;
    if (!motDePasse) return;   // pas de mot de passe saisi : on tente en mode héritage

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
    if (!joueurId) return;
    afficherErreur("");

    try {
      await connecter(joueurId, motDePasse);
      const d = await appelerApi("/api/quiz/start", { joueur_id: joueurId });
      joueurCourant = joueurId;
      partieId = d.partie_id;
      nbQuestions = d.nb_questions;
      tempsLimite = d.temps_limite;

      $("quizPseudo").textContent = d.pseudo;
      $("quizScore").textContent = "0";
      $("quizRetour").textContent = "";
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
    $("quizReponse").value = "";
    $("quizReponse").focus();
    occupe = false;
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
      afficherRetour(d);

      if (d.termine) {
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
      zone.textContent = `✓ Bravo ! +${d.points} pts (${d.temps} s)`;
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
  function afficherFin(d) {
    partieId = null;
    $("quizFinPoints").textContent = d.score_partie;
    $("quizFinTotal").textContent = d.nouveau_score;
    $("quizFinRang").textContent = d.rang ? `${d.rang}` : "—";
    montrer("quizFin");
    $("quizFin").scrollIntoView({ behavior: "smooth", block: "start" });

    // Met à jour le Top 10 du dashboard avec le nouveau score
    try {
      if (typeof loadTop10 === "function") loadTop10();
    } catch (e) { /* sans importance */ }
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