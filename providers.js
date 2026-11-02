const providers = [
  {
    id: "vidsrc",
    name: "VidSrc",
    enabled: false,
    status: "pending_authorized_integration"
  },
  {
    id: "smashystream",
    name: "SmashyStream",
    enabled: false,
    status: "pending_authorized_integration"
  },
  {
    id: "vidfast",
    name: "VidFast",
    enabled: false,
    status: "pending_authorized_integration"
  }
];

export function getProviders() {
  return providers;
}

export function getEnabledProviders() {
  return providers.filter(provider => provider.enabled);
}

export default providers;
