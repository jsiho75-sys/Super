/*
  ============================================================
  SUPERLOTTO PLUS AI LAB
  Cloudflare Worker
  ============================================================

  Endpoint:
    /api/superlotto

  Example:
    https://YOUR-WORKER.workers.dev/api/superlotto

  Game:
    SuperLotto Plus

  Rules:
    5 white balls: 1-47
    Special ball: 1-27
    Ticket: $1

  Data sources:
    1. California Lottery static site
    2. California Lottery DrawGame API

  The Worker does NOT use the normal HTML page first because
  that page has been returning HTTP 403 to Cloudflare Workers.
*/


// ============================================================
// CONFIGURATION
// ============================================================

const GAME_NAME = "SuperLotto Plus";
const GAME_ID = 8;

const TICKET_COST = "$1";

const OFFICIAL_PAGE =
  "https://www.calottery.com/en/draw-games/superlotto-plus";

const STATIC_PAGE =
  "https://static.www.calottery.com/en/draw-games/superlotto-plus";

const API_BASE =
  "https://www.calottery.com/api/DrawGameApi/DrawGamePastDrawResults";

const PAGE_SIZE = 20;

const MAX_DRAWS = 120;


// ============================================================
// CORS
// ============================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store"
  };
}


// ============================================================
// JSON RESPONSE
// ============================================================

function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json; charset=utf-8"
      }
    }
  );
}


// ============================================================
// DATE NORMALIZATION
// ============================================================

function normalizeDate(value) {

  if (!value) {
    return null;
  }

  const s = String(value).trim();

  // YYYY-MM-DD
  let m = s.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})/
  );

  if (m) {
    return (
      `${m[1]}-` +
      `${String(m[2]).padStart(2, "0")}-` +
      `${String(m[3]).padStart(2, "0")}`
    );
  }

  // MM/DD/YYYY
  m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})/
  );

  if (m) {
    return (
      `${m[3]}-` +
      `${String(m[1]).padStart(2, "0")}-` +
      `${String(m[2]).padStart(2, "0")}`
    );
  }

  // MM-DD-YYYY
  m = s.match(
    /^(\d{1,2})-(\d{1,2})-(\d{4})/
  );

  if (m) {
    return (
      `${m[3]}-` +
      `${String(m[1]).padStart(2, "0")}-` +
      `${String(m[2]).padStart(2, "0")}`
    );
  }

  const d = new Date(s);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0")
  ].join("-");
}


// ============================================================
// INTEGER HELPER
// ============================================================

function toNumber(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value === "object" &&
    value.Number !== undefined
  ) {
    value = value.Number;
  }

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  return Math.trunc(n);
}


// ============================================================
// DRAW VALIDATION
// ============================================================

function validateDraw(date, white, pb, drawNumber = null) {

  if (!date) {
    return null;
  }

  if (!Array.isArray(white)) {
    return null;
  }

  if (white.length !== 5) {
    return null;
  }

  const cleanWhite = white
    .map(toNumber)
    .filter(n => Number.isInteger(n));

  if (cleanWhite.length !== 5) {
    return null;
  }

  if (
    cleanWhite.some(
      n => n < 1 || n > 47
    )
  ) {
    return null;
  }

  if (
    new Set(cleanWhite).size !== 5
  ) {
    return null;
  }

  const cleanPB = toNumber(pb);

  if (
    !Number.isInteger(cleanPB) ||
    cleanPB < 1 ||
    cleanPB > 27
  ) {
    return null;
  }

  cleanWhite.sort(
    (a, b) => a - b
  );

  return {
    date,
    white: cleanWhite,
    pb: cleanPB,
    drawNumber:
      drawNumber === undefined
        ? null
        : drawNumber
  };
}


// ============================================================
// API DRAW PARSER
// ============================================================

function normalizeApiDraw(raw) {

  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  const date = normalizeDate(
    raw.DrawDate ??
    raw.drawDate ??
    raw.Date ??
    raw.date ??
    raw.Draw_Date
  );

  const drawNumber =
    raw.DrawNumber ??
    raw.drawNumber ??
    raw.DrawNo ??
    raw.drawNo ??
    null;


  let values =
    raw.WinningNumbers ??
    raw.winningNumbers ??
    raw.Numbers ??
    raw.numbers ??
    raw.WinningNumber ??
    raw.winningNumber;


  /*
    Some versions of the Lottery API can return
    numbers as an array.
  */

  if (Array.isArray(values)) {

    const numbers = values
      .map(toNumber)
      .filter(n => Number.isInteger(n));

    if (numbers.length >= 6) {

      return validateDraw(
        date,
        numbers.slice(0, 5),
        numbers[5],
        drawNumber
      );
    }
  }


  /*
    Some versions can expose individual number fields.
  */

  const possibleWhite = [
    raw.Number1,
    raw.Number2,
    raw.Number3,
    raw.Number4,
    raw.Number5
  ];

  const possiblePB =
    raw.Mega ??
    raw.MegaNumber ??
    raw.Superball ??
    raw.SuperBall ??
    raw.BonusNumber ??
    raw.Bonus ??
    raw.Powerball ??
    raw.pb;


  if (
    possibleWhite.every(
      x => x !== undefined && x !== null
    )
  ) {

    return validateDraw(
      date,
      possibleWhite,
      possiblePB,
      drawNumber
    );
  }

  return null;
}


// ============================================================
// FETCH CALIFORNIA LOTTERY API PAGE
// ============================================================

async function fetchApiPage(page) {

  const url =
    `${API_BASE}/${GAME_ID}/${page}/${PAGE_SIZE}`;

  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          "Accept":
            "application/json, text/plain, */*",

          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",

          "Referer":
            OFFICIAL_PAGE
        }
      }
    );


  const text =
    await response.text();


  if (!response.ok) {

    throw new Error(
      `California Lottery API HTTP ${response.status} ` +
      `for page ${page}. ` +
      `Response: ${text.slice(0, 400)}`
    );
  }


  let data;

  try {

    data =
      JSON.parse(text);

  } catch {

    throw new Error(
      `California Lottery API returned non-JSON ` +
      `for page ${page}. ` +
      `Response: ${text.slice(0, 400)}`
    );
  }


  return data;
}


// ============================================================
// GET DRAWS FROM API
// ============================================================

async function getApiDraws() {

  const pages = [
    1,
    2,
    3,
    4,
    5,
    6
  ];


  const results =
    await Promise.all(
      pages.map(
        page => fetchApiPage(page)
      )
    );


  const draws = [];


  for (const result of results) {

    const list =
      result?.PreviousDraws ??
      result?.previousDraws ??
      result?.Draws ??
      result?.draws ??
      result?.Results ??
      result?.results ??
      [];


    if (!Array.isArray(list)) {
      continue;
    }


    for (const raw of list) {

      const draw =
        normalizeApiDraw(raw);

      if (draw) {
        draws.push(draw);
      }
    }
  }


  return dedupeAndSort(draws);
}


// ============================================================
// STATIC PAGE FETCH
// ============================================================

async function fetchStaticPage() {

  const response =
    await fetch(
      STATIC_PAGE,
      {
        method: "GET",

        headers: {
          "Accept":
            "text/html,application/xhtml+xml",

          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"
        }
      }
    );


  const text =
    await response.text();


  if (!response.ok) {

    throw new Error(
      `California Lottery static page HTTP ` +
      `${response.status}. ` +
      `Response: ${text.slice(0, 300)}`
    );
  }


  return text;
}


// ============================================================
// HTML DECODING
// ============================================================

function decodeHtml(text) {

  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}


// ============================================================
// STRIP HTML
// ============================================================

function stripHtml(text) {

  return decodeHtml(
    text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}


// ============================================================
// STATIC PAGE DRAW EXTRACTION
// ============================================================

function extractDrawsFromHtml(html) {

  const text =
    stripHtml(html);


  const draws = [];


  /*
    The California Lottery page contains the
    Past Winning Numbers table.

    First try to find explicit date + draw number
    patterns.
  */


  const dateRegex =
    /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}),\s*(\d{4})\b/gi;


  const matches = [
    ...text.matchAll(dateRegex)
  ];


  /*
    We inspect text surrounding each date.
  */

  for (const match of matches) {

    const month =
      match[1];

    const day =
      match[2];

    const year =
      match[3];


    const date =
      normalizeDate(
        `${month} ${day}, ${year}`
      );


    if (!date) {
      continue;
    }


    const start =
      Math.max(
        0,
        match.index - 100
      );

    const end =
      Math.min(
        text.length,
        match.index + 500
      );


    const area =
      text.slice(start, end);


    /*
      Look for Draw #.
    */

    const drawMatch =
      area.match(
        /Draw\s*#?\s*(\d{3,6})/i
      );


    const drawNumber =
      drawMatch
        ? drawMatch[1]
        : null;


    /*
      Find all integers in the local area.

      We then look for a valid sequence:
        5 white numbers 1-47
        followed by a special number 1-27
    */

    const nums =
      [...area.matchAll(/\b\d{1,2}\b/g)]
        .map(m => Number(m[0]));


    /*
      Remove obvious date fragments and ticket/prize
      numbers by searching for a valid six-number
      sequence.
    */

    let found = null;


    for (
      let i = 0;
      i <= nums.length - 6;
      i++
    ) {

      const candidate =
        nums.slice(i, i + 6);


      const white =
        candidate.slice(0, 5);

      const pb =
        candidate[5];


      if (
        white.length === 5 &&
        white.every(
          n => n >= 1 && n <= 47
        ) &&
        new Set(white).size === 5 &&
        pb >= 1 &&
        pb <= 27
      ) {

        const normalized =
          validateDraw(
            date,
            white,
            pb,
            drawNumber
          );


        if (normalized) {

          found =
            normalized;

          break;
        }
      }
    }


    if (found) {
      draws.push(found);
    }
  }


  return dedupeAndSort(draws);
}


// ============================================================
// DEDUPE + SORT
// ============================================================

function dedupeAndSort(draws) {

  const map =
    new Map();


  for (const draw of draws) {

    if (
      !draw ||
      !draw.date
    ) {
      continue;
    }


    /*
      If duplicate date appears, prefer
      the version containing a draw number.
    */

    const existing =
      map.get(draw.date);


    if (!existing) {

      map.set(
        draw.date,
        draw
      );

    } else if (
      !existing.drawNumber &&
      draw.drawNumber
    ) {

      map.set(
        draw.date,
        draw
      );
    }
  }


  return [...map.values()]
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date)
    );
}


// ============================================================
// JACKPOT / NEXT DRAW EXTRACTION
// ============================================================

function extractJackpotInfo(html) {

  const text =
    stripHtml(html);


  let jackpot = null;
  let cashValue = null;
  let nextDrawing = null;


  /*
    Jackpot.

    Example:
      $55 MILLION
  */

  const jackpotMatch =
    text.match(
      /\$[\d,.]+\s*MILLION/i
    );


  if (jackpotMatch) {

    jackpot =
      jackpotMatch[0]
        .replace(/\s+/g, " ")
        .trim();
  }


  /*
    Cash value is not always printed on the
    individual game page, so this remains null
    unless a clear "cash value" appears.
  */

  const cashMatch =
    text.match(
      /(?:estimated\s+cash\s+value|cash\s+value)[^$]{0,80}(\$[\d,.]+\s*(?:MILLION|BILLION)?)/i
    );


  if (cashMatch) {
    cashValue =
      cashMatch[1].trim();
  }


  /*
    Next Draw:
      SAT/SEP 12, 2026
  */

  const nextMatch =
    text.match(
      /Next\s+Draw:\s*([A-Z]{3}\/[A-Z]{3}\s+\d{1,2},\s+\d{4})/i
    );


  if (nextMatch) {

    nextDrawing =
      nextMatch[1].trim();

  } else {

    /*
      Some localized/static versions can use
      different spacing.
    */

    const alt =
      text.match(
        /Next\s+Draw\s*:?\s*([A-Z]{3}\/[A-Z]{3}\s+\d{1,2},\s+\d{4})/i
      );

    if (alt) {
      nextDrawing =
        alt[1].trim();
    }
  }


  return {
    jackpot,
    cashValue,
    nextDrawing
  };
}


// ============================================================
// MAIN HISTORY LOADER
// ============================================================

async function loadHistory() {

  const errors = [];


  /*
    ----------------------------------------------------------
    SOURCE 1
    California Lottery static site
    ----------------------------------------------------------
  */

  try {

    const html =
      await fetchStaticPage();


    const draws =
      extractDrawsFromHtml(html);


    const info =
      extractJackpotInfo(html);


    if (draws.length >= 100) {

      return {
        draws: draws.slice(0, MAX_DRAWS),
        info,
        source:
          STATIC_PAGE,
        method:
          "California Lottery static page"
      };
    }


    errors.push(
      `Static page returned only ${draws.length} valid draws`
    );

  } catch (error) {

    errors.push(
      `Static page: ${error.message}`
    );
  }


  /*
    ----------------------------------------------------------
    SOURCE 2
    California Lottery API
    ----------------------------------------------------------
  */

  try {

    const draws =
      await getApiDraws();


    if (draws.length >= 100) {

      return {
        draws: draws.slice(0, MAX_DRAWS),

        info: {
          jackpot: null,
          cashValue: null,
          nextDrawing: null
        },

        source:
          `${API_BASE}/${GAME_ID}/1/${PAGE_SIZE}`,

        method:
          "California Lottery DrawGame API"
      };
    }


    errors.push(
      `Lottery API returned only ${draws.length} valid draws`
    );

  } catch (error) {

    errors.push(
      `Lottery API: ${error.message}`
    );
  }


  /*
    ----------------------------------------------------------
    NOTHING WORKED
    ----------------------------------------------------------
  */

  throw new Error(
    "Unable to retrieve at least 100 valid " +
    "SuperLotto Plus drawings. " +
    errors.join(" | ")
  );
}


// ============================================================
// SUPERLOTTO ENDPOINT
// ============================================================

async function handleSuperLotto() {

  const result =
    await loadHistory();


  const draws =
    result.draws;


  if (
    !Array.isArray(draws) ||
    draws.length < 100
  ) {

    throw new Error(
      `Only ${draws?.length || 0} valid drawings available`
    );
  }


  const latest =
    draws[0] || null;


  return {
    source:
      OFFICIAL_PAGE,

    dataSource:
      result.source,

    dataMethod:
      result.method,

    updatedAt:
      new Date().toISOString(),

    game:
      GAME_NAME,

    ticketCost:
      TICKET_COST,

    jackpot:
      result.info.jackpot,

    cashValue:
      result.info.cashValue,

    nextDrawing:
      result.info.nextDrawing,

    latestDraw:
      latest,

    drawCount:
      draws.length,

    draws
  };
}


// ============================================================
// HEALTH CHECK
// ============================================================

function healthResponse() {

  return {
    ok: true,

    game:
      GAME_NAME,

    gameId:
      GAME_ID,

    ticketCost:
      TICKET_COST,

    endpoint:
      "/api/superlotto",

    officialPage:
      OFFICIAL_PAGE,

    staticSource:
      STATIC_PAGE,

    apiSource:
      `${API_BASE}/${GAME_ID}/1/${PAGE_SIZE}`,

    updatedAt:
      new Date().toISOString()
  };
}


// ============================================================
// CLOUDFLARE WORKER
// ============================================================

export default {

  async fetch(request) {

    const url =
      new URL(request.url);


    /*
      CORS preflight
    */

    if (
      request.method === "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,
          headers:
            corsHeaders()
        }
      );
    }


    /*
      Only GET is supported.
    */

    if (
      request.method !== "GET"
    ) {

      return jsonResponse(
        {
          error:
            "Method not allowed"
        },
        405
      );
    }


    /*
      Health check
    */

    if (
      url.pathname === "/" ||
      url.pathname === "/health"
    ) {

      return jsonResponse(
        healthResponse()
      );
    }


    /*
      Main application endpoint
    */

    if (
      url.pathname === "/api/superlotto"
    ) {

      try {

        const data =
          await handleSuperLotto();


        return jsonResponse(
          data,
          200
        );

      } catch (error) {

        /*
          IMPORTANT:
          Return the actual error so we can diagnose
          the source instead of only saying "Load failed".
        */

        return jsonResponse(
          {
            error:
              error?.message ||
              "SuperLotto update failed",

            game:
              GAME_NAME,

            officialPage:
              OFFICIAL_PAGE,

            staticSource:
              STATIC_PAGE,

            apiSource:
              `${API_BASE}/${GAME_ID}/1/${PAGE_SIZE}`,

            updatedAt:
              new Date().toISOString()
          },
          502
        );
      }
    }


    /*
      Unknown route
    */

    return jsonResponse(
      {
        error:
          "Not found",

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
