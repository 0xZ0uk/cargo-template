// `vite dev` (Node) stand-in for `@cargo/payload-plugin-assistant/do`, aliased in vite.config.ts.
// The real classes import `cloudflare:workers`, which Node can't load, and `src/server.ts`
// re-exports them for workerd. The Node dev server keeps conversations in memory
// (src/plugins/assistant.ts), so nothing ever constructs these.

const workerdOnly = (name: string) =>
  class {
    constructor() {
      throw new Error(`${name} is a Durable Object: it runs under workerd (pnpm preview, deployed), not vite dev.`)
    }
  }

export const AssistantConversation = workerdOnly('AssistantConversation')
export const AssistantConversationIndex = workerdOnly('AssistantConversationIndex')
// `src/server.ts` builds its conversation class with the app's dependencies; same stand-in.
export const assistantConversation = () => AssistantConversation
