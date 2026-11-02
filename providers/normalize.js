export function normalizeStreams(streams, providerName) {
  if (!Array.isArray(streams)) {
    return [];
  }

  return streams
    .filter(stream =>
      stream &&
      typeof stream.url === "string" &&
      /^https:\/\//i.test(stream.url)
    )
    .map(stream => ({
      provider: providerName,
      quality: stream.quality || "Auto",
      url: stream.url,
      subtitles: Array.isArray(stream.subtitles)
        ? stream.subtitles
        : []
    }));
}
