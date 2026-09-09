// Docket — video provider adapter. One private room per appointment, tokens per participant, no recording.
export interface CreateRoomArgs {
  name: string;                   // deterministic: `appt-${appointmentId}`
  expiresAt: Date;                // appointment end + 1 hour; the room is unusable after this
  knocking: boolean;              // waiting room: the lawyer (owner) admits the client
}
export interface CreateTokenArgs {
  roomName: string;
  userId: string;
  userName: string;
  isOwner: boolean;               // lawyer = owner (can admit); client = participant
  expiresAt: Date;
}
export interface VideoProvider {
  readonly name: 'daily' | 'livekit' | 'zoom';
  createRoom(args: CreateRoomArgs): Promise<{ roomName: string; roomUrl: string }>;
  createToken(args: CreateTokenArgs): Promise<{ token: string }>;
  deleteRoom(roomName: string): Promise<void>;
}
