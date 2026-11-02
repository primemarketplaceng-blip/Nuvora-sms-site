const manifest = {
  id: "com.melstream.auto",
  version: "1.0.0",
  name: "MelStream Auto",
  description: "MelStream movie and series add-on",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: []
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/manifest.json") {
      return Response.json(manifest, { headers });
    }

    const match = url.pathname.match(
      /^\/stream\/(movie|series)\/([^/.]+)\.json$/
    );

    if (match) {
      const [, type, id] = match;

      return Response.json({
        streams: [],
        message: "No authorised video provider connected yet.",
        requested: { type, id }
      }, { headers });
    }

    return Response.json({
      name: "MelStream Auto",
      status: "online",
      version: "1.0.0"
    }, { headers });
  }
};
