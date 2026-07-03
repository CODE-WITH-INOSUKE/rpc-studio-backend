import { ActivityTypes } from '../constants';

export function buildPresencePayload(rp: any): any {
  const payload: any = {
    name: rp.name || '',
    type: ActivityTypes[rp.type] ?? 0,
    application_id: rp.application_id || undefined,
    state: rp.state || undefined,
    details: rp.details || undefined,
    timestamps: {},
    platform: rp.platform || undefined,
  };
  if (rp.start_timestamp) payload.timestamps.start = rp.start_timestamp;
  if (rp.end_timestamp) payload.timestamps.end = rp.end_timestamp;
  if (rp.party_current && rp.party_max) {
    payload.party = { size: [rp.party_current, rp.party_max] };
  }
  const assets: any = {};
  if (rp.large_image) assets.large_image = parseImage(rp.large_image);
  if (rp.large_text) assets.large_text = rp.large_text;
  if (rp.small_image) assets.small_image = parseImage(rp.small_image);
  if (rp.small_text) assets.small_text = rp.small_text;
  if (Object.keys(assets).length) payload.assets = assets;
  if (rp.button1_name && rp.button1_url) {
    payload.buttons = [rp.button1_name];
    payload.metadata = { button_urls: [rp.button1_url] };
    if (rp.button2_name && rp.button2_url) {
      payload.buttons.push(rp.button2_name);
      payload.metadata.button_urls.push(rp.button2_url);
    }
  }
  if (rp.url) payload.url = rp.url;
  return cleanPayload(payload);
}

export function buildSpotifyPresence(sp: any, userId: string): any {
  const payload: any = {
    name: 'Spotify',
    type: ActivityTypes.LISTENING,
    flags: 48,
    party: { id: `spotify:${userId}`, size: [] },
    timestamps: {},
    sync_id: sp.song_id || undefined,
    metadata: {},
  };
  if (sp.album_id) {
    payload.metadata.album_id = sp.album_id;
    payload.metadata.context_uri = `spotify:album:${sp.album_id}`;
  }
  if (sp.artist_ids) {
    const ids = typeof sp.artist_ids === 'string' ? JSON.parse(sp.artist_ids) : sp.artist_ids;
    payload.metadata.artist_ids = ids;
  }
  if (sp.song_name) payload.details = sp.song_name;
  if (sp.artists) payload.state = sp.artists;
  if (sp.start_timestamp) payload.timestamps.start = sp.start_timestamp;
  if (sp.end_timestamp) payload.timestamps.end = sp.end_timestamp;
  const assets: any = {};
  if (sp.large_image) assets.large_image = parseImage(sp.large_image);
  if (Object.keys(assets).length) payload.assets = assets;
  return cleanPayload(payload);
}

export function buildCustomStatus(cs: any): any {
  const payload: any = {
    name: ' ',
    type: ActivityTypes.CUSTOM,
  };
  if (cs.state) payload.state = cs.state;
  if (cs.emoji) {
    payload.emoji = resolveEmoji(cs.emoji);
  }
  return payload;
}

export function buildFakeGamePresence(game_name: string, application_id?: string): any {
  const payload: any = {
    name: game_name,
    type: ActivityTypes.PLAYING,
    timestamps: { start: Date.now() },
  };
  if (application_id) payload.application_id = application_id;
  return payload;
}

function parseImage(image: string): string {
  if (!image) return image;
  if (/^https?:\/\//.test(image)) {
    return image
      .replace('https://cdn.discordapp.com/', 'mp:')
      .replace('http://cdn.discordapp.com/', 'mp:')
      .replace('https://media.discordapp.net/', 'mp:')
      .replace('http://media.discordapp.net/', 'mp:');
  }
  return image;
}

function resolveEmoji(emoji: string): any {
  if (/^\d{17,19}$/.test(emoji)) return { id: emoji };
  const match = emoji.match(/<?(?:(a):)?(\w{2,32}):(\d{17,19})?>?/);
  if (match) return { animated: !!match[1], name: match[2], id: match[3] };
  return { name: emoji, id: null };
}

function cleanPayload(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const cleaned: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const inner = cleanPayload(value);
      if (inner !== undefined) cleaned[key] = inner;
    } else {
      cleaned[key] = value;
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}
