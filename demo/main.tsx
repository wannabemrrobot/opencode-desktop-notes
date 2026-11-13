import { For, Show, createSignal } from "solid-js"
import { render } from "solid-js/web"
import plugin from "../src/gui"
import { ui } from "./mock-gui"

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get("theme") ?? "light"
// ?record: a full app-like layout (sidebar, chat, notes at 27% width) used to record docs/demo.gif.
const recording = params.has("record")

const day = (h: number, m: number, daysAgo = 0) => {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

const notes = {
  items: [
    { id: "n1", kind: "note", text: "Keep the retry logic in the HTTP client, not in every caller.", answer: "", quote: "", time: day(9, 12, 1) },
    {
      id: "n2",
      kind: "note",
      text: "Check this before merging: does the cache survive a server restart?",
      answer: "",
      quote: "Responses are cached in memory for five minutes, keyed by the request URL.",
      time: day(10, 4),
    },
    {
      id: "b1",
      kind: "btw",
      text: "What's the difference between a queued and a steered prompt?",
      answer:
        "A **queued** prompt waits until the current turn finishes, then runs as the next turn.\n\nA **steered** prompt is injected into the running turn at the next step, so the agent changes course without stopping.",
      quote: "",
      time: day(10, 31),
    },
    {
      id: "b2",
      kind: "btw",
      text: "Is a 5 minute TTL safe here?",
      answer:
        "Mostly. Two things to watch:\n\n- Invalidate on writes, or users can see stale data for up to 5 minutes.\n- Memory grows with unique URLs, so add a size cap.",
      quote: "Responses are cached in memory for five minutes, keyed by the request URL.",
      model: "Claude Opus 5.5",
      time: day(10, 46),
    },
  ],
}
if (recording) notes.items = notes.items.filter((i) => i.id === "n1" || i.id === "b1")
const todos = {
  todos: [
    { id: "t1", text: "Add a size cap to the response cache", done: false, time: day(9, 0) },
    { id: "t2", text: "Write tests for retry with backoff", done: false, time: day(9, 5) },
    { id: "t3", text: "Remove the old fetch wrapper", done: true, time: day(9, 10) },
    { id: "t4", text: "Update the README", done: true, time: day(9, 20) },
  ],
}

const stores = new Map<string, any>()
const store = (key: string, initial: any) => {
  if (!stores.has(key)) {
    const [v, set] = createSignal(initial)
    stores.set(key, { get value() { return v() }, set, update: (f: any) => { const d = structuredClone(v()); f(d); set(d) }, ready: () => true })
  }
  return stores.get(key)
}

const model = { id: "claude-opus-5-5", providerID: "anthropic", variant: "high" }
const data = {
  session: {
    get: () => ({ model, tokens: { input: 48210, output: 9120, reasoning: 2480, cache: { read: 312400, write: 21800 } }, cost: 1.84 }),
    cost: () => 1.84,
    status: () => "idle",
    message: {
      list: () => [
        { type: "user", text: "Add caching to the API client", time: { created: 1 } },
        { type: "assistant", model, content: [{ type: "text", text: "Done." }], tokens: { input: 1200, output: 900, reasoning: 0, cache: { read: 142000, write: 4000 } }, time: { created: 2 } },
      ],
    },
  },
  location: {
    provider: { list: () => [{ id: "anthropic", name: "Anthropic" }] },
    model: {
      sync: async () => {},
      list: () => [
        { id: "claude-opus-5-5", providerID: "anthropic", name: "Claude Opus 5.5", type: "chat", enabled: true, variants: [{ id: "low" }, { id: "high" }], limit: { context: 1_000_000 } },
        { id: "claude-sonnet-5-5", providerID: "anthropic", name: "Claude Sonnet 5.5", type: "chat", enabled: true, variants: [], limit: { context: 1_000_000 } },
      ],
    },
  },
}
type Msg = { role: "user" | "assistant"; text: string }
const [chat, setChat] = createSignal<Msg[]>([
  { role: "user", text: "Add an in-memory response cache to the API client." },
  {
    role: "assistant",
    text: "Done. Responses are cached in memory for five minutes, keyed by the request URL. Only GET requests are cached, and a write to the same URL clears its entry.",
  },
  { role: "user", text: "Now add retries with backoff for failed requests." },
  { role: "assistant", text: "Retries now use exponential backoff: 200 ms, 400 ms, then 800 ms, and only for network errors and 5xx responses." },
])
const [toasts, setToasts] = createSignal<string[]>([])
const toast = (t: { title: string }) => {
  setToasts((l) => [...l, t.title])
  setTimeout(() => setToasts((l) => l.slice(1)), 2200)
}
const BTW_ANSWER =
  "Mostly. Two things to watch:\n\n- Invalidate on writes, or users can see stale data for up to 5 minutes.\n- Memory grows with unique URLs, so add a size cap."
const answer = () => new Promise<{ text: string }>((r) => setTimeout(() => r({ text: BTW_ANSWER }), 1600))

const session: any = {
  id: "ses_demo",
  key: "local\nses_demo",
  directory: "/Users/you/projects/acme-api",
  server: {
    id: "local",
    data,
    client: {
      session: { generate: answer, prompt: async (o: { text: string }) => void setChat((c) => [...c, { role: "user", text: o.text }]) },
      experimental: { generate: { text: answer } },
    },
  },
}

const added: Record<string, any[]> = {}
const ctx: any = {
  id: "opencode-desktop-notes",
  ui,
  stores: { prefs: store("prefs", { hideBtw: false }), titles: store("titles", { "s:local\nses_demo": "Caching work" }) },
  storage: {
    store: (key: string, o: any) =>
      store(key, key === "session-notes" ? notes : key === "session-todos" ? todos : o.initial),
  },
  add: (r: any, item: any) => ((added[r.__reg] ??= []).push(item), () => {}),
  sessions: { current: () => session },
  screen: { current: () => undefined },
  layout: { open() {}, state: () => "visible" },
  toast: { show: toast },
  dialogs: { prompt: async () => undefined },
  system: { save: async () => true, copy: async () => {} },
}

plugin.setup!(ctx)
const css = document.createElement("style")
css.textContent = (added.Style ?? []).join("\n")
document.head.append(css)

const panel = added.Panel[0]
const tab = panel.list({ session, open: ["session"] })[0]
const projectTab = panel.list({ session, open: ["project"] })[0]
const Panel = () => (
    <div class="frame">
      <div class="tabs">
        <div class="tab active">{tab.label({ active: true, preview: false, session })}<span class="x">×</span></div>
        <div class="tab">{projectTab.label({ active: false, preview: false, session })}</div>
        <span class="plus">+</span>
      </div>
      <div class="body">{panel.render({ tab, session, screen: {} })}</div>
    </div>
)
render(
  () =>
    recording ? (
      <div class="app">
        <aside class="side">
          <div class="side-h">acme-api</div>
          <div class="side-i active">Add caching to the API client</div>
          <div class="side-i">Retry with backoff</div>
          <div class="side-i">Fix flaky upload test</div>
        </aside>
        <main class="chat">
          <div class="chat-h">Add caching to the API client</div>
          <div class="chat-list">
            <For each={chat()}>{(m) => <div class={`msg ${m.role}`}>{m.text}</div>}</For>
          </div>
          <div class="composer">Ask anything, / for commands, @ for context…</div>
        </main>
        <Panel />
        <div class="toasts">
          <For each={toasts()}>{(t) => <div class="toast">{t}</div>}</For>
        </div>
        <div id="caption" />
      </div>
    ) : (
      <Panel />
    ),
  document.getElementById("app")!,
)

