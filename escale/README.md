# ✈️ Escale – agent IA pour choisir ses vacances (extension Chrome)

L'extension s'ouvre dans un panneau sur le côté de Chrome. L'utilisateur clique sur **« Analyser cette page »** quand il regarde un hôtel, un Airbnb, un vol ou un blog voyage. L'agent :

1. lit la page ouverte,
2. vérifie lui-même la **météo réelle** de la période (outil `get_weather`, données Open-Meteo),
3. lit le **guide Wikivoyage** de la destination (quartiers, que voir, budget, sécurité),
4. donne son avis, propose des alternatives et répond aux questions de suivi.

**3 analyses gratuites**, puis un écran de paiement (« Débloquer 5 analyses – 2,99 $ »).

## Structure

```
escale/
├── extension/        ← l'extension Chrome (ce que l'utilisateur installe)
│   ├── manifest.json
│   ├── background.js
│   ├── sidepanel.html / .css / .js
└── server/           ← le serveur (garde la clé API secrète + compte les analyses)
    ├── server.js     ← API + compteur d'analyses gratuites
    ├── agent.js      ← l'agent (Gemini + boucle d'outils)
    ├── tools.js      ← outils gratuits : météo (Open-Meteo), guides (Wikivoyage)
    └── .env          ← ta configuration (clé API)
```

Pourquoi un serveur ? Une clé API mise dans une extension peut être copiée par n'importe qui. Le serveur la garde secrète et empêche de tricher sur le nombre d'analyses gratuites.

## Lancer en local

**1. Clé API Gemini (gratuite)**
Crée une clé sur https://aistudio.google.com/apikey (compte Google), puis colle-la dans `server/.env` :
```
GEMINI_API_KEY=...
```

**2. Démarrer le serveur**
```bash
cd server
npm start
```

**3. Installer l'extension dans Chrome**
- Va sur `chrome://extensions`
- Active le **Mode développeur** (en haut à droite)
- Clique sur **Charger l'extension non empaquetée** et choisis le dossier `extension`
- Épingle l'icône Escale, ouvre une page de voyage et clique dessus

Pour remettre les analyses gratuites à zéro pendant les tests, supprime `server/usage.json`.

## IA gratuite : ce qu'il faut savoir

L'agent utilise **Gemini** avec l'offre gratuite de Google : 0 € d'IA, et la météo et Wikivoyage sont gratuits aussi.

- **Limites** : l'offre gratuite plafonne le nombre de requêtes par minute et par jour. C'est parfait pour développer et tester, mais insuffisant dès qu'il y a beaucoup d'utilisateurs.
- **Données** : avec l'offre gratuite, Google peut utiliser les contenus envoyés pour améliorer ses produits, et des humains peuvent les relire.
- **Europe / Royaume-Uni / Suisse** : les conditions de Gemini imposent l'offre **payante** pour une application proposée à des utilisateurs dans ces pays. Avant de publier, il faudra activer la facturation sur ta clé. Les modèles Flash font partie des moins chers : vérifie les tarifs sur https://ai.google.dev/gemini-api/docs/pricing.

Pour changer de modèle, modifie `GEMINI_MODEL` dans `server/.env`.

## Ce qui reste à faire avant de publier

- [ ] **Paiement** : brancher ExtensionPay (Stripe) sur le bouton « Débloquer », et créditer `paidCredits` côté serveur
- [ ] **Héberger le serveur** (Render, Railway, Google Cloud Run…) puis remplacer `http://localhost:8787` dans `extension/sidepanel.js` et `manifest.json`
- [ ] **Base de données** au lieu de `usage.json` et des conversations en mémoire
- [ ] **Icônes** (16, 48 et 128 px) + captures d'écran pour le Chrome Web Store
- [ ] **Politique de confidentialité** (obligatoire : l'extension lit le contenu des pages)
- [ ] Compte développeur Chrome Web Store (environ 5 $, payé une seule fois)
