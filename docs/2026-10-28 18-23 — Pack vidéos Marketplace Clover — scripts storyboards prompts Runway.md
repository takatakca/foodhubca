# 2026-10-28 18:23 — Pack vidéos Marketplace Clover — Scripts, storyboards et prompts Runway — Standard LUXE TAKATAK

**Commande :** Matt, 2026-10-28 18:22 — « crée des vidéos avec les autres IA, prépare-moi les tools — ça doit être quelque chose de LUXE qui représente vraiment TAKATAK (takatak.ca), le meilleur des meilleurs. »
**Portée :** 13 films prêts à produire — 1 film maître « TAKATAK — le système » + les 12 applications Clover en brouillon (production, Developer ID 9KJ25ATT15TTW). Food Hub 629HFYHNVMZYR et Phone AI 20FK28P20HJC6 sont **EN RÉVISION** : aucune modification de fiche — voir la section 16, « prêt à produire, à appliquer après approbation Clover ».
**Matière première :** base API « Clover API — Main Stuff — Robot Notepad » (2026-10-28 17:45, 67 entrées) + packages de soumission `~/workspace/clover-apps/`. Les fonctions montrées dans chaque film sont uniquement celles du mapping Base/Premium/VIP de l'app.
**Aucun secret dans ce document.** Aucun prix d'app affiché dans les vidéos (les paliers 50/100/150 $ vivent dans la fiche texte du portail, jamais à l'image). Aucun numéro de téléphone personnel : le seul contact autorisé à l'écran est +1 450-999-4999 (téléphone restaurants) — et en pratique, les films se terminent sur **takatak.ca**.

---

# 1. CHARTE ARTISTIQUE LUXE TAKATAK (s'applique aux 13 films, sans exception)

**Positionnement.** TAKATAK n'est pas « un fournisseur d'apps ». C'est la maison qui équipe les meilleurs restaurants de Montréal. Chaque film doit donner l'impression d'une marque de luxe technologique : calme, précise, assurée. Jamais d'agitation, jamais de couleurs criardes, jamais d'humour de bas étage.

**Palette.** Noir profond (#0B0B0D) et or TAKATAK (dégradé #C9A227 → #E8C766), blanc cassé pour les textes. Les décors générés portent la même signature : comptoirs sombres, laiton et bois foncé, lumière chaude rasante, reflets dorés. Le rouge/vert des statuts n'apparaît que dans les écrans filmés au montage, jamais dans les plans générés.

**Lumière et caméra.** Lumière de fin de journée (« golden hour ») ou éclairage restaurant haut de gamme ; profondeur de champ faible ; mouvements lents et amples (travelling, arc, push-in) ; objectif 35 mm. Aucun plan tremblé, aucun zoom brusque, aucun effet « stock cheap ».

**Typographie (montage seulement — jamais générée dans l'image).** Titres en capitales, graisse moyenne, interlettrage large, blanc cassé ou or, toujours dans le tiers supérieur ou inférieur avec espace négatif prévu au cadrage. Sous-titres FR et EN en fichiers SRT séparés + version sous-titrée incrustée pour le portail. Police : la police système propre du montage (type Inter/Helvetica Now), jamais de police fantaisie.

**Rythme.** 30 à 45 secondes par film. Plans de 5 à 7 secondes, fondu enchaîné doré de 8 images entre les plans, ouverture sur un plan d'ambiance (jamais un écran d'emblée), fermeture sur le plan signature : le terminal Clover sur le comptoir, lumière or, puis carte de fin noire « <NOM DE L'APP> by TAKATAK — takatak.ca » ajoutée au montage.

**Voix.** Voix off enregistrée via **ElevenLabs** (compte TAKATAK, session confirmée 2026-10-26) : voix FR au français québécois neutre et posé, voix EN nord-américaine calme ; débit ~140 mots/min ; aucune voix robotique par défaut. Le texte intégral de chaque voix off est écrit dans ce pack (FR + EN) — production = lecture directe, aucune réécriture libre.

**Musique.** Bande originale générée via **Suno** (compte TAKATAK) : un seul thème maître pour les 13 films — piano feutré, contrebasse douce, pulsation électronique discrète, ~90 BPM, décliné en version 45 s (film maître) et 35 s (films d'app). Mixage : musique à −18 dB sous la voix.

**Interdits visuels absolus (tous les prompts les portent).** Aucun texte lisible, aucun logo, aucun prix, aucun menu lisible, aucune enseigne inventée dans les images générées ; aucun vrai numéro de carte ; aucun visage identifiable de vraie personne ; aucune plaque/adresse réelle. Les écrans d'app montrés sont des captures de la vraie app (sandbox) intégrées au montage — jamais des écrans inventés par l'IA vidéo.

**Vignettes (thumbnails).** Un plan-clé du film (frame la plus « comptoir + or »), assombri à 70 %, titre d'app en capitales or ajouté au montage, déclinée 1920×1080 (16:9) et 1080×1080 (1:1). Concept précisé par film.

# 2. SPÉCIFICATIONS TECHNIQUES (export Clover Marketplace)

| Élément | Spécification |
|---|---|
| Master | MP4 (H.264), 1920×1080 (16:9), 30 fps, débit ~16 Mb/s |
| Déclinaison carrée | MP4 (H.264), 1080×1080 (1:1), 30 fps — recadrage centré du master |
| Durée | 30–45 s par film (film maître : 45 s) |
| Audio | AAC 48 kHz, voix intégrée à −14 LUFS, musique −18 dB sous la voix |
| Génération | Runway Gen-4, plans de 5 ou 10 s, 16:9, 1080p, un prompt par plan (section par film) |
| Assemblage | Montage : plans Runway + captures d'écran réelles de l'app (sandbox) + cartes de titre/fin + voix ElevenLabs + musique Suno |
| Contrôle qualité | Twelve Labs (indexation/analyse) : vérification d'absence de texte parasite, de logo inventé et de prix avant livraison |
| Fichiers livrés par app | `video-16x9.mp4`, `video-1x1.mp4`, `vignette-16x9.png`, `vignette-1x1.png`, `sous-titres-fr.srt`, `sous-titres-en.srt` |

**Chaîne de production (comptes IA du registre TAKATAK, sessions confirmées le 2026-10-26 — connexion Google takatak.ca@gmail.com pour tous) :** génération des plans = **Runway** (plan Pro, workspace takatakca) · voix off = **ElevenLabs** · musique = **Suno** · vignettes et retouches d'images fixes = **OpenArt** · avatar présentateur (option VIP du film maître seulement) = **HeyGen** · contrôle qualité et indexation = **Twelve Labs** · déclinaisons courtes réseaux = **Revid AI**. Aucune connexion n'est faite dans cette passe : le pack est prêt à produire dès l'ouverture d'une session navigateur dédiée (voir le rapport de synthèse).

**Règle d'écran (révision Clover).** L'équipe de révision doit voir la vraie app : chaque storyboard distingue les plans « ambiance » (générés Runway) des plans « écran réel » (capture sandbox de l'app, intégrée au montage). Les prompts Runway ne servent jamais à simuler l'interface.

---
# 3. FILM MAÎTRE — « TAKATAK — LE SYSTÈME » (45 s)

**Usage :** vidéo principale de la fiche TAKATAK (F4TMP23FM7K5M), page développeur Clover, et ouverture de toutes les présentations de la suite. Il raconte la doctrine de Matt : 14 apps, un seul grand système connecté.

**Voix off FR (texte intégral, ~45 s) :**
« Un restaurant ne devrait jamais travailler avec dix systèmes qui s'ignorent. TAKATAK en a bâti un seul. La commande entre — au comptoir, à la borne, au téléphone, en ligne — et devient une seule commande Clover. Le client est reconnu par son numéro de téléphone, partout. Les points, les cartes-cadeaux, le personnel, la comptabilité et la livraison vivent sur le même dos de données. Quatorze applications. Trois niveaux, pour chaque besoin. Un seul système. TAKATAK. Le meilleur des meilleurs. »

**Voice-over EN (full text, ~45 s):**
"A restaurant should never run on ten systems that ignore each other. TAKATAK built one. An order comes in — at the counter, at the kiosk, by phone, online — and becomes a single Clover order. The customer is recognized by phone number, everywhere. Points, gift cards, staff, accounting and delivery all live on the same backbone. Fourteen applications. Three tiers, for every need. One system. TAKATAK. The best of the best."

| Plan | Durée | Type | Visuel | Texte à l'écran (montage) |
|---|---|---|---|---|
| 1 | 0:00–0:07 | Ambiance | Restaurant montréalais haut de gamme au crépuscule, comptoir sombre, lumière dorée, le terminal Clover trône près de la cuisine | « TAKATAK » |
| 2 | 0:07–0:15 | Ambiance | Quatre gestes en fondu : main qui paie au comptoir, client à la borne tactile, téléphone qui sonne au comptoir, sac de livraison qui part | « UNE COMMANDE. TOUS LES CANAUX. » |
| 3 | 0:15–0:23 | Écran réel | Capture du tableau de bord TAKATAK (sandbox) : ventes, commandes, état des apps | « UN SEUL TABLEAU DE BORD » |
| 4 | 0:23–0:31 | Ambiance | Le livreur part dans la rue du soir ; le client sourit à la porte ; retour au comptoir, l'équipe en service | « DU COMPTOIR À LA PORTE » |
| 5 | 0:31–0:38 | Écran réel | Captures enchaînées : solde de points LOY4LTY, carte-cadeau REW4RDS, rapport 4CCOUNTING (sandbox) | « FIDÉLITÉ · CARTES-CADEAUX · COMPTABILITÉ » |
| 6 | 0:38–0:45 | Signature | Plan signature : terminal Clover, lumière or, fondu au noir | « TAKATAK — takatak.ca » |

**Prompts Runway Gen-4 (un par plan d'ambiance) :**
1. `Photorealistic cinematic shot inside an upscale Montreal restaurant at dusk, dark elegant counter with brass accents, warm golden light, a sleek point-of-sale terminal on the counter, steam rising softly from the kitchen pass, slow push-in camera, shallow depth of field, premium black and gold ambience, no text, no logos, no prices, no readable signage, 16:9`
2. `Photorealistic cinematic montage feel, four elegant gestures in a premium restaurant: a hand tapping a card at the counter terminal, a customer touching a large self-service kiosk screen, a phone ringing on a dark counter, a delivery bag being picked up, warm golden light, smooth slow motion, black and gold palette, no text, no logos, no readable screens, 16:9`
4. `Photorealistic cinematic shot, delivery courier leaving an upscale Montreal restaurant at blue hour, warm light spilling from the door, customer smiling as they receive their order at a residential doorway, cinematic slow tracking shot, premium black and gold tones, no text, no logos, no license plates, 16:9`
6. `Photorealistic cinematic close shot of a modern point-of-sale terminal on a dark marble restaurant counter, golden hour light raking across brass details, gentle camera arc, luxurious calm mood, deep black and gold palette, no text, no logos, no prices, negative space in upper third, 16:9`

**Vignette :** plan 6 (terminal, lumière or), titre « TAKATAK — LE SYSTÈME » en or, tiers inférieur.

---

# 4. 4CCOUNTING by TAKATAK — VQTZE8C31D8MW (35 s)

**Angle :** la fin de journée comptable qui se fait toute seule — ventes, TPS/TVQ séparées, pourboires, versements rapprochés. Fonctions montrées : rapports Orders/Payments (#23, #30), ventilation des taxes (#20), événements de caisse (#47).

**Voix off FR :**
« À la fin de la journée, vos chiffres sont déjà prêts. 4CCOUNTING lit vos ventes et vos paiements directement dans Clover, sépare la TPS et la TVQ au centime, rapproche vos versements et signale les écarts. Pourboires, modes de paiement, événements de caisse, coûts de main-d'œuvre : tout est là, prêt pour votre comptable. Fini, les soirées de paperasse. 4CCOUNTING by TAKATAK. »

**Voice-over EN:**
"At the end of the day, your numbers are already done. 4CCOUNTING reads your sales and payments straight from Clover, splits GST and QST to the cent, reconciles your payouts and flags the gaps. Tips, payment methods, cash events, labour costs: everything is there, ready for your accountant. No more paperwork nights. 4CCOUNTING by TAKATAK."

| Plan | Durée | Type | Visuel | Texte à l'écran |
|---|---|---|---|---|
| 1 | 0:00–0:06 | Ambiance | Fermeture du restaurant, lumière chaude, le propriétaire respire enfin | « LA FIN DE JOURNÉE, SANS PAPERASSE » |
| 2 | 0:06–0:14 | Écran réel | Rapport de fin de journée 4CCOUNTING (sandbox) : ventes ventilées TPS/TVQ | « TPS ET TVQ, AU CENTIME » |
| 3 | 0:14–0:22 | Écran réel | Écran de rapprochement versements vs ventes, écart signalé | « VERSEMENTS RAPPROCHÉS » |
| 4 | 0:22–0:30 | Ambiance | Le propriétaire quitte, restaurant calme, terminal en veille | « PRÊT POUR VOTRE COMPTABLE » |
| 5 | 0:30–0:35 | Signature | Plan signature comptoir | « 4CCOUNTING by TAKATAK — takatak.ca » |

**Prompts Runway Gen-4 :**
1. `Photorealistic cinematic shot, restaurant owner relaxing at closing time in an upscale Montreal bistro, warm golden lamps, dark wood and brass, staff wiping the counter in soft focus background, slow dolly, calm luxurious mood, no text, no logos, no paperwork with readable writing, 16:9`
4. `Photorealistic cinematic shot, quiet premium restaurant after closing, point-of-sale terminal in sleep mode on a dark counter, warm golden glow, owner walking out with coat on, peaceful end-of-day atmosphere, slow camera drift, no text, no logos, 16:9`

**Vignette :** plan 1, titre « 4CCOUNTING » or, bas d'image.

---

# 5. C4ISSE by TAKATAK — VDV7XAH5TPB78 (35 s)

**Angle :** la caisse comptoir rapide qui coexiste avec le Register Clover — vrai menu, photos, tenders maison, contrôle gérant. Fonctions : connecteurs Android (#48), Android Payments (#49), Customers par téléphone (#42), tenders personnalisés (#39), tiroir (#56).

**Voix off FR :**
« Au comptoir, chaque seconde compte. C4ISSE est la couche caisse de TAKATAK, branchée sur votre vrai menu Clover : vente rapide, photos des articles, client retrouvé par son numéro de téléphone, carte-cadeau maison acceptée comme au comptoir. Le tiroir s'ouvre, le reçu part en cuisine, et les actions sensibles restent sous contrôle du gérant. Rapide pour l'équipe. Simple pour le client. C4ISSE by TAKATAK. »

**Voice-over EN:**
"At the counter, every second counts. C4ISSE is TAKATAK's register layer, plugged into your real Clover menu: fast checkout, item photos, customers found by phone number, your own gift cards accepted right at the counter. The drawer opens, the receipt fires to the kitchen, and sensitive actions stay under manager control. Fast for the team. Simple for the customer. C4ISSE by TAKATAK."

| Plan | Durée | Type | Visuel | Texte à l'écran |
|---|---|---|---|---|
| 1 | 0:00–0:06 | Ambiance | Heure de pointe feutrée : file courte, équipe fluide, comptoir sombre et or | « LE COMPTOIR, SANS FRICTION » |
| 2 | 0:06–0:14 | Écran réel | C4ISSE (sandbox) : grille photo, panier, paiement sur l'appareil | « VOTRE VRAI MENU CLOVER » |
| 3 | 0:14–0:22 | Écran réel | Recherche client par téléphone + tender carte-cadeau maison | « LE CLIENT, RECONNU PAR TÉLÉPHONE » |
| 4 | 0:22–0:30 | Ambiance | Le reçu part en cuisine, le client repart avec son sac, sourire | « DE LA CAISSE À LA CUISINE » |
| 5 | 0:30–0:35 | Signature | Plan signature | « C4ISSE by TAKATAK — takatak.ca » |

**Prompts Runway Gen-4 :**
1. `Photorealistic cinematic shot, elegant fast-casual restaurant counter at dinner rush, calm confident staff, customers in soft focus, dark counter with brass trim, warm golden lighting, smooth lateral tracking shot, premium mood, no text, no logos, no readable menus, 16:9`
4. `Photorealistic cinematic shot, kitchen pass in a premium Montreal restaurant, a receipt sliding out of a small printer, chef hand taking it, steam and warm golden light, shallow depth of field, slow motion feel, no readable text on the receipt, no logos, 16:9`

**Vignette :** plan 1, titre « C4ISSE » or.

---

# 6. CH4T by TAKATAK — RGE4PFGC9SR7C (35 s)

**Angle (conforme à la spec) :** soutien humain augmenté du contexte — le client est reconnu par téléphone, l'humain voit sa dernière commande et répond avec des modèles. **Aucune réponse IA montrée comme active** (réponses IA fermées tant que l'exception de Pierre n'est pas accordée) ; le film vend le soutien humain + contexte Clover (#42, #23) et les notifications d'état (#60, `O`).

**Voix off FR :**
« Quand un client vous écrit, il ne devrait pas répéter son histoire. CH4T reconnaît votre client par son numéro de téléphone et montre à votre équipe sa dernière commande, au même endroit que la conversation. Réponses humaines, modèles prêts, transfert avec tout le contexte — et le client suit l'état de sa commande sans relancer personne. Un soutien qui connaît vos commandes. CH4T by TAKATAK. »

**Voice-over EN:**
"When a customer messages you, they shouldn't have to repeat their story. CH4T recognizes your customer by phone number and shows your team their latest order, right inside the conversation. Human replies, ready templates, handoffs with full context — and the customer follows their order status without chasing anyone. Support that knows your orders. CH4T by TAKATAK."

| Plan | Durée | Type | Visuel | Texte à l'écran |
|---|---|---|---|---|
| 1 | 0:00–0:06 | Ambiance | Client chez lui, téléphone en main, lumière douce du soir | « VOS CLIENTS ÉCRIVENT. VOUS SAVEZ QUI ILS SONT. » |
| 2 | 0:06–0:14 | Écran réel | Fil CH4T (sandbox/spécimen) : client reconnu, dernière commande visible à côté du fil | « LE CONTEXTE, DANS LA CONVERSATION » |
| 3 | 0:14–0:22 | Écran réel | Notification d'état de commande reçue par le client | « L'ÉTAT DE COMMANDE, SANS RELANCE » |
| 4 | 0:22–0:30 | Ambiance | Membre de l'équipe qui répond calmement au comptoir entre deux commandes | « HUMAIN, INFORMÉ, RAPIDE » |
| 5 | 0:30–0:35 | Signature | Plan signature | « CH4T by TAKATAK — takatak.ca » |

**Prompts Runway Gen-4 :**
1. `Photorealistic cinematic shot, customer at home in the evening typing on a smartphone, warm lamp light, cozy premium interior, calm expression, over-the-shoulder angle with blurred screen, shallow depth of field, no readable text on screen, no logos, 16:9`
4. `Photorealistic cinematic shot, friendly restaurant team member answering a message on a tablet behind an elegant dark counter, golden warm light, genuine calm smile, premium bistro ambience, slow push-in, no readable text, no logos, 16:9`

**Vignette :** plan 1, titre « CH4T » or.

---

# 7. LOY4LTY by TAKATAK — WX0Y6313JX1TY (40 s)

**Angle :** la fidélité par numéro de téléphone — inscription automatique, points après paiement confirmé, échange en rabais avant paiement, même client sur tous les canaux. Fonctions : Customers (#42), saisie pendant le paiement (#43), webhooks `P`/`O` (#60), échange = rabais sur commande (#23).

**Voix off FR :**
« Pas de carte. Pas d'application. Pas de mot de passe. LOY4LTY fonctionne avec un simple numéro de téléphone. À la première visite, le compte se crée tout seul. Dès que le paiement est confirmé dans Clover, les points tombent. Au retour, le solde s'affiche — au comptoir, à la borne, au téléphone, en ligne — et l'échange devient un rabais immédiat sur la commande. La fidélité que vos clients utilisent vraiment. LOY4LTY by TAKATAK. »

**Voice-over EN:**
"No card. No app. No password. LOY4LTY runs on a simple phone number. On the first visit, the account creates itself. The moment payment is confirmed in Clover, the points land. When customers return, their balance shows up — at the counter, at the kiosk, by phone, online — and redeeming becomes an instant discount on the order. Loyalty your customers actually use. LOY4LTY by TAKATAK."

| Plan | Durée | Type | Visuel | Texte à l'écran |
|---|---|---|---|---|
| 1 | 0:00–0:07 | Ambiance | Client régulier accueilli au comptoir comme un habitué | « UN NUMÉRO. C'EST TOUT. » |
| 2 | 0:07–0:15 | Écran réel | Saisie du téléphone à l'appareil / écran fidélité : compte créé, points crédités après paiement | « POINTS CRÉDITÉS APRÈS PAIEMENT CONFIRMÉ » |
| 3 | 0:15–0:23 | Écran réel | Deuxième visite à la borne : solde affiché, échange → rabais sur la commande | « L'ÉCHANGE DEVIENT UN RABAIS » |
| 4 | 0:23–0:32 | Ambiance | Le même client, reconnu au téléphone puis en ligne (montage doux) | « LE MÊME CLIENT, PARTOUT » |
| 5 | 0:32–0:40 | Signature | Plan signature | « LOY4LTY by TAKATAK — takatak.ca » |

**Prompts Runway Gen-4 :**
1. `Photorealistic cinematic shot, a regular customer warmly greeted at the counter of an upscale Montreal restaurant, staff member smiling in recognition, golden warm light, dark elegant interior, slow dolly-in, premium hospitality mood, no text, no logos, 16:9`
4. `Photorealistic cinematic sequence feel, same customer ordering happily in three premium settings: restaurant counter, self-service kiosk, and at home on a laptop, warm golden continuity of light across scenes, elegant transitions, no readable screens, no text, no logos, 16:9`

**Vignette :** plan 1, titre « LOY4LTY » or.

---
# 8. M4RKETING by TAKATAK — EQRZ028619JRW (35 s)

**Angle :** le marketing branché sur les vraies données Clover — rabais d'inventaire, segments clients, campagnes déclenchées par les événements réels. Fonctions : rabais (#19), segments Customers (#42), webhooks `C`/`O` (#60), mesure par les commandes (#23, #30).

**Voix off FR :**
« Votre meilleur marketing est déjà dans votre Clover. M4RKETING lit vos vrais clients et vos vraies ventes : nouveaux, réguliers, ou clients à réveiller. Créez vos rabais une fois, déclenchez vos campagnes au bon moment — premier achat, retour, anniversaire de première visite — et mesurez chaque offre dans vos commandes réelles. Aucune liste exportée. Aucune donnée inventée. M4RKETING by TAKATAK. »

**Voice-over EN:**
"Your best marketing is already inside your Clover. M4RKETING reads your real customers and your real sales: new, loyal, or gone quiet. Build your discounts once, trigger campaigns at the right moment — first purchase, comeback, first-visit anniversary — and measure every offer in your actual orders. No exported lists. No invented data. M4RKETING by TAKATAK."

| Plan | Durée | Type | Visuel | Texte à l'écran |
|---|---|---|---|---|
| 1 | 0:00–0:06 | Ambiance | Salle qui se remplit un mardi soir habituellement calme | « UN MARDI SOIR, COMPLET » |
| 2 | 0:06–0:14 | Écran réel | Segments clients M4RKETING (sandbox) : nouveaux / réguliers / inactifs | « VOS VRAIS CLIENTS, EN SEGMENTS » |
| 3 | 0:14–0:22 | Écran réel | Création d'un rabais + campagne déclenchée sur événement | « DES CAMPAGNES QUI PARTENT AU BON MOMENT » |
| 4 | 0:22–0:30 | Ambiance | Clients qui reviennent, accueillis, ambiance or | « ILS REVIENNENT. VOUS SAVEZ POURQUOI. » |
| 5 | 0:30–0:35 | Signature | Plan signature | « M4RKETING by TAKATAK — takatak.ca » |

**Prompts Runway Gen-4 :**
1. `Photorealistic cinematic shot, upscale Montreal restaurant filling up on a quiet weekday evening, guests arriving through warm golden light, elegant dark interior with brass details, smooth crane-down movement, lively but refined mood, no text, no logos, no readable menus, 16:9`
4. `Photorealistic cinematic shot, returning guests welcomed at the door of a premium restaurant, host smiling, warm golden evening glow, shallow depth of field, slow tracking shot, black and gold palette, no text, no logos, 16:9`

**Vignette :** plan 1, titre « M4RKETING » or.

---

# 9. ON2GO — N4NYCJCZ17FF4 (35 s)

**Angle :** l'annuaire public + la commande directe sans commission de plateforme — fiche alimentée par le profil marchand et les heures, articles publics, disponibilité synchronisée. Fonctions : profil marchand (#8), heures (#11), inventaire public (#12, #13), Online Ordering natif (#28).

**Voix off FR :**
« Vos clients vous cherchent. ON2GO les amène directement chez vous. Votre fiche publique se remplit depuis votre Clover : nom, heures, plats et prix toujours à jour — un article épuisé disparaît tout seul. Et quand le client commande, il commande chez vous, sans commission de plateforme, dans une vraie commande Clover qui part en cuisine. Être trouvé, partout. Vendre, en direct. ON2GO by TAKATAK. »

**Voice-over EN:**
"Your customers are looking for you. ON2GO brings them straight to you. Your public listing fills itself from your Clover: name, hours, dishes and prices always current — a sold-out item disappears on its own. And when the customer orders, they order from you, with no platform commission, as a real Clover order that fires to the kitchen. Get found, everywhere. Sell, direct. ON2GO by TAKATAK."

| Plan | Durée | Type | Visuel | Texte à l'écran |
|---|---|---|---|---|
| 1 | 0:00–0:06 | Ambiance | Personne qui cherche un restaurant sur son téléphone, rue de Montréal le soir | « ILS VOUS CHERCHENT » |
| 2 | 0:06–0:14 | Écran réel | Fiche publique ON2GO (capture réelle) : heures, plats vedettes, lien de commande | « VOTRE FICHE, TOUJOURS À JOUR » |
| 3 | 0:14–0:22 | Écran réel | Commande directe reçue comme commande Clover + impression cuisine | « ZÉRO COMMISSION DE PLATEFORME » |
| 4 | 0:22–0:30 | Ambiance | Client qui ramasse sa commande au comptoir, sourire | « EN DIRECT, DE VOUS À EUX » |
| 5 | 0:30–0:35 | Signature | Plan signature | « ON2GO by TAKATAK — takatak.ca » |

**Prompts Runway Gen-4 :**
1. `Photorealistic cinematic shot, person on a lively Montreal street at dusk searching on a smartphone, restaurant windows glowing warm gold around them, cinematic shallow focus, premium urban mood, blurred phone screen with no readable text, no logos, no storefront signage readable, 16:9`
4. `Photorealistic cinematic shot, happy customer picking up a takeout bag at an elegant dark restaurant counter, warm golden light, staff handing the order with a smile, slow push-in, black and gold palette, no text, no logos, 16:9`

**Vignette :** plan 4, titre « ON2GO » or.

---

# 10. REW4RDS by TAKATAK — 239362NZSVFSC (40 s)

**Angle :** les cartes-cadeaux complètes, pensées Québec : aucune expiration, aucuns frais (loi), échange partiel, registre de groupe multi-succursales, passif suivi pour la comptabilité. Fonctions : commande Clover de vente (#23), tender personnalisé (#39), scan (#57), Ecommerce (#31, #33).

**Voix off FR :**
« Une carte-cadeau, c'est une promesse. REW4RDS la tient partout : vendue au comptoir ou sur votre site, échangée — même en partie — dans toutes vos succursales participantes, rechargeable en tout temps. Et parce que nous sommes au Québec : aucune date d'expiration, aucuns frais d'inactivité, jamais. Le solde suit le client par son numéro de téléphone, et le passif est prêt pour votre comptable. REW4RDS by TAKATAK. »

**Voice-over EN:**
"A gift card is a promise. REW4RDS keeps it everywhere: sold at the counter or on your website, redeemed — even partially — at every participating location, reloadable anytime. And because this is Quebec: no expiry date, no inactivity fees, ever. The balance follows the customer by phone number, and the liability is ready for your accountant. REW4RDS by TAKATAK."

| Plan | Durée | Type | Visuel | Texte à l'écran |
|---|---|---|---|---|
| 1 | 0:00–0:07 | Ambiance | Une carte-cadeau noire et or remise en cadeau, lumière chaude, geste élégant | « UNE PROMESSE, BIEN TENUE » |
| 2 | 0:07–0:15 | Écran réel | Vente de la carte depuis une commande Clover (sandbox), activation à la vente | « VENDUE COMME UNE VRAIE COMMANDE » |
| 3 | 0:15–0:23 | Écran réel | Échange partiel comme tender à la caisse, solde restant affiché | « ÉCHANGE PARTIEL ACCEPTÉ » |
| 4 | 0:23–0:32 | Ambiance | La même carte utilisée dans une deuxième succursale, autre décor, même lumière or | « VALIDE DANS TOUTES VOS SUCCURSALES » |
| 5 | 0:32–0:40 | Signature | Plan signature | « REW4RDS by TAKATAK — takatak.ca » |

**Prompts Runway Gen-4 :**
1. `Photorealistic cinematic close shot, elegant matte black and gold gift card being handed across a dark marble counter as a present, warm golden light, soft focus premium restaurant background, slow graceful camera move, luxurious mood, card completely blank with no text and no logo, 16:9`
4. `Photorealistic cinematic shot, customer paying with a sleek black gift card at a second elegant restaurant location, different interior same warm golden signature light, cashier smiling, smooth arc shot, blank card with no text, no logos, 16:9`

**Vignette :** plan 1 (carte en main), titre « REW4RDS » or.

---

# 11. ST4FF by TAKATAK — E0BGTY752BZYE (35 s)

**Angle :** le personnel au même endroit que les ventes — employés et rôles synchronisés, pointeuse sur les quarts Clover, coût de main-d'œuvre rapproché des ventes, messages d'équipe sur les appareils. Fonctions : employés/rôles (#45), quarts (#46), messages appareil (#58), webhooks `E` (#60).

**Voix off FR :**
« Votre équipe est votre plus grande force — et votre plus grand coût. ST4FF synchronise vos employés et leurs rôles depuis Clover, pointe les quarts sur l'appareil, et compare l'horaire prévu au réel. Le coût de main-d'œuvre se rapproche de vos ventes, quart par quart, et les messages d'équipe arrivent là où le travail se fait : sur vos appareils. ST4FF by TAKATAK. »

**Voice-over EN:**
"Your team is your greatest strength — and your biggest cost. ST4FF syncs your employees and roles from Clover, clocks shifts on the device, and compares scheduled hours to actual ones. Labour cost is matched against your sales, shift by shift, and team messages land where the work happens: on your devices. ST4FF by TAKATAK."

| Plan | Durée | Type | Visuel | Texte à l'écran |
|---|---|---|---|---|
| 1 | 0:00–0:06 | Ambiance | Équipe qui entre en service, lumière du matin, gestes assurés | « L'ÉQUIPE, AU CENTRE » |
| 2 | 0:06–0:14 | Écran réel | ST4FF (sandbox) : liste d'employés, rôles, pointeuse sur l'appareil | « QUARTS POINTÉS SUR CLOVER » |
| 3 | 0:14–0:22 | Écran réel | Horaire planifié vs réel + coût de main-d'œuvre vs ventes | « LE COÛT RÉEL, QUART PAR QUART » |
| 4 | 0:22–0:30 | Ambiance | Service du soir en pleine fluidité, équipe coordonnée | « LE BON MONDE, AU BON MOMENT » |
| 5 | 0:30–0:35 | Signature | Plan signature | « ST4FF by TAKATAK — takatak.ca » |

**Prompts Runway Gen-4 :**
1. `Photorealistic cinematic shot, restaurant team starting their shift in the morning, putting on aprons in an elegant dark kitchen, soft golden window light, confident calm energy, slow steadicam move, premium documentary feel, no text, no logos, 16:9`
4. `Photorealistic cinematic shot, perfectly coordinated dinner service in a premium Montreal restaurant, servers moving gracefully between tables, warm golden ambience, dark wood and brass, smooth tracking shot, no text, no logos, 16:9`

**Vignette :** plan 4, titre « ST4FF » or.

---
# 12. T4CTILE by TAKATAK — SFH7X57N3B5FJ (40 s)

**Angle :** la borne tactile niveau grande chaîne — menu en photos plein écran lu en direct de Clover, fidélité par téléphone à la borne, carte-cadeau scannée. Fonctions : mode kiosque (#54), inventaire en direct (#12–#17), photos CDN (contournement L4), impression cuisine (#27), scan (#57).

**Voix off FR :**
« Vos clients commandent comme dans les grandes chaînes — sans quitter votre menu. T4CTILE transforme votre kiosque Clover en borne tactile haut de gamme : photos plein écran, gros boutons, prix lus en direct dans votre inventaire. La commande part en cuisine comme celle du comptoir, le client paie sur l'appareil, entre son numéro pour ses points, ou scanne sa carte-cadeau. Votre borne. Votre menu. Aucune double saisie. T4CTILE by TAKATAK. »

**Voice-over EN:**
"Your customers order like at the big chains — without leaving your menu. T4CTILE turns your Clover kiosk into a premium self-service station: full-screen photos, big buttons, prices read live from your inventory. The order fires to the kitchen like a counter order, the customer pays on the device, enters their number for points, or scans a gift card. Your kiosk. Your menu. Zero double entry. T4CTILE by TAKATAK."

| Plan | Durée | Type | Visuel | Texte à l'écran |
|---|---|---|---|---|
| 1 | 0:00–0:07 | Ambiance | Client devant la grande borne lumineuse, décor sombre et or | « COMME DANS LES GRANDES CHAÎNES » |
| 2 | 0:07–0:15 | Écran réel | Parcours borne réel (prototype/sandbox) : catégories photos, item, modificateurs | « VOTRE VRAI MENU, EN PLEIN ÉCRAN » |
| 3 | 0:15–0:23 | Écran réel | Paiement sur l'appareil associé + saisie téléphone fidélité | « PAIEMENT ET POINTS, SANS SORTIR DU PARCOURS » |
| 4 | 0:23–0:32 | Ambiance | La commande sort de la cuisine, le client la reçoit au comptoir de ramassage | « DE LA BORNE À LA CUISINE » |
| 5 | 0:32–0:40 | Signature | Plan signature | « T4CTILE by TAKATAK — takatak.ca » |

**Prompts Runway Gen-4 :**
1. `Photorealistic cinematic shot, customer standing before a large glowing self-service kiosk screen in a premium dark restaurant, warm golden rim light, elegant posture, screen showing only blurred colorful food photography with no readable text, slow orbit shot, luxurious fast-casual mood, no logos, 16:9`
4. `Photorealistic cinematic shot, fresh order being handed over a pickup counter from the kitchen side, steam rising, warm golden light, customer reaching for the tray, shallow depth of field, slow motion elegance, no text, no logos, 16:9`

**Vignette :** plan 1, titre « T4CTILE » or.

---

# 13. TAKATAK — F4TMP23FM7K5M (40 s)

**Angle :** le tableau de bord d'agence — un espace par marque, ventes/commandes/écarts en lecture, état de toutes les apps de la suite. C'est l'écran où le « système unique » devient visible. Fonctions : lecture Merchant/Inventory/Orders/Payments, webhooks `A` (#60, #64).

**Voix off FR :**
« Gérer plusieurs établissements ne devrait pas vouloir dire jongler avec les écrans. TAKATAK relie chaque Clover à l'espace de sa marque : ventes, commandes, inventaire et écarts, en un coup d'œil — sans jamais mélanger les données d'une marque à l'autre. Installations, abonnements, actifs numériques : le plan de contrôle complet de votre suite. Un système. Une vue. TAKATAK. »

**Voice-over EN:**
"Running several locations shouldn't mean juggling screens. TAKATAK connects each Clover to its own brand space: sales, orders, inventory and exceptions at a glance — never mixing one brand's data with another's. Installs, subscriptions, digital assets: the full control plane for your suite. One system. One view. TAKATAK."

| Plan | Durée | Type | Visuel | Texte à l'écran |
|---|---|---|---|---|
| 1 | 0:00–0:07 | Ambiance | Propriétaire multi-succursales qui consulte calmement une tablette, café, matin | « PLUSIEURS ADRESSES. UNE SEULE VUE. » |
| 2 | 0:07–0:15 | Écran réel | Dashboard TAKATAK (sandbox) : espaces par marque, indicateurs de ventes | « CHAQUE MARQUE, SON ESPACE » |
| 3 | 0:15–0:23 | Écran réel | Écarts à vérifier + état des apps installées | « LES ÉCARTS, AVANT QU'ILS COÛTENT » |
| 4 | 0:23–0:32 | Ambiance | Trois restaurants du même groupe en fondu, même signature or | « LE SYSTÈME, VISIBLE » |
| 5 | 0:32–0:40 | Signature | Plan signature | « TAKATAK — takatak.ca » |

**Prompts Runway Gen-4 :**
1. `Photorealistic cinematic shot, multi-location restaurant owner calmly reviewing a tablet over morning coffee in an elegant office above a Montreal restaurant, golden window light, blurred dashboard colors on screen with no readable text, confident relaxed mood, slow push-in, no logos, 16:9`
4. `Photorealistic cinematic triptych feel, three different upscale Montreal restaurants of the same group at dusk, each glowing with the same warm golden signature light, elegant exteriors with unreadable blurred signage, cinematic wide shots, no text, no logos, 16:9`

**Vignette :** plan 4, titre « TAKATAK » or.

---

# 14. TAKATAK Picture Register — J0H36VTJBSBBP (35 s)

**Angle :** la caisse visuelle — on touche la photo, pas un code ; vitesse au comptoir et formation du personnel. Sœur de C4ISSE. Fonctions : grille photo CDN (#12, #13 + L4), Android Payments (#49), scan SKU (#57), verrouillage employé (#45).

**Voix off FR :**
« Un nouvel employé devrait être rapide dès le premier quart. Picture Register met votre menu en photos, en grand : on touche l'image, l'article est au panier. Variantes, rabais rapides, recherche par code ou par scan — et chaque caisse verrouillée par employé. Moins d'erreurs, une formation éclair, un comptoir qui avance. Picture Register by TAKATAK. »

**Voice-over EN:**
"A new hire should be fast from the very first shift. Picture Register puts your menu in big, beautiful photos: tap the picture, the item is in the cart. Variants, quick discounts, search by code or by scan — and every register locked by employee. Fewer mistakes, lightning training, a counter that keeps moving. Picture Register by TAKATAK."

| Plan | Durée | Type | Visuel | Texte à l'écran |
|---|---|---|---|---|
| 1 | 0:00–0:06 | Ambiance | Jeune employé souriant qui prend sa première commande sans hésiter | « RAPIDE DÈS LE PREMIER QUART » |
| 2 | 0:06–0:14 | Écran réel | Grille photo Picture Register (sandbox) : toucher → panier | « ON TOUCHE LA PHOTO. C'EST TOUT. » |
| 3 | 0:14–0:22 | Écran réel | Variantes photo + scan d'un code à la caisse | « VARIANTES ET SCAN, SANS CHERCHER » |
| 4 | 0:22–0:30 | Ambiance | File qui avance fluidement au comptoir, heure de pointe sereine | « LE COMPTOIR AVANCE » |
| 5 | 0:30–0:35 | Signature | Plan signature | « PICTURE REGISTER by TAKATAK — takatak.ca » |

**Prompts Runway Gen-4 :**
1. `Photorealistic cinematic shot, young new employee confidently taking their first order at a bright photo-based register in a premium fast-casual restaurant, warm golden light, encouraging senior colleague nearby, smooth slow dolly, no readable screen text, no logos, 16:9`
4. `Photorealistic cinematic shot, lunch line flowing smoothly at an elegant restaurant counter, customers ordering quickly, staff in rhythm, warm golden ambience, dark wood and brass, lateral tracking shot, no text, no logos, 16:9`

**Vignette :** plan 1, titre « PICTURE REGISTER » or.

---

# 15. TR4CKER by TAKATAK — EB2EPCWEJBZ82 (40 s)

**Angle :** le suivi de livraison maison, de la commande Clover à la porte — position du livreur en direct, pourboire après livraison, avis routés (bon → Google, mauvais → interne). Fonctions : commandes (#23), webhooks `O` (#60), pourboire par lien Ecommerce (#31, #36), notifications CH4T.

**Voix off FR :**
« Votre livraison ne devrait pas disparaître dans le noir. TR4CKER suit votre livreur en direct, rattaché à la vraie commande Clover. Le client voit sa commande approcher, puis, une fois livrée, ajoute son pourboire et laisse son avis : les bons partent sur Google, les autres restent chez vous, là où ils se règlent. Vos livreurs. Vos clients. Vos avis. TR4CKER by TAKATAK. »

**Voice-over EN:**
"Your delivery shouldn't vanish into the dark. TR4CKER tracks your driver live, tied to the real Clover order. The customer watches it approach, then, once delivered, adds a tip and leaves a review: the good ones go to Google, the rest stay with you, where they get fixed. Your drivers. Your customers. Your reviews. TR4CKER by TAKATAK."

| Plan | Durée | Type | Visuel | Texte à l'écran |
|---|---|---|---|---|
| 1 | 0:00–0:07 | Ambiance | Commande qui part du restaurant, livreur dans la lumière du soir | « DE VOTRE CUISINE À LEUR PORTE » |
| 2 | 0:07–0:15 | Écran réel | Page de suivi TR4CKER (spécimen/sandbox) : position en direct, statuts synchronisés | « SUIVI EN DIRECT, SUR LA VRAIE COMMANDE » |
| 3 | 0:15–0:23 | Écran réel | Page post-livraison : ajout de pourboire + avis, routage bon/mauvais | « POURBOIRE ET AVIS, APRÈS LA LIVRAISON » |
| 4 | 0:23–0:32 | Ambiance | Client qui reçoit son repas chaud à la porte, sourire, nuit montréalaise | « LIVRÉ. SUIVI. APPRÉCIÉ. » |
| 5 | 0:32–0:40 | Signature | Plan signature | « TR4CKER by TAKATAK — takatak.ca » |

**Prompts Runway Gen-4 :**
1. `Photorealistic cinematic shot, delivery driver leaving an upscale Montreal restaurant at dusk carrying an insulated bag, warm golden door light, city evening glow, smooth tracking shot alongside, premium mood, no text, no logos, no readable license plates, 16:9`
4. `Photorealistic cinematic shot, delighted customer receiving a hot meal at their front door on a Montreal evening, driver handing the bag with a smile, warm porch light against blue-hour street, shallow depth of field, no text, no logos, 16:9`

**Vignette :** plan 4, titre « TR4CKER » or.

---

# 16. APPS EN RÉVISION — AUCUNE MODIFICATION DE FICHE

**TAKATAK Food Hub (629HFYHNVMZYR) et TAKATAK Phone AI (20FK28P20HJC6)** sont en révision au Clover App Market (soumissions reçues le 2026-10-17). Règle absolue : on ne touche ni à leurs fiches, ni à leurs vidéos actuelles, ni à leurs webhooks tant que la révision n'est pas terminée.

Leurs films LUXE sont **prêts à produire selon cette même charte** dès l'approbation Clover :
- **Food Hub** — angle prêt : « Toutes vos plateformes. Une seule cuisine. » (commandes Uber Eats/DoorDash/SkipTheDishes devenues commandes Clover imprimées en cuisine, menu maître publié partout, ruptures synchronisées). Production différée à l'approbation.
- **Phone AI** — angle prêt : « Le téléphone répond, prend la commande, l'envoie dans Clover. » (assistant FR québécois/EN/ES, menu en direct, lien de paiement par texto). Production différée à l'approbation.
Les scripts complets seront écrits au même standard (FR + EN, storyboard, prompts) dans une passe dédiée déclenchée par l'approbation — pas avant, pour ne pas risquer une fiche en révision.

# 17. ORDRE DE PRODUCTION RECOMMANDÉ

1. **Film maître** (sert partout, y compris hors Clover).
2. **LOY4LTY, REW4RDS, T4CTILE** — les trois visages les plus vendeurs de la suite.
3. **C4ISSE, Picture Register, TR4CKER** — démonstrations comptoir/livraison.
4. **4CCOUNTING, ST4FF, M4RKETING, CH4T, ON2GO, TAKATAK** — complétion de la suite.
5. Contrôle qualité Twelve Labs sur chaque film avant dépôt au portail ; déclinaisons 1:1 et vignettes dans la même passe.

*Fin du pack — préparé le 2026-10-28, standard LUXE TAKATAK. Production des vidéos elles-mêmes : session navigateur dédiée requise (connexions Runway/ElevenLabs/Suno) — voir la note de synthèse.*
