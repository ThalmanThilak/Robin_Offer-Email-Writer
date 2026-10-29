# Offer Email Writer: guide for Thalman

## What is where
- `site/` is the whole website. Netlify publishes this folder as it is.
- `site/js/config.js` has the settings you may want to change: the model, the length targets, the number of web searches and the product list.
- `netlify.toml` tells Netlify which folder to publish and sets the security rules.
- `tests/` has the automated tests. Robin never needs them.

## Change the product list
1. On GitHub, open `site/js/config.js`.
2. Click the pencil icon (Edit this file).
3. Find `PRODUCT_GROUPS`.
4. To add a product, copy one line like this one and change it:
   `{ id: "glass", en: "Glass", de: "Glasversicherung" },`
   Give it a new `id` with small letters and no spaces. Keep the comma at the end.
5. To remove a product, delete its line.
6. Click "Commit changes". Netlify puts the new version live in about one minute.

Robin can also add his own products himself, under Settings, My products.

## Change the length targets
In `site/js/config.js`, find `LENGTH_WORDS`:
- `base` is the word target for an email with one product.
- `extraPerProduct` is added for each extra product.
Robin never sees these numbers.

## Change the model
Each email uses two steps:
1. Research: web search on the home country and Germany. Model: `MODEL_RESEARCH`.
2. Writing: the email from the research notes, without web search. Model: `MODEL_WRITE`.
The edit buttons (Shorter, Longer, Warmer, More formal) use `MODEL_WRITE` and never search again.

In `site/js/config.js`, change these lines:
`export const MODEL_RESEARCH = "claude-sonnet-5-5";`
`export const MODEL_WRITE = "claude-sonnet-5-5";`
Use an exact model name from the Anthropic models page: https://platform.claude.com/docs/en/about-claude/models/overview

## Change the number of web searches
In `site/js/config.js`, change `MAX_SEARCHES`. Each search costs 1 US cent.

## Change the closing line
In `site/js/config.js`, change `CLOSINGS`. The tool leaves the closing out when Robin's signature already starts with one.

## Remove products (Robin can do this himself)
In Settings, under My products, each product has a "Remove" button. A removed product no longer shows in "Products to offer". It still shows in "Products the client already has". "Restore default products" brings back the default list and keeps Robin's own products and saved facts.

## Redeploy
Netlify watches the `main` branch on GitHub. Every saved change on `main` goes live by itself in about one minute.
To check: open app.netlify.com, open the project, then click "Deploys". The newest deploy shows "Published".

## Update the Anthropic SDK file (rarely needed)
The site uses a copy of the official Anthropic SDK in `site/vendor/anthropic-sdk.js`. To update it, a developer runs:
```bash
npm install
```
```bash
npm run build-sdk
```

## Run the tests (developer)
```bash
npm test
```
