/**
 * SuperLotto Plus AI Lab V6.3.1
 * Historical-data Worker
 *
 * Main endpoint:
 *   /api/superlotto
 *
 * Health:
 *   /api/health
 *
 * Data source:
 *   LotteryCorner historical SuperLotto Plus archives
 *
 * Rules:
 *   5 white numbers: 1-47
 *   Superball: 1-27
 */

const GAME_NAME = "SuperLotto Plus";

const HISTORY_URLS = [
  "https://lotterycorner.com/ca/superlotto-plus/2026",
  "https://lotterycorner.com/ca/superlotto-plus/2025"
];

const OFFICIAL_URL =
  "https://www.calottery.com/en/draw-games/superlotto-plus";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

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

function normalizeDate(value) {
  if (!value) return null;

  const text =
    String(value).trim();

  const match =
    text.match(
      /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/
    );

  if (!match) return null;

  const months = {
    January: "01",
    February: "02",
    March: "03",
    April: "04",
    May: "05",
    June: "06",
    July: "07",
    August: "08",
    September: "09",
    October: "10",
    November: "11",
    December: "12"
  };

  const month =
    months[match[1]];

  if (!month) return null;

  return (
    match[3] +
    "-" +
    month +
    "-" +
    String(match[2]).padStart(2, "0")
  );
}

function cleanHtml(html) {
  return html
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

function validateDraw(
  date,
  white,
  pb
) {
  if (!date) return false;

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

function parseArchive(html) {
  const text =
    cleanHtml(html);

  const draws = [];

  /*
   * LotteryCorner table format:
   *
   * September 12, 2026
   * 13 26 29 35 47 8 Mega Ball
   */

  const datePattern =
    "(January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+\\d{4}";

  const regex =
    new RegExp(
      `(${datePattern})\\s+(\\d{1,2})\\s+(\\d{1,2})\\s+(\\d{1,2})\\s+(\\d{1,2})\\s+(\\d{1,2})\\s+(\\d{1,2})\\s+Mega\\s+Ball`,
      "gi"
    );

  let match;

  while (
    (match = regex.exec(text)) !== null
  ) {
    const date =
      normalizeDate(match[1]);

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
      validateDraw(
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
}async function fetchArchive(url) {
  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          "Accept":
            "text/html,application/xhtml+xml",

          "User-Agent":
            "Mozilla/5.0 (compatible; SuperLottoPlus-AI-Lab/6.3.1)"
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

  return response.text();
}

function deduplicateDraws(draws) {
  const map = new Map();

  for (
    const draw of draws
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

  return [
    ...map.values()
  ]
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date)
    )
    .slice(
      0,
      MAX_DRAWINGS
    );
}

async function getHistoricalDraws() {
  const results =
    await Promise.allSettled(
      HISTORY_URLS.map(
        async url => {
          const html =
            await fetchArchive(
              url
            );

          const draws =
            parseArchive(
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

  const draws =
    deduplicateDraws(
      allDraws
    );

  return {
    draws,
    diagnostics
  };
}

function parseMoney(text) {
  if (!text) return null;

  const match =
    text.match(
      /\$([0-9,]+(?:\.[0-9]+)?)/
    );

  if (!match) return null;

  return Number(
    match[1].replace(
      /,/g,
      ""
    )
  );
}

async function getCurrentHeader() {
  try {
    const response =
      await fetch(
        OFFICIAL_URL,
        {
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
        `HTTP ${response.status}`
      );
    }

    const html =
      await response.text();

    const text =
      cleanHtml(html);

    /*
     * Try to locate jackpot.
     */
    let jackpot = null;

    const jackpotMatch =
      text.match(
        /SuperLotto Plus.{0,200}?\$([0-9,]+)\s*(?:Million|M)/i
      );

    if (jackpotMatch) {
      jackpot =
        Number(
          jackpotMatch[1]
            .replace(/,/g, "")
        );

      /*
       * If the page says Million,
       * convert to dollars.
       */
      if (
        /Million|M/i.test(
          jackpotMatch[0]
        )
      ) {
        jackpot *=
          1000000;
      }
    }

    return {
      jackpot:
        jackpot ||
        FALLBACK_HEADER.jackpot,

      cashValue:
        FALLBACK_HEADER.cashValue,

      nextDrawing:
        FALLBACK_HEADER.nextDrawing,

      source:
        jackpot
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
}async function buildPayload() {
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

  let fallbackUsed =
    false;

  /*
   * If both archive requests fail,
   * keep the Worker functional.
   */
  if (
    draws.length === 0
  ) {
    draws =
      deduplicateDraws(
        FALLBACK_DRAWS
      );

    fallbackUsed =
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
      "LotteryCorner historical archive",

    drawCount:
      draws.length,

    draws,

    diagnostics: {
      historySources:
        history.diagnostics,

      historyFallbackUsed:
        fallbackUsed,

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
