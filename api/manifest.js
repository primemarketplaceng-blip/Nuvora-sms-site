export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  res.status(200).json({
    id: "com.melstream.auto",
    version: "1.0.1",
    name: "MelStream Auto",
    description: "MelStream movie and series add-on",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
  });
}
