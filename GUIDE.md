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

## Insurance comparison
The research also looks for the same kind of insurance in the client's home country: its local name, if the law requires it, how common it is. The email shows this in a short block with two bullet points, one for the home country and one for Germany. In "Facts to check" these facts have the label "This insurance in (country)".

## Notes from the call or meeting
Robin can type notes about the client in "Client details". The email uses them. The notes go to Claude without the client's name. They are not saved.

## Saved research
The facts for one country and one product are saved in Robin's browser (localStorage). There is no database. The next email for the same country and product uses the saved facts, so it is faster and needs no web search.
- No client details are saved. The saved facts are about the country and the product only.
- Facts are kept for 90 days. To change this, edit `RESEARCH_KEEP_DAYS` in `site/js/config.js`.
- "Search again" in "Facts to check" runs a new web search and replaces the saved facts.
- Settings, Saved research shows how many are saved and has a delete button.
- If Robin clears "cookies and site data" in his browser, the saved facts are gone. The tool then searches the web again. Clearing only the history or the cache does not delete them.

## Follow-up emails
After an email is written, "Write follow-up email" writes a short second email for a client who did not reply. A second click writes a third and last email. Both use the same facts and need no web search.
- Nothing is saved. The follow-up emails are gone when Robin reloads the page or writes an email for another client.
- Robin should copy all emails right away, for example into Outlook drafts or with a delayed send.
- To change the length, edit `FOLLOW_UP_WORDS` in `site/js/config.js`.

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
