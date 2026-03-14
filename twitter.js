#!/usr/bin/env node
/**
 * twitter-cli — Browse Twitter/X from your terminal
 * Uses cookie-based auth (auth_token + ct0 from browser cookies).
 * No OAuth app required.
 *
 * Commands:
 *   twitter auth                      Set up auth (prompts for cookies)
 *   twitter timeline [--limit N]      Home timeline
 *   twitter search <query> [--limit N] Search tweets
 *   twitter user <handle> [--limit N] User profile + recent tweets
 *   twitter bookmarks [--limit N]     Your saved bookmarks
 *   twitter tweet <id>                View a single tweet + replies
 */

import https from "https";
import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const { default: chalk } = await import("chalk");

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG_DIR  = path.join(os.homedir(), ".twitter-cli");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
  fs.chmodSync(CONFIG_FILE, 0o600);
}

// ── Twitter API client ─────────────────────────────────────────────────────────
const API = "https://twitter.com/i/api";
const BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

function request(cfg, method, url, body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const headers = {
      "Authorization":    `Bearer ${BEARER}`,
      "Cookie":           `auth_token=${cfg.auth_token}; ct0=${cfg.ct0}`,
      "X-Csrf-Token":     cfg.ct0,
      "X-Twitter-Active-User": "yes",
      "X-Twitter-Auth-Type":   "OAuth2Session",
      "X-Twitter-Client-Language": "en",
      "Content-Type":     "application/json",
      "User-Agent":       "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept":           "*/*",
      "Accept-Language":  "en-US,en;q=0.9",
      "Referer":          "https://twitter.com/",
      "Origin":           "https://twitter.com",
    };
    const bodyBuf = body ? Buffer.from(JSON.stringify(body)) : null;
    if (bodyBuf) headers["Content-Length"] = bodyBuf.length;

    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
      timeout: 15000,
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error(`Auth failed (${res.statusCode}) — run 'twitter auth' to refresh cookies`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Parse error (${res.statusCode}): ${data.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ── Variables for API v2 GraphQL features ─────────────────────────────────────
const TWEET_FIELDS = "id,text,created_at,public_metrics,author_id,attachments";
const USER_FIELDS  = "id,name,username,description,public_metrics,verified,profile_image_url";
const EXPANSIONS   = "author_id,attachments.media_keys";

// ── Formatters ────────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m`;
  if (s < 86400) return `${Math.floor(s/3600)}h`;
  if (s < 604800) return `${Math.floor(s/86400)}d`;
  return new Date(dateStr).toLocaleDateString();
}

function fmtNum(n) {
  if (!n) return "0";
  if (n >= 1000000) return `${(n/1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n/1000).toFixed(1)}k`;
  return String(n);
}

function wrap(text, width = 88, indent = "  ") {
  if (!text) return "";
  return text.replace(/\n+/g, " ").split(" ").reduce((lines, word) => {
    const last = lines[lines.length - 1];
    if (last.length + word.length + 1 <= width) lines[lines.length - 1] = last + (last === indent ? "" : " ") + word;
    else lines.push(indent + word);
    return lines;
  }, [indent]).join("\n");
}

function hr(char = "─", len = 80) {
  return chalk.gray(char.repeat(len));
}

// ── Render tweet ──────────────────────────────────────────────────────────────
function renderTweet(tweet, user, i = null, showFull = false) {
  const metrics = tweet.public_metrics || {};
  const name    = chalk.bold.white(user?.name || "Unknown");
  const handle  = chalk.gray(`@${user?.username || "?"}`);
  const age     = chalk.gray(timeAgo(tweet.created_at));
  const likes   = chalk.red(`♥ ${fmtNum(metrics.like_count)}`);
  const rts     = chalk.green(`↺ ${fmtNum(metrics.retweet_count)}`);
  const replies = chalk.blue(`💬 ${fmtNum(metrics.reply_count)}`);
  const num     = i !== null ? chalk.gray(`${String(i+1).padStart(2)}.`) : "  ";

  console.log(`${num} ${name} ${handle}  ${age}`);
  console.log(wrap(tweet.text, 88, "    "));
  console.log(`     ${likes}  ${rts}  ${replies}  ${chalk.dim(`twitter tweet ${tweet.id}`)}`);
  console.log();
}

// ── Build user index from includes ────────────────────────────────────────────
function buildUserMap(includes) {
  const map = {};
  for (const u of includes?.users || []) map[u.id] = u;
  return map;
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdAuth() {
  console.log(`
${chalk.bold.cyan("twitter-cli auth setup")}

You need two cookies from your browser after logging in to twitter.com:
  ${chalk.yellow("auth_token")} — your session token
  ${chalk.yellow("ct0")}       — CSRF token

${chalk.bold("How to get them:")}
  1. Open Twitter in Chrome/Firefox
  2. Open DevTools → Application → Cookies → twitter.com
  3. Copy the values for auth_token and ct0

`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(r => rl.question(q, r));

  const auth_token = (await ask(chalk.yellow("auth_token: "))).trim();
  const ct0        = (await ask(chalk.yellow("ct0: "))).trim();
  rl.close();

  if (!auth_token || !ct0) {
    console.log(chalk.red("Both values are required."));
    process.exit(1);
  }

  saveConfig({ auth_token, ct0 });
  console.log(chalk.green(`\n✓ Auth saved to ${CONFIG_FILE}`));

  // Quick verify
  try {
    const cfg = { auth_token, ct0 };
    const data = await request(cfg, "GET",
      `${API}/2/timeline/home.json?count=1&tweet_mode=extended`);
    console.log(chalk.green("✓ Auth verified — you're logged in!"));
  } catch (e) {
    console.log(chalk.yellow(`⚠ Could not verify auth: ${e.message}`));
    console.log("  Auth saved anyway — try 'twitter timeline' to test.");
  }
}

async function cmdTimeline(cfg, args) {
  const limit = parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] || "20");

  // Use Twitter's v2 timeline API
  const params = new URLSearchParams({
    expansions: EXPANSIONS,
    "tweet.fields": TWEET_FIELDS,
    "user.fields": USER_FIELDS,
    max_results: Math.min(limit, 100),
  });

  let data;
  try {
    data = await request(cfg, "GET", `${API}/2/timeline/home?${params}`);
  } catch (e) {
    // Fallback to v1.1
    data = await request(cfg, "GET",
      `${API}/1.1/statuses/home_timeline.json?count=${limit}&tweet_mode=extended`);
    if (Array.isArray(data)) {
      console.log(`\n${chalk.bold.white("Home Timeline")}\n${hr()}\n`);
      data.forEach((t, i) => {
        renderTweet(
          { ...t, public_metrics: {like_count:t.favorite_count,retweet_count:t.retweet_count,reply_count:0}, created_at: t.created_at },
          t.user, i
        );
      });
      return;
    }
    throw e;
  }

  const tweets  = data.data || [];
  const userMap = buildUserMap(data.includes);

  if (!tweets.length) return console.log(chalk.yellow("No tweets in timeline."));

  console.log(`\n${chalk.bold.white("Home Timeline")}\n${hr()}\n`);
  tweets.forEach((t, i) => renderTweet(t, userMap[t.author_id], i));
}

async function cmdSearch(cfg, query, args) {
  if (!query) return console.log(chalk.red("Usage: twitter search <query> [--limit=N]"));
  const limit = parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] || "20");

  const params = new URLSearchParams({
    q: query,
    count: limit,
    tweet_mode: "extended",
    result_type: "recent",
  });

  const data = await request(cfg, "GET",
    `${API}/1.1/search/tweets.json?${params}`);

  const tweets = data.statuses || [];
  if (!tweets.length) return console.log(chalk.red(`No results for "${query}"`));

  console.log(`\n${chalk.bold.white(`Search: "${query}"`)}\n${hr()}\n`);
  tweets.forEach((t, i) => {
    renderTweet(
      { ...t, id: t.id_str, text: t.full_text || t.text,
        public_metrics: { like_count: t.favorite_count, retweet_count: t.retweet_count, reply_count: t.reply_count || 0 },
        created_at: t.created_at },
      t.user, i
    );
  });
}

async function cmdUser(cfg, handle, args) {
  if (!handle) return console.log(chalk.red("Usage: twitter user <handle> [--limit=N]"));
  const limit = parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] || "20");
  const cleanHandle = handle.replace(/^@/, "");

  // Get user info
  const userParams = new URLSearchParams({ screen_name: cleanHandle, include_entities: true });
  const user = await request(cfg, "GET", `${API}/1.1/users/show.json?${userParams}`);

  if (user.errors) throw new Error(`User not found: @${cleanHandle}`);

  console.log(`\n${hr("═")}`);
  console.log(`${chalk.bold.white(user.name)} ${chalk.gray(`@${user.screen_name}`)}` +
    (user.verified ? chalk.blue(" ✓") : ""));
  if (user.description) console.log(wrap(user.description, 88, ""));
  console.log();
  console.log(`${chalk.yellow("Tweets:")} ${fmtNum(user.statuses_count)}  ` +
    `${chalk.yellow("Following:")} ${fmtNum(user.friends_count)}  ` +
    `${chalk.yellow("Followers:")} ${fmtNum(user.followers_count)}`);
  if (user.location) console.log(`${chalk.gray("📍")} ${user.location}`);
  if (user.url) console.log(`${chalk.blue(user.url)}`);
  console.log(`${hr("═")}\n`);

  // Get their tweets
  const tweetParams = new URLSearchParams({
    screen_name: cleanHandle,
    count: limit,
    tweet_mode: "extended",
    exclude_replies: false,
    include_rts: true,
  });
  const timeline = await request(cfg, "GET", `${API}/1.1/statuses/user_timeline.json?${tweetParams}`);
  if (!Array.isArray(timeline) || !timeline.length) {
    return console.log(chalk.yellow("No recent tweets."));
  }

  console.log(`${chalk.bold.white("Recent Tweets")}\n${hr()}\n`);
  timeline.forEach((t, i) => {
    renderTweet(
      { ...t, id: t.id_str, text: t.full_text || t.text,
        public_metrics: { like_count: t.favorite_count, retweet_count: t.retweet_count, reply_count: t.reply_count || 0 },
        created_at: t.created_at },
      user, i
    );
  });
}

async function cmdBookmarks(cfg, args) {
  const limit = parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] || "20");

  // Twitter v2 bookmarks endpoint
  // First get user ID
  const meData = await request(cfg, "GET", `${API}/2/users/me?user.fields=id,name,username`);
  const userId = meData.data?.id;
  if (!userId) throw new Error("Could not get user ID — check your auth");

  const params = new URLSearchParams({
    expansions: EXPANSIONS,
    "tweet.fields": TWEET_FIELDS,
    "user.fields": USER_FIELDS,
    max_results: Math.min(limit, 100),
  });

  const data = await request(cfg, "GET", `${API}/2/users/${userId}/bookmarks?${params}`);
  const tweets  = data.data || [];
  const userMap = buildUserMap(data.includes);

  if (!tweets.length) return console.log(chalk.yellow("No bookmarks found."));

  console.log(`\n${chalk.bold.white("Bookmarks")}\n${hr()}\n`);
  tweets.forEach((t, i) => renderTweet(t, userMap[t.author_id], i));
}

async function cmdTweet(cfg, id) {
  if (!id) return console.log(chalk.red("Usage: twitter tweet <id>"));
  const tweetId = id.match(/\d+/)?.[0];
  if (!tweetId) return console.log(chalk.red("Invalid tweet ID or URL"));

  const params = new URLSearchParams({ id: tweetId, tweet_mode: "extended" });
  const t = await request(cfg, "GET", `${API}/1.1/statuses/show.json?${params}`);

  if (t.errors) throw new Error(`Tweet not found: ${tweetId}`);

  console.log(`\n${hr("═")}`);
  renderTweet(
    { ...t, id: t.id_str, text: t.full_text || t.text,
      public_metrics: { like_count: t.favorite_count, retweet_count: t.retweet_count, reply_count: t.reply_count || 0 },
      created_at: t.created_at },
    t.user
  );
  console.log(`${chalk.dim(`https://twitter.com/${t.user.screen_name}/status/${tweetId}`)}`);
  console.log(hr("═"));

  // Get replies (search for them)
  try {
    const replyParams = new URLSearchParams({
      q: `to:${t.user.screen_name} conversation_id:${tweetId}`,
      count: 20,
      tweet_mode: "extended",
      result_type: "recent",
    });
    const replies = await request(cfg, "GET", `${API}/1.1/search/tweets.json?${replyParams}`);
    const rtweets = (replies.statuses || []).filter(r => r.in_reply_to_status_id_str === tweetId);
    if (rtweets.length) {
      console.log(`\n${chalk.bold("Replies")}\n${hr()}\n`);
      rtweets.forEach((r, i) => {
        renderTweet(
          { ...r, id: r.id_str, text: r.full_text || r.text,
            public_metrics: { like_count: r.favorite_count, retweet_count: r.retweet_count, reply_count: r.reply_count || 0 },
            created_at: r.created_at },
          r.user, i
        );
      });
    }
  } catch { /* replies are best-effort */ }
}

function usage() {
  console.log(`
${chalk.bold.cyan("twitter-cli")} — Browse Twitter/X from your terminal

${chalk.bold("Setup (first time):")}
  twitter auth

${chalk.bold("Commands:")}
  twitter timeline [--limit=N]       Home timeline
  twitter search <query>             Search tweets
  twitter user <handle>              User profile + recent tweets
  twitter bookmarks [--limit=N]      Your saved bookmarks
  twitter tweet <id|url>             View single tweet + replies

${chalk.bold("Examples:")}
  twitter timeline --limit=30
  twitter search "claude anthropic"
  twitter user @OpenAI
  twitter bookmarks
  twitter tweet 1234567890

${chalk.bold("Config:")} ${CONFIG_FILE}
`);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
const [,, cmd, ...rest] = process.argv;

if (cmd === "auth") {
  await cmdAuth();
  process.exit(0);
}

const cfg = loadConfig();
if (!cfg) {
  console.log(chalk.red("Not authenticated. Run: twitter auth"));
  process.exit(1);
}

try {
  switch (cmd) {
    case "timeline":  await cmdTimeline(cfg, rest); break;
    case "search":    await cmdSearch(cfg, rest[0], rest.slice(1)); break;
    case "user":      await cmdUser(cfg, rest[0], rest.slice(1)); break;
    case "bookmarks": await cmdBookmarks(cfg, rest); break;
    case "tweet":     await cmdTweet(cfg, rest[0]); break;
    default:          usage();
  }
} catch (e) {
  console.error(chalk.red(`Error: ${e.message}`));
  process.exit(1);
}
