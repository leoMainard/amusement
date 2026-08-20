/** Client WebSocket générique pour un salon (voir
 * `src/amusement/api/game_ws.py` côté serveur) : un message JSON
 * entrant par événement, dispatché par son champ `type`. Pas spécifique
 * à Orapa Mine — voir `games/orapa-mine/protocol.ts` pour la traduction
 * des messages propres à ce jeu. */

export interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

type Listener = (message: ServerMessage) => void;

export class RoomSocket {
  private ws: WebSocket;
  private listeners = new Map<string, Set<Listener>>();
  private openPromise: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.openPromise = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener(
        "error",
        () => reject(new Error("La connexion au salon a échoué.")),
        { once: true },
      );
    });
    this.ws.addEventListener("message", (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string);
      } catch {
        return;
      }
      this.emit(message.type, message);
      this.emit("*", message);
    });
  }

  async ready(): Promise<void> {
    await this.openPromise;
  }

  on(type: string, listener: Listener): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  send(message: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(message));
  }

  close(): void {
    this.ws.close();
  }

  private emit(type: string, message: ServerMessage): void {
    for (const listener of this.listeners.get(type) ?? []) listener(message);
  }
}
