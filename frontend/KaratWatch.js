// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: gray; icon-glyph: magic;
// KARATWATCH — SCRIPTABLE
// Configurable Indian city; Ahmedabad by default
//
// Widget parameters:
// today        gold 24k + 22k + silver
// gold         gold 24k + 22k history
// gold:7       gold 24k + 22k, 7 rows
// gold:24k     gold 24k only
// gold:22k     gold 22k only
// gold:22k:7   gold 22k only, 7 rows
// silver
// silver:7
//
// The number (2–10) is how many history
// rows to show. Days with unchanged prices
// (weekends, holidays) merge into one row.

// ======================================
// CONFIGURATION
// ======================================

const SETTINGS = {
  city: "Ahmedabad",
  serverURL: "", // Optional: your authenticated /api/metals endpoint
  webTimeoutSeconds: 12,
  serverTimeoutSeconds: 6,
  // Prices are fetched once a day at this
  // local time. Tapping the widget or using
  // "Refresh prices now" fetches immediately.
  refreshHour: 5,
  refreshMinute: 0,
  defaultHistoryDays: 4
};

// Credentials are stored separately
// in Scriptable Keychain.

const KEYS = {
  id: "metals.cf-id",
  secret: "metals.cf-secret",
  api: "metals.api-key"
};

const fm = FileManager.local();

// Use the Goodreturns city name or URL slug, e.g. Mumbai or Bangalore.
function resolveCity(value) {
  const input = String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
  const aliases = { bengaluru: "bangalore", gurugram: "gurgaon" };
  const slug = aliases[input] || input;
  if (!/^[a-z]+(?:-[a-z]+)*$/.test(slug) || slug.length > 60) {
    throw Error("Enter a city name or Goodreturns city slug, not a URL.");
  }
  return { slug, name: slug.split("-").map(x => x[0].toUpperCase() + x.slice(1)).join(" ") };
}

function cityStoragePath(kind, version, slug) {
  // Keep existing Ahmedabad files compatible with installed widgets.
  const suffix = slug === "ahmedabad" ? "" : "-" + slug;
  return fm.joinPath(fm.documentsDirectory(), `precious-metals-${kind}-v${version}${suffix}.json`);
}

const locationFile = fm.joinPath(fm.documentsDirectory(), "karatwatch-location-v1.json");
let location, cacheFile, retryFile, alertsFile;
function applyCity(value) {
  location = resolveCity(value);
  SETTINGS.city = location.name;
  cacheFile = cityStoragePath("cache", 2, location.slug);
  retryFile = cityStoragePath("retry", 2, location.slug);
  alertsFile = cityStoragePath("alerts", 1, location.slug);
}
applyCity(SETTINGS.city);
try {
  const savedLocation = readFile(locationFile);
  if (savedLocation) applyCity(savedLocation.slug);
} catch (_) { /* A corrupt preference must not prevent widget startup. */ }

function sourceURL(metal) {
  if (!["gold", "silver"].includes(metal)) throw Error("Invalid metal");
  return `https://www.goodreturns.in/${metal}-rates/${location.slug}.html`;
}

// Only links from the Indian cities table are passed here, never country rates.
function parseCityLinks(links) {
  const cities = new Map();
  for (const link of links) {
    const match = String(link.href).match(/^(?:https:\/\/www\.goodreturns\.in)?\/gold-rates\/([a-z]+(?:-[a-z]+)*)\.html$/);
    if (!match) continue;
    const city = resolveCity(match[1]);
    cities.set(city.slug, city);
  }
  return Array.from(cities.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function availableCities() {
  const path = fm.joinPath(fm.documentsDirectory(), "karatwatch-cities-v1.json");
  try {
    const req = new Request("https://www.goodreturns.in/gold-rates/");
    req.timeoutInterval = SETTINGS.webTimeoutSeconds;
    const html = await req.loadString();
    if (Number((req.response || {}).statusCode) !== 200) throw Error("Directory unavailable");
    const view = new WebView();
    await view.loadHTML("<html><body></body></html>");
    const links = await view.evaluateJavaScript(`(() => {
      const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, "text/html");
      let indianCities = false;
      const links = [];
      for (const node of doc.querySelectorAll("h2, h3, table")) {
        if (/^H[23]$/.test(node.tagName)) {
          indianCities = /Indian Major Cities Gold Rates/i.test(node.textContent);
        } else if (indianCities) {
          for (const a of node.querySelectorAll("a[href]")) {
            links.push({ href: a.getAttribute("href") });
          }
        }
      }
      return links;
    })()`);
    const cities = parseCityLinks(links);
    if (!cities.length) throw Error("City directory format changed");
    saveFile(path, links);
    return { cities, cached: false };
  } catch (_) {
    const saved = readFile(path);
    return { cities: Array.isArray(saved) ? parseCityLinks(saved) : [], cached: true };
  }
}

async function changeCity() {
  const directory = await availableCities();
  const options = directory.cities.map(city => city.name);
  options.push("Enter another city manually");
  const selected = await choose(directory.cached ? "Choose city (offline list)" : "Choose city", options);
  if (selected < 0) return;
  let value;
  if (selected < directory.cities.length) {
    value = directory.cities[selected].slug;
  } else {
    const a = new Alert();
    a.title = "Indian city";
    a.message = "Enter the city slug from its Goodreturns URL, e.g. Mumbai or Bangalore. Both gold and silver pages must exist. API mode requires the server to return the same city.";
    a.addTextField("City", location.slug);
    a.addAction("Save");
    a.addCancelAction("Cancel");
    if (await a.presentAlert() !== 0) return;
    value = a.textFieldValue(0);
  }
  try {
    const next = resolveCity(value);
    fm.writeString(locationFile, JSON.stringify({ slug: next.slug }));
    applyCity(next.slug);
  } catch (e) {
    await showAlert("City not saved", String(e.message || e));
    return;
  }
  await refreshNow();
}

const ALERT_METALS = [
  {
    key: "gold24k",
    name: "Gold 24K",
    unit: "per 10g",
    value: d => d.gold["24k"]
  },
  {
    key: "gold22k",
    name: "Gold 22K",
    unit: "per 10g",
    value: d => d.gold["22k"]
  },
  {
    key: "silver",
    name: "Silver",
    unit: "per kg",
    value: d => d.silver.price
  }
];

const months = [
  "Jan", "Feb", "Mar", "Apr",
  "May", "Jun", "Jul", "Aug",
  "Sep", "Oct", "Nov", "Dec"
];

// ======================================
// DAILY SCHEDULE
// ======================================

// Most recent scheduled refresh time
// at or before `now`, shifted by
// `offsetDays` (0 = last, 1 = next).

function scheduledRefresh(now, offsetDays) {
  const d = new Date(now);

  d.setHours(
    SETTINGS.refreshHour,
    SETTINGS.refreshMinute,
    0,
    0
  );

  if (d.getTime() > now) {
    d.setDate(d.getDate() - 1);
  }

  d.setDate(d.getDate() + offsetDays);

  return d.getTime();
}

function lastScheduledRefresh(now) {
  return scheduledRefresh(now, 0);
}

function nextScheduledRefresh(now) {
  return scheduledRefresh(now, 1);
}

// ======================================
// THEME
// ======================================

const colors = {
  bg: Color.dynamic(
    new Color("#F7F8FA"),
    new Color("#131820")
  ),
  ink: Color.dynamic(
    new Color("#15202D"),
    new Color("#FAFBFE")
  ),
  muted: Color.dynamic(
    new Color("#626D7B"),
    new Color("#9EACBC")
  ),
  line: Color.dynamic(
    new Color("#DDE3E9"),
    new Color("#333F4C")
  ),
  gold: Color.dynamic(
    new Color("#987022"),
    new Color("#EEC77A")
  ),
  silver: Color.dynamic(
    new Color("#4B708A"),
    new Color("#C5D7E4")
  ),
  up: Color.dynamic(
    new Color("#16774C"),
    new Color("#75DEAB")
  ),
  down: Color.dynamic(
    new Color("#AB3146"),
    new Color("#F79BA9")
  ),
  warning: Color.dynamic(
    new Color("#8C6210"),
    new Color("#ECC67D")
  )
};

// ======================================
// VALIDATION
// ======================================

function object(x) {
  return x &&
    typeof x === "object" &&
    !Array.isArray(x);
}

function price(x) {
  return typeof x === "number" &&
    isFinite(x) &&
    x > 0;
}

function dayTime(s) {
  if (
    typeof s !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s)
  ) return NaN;

  const y = +s.slice(0, 4);
  const m = +s.slice(5, 7);
  const d = +s.slice(8);

  const t = Date.UTC(y, m - 1, d);
  const z = new Date(t);

  return (
    z.getUTCFullYear() === y &&
    z.getUTCMonth() === m - 1 &&
    z.getUTCDate() === d
  ) ? t : NaN;
}

function timestamp(s) {
  return typeof s === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(s) &&
    isFinite(Date.parse(s));
}

function parseMode(input) {
  const value = String(
    input || "today"
  ).trim().toLowerCase();

  if (value === "today") {
    return { type: "today", days: 0 };
  }

  const p = value.split(":");
  const type = p[0];

  if (type !== "gold" && type !== "silver") {
    return {
      error: "Use today, gold, gold:24k, gold:22k, or silver."
    };
  }

  // "both" = combined 24k + 22k widget
  let purity = "both";
  let days = SETTINGS.defaultHistoryDays;

  if (type === "gold") {
    if (p.length > 3) {
      return {
        error: "Use gold:7, gold:22k:7 or gold:24k:7."
      };
    }

    if (
      p[1] &&
      /^(22k|24k)$/.test(p[1])
    ) {
      purity = p[1];

      if (p[2]) days = Number(p[2]);

    } else if (
      p[1] &&
      /^\d+$/.test(p[1]) &&
      p.length === 2
    ) {
      days = Number(p[1]);

    } else if (p[1]) {
      return {
        error: "Invalid gold purity or history length."
      };
    }

  } else {
    if (p.length > 2) {
      return {
        error: "Use silver or silver:7."
      };
    }

    if (p[1]) days = Number(p[1]);
  }

  if (
    !Number.isInteger(days) ||
    days < 2 ||
    days > 10
  ) {
    return {
      error: "History length must be 2–10."
    };
  }

  return type === "gold"
    ? { type, purity, days }
    : { type, days };
}

function validateHistory(items, fields) {
  if (
    !Array.isArray(items) ||
    items.length > 50
  ) {
    throw Error("Invalid history");
  }

  const byDate = {};

  for (const item of items) {
    if (
      !object(item) ||
      !isFinite(dayTime(item.date))
    ) {
      throw Error("Invalid history date");
    }

    for (const key of fields) {
      if (!price(item[key])) {
        throw Error("Invalid history price");
      }
    }

    if (byDate[item.date]) {
      if (
        fields.some(
          k => byDate[item.date][k] !== item[k]
        )
      ) {
        throw Error("Conflicting historical entries");
      }
    } else {
      byDate[item.date] = item;
    }
  }

  return Object.keys(byDate)
    .sort()
    .reverse()
    .slice(0, 10)
    .map(k => byDate[k]);
}

function validate(raw) {
  if (
    !object(raw) ||
    raw.city !== SETTINGS.city ||
    !timestamp(raw.updatedAt) ||
    typeof raw.stale !== "boolean"
  ) {
    throw Error("Invalid response metadata");
  }

  if (
    !object(raw.gold) ||
    !object(raw.silver) ||
    !price(raw.gold["24k"]) ||
    !price(raw.gold["22k"]) ||
    !price(raw.silver.price)
  ) {
    throw Error("Invalid current prices");
  }

  return {
    city: raw.city,
    updatedAt: raw.updatedAt,
    stale: raw.stale,

    gold: {
      "24k": raw.gold["24k"],
      "22k": raw.gold["22k"],
      history: validateHistory(
        raw.gold.history,
        ["24k", "22k"]
      )
    },

    silver: {
      price: raw.silver.price,
      history: validateHistory(
        raw.silver.history,
        ["price"]
      )
    },

    source: (
      object(raw.source) &&
      typeof raw.source.provider === "string"
    )
      ? raw.source.provider.slice(0, 30)
      : "Metals API"
  };
}

// ======================================
// LOCAL STORAGE
// ======================================

function readFile(path) {
  try {
    return fm.fileExists(path)
      ? JSON.parse(fm.readString(path))
      : null;
  } catch (_) {
    return null;
  }
}

function saveFile(path, data) {
  try {
    fm.writeString(
      path,
      JSON.stringify(data)
    );
  } catch (_) {}
}

function clearRetry() {
  try {
    if (fm.fileExists(retryFile)) {
      fm.remove(retryFile);
    }
  } catch (_) {}
}

function cached() {
  const c = readFile(cacheFile);

  if (
    !object(c) ||
    !timestamp(c.retrievedAt)
  ) {
    return null;
  }

  try {
    return {
      data: validate(c.data),
      retrievedAt: c.retrievedAt
    };
  } catch (_) {
    return null;
  }
}

// ======================================
// PRICE ALERTS
// ======================================

function readAlerts() {
  const a = readFile(alertsFile);
  return object(a) ? a : {};
}

// Human-readable list of thresholds the
// current prices have crossed.

function triggeredAlerts(data) {
  const alerts = readAlerts();
  const out = [];

  for (const m of ALERT_METALS) {
    const rule = alerts[m.key];

    if (!object(rule)) continue;

    const v = m.value(data);

    if (price(rule.above) && v >= rule.above) {
      out.push(
        m.name + " " + money(v) +
        " is at or above " + money(rule.above)
      );
    }

    if (price(rule.below) && v <= rule.below) {
      out.push(
        m.name + " " + money(v) +
        " is at or below " + money(rule.below)
      );
    }
  }

  return out;
}

// Posts one notification per crossed
// threshold. Only runs in-app (tap or
// menu refresh); widgets cannot notify.

async function notifyAlerts(data) {
  const hits = triggeredAlerts(data);

  for (const text of hits) {
    try {
      const n = new Notification();

      n.title = "KaratWatch alert";
      n.body = text;
      n.sound = "default";

      await n.schedule();
    } catch (_) {}
  }

  return hits;
}

function alertSummary(rule) {
  const parts = [];

  if (object(rule)) {
    if (price(rule.above)) {
      parts.push("above " + money(rule.above));
    }

    if (price(rule.below)) {
      parts.push("below " + money(rule.below));
    }
  }

  return parts.length ? parts.join(", ") : "off";
}

async function editAlerts() {
  while (true) {
    const alerts = readAlerts();

    const m = await choose(
      "Price alerts",
      ALERT_METALS.map(
        x => x.name + ": " + alertSummary(alerts[x.key])
      )
    );

    if (m < 0) return;

    const metal = ALERT_METALS[m];
    const rule = alerts[metal.key] || {};

    const a = new Alert();

    a.title = metal.name + " alert";

    a.message =
      "Rupees " + metal.unit +
      ". Leave a field empty to turn that side off.";

    const above = a.addTextField(
      "Notify at or above",
      price(rule.above) ? String(rule.above) : ""
    );

    const below = a.addTextField(
      "Notify at or below",
      price(rule.below) ? String(rule.below) : ""
    );

    above.setDecimalPadKeyboard();
    below.setDecimalPadKeyboard();

    a.addAction("Save");
    a.addCancelAction("Cancel");

    if (await a.presentAlert() !== 0) continue;

    const parse = s => {
      const n = Number(
        String(s).replace(/[^\d.]/g, "")
      );

      return price(n) ? n : null;
    };

    const next = {
      above: parse(a.textFieldValue(0)),
      below: parse(a.textFieldValue(1))
    };

    if (next.above === null && next.below === null) {
      delete alerts[metal.key];
    } else {
      alerts[metal.key] = next;
    }

    saveFile(alertsFile, alerts);
  }
}

// ======================================
// KEYCHAIN CREDENTIALS
// ======================================

function credentials() {
  try {
    if (
      !Object.values(KEYS).every(
        k => Keychain.contains(k)
      )
    ) {
      return null;
    }

    const out = {
      id: Keychain.get(KEYS.id),
      secret: Keychain.get(KEYS.secret),
      api: Keychain.get(KEYS.api)
    };

    return (
      out.id &&
      out.secret &&
      out.api
    ) ? out : null;

  } catch (_) {
    return null;
  }
}

async function showAlert(title, body) {
  const a = new Alert();

  a.title = title;
  a.message = body;
  a.addAction("OK");

  await a.presentAlert();
}

async function setup() {
  const a = new Alert();

  a.title = "Private API credentials";

  a.message =
    "Enter the Cloudflare service token ID, " +
    "secret, and backend API key. " +
    "They will be stored in Scriptable Keychain.";

  a.addSecureTextField(
    "CF-Access-Client-Id",
    ""
  );

  a.addSecureTextField(
    "CF-Access-Client-Secret",
    ""
  );

  a.addSecureTextField(
    "X-Metals-Api-Key",
    ""
  );

  a.addAction("Save securely");
  a.addCancelAction("Cancel");

  if (await a.presentAlert() !== 0) {
    return;
  }

  const values = [0, 1, 2].map(
    i => a.textFieldValue(i).trim()
  );

  if (values.some(x => !x)) {
    return await showAlert(
      "Not saved",
      "All three values are required."
    );
  }

  Keychain.set(KEYS.id, values[0]);
  Keychain.set(KEYS.secret, values[1]);
  Keychain.set(KEYS.api, values[2]);

  clearRetry();

  await showAlert(
    "Saved",
    "Credentials saved to Keychain."
  );
}

// ======================================
// API REQUEST
// ======================================

function headerValue(headers, key) {
  if (!object(headers)) return "";

  const actual = Object.keys(headers).find(
    k => k.toLowerCase() === key.toLowerCase()
  );

  return actual
    ? String(headers[actual])
    : "";
}

function retryMilliseconds(value) {
  if (!value) return 15 * 60000;

  if (/^\d+$/.test(value.trim())) {
    return Math.max(
      60000,
      Math.min(
        86400000,
        Number(value) * 1000
      )
    );
  }

  const until = Date.parse(value);

  return isFinite(until)
    ? Math.max(
        60000,
        Math.min(
          86400000,
          until - Date.now()
        )
      )
    : 15 * 60000;
}

// Convert table cell text into the same units as the optional API.
function parseSourceTables(tables, metal) {
  const amount = text => {
    const match = String(text).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    if (!match || !price(Number(match[0]))) throw Error("Invalid source price");
    return Number(match[0]);
  };
  const current = tables[0] && tables[0].find(row => row[0] === "1");
  if (!current || !tables[1]) throw Error("Price tables unavailable");
  const history = tables[1].filter(row => /^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/.test(row[0])).map(row => {
    const match = row[0].match(/^(\w+)\s+(\d+),\s+(\d+)$/);
    const month = months.indexOf(match[1]) + 1;
    const date = `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
    if (!isFinite(dayTime(date))) throw Error("Invalid source date");
    return metal === "gold"
      ? { date, "24k": amount(row[1]) * 10, "22k": amount(row[2]) * 10 }
      : { date, price: amount(row[3]) };
  });
  if (!history.length) throw Error("Price history unavailable");
  return metal === "gold"
    ? { "24k": amount(current[1]) * 10, "22k": amount(current[2]) * 10, history }
    : { price: amount(current[1]) * 1000, history };
}

async function requestDirectPrices() {
  async function fetchMetal(metal) {
    const req = new Request(sourceURL(metal));
    req.timeoutInterval = SETTINGS.webTimeoutSeconds;
    const html = await req.loadString();
    if (Number((req.response || {}).statusCode) !== 200) {
      throw { label: "Goodreturns unavailable or blocked", wait: 15 * 60000 };
    }
    // Parse inert HTML locally. Do not execute remote scripts or load page assets.
    const view = new WebView();
    await view.loadHTML("<html><body></body></html>");
    const tables = await view.evaluateJavaScript(`(() => {
      const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, "text/html");
      return Array.from(doc.querySelectorAll("table.gr-table.table-conatiner"))
        .map(table => Array.from(table.querySelectorAll("tbody.tablebody tr"))
          .map(row => Array.from(row.querySelectorAll("td"))
            .map(cell => cell.textContent.trim())));
    })()`);
    return parseSourceTables(tables, metal);
  }
  const [gold, silver] = await Promise.all([fetchMetal("gold"), fetchMetal("silver")]);
  return validate({ city: SETTINGS.city, updatedAt: new Date().toISOString(),
    stale: false, gold, silver, source: { provider: "goodreturns" } });
}

// Scriptable does not require the browser URL API for query replacement.
function apiURL(value, slug) {
  const base = value.split("#")[0];
  const split = base.indexOf("?");
  const path = split < 0 ? base : base.slice(0, split);
  const query = split < 0 ? [] : base.slice(split + 1).split("&").filter(Boolean);
  const kept = query.filter(part => {
    try { return decodeURIComponent(part.split("=")[0]) !== "city"; }
    catch (_) { return true; }
  });
  kept.push("city=" + encodeURIComponent(slug));
  return path + "?" + kept.join("&");
}

async function requestPrices(auth) {
  const req = new Request(
    apiURL(SETTINGS.serverURL, location.slug)
  );

  req.method = "GET";
  req.timeoutInterval =
    SETTINGS.serverTimeoutSeconds;

  // ALL THREE HEADERS ARE REQUIRED

  req.headers = {
    "CF-Access-Client-Id": auth.id,
    "CF-Access-Client-Secret": auth.secret,
    "X-Metals-Api-Key": auth.api
  };

  let redirected = false;

  req.onRedirect = () => {
    redirected = true;
    return null;
  };

  let body;

  try {
    body = await req.loadString();
  } catch (_) {
    throw {
      label: redirected
        ? "Unexpected redirect"
        : "Network or timeout",
      wait: 10 * 60000
    };
  }

  const res = req.response || {};
  const code = Number(res.statusCode);

  if (code !== 200) {
    const labels = {
      401: "API authentication failed (401)",
      403: "Cloudflare Access denied (403)",
      429: "Rate limited (429)",
      503: "Upstream unavailable (503)"
    };

    throw {
      label: labels[code] ||
        (
          code >= 300 && code < 400
            ? "Unexpected redirect (" + code + ")"
            : "HTTP " + code
        ),

      wait: code === 429
        ? retryMilliseconds(
            headerValue(
              res.headers,
              "retry-after"
            )
          )
        : [401, 403].includes(code)
          ? 60 * 60000
          : 10 * 60000
    };
  }

  const mime = String(
    res.mimeType ||
    headerValue(
      res.headers,
      "content-type"
    ) ||
    ""
  ).toLowerCase();

  if (
    mime &&
    !mime.includes("json")
  ) {
    throw {
      label: "Unexpected HTML response",
      wait: 10 * 60000
    };
  }

  if (
    typeof body !== "string" ||
    !/^\s*\{/.test(body)
  ) {
    throw {
      label: "Invalid JSON body",
      wait: 10 * 60000
    };
  }

  try {
    return validate(
      JSON.parse(body)
    );
  } catch (_) {
    throw {
      label: "Invalid API data",
      wait: 10 * 60000
    };
  }
}

// ======================================
// FETCH + CACHE FALLBACK
// ======================================

async function loadPrices(force) {
  const cache = cached();
  const auth = credentials();
  const now = Date.now();

  const fallback = (reason, offline) => ({
    data: cache ? cache.data : null,
    retrievedAt: cache
      ? cache.retrievedAt
      : null,
    offline,
    reason
  });

  if (SETTINGS.serverURL && !auth) {
    return fallback(
      "Setup required",
      true
    );
  }

  // Already fetched since the last
  // scheduled refresh time: use cache.

  if (
    !force &&
    cache &&
    Date.parse(cache.retrievedAt) >=
      lastScheduledRefresh(now)
  ) {
    return fallback("", false);
  }

  const hold = readFile(retryFile);

  if (
    hold &&
    hold.until > now &&
    (
      !force ||
      hold.label === "Rate limited (429)"
    )
  ) {
    return fallback(
      hold.label || "Retry later",
      true
    );
  }

  try {
    const data = SETTINGS.serverURL
      ? await requestPrices(auth)
      : await requestDirectPrices();

    const retrievedAt =
      new Date().toISOString();

    saveFile(cacheFile, {
      retrievedAt,
      data
    });

    // A failure hold only exists after a
    // failed request; clear it on success.
    clearRetry();

    return {
      data,
      retrievedAt,
      offline: false,
      reason: ""
    };

  } catch (e) {
    const reason =
      (e && e.label) ||
      "Request failed";

    saveFile(retryFile, {
      until:
        now +
        (
          (e && e.wait) ||
          10 * 60000
        ),
      label: reason
    });

    return fallback(
      reason,
      true
    );
  }
}

// ======================================
// FORMATTING
// ======================================

function money(n) {
  if (
    typeof n !== "number" ||
    !isFinite(n)
  ) return "—";

  const rounded = String(
    Math.round(Math.abs(n))
  );

  const last = rounded.slice(-3);

  const first = rounded
    .slice(0, -3)
    .replace(
      /\B(?=(\d{2})+(?!\d))/g,
      ","
    );

  return "₹" +
    (first ? first + "," : "") +
    last;
}

function dateLabel(s) {
  if (!isFinite(dayTime(s))) {
    return "—";
  }

  return (
    String(+s.slice(8, 10)) +
    " " +
    months[+s.slice(5, 7) - 1]
  );
}

function ist(s) {
  if (!timestamp(s)) return "—";

  const d = new Date(
    Date.parse(s) + 330 * 60000
  );

  const hour = d.getUTCHours();

  return (
    d.getUTCDate() +
    " " +
    months[d.getUTCMonth()] +
    " " +
    (hour % 12 || 12) +
    ":" +
    String(
      d.getUTCMinutes()
    ).padStart(2, "0") +
    (hour >= 12 ? "pm" : "am") +
    " IST"
  );
}

function age(s) {
  if (!timestamp(s)) {
    return "age unknown";
  }

  const m = Math.max(
    0,
    Math.floor(
      (Date.now() - Date.parse(s)) / 60000
    )
  );

  return m < 60
    ? m + "m ago"
    : m < 1440
      ? Math.floor(m / 60) + "h ago"
      : Math.floor(m / 1440) + "d ago";
}

// ======================================
// PRICE HISTORY + DELTAS
// ======================================

function diff(newer, older) {
  if (!newer || !older) {
    return null;
  }

  const amount =
    newer.value - older.value;

  const gap =
    (
      dayTime(newer.date) -
      dayTime(older.date)
    ) !== 86400000;

  return {
    amount,
    gap,
    pct: older.value
      ? amount / older.value * 100
      : null,
    label:
      (
        amount > 0
          ? "↑ +"
          : amount < 0
            ? "↓ −"
            : "→ "
      ) +
      money(Math.abs(amount))
  };
}

// "↑ +₹1,200" or "↑ +₹1,200 (+0.9%)"

function changeLabel(change, withPercent) {
  let s = change.label;

  if (
    withPercent &&
    typeof change.pct === "number" &&
    isFinite(change.pct)
  ) {
    s +=
      " (" +
      (
        change.pct > 0
          ? "+"
          : change.pct < 0
            ? "−"
            : ""
      ) +
      Math.abs(change.pct).toFixed(1) +
      "%)";
  }

  return s;
}

// Same, with "*" appended on a date gap

function changeText(change, withPercent) {
  return change
    ? changeLabel(change, withPercent) +
      (change.gap ? "*" : "")
    : "—";
}

function todayIST() {
  return new Date(
    Date.now() + 330 * 60000
  ).toISOString().slice(0, 10);
}

// Change of the live price versus the
// newest historical record dated before
// today. Works whether or not the server
// has already added today's row.

function recentDiff(records, current) {
  const today = todayIST();

  const prior = records.find(
    r => r.date < today
  );

  return prior
    ? diff({ date: today, value: current }, prior)
    : null;
}

// ======================================
// DESIGN SYSTEM
// ======================================
//
// Layout rules used by every widget:
//  - Text, titles and dates align left.
//  - Numbers sit in fixed-width columns
//    and align right (via a spacer), so
//    prices line up across rows and sizes.
//  - One type scale per widget family.
//  - Spacing steps: 2, 4, 6, 8, 12.

const TYPE = {
  small:  { title: 10, meta: 8,  headline: 20, body: 10, caption: 8  },
  medium: { title: 11, meta: 9,  headline: 24, body: 11, caption: 9  },
  large:  { title: 11, meta: 9,  headline: 28, body: 12, caption: 9  }
};

// Column widths (points) for numeric cells.

const COLS = {
  small:  { price: 88 },
  medium: { price: 88,  change: 108, pair: 128, rowHeight: 18, rows: 3 },
  large:  { price: 98,  change: 118, pair: 134, rowHeight: 20, rows: 10 }
};

// ======================================
// WIDGET COMPONENTS
// ======================================

function label(
  parent,
  value,
  size,
  color,
  bold
) {
  const x = parent.addText(
    String(value)
  );

  x.font = bold
    ? Font.boldSystemFont(size)
    : Font.systemFont(size);

  x.textColor = color;
  x.lineLimit = 1;
  x.minimumScaleFactor = 0.7;

  return x;
}

function horizontal(parent) {
  const x = parent.addStack();

  x.layoutHorizontally();
  x.centerAlignContent();

  return x;
}

// Fixed-width horizontal cell. Pass width 0
// to let it fill remaining space. "right"
// pushes content to the right edge.

function cell(parent, width, align) {
  const s = horizontal(parent);

  if (width) s.size = new Size(width, 0);
  if (align === "right") s.addSpacer();

  return s;
}

// Fixed-width vertical column whose lines
// are right-aligned with rightLabel().

function column(parent, width) {
  const s = parent.addStack();

  s.layoutVertically();
  s.size = new Size(width, 0);

  return s;
}

function rightLabel(
  parent,
  value,
  size,
  color,
  bold
) {
  const h = horizontal(parent);

  h.addSpacer();

  return label(h, value, size, color, bold);
}

function rule(parent) {
  const s = parent.addStack();

  s.backgroundColor = colors.line;
  s.size = new Size(0, 1);
}

function deltaColor(d) {
  if (!d) return colors.muted;

  return d.amount > 0
    ? colors.up
    : d.amount < 0
      ? colors.down
      : colors.muted;
}

function newWidget(size) {
  const w = new ListWidget();

  w.backgroundColor = colors.bg;

  if (size === "small") {
    w.setPadding(10, 10, 8, 10);
  } else {
    w.setPadding(12, 14, 10, 14);
  }

  w.refreshAfterDate = new Date(
    nextScheduledRefresh(Date.now())
  );

  // Tapping the widget opens the script
  // and fetches fresh prices immediately.

  w.url =
    URLScheme.forRunningScript() +
    "?action=refresh";

  return w;
}

function titleRow(w, title, size, accent, alert) {
  const t = TYPE[size];
  const h = horizontal(w);

  label(h, title, t.title, accent, true);

  h.addSpacer();

  label(
    h,
    alert
      ? "PRICE ALERT"
      : SETTINGS.city.toUpperCase(),
    t.meta,
    alert ? colors.warning : colors.muted,
    alert
  );
}

function footer(w, state, size) {
  const t = TYPE[size];

  w.addSpacer();

  const f = horizontal(w);

  label(
    f,
    (
      state.data &&
      state.data.source
    ) || "METALS API",
    t.meta,
    colors.muted
  );

  f.addSpacer();

  let status;

  if (state.offline) {
    status =
      "OFFLINE · " +
      age(state.retrievedAt);

  } else if (
    state.data &&
    state.data.stale
  ) {
    status =
      "STALE · " +
      age(state.data.updatedAt);

  } else if (state.data) {
    status = ist(
      state.data.updatedAt
    );

  } else {
    status = "—";
  }

  label(
    f,
    status,
    t.meta,
    (
      state.offline ||
      (
        state.data &&
        state.data.stale
      )
    )
      ? colors.warning
      : colors.muted
  );
}

function emptyWidget(
  mode,
  size,
  heading,
  detail
) {
  const w = newWidget(size);

  titleRow(
    w,
    mode.type === "silver"
      ? "SILVER"
      : "KARATWATCH",
    size,
    colors.gold
  );

  w.addSpacer();

  label(w, heading, 19, colors.ink, true);

  w.addSpacer(6);

  const d = label(w, detail, 11, colors.muted);

  d.lineLimit = 4;

  w.addSpacer();

  label(
    w,
    "Open the script in Scriptable",
    9,
    colors.muted
  );

  return w;
}

// Caption line under a block, e.g.
// "per 10g · Price date 6 Nov"

function caption(w, text, size) {
  label(w, text, TYPE[size].caption, colors.muted);
}

// Small-widget quote: name + unit on the
// left, price + change right-aligned in a
// fixed column so rows line up.
// q = { name, unit, value, accent, change }

function quote(w, q) {
  const t = TYPE.small;
  const r = horizontal(w);

  const left = r.addStack();
  left.layoutVertically();

  label(left, q.name, t.body, q.accent, true);
  left.addSpacer(1);
  label(left, q.unit, t.caption, colors.muted);

  r.addSpacer();

  const right = column(r, COLS.small.price);

  rightLabel(right, money(q.value), 15, colors.ink, true);
  right.addSpacer(1);
  rightLabel(
    right,
    changeText(q.change, true),
    t.caption + 1,
    deltaColor(q.change)
  );
}

// Medium/large table row:
// [name, fills] [price, fixed] [change, fixed]
// Units are shown once in the caption so the
// name column never has to shrink.

function priceRow(w, size, name, accent, value, change) {
  const t = TYPE[size];
  const c = COLS[size];
  const large = size === "large";

  const r = horizontal(w);
  r.size = new Size(0, large ? 26 : 20);

  const n = cell(r, 0, "left");

  label(n, name, t.body, accent, true);

  n.addSpacer();

  label(
    cell(r, c.price, "right"),
    money(value),
    large ? 15 : 13,
    colors.ink,
    true
  );

  label(
    cell(r, c.change, "right"),
    changeText(change, true),
    t.body - 1,
    deltaColor(change)
  );
}

// ======================================
// TODAY WIDGET
// ======================================

function todayRows(data) {
  const pick = (hist, key) => hist.map(
    x => ({ date: x.date, value: x[key] })
  );

  const g24 = pick(data.gold.history, "24k");
  const g22 = pick(data.gold.history, "22k");
  const sv  = pick(data.silver.history, "price");

  return [
    {
      name: "GOLD 24K",
      unit: "per 10g",
      value: data.gold["24k"],
      accent: colors.gold,
      change: recentDiff(g24, data.gold["24k"])
    },
    {
      name: "GOLD 22K",
      unit: "per 10g",
      value: data.gold["22k"],
      accent: colors.gold,
      change: recentDiff(g22, data.gold["22k"])
    },
    {
      name: "SILVER",
      unit: "per kg",
      value: data.silver.price,
      accent: colors.silver,
      change: recentDiff(sv, data.silver.price)
    }
  ];
}

function priceDateText(data) {
  const gd =
    data.gold.history[0] &&
    data.gold.history[0].date;

  const sd =
    data.silver.history[0] &&
    data.silver.history[0].date;

  return (
    "Price date " +
    (gd ? dateLabel(gd) : "—") +
    (
      sd && sd !== gd
        ? " · Silver " + dateLabel(sd)
        : ""
    )
  );
}

function todayWidget(state, size) {
  const small = size === "small";
  const large = size === "large";
  const data = state.data;
  const rows = todayRows(data);

  const w = newWidget(size);

  titleRow(
    w,
    "KARATWATCH",
    size,
    colors.gold,
    triggeredAlerts(data).length > 0
  );

  if (small) {
    w.addSpacer(6);

    rows.forEach((q, i) => {
      quote(w, q);
      if (i < rows.length - 1) w.addSpacer(4);
    });

  } else {
    w.addSpacer(large ? 10 : 6);

    rows.forEach((q, i) => {
      priceRow(
        w,
        size,
        q.name,
        q.accent,
        q.value,
        q.change
      );

      if (i < rows.length - 1) {
        w.addSpacer(large ? 6 : 2);
        rule(w);
        w.addSpacer(large ? 6 : 2);
      }
    });
  }

  w.addSpacer();

  caption(
    w,
    (small ? "" : "Gold per 10g · Silver per kg · ") +
      priceDateText(data),
    size
  );

  footer(w, state, size);

  return w;
}

// ======================================
// SPARKLINE
// ======================================

function sparkline(records, color) {
  if (!records.length) {
    return null;
  }

  const values = records
    .map(r => r.value)
    .reverse();

  const min = Math.min(...values);
  const max = Math.max(...values);

  const dc = new DrawContext();

  dc.size = new Size(85, 27);
  dc.opaque = false;
  dc.respectScreenScale = true;

  const coords = values.map(
    (v, i) => new Point(
      3 + (
        values.length === 1
          ? 39.5
          : i * 79 /
            (values.length - 1)
      ),
      max === min
        ? 13
        : 3 +
          (max - v) /
          (max - min) * 21
    )
  );

  dc.setStrokeColor(
    new Color(color)
  );

  dc.setLineWidth(2);

  if (coords.length > 1) {
    const p = new Path();

    p.move(coords[0]);

    coords.slice(1).forEach(
      pt => p.addLine(pt)
    );

    dc.addPath(p);
    dc.strokePath();
  }

  dc.setFillColor(
    new Color(color)
  );

  const pt =
    coords[coords.length - 1];

  dc.fillEllipse(
    new Rect(
      pt.x - 2.5,
      pt.y - 2.5,
      5,
      5
    )
  );

  return dc.getImage();
}

// ======================================
// HISTORY WIDGET
// gold:24k, gold:22k, gold (both), silver
// ======================================

// One column per price series shown.
// All columns share the same dates.

function historyColumns(data, mode) {
  if (mode.type === "silver") {
    return [{
      name: "SILVER",
      records: data.silver.history.map(
        x => ({ date: x.date, value: x.price })
      ),
      current: data.silver.price
    }];
  }

  const purities = mode.purity === "both"
    ? ["24k", "22k"]
    : [mode.purity];

  return purities.map(p => ({
    name: p.toUpperCase(),
    records: data.gold.history.map(
      x => ({ date: x.date, value: x[p] })
    ),
    current: data.gold[p]
  }));
}

// Single series header: big price on the
// left, sparkline on the right, caption
// and change line below.

function singleHeader(w, col, unit, priceDate, days, gold, size) {
  const t = TYPE[size];
  const small = size === "small";

  w.addSpacer(small ? 8 : 6);

  const r = horizontal(w);

  label(r, money(col.current), t.headline, colors.ink, true);

  r.addSpacer();

  const im = sparkline(
    col.records.slice(0, days),
    gold ? "#C8A359" : "#88A6B8"
  );

  if (im) {
    const x = r.addImage(im);

    x.imageSize = new Size(
      small ? 52 : 85,
      small ? 19 : 27
    );
  }

  w.addSpacer(2);

  caption(w, unit + " · Price date " + priceDate, size);

  w.addSpacer(small ? 6 : 4);

  const d = col.change;

  label(
    w,
    d
      ? changeLabel(d, true) +
        (
          d.gap
            ? " · vs previous available"
            : " · vs prior day"
        )
      : "— No comparable prior observation",
    t.body,
    deltaColor(d)
  );
}

// Two series header. Small: stacked
// quotes. Otherwise two right-aligned
// columns that line up with the table.

function dualHeader(w, columns, unit, size) {
  const t = TYPE[size];

  if (size === "small") {
    w.addSpacer(6);

    columns.forEach((c, i) => {
      quote(w, {
        name: c.name,
        unit,
        value: c.current,
        accent: colors.gold,
        change: c.change
      });

      if (i === 0) w.addSpacer(4);
    });

    return;
  }

  w.addSpacer(size === "large" ? 10 : 6);

  const r = horizontal(w);

  // Left area carries the unit; numbers
  // live in the two fixed columns.

  const lead = r.addStack();
  lead.layoutVertically();
  lead.addSpacer();
  label(lead, unit, t.caption, colors.muted);

  r.addSpacer();

  columns.forEach(c => {
    const col = column(r, COLS[size].pair);

    rightLabel(col, c.name, t.caption, colors.gold, true);
    col.addSpacer(2);
    rightLabel(
      col,
      money(c.current),
      size === "large" ? 22 : 18,
      colors.ink,
      true
    );
    col.addSpacer(2);
    rightLabel(
      col,
      changeText(c.change, true),
      t.body - 1,
      deltaColor(c.change)
    );
  });
}

// Consecutive days with identical prices
// (weekends, holidays) collapse into one
// row so the table shows price movements,
// not repeats. Runs only merge across
// adjacent calendar days, so a genuinely
// missing date still breaks the run.
// Records are newest first.

function groupRecords(columns) {
  const groups = [];
  const n = columns[0].records.length;

  for (let i = 0; i < n; i++) {
    const date = columns[0].records[i].date;

    const values = columns.map(
      c => c.records[i].value
    );

    const last = groups[groups.length - 1];

    if (
      last &&
      dayTime(last.start) - dayTime(date) ===
        86400000 &&
      last.values.every((v, k) => v === values[k])
    ) {
      last.start = date;
    } else {
      groups.push({ start: date, end: date, values });
    }
  }

  return groups;
}

// "6 Nov", "7–9 Nov" or "30 Oct–1 Nov"

function rangeLabel(g) {
  if (g.start === g.end) {
    return dateLabel(g.end);
  }

  const sameMonth =
    g.start.slice(0, 7) === g.end.slice(0, 7);

  return (
    sameMonth
      ? String(+g.start.slice(8, 10))
      : dateLabel(g.start)
  ) + "–" + dateLabel(g.end);
}

// Change of a group versus the previous
// (older) group, for column k.

function groupDiff(g, older, k) {
  return older
    ? diff(
        { date: g.start, value: g.values[k] },
        { date: older.end, value: older.values[k] }
      )
    : null;
}

function tableHeader(w, size, dual) {
  const t = TYPE[size];
  const c = COLS[size];
  const h = horizontal(w);

  const d = cell(h, 0, "left");
  label(d, "DATE", t.caption, colors.muted, true);
  d.addSpacer();

  if (dual) {
    label(cell(h, c.pair, "right"), "24K", t.caption, colors.muted, true);
    label(cell(h, c.pair, "right"), "22K", t.caption, colors.muted, true);
  } else {
    label(cell(h, c.price, "right"), "PRICE", t.caption, colors.muted, true);
    label(cell(h, c.change, "right"), "CHANGE", t.caption, colors.muted, true);
  }
}

function historyWidget(state, mode, size) {
  const small = size === "small";
  const large = size === "large";
  const data = state.data;
  const t = TYPE[size];

  const gold = mode.type === "gold";
  const unit = gold ? "per 10g" : "per kg";
  const color = gold ? colors.gold : colors.silver;

  const columns = historyColumns(data, mode).map(
    c => Object.assign(c, {
      change: recentDiff(c.records, c.current)
    })
  );

  const dual = columns.length === 2;
  const records = columns[0].records;

  const priceDate = records.length
    ? dateLabel(records[0].date)
    : "—";

  const w = newWidget(size);

  titleRow(
    w,
    gold
      ? (dual ? "GOLD" : "GOLD " + columns[0].name)
      : "SILVER",
    size,
    color,
    triggeredAlerts(data).length > 0
  );

  if (dual) {
    dualHeader(w, columns, unit, size);
  } else {
    singleHeader(
      w,
      columns[0],
      unit,
      priceDate,
      mode.days,
      gold,
      size
    );
  }

  // SMALL WIDGET

  if (small) {
    w.addSpacer();

    if (dual) {
      caption(w, unit + " · Price date " + priceDate, size);
    } else if (records.length > 1) {
      caption(
        w,
        "Previous " +
          dateLabel(records[1].date) +
          ": " +
          money(records[1].value),
        size
      );
    }

    footer(w, state, size);

    return w;
  }

  // MEDIUM / LARGE HISTORY TABLE

  const c = COLS[size];

  w.addSpacer(large ? 10 : 6);
  rule(w);
  w.addSpacer(large ? 6 : 4);

  tableHeader(w, size, dual);

  w.addSpacer(large ? 4 : 2);

  const groups = groupRecords(columns);

  const shown = groups.slice(
    0,
    Math.min(mode.days, c.rows)
  );

  let gaps = false;

  if (!shown.length) {
    label(
      w,
      "Historical records unavailable",
      t.body,
      colors.muted
    );
  }

  for (let i = 0; i < shown.length; i++) {
    const g = shown[i];
    const rr = horizontal(w);

    rr.size = new Size(0, c.rowHeight);

    const d = cell(rr, 0, "left");
    label(d, rangeLabel(g), t.body - 1, colors.muted);
    d.addSpacer();

    columns.forEach((col, k) => {
      const change = groupDiff(g, groups[i + 1], k);

      if (change && change.gap) gaps = true;

      if (dual) {
        const cellStack = cell(rr, c.pair, "right");

        label(cellStack, money(g.values[k]), t.body, colors.ink, true);
        cellStack.addSpacer(5);
        label(cellStack, changeText(change, false), t.caption, deltaColor(change));

      } else {
        label(
          cell(rr, c.price, "right"),
          money(g.values[k]),
          t.body,
          colors.ink,
          true
        );

        label(
          cell(rr, c.change, "right"),
          changeText(change, false),
          t.body - 1,
          deltaColor(change)
        );
      }
    });
  }

  if (gaps) {
    w.addSpacer(2);
    caption(w, "* vs previous available", size);
  }

  footer(w, state, size);

  return w;
}

// ======================================
// RENDERING
// ======================================

function render(state, mode, size) {
  if (mode.error) {
    return emptyWidget(
      mode,
      size,
      "Invalid parameter",
      mode.error
    );
  }

  if (!state.data) {
    return emptyWidget(
      mode,
      size,
      state.reason === "Setup required"
        ? "Setup required"
        : "Prices unavailable",
      state.reason ||
        "Open Scriptable and test the connection."
    );
  }

  return mode.type === "today"
    ? todayWidget(state, size)
    : historyWidget(state, mode, size);
}

// ======================================
// IN-APP MENU
// ======================================

async function choose(
  title,
  items
) {
  const a = new Alert();

  a.title = title;

  items.forEach(
    s => a.addAction(s)
  );

  a.addCancelAction("Back");

  const n = await a.presentSheet();

  return (
    n >= 0 &&
    n < items.length
  ) ? n : -1;
}

async function preview() {
  const modes = [
    "today",
    "gold",
    "gold:7",
    "gold:24k",
    "gold:22k",
    "gold:22k:7",
    "silver",
    "silver:7"
  ];

  const m = await choose(
    "Preview mode",
    modes
  );

  if (m < 0) return;

  const sizes = [
    "small",
    "medium",
    "large"
  ];

  const s = await choose(
    "Preview size",
    [
      "Small",
      "Medium",
      "Large"
    ]
  );

  if (s < 0) return;

  const w = render(
    await loadPrices(false),
    parseMode(modes[m]),
    sizes[s]
  );

  if (s === 0) {
    await w.presentSmall();

  } else if (s === 1) {
    await w.presentMedium();

  } else {
    await w.presentLarge();
  }
}

// ======================================
// APP EXECUTION
// ======================================

async function refreshNow() {
  const s = await loadPrices(true);

  const hits = s.data
    ? await notifyAlerts(s.data)
    : [];

  await showAlert(
    s.offline
      ? "Refresh failed"
      : "Prices refreshed",
    (
      s.offline
        ? s.reason +
          (
            s.data
              ? " Showing cached prices from " +
                age(s.retrievedAt) + "."
              : ""
          )
        : s.data.stale
          ? "Valid data received. Server reports STALE."
          : "Latest gold and silver prices received."
    ) +
    (
      hits.length
        ? "\n\n" + hits.join("\n")
        : ""
    )
  );
}

async function runApp() {
  const query = args.queryParameters || {};

  if (
    query.action === "refresh" &&
    (!SETTINGS.serverURL || credentials())
  ) {
    await refreshNow();
  }

  if (SETTINGS.serverURL && !credentials()) {
    const n = await choose(
      "Welcome!",
      [
        "Set up credentials",
        "Continue without setup"
      ]
    );

    if (n === 0) {
      await setup();
    }
  }

  while (true) {
    const n = await choose(
      "KaratWatch",
      [
        "Refresh prices now",
        "Preview widget",
        "Price alerts",
        "Set / replace credentials",
        "Remove credentials",
        "Change city (" + SETTINGS.city + ")"
      ]
    );

    if (n < 0) break;

    if (n === 0) {
      await refreshNow();
    }

    if (n === 1) {
      await preview();
    }

    if (n === 2) {
      await editAlerts();
    }

    if (n === 3) {
      await setup();
    }

    if (n === 5) {
      await changeCity();
    }

    if (n === 4) {
      const c = await choose(
        "Remove all credentials?",
        [
          "Remove",
          "Keep them"
        ]
      );

      if (c === 0) {
        Object.values(KEYS).forEach(
          k => {
            if (Keychain.contains(k)) {
              Keychain.remove(k);
            }
          }
        );

        await showAlert(
          "Removed",
          "Keychain credentials removed. Cached prices remain."
        );
      }
    }
  }
}

// ======================================
// MAIN ENTRY POINT
// ======================================

if (config.runsInWidget) {
  const mode = parseMode(
    args.widgetParameter
  );

  const size = [
    "small",
    "medium",
    "large"
  ].includes(config.widgetFamily)
    ? config.widgetFamily
    : "medium";

  let widget;

  try {
    const state = mode.error
      ? {
          data: null,
          reason: mode.error
        }
      : await loadPrices(false);

    widget = render(
      state,
      mode,
      size
    );

  } catch (_) {
    widget = emptyWidget(
      mode,
      size,
      "Unable to render",
      "Open Scriptable to inspect settings."
    );
  }

  Script.setWidget(widget);

} else {
  await runApp();
}

Script.complete();