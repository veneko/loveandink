# Love & Ink — loveandink.co

Static site deployed on Netlify (publish dir `site/`, functions in `netlify/functions/`).

- `site/` — Love & Ink (Home, Prints, Publishing, Lifestyle) + `site/tinylegends/` (Tiny Legends Adventures, also embedded as the fifth world)
- `netlify/functions/checkout.mjs` — Square payment links from catalog SKUs (off until `LI_PAY_MODE` is "square")
- `netlify/functions/stock.mjs` — live stock by SKU
- Forms (Netlify Forms): `notify`, `preorder`, `review`

Square env vars: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENV` (sandbox | production).

## Back office — loveandink.co/admin

Sign in with Google (allowlist: jasminemorsini@gmail.com, venekoraw@gmail.com; override with `ADMIN_EMAILS`).

- `netlify/functions/auth.mjs` — verifies the Google ID token server-side, issues an HttpOnly session (Netlify Blobs)
- `netlify/functions/admin.mjs` — signed-in only: read/write Square items, sizes, prices, stock, photos, hide/restore
- `netlify/functions/catalog.mjs` — public: Love & Ink items from Square (categories `Tiny Legends · …`, `Lifestyle · …`, `Publishing · …`)
- `netlify/functions/content.mjs` — recipes, announcement bar, closet picks, hero reels (public read, admin write, history kept)
- `netlify/functions/sqimg.mjs` — redirects `/sqimg/:id` to the Square-hosted photo

Env vars: `GOOGLE_CLIENT_ID` (Google Cloud → OAuth web client, authorized origin `https://loveandink.co`), plus the Square vars above.
