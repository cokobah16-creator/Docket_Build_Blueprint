// Daily.co — prebuilt UI, knocking waiting room, per-participant tokens. Server-side only (API key).
import type { VideoProvider, CreateRoomArgs, CreateTokenArgs } from './types';

const API = 'https://api.daily.co/v1';

export function dailyProvider(apiKey = process.env.DAILY_API_KEY!, domain = process.env.DAILY_DOMAIN!): VideoProvider {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  return {
    name: 'daily',
    async createRoom(a: CreateRoomArgs) {
      const res = await fetch(`${API}/rooms`, {
        method: 'POST', headers,
        body: JSON.stringify({
          name: a.name, privacy: 'private',
          properties: {
            exp: Math.floor(a.expiresAt.getTime() / 1000),
            enable_knocking: a.knocking,
            enable_screenshare: true, enable_chat: true,
            eject_at_room_exp: true,
            enable_recording: undefined,            // recording stays off — see blueprint §10
          },
        }),
      });
      if (res.status === 400) {                     // room already exists → reuse it
        const j = await res.json();
        if (String(j.info ?? '').includes('already exists')) return { roomName: a.name, roomUrl: `https://${domain}.daily.co/${a.name}` };
        throw new Error(`Daily createRoom failed: ${j.info ?? res.status}`);
      }
      if (!res.ok) throw new Error(`Daily createRoom failed: ${res.status}`);
      const j = await res.json();
      return { roomName: j.name, roomUrl: j.url };
    },
    async createToken(a: CreateTokenArgs) {
      const res = await fetch(`${API}/meeting-tokens`, {
        method: 'POST', headers,
        body: JSON.stringify({
          properties: {
            room_name: a.roomName, user_id: a.userId, user_name: a.userName,
            is_owner: a.isOwner, exp: Math.floor(a.expiresAt.getTime() / 1000),
            enable_recording: undefined,
          },
        }),
      });
      if (!res.ok) throw new Error(`Daily createToken failed: ${res.status}`);
      const j = await res.json();
      return { token: j.token };
    },
    async deleteRoom(roomName: string) {
      await fetch(`${API}/rooms/${encodeURIComponent(roomName)}`, { method: 'DELETE', headers });
    },
  };
}
