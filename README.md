# twitter-cli

Browse Twitter/X from your terminal. Cookie-based auth — no OAuth app or API key needed.

## Install

```bash
git clone https://github.com/jabreeflor/twitter-cli
cd twitter-cli
npm install
npm link   # makes 'twitter' available globally
```

## Setup (first time)

```bash
twitter auth
```

You'll be prompted for two cookies from your browser session:

1. Log in to [twitter.com](https://twitter.com)
2. Open DevTools → Application → Cookies → `twitter.com`
3. Copy `auth_token` and `ct0`

Credentials saved to `~/.twitter-cli/config.json` (mode 600).

## Commands

```
twitter auth                  Set up / refresh auth
twitter timeline [--limit=N]  Home timeline
twitter search <query>        Search tweets
twitter user <handle>         User profile + recent tweets
twitter bookmarks [--limit=N] Your saved bookmarks
twitter tweet <id|url>        View tweet + replies
```

## Examples

```bash
twitter timeline --limit=30
twitter search "claude anthropic"
twitter user @OpenAI
twitter bookmarks --limit=50
twitter tweet 1234567890
twitter tweet https://twitter.com/user/status/1234567890
```

## Auth notes

- Uses Twitter's internal API (same approach as Twitter's own web app)
- Cookies expire when you log out of Twitter in your browser
- If you get auth errors, run `twitter auth` again to refresh
- Config stored at `~/.twitter-cli/config.json`

## Related

- [twitter-bookmark-ingestion](https://github.com/jabreeflor/twitter-bookmark-ingestion) — automated Discord pipeline for bookmarks
