import config from "../config.js";

const registry = [
  {
    id: "vidsrc",
    name: "VidSrc",
    enabled: config.providers.vidsrc,
    resolver: null
  },
  {
    id: "smashystream",
    name: "SmashyStream",
    enabled: config.providers.smashystream,
    resolver: null
  },
  {
    id: "vidfast",
    name: "VidFast",
    enabled: config.providers.vidfast,
    resolver: null
  }
];

export default registry;
