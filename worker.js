/**
 * SuperLotto Plus AI Lab V6.3.1
 * Cloudflare Worker
 *
 * Endpoints:
 *
 *   /api/health
 *   /api/superlotto
 *   /api/debug-history
 *
 * Historical source:
 *   DrawAnalytics JSON API
 *
 * SuperLotto Plus:
 *   5 numbers from 1-47
 *   Superball from 1-27
 */

const GAME_NAME = "SuperLotto Plus";
const GAME_ID = 8;

const DRAW_ANALYTICS_BASE =
  "https://www.drawanalytics.com/api/v1";

const DRAW_ANALYTICS_RESULTS =
  `${DRAW_ANALYTICS_BASE}/california/superlotto_plus/results`;

const DRAW_ANALYTICS_LATEST =
  `${DRAW_ANALYTICS_BASE}/california/superlotto_plus/latest`;

const OFFICIAL_URL =
  "https://www.calottery.com/en/draw-games/superlotto-plus";

const MAX_DRAWINGS = 150;

/*
 * We request enough history to cover:
 *
 * 2025
 * 2026
 *
 * and then keep the newest 150 valid drawings.
 */
const HISTORY_START_DATE = "2025-01-01";

const FALLBACK_DRAWS = [
  {
    date: "2026-09-12",
    white: [13, 26, 29, 35, 47],
    pb: 8
  },
  {
    date: "2026-09-09",
    white: [9, 24, 28, 34, 41],
    pb: 6
  }
];

const FALLBACK_HEADER = {
  jackpot: 55000000,
  cashValue: 23200000,
  nextDrawing: "2026-09-16"
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};


/* ---------------------------------------------------------
   JSON RESPONSE
--------------------------------------------------------- */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...CORS_HEADERS
      }
    }
  );
}


/* ---------------------------------------------------------
   DATE
--------------------------------------------------------- */

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}


/* ---------------------------------------------------------
   VALIDATE DRAW
--------------------------------------------------------- */

function validDraw(date, white, pb) {

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  if (!Array.isArray(white) || white.length !== 5) {
    return false;
  }

  if (new Set(white).size !== 5) {
    return false;
  }

  if (
    white.some(
      n =>
        !Number.isInteger(n) ||
        n < 1 ||
        n > 47
    )
  ) {
    return false;
  }

  if (
    !Number.isInteger(pb) ||
    pb < 1 ||
    pb > 27
  ) {
    return false;
  }

  return true;
}


/* ---------------------------------------------------------
   NORMALIZE DRAW
--------------------------------------------------------- */

function normalizeDraw(item) {

  if (!item || typeof item !== "object") {
    return null;
  }

  /*
   * DrawAnalytics documented format uses:
   *
   * draw_date
   * numbers
   * bonus_ball
   *
   * We also accept a few alternate names so the Worker
   * remains tolerant if the API response evolves.
   */

  const date =
    item.draw_date ||
    item.date ||
    item.drawDate;

  const rawNumbers =
    item.numbers ||
    item.white ||
    item.main_numbers ||
    item.mainNumbers;

  const rawBonus =
    item.bonus_ball ??
    item.bonus ??
    item.pb ??
    item.superball;

  if (!date || !Array.isArray(rawNumbers)) {
    return null;
  }

  const white = rawNumbers
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const pb = Number(rawBonus);

  if (!validDraw(date, white, pb)) {
    return null;
  }

  return {
    date,
    white,
    pb
  };
}


/* ---------------------------------------------------------
   DRAW KEY
--------------------------------------------------------- */

function drawKey(draw) {

  return (
    draw.date +
    "|" +
    draw.white.join("-") +
    "|" +
    draw.pb
  );

}


/* ---------------------------------------------------------
   PARSE DRAW ANALYTICS JSON
--------------------------------------------------------- */

function parseDrawAnalyticsJSON(payload) {

  if (!payload) {
    return [];
  }

  /*
   * Documented API wrapper:
   *
   * {
   *   success: true,
   *   data: [...],
   *   meta: {...}
   * }
   */

  const data =
    Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : [];

  const draws = [];

  for (const item of data) {

    const draw = normalizeDraw(item);

    if (draw) {
      draws.push(draw);
    }

  }

  return draws;
}/* ---------------------------------------------------------
   FETCH DRAW ANALYTICS RESULTS PAGE
--------------------------------------------------------- */

async function fetchDrawAnalyticsPage(
  startDate,
  endDate,
  limit = 100,
  offset = 0
) {

  const url =
    `${DRAW_ANALYTICS_RESULTS}` +
    `?start_date=${encodeURIComponent(startDate)}` +
    `&end_date=${encodeURIComponent(endDate)}` +
    `&limit=${limit}` +
    `&offset=${offset}`;

  const response = await fetch(
    url,
    {
      method: "GET",

      headers: {
        "Accept": "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; SuperLottoAI/1.0)"
      },

      cf: {
        cacheTtl: 300,
        cacheEverything: true
      }
    }
  );

  const text = await response.text();

  if (!response.ok) {

    throw new Error(
      `HTTP ${response.status} from DrawAnalytics API`
    );

  }

  let payload;

  try {

    payload = JSON.parse(text);

  } catch (error) {

    throw new Error(
      "DrawAnalytics returned non-JSON data"
    );

  }

  return {
    url,
    payload
  };
}


/* ---------------------------------------------------------
   GET ALL HISTORICAL DRAWINGS
--------------------------------------------------------- */

async function getHistoricalDraws() {

  const endDate = todayUTC();

  const diagnostics = [];

  const allDraws = [];

  /*
   * We use pagination even though the API allows
   * up to 100 results per request.
   */

  const pageSize = 100;

  let offset = 0;

  let totalReported = null;

  let pages = 0;

  const MAX_PAGES = 10;


  while (pages < MAX_PAGES) {

    const result =
      await fetchDrawAnalyticsPage(
        HISTORY_START_DATE,
        endDate,
        pageSize,
        offset
      );

    const payload = result.payload;

    const pageDraws =
      parseDrawAnalyticsJSON(payload);

    allDraws.push(...pageDraws);

    pages++;

    const meta =
      payload &&
      typeof payload === "object" &&
      payload.meta
        ? payload.meta
        : {};

    if (
      Number.isFinite(Number(meta.total))
    ) {

      totalReported =
        Number(meta.total);

    }

    diagnostics.push({
      page: pages,
      offset,
      requested: pageSize,
      returned: pageDraws.length,
      totalReported:
        totalReported
    });

    /*
     * Stop conditions.
     */

    if (pageDraws.length === 0) {
      break;
    }

    if (
      totalReported !== null &&
      allDraws.length >= totalReported
    ) {
      break;
    }

    if (pageDraws.length < pageSize) {
      break;
    }

    offset += pageSize;

  }


  /*
   * Deduplicate.
   */

  const map = new Map();

  for (const draw of allDraws) {

    map.set(
      drawKey(draw),
      draw
    );

  }


  /*
   * Sort newest first.
   */

  const draws =
    Array.from(map.values())
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date)
      )
      .slice(0, MAX_DRAWINGS);


  return {
    draws,
    diagnostics,
    totalReported,
    pages
  };

}


/* ---------------------------------------------------------
   GET LATEST DRAW DIRECTLY FROM DRAW ANALYTICS
--------------------------------------------------------- */

async function getLatestDrawAnalytics() {

  try {

    const response = await fetch(
      DRAW_ANALYTICS_LATEST,
      {
        method: "GET",

        headers: {
          "Accept": "application/json",
          "User-Agent":
            "Mozilla/5.0 (compatible; SuperLottoAI/1.0)"
        },

        cf: {
          cacheTtl: 300,
          cacheEverything: true
        }
      }
    );

    const text =
      await response.text();

    if (!response.ok) {

      return {
        ok: false,
        error:
          `HTTP ${response.status}`,
        rawPreview:
          text.slice(0, 1000)
      };

    }

    let payload;

    try {

      payload =
        JSON.parse(text);

    } catch (error) {

      return {
        ok: false,
        error:
          "Latest endpoint returned non-JSON",
        rawPreview:
          text.slice(0, 1000)
      };

    }

    const raw =
      payload &&
      payload.data
        ? payload.data
        : payload;

    const draw =
      normalizeDraw(raw);

    return {
      ok: !!draw,
      draw,
      payloadPreview: {
        success: payload?.success,
        meta: payload?.meta
      }
    };

  } catch (error) {

    return {
      ok: false,
      error:
        error?.message ||
        "Unknown latest endpoint error"
    };

  }

}/* ---------------------------------------------------------
   DEBUG HISTORY
--------------------------------------------------------- */

async function debugHistory() {

  const endDate = todayUTC();

  const results = [];

  /*
   * Request only the first 10 records.
   *
   * This lets us see exactly what the API is returning
   * without making a large request.
   */

  try {

    const result =
      await fetchDrawAnalyticsPage(
        HISTORY_START_DATE,
        endDate,
        10,
        0
      );

    const payload =
      result.payload;

    const parsed =
      parseDrawAnalyticsJSON(payload);

    results.push({

      url: result.url,

      httpStatus: 200,

      success:
        payload?.success ?? null,

      meta:
        payload?.meta ?? null,

      rawDataType:
        Array.isArray(payload?.data)
          ? "array"
          : typeof payload?.data,

      rawDataCount:
        Array.isArray(payload?.data)
          ? payload.data.length
          : 0,

      parsedDrawCount:
        parsed.length,

      parsedDraws:
        parsed.slice(0, 10),

      firstRawRecord:
        Array.isArray(payload?.data)
          ? payload.data[0] ?? null
          : null

    });

  } catch (error) {

    results.push({

      error:
        error?.message ||
        "Unknown error"

    });

  }


  /*
   * Also test the latest endpoint.
   */

  let latest;

  try {

    latest =
      await getLatestDrawAnalytics();

  } catch (error) {

    latest = {
      ok: false,
      error:
        error?.message ||
        "Unknown latest error"
    };

  }


  return json({

    debug: true,

    game: GAME_NAME,

    gameId: GAME_ID,

    timestamp:
      new Date().toISOString(),

    historyEndpoint:
      DRAW_ANALYTICS_RESULTS,

    latestEndpoint:
      DRAW_ANALYTICS_LATEST,

    dateRange: {
      start:
        HISTORY_START_DATE,
      end:
        endDate
    },

    historyTest:
      results,

    latestTest:
      latest,

    expectedRules: {
      whiteBalls:
        "5 numbers from 1-47",
      superball:
        "1 number from 1-27"
    }

  });

}


/* ---------------------------------------------------------
   CLEAN HTML
--------------------------------------------------------- */

function cleanHtml(html) {

  return String(html)

    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )

    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )

    .replace(
      /<noscript[\s\S]*?<\/noscript>/gi,
      " "
    )

    .replace(
      /<[^>]+>/g,
      " "
    )

    .replace(
      /&nbsp;/gi,
      " "
    )

    .replace(
      /&amp;/gi,
      "&"
    )

    .replace(
      /\s+/g,
      " "
    )

    .trim();

}


/* ---------------------------------------------------------
   PARSE JACKPOT FROM OFFICIAL PAGE
--------------------------------------------------------- */

function parseJackpot(text) {

  if (!text) {
    return null;
  }

  const patterns = [

    /SuperLotto Plus[\s\S]{0,300}?\$([0-9,]+)\s*MILLION/i,

    /\$([0-9,]+)\s*MILLION[\s\S]{0,200}?SuperLotto Plus/i,

    /Imagine Winning[\s\S]{0,100}?\$([0-9,]+)\s*MILLION/i

  ];


  for (
    const pattern of patterns
  ) {

    const match =
      text.match(pattern);

    if (match) {

      const value =
        Number(
          match[1]
            .replace(/,/g, "")
        );

      if (
        Number.isFinite(value)
      ) {

        return value * 1000000;

      }

    }

  }

  return null;

}


/* ---------------------------------------------------------
   PARSE NEXT DRAWING
--------------------------------------------------------- */

function parseNextDrawing(text) {

  if (!text) {
    return null;
  }


  /*
   * Examples we can encounter:
   *
   * Next Draw Wed Sep 16, 2026
   * Next Drawing Wed Sep 16, 2026
   */

  const patterns = [

    /Next\s+Draw(?:ing)?[\s\S]{0,150}?([A-Z]{3})\s+(\d{1,2}),\s*(\d{4})/i,

    /Next\s+Draw(?:ing)?[\s\S]{0,150}?([A-Z]+)\s+(\d{1,2}),\s*(\d{4})/i

  ];


  const months = {

    JAN: 0,
    FEB: 1,
    MAR: 2,
    APR: 3,
    MAY: 4,
    JUN: 5,
    JUL: 6,
    AUG: 7,
    SEP: 8,
    OCT: 9,
    NOV: 10,
    DEC: 11

  };


  for (
    const pattern of patterns
  ) {

    const match =
      text.match(pattern);

    if (!match) {
      continue;
    }


    let monthName =
      match[1]
        .toUpperCase()
        .slice(0, 3);


    const month =
      months[monthName];


    if (month === undefined) {
      continue;
    }


    const date =
      new Date(
        Date.UTC(
          Number(match[3]),
          month,
          Number(match[2])
        )
      );


    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {

      return date
        .toISOString()
        .slice(0, 10);

    }

  }


  return null;

}


/* ---------------------------------------------------------
   CURRENT HEADER
--------------------------------------------------------- */

async function getCurrentHeader() {

  try {

    const response =
      await fetch(
        OFFICIAL_URL,
        {
          method: "GET",

          headers: {
            "Accept":
              "text/html,application/xhtml+xml,text/html",
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"
          },

          cf: {
            cacheTtl: 60,
            cacheEverything: true
          }

        }
      );


    if (!response.ok) {

      throw new Error(
        `Official page HTTP ${response.status}`
      );

    }


    const html =
      await response.text();

    const text =
      cleanHtml(html);


    const jackpot =
      parseJackpot(text);

    const nextDrawing =
      parseNextDrawing(text);


    return {

      jackpot:
        jackpot ??
        FALLBACK_HEADER.jackpot,

      cashValue:
        FALLBACK_HEADER.cashValue,

      nextDrawing:
        nextDrawing ??
        FALLBACK_HEADER.nextDrawing,

      source:
        jackpot || nextDrawing
          ? "California Lottery"
          : "California Lottery fallback"

    };

  } catch (error) {

    return {

      ...FALLBACK_HEADER,

      source:
        "California Lottery fallback",

      error:
        error?.message ||
        "Unknown official page error"

    };

  }

}/* ---------------------------------------------------------
   BUILD MAIN PAYLOAD
--------------------------------------------------------- */

async function buildPayload() {

  let history;

  let header;

  /*
   * Run history and current header in parallel.
   */

  try {

    [
      history,
      header
    ] =
      await Promise.all([
        getHistoricalDraws(),
        getCurrentHeader()
      ]);

  } catch (error) {

    /*
     * If history retrieval itself fails,
     * preserve the application functionality
     * with fallback data.
     */

    header =
      await getCurrentHeader();

    history = {
      draws: [],
      diagnostics: [
        {
          error:
            error?.message ||
            "Historical retrieval failed"
        }
      ],
      totalReported: null,
      pages: 0
    };

  }


  let draws =
    history.draws;

  let historyFallbackUsed =
    false;


  /*
   * Only use the two fallback drawings if
   * absolutely no valid historical records
   * were obtained.
   */

  if (
    !Array.isArray(draws) ||
    draws.length === 0
  ) {

    draws =
      FALLBACK_DRAWS;

    historyFallbackUsed =
      true;

  }


  return {

    game:
      GAME_NAME,

    gameId:
      GAME_ID,

    jackpot:
      header.jackpot,

    cashValue:
      header.cashValue,

    nextDrawing:
      header.nextDrawing,

    updatedAt:
      new Date().toISOString(),

    source:
      historyFallbackUsed
        ? "DrawAnalytics API fallback"
        : "DrawAnalytics JSON API",

    drawCount:
      draws.length,

    draws,

    diagnostics: {

      historyFallbackUsed,

      totalReported:
        history.totalReported,

      pagesFetched:
        history.pages,

      historySources:
        history.diagnostics,

      headerSource:
        header.source,

      headerError:
        header.error ?? null,

      expectedRules: {

        whiteBalls:
          "5 numbers from 1-47",

        superball:
          "1 number from 1-27"

      }

    }

  };

}


/* ---------------------------------------------------------
   REQUEST HANDLER
--------------------------------------------------------- */

async function handleRequest(
  request
) {

  const url =
    new URL(request.url);


  /*
   * CORS preflight
   */

  if (
    request.method === "OPTIONS"
  ) {

    return new Response(
      null,
      {
        status: 204,
        headers:
          CORS_HEADERS
      }
    );

  }


  /*
   * GET only
   */

  if (
    request.method !== "GET"
  ) {

    return json(
      {
        error:
          "Method not allowed"
      },
      405
    );

  }


  /* -------------------------------------------------------
     HEALTH
  ------------------------------------------------------- */

  if (
    url.pathname === "/" ||
    url.pathname === "/api/health"
  ) {

    return json({

      ok: true,

      game:
        GAME_NAME,

      gameId:
        GAME_ID,

      endpoint:
        "/api/superlotto",

      debugEndpoint:
        "/api/debug-history",

      message:
        "SuperLotto Plus Worker is running."

    });

  }


  /* -------------------------------------------------------
     DEBUG HISTORY
  ------------------------------------------------------- */

  if (
    url.pathname === "/api/debug-history"
  ) {

    return await debugHistory();

  }


  /* -------------------------------------------------------
     MAIN SUPERLOTTO API
  ------------------------------------------------------- */

  if (
    url.pathname === "/api/superlotto" ||
    url.pathname === "/api/superlotto-plus"
  ) {

    try {

      const payload =
        await buildPayload();

      return json(
        payload,
        200
      );

    } catch (error) {

      return json({

        error:
          "SuperLotto Plus history retrieval failed",

        message:
          error?.message ||
          "Unknown error",

        draws:
          FALLBACK_DRAWS,

        drawCount:
          FALLBACK_DRAWS.length,

        jackpot:
          FALLBACK_HEADER.jackpot,

        cashValue:
          FALLBACK_HEADER.cashValue,

        nextDrawing:
          FALLBACK_HEADER.nextDrawing,

        updatedAt:
          new Date().toISOString(),

        source:
          "fallback"

      }, 200);

    }

  }


  /* -------------------------------------------------------
     NOT FOUND
  ------------------------------------------------------- */

  return json({

    error:
      "Not found",

    endpoints: [

      "/api/health",

      "/api/debug-history",

      "/api/superlotto"

    ]

  }, 404);

}


/* ---------------------------------------------------------
   CLOUDFLARE WORKER
--------------------------------------------------------- */

export default {

  async fetch(
    request,
    env,
    ctx
  ) {

    return handleRequest(
      request
    );

  }

};
