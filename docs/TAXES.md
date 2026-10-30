# Taxes de vente par province · Sales taxes by province (`lib/foodhub/taxes.ts`)

ON2GO et Food Hub servent le Canada seulement, le Québec d'abord (ordre du propriétaire, 2026-10-29). Une seule table
fixe les taxes de vente sur la nourriture préparée pour les 13 provinces et territoires ; tout ce qui chiffre une
commande s'en sert.

| Province | Taxes sur un repas | Taux | Libellé client (FR / EN) |
|---|---|---|---|
| QC | TPS 5 % + TVQ 9,975 % | 14,975 % | Taxes (TPS + TVQ) / Taxes (GST + QST) |
| ON | TVH 13 % | 13 % | Taxes (TVH) / Taxes (HST) |
| NS | TVH 14 % | 14 % | Taxes (TVH) / Taxes (HST) |
| NB, NL, PE | TVH 15 % | 15 % | Taxes (TVH) / Taxes (HST) |
| MB | TPS 5 % + TVD 7 % | 12 % | Taxes (TPS + TVD) / Taxes (GST + RST) |
| SK | TPS 5 % + TVP 6 % | 11 % | Taxes (TPS + TVP) / Taxes (GST + PST) |
| BC | TPS 5 % (la TVP de 7 % ne s'applique pas aux repas de restaurant) | 5 % | Taxes (TPS) / Taxes (GST) |
| AB, YT, NT, NU | TPS 5 % | 5 % | Taxes (TPS) / Taxes (GST) |

Sources : canada.ca (taux TPS/TVH), revenuquebec.ca (TVQ), la page de chaque province pour sa TVP/TVD. Vérifier à chaque
changement de budget provincial ; les taux sont dans `PROVINCE_TAXES`, rien d'autre à toucher.

## Où la province vient · Where the province comes from
- **Cuisine** (Réglages → Entreprise → succursale) : champ *Province* ; vide = déduite du code postal (première lettre :
  H → QC, M → ON, V → BC…), sinon Québec. `locationProvince()`.
- **Cuisines de l'annuaire** (`DIRECTORY_SEED.kitchens`) : leur `address.region`.
- **Formulaire restaurateur** (on2go.ca → `POST /api/public/restaurant-leads`) : clé `province` (docs/RESTAURANT_LEADS.md).

## Qui s'en sert · Who uses it
- `totalsFor()` (`lib/foodhub/delivery/orders.ts`) : sous-total, taxes, total d'une commande directe ; la province de la
  cuisine est passée par `createDirectOrder`. Chaque composante est arrondie au cent sur la base (la TVQ ne se calcule pas
  sur la TPS).
- Vitrine `/commander/<slug>` et ON2GO.ca : le menu public porte `taxes { province, rate, label }` ; le panier affiche
  le taux et le libellé de la province avant que le serveur ne chiffre.
- Livraison (DoorDash Drive, Uber Direct, Skip, nos coursiers) : l'adresse de ramassage porte la province de la cuisine.
- Finance : `splitQuebecTax()` reste pour les relevés du Québec et délègue à `splitFoodTax('QC', …)`.
- Téléphone IA : encore Québec par défaut (les lignes téléphoniques sont au Québec) ; à brancher sur la cuisine de la
  ligne quand une ligne hors Québec existera.

Clover garde ses propres taux pour sa page de paiement (`lib/foodhub/pos/clover-checkout.ts` lit les taux du marchand) :
ils doivent correspondre à la province de la cuisine, sinon la page Clover facturerait un autre total.

— signé : Claude Fable 5.1 (session on2go front-page) @ Claude Code desktop · 2026-10-30 05:30
