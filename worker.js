const OFFICIAL_URL =
  "https://www.calottery.com/en/draw-games/superlotto-plus";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: CORS_HEADERS
  });
}

function decodeHtml(str) {
  return String(str || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(html) {
  return decodeHtml(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function cleanNumber(value) {
  const n = Number(String(value).replace(/[^\d]/g, ""));
  return Number.isInteger(n) ? n : null;
}

function normalizeDate(value) {
  if (!value) return null;

  const text = String(value).trim();

  // YYYY-MM-DD
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  }

  // MM/DD/YYYY
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  }

  // Month DD, YYYY
  const d = new Date(text);
  if (!Number.isNaN(d.getTime())) {
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")
    ].join("-");
  }

  return null;
}

function validDraw(draw) {
  if (!draw || !draw.date) return false;

  if (!Array.isArray(draw.white) || draw.white.length !== 5) {
    return false;
  }

  if (
    draw.white.some(
      n => !Number.isInteger(n) || n < 1 || n > 47
    )
  ) {
    return false;
  }

  if (new Set(draw.white).size !== 5) {
    return false;
  }

  if (
    !Number.isInteger(draw.pb) ||
    draw.pb < 1 ||
    draw.pb > 27
  ) {
    return false;
  }

  return true;
}

/*
  Extract draws from the California Lottery page.

  The current CA Lottery page exposes the Past Winning Numbers
  section as rows containing:

  Draw Date
  Draw Number
  five white numbers
  Superball / Mega number

  The parser looks for date patterns and then searches nearby
  text for the five white numbers plus the Superball.
*/
function extractDraws(html) {
  const text = stripTags(html);

  const draws = [];
  const seen = new Set();

  const dateRegex =
    /\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+\d{1,2},\s+\d{4}\b/gi;

  let match;

  while ((match = dateRegex.exec(text)) !== null) {
    const dateText = match[0];
    const date = normalizeDate(dateText);

    if (!date) continue;

    /*
      Only inspect a limited section after the date.
      This avoids accidentally grabbing numbers belonging
      to another drawing.
    */
    const section = text.slice(
      match.index,
      match.index + 500
    );

    const nums = [
      ...section.matchAll(/\b\d{1,2}\b/g)
    ].map(m => Number(m[0]));

    /*
      A normal Past Winning Numbers row contains:
      date,
      draw number,
      5 white numbers,
      Superball.
    */

    let candidates = nums.filter(
      n => Number.isInteger(n) && n >= 1 && n <= 47
    );

    /*
      Try to identify the row by looking for a draw number
      followed by five white numbers and a special number.
    */

    let found = null;

    for (let i = 0; i <= candidates.length - 7; i++) {
      const drawNumber = candidates[i];

      // Current SuperLotto Plus draw numbers are around 4,000+.
      if (drawNumber < 1000) continue;

      const white = candidates.slice(i + 1, i + 6);
      const pb = candidates[i + 6];

      if (
        white.length === 5 &&
        white.every(n => n >= 1 && n <= 47) &&
        new Set(white).size === 5 &&
        pb >= 1 &&
        pb <= 27
      ) {
        found = {
          date,
          white: [...white].sort((a, b) => a - b),
          pb,
          drawNumber: String(drawNumber)
        };
        break;
      }
    }

    /*
      Fallback:
      Search for any valid 5-number combination followed
      by a 1–27 Superball.
    */
    if (!found) {
      for (let i = 0; i <= candidates.length - 6; i++) {
        const white = candidates.slice(i, i + 5);
        const pb = candidates[i + 5];

        if (
          white.length === 5 &&
          white.every(n => n >= 1 && n <= 47) &&
          new Set(white).size === 5 &&
          pb >= 1 &&
          pb <= 27
        ) {
          found = {
            date,
            white: [...white].sort((a, b) => a - b),
            pb
          };
          break;
        }
      }
    }

    if (found && validDraw(found) && !seen.has(date)) {
      seen.add(date);
      draws.push(found);
    }
  }

  return draws;
}

async function fetchOfficialPage(page) {
  /*
    California Lottery currently shows 20 Past Winning Numbers
    per page. Page 1 is the normal URL; subsequent pages use
    ?page=N.
  */

  const url =
    page === 1
      ? OFFICIAL_URL
      : `${OFFICIAL_URL}?page=${page}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; SuperLottoPlus-AI-Lab/6.3)",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    },
    cf: {
      cacheTtl: 300,
      cacheEverything: true
    }
  });

  if (!res.ok) {
    throw new Error(
      `California Lottery returned HTTP ${res.status} for page ${page}`
    );
  }

  return await res.text();
}

function extractJackpotInfo(html) {
  const text = stripTags(html);

  let jackpot = null;
  let cashValue = null;
  let nextDrawing = null;

  /*
    Jackpot
  */
  const jackpotMatch = text.match(
    /\$[\d,.]+\s*MILLION/i
  );

  if (jackpotMatch) {
    jackpot = jackpotMatch[0];
  }

  /*
    Cash value
  */
  const cashMatch = text.match(
    /(?:Estimated\s+)?Cash\s+Value\s*\$?([\d,]+)/i
  );

  if (cashMatch) {
    cashValue = "$" + cashMatch[1];
  }

  /*
    Next drawing
  */
  const nextMatch = text.match(
    /Next\s+Draw(?:ing)?\s*:?\s*([A-Z]{2,4}\/[A-Z]{3}\/\d{1,2},?\s*\d{4})/i
  );

  if (nextMatch) {
    nextDrawing = nextMatch[1];
  } else {
    const simpleNext = text.match(
      /Next\s+Draw(?:ing)?\s*:?\s*([A-Z]{2,4}\/[A-Z]{3}\/\d{1,2},?\s*\d{4})/i
    );

    if (simpleNext) {
      nextDrawing = simpleNext[1];
    }
  }

  return {
    jackpot,
    cashValue,
    nextDrawing
  };
}

async function getAllDraws() {
  /*
    The official page currently has 106 historical results,
    with 20 rows per page. Six pages therefore cover the
    complete currently displayed history.

    Fetch a few extra pages in case the page count changes.
  */

  const pages = [1, 2, 3, 4, 5, 6];

  const results = await Promise.all(
    pages.map(async page => {
      try {
        return {
          page,
          html: await fetchOfficialPage(page)
        };
      } catch (error) {
        return {
          page,
          html: "",
          error: error.message
        };
      }
    })
  );

  const all = [];

  for (const result of results) {
    if (!result.html) continue;

    const draws = extractDraws(result.html);
    all.push(...draws);
  }

  /*
    Deduplicate by date.
  */
  const map = new Map();

  for (const draw of all) {
    if (validDraw(draw)) {
      map.set(draw.date, draw);
    }
  }

  return [...map.values()]
    .sort((a, b) =>
      b.date.localeCompare(a.date)
    )
    .slice(0, 100);
}

async function handleSuperLotto() {
  try {
    /*
      Fetch page 1 separately because it also contains
      the current jackpot and next-drawing information.
    */
    const firstPage = await fetchOfficialPage(1);

    const jackpotInfo =
      extractJackpotInfo(firstPage);

    /*
      Fetch all six history pages.
    */
    const draws = await getAllDraws();

    if (!draws.length) {
      return response(
        {
          error:
            "No valid SuperLotto Plus drawings were found.",
          source: OFFICIAL_URL,
          updatedAt: new Date().toISOString(),
          drawCount: 0
        },
        502
      );
    }

    return response({
      source: OFFICIAL_URL,
      updatedAt: new Date().toISOString(),
      game: "SuperLotto Plus",
      ticketCost: "$1",
      jackpot: jackpotInfo.jackpot,
      cashValue: jackpotInfo.cashValue,
      nextDrawing: jackpotInfo.nextDrawing,
      drawCount: draws.length,
      draws
    });
  } catch (error) {
    return response(
      {
        error: error.message,
        source: OFFICIAL_URL,
        updatedAt: new Date().toISOString()
      },
      500
    );
  }
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    const url = new URL(request.url);

    if (
      request.method === "GET" &&
      (
        url.pathname === "/" ||
        url.pathname === "/api/superlotto"
      )
    ) {
      return handleSuperLotto();
    }

    return response(
      {
        error: "Not found",
        endpoint: "/api/superlotto"
      },
      404
    );
  }
};
