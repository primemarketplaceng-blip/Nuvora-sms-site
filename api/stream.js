export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  try {
    const { type } = req.query;
    let rawId = req.query.id;

    if (!["movie", "series"].includes(type) || !rawId) {
      return res.status(400).json({ streams: [] });
    }

    // Extract series episode information.
    const parts = rawId.split(":");
    const imdbId = parts[0];
    const season = parts[1] ? Number(parts[1]) : null;
    const episode = parts[2] ? Number(parts[2]) : null;

    const metaResponse = await fetch(
      `https://cinemeta-live.strem.io/meta/${type}/${encodeURIComponent(imdbId)}.json`
    );

    if (!metaResponse.ok) {
      return res.status(200).json({ streams: [] });
    }

    const metaData = await metaResponse.json();
    let title = metaData.meta?.name;

    if (!title) {
      return res.status(200).json({ streams: [] });
    }

    // Find the exact episode title for series.
    if (type === "series") {
      if (!season || !episode) {
        return res.status(200).json({ streams: [] });
      }

      const videos = metaData.meta?.videos || [];

      const selectedEpisode = videos.find(video =>
        Number(video.season) === season &&
        Number(video.episode) === episode
      );

      if (!selectedEpisode?.title) {
        return res.status(200).json({ streams: [] });
      }

      title = selectedEpisode.title;
    }

    // Search Internet Archive.
    const searchURL = new URL(
      "https://archive.org/advancedsearch.php"
    );

    const cleanTitle = title.replace(/["\\]/g, "");

    searchURL.searchParams.set(
      "q",
      `mediatype:movies AND title:"${cleanTitle}"`
    );

    searchURL.searchParams.append("fl[]", "identifier");
    searchURL.searchParams.append("fl[]", "title");
    searchURL.searchParams.set("rows", "20");
    searchURL.searchParams.set("output", "json");

    const searchResponse = await fetch(searchURL);

    if (!searchResponse.ok) {
      return res.status(200).json({ streams: [] });
    }

    const searchData = await searchResponse.json();
    const results = searchData.response?.docs || [];

    const streams = [];

    // Check multiple matching records.
    for (const item of results) {
      if (streams.length >= 3) break;

      const metadataResponse = await fetch(
        `https://archive.org/metadata/${encodeURIComponent(item.identifier)}`
      );

      if (!metadataResponse.ok) continue;

      const metadata = await metadataResponse.json();
      const info = metadata.metadata || {};

      // Only accept explicitly public-domain-marked material.
      const license = String(info.licenseurl || "").toLowerCase();

      if (!license.includes("publicdomain/mark/1.0")) {
        continue;
      }

      const files = metadata.files || [];

      const videoFiles = files.filter(file => {
        const name = String(file.name || "").toLowerCase();
        const format = String(file.format || "").toLowerCase();

        return (
          name.endsWith(".mp4") &&
          (format.includes("mpeg4") || format.includes("h.264")) &&
          !name.includes("sample")
        );
      });

      for (const video of videoFiles.slice(0, 1)) {
        streams.push({
          name: "MelStream Auto",
          title: `${item.title} - Internet Archive`,
          url: `https://archive.org/download/${encodeURIComponent(item.identifier)}/${video.name.split("/").map(encodeURIComponent).join("/")}`
        });
      }
    }

    return res.status(200).json({ streams });

  } catch (error) {
    return res.status(200).json({
      streams: [],
      message: "MelStream provider search failed."
    });
  }
}
