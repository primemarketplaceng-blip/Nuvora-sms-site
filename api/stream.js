export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  try {
    const { type, id } = req.query;

    if (!["movie", "series"].includes(type) || !id) {
      return res.status(400).json({ streams: [] });
    }

    // Get the movie or series title from Cinemeta.
    const metaResponse = await fetch(
      `https://cinemeta-live.strem.io/meta/${type}/${encodeURIComponent(id)}.json`
    );

    if (!metaResponse.ok) {
      return res.status(200).json({ streams: [] });
    }

    const metaData = await metaResponse.json();
    const title = metaData.meta?.name;

    if (!title) {
      return res.status(200).json({ streams: [] });
    }

    // Search Internet Archive for matching films.
    const searchURL = new URL(
      "https://archive.org/advancedsearch.php"
    );

    searchURL.searchParams.set(
      "q",
      `mediatype:movies AND title:"${title.replace(/["\\]/g, "")}"`
    );

    searchURL.searchParams.set(
      "fl[]",
      "identifier,title"
    );

    searchURL.searchParams.set("rows", "10");
    searchURL.searchParams.set("output", "json");

    const searchResponse = await fetch(searchURL);

    if (!searchResponse.ok) {
      return res.status(200).json({ streams: [] });
    }

    const searchData = await searchResponse.json();
    const results = searchData.response?.docs || [];

    const streams = [];

    for (const item of results) {
      const metadataResponse = await fetch(
        `https://archive.org/metadata/${encodeURIComponent(item.identifier)}`
      );

      if (!metadataResponse.ok) continue;

      const metadata = await metadataResponse.json();
      const info = metadata.metadata || {};

      // Only accept items explicitly marked as public domain.
      const license = String(info.licenseurl || "").toLowerCase();

      if (!license.includes("publicdomain/mark/1.0")) {
        continue;
      }

      const files = metadata.files || [];

      const video = files.find(file => {
        const name = String(file.name || "").toLowerCase();
        const format = String(file.format || "").toLowerCase();

        return (
          name.endsWith(".mp4") &&
          (format.includes("mpeg4") || format.includes("h.264")) &&
          !name.includes("sample")
        );
      });

      if (!video) continue;

      streams.push({
        name: "MelStream Auto",
        title: item.title,
        url: `https://archive.org/download/${encodeURIComponent(item.identifier)}/${encodeURIComponent(video.name)}`
      });

      break;
    }

    return res.status(200).json({ streams });

  } catch (error) {
    return res.status(200).json({
      streams: [],
      message: "Provider search failed."
    });
  }
}
