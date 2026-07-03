export const GatewayOp = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  VOICE_STATE_UPDATE: 4,
  RESUME: 6,
  RECONNECT: 7,
  REQUEST_GUILD_MEMBERS: 8,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

export const ActivityTypes: Record<string, number> = {
  PLAYING: 0,
  STREAMING: 1,
  LISTENING: 2,
  WATCHING: 3,
  CUSTOM: 4,
  COMPETING: 5,
  HANG: 6,
};

export const DEFAULTS = {
  API_BASE: 'https://discord.com/api',
  API_SDK_BASE: 'https://gaming-sdk.com/api',
  GATEWAY_URL: 'wss://gateway.discord.gg',
  GATEWAY_SDK_URL: 'wss://gateway.gaming-sdk.com',
  GATEWAY_VERSION: 9,
  USER_AGENT: 'Discord Embedded/1.9.15780',
  HELLO_TIMEOUT_MS: 20000,
};

export const DEFAULT_SUPER_PROPERTIES = {
  browser: 'Discord Embedded',
  browser_user_agent: 'Discord Embedded/1.9.15780',
  browser_version: '1.9.15780',
  client_build_number: 15780,
  client_version: '1.9.15780',
  design_id: 0,
  device: 'console',
  native_build_number: 15780,
  os: 'Android',
  release_channel: 'unknown',
};

export const SDK_INTENTS = 0;

export const SDK_CAPABILITIES = 0;
