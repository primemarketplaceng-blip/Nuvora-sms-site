const IMDB_PATTERN = /^tt\d+$/i;

export function parseMedia(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid media request");
  }

  const type = String(input.type || "").toLowerCase();

  if (!["movie", "series"].includes(type)) {
    throw new Error("Unsupported media type");
  }

  const imdbId = String(
    input.imdbId || input.id || ""
  ).split(":")[0];

  if (!IMDB_PATTERN.test(imdbId)) {
    throw new Error("Invalid IMDb ID");
  }

  if (type === "movie") {
    return {
      type: "movie",
      imdbId
    };
  }

  const season = Number(input.season);
  const episode = Number(input.episode);

  if (
    !Number.isInteger(season) ||
    !Number.isInteger(episode) ||
    season < 1 ||
    episode < 1
  ) {
    throw new Error("Valid season and episode numbers are required");
  }

  return {
    type: "series",
    imdbId,
    season,
    episode
  };
}
