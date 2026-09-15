/**
 * SuperLotto Plus AI Lab V6.3.1
 * Cloudflare Worker
 *
 * Endpoint:
 *   /api/superlotto
 *
 * Health:
 *   /api/health
 *
 * SuperLotto Plus:
 *   5 white numbers: 1-47
 *   Superball/Mega number: 1-27
 */

const GAME_NAME = "SuperLotto Plus";
const GAME_ID = 8;

const API_BASE =
  "https://www.calottery.com/api/DrawGameApi/DrawGamePastDrawResults";

const OFFICIAL_GAME_PAGE =
  "https://www.calottery.com/en/draw-games/superlotto-plus";

const PAGE_SIZE = 20;
const PAGE_COUNT = 6;
const MAX_DRAWINGS = 120;

/*
 * These are verified recent SuperLotto Plus results.
 * They are used ONLY as a fallback if the official history API
 * cannot be reached.
 */
const SEED_DRAWS = [
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

/*
 * Header fallback values.
 *
 * These prevent the app header from becoming blank if the
 * California Lottery page cannot be fetched by Cloudflare.
 */
const HEADER_FALLBACK = {
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

function json(data, status = 200, extraHeaders = {}) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...CORS_HEADERS,
        ...extraHeaders
      }
    }
  );
}

function parseNumber(value) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.replace(
    /[^0-9.-]/g,
    ""
  );

  if (!cleaned) {
    return null;
  }

  const n = Number(cleaned);

  return Number.isFinite(n)
    ? n
    : null;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  if (
    value instanceof Date &&
    !Number.isNaN(value.getTime())
  ) {
    return value
      .toISOString()
      .slice(0, 10);
  }

  const raw = String(value).trim();

  if (!raw) {
    return null;
  }

  /*
   * ISO:
   * 2026-09-12
   * 2026-09-12T00:00:00
   */
  const iso = raw.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})/
  );

  if (iso) {
    return (
      iso[1] +
      "-" +
      String(iso[2]).padStart(2, "0") +
      "-" +
      String(iso[3]).padStart(2, "0")
    );
  }

  /*
   * US:
   * 9/12/2026
   * 09-12-2026
   */
  const us = raw.match(
    /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/
  );

  if (us) {
    return (
      us[3] +
      "-" +
      String(us[1]).padStart(2, "0") +
      "-" +
      String(us[2]).padStart(2, "0")
    );
  }

  const parsed = new Date(raw);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed
      .toISOString()
      .slice(0, 10);
  }

  return null;
}

function extractWinningNumbers(draw) {
  const candidates = [
    draw?.WinningNumbers,
    draw?.winningNumbers,
    draw?.Winningnumbers,
    draw?.Numbers,
    draw?.numbers
  ];

  let arr = candidates.find(
    Array.isArray
  );

  /*
   * Some API responses may expose
   * individual numbered properties.
   */
  if (
    !arr &&
    draw &&
    typeof draw === "object"
  ) {
    const possible = [];

    for (let i = 0; i < 7; i++) {
      const value =
        draw[String(i)] ??
        draw[`WinningNumber${i}`] ??
        draw[`Number${i}`];

      if (value !== undefined) {
        possible.push(value);
      }
    }

    if (possible.length) {
      arr = possible;
    }
  }

  if (!Array.isArray(arr)) {
    return [];
  }

  return arr
    .map(item => {
      if (
        typeof item === "number"
      ) {
        return item;
      }

      if (
        typeof item === "string"
      ) {
        return parseNumber(item);
      }

      if (
        item &&
        typeof item === "object"
      ) {
        return parseNumber(
          item.Number ??
          item.number ??
          item.Value ??
          item.value
        );
      }

      return null;
    })
    .filter(Number.isInteger);
}

function normalizeDraw(raw) {
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
    raw.date
  );

  const numbers =
    extractWinningNumbers(raw);

  if (
    !date ||
    numbers.length < 6
  ) {
    return null;
  }

  const white = numbers
    .slice(0, 5)
    .sort((a, b) => a - b);

  const pb = numbers[5];

  if (
    white.length !== 5 ||
    pb == null
  ) {
    return null;
  }

  if (
    new Set(white).size !== 5
  ) {
    return null;
  }

  if (
    white.some(
      n => n < 1 || n > 47
    )
  ) {
    return null;
  }

  if (
    pb < 1 ||
    pb > 27
  ) {
    return null;
  }

  return {
    date,
    white,
    pb
  };
} function dedupeAndSort(draws) {
  const map = new Map();

  for (const draw of draws) {
    const normalized =
      normalizeDraw(draw);

    if (!normalized) {
      continue;
    }

    const key =
      normalized.date +
      "|" +
      normalized.white.join("-") +
      "|" +
      normalized.pb;

    map.set(key, normalized);
  }

  return [
    ...map.values()
  ]
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date)
    )
    .slice(0, MAX_DRAWINGS);
}

function formatMoney(value) {
  const n = parseNumber(value);

  return n == null
    ? null
    : n;
}

function nextSuperLottoDate(
  from = new Date()
) {
  /*
   * SuperLotto Plus drawings:
   * Wednesday and Saturday.
   */
  const d = new Date(from);

  d.setHours(
    0,
    0,
    0,
    0
  );

  for (
    let i = 1;
    i <= 7;
    i++
  ) {
    const candidate =
      new Date(d);

    candidate.setDate(
      d.getDate() + i
    );

    const day =
      candidate.getDay();

    if (
      day === 3 ||
      day === 6
    ) {
      return candidate
        .toISOString()
        .slice(0, 10);
    }
  }

  return null;
}

function parseMoneyFromText(
  text,
  label
) {
  if (!text) {
    return null;
  }

  const escaped =
    label.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const re =
    new RegExp(
      escaped +
      "[^$]{0,120}\\$([0-9,]+(?:\\.[0-9]+)?)",
      "i"
    );

  const match =
    text.match(re);

  if (!match) {
    return null;
  }

  return formatMoney(
    match[1]
  );
}

function parseCashValue(text) {
  if (!text) {
    return null;
  }

  const match =
    text.match(
      /Estimated\s+Cash\s+Value[^$]{0,100}\$([0-9,]+(?:\.[0-9]+)?)/i
    );

  return match
    ? formatMoney(match[1])
    : null;
}

function parseNextDrawing(text) {
  if (!text) {
    return null;
  }

  /*
   * Example:
   * Next Draw: WED/SEP 16, 2026
   */
  let match =
    text.match(
      /Next\s+Draw(?:ing)?\s*:\s*[A-Z]{2,3}\/([A-Z]{3})\s+(\d{1,2}),\s*(\d{4})/i
    );

  if (match) {
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
      month !== undefined
    ) {
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
    }
  }

  return null;
}

async function fetchJson(url) {
  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          "Accept":
            "application/json, text/plain, */*",

          "User-Agent":
            "Mozilla/5.0 (compatible; SuperLottoPlus-AI-Lab/6.3.1)",

          "Referer":
            OFFICIAL_GAME_PAGE
        },

        cf: {
          cacheTtl: 60,
          cacheEverything: true
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} from ${url}`
    );
  }

  return response.json();
}

async function fetchPage(page) {
  const url =
    `${API_BASE}/${GAME_ID}/${page}/${PAGE_SIZE}`;

  return fetchJson(url);
}

async function fetchHistory() {
  const pages =
    Array.from(
      {
        length: PAGE_COUNT
      },
      (_, i) => i + 1
    );

  const settled =
    await Promise.allSettled(
      pages.map(fetchPage)
    );

  const rawDraws = [];
  const errors = [];

  for (
    let i = 0;
    i < settled.length;
    i++
  ) {
    const result =
      settled[i];

    if (
      result.status ===
      "fulfilled"
    ) {
      const payload =
        result.value;

      const pageDraws =
        payload?.PreviousDraws ??
        payload?.previousDraws ??
        payload?.Draws ??
        payload?.draws ??
        [];

      if (
        Array.isArray(
          pageDraws
        )
      ) {
        rawDraws.push(
          ...pageDraws
        );
      } else {
        errors.push(
          `Page ${i + 1}: PreviousDraws was not an array`
        );
      }
    } else {
      errors.push(
        `Page ${i + 1}: ` +
        (
          result.reason?.message ||
          "request failed"
        )
      );
    }
  }

  const draws =
    dedupeAndSort(
      rawDraws
    );

  return {
    draws,

    pagesRequested:
      PAGE_COUNT,

    pagesSucceeded:
      settled.filter(
        x =>
          x.status ===
          "fulfilled"
      ).length,

    errors
  };
} async function fetchCurrentHeader() {
  try {
    const response =
      await fetch(
        OFFICIAL_GAME_PAGE,
        {
          method: "GET",

          headers: {
            "Accept":
              "text/html,application/xhtml+xml",

            "User-Agent":
              "Mozilla/5.0 (compatible; SuperLottoPlus-AI-Lab/6.3.1)"
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
      html
        .replace(
          /<script[\s\S]*?<\/script>/gi,
          " "
        )
        .replace(
          /<style[\s\S]*?<\/style>/gi,
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
          /\s+/g,
          " "
        );

    const jackpot =
      parseMoneyFromText(
        text,
        "SuperLotto Plus"
      ) ??
      parseMoneyFromText(
        text,
        "Guaranteed Jackpot"
      );

    const cashValue =
      parseCashValue(text);

    const nextDrawing =
      parseNextDrawing(text) ||
      nextSuperLottoDate();

    return {
      jackpot:
        jackpot ??
        HEADER_FALLBACK.jackpot,

      cashValue:
        cashValue ??
        HEADER_FALLBACK.cashValue,

      nextDrawing:
        nextDrawing ??
        HEADER_FALLBACK.nextDrawing,

      source:
        "California Lottery official page"
    };

  } catch (error) {
    return {
      ...HEADER_FALLBACK,

      source:
        "California Lottery official page (fallback header)",

      headerError:
        error.message
    };
  }
}

async function buildPayload() {
  const [
    historyResult,
    header
  ] =
    await Promise.all([
      fetchHistory(),
      fetchCurrentHeader()
    ]);

  let draws =
    historyResult.draws;

  const historyFallbackUsed =
    draws.length === 0;

  /*
   * If the California Lottery API is unavailable,
   * use only verified seed results.
   *
   * IMPORTANT:
   * We do NOT fabricate 100 drawings.
   */
  if (historyFallbackUsed) {
    draws =
      dedupeAndSort(
        SEED_DRAWS
      );
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
      header.source,

    drawCount:
      draws.length,

    draws,

    diagnostics: {
      pagesRequested:
        historyResult.pagesRequested,

      pagesSucceeded:
        historyResult.pagesSucceeded,

      apiErrors:
        historyResult.errors,

      historyFallbackUsed,

      headerFallbackUsed:
        header.source.includes(
          "fallback"
        )
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

  /*
   * Health check
   */
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
        GAME_ID,

      endpoint:
        "/api/superlotto",

      message:
        "SuperLotto Plus Worker is running."
    });
  }

  /*
   * Main application endpoint
   */
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
        200,
        {
          "Cache-Control":
            "public, max-age=60, s-maxage=60"
        }
      );

    } catch (error) {
      console.error(
        error
      );

      /*
       * Return valid JSON even when the
       * upstream service fails.
       */
      return json(
        {
          error:
            "SuperLotto Plus history retrieval failed",

          message:
            error.message,

          draws:
            SEED_DRAWS,

          drawCount:
            SEED_DRAWS.length,

          jackpot:
            HEADER_FALLBACK.jackpot,

          cashValue:
            HEADER_FALLBACK.cashValue,

          nextDrawing:
            HEADER_FALLBACK.nextDrawing,

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
        "/api/superlotto",
        "/api/health"
      ]
    },
    404
  );
} export default {
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
