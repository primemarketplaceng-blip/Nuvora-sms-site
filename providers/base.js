export class BaseProvider {
  constructor({ id, name, endpoint }) {
    this.id = id;
    this.name = name;
    this.endpoint = endpoint;
  }

  async resolve(media) {
    if (!this.endpoint) {
      throw new Error(`${this.name}: API endpoint not configured`);
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: media.type,
        imdbId: media.imdbId,
        season: media.season ?? null,
        episode: media.episode ?? null
      })
    });

    if (!response.ok) {
      throw new Error(`${this.name}: Request failed (${response.status})`);
    }

    const data = await response.json();

    if (!Array.isArray(data.streams)) {
      throw new Error(`${this.name}: Invalid API response`);
    }

    return data.streams
      .filter(stream =>
        typeof stream.url === "string" &&
        /^https:\/\//i.test(stream.url)
      )
      .map(stream => ({
        provider: this.name,
        url: stream.url,
        quality: stream.quality || "Auto"
      }));
  }
}
