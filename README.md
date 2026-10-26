# Love & Ink — loveandink.co

Static site deployed on Netlify (publish dir `site/`, functions in `netlify/functions/`).

- `site/` — Love & Ink (Home, Prints, Publishing, Lifestyle) + `site/tinylegends/` (Tiny Legends Adventures, also embedded as the fifth world)
- `netlify/functions/checkout.mjs` — Square payment links from catalog SKUs (off until `LI_PAY_MODE` is "square")
- `netlify/functions/stock.mjs` — live stock by SKU
- Forms (Netlify Forms): `notify`, `preorder`, `review`

Square env vars: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENV` (sandbox | production).
