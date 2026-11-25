# Architecture détaillée — Arena / Jeu en ligne

Ce document décrit l'architecture actuelle du projet : client web statique, API FastAPI, services métier, trois bases NoSQL, temps réel, déploiement et tests.

## 1. Vue d'ensemble des composants

```mermaid
flowchart TB
    Joueur((Joueur))
    Admin((Administrateur))

    subgraph WEB["Client navigateur — frontend/"]
        Pages["SPA Dashboard par hash + page Quiz autonome<br/>HTML · CSS · interfaces responsive"]
        App["app.js<br/>Navigation · appels API · profils · tiroirs"]
        AuthUI["auth.js<br/>Connexion · JWT · localStorage arena_session"]
        SocialUI["social.js + reseau.js<br/>Mon espace · graphes Cytoscape · demandes d'ami"]
        RankUI["leaderboard.js<br/>Podium · pagination · classements"]
        QuizUI["quiz.js<br/>Questions · progression · réponses"]
        Notifications["notifications.js<br/>WebSocket · reconnexion exponentielle jusqu'à 30 s"]
        Enhancements["charts.js + premium.js<br/>Chart.js · animations d'interface"]
        Librairies["Bibliothèques et polices sans CDN<br/>Cytoscape 3.30.2 · Chart.js 4.4.3 · Lucide 0.460.0<br/>Inter · Sora · JetBrains Mono"]
    end

    subgraph API["Backend FastAPI — app/api.py"]
        Static["FastAPI StaticFiles<br/>GET / · GET /quiz · /static<br/>Documentation /docs · /redoc"]
        AuthAPI["Authentification<br/>POST /api/auth/login<br/>POST /api/auth/mot-de-passe"]
        PlayersAPI["Joueurs et profils<br/>GET /api/joueurs · GET /api/joueur/{id}<br/>POST /api/joueur · DELETE /api/joueur/{id}<br/>PUT /api/niveau/{id}"]
        InventoryAPI["Inventaire et historique<br/>POST /api/objet/{id} · DELETE /api/objet/{id}<br/>GET /api/historique/{id}<br/>GET /api/stats-joueur/{id}"]
        RankingAPI["Classements<br/>GET /api/top10 · GET /api/classement<br/>GET /api/classement-autour/{id}<br/>GET /api/classement-amis/{id}"]
        SocialAPI["Réseau social<br/>GET /api/graphe · GET /api/amis/{id}<br/>GET /api/amis-damis/{id} · GET /api/social/{id}<br/>POST/DELETE /api/ami · POST /api/demande-ami*"]
        QuizAPI["Quiz<br/>POST /api/quiz/start<br/>POST /api/quiz/answer"]
        WSAPI["WebSocket sans authentification<br/>/ws/top10 · événements top10 / social / activite<br/>Connexions suivies en mémoire, non partagées entre workers"]
        SystemAPI["Système et statistiques<br/>GET /health · GET /api/stats"]
        Security["Dépendances de sécurité<br/>JWT Bearer · X-Admin-Key<br/>contrôle du propriétaire"]
    end

    subgraph LOGIC["Services métier et adaptateurs — app/"]
        JoueurService["JoueurService<br/>Orchestration des trois bases"]
        AuthService["AuthService<br/>PBKDF2-SHA256 100 000 itérations<br/>JWT HS256 · expiration 12 h par défaut"]
        QuizService["QuizService<br/>Sessions · chrono serveur · calcul des points"]
        MongoService["mongo_service.py<br/>Profils · inventaires · historique"]
        RedisService["redis_service.py<br/>Scores · classements · sessions · Pub/Sub"]
        Neo4jService["neo4j_service.py<br/>Amitiés · invitations · suggestions"]
    end

    subgraph DATA["Persistance NoSQL"]
        Mongo[("MongoDB<br/>Documents joueurs")]
        Redis[("Redis<br/>Sorted sets · clés TTL · Pub/Sub")]
        Neo4j[("Neo4j<br/>Graphe social")]
    end

    Config["config.py + .env<br/>URLs · identifiants · JWT_SECRET"]

    Joueur -->|"HTTP :8000"| Static
    Admin -->|"HTTP :8000"| Static
    Static -->|"HTML / CSS / JS"| Pages
    Pages --> App
    App --> AuthUI
    App --> SocialUI
    App --> RankUI
    App --> QuizUI
    App --> Notifications
    App --> Enhancements
    Librairies -.-> SocialUI
    Librairies -.-> RankUI
    Librairies -.-> Enhancements

    AuthUI -->|"REST"| AuthAPI
    App -->|"REST"| PlayersAPI
    App -->|"REST"| InventoryAPI
    RankUI -->|"REST"| RankingAPI
    SocialUI -->|"REST"| SocialAPI
    QuizUI -->|"REST"| QuizAPI
    App -->|"REST"| SystemAPI
    Notifications -->|"WebSocket"| WSAPI

    Security -.->|"selon la route"| AuthAPI
    Security -.->|"selon la route"| SocialAPI
    Security -.->|"selon la route"| QuizAPI

    AuthAPI --> AuthService
    AuthAPI --> MongoService
    PlayersAPI --> JoueurService
    PlayersAPI --> MongoService
    PlayersAPI --> RedisService
    PlayersAPI --> Neo4jService
    InventoryAPI --> MongoService
    RankingAPI --> JoueurService
    RankingAPI --> MongoService
    RankingAPI --> RedisService
    SocialAPI --> Neo4jService
    SocialAPI --> MongoService
    SocialAPI --> RedisService
    QuizAPI --> QuizService
    QuizAPI --> RedisService
    QuizAPI --> MongoService
    SystemAPI --> MongoService
    SystemAPI --> RedisService
    WSAPI --> RedisService

    JoueurService --> MongoService
    JoueurService --> RedisService
    JoueurService --> Neo4jService

    MongoService -->|"PyMongo · :27017"| Mongo
    RedisService -->|"redis-py · :6379"| Redis
    Neo4jService -->|"Bolt · :7687"| Neo4j

    Config -.-> Static
    Config -.-> MongoService
    Config -.-> RedisService
    Config -.-> Neo4jService

    classDef client fill:#17233f,stroke:#6fa7e8,color:#f5f3ec;
    classDef api fill:#241d38,stroke:#b4a8f5,color:#f5f3ec;
    classDef service fill:#132c27,stroke:#4cc38a,color:#f5f3ec;
    classDef database fill:#302516,stroke:#f2b03d,color:#f5f3ec;
    classDef config fill:#262a34,stroke:#8a8fa3,color:#f5f3ec;
    linkStyle default stroke-dasharray: 9 5,stroke-dashoffset: 900,animation: dash 25s linear infinite;
    class Joueur,Admin,Pages,App,AuthUI,SocialUI,RankUI,QuizUI,Notifications,Enhancements,Librairies client;
    class Static,AuthAPI,PlayersAPI,InventoryAPI,RankingAPI,SocialAPI,QuizAPI,WSAPI,SystemAPI,Security api;
    class JoueurService,AuthService,QuizService,MongoService,RedisService,Neo4jService service;
    class Mongo,Redis,Neo4j database;
    class Config config;
```

## 2. Authentification et déroulement d'un quiz

```mermaid
sequenceDiagram
    autonumber
    participant U as Navigateur
    participant API as FastAPI
    participant Auth as AuthService
    participant M as MongoDB
    participant Quiz as API quiz + QuizService
    participant R as Redis
    participant WS as WebSocket /ws/top10

    U->>API: POST /api/auth/login (id, mot_de_passe)
    API->>M: Lire le hash et le sel du joueur
    M-->>API: Document joueur
    alt Compte protégé par mot de passe
        API->>Auth: Vérifier PBKDF2-SHA256
        Auth-->>API: Identité validée
        API-->>U: JWT HS256 + session à mémoriser
    else Joueur seed sans mot de passe
        API-->>U: token null + mode héritage
    end

    U->>API: POST /api/quiz/start (Bearer, mode)
    API->>API: Authentifier et vérifier le joueur
    API->>Quiz: Créer une partie
    Quiz->>R: Enregistrer la session avec TTL
    R-->>Quiz: Session persistée
    Quiz-->>API: Questions et identifiant de partie
    API-->>U: Première question + temps_limite

    loop 10 questions
        U->>API: POST /api/quiz/answer (partie_id, réponse)
        API->>Quiz: Valider la session et le chrono
        Quiz->>R: Lire et mettre à jour la session
        R-->>Quiz: État de la partie
        Quiz->>Quiz: Calculer justesse, rapidité et points
        opt Bonne réponse en mode classe
            Quiz->>R: ZINCRBY du score + PUBLISH canal:scores
        end
        Quiz-->>API: Résultat de la réponse
        API-->>U: Correction + progression + question suivante
    end

    Note over Quiz,R: canal:scores n'a pas d'abonné, le Top 10 est rediffusé à la fin de partie

    U->>API: POST /api/quiz/answer (dernière réponse)
    API->>Quiz: Terminer la partie
    alt Mode classe
        Quiz->>M: Ajouter le résultat à l'historique
        Quiz->>R: Supprimer la session de quiz
        API->>WS: Diffuser top10 / activite en tâche de fond
        WS-->>U: Message activity / top10
    else Mode entraînement
        Quiz->>R: Supprimer la session de quiz
        API->>WS: Diffuser le Top 10 en tâche de fond
        Note over Quiz,R: Aucun score ni historique en mode entraînement
    end
    API-->>U: Bilan, score total et record personnel
```

## 3. Profil, réseau social et invitations

```mermaid
sequenceDiagram
    autonumber
    participant U as Navigateur
    participant API as FastAPI
    participant M as MongoDB
    participant R as Redis
    participant N as Neo4j
    participant CY as Cytoscape.js

    U->>API: GET /api/joueur/{id}
    par Agrégation du profil
        API->>M: Profil et inventaire
        M-->>API: Document joueur
    and
        API->>R: Score et rang mondial
        R-->>API: Score + rang
    and
        API->>N: Amis directs
        N-->>API: Liste d'amis
    end
    API-->>U: Profil public agrégé

    U->>API: GET /api/historique/{id}
    API->>M: Lire l'historique des parties
    M-->>API: Parties du joueur
    API-->>U: Historique pour le graphique Chart.js

    U->>API: GET /api/graphe
    par Données du graphe
        API->>N: Joueurs, amitiés et relations en attente
        N-->>API: Nœuds et arêtes
    and
        API->>M: Pseudos et niveaux
        M-->>API: Attributs des joueurs
    and
        API->>R: Scores des joueurs
        R-->>API: Scores pour dimensionner les nœuds
    end
    API-->>U: Éléments du graphe
    U->>CY: Construire le réseau égo-centré
    CY->>CY: Positions preset + resize + fit
    CY-->>U: Joueur au centre, amis et suggestions

    U->>API: GET /api/social/{id} (Bearer si compte protégé)
    API->>API: Vérifier le JWT du propriétaire ou accepter le mode héritage
    API->>M: Profil privé
    API->>R: Score et rang
    API->>N: Amis, suggestions et demandes en attente
    API-->>U: Données de Mon espace

    U->>API: POST /api/demande-ami (id_de, id_vers)
    API->>N: Créer AMI_DE avec statut en_attente
    N-->>API: Demande enregistrée
    API-->>U: Invitation envoyée

    U->>API: POST /api/demande-ami/accepter (id_de, id_vers)
    API->>N: Passer la relation à acceptee
    N-->>API: Amitié confirmée
    API-->>U: Ami ajouté et graphe à rafraîchir
```

## 4. Opérations transversales entre les trois bases

```mermaid
sequenceDiagram
    autonumber
    participant U as Navigateur
    participant API as FastAPI
    participant S as JoueurService
    participant M as MongoDB
    participant R as Redis
    participant N as Neo4j

    U->>API: POST /api/joueur (id, pseudo, niveau, score)
    API->>S: creer_joueur(id, pseudo, niveau, score)
    S->>M: Créer le profil
    S->>R: Enregistrer le score
    S->>N: Créer le nœud Joueur
    alt Les trois écritures réussissent
        API-->>U: Joueur créé
    else Redis échoue
        S->>M: Supprimer le profil
        API-->>U: Erreur, profil compensé
    else Neo4j échoue
        S->>M: Supprimer le profil
        S->>R: Supprimer le score
        API-->>U: Erreur, profil et score compensés
    end

    U->>API: GET /api/classement-amis/{id}
    API->>M: Vérifier que le joueur existe
    API->>N: Lire les identifiants de ses amis
    API->>R: ZMSCORE sur les amis et le joueur
    R-->>API: Scores à trier
    API->>M: Récupérer les pseudos
    API-->>U: Classement entre amis trié

    U->>API: DELETE /api/joueur/{id}
    API->>S: supprimer_joueur(id)
    S->>M: Supprimer le profil
    S->>R: Retirer le membre du classement
    S->>N: DETACH DELETE du nœud et de ses relations
    API-->>U: Joueur supprimé des trois bases
    Note over S,M: Pas de transaction distribuée ni de rollback sur la suppression
```

## 5. Répartition des données entre les trois bases

```mermaid
flowchart LR
    subgraph MONGO["MongoDB — source des profils"]
        MJ[("Collection joueurs")]
        MDoc["Document joueur<br/>_id · pseudo · niveau · inventaire[]<br/>mot_de_passe: hash · sel · algo"]
        MH[("Collection historique_parties")]
        HDoc["Partie<br/>joueur_id · points · duree · bonnes · date"]
        MJ --- MDoc
        MH --- HDoc
        MDoc -.->|"joueur_id"| HDoc
    end

    subgraph REDIS["Redis — scores et état temps réel"]
        RRank[("classement_global<br/>ZSET : membre = id, score = points")]
        RQuiz[("quiz:partie:{id}<br/>Session de quiz · TTL 600 s")]
        RPub["Pub/Sub canal:scores<br/>Publication des scores<br/>aucun abonné actuel"]
    end

    subgraph NEO4J["Neo4j — source des relations sociales"]
        NJ["Nœud Joueur<br/>id · pseudo"]
        Amitie["Relation AMI_DE<br/>statut = acceptee"]
        Attente["Relation AMI_DE<br/>statut = en_attente"]
        NJ -->|"amitié confirmée"| Amitie
        NJ -->|"invitation"| Attente
        Amitie --> NJ
        Attente --> NJ
    end

    MDoc -.->|"même identifiant joueur"| NJ
    RRank -.->|"membre = _id"| MDoc
    RQuiz -.->|"joueur_id"| MDoc
    Attente -.->|"traversée AMI_DE<br/>amis d'amis"| NJ

    classDef mongo fill:#173329,stroke:#4cc38a,color:#f5f3ec;
    classDef redis fill:#35251d,stroke:#ef7b61,color:#f5f3ec;
    classDef neo4j fill:#1d2b3c,stroke:#6fa7e8,color:#f5f3ec;
    linkStyle default stroke-dasharray: 9 5,stroke-dashoffset: 900,animation: dash 25s linear infinite;
    class MJ,MDoc,MH,HDoc mongo;
    class RRank,RQuiz,RPub redis;
    class NJ,Amitie,Attente neo4j;
```

## 6. Déploiement, exploitation et qualité

```mermaid
flowchart TB
    Dev["Développeur"] -->|"docker compose up --build"| Compose["Docker Compose<br/>Réseau par défaut · restart unless-stopped"]
    CI["GitHub Actions<br/>Python 3.12 · services NoSQL<br/>push / PR vers main"] -->|"pytest tests/ -v"| Tests

    subgraph DOCKER["Réseau Docker"]
        API["Service api<br/>Python 3.12-slim · FastAPI · Uvicorn<br/>HTTP / WebSocket :8000"]
        Mongo[("MongoDB 7<br/>:27017")]
        Redis[("Redis 7-Alpine<br/>:6379")]
        Neo4j[("Neo4j 5<br/>Bolt :7687 · Browser :7474")]
        Volumes["Volumes nommés<br/>mongo_data · redis_data · neo4j_data"]
    end

    subgraph QUALITE["Outils et points d'entrée"]
        Tests["77 tests pytest<br/>Mongo · Redis · Neo4j · API · quiz<br/>intégration tri-base · nouveautés sociales<br/>Aucun test E2E ou lint frontend"]
        Seed["scripts/seed_data.py<br/>10 joueurs, scores et amitiés de démonstration"]
        Console["python -m app.main<br/>Menu console et mode démo"]
    end

    Navigateur["Navigateur"] -->|"HTTP :8000<br/>WS /ws/top10"| API
    API -->|"PyMongo"| Mongo
    API -->|"redis-py"| Redis
    API -->|"Bolt"| Neo4j
    Mongo --- Volumes
    Redis --- Volumes
    Neo4j --- Volumes
    Seed --> Mongo
    Seed --> Redis
    Seed --> Neo4j
    Console --> Mongo
    Console --> Redis
    Console --> Neo4j

    Env[".env / environnement de l'API<br/>MONGO_URL · MONGO_DB · REDIS_URL<br/>NEO4J_URL / USER / PASSWORD<br/>JWT_SECRET obligatoire · ADMIN_TOKEN optionnel<br/>JWT_EXPIRE_MINUTES · QUIZ_PARTIE_TTL"] -.-> API
    Health["Healthchecks MongoDB / Redis / Neo4j<br/>API depends_on: service_healthy<br/>GET /health non utilisé comme healthcheck"] -.-> Compose

    classDef app fill:#17233f,stroke:#6fa7e8,color:#f5f3ec;
    classDef data fill:#302516,stroke:#f2b03d,color:#f5f3ec;
    classDef tool fill:#262a34,stroke:#8a8fa3,color:#f5f3ec;
    linkStyle default stroke-dasharray: 9 5,stroke-dashoffset: 900,animation: dash 25s linear infinite;
    class Dev,CI,Compose,API,Navigateur,Env,Health app;
    class Mongo,Redis,Neo4j,Volumes data;
    class Tests,Seed,Console tool;
```
