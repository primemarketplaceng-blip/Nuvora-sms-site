import providers from "../providers.js";

export async function findStreams(media) {
  const results = [];

  for (const provider of providers) {
    if (!provider.enabled) continue;

    try {
      if (typeof provider.resolve !== "function") continue;

      const streams = await provider.resolve(media);

      if (Array.isArray(streams)) {
        results.push(...streams);
      }
    } catch (error) {
      console.error(`${provider.name} failed:`, error.message);
    }
  }

  return results;
}

export function formatStreams(streams) {
  return {
    qualities: streams.map((stream, index) => ({
      name: stream.quality || `Source ${index + 1}`,
      link: stream.url
    })),
    subtitles: []
  };
}
