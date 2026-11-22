import type { EventId } from "./events";

export interface Session {
  id: string;
  name: string;
  event: EventId;
  orderKey: string;
  folderId: string | null;
  archived: boolean;
  createdAt: number;
}

export interface Folder {
  id: string;
  name: string;
  orderKey: string;
  collapsed: boolean;
}
