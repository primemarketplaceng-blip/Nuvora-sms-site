export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const { type, id, season, episode } = req.query;

  if (!["movie", "series"].includes(type) || !id) {
    return res.status(400).json({ error: "Invalid request" });
  }

  return res.status(200).json({
    streams: [],
    message: "MelStream is online. Video provider connection pending.",
    requested: {
      type,
      id,
      season: season || null,
      episode: episode || null
    }
  });
}
