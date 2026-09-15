const API_BASE =
  "https://www.calottery.com/api/DrawGameApi/DrawGamePastDrawResults";

const GAME_ID = 8; // SuperLotto Plus
const PAGE_SIZE = 20;

// Official California Lottery game page
const OFFICIAL_PAGE =
  "https://www.calottery.com/en/draw-games/superlotto-plus";

const ALLOWED_ORIGIN = "*";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function normalizeDate(value) {
  if (!value) return null;

  const s = String(value).trim();

  // ISO date
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  }

  // MM/DD/YYYY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  }

  // Try JavaScript date parsing
  const d = new Date(s);

  if (!Number.isNaN(d.getTime())) {
    return [
      d.getUTCFullYear(),
      String(d.getUTCMonth() + 1).padStart(2, "0"),
      String(d.getUTCDate()).padStart(2, "0")
    ].join("-");
  }

  return null;
}

function numberFrom(value) {
  if (value === null || value === undefined) return null;

  const n = Number(
    typeof value === "object" && value.Number !== undefined
      ? value.Number
      : value
  );

  return Number.isFinite(n) ? n : null;
}

function extractWinningNumbers(draw) {
  const source =
    draw?.WinningNumbers ??
    draw?.winningNumbers ??
    draw?.Numbers ??
    draw?.numbers ??
    [];

  if (!Array.isArray(source)) return [];

  return source
    .map(numberFrom)
    .filter(n => Number.isInteger(n));
}

function normalizeDraw(draw) {
  if (!draw || typeof draw !== "object") return null;

  const date = normalizeDate(
    draw.DrawDate ??
    draw.drawDate ??
    draw.Date ??
    draw.date
  );

  if (!date) return null;

  const numbers = extractWinningNumbers(draw);

  /*
    SuperLotto Plus:
      5 white balls: 1–47
      1 Mega/Superball: 1–27

    California Lottery's API may call the special number
    "Mega". Internally our app calls it "pb".
  */

  if (numbers.length < 6) return null;

  const white = numbers.slice(0, 5);
  const pb = numbers[5];

  if (
    white.length !== 5 ||
    white.some(n => n < 1 || n > 47) ||
    !Number.isInteger(pb) ||
    pb < 1 ||
    pb > 27
  ) {
    return null;
  }

  const uniqueWhite = [...new Set(white)];

  if (uniqueWhite.length !== 5) return null;

  uniqueWhite.sort((a, b) => a - b);

  return {
    date,
    white: uniqueWhite,
    pb,
    drawNumber:
      draw.DrawNumber ??
      draw.drawNumber ??
      draw.DrawNo ??
      draw.drawNo ??
      null
  };
}

async function fetchPage(page) {
  const url =
    `${API_BASE}/${GAME_ID}/${page}/${PAGE_SIZE}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `California Lottery API returned HTTP ${response.status} for page ${page}`
    );
  }

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `California Lottery API returned invalid JSON for page ${page}`
    );
  }

  return data;
}

async function getHistory() {
  /*
    We need at least 100 drawings.

    20 drawings per page means 5 pages = 100 drawings.
    We request 6 pages so the app has some extra history.
  */

  const pages = [1, 2, 3, 4, 5, 6];

  const results = await Promise.all(
    pages.map(page => fetchPage(page))
  );

  const all = [];

  for (const result of results) {
    const draws =
      result?.PreviousDraws ??
      result?.previousDraws ??
      result?.Draws ??
      result?.draws ??
      [];

    if (!Array.isArray(draws)) continue;

    for (const rawDraw of draws) {
      const draw = normalizeDraw(rawDraw);

      if (draw) {
        all.push(draw);
      }
    }
  }

  /*
    Remove duplicate dates.
  */
  const unique = new Map();

  for (const draw of all) {
    if (!unique.has(draw.date)) {
      unique.set(draw.date, draw);
    }
  }

  const draws = [...unique.values()];

  /*
    Newest first.
  */
  draws.sort((a, b) =>
    b.date.localeCompare(a.date)
  );

  /*
    Return the latest 120 drawings.
    Your app only needs 100, but extra history is useful.
  */
  return draws.slice(0, 120);
}

async function getLatestInfo(draws) {
  const latest = draws[0] || null;

  /*
    Jackpot information is intentionally not scraped from
    the blocked HTML page.

    The history endpoint is used for reliable winning numbers.
    The app can continue displaying jackpot information already
    stored locally until a separate jackpot source is added.
  */

  return {
    jackpot: null,
    cashValue: null,
    nextDrawing: null,
    latest
  };
}

async function handleSuperLotto() {
  const draws = await getHistory();

  if (!draws.length) {
    return jsonResponse(
      {
        error: "No valid SuperLotto Plus drawings were returned.",
        source: `${API_BASE}/${GAME_ID}/1/${PAGE_SIZE}`,
        updatedAt: new Date().toISOString()
      },
      502
    );
  }

  if (draws.length < 100) {
    return jsonResponse(
      {
        error: "SuperLotto Plus API returned fewer than 100 valid drawings.",
        drawCount: draws.length,
        source: `${API_BASE}/${GAME_ID}/1/${PAGE_SIZE}`,
        updatedAt: new Date().toISOString()
      },
      502
    );
  }

  const info = await getLatestInfo(draws);

  return jsonResponse({
    source: OFFICIAL_PAGE,
    apiSource: `${API_BASE}/${GAME_ID}/1/${PAGE_SIZE}`,
    updatedAt: new Date().toISOString(),

    game: "SuperLotto Plus",
    ticketCost: "$1",

    jackpot: info.jackpot,
    cashValue: info.cashValue,
    nextDrawing: info.nextDrawing,

    drawCount: draws.length,
    draws
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (request.method !== "GET") {
      return jsonResponse(
        {
          error: "Method not allowed"
        },
        405
      );
    }

    /*
      Main endpoint used by your SuperLotto V6.3.1 app.
    */
    if (url.pathname === "/api/superlotto") {
      try {
        return await handleSuperLotto();
      } catch (error) {
        return jsonResponse(
          {
            error: error?.message || "SuperLotto update failed",
            updatedAt: new Date().toISOString()
          },
          502
        );
      }
    }

    /*
      Simple health check.
    */
    if (url.pathname === "/" || url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        game: "SuperLotto Plus",
        endpoint: "/api/superlotto",
        api: `${API_BASE}/${GAME_ID}/1/${PAGE_SIZE}`,
        updatedAt: new Date().toISOString()
      });
    }

    return jsonResponse(
      {
        error: "Not found",
        availableEndpoints: [
          "/",
          "/health",
          "/api/superlotto"
        ]
      },
      404
    );
  }
};
