// Video provider adapter — Daily. Server-side only.
//
// Consultations run in private rooms with knocking: the client waits until
// the lawyer (room owner) admits them. Tokens are per-user and expire with
// the room. Recording is never enabled anywhere (blueprint §5.10).

export interface CreateRoomParams {
  /** Stable name, e.g. `appt-${appointmentId}` — creating twice is safe. */
  name: string;
  /** Unix seconds when the room self-destructs (ends_at + 1h). */
  expiresAt: number;
}

export interface Room {
  name: string;
  url: string;
}

export interface CreateTokenParams {
  roomName: string;
  /** Owners (lawyers) see knocks and admit; participants (clients) knock. */
  isOwner: boolean;
  /** Display name shown in the call. */
  userName: string;
  /** Unix seconds; never later than the room's own expiry. */
  expiresAt: number;
}

export interface VideoProvider {
  readonly name: "daily";
  getOrCreateRoom(params: CreateRoomParams): Promise<Room>;
  createToken(params: CreateTokenParams): Promise<string>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

const DAILY_API = "https://api.daily.co/v1";

async function dailyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${DAILY_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireEnv("DAILY_API_KEY")}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`daily ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

interface DailyRoom {
  name: string;
  url: string;
}

export function dailyProvider(): VideoProvider {
  return {
    name: "daily",

    async getOrCreateRoom({ name, expiresAt }) {
      // Reuse the room if it already exists (idempotent per appointment).
      const existing = await fetch(`${DAILY_API}/rooms/${encodeURIComponent(name)}`, {
        headers: { Authorization: `Bearer ${requireEnv("DAILY_API_KEY")}` },
      });
      if (existing.ok) {
        const room = (await existing.json()) as DailyRoom;
        return { name: room.name, url: room.url };
      }

      const room = await dailyFetch<DailyRoom>("/rooms", {
        method: "POST",
        body: JSON.stringify({
          name,
          privacy: "private",
          properties: {
            exp: expiresAt,
            enable_knocking: true,
            enable_screenshare: true,
            enable_chat: true,
            start_video_off: false,
            start_audio_off: false,
            eject_at_room_exp: true,
            // Recording intentionally NOT enabled. Do not add it.
          },
        }),
      });
      return { name: room.name, url: room.url };
    },

    async createToken({ roomName, isOwner, userName, expiresAt }) {
      const result = await dailyFetch<{ token: string }>("/meeting-tokens", {
        method: "POST",
        body: JSON.stringify({
          properties: {
            room_name: roomName,
            is_owner: isOwner,
            user_name: userName,
            exp: expiresAt,
          },
        }),
      });
      return result.token;
    },
  };
}

export function videoProvider(): VideoProvider {
  return dailyProvider();
}
