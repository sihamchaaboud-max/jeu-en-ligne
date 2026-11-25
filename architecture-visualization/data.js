/**
 * data.js - Architecture data for the Arena Online Game project.
 * All information extracted directly from actual source code.
 */
const ARCHITECTURE = {
  project: {
    name: "Arena — Jeu en Ligne",
    version: "2.0.0",
    description: "Jeu en ligne multijoueur avec quiz de calcul mental, classement mondial en temps réel, et réseau social. Utilise trois bases de données NoSQL spécialisées, chacune exploitée pour ses forces propres.",
    technologies: [
      { name: "Python 3.11+", category: "backend", icon: "🐍" },
      { name: "FastAPI", category: "backend", icon: "⚡" },
      { name: "Uvicorn (ASGI)", category: "backend", icon: "🚀" },
      { name: "MongoDB 7", category: "database", icon: "🍃" },
      { name: "Redis 7", category: "database", icon: "🔴" },
      { name: "Neo4j 5", category: "database", icon: "🕸️" },
      { name: "WebSocket", category: "realtime", icon: "🔌" },
      { name: "JWT / HS256", category: "auth", icon: "🔑" },
      { name: "PBKDF2-SHA256", category: "auth", icon: "🔒" },
      { name: "Docker Compose", category: "infra", icon: "🐳" },
      { name: "Pydantic v2", category: "backend", icon: "✅" },
      { name: "Cytoscape.js", category: "frontend", icon: "📊" },
      { name: "Chart.js", category: "frontend", icon: "📈" }
    ]
  },
  components: [
    { id: "frontend", label: "Frontend", sublabel: "HTML · CSS · Vanilla JS", type: "frontend", x: 400, y: 60,
      description: "Interface utilisateur servie statiquement par FastAPI. Deux pages : dashboard (index.html) et quiz (quiz.html). Dépendances auto-hébergées dans frontend/static/vendor/. WebSocket pour Top 10 temps réel.",
      details: ["index.html — Dashboard principal : classement, réseau d'amis, profil","quiz.html — Page de jeu dédiée","frontend/static/app.js — Logique principale","WebSocket ws://localhost:8000/ws/top10 pour le Top 10 en temps réel","localStorage pour mémoriser la session utilisateur","Cytoscape.js pour le graphe d'amitiés visuel","Chart.js pour la courbe de progression des scores"]
    },
    { id: "api", label: "API FastAPI", sublabel: "app/api.py · port 8000", type: "backend", x: 400, y: 230,
      description: "Backend REST complet + WebSocket. Orchestre les 3 bases via JoueurService. Documentation Swagger sur /docs. Inclut un gestionnaire d'erreurs global (500/503).",
      details: ["GET / → Sert index.html (dashboard)","GET /quiz → Sert quiz.html","GET /docs → Swagger UI","GET /api/top10 → Top 10 Redis + pseudos MongoDB","GET /api/classement?page&par_page → Classement paginé","POST /api/joueur → Créer dans les 3 bases simultanément","DELETE /api/joueur/{id} → Supprimer des 3 bases","POST /api/demande-ami → Demande d'ami (statut en_attente)","POST /api/auth/login → Connexion → JWT (12h)","POST /api/quiz/start → Démarrer une partie","GET /api/historique/{id} → Historique des parties","WS /ws/top10 → Top 10 en temps réel"]
    },
    { id: "joueur_service", label: "JoueurService", sublabel: "app/joueur_service.py", type: "service", x: 400, y: 390,
      description: "Couche d'intégration orchestrant les trois bases. Gère la cohérence transactionnelle avec rollback de compensation.",
      details: ["creer_joueur() → Mongo + Redis + Neo4j avec rollback de compensation","get_top_10_global() → Redis (Top 10 trié) + MongoDB (pseudos en $in)","get_classement_amis() → Neo4j (IDs amis) + Redis (scores) + MongoDB (pseudos)","supprimer_joueur() → Supprime des 3 bases simultanément","Résout le problème N+1 : tous les pseudos en 1 requête $in MongoDB"]
    },
    { id: "mongodb", label: "MongoDB", sublabel: "Profils · Inventaires · Historique", type: "mongodb", x: 100, y: 580,
      description: "Base documentaire NoSQL. Stocke les profils des joueurs, leurs inventaires d'objets et l'historique complet des parties. Version MongoDB 7, port 27017. Base de données : jeu_en_ligne.", dbId: "mongodb"
    },
    { id: "redis", label: "Redis", sublabel: "Scores · Classements · Sessions Quiz", type: "redis", x: 400, y: 580,
      description: "Cache/broker en mémoire. Exploite les Sorted Sets pour les classements temps-réel, les String keys JSON pour les sessions de quiz avec TTL automatique, et Pub/Sub pour notifier les WebSocket clients.", dbId: "redis"
    },
    { id: "neo4j", label: "Neo4j", sublabel: "Amis · Suggestions · Graphe", type: "neo4j", x: 700, y: 580,
      description: "Base de données graphe. Modélise le réseau social des joueurs : noeuds Joueur, relations AMI_DE avec statut (acceptee/en_attente). Exploite les algorithmes de traversal de graphe pour les suggestions d'amis.", dbId: "neo4j"
    },
    { id: "quiz_service", label: "QuizService", sublabel: "app/quiz_service.py", type: "service", x: 700, y: 390,
      description: "Logique du quiz de calcul mental. Genere des questions aleatoires (addition, soustraction, multiplication). Chronometre cote serveur. Calcule les points selon la rapidite (jusqu'a 20 pts/question).",
      details: ["NB_QUESTIONS = 10 questions par partie","TEMPS_LIMITE = 10 secondes par question","POINTS_BASE = 10 + bonus rapidite (max 20 pts/question)","Operations : +, -, x (aleatoires)","Mode 'classe' → score Redis + historique MongoDB","Mode 'entrainement' → aucune ecriture","Serialisation to_dict()/from_dict() pour Redis"]
    },
    { id: "auth_service", label: "AuthService", sublabel: "app/auth_service.py", type: "service", x: 100, y: 390,
      description: "Service d'authentification. Hash des mots de passe avec PBKDF2-SHA256 (100 000 iterations) + sel aleatoire. Genere des tokens JWT HS256 valables 12 heures.",
      details: ["PBKDF2-SHA256, 100 000 iterations","Sel aleatoire 16 bytes (secrets.token_hex(16))","Stockage : {hash, sel, algo} dans le profil MongoDB","JWT HS256 signe avec JWT_SECRET du .env","Token expire apres JWT_EXPIRE_MINUTES (defaut 720 min = 12h)","JWT_SECRET obligatoire et non-defaut au demarrage de l'API"]
    }
  ],
  connections: [
    { from: "frontend", to: "api", label: "HTTP REST + WebSocket", bidirectional: true },
    { from: "api", to: "joueur_service", label: "Orchestre", bidirectional: false },
    { from: "api", to: "auth_service", label: "Auth / JWT", bidirectional: false },
    { from: "api", to: "quiz_service", label: "Quiz", bidirectional: false },
    { from: "joueur_service", to: "mongodb", label: "Profils / Pseudos", bidirectional: false },
    { from: "joueur_service", to: "redis", label: "Scores / Top 10", bidirectional: false },
    { from: "joueur_service", to: "neo4j", label: "Amis / Graphe", bidirectional: false },
    { from: "auth_service", to: "mongodb", label: "Hash mot de passe", bidirectional: false },
    { from: "quiz_service", to: "redis", label: "Sessions (TTL 10 min)", bidirectional: false },
    { from: "api", to: "mongodb", label: "Inventaire / Historique", bidirectional: false },
    { from: "api", to: "neo4j", label: "Demandes d'ami", bidirectional: false },
    { from: "api", to: "redis", label: "Pub/Sub WebSocket", bidirectional: false }
  ],
  databases: {
    mongodb: {
      id: "mongodb", name: "MongoDB", version: "7", port: 27017, dbName: "jeu_en_ligne", containerName: "jeu_mongodb",
      color: "#00ED64", colorDark: "#00684A", icon: "🍃",
      tagline: "Base documentaire — Profils, Inventaires & Historique",
      responsible: "Siham", module: "app/services/mongo_service.py",
      description: "MongoDB stocke l'etat persistant de chaque joueur. Deux collections : joueurs (profils et inventaires) et historique_parties (toutes les parties jouees). L'ID joueur (_id) est commun aux 3 bases.",
      collections: [
        {
          id: "col_joueurs", name: "joueurs", icon: "👤",
          description: "Collection principale. Un document par joueur. Contient l'identite, le niveau de jeu et l'inventaire d'objets. Le mot de passe (optionnel) est stocke sous forme hashee.",
          indexes: ["_id (unique, cle commune aux 3 bases)"],
          role: "Profils joueurs, inventaires, authentification",
          fields: [
            { name: "_id", type: "String", pk: true, description: "Identifiant unique du joueur. Cle commune utilise dans Redis (membre du sorted set) et Neo4j (propriete id du noeud). Exemple : 'j1', 'j2'..." },
            { name: "pseudo", type: "String", description: "Nom affiche du joueur dans l'interface et le classement. Recupere via get_pseudo() ou get_pseudos() (batch $in)." },
            { name: "niveau", type: "Integer", description: "Niveau actuel du joueur (1 a 100). Modifiable via modifier_niveau() : PUT /api/niveau/{id}." },
            { name: "inventaire", type: "Array<Object>", description: "Liste d'objets possedes. Chaque objet : {objet: String, qte: Integer}. Gere avec $push, $pull, $inc." },
            { name: "inventaire[].objet", type: "String", description: "Nom de l'objet (ex: 'epee', 'potion'). Cle de recherche dans le tableau avec le filtre 'inventaire.objet'." },
            { name: "inventaire[].qte", type: "Integer", description: "Quantite possedee. Incremente avec $inc. L'objet est retire automatiquement quand qte <= 0 ($pull)." },
            { name: "mot_de_passe", type: "Object (optionnel)", description: "Absent si aucun mot de passe. Present : {hash: hex, sel: hex, algo: 'pbkdf2_sha256_100000'}." },
            { name: "mot_de_passe.hash", type: "String (hex)", description: "Empreinte hexadecimale du mot de passe hache PBKDF2-SHA256." },
            { name: "mot_de_passe.sel", type: "String (hex)", description: "Sel aleatoire 16 bytes, different par joueur." },
            { name: "mot_de_passe.algo", type: "String", description: "Algorithme utilise. Valeur fixe : 'pbkdf2_sha256_100000'." }
          ],
          operations: ["creer_profil(player_id, pseudo, niveau, inventaire, mot_de_passe)","get_profil(player_id)","get_pseudo(player_id)","get_pseudos(player_ids) — batch $in","lister_joueurs()","joueur_existe(player_id) → bool","modifier_niveau(player_id, nouveau_niveau)","ajouter_objet(player_id, objet, qte)","retirer_objet(player_id, objet, qte)","supprimer_profil(player_id)","definir_mot_de_passe(player_id, stockage)","get_mot_de_passe(player_id) → {hash, sel, algo}"]
        },
        {
          id: "col_historique", name: "historique_parties", icon: "📊",
          description: "Collection d'evenements immuables. Chaque document represente une partie jouee (mode classe uniquement). Utilisee pour afficher la courbe de progression (Chart.js) et calculer les statistiques via aggregation pipeline.",
          indexes: ["joueur_id (filtrage par joueur)", "date (tri chronologique)"],
          role: "Historique des parties, stats personnelles, courbe de progression",
          fields: [
            { name: "_id", type: "ObjectId", pk: true, description: "Identifiant MongoDB auto-genere pour chaque entree d'historique." },
            { name: "joueur_id", type: "String", fk: "joueurs._id", description: "Reference au joueur. Meme valeur que joueurs._id. Utilise comme filtre principal dans l'aggregation." },
            { name: "points", type: "Integer", description: "Points gagnes durant cette partie (0 si aucune bonne reponse, jusqu'a 200 max theorique)." },
            { name: "duree", type: "Float", description: "Duree totale de la partie en secondes (arrondi a 1 decimale)." },
            { name: "bonnes", type: "Integer", description: "Nombre de bonnes reponses sur les 10 questions." },
            { name: "date", type: "DateTime (UTC)", description: "Horodatage UTC de la partie. Utilise pour trier les parties et afficher la progression chronologique." }
          ],
          operations: ["enregistrer_partie(player_id, points, duree_secondes, nb_bonnes)","get_historique(player_id, limite=10) → parties triees par date desc","get_stats_joueur(player_id) → {nb_parties, meilleur_score, score_moyen, total_bonnes} via aggregation pipeline"],
          aggregation: { description: "Pipeline MongoDB pour statistiques agregees", steps: ["$match joueur_id","$group: $sum:1 (nb_parties), $max:$points (meilleur), $sum:$points, $sum:$bonnes"] }
        }
      ]
    },
    redis: {
      id: "redis", name: "Redis", version: "7-alpine", port: 6379, containerName: "jeu_redis",
      color: "#FF4438", colorDark: "#A41E11", icon: "🔴",
      tagline: "Cache in-memory — Scores, Classements & Sessions Quiz",
      responsible: "Oussama", module: "app/services/redis_service.py",
      description: "Redis exploite ses structures de donnees natives pour trois fonctions : Sorted Sets pour les classements temps-reel, String keys (JSON) pour les sessions de quiz avec TTL automatique, et Pub/Sub pour declencher les mises a jour WebSocket.",
      structures: [
        {
          id: "redis_sorted_set", name: "classement_global", type: "Sorted Set (ZSET)", icon: "📊",
          key: "classement_global",
          description: "Sorted Set Redis central. Chaque membre est un joueur_id, le score est son score numerique. Redis trie automatiquement par score.",
          role: "Classement mondial temps-reel, Top 10, rang individuel, classement entre amis",
          fields: [
            { name: "member", type: "String", description: "Identifiant du joueur (joueur_id). Meme valeur que MongoDB _id et Neo4j id. Exemple : 'j1', 'j2'..." },
            { name: "score", type: "Float/Integer", description: "Score du joueur. Redis stocke en float, l'application lit en int. Tri automatique ; ZREVRANGE/ZREVRANK pour ordre decroissant." }
          ],
          operations: ["ZADD classement_global {joueur_id: score}","ZSCORE classement_global joueur_id","ZINCRBY classement_global points joueur_id","ZREM classement_global joueur_id","ZREVRANGE classement_global 0 9 WITHSCORES (Top 10)","ZREVRANK classement_global joueur_id (rang 1-indexe)","ZCARD classement_global (nombre de joueurs)","ZRANGE classement_global 0 -1 WITHSCORES (tous les scores)","ZMSCORE classement_global [ids...] (batch)","ZREVRANGE avec offset/limit (pagination)"],
          characteristics: ["O(log N) pour ZADD, ZREVRANK","O(log N + M) pour ZREVRANGE","Tri automatique maintenu en permanence","Persistence sur disque (AOF/RDB selon config)"]
        },
        {
          id: "redis_quiz_session", name: "quiz:partie:<partie_id>", type: "String Key (JSON)", icon: "🎮",
          key: "quiz:partie:{uuid}",
          description: "Cle Redis de type String contenant l'etat complet d'une partie de quiz serialise en JSON. TTL de 10 minutes (QUIZ_PARTIE_TTL=600s).",
          role: "Sessions de quiz en cours, survie aux redemarrages, compatibilite multi-workers",
          fields: [
            { name: "joueur_id", type: "String", description: "Identifiant du joueur proprietaire de la partie." },
            { name: "mode", type: "String", description: "'classe' (score compte) ou 'entrainement' (sans ecriture de score ni historique)." },
            { name: "numero", type: "Integer", description: "Numero de la question en cours (0 a 10)." },
            { name: "score", type: "Integer", description: "Score cumule de la partie en cours." },
            { name: "question", type: "Object|null", description: "Question en cours : {texte: '5 + 3', reponse: 8}. null entre deux questions." },
            { name: "heure_question", type: "Float (timestamp)", description: "time.time() au moment de l'envoi de la question. Chrono cote serveur." }
          ],
          operations: ["SET quiz:partie:{id} <json> EX 600 → sauver_partie()","GET quiz:partie:{id} → charger_partie()","DEL quiz:partie:{id} → supprimer_partie()"],
          characteristics: ["TTL automatique de 600 secondes (10 min)","Persistence cote serveur (pas en memoire)","Compatible multi-workers Uvicorn","Serialise avec json.dumps / json.loads"]
        },
        {
          id: "redis_pubsub", name: "canal:scores", type: "Pub/Sub Channel", icon: "📡",
          key: "canal:scores",
          description: "Canal Pub/Sub Redis. L'API publie 'maj' sur ce canal chaque fois qu'un score change. Les diffuseurs WebSocket abonnes recoivent le signal et envoient le Top 10 frais a tous les clients connectes.",
          role: "Notification temps-reel des mises a jour de score vers les dashboards WebSocket",
          fields: [{ name: "message", type: "String", description: "Payload fixe : 'maj'. Signal simple indiquant qu'au moins un score a change." }],
          operations: ["PUBLISH canal:scores 'maj' → publier_maj_scores()","SUBSCRIBE canal:scores → souscrire_scores() (diffuseur WebSocket)"],
          characteristics: ["Pattern Publisher/Subscriber","Decouple l'ecriture de score de la diffusion WebSocket","Le diffuseur lit ensuite get_top_10() pour envoyer les donnees fraiches"]
        }
      ]
    },
    neo4j: {
      id: "neo4j", name: "Neo4j", version: "5", ports: { http: 7474, bolt: 7687 }, containerName: "jeu_neo4j",
      color: "#018BFF", colorDark: "#0054A4", icon: "🕸️",
      tagline: "Base graphe — Reseau social & Recommandations",
      responsible: "Salma", module: "app/services/neo4j_service.py",
      description: "Neo4j modelise le reseau social des joueurs comme un graphe de proprietes. Chaque joueur est un noeud, chaque amitie est une relation AMI_DE. Les traversals de graphe permettent de trouver les amis d'amis et de calculer les amis communs en une seule requete Cypher.",
      nodes: [
        {
          id: "node_joueur", name: "Joueur", label: "(:Joueur)", icon: "👤",
          description: "Noeud central du graphe. Represente un joueur du jeu. L'id est commun aux 3 bases.",
          constraint: "CREATE CONSTRAINT joueur_id IF NOT EXISTS FOR (j:Joueur) REQUIRE j.id IS UNIQUE",
          role: "Noeud de base du graphe social",
          properties: [
            { name: "id", type: "String", pk: true, description: "Identifiant unique. MEME valeur que MongoDB _id et Redis member. Contrainte d'unicite + index automatique." },
            { name: "pseudo", type: "String", description: "Nom affiche du joueur. Synchronise avec MongoDB pseudo. Utilise dans les resultats de traversal graphe." }
          ],
          operations: ["MERGE (j:Joueur {id: $id}) SET j.pseudo = $pseudo → creer_noeud()","MATCH (j:Joueur {id: $id}) DETACH DELETE j → supprimer_noeud()"]
        }
      ],
      relationships: [
        {
          id: "rel_ami_de", name: "AMI_DE", pattern: "(:Joueur)-[:AMI_DE]->(:Joueur)", icon: "🤝",
          description: "Relation d'amitie entre deux joueurs. Stockee dans un seul sens (directed) mais lue sans direction pour l'amitie confirmee. Le statut 'en_attente' utilise la direction : demandeur → cible.",
          role: "Reseau social, demandes d'ami, suggestions (amis d'amis)",
          properties: [
            { name: "statut", type: "String (optionnel)", description: "Absent ou 'acceptee' = amitie confirmee. 'en_attente' = demande en attente. Filtre : coalesce(r.statut, 'acceptee') = 'acceptee'." }
          ],
          statuses: [
            { value: "acceptee", description: "Amitie confirmee. Relations sans statut sont aussi considerees comme acceptees (retrocompatibilite)." },
            { value: "en_attente", description: "Demande envoyee par le demandeur, pas encore acceptee/refusee par la cible." }
          ],
          operations: ["CREATE (a)-[:AMI_DE]->(b) → ajouter_ami()","DELETE r → supprimer_ami()","MATCH -[r:AMI_DE]- WHERE statut='acceptee' → get_amis()","Path 2 hops → get_amis_d_amis() (suggestions)","CREATE [:AMI_DE {statut:'en_attente'}] → demander_ami()","SET r.statut = 'acceptee' → accepter_demande()","DELETE r WHERE statut='en_attente' → refuser_demande()"]
        }
      ],
      cypher_examples: [
        {
          name: "Amis d'amis (suggestions)",
          query: "MATCH (p:Joueur {id:$id})-[r1:AMI_DE]-(:Joueur)-[r2:AMI_DE]-(fof:Joueur)\nWHERE coalesce(r1.statut,'acceptee')='acceptee'\n  AND coalesce(r2.statut,'acceptee')='acceptee'\n  AND fof <> p AND NOT (p)-[:AMI_DE]-(fof)\nRETURN fof.id, fof.pseudo, count(*) AS amis_communs\nORDER BY amis_communs DESC LIMIT $limite",
          description: "Trouve les amis d'amis non encore amis, tries par nombre d'amis communs decroissant."
        },
        {
          name: "Accepter une demande",
          query: "MATCH (:Joueur {id:$de})-[r:AMI_DE]->(:Joueur {id:$vers})\nWHERE r.statut = 'en_attente'\nSET r.statut = 'acceptee'\nRETURN r.statut",
          description: "Change le statut de la relation de 'en_attente' a 'acceptee'."
        }
      ]
    }
  },
  dataFlows: [
    {
      id: "flow_create_player", name: "Creer un joueur", endpoint: "POST /api/joueur",
      steps: [
        { db: "none", action: "API recoit {id, pseudo, niveau, score, mot_de_passe}", icon: "📥" },
        { db: "mongodb", action: "mongo.creer_profil() → insert_one({_id, pseudo, niveau, inventaire: [], mot_de_passe?})", icon: "🍃" },
        { db: "redis", action: "redis.set_score(joueur_id, score) → ZADD classement_global", icon: "🔴" },
        { db: "neo4j", action: "neo4j.creer_noeud(joueur_id, pseudo) → MERGE (:Joueur {id, pseudo})", icon: "🕸️" },
        { db: "none", action: "Rollback de compensation si une base echoue", icon: "🔄" }
      ]
    },
    {
      id: "flow_top10", name: "Top 10 Global", endpoint: "GET /api/top10",
      steps: [
        { db: "redis", action: "ZREVRANGE classement_global 0 9 WITHSCORES → 10 (joueur_id, score)", icon: "🔴" },
        { db: "mongodb", action: "find({_id: {$in: [ids...]}}, {pseudo:1}) → pseudos en 1 requete", icon: "🍃" },
        { db: "none", action: "Merge et retourne [{rang, id, nom, score}]", icon: "📤" }
      ]
    },
    {
      id: "flow_friends_ranking", name: "Classement entre amis", endpoint: "GET /api/classement-amis/{id}",
      steps: [
        { db: "neo4j", action: "get_ids_amis(joueur_id) → MATCH -[:AMI_DE]- → liste d'IDs", icon: "🕸️" },
        { db: "redis", action: "ZMSCORE classement_global [ids...] → scores batch", icon: "🔴" },
        { db: "mongodb", action: "find({$in: ids}) → pseudos batch", icon: "🍃" },
        { db: "none", action: "Tri par score + retour [{rang, id, nom, score}]", icon: "📤" }
      ]
    },
    {
      id: "flow_quiz", name: "Session de Quiz", endpoint: "POST /api/quiz/start → /answer",
      steps: [
        { db: "none", action: "Authentification JWT ou mode heritage", icon: "🔑" },
        { db: "redis", action: "SET quiz:partie:{uuid} {etat_initial} EX 600 → session stockee", icon: "🔴" },
        { db: "redis", action: "GET quiz:partie:{uuid} → charger etat a chaque reponse", icon: "🔴" },
        { db: "redis", action: "ZINCRBY classement_global points joueur_id → score final", icon: "🔴" },
        { db: "redis", action: "PUBLISH canal:scores 'maj' → notifie WebSocket", icon: "📡" },
        { db: "mongodb", action: "historique_parties.insert_one({...}) → historique sauvegarde", icon: "🍃" },
        { db: "redis", action: "DEL quiz:partie:{uuid} → session nettoyee", icon: "🔴" }
      ]
    }
  ]
};