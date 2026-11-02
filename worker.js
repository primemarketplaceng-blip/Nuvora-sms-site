export default {
  async fetch(request) {
    const url = new URL(request.url);

    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "GET, OPTIONS"
        }
      });
    }

    if (request.method !== "GET") {
      return Response.json(
        { error: "Method not allowed" },
        { status: 405, headers }
      );
    }

    const type = url.searchParams.get("type");
    const id = url.searchParams.get("id");
    const season = url.searchParams.get("season");
    const episode = url.searchParams.get("episode");

    if (!["movie", "tv"].includes(type) || !id) {
      return Response.json(
        { error: "Invalid media type or missing ID" },
        { status: 400, headers }
      );
    }

    if (
      type === "tv" &&
      (!season || !episode ||
       !Number.isInteger(Number(season)) ||
       !Number.isInteger(Number(episode)))
    ) {
      return Response.json(
        { error: "TV requests require a valid season and episode" },
        { status: 400, headers }
      );
    }

    return Response.json({
      qualities: [],
      subtitles: []
    }, { headers });
  }
};
