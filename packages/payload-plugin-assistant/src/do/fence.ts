import type { StreamDurability } from "@tanstack/ai";

/** What a run's writes throw once its conversation was deleted under it. */
export class ConversationDeletedError extends Error {
  constructor() {
    super("[payload-plugin-assistant] The conversation was deleted during the run.");
    this.name = "ConversationDeletedError";
  }
}

/**
 * The run's view of the stores: every method first checks `live()` and throws once the
 * conversation was deleted. The check and the store's SQL run in the same synchronous step
 * (the SQL stores do their work before their first `await`), so a purge can't slip in between.
 */
export function fencePersistence<P extends { stores: object }>(persistence: P, live: () => boolean): P {
  const stores = Object.fromEntries(
    Object.entries(persistence.stores).map(([name, store]) => [name, fenceObject(store as object, live)])
  );
  return { ...persistence, stores } as P;
}

/** The producer's log, fenced the same way. `close` after the deletion does nothing. */
export function fenceDurability(durability: StreamDurability, live: () => boolean): StreamDurability {
  return {
    ...durability,
    append: async (chunks) => {
      if (!live()) throw new ConversationDeletedError();
      return durability.append(chunks);
    },
    close: async () => {
      if (live()) await durability.close();
    },
  };
}

function fenceObject<T extends object>(target: T, live: () => boolean): T {
  return new Proxy(target, {
    get(object, key, receiver) {
      const value = Reflect.get(object, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (!live()) return Promise.reject(new ConversationDeletedError());
        return (value as (...a: unknown[]) => unknown).apply(object, args);
      };
    },
  });
}
