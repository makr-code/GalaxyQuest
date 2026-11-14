# Experimental Runtime Domains

**Status: experimental, not bootstrapped by the main game entry point.**

These modules are composed only by `js/engine/game.js` (`GQGame`), which is not
loaded by `index.html` or `js/main.js`. They are kept as a template for
client-side presentation domains.

```
domains/
├── alliance/ colonization/ diplomacy/ espionage/ event/
├── fleet/ galaxy/ npc/ research/ war/
├── shared/
│   ├── State.js           # Base state manager
│   └── EventRegistry.js   # Event definitions
└── _templates/
    └── TEMPLATE.js        # Boilerplate for new domains
```

## Economy and market

The economy and market are **server-authoritative** (PHP). There is no client-side
economy or market domain here. The frontend only reads server state through
`js/engine/runtime/server-economy-domain.js` and
`js/engine/runtime/server-market-domain.js` and renders it via
`js/ui/game-economy.js` and `js/ui/game-market.js`.

The former experimental economy/market domain and its migration guide were removed;
see [docs/archive/MIGRATION_GUIDE_ECONOMY_DOMAIN.md](../../../../docs/archive/MIGRATION_GUIDE_ECONOMY_DOMAIN.md)
for the historical proposal.