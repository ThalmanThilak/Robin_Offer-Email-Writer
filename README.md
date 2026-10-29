# Offer Email Writer

A static web page that writes calm, clear sales emails for an insurance agent in Germany. It compares how a real-life case works in the client's home country and in Germany, using Claude with web search.

- No backend, no database, no login. The browser calls the Claude API directly with the user's own API key.
- Settings are saved in the browser only (localStorage).
- The client's first and last name never leave the browser. Claude only sees placeholders.
- The page may only connect to api.anthropic.com (Content Security Policy).

See [GUIDE.md](GUIDE.md) for how to change the product list, the length targets and the model, and how to redeploy.
