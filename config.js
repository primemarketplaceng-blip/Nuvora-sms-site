const config = {
  app: {
    name: "MelStream Auto",
    version: "2.0.0"
  },

  playback: {
    supportedTypes: ["movie", "series"],
    defaultQuality: "Auto",
    allowSubtitles: true,
    enableFallback: true
  },

  providers: {
    vidsrc: false,
    smashystream: false,
    vidfast: false
  },

  security: {
    requireHttps: true,
    requestTimeout: 15000,
    maxSources: 10
  }
};

export default config;
