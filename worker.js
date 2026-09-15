/**
 * SuperLotto Plus AI Lab V6.3.1
 * Cloudflare Worker
 *
 * Main:
 *   /api/superlotto
 *
 * Health:
 *   /api/health
 *
 * Historical source:
 *   DrawAnalytics
 *
 * SuperLotto Plus:
 *   5 numbers from 1-47
 *   Superball from 1-27
 */

const GAME_NAME = "SuperLotto Plus";

const HISTORY_URLS = [
  "https://www.drawanalytics.com/california/results/superlotto_plus/2026",
  "https://www.drawanalytics.com/california/results/superlotto_plus/2025"
];

const OFFICIAL_URL =
  "https://www.calottery.com/en/draw-games/superlotto-plus";

const MAX_DRAWINGS = 150;

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

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        ...CORS_HEADERS
      }
    }
  );
}

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
      /&#124;/gi,
      "|"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function validDraw(date, white, pb) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return false;
  }

  if (
    !Array.isArray(white) ||
    white.length !== 5
  ) {
    return false;
  }

  if (
    new Set(white).size !== 5
  ) {
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

/*
 * DrawAnalytics text format:
 *
 * 2026-09-12 | 13 26 29 35 47+8 | $55,000,000
 *
 * We intentionally parse the simple date/numbers
 * portion and ignore jackpot text.
 */
function parseDrawAnalytics(html) {
  const text = cleanHtml(html);

  const draws = [];

  const pattern =
    /(\d{4}-\d{2}-\d{2})\s*\|\s*(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s*\+\s*(\d{1,2})/g;

  let match;

  while (
    (match = pattern.exec(text)) !== null
  ) {
    const date = match[1];

    const white = [
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6])
    ].sort(
      (a, b) => a - b
    );

    const pb =
      Number(match[7]);

    if (
      validDraw(
        date,
        white,
        pb
      )
    ) {
      draws.push({
        date,
        white,
        pb
      });
    }
  }

  return draws;
}async function fetchHistoryPage(url) {
  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          "Accept":
            "text/html,application/xhtml+xml,text/plain,*/*",

          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",

          "Accept-Language":
            "en-US,en;q=0.9"
        },

        cf: {
          cacheTtl: 300,
          cacheEverything: true
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} from ${url}`
    );
  }

  return await response.text();
}

async function getHistoricalDraws() {
  const results =
    await Promise.allSettled(
      HISTORY_URLS.map(
        async url => {
          const html =
            await fetchHistoryPage(
              url
            );

          const draws =
            parseDrawAnalytics(
              html
            );

          return {
            url,
            draws
          };
        }
      )
    );

  const allDraws = [];
  const diagnostics = [];

  for (
    const result of results
  ) {
    if (
      result.status ===
      "fulfilled"
    ) {
      allDraws.push(
        ...result.value.draws
      );

      diagnostics.push({
        url:
          result.value.url,

        status:
          "success",

        drawCount:
          result.value.draws.length
      });
    } else {
      diagnostics.push({
        status:
          "error",

        error:
          result.reason?.message ||
          "Unknown error"
      });
    }
  }

  /*
   * Remove duplicate records.
   */
  const map = new Map();

  for (
    const draw of allDraws
  ) {
    const key =
      draw.date +
      "|" +
      draw.white.join("-") +
      "|" +
      draw.pb;

    map.set(
      key,
      draw
    );
  }

  const draws =
    Array.from(
      map.values()
    )
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date)
      )
      .slice(
        0,
        MAX_DRAWINGS
      );

  return {
    draws,
    diagnostics
  };
}

function parseJackpot(text) {
  /*
   * Look for a dollar amount near
   * SuperLotto Plus.
   */
  const patterns = [
    /SuperLotto Plus[\s\S]{0,200}?\$([0-9,]+)\s*MILLION/i,
    /\$([0-9,]+)\s*MILLION[\s\S]{0,100}?SuperLotto Plus/i
  ];

  for (
    const pattern of patterns
  ) {
    const match =
      text.match(pattern);

    if (match) {
      const value =
        Number(
          match[1].replace(
            /,/g,
            ""
          )
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

function parseNextDrawing(text) {
  /*
   * Look for:
   * SEP 16, 2026
   *
   * We mainly use the known
   * Wednesday/Saturday schedule
   * as a fallback.
   */
  const match =
    text.match(
      /Next\s+Draw(?:ing)?[\s\S]{0,100}?([A-Z]{3})\s+(\d{1,2}),\s*(\d{4})/i
    );

  if (!match) {
    return null;
  }

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

  const month =
    months[
      match[1].toUpperCase()
    ];

  if (
    month === undefined
  ) {
    return null;
  }

  const d =
    new Date(
      Date.UTC(
        Number(match[3]),
        month,
        Number(match[2])
      )
    );

  return d
    .toISOString()
    .slice(0, 10);
}async function getCurrentHeader() {
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
        jackpot ||
        nextDrawing
          ? "California Lottery"
          : "California Lottery fallback"
    };

  } catch (error) {
    return {
      ...FALLBACK_HEADER,

      source:
        "California Lottery fallback",

      error:
        error.message
    };
  }
}

async function buildPayload() {
  const [
    history,
    header
  ] =
    await Promise.all([
      getHistoricalDraws(),
      getCurrentHeader()
    ]);

  let draws =
    history.draws;

  let historyFallbackUsed =
    false;

  /*
   * Only use fallback if BOTH history
   * pages failed to produce results.
   */
  if (
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
      8,

    jackpot:
      header.jackpot,

    cashValue:
      header.cashValue,

    nextDrawing:
      header.nextDrawing,

    updatedAt:
      new Date().toISOString(),

    source:
      "DrawAnalytics historical archive",

    drawCount:
      draws.length,

    draws,

    diagnostics: {
      historySources:
        history.diagnostics,

      historyFallbackUsed,

      headerSource:
        header.source,

      expectedRules: {
        whiteBalls:
          "5 numbers from 1-47",

        superball:
          "1 number from 1-27"
      }
    }
  };
}

async function handleRequest(
  request
) {
  const url =
    new URL(
      request.url
    );

  if (
    request.method ===
    "OPTIONS"
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

  if (
    request.method !==
    "GET"
  ) {
    return json(
      {
        error:
          "Method not allowed"
      },
      405
    );
  }

  if (
    url.pathname === "/" ||
    url.pathname ===
      "/api/health"
  ) {
    return json({
      ok: true,

      game:
        GAME_NAME,

      gameId:
        8,

      endpoint:
        "/api/superlotto",

      message:
        "SuperLotto Plus Worker is running."
    });
  }

  if (
    url.pathname ===
      "/api/superlotto" ||
    url.pathname ===
      "/api/superlotto-plus"
  ) {
    try {
      const payload =
        await buildPayload();

      return json(
        payload,
        200
      );

    } catch (error) {
      return json(
        {
          error:
            "SuperLotto Plus history retrieval failed",

          message:
            error.message,

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
        },
        200
      );
    }
  }

  return json(
    {
      error:
        "Not found",

      endpoints: [
        "/api/health",
        "/api/superlotto"
      ]
    },
    404
  );
}export default {
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
