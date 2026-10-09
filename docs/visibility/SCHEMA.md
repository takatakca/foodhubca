# schema.org structured data per brand (S1, 2026-10-09)

Paste one block per brand site in a `<script type="application/ld+json">` tag (every page, or at least the home and
order pages). It tells Google the brand, each kitchen's address, the cuisine, the menu and the order page. Generated
from the brand config values in `GBP_CHANGES.md` and `NAP.md`; every block below is checked as valid JSON.

Before publishing (owner decisions, `PLAN.md` §7):
- **Address numbers:** NDG uses 6280 avenue Somerled, Saint-Léonard 5839 rue Jean-Talon Est, the brand config's values.
  If the owner picks 6284 or 5837, change `streetAddress` everywhere at the same time as Google.
- **Delivery-only brand (listing type B) at a kitchen:** remove that kitchen's `address` and add
  `"areaServed": {"@type": "City", "name": "Montréal"}` instead, so the site never shows an address Google hides.
- **Hours:** not final, so no `openingHoursSpecification` yet; add it from Food Hub Settings → Hours when approved.
  Never "24/7".
- **Order page:** `/commander` is a placeholder until the owner picks the order target (Clover pickup page, ON2GO brand
  page or brand-site store page). `DeliveryModeOwnFleet` stands for delivery; drop it if only pickup is offered.
- **`hasMap`:** only on kitchens with a known Google profile, and only after that profile is checked (`PLAN.md` §7,
  item 4).
- Check each page with Google's Rich Results Test after publishing.

## PPP Pizzeria (`pppmtl.com`)

Note: NDG only (owner's own copy).

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://pppmtl.com/#brand",
      "name": "PPP Pizzeria",
      "url": "https://pppmtl.com/"
    },
    {
      "@type": "Restaurant",
      "@id": "https://pppmtl.com/#ndg",
      "name": "PPP Pizzeria",
      "url": "https://pppmtl.com/",
      "parentOrganization": {
        "@id": "https://pppmtl.com/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Pizza",
        "Chicken",
        "Poutine"
      ],
      "hasMenu": "https://pppmtl.com/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://pppmtl.com/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      },
      "hasMap": "https://maps.google.com/?cid=6093103527698124139"
    }
  ]
}
```

## OOEUF (`ooeuf.ca`)

Note: Spelling waits for the owner.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://ooeuf.ca/#brand",
      "name": "OOEUF",
      "url": "https://ooeuf.ca/"
    },
    {
      "@type": "FastFoodRestaurant",
      "@id": "https://ooeuf.ca/#ndg",
      "name": "OOEUF (Notre-Dame-de-Grâce (NDG))",
      "url": "https://ooeuf.ca/",
      "parentOrganization": {
        "@id": "https://ooeuf.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Burgers",
        "Hot dogs",
        "Poutine"
      ],
      "hasMenu": "https://ooeuf.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://ooeuf.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      },
      "hasMap": "https://maps.google.com/?cid=8027317480379740171"
    },
    {
      "@type": "FastFoodRestaurant",
      "@id": "https://ooeuf.ca/#saint-leonard",
      "name": "OOEUF (Saint-Léonard)",
      "url": "https://ooeuf.ca/",
      "parentOrganization": {
        "@id": "https://ooeuf.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Burgers",
        "Hot dogs",
        "Poutine"
      ],
      "hasMenu": "https://ooeuf.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://ooeuf.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    }
  ]
}
```

## Déjeuner Montréal (`dejeuner.ooeuf.ca`)

Note: Name waits for the owner.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://dejeuner.ooeuf.ca/#brand",
      "name": "Déjeuner Montréal",
      "url": "https://dejeuner.ooeuf.ca/"
    },
    {
      "@type": "FastFoodRestaurant",
      "@id": "https://dejeuner.ooeuf.ca/#ndg",
      "name": "Déjeuner Montréal (Notre-Dame-de-Grâce (NDG))",
      "url": "https://dejeuner.ooeuf.ca/",
      "parentOrganization": {
        "@id": "https://dejeuner.ooeuf.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Burgers",
        "Hot dogs",
        "Poutine"
      ],
      "hasMenu": "https://dejeuner.ooeuf.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://dejeuner.ooeuf.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    },
    {
      "@type": "FastFoodRestaurant",
      "@id": "https://dejeuner.ooeuf.ca/#saint-leonard",
      "name": "Déjeuner Montréal (Saint-Léonard)",
      "url": "https://dejeuner.ooeuf.ca/",
      "parentOrganization": {
        "@id": "https://dejeuner.ooeuf.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Burgers",
        "Hot dogs",
        "Poutine"
      ],
      "hasMenu": "https://dejeuner.ooeuf.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://dejeuner.ooeuf.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    }
  ]
}
```

## Pi Pita (`pipita.ca`)

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://pipita.ca/#brand",
      "name": "Pi Pita",
      "url": "https://pipita.ca/"
    },
    {
      "@type": "Restaurant",
      "@id": "https://pipita.ca/#ndg",
      "name": "Pi Pita (Notre-Dame-de-Grâce (NDG))",
      "url": "https://pipita.ca/",
      "parentOrganization": {
        "@id": "https://pipita.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Lebanese",
        "Shawarma"
      ],
      "hasMenu": "https://pipita.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://pipita.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      },
      "hasMap": "https://maps.google.com/?cid=2408837339277880870"
    },
    {
      "@type": "Restaurant",
      "@id": "https://pipita.ca/#saint-leonard",
      "name": "Pi Pita (Saint-Léonard)",
      "url": "https://pipita.ca/",
      "parentOrganization": {
        "@id": "https://pipita.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Lebanese",
        "Shawarma"
      ],
      "hasMenu": "https://pipita.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://pipita.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    }
  ]
}
```

## Pita Libanais (`pitalibanais.pppmtl.com`)

Note: Name may change.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://pitalibanais.pppmtl.com/#brand",
      "name": "Pita Libanais",
      "url": "https://pitalibanais.pppmtl.com/"
    },
    {
      "@type": "Restaurant",
      "@id": "https://pitalibanais.pppmtl.com/#ndg",
      "name": "Pita Libanais (Notre-Dame-de-Grâce (NDG))",
      "url": "https://pitalibanais.pppmtl.com/",
      "parentOrganization": {
        "@id": "https://pitalibanais.pppmtl.com/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Lebanese"
      ],
      "hasMenu": "https://pitalibanais.pppmtl.com/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://pitalibanais.pppmtl.com/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    },
    {
      "@type": "Restaurant",
      "@id": "https://pitalibanais.pppmtl.com/#saint-leonard",
      "name": "Pita Libanais (Saint-Léonard)",
      "url": "https://pitalibanais.pppmtl.com/",
      "parentOrganization": {
        "@id": "https://pitalibanais.pppmtl.com/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Lebanese"
      ],
      "hasMenu": "https://pitalibanais.pppmtl.com/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://pitalibanais.pppmtl.com/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    }
  ]
}
```

## Mythos & Go (`mythos.pppmtl.com`)

Note: Not before the trademark check.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://mythos.pppmtl.com/#brand",
      "name": "Mythos & Go",
      "url": "https://mythos.pppmtl.com/"
    },
    {
      "@type": "Restaurant",
      "@id": "https://mythos.pppmtl.com/#ndg",
      "name": "Mythos & Go (Notre-Dame-de-Grâce (NDG))",
      "url": "https://mythos.pppmtl.com/",
      "parentOrganization": {
        "@id": "https://mythos.pppmtl.com/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Greek"
      ],
      "hasMenu": "https://mythos.pppmtl.com/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://mythos.pppmtl.com/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    },
    {
      "@type": "Restaurant",
      "@id": "https://mythos.pppmtl.com/#saint-leonard",
      "name": "Mythos & Go (Saint-Léonard)",
      "url": "https://mythos.pppmtl.com/",
      "parentOrganization": {
        "@id": "https://mythos.pppmtl.com/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Greek"
      ],
      "hasMenu": "https://mythos.pppmtl.com/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://mythos.pppmtl.com/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    }
  ]
}
```

## Nutrition Shake (`nutrishake.ca`)

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://nutrishake.ca/#brand",
      "name": "Nutrition Shake",
      "url": "https://nutrishake.ca/"
    },
    {
      "@type": "Restaurant",
      "@id": "https://nutrishake.ca/#ndg",
      "name": "Nutrition Shake (Notre-Dame-de-Grâce (NDG))",
      "url": "https://nutrishake.ca/",
      "parentOrganization": {
        "@id": "https://nutrishake.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Salads",
        "Healthy",
        "Vegetarian"
      ],
      "hasMenu": "https://nutrishake.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://nutrishake.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    },
    {
      "@type": "Restaurant",
      "@id": "https://nutrishake.ca/#saint-leonard",
      "name": "Nutrition Shake (Saint-Léonard)",
      "url": "https://nutrishake.ca/",
      "parentOrganization": {
        "@id": "https://nutrishake.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Salads",
        "Healthy",
        "Vegetarian"
      ],
      "hasMenu": "https://nutrishake.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://nutrishake.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      },
      "hasMap": "https://maps.google.com/?cid=17679975320192778617"
    }
  ]
}
```

## Bin Molle & Bin Dure (`bmbd.ca`)

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://bmbd.ca/#brand",
      "name": "Bin Molle & Bin Dure",
      "url": "https://bmbd.ca/"
    },
    {
      "@type": "IceCreamShop",
      "@id": "https://bmbd.ca/#ndg",
      "name": "Bin Molle & Bin Dure (Notre-Dame-de-Grâce (NDG))",
      "url": "https://bmbd.ca/",
      "parentOrganization": {
        "@id": "https://bmbd.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Desserts",
        "Slush",
        "Waffles"
      ],
      "hasMenu": "https://bmbd.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://bmbd.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      },
      "hasMap": "https://maps.google.com/?cid=5723855720782944465"
    },
    {
      "@type": "IceCreamShop",
      "@id": "https://bmbd.ca/#saint-leonard",
      "name": "Bin Molle & Bin Dure (Saint-Léonard)",
      "url": "https://bmbd.ca/",
      "parentOrganization": {
        "@id": "https://bmbd.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Desserts",
        "Slush",
        "Waffles"
      ],
      "hasMenu": "https://bmbd.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://bmbd.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    }
  ]
}
```

## OCRÊPE (`ocrepe.ca`)

Note: Spelling waits for the owner.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://ocrepe.ca/#brand",
      "name": "OCRÊPE",
      "url": "https://ocrepe.ca/"
    },
    {
      "@type": "Restaurant",
      "@id": "https://ocrepe.ca/#ndg",
      "name": "OCRÊPE (Notre-Dame-de-Grâce (NDG))",
      "url": "https://ocrepe.ca/",
      "parentOrganization": {
        "@id": "https://ocrepe.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Crêpes",
        "Waffles",
        "Desserts"
      ],
      "hasMenu": "https://ocrepe.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://ocrepe.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    },
    {
      "@type": "Restaurant",
      "@id": "https://ocrepe.ca/#saint-leonard",
      "name": "OCRÊPE (Saint-Léonard)",
      "url": "https://ocrepe.ca/",
      "parentOrganization": {
        "@id": "https://ocrepe.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Crêpes",
        "Waffles",
        "Desserts"
      ],
      "hasMenu": "https://ocrepe.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://ocrepe.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    }
  ]
}
```

## Gâteau Montréal (`viennoise.ca`)

Note: Name and domain wait for the owner.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://viennoise.ca/#brand",
      "name": "Gâteau Montréal",
      "url": "https://viennoise.ca/"
    },
    {
      "@type": "Bakery",
      "@id": "https://viennoise.ca/#ndg",
      "name": "Gâteau Montréal (Notre-Dame-de-Grâce (NDG))",
      "url": "https://viennoise.ca/",
      "parentOrganization": {
        "@id": "https://viennoise.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Cakes",
        "Cheesecakes",
        "Pastry"
      ],
      "hasMenu": "https://viennoise.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://viennoise.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    },
    {
      "@type": "Bakery",
      "@id": "https://viennoise.ca/#saint-leonard",
      "name": "Gâteau Montréal (Saint-Léonard)",
      "url": "https://viennoise.ca/",
      "parentOrganization": {
        "@id": "https://viennoise.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Cakes",
        "Cheesecakes",
        "Pastry"
      ],
      "hasMenu": "https://viennoise.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://viennoise.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    }
  ]
}
```

## Taco Mexican (`tacomontreal.ca`)

Note: Name may change.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://tacomontreal.ca/#brand",
      "name": "Taco Mexican",
      "url": "https://tacomontreal.ca/"
    },
    {
      "@type": "Restaurant",
      "@id": "https://tacomontreal.ca/#ndg",
      "name": "Taco Mexican (Notre-Dame-de-Grâce (NDG))",
      "url": "https://tacomontreal.ca/",
      "parentOrganization": {
        "@id": "https://tacomontreal.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Mexican",
        "Tacos"
      ],
      "hasMenu": "https://tacomontreal.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://tacomontreal.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    },
    {
      "@type": "Restaurant",
      "@id": "https://tacomontreal.ca/#saint-leonard",
      "name": "Taco Mexican (Saint-Léonard)",
      "url": "https://tacomontreal.ca/",
      "parentOrganization": {
        "@id": "https://tacomontreal.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Mexican",
        "Tacos"
      ],
      "hasMenu": "https://tacomontreal.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://tacomontreal.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    }
  ]
}
```

## Pizza Inntime (`inntime.ca`)

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://inntime.ca/#brand",
      "name": "Pizza Inntime",
      "url": "https://inntime.ca/"
    },
    {
      "@type": "Restaurant",
      "@id": "https://inntime.ca/#ndg",
      "name": "Pizza Inntime (Notre-Dame-de-Grâce (NDG))",
      "url": "https://inntime.ca/",
      "parentOrganization": {
        "@id": "https://inntime.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Pizza"
      ],
      "hasMenu": "https://inntime.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://inntime.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    },
    {
      "@type": "Restaurant",
      "@id": "https://inntime.ca/#saint-leonard",
      "name": "Pizza Inntime (Saint-Léonard)",
      "url": "https://inntime.ca/",
      "parentOrganization": {
        "@id": "https://inntime.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Pizza"
      ],
      "hasMenu": "https://inntime.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://inntime.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    }
  ]
}
```

## Pizza Algérie (`pizzaalgerie.pppmtl.com`)

Note: NDG only today.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://pizzaalgerie.pppmtl.com/#brand",
      "name": "Pizza Algérie",
      "url": "https://pizzaalgerie.pppmtl.com/"
    },
    {
      "@type": "Restaurant",
      "@id": "https://pizzaalgerie.pppmtl.com/#ndg",
      "name": "Pizza Algérie",
      "url": "https://pizzaalgerie.pppmtl.com/",
      "parentOrganization": {
        "@id": "https://pizzaalgerie.pppmtl.com/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Pizza"
      ],
      "hasMenu": "https://pizzaalgerie.pppmtl.com/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://pizzaalgerie.pppmtl.com/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    }
  ]
}
```

## Po Poulet (`popoulet.ca`)

Note: Saint-Léonard only. Never any NDG node, never the NDG DoorDash store 27982486.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://popoulet.ca/#brand",
      "name": "Po Poulet",
      "url": "https://popoulet.ca/"
    },
    {
      "@type": "FastFoodRestaurant",
      "@id": "https://popoulet.ca/#saint-leonard",
      "name": "Po Poulet",
      "url": "https://popoulet.ca/",
      "parentOrganization": {
        "@id": "https://popoulet.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Fried chicken",
        "Chicken wings"
      ],
      "hasMenu": "https://popoulet.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://popoulet.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    }
  ]
}
```

## Poulet Poulet (`pouletpoulet.popoulet.ca`)

Note: Name waits for the owner; separate from Po Poulet NDG.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://pouletpoulet.popoulet.ca/#brand",
      "name": "Poulet Poulet",
      "url": "https://pouletpoulet.popoulet.ca/"
    },
    {
      "@type": "FastFoodRestaurant",
      "@id": "https://pouletpoulet.popoulet.ca/#ndg",
      "name": "Poulet Poulet (Notre-Dame-de-Grâce (NDG))",
      "url": "https://pouletpoulet.popoulet.ca/",
      "parentOrganization": {
        "@id": "https://pouletpoulet.popoulet.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Chicken wings"
      ],
      "hasMenu": "https://pouletpoulet.popoulet.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://pouletpoulet.popoulet.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    },
    {
      "@type": "FastFoodRestaurant",
      "@id": "https://pouletpoulet.popoulet.ca/#saint-leonard",
      "name": "Poulet Poulet (Saint-Léonard)",
      "url": "https://pouletpoulet.popoulet.ca/",
      "parentOrganization": {
        "@id": "https://pouletpoulet.popoulet.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Chicken wings"
      ],
      "hasMenu": "https://pouletpoulet.popoulet.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://pouletpoulet.popoulet.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    }
  ]
}
```

## Café Bolon (`bolon.ca`)

Note: Check both profiles first (PLAN.md §7, item 1: one may still be the old Montréal-Nord listing).

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://bolon.ca/#brand",
      "name": "Café Bolon",
      "url": "https://bolon.ca/"
    },
    {
      "@type": "Restaurant",
      "@id": "https://bolon.ca/#ndg",
      "name": "Café Bolon (Notre-Dame-de-Grâce (NDG))",
      "url": "https://bolon.ca/",
      "parentOrganization": {
        "@id": "https://bolon.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Latin American",
        "Empanadas"
      ],
      "hasMenu": "https://bolon.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://bolon.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      },
      "hasMap": "https://maps.google.com/?cid=13512885180808196559"
    },
    {
      "@type": "Restaurant",
      "@id": "https://bolon.ca/#saint-leonard",
      "name": "Café Bolon (Saint-Léonard)",
      "url": "https://bolon.ca/",
      "parentOrganization": {
        "@id": "https://bolon.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Latin American",
        "Empanadas"
      ],
      "hasMenu": "https://bolon.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://bolon.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      },
      "hasMap": "https://maps.google.com/?cid=9510640660342127576"
    }
  ]
}
```

## Place Afrique (`placeafrique.bolon.ca`)

Note: Lowest priority.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://placeafrique.bolon.ca/#brand",
      "name": "Place Afrique",
      "url": "https://placeafrique.bolon.ca/"
    },
    {
      "@type": "Restaurant",
      "@id": "https://placeafrique.bolon.ca/#ndg",
      "name": "Place Afrique (Notre-Dame-de-Grâce (NDG))",
      "url": "https://placeafrique.bolon.ca/",
      "parentOrganization": {
        "@id": "https://placeafrique.bolon.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6280 avenue Somerled",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H3X 2B6",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Grill",
        "Snacks"
      ],
      "hasMenu": "https://placeafrique.bolon.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://placeafrique.bolon.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    },
    {
      "@type": "Restaurant",
      "@id": "https://placeafrique.bolon.ca/#saint-leonard",
      "name": "Place Afrique (Saint-Léonard)",
      "url": "https://placeafrique.bolon.ca/",
      "parentOrganization": {
        "@id": "https://placeafrique.bolon.ca/#brand"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "5839 rue Jean-Talon Est",
        "addressLocality": "Montréal",
        "addressRegion": "QC",
        "postalCode": "H1S 1M4",
        "addressCountry": "CA"
      },
      "servesCuisine": [
        "Grill",
        "Snacks"
      ],
      "hasMenu": "https://placeafrique.bolon.ca/",
      "acceptsReservations": false,
      "potentialAction": {
        "@type": "OrderAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://placeafrique.bolon.ca/commander",
          "inLanguage": "fr-CA",
          "actionPlatform": [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform"
          ]
        },
        "deliveryMethod": [
          "http://purl.org/goodrelations/v1#DeliveryModePickUp",
          "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"
        ]
      }
    }
  ]
}
```
