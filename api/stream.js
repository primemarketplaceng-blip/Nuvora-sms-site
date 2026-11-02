export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  try {
    const { type } = req.query;
    const parts = String(req.query.id || "").split(":");
    const imdbId = parts[0];
    const season = Number(parts[1]) || null;
    const episode = Number(parts[2]) || null;

    if (!["movie", "series"].includes(type) || !/^tt\d+$/.test(imdbId)) {
      return res.status(400).json({ streams: [] });
    }

    const metaResponse = await fetch(
      `https://cinemeta-live.strem.io/meta/${type}/${encodeURIComponent(imdbId)}.json`
    );

    if (!metaResponse.ok) {
      return res.status(200).json({ streams: [] });
    }

    const metaData = await metaResponse.json();
    let title = metaData.meta?.name;

    if (!title) return res.status(200).json({ streams: [] });

    if (type === "series") {
      if (!season || !episode) {
        return res.status(200).json({ streams: [] });
      }

      const selectedEpisode = (metaData.meta?.videos || []).find(video =>
        Number(video.season) === season &&
        Number(video.episode) === episode
      );

      if (!selectedEpisode?.title) {
        return res.status(200).json({ streams: [] });
      }

      title = selectedEpisode.title;
    }

    const normalize = value =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    const cleanTitle = title.replace(/["\\]/g, "");

    const searchURL = new URL("https://archive.org/advancedsearch.php");

    searchURL.searchParams.set(
      "q",
      `mediatype:movies AND title:"${cleanTitle}"`
    );

    ["identifier", "title"].forEach(field =>
      searchURL.searchParams.append("fl[]", field)
    );

    searchURL.searchParams.set("rows", "30");
    searchURL.searchParams.set("output", "json");

    const searchResponse = await fetch(searchURL);
    if (!searchResponse.ok) return res.status(200).json({ streams: [] });

    const searchData = await searchResponse.json();
    const results = searchData.response?.docs || [];

    const target = normalize(title);
    const streams = [];

    for (const item of results) {
      if (streams.length >= 5) break;

      const resultTitle = normalize(item.title);

      // Reject weak title matches.
      if (!resultTitle.includes(target) && !target.includes(resultTitle)) {
        continue;
      }

      const metadataResponse = await fetch(
        `https://archive.org/metadata/${encodeURIComponent(item.identifier)}`
      );

      if (!metadataResponse.ok) continue;

      const metadata = await metadataResponse.json();
      const info = metadata.metadata || {};

      const license = String(info.licenseurl || "").toLowerCase();

      if (!license.includes("publicdomain/mark/1.0")) continue;

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

      videoFiles.sort((a, b) => {
        const quality = file => {
          const text = `${file.name} ${file.format}`.toLowerCase();
          if (/1080|1920/.test(text)) return 3;
          if (/720|1280/.test(text)) return 2;
          if (/480|640/.test(text)) return 1;
          return 0;
        };

        return quality(b) - quality(a);
      });

      for (const video of videoFiles.slice(0, 2)) {
        const encodedPath = video.name
          .split("/")
          .map(encodeURIComponent)
          .join("/");

        streams.push({
          name: "MelStream Auto",
          title: `${item.title} - ${qualityLabel(video)}`,
          url: `https://archive.org/download/${encodeURIComponent(item.identifier)}/${encodedPath}`
        });

        if (streams.length >= 5) break;
      }
    }

    return res.status(200).json({ streams });

    function qualityLabel(file) {
      const text = `${file.name} ${file.format}`.toLowerCase();
      if (/1080|1920/.test(text)) return "1080p";
      if (/720|1280/.test(text)) return "720p";
      if (/480|640/.test(text)) return "480p";
      return "Quality unspecified";
    }

  } catch (error) {
    return res.status(200).json({
      streams: [],
      message: "MelStream provider search failed."
    });
  }
}
