import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Schema } from "effect"
import { ArrowDown, ArrowUp, Bold, ChevronRight, Code, Italic, Link, List, Strikethrough, ListTodo, Square, SquareCheck, X, Coins, Cpu, Download, MessageCircleQuestion, Pencil, Plus, Quote, Search, SendHorizontal, SquarePen, Trash2 } from "lucide-solid"
import { lastAssistantWithUsage } from "@opencode/client/solid"
import { Command, MenuItem, Panel, Plugin, Store, Style, type PanelTab } from "@opencode/plugin/gui"

const Item = Schema.Struct({
  id: Schema.String,
  kind: Schema.String, // "note" | "btw"
  text: Schema.String, // note text, or the /btw question
  answer: Schema.String, // /btw answer, "" for notes
  quote: Schema.String, // annotated chat text, "" for none
  time: Schema.Number,
  model: Schema.optionalKey(Schema.String), // display name of a non-default /btw model
})
const Data = Schema.Struct({ items: Schema.Array(Item) })
const Todo = Schema.Struct({ id: Schema.String, text: Schema.String, done: Schema.Boolean, time: Schema.Number })
const Todos = Schema.Struct({ todos: Schema.Array(Todo) })
type Item = typeof Item.Type

const Lbl = (p: { icon: any; text: string }) => (
  <span class="btwn-lbl">
    <p.icon size={15} />
    <span class="btwn-t">{p.text}</span>
  </span>
)

const transcript = (messages: readonly any[]) => {
  const lines: string[] = []
  let size = 0
  for (const m of [...messages].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0)).reverse()) {
    const text =
      m.type === "user"
        ? m.text
        : m.type === "assistant"
          ? (m.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
          : ""
    if (!text?.trim()) continue
    const line = `[${m.type}] ${text.trim()}`
    if (size + line.length > MAX_TRANSCRIPT) break
    size += line.length
    lines.unshift(line)
  }
  return lines.join("\n\n")
}

const fmtTokens = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n)
const RING = 2 * Math.PI * 7.5
const fmtTime = (t: number) => {
  const d = new Date(t)
  const now = new Date()
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (t >= day) return `Today, ${time}`
  if (t >= day - 86_400_000) return `Yesterday, ${time}`
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) })}, ${time}`
}
const fmtCost = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`)

// One shared highlight for every mounted notes panel (session and project tabs can both be open).
const matches = new Map<object, Range[]>()
const paintMatches = () => {
  const Highlight = (globalThis as any).Highlight
  const registry = (globalThis as any).CSS?.highlights
  if (!Highlight || !registry) return
  const all = [...matches.values()].flat()
  if (all.length) registry.set("btwn-search", new Highlight(...all))
  else registry.delete("btwn-search")
}

const css = `
::highlight(btwn-search){background-color:color-mix(in srgb,#f5c518 55%,transparent);color:inherit}
.btwn-lbl{display:inline-flex;align-items:center;gap:6px}
.btwn{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px}
.btwn-bar{container-type:inline-size;display:flex;flex-direction:column;gap:8px;padding:8px 12px;border-bottom:1px solid color-mix(in srgb,currentColor 14%,transparent)}
.btwn-list{flex:1;min-height:0;overflow:auto;padding:8px 12px 24px;display:flex;flex-direction:column;gap:8px}
.btwn-row{border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:8px;padding:8px 10px}
.btwn-btw{border-style:dashed}
.btwn-text{white-space:pre-wrap;word-break:break-word}
.btwn-md{white-space:normal}
.btwn-fmt{display:flex;align-items:center;gap:2px;padding:4px 6px 0}
.btwn-fmt button{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:5px;background:transparent;color:inherit;opacity:.6;cursor:pointer}
.btwn-fmt button:hover{opacity:1;background:color-mix(in srgb,currentColor 8%,transparent)}
.btwn-fmt-sep{width:1px;height:14px;margin:0 3px;background:color-mix(in srgb,currentColor 18%,transparent)}
.btwn-q{opacity:.65;white-space:pre-wrap;margin-bottom:6px}
.btwn-quote{margin:0 0 6px;padding:2px 8px;border-left:3px solid color-mix(in srgb,currentColor 35%,transparent);opacity:.75;font-style:italic;cursor:pointer;white-space:pre-wrap;word-break:break-word;max-height:9em;overflow:auto}
.btwn-acts{display:flex;justify-content:flex-end;gap:6px;margin-top:8px;flex-wrap:wrap}
.btwn-time{margin-top:6px;font-size:11px;opacity:.55;font-variant-numeric:tabular-nums}
.btwn-row1{display:flex;align-items:center;gap:8px;min-width:0}
.btwn-search{flex:1 1 0;min-width:0}
.btwn-toggle{flex:none;display:flex;align-items:center;gap:8px;white-space:nowrap}
.btwn-vsep{flex:none;align-self:stretch;width:1px;margin:4px 0;background:color-mix(in srgb,currentColor 18%,transparent)}
.btwn-wipe{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;opacity:.6;cursor:pointer}
.btwn-wipe:hover:not(:disabled),.btwn-wipe:focus-visible:not(:disabled),*:hover>.btwn-wipe:not(:disabled):hover{opacity:1!important;color:#e5484d!important;background:color-mix(in srgb,#e5484d 12%,transparent)!important}
.btwn-wipe:hover:not(:disabled) svg,.btwn-wipe:focus-visible:not(:disabled) svg{color:#e5484d!important;stroke:#e5484d!important}
.btwn-wipe:disabled{opacity:.25;cursor:default}
.btwn-toggle>*{flex:none}
.btwn-togglelbl{cursor:pointer;user-select:none}
@container (max-width:300px){.btwn-toggle .btwn-togglelbl span{display:none}}
.btwn-grid{display:grid;gap:6px;container-type:inline-size}
.btwn-grid4{grid-template-columns:repeat(4,minmax(0,1fr))}
.btwn-grid3{grid-template-columns:repeat(3,minmax(0,1fr))}
.btwn-cell{display:flex;align-items:stretch;min-width:0;height:30px}
.btwn-cell>*{flex:1 1 auto;min-width:0;display:flex}
.btwn-cell button{flex:1 1 auto;box-sizing:border-box;height:30px;min-height:30px;width:100%;min-width:0;justify-content:center;align-items:center;overflow:hidden;padding-top:0;padding-bottom:0}
.btwn-cell .btwn-lbl{min-width:0;max-width:100%}
.btwn-cell .btwn-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@container (max-width:300px){.btwn-top .btwn-t{display:none}}
@container (max-width:250px){.btwn-bottom .btwn-t{display:none}}
.btwn-grow,.btwn-grow input{width:100%;max-width:none;box-sizing:border-box}
.btwn-ctxhead{display:flex;align-items:center;gap:4px;padding:4px 8px;border-bottom:1px solid color-mix(in srgb,currentColor 14%,transparent)}
.btwn-todos{display:flex;flex-direction:column;gap:6px;padding:8px 12px;max-height:300px;overflow:hidden;border-bottom:1px solid color-mix(in srgb,currentColor 14%,transparent);background:color-mix(in srgb,currentColor 4%,transparent)}
.btwn-todo{display:flex;flex-direction:column;gap:6px;padding:3px 0}
.btwn-todo-main{display:flex;align-items:flex-start;gap:8px;padding-left:3px}
.btwn-tick{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;background:transparent;color:inherit;opacity:.7;cursor:pointer}
.btwn-tick:hover{opacity:1}
.btwn-todo[data-done=true] .btwn-tick{opacity:1;color:#2fae6e}
.btwn-todo-text{flex:1;min-width:0;line-height:20px;white-space:pre-wrap;word-break:break-word}
.btwn-todo[data-done=true] .btwn-todo-text{opacity:.5;text-decoration:line-through}
.btwn-todo-acts{flex:none;display:flex;align-items:center;gap:2px;height:20px;opacity:0;transition:opacity .12s}
.btwn-todo:hover .btwn-todo-acts,.btwn-todo:focus-within .btwn-todo-acts,.btwn-todo[data-sending=true] .btwn-todo-acts{opacity:1}
@media (hover:none){.btwn-todo .btwn-todo-acts{opacity:1}}
.btwn-todo-x{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;background:transparent;color:inherit;opacity:.6;cursor:pointer}
.btwn-todo-x:hover{opacity:1;color:#e5484d}
.btwn-todo-send{display:flex;flex-direction:column;gap:6px;margin-left:0;padding:8px;border-radius:8px;background:color-mix(in srgb,currentColor 5%,transparent)}
.btwn-todo-send textarea{display:block;box-sizing:border-box;width:100%;min-height:56px;max-height:160px;field-sizing:content;resize:none;padding:6px 8px;border:0;outline:0;border-radius:6px;background:var(--background-base,transparent);color:inherit;font:inherit;font-size:13px;line-height:1.4;box-shadow:var(--shadow-xs-border-base,0 0 0 1px color-mix(in srgb,currentColor 22%,transparent))}
.btwn-todo-send textarea:focus,.btwn-todo-send textarea:focus-visible{outline:none!important;border:0!important;box-shadow:var(--shadow-xs-border-select,0 0 0 1px var(--border-selected,#004afffc),0 0 0 3px var(--border-weak-selected,#0167ff4a))}
.btwn-todo-sendrow{display:flex;justify-content:flex-end;gap:6px}
.btwn-todo-add{display:flex;gap:6px;align-items:center}
.btwn-todo-add>*:first-child{flex:1;min-width:0}
.btwn-todo-foot{flex:none;display:flex;justify-content:space-between;align-items:center;font-size:11.5px;min-height:24px;padding-left:5px}
.btwn-todo-foot>span{opacity:.8}
.btwn-todo-list{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:6px}
.btwn-todo-add{flex:none}
.btwn-chd .btwn-chev{transition:transform .15s}
.btwn-chd[data-open=true] .btwn-chev{transform:rotate(90deg)}
.btwn-stats{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:7px 12px;border-bottom:1px solid color-mix(in srgb,currentColor 14%,transparent);background:color-mix(in srgb,currentColor 4%,transparent);font-size:11.5px}
.btwn-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:4px;background:color-mix(in srgb,currentColor 8%,transparent);white-space:nowrap}
.btwn-chip svg{opacity:.7}
.btwn-ctx{display:inline-flex;align-items:center;gap:6px;padding:2px 8px 2px 4px;border-radius:4px;background:color-mix(in srgb,currentColor 8%,transparent);white-space:nowrap}
.btwn-ring{flex:none;transform:rotate(-90deg)}
.btwn-ring circle{fill:none;stroke-width:2.5}
.btwn-ring .bg{stroke:color-mix(in srgb,currentColor 18%,transparent)}
.btwn-ring .fg{stroke:#4c8dff;stroke-linecap:round;transition:stroke-dashoffset .4s}
.btwn-ring.warn .fg{stroke:#e0a030}
.btwn-ring.hot .fg{stroke:#e5484d}
.btwn-via{opacity:.7;font-size:11px}
.btwn-models{display:flex;gap:6px;align-items:center;justify-content:flex-end;padding:4px 8px 8px;min-width:0}
.btwn-menu button{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btwn-models button{max-width:220px}
.btwn-menu button::after{content:"";display:inline-block;width:10px;height:10px;margin-left:4px;background:currentColor;opacity:.7;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") center/contain no-repeat}
.btwn-search{position:relative}
.btwn-badge{float:right;display:inline-flex;align-items:center;gap:4px;margin:0 0 4px 8px;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;line-height:16px;background:color-mix(in srgb,currentColor 10%,transparent);opacity:.85}
.btwn-del{background:#e5484d!important;border-color:#e5484d!important;color:#fff!important}
.btwn-del:hover{background:#d13a3f!important}
.btwn-del svg{color:#fff!important}
.btwn-search>svg{position:absolute;left:8px;top:50%;transform:translateY(-50%);opacity:.55;pointer-events:none;z-index:1}
.btwn-search input{padding-left:28px!important;padding-right:28px!important}
.btwn-search input::-webkit-search-cancel-button{display:none;-webkit-appearance:none}
.btwn-clear{position:absolute;right:6px;top:50%;transform:translateY(-50%);z-index:1;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;opacity:.55;cursor:pointer}
.btwn-clear:hover{opacity:1;background:color-mix(in srgb,currentColor 8%,transparent)}
.btwn-row .btwn-acts{opacity:0;pointer-events:none;transition:opacity .12s}
.btwn-row:hover .btwn-acts,.btwn-row:focus-within .btwn-acts{opacity:1;pointer-events:auto}
@media (hover:none){.btwn-row .btwn-acts{opacity:1;pointer-events:auto}}
.btwn-in{position:relative;padding:8px 12px;box-shadow:0 -22px 26px -6px color-mix(in srgb,var(--background-base,Canvas) 94%,transparent),0 -8px 14px -2px color-mix(in srgb,var(--background-base,Canvas) 75%,transparent);display:flex;flex-direction:column;gap:8px}
.btwn-box{container-type:inline-size;display:flex;flex-direction:column;border:0;box-shadow:var(--shadow-xs-border-base,0 0 0 1px color-mix(in srgb,currentColor 22%,transparent));border-radius:10px;overflow:hidden}
.btwn-box:focus-within{box-shadow:var(--shadow-xs-border-select,0 0 0 1px var(--border-selected,#004afffc),0 0 0 3px var(--border-weak-selected,#0167ff4a))}
.btwn-box .btwn-quote{margin:8px 10px 0;max-height:6em}
.btwn-ta:focus,.btwn-ta:focus-visible{outline:none!important;border:0!important;box-shadow:none!important}
.btwn-ta{display:block;box-sizing:border-box;width:100%;min-height:72px;max-height:220px;field-sizing:content;padding:10px 12px;border:0;outline:0;resize:none;background:transparent;color:inherit;font:inherit;font-size:13.5px;line-height:1.45}
.btwn-ta::placeholder{color:color-mix(in srgb,currentColor 45%,transparent)}
.btwn-empty{opacity:.55;text-align:center;padding:24px 8px}
`

const prompt = (items: readonly Item[], q: string, quote: string, note: string) =>
  [
    'This is a side question ("/btw") from a notes pane. Answer it briefly from the conversation so far. Do not continue the main task.',
    items.some((i) => i.kind === "note") &&
      "Notes so far:\n" +
        items
          .filter((i) => i.kind === "note")
          .map((i) => `- ${i.text}${i.quote ? ` (about: "${i.quote}")` : ""}`)
          .join("\n"),
    items.some((i) => i.kind === "btw") &&
      "Earlier side Q&A:\n" +
        items
          .filter((i) => i.kind === "btw")
          .map((i) => `Q: ${i.text}\nA: ${i.answer}`)
          .join("\n\n"),
    quote && `The side question is about this passage from the main chat:\n> ${quote.replace(/\n/g, "\n> ")}`,
    note && `The side question is about ${note}`,
    `Side question: ${q}`,
  ]
    .filter(Boolean)
    .join("\n\n")

// shortcut: window.find is a Chromium feature, so a quote is only found while its message is rendered; upgrade if the app adds a scroll-to-message API
const jump = (quote: string) => {
  const needle = quote.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).find(Boolean)?.slice(0, 100)
  const sel = window.getSelection()
  if (!needle || !sel) return false
  const start = document.createRange()
  start.setStart(document.body, 0)
  start.collapse(true)
  sel.removeAllRanges()
  sel.addRange(start)
  for (let i = 0; i < 20; i++) {
    if (!(window as any).find(needle, false, false, false)) return false
    const node = sel.anchorNode
    const el = node instanceof Element ? node : node?.parentElement
    if (el && !el.closest("[data-btw-notes]")) {
      el.scrollIntoView({ block: "center" })
      return true
    }
  }
  return false
}

const Title = Schema.Struct({ title: Schema.String })
const ModelPref = Schema.Struct({ model: Schema.String, variant: Schema.String })
const MAX_TRANSCRIPT = 80_000
const DEFAULT_TITLE = { session: "Session notes", project: "Project notes" }

export default Plugin.define({
  stores: {
    // `from` keys carry data over from the plugin's pre-release id, btw-notes.
    prefs: Store.global(Schema.Struct({ hideBtw: Schema.Boolean }), { hideBtw: false }, "plugin.btw-notes.prefs"),
    titles: Store.global(Schema.Record(Schema.String, Schema.String), {}, "plugin.btw-notes.titles"),
  },
  setup(ctx) {
    const ui = ctx.ui
    const [pendingQuote, setPendingQuote] = createSignal("")
    let lastSelection = ""

    const onSelect = () => {
      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ""
      const node = sel?.anchorNode
      const el = node instanceof Element ? node : node?.parentElement
      if (text && !el?.closest("[data-btw-notes],input,textarea")) lastSelection = text
    }
    document.addEventListener("selectionchange", onSelect)

    const titleKey = (scope: "session" | "project", session: any) =>
      scope === "session" ? `s:${session.key}` : `p:${session.server.id}:${session.directory}`
    const titleOf = (scope: "session" | "project", session: any) =>
      (ctx.stores.titles.value as Record<string, string>)[titleKey(scope, session)] || DEFAULT_TITLE[scope]
    const setTitle = (scope: "session" | "project", session: any, title: string) =>
      ctx.stores.titles.set({ ...(ctx.stores.titles.value as Record<string, string>), [titleKey(scope, session)]: title })

    const todoStores = new Map<string, ReturnType<typeof ctx.storage.store>>()
    const todoStoreFor = (scope: "session" | "project", session: any) => {
      const key = scope === "session" ? `s:${session.key}` : `p:${session.server.id}:${session.directory}`
      let st = todoStores.get(key)
      if (!st) {
        st = ctx.storage.store(`${scope}-todos`, {
          schema: Todos,
          initial: { todos: [] },
          from: `plugin.btw-notes.${scope}-todos`,
          scope: scope === "session" ? { session } : { server: session.server.id, directory: session.directory },
        })
        todoStores.set(key, st)
      }
      return st
    }
    const pushTodo = (scope: "session" | "project", session: any, text: string) => {
      const st = todoStoreFor(scope, session)
      const list = ((st.value as any)?.todos ?? []) as readonly (typeof Todo.Type)[]
      st.set({ todos: [...list, { id: crypto.randomUUID(), text, done: false, time: Date.now() }] })
    }
    const todoCommand = /^\/todo(?:\s+([\s\S]*))?$/i

    const Notes = (props: { scope: "session" | "project"; session: any }) => {
      const store = createMemo(() =>
        ctx.storage.store(`${props.scope}-notes`, {
          schema: Data,
          initial: { items: [] },
          from: `plugin.btw-notes.${props.scope}-notes`,
          scope:
            props.scope === "session"
              ? { session: props.session }
              : { server: props.session.server.id, directory: props.session.directory },
        }),
      )
      const items = (): readonly Item[] => store().value?.items ?? []
      const [draft, setDraft] = createSignal("")
      const [pending, setPending] = createSignal<{ id: string; q: string }[]>([])
      const data = () => props.session.server.data
      const info = () => {
        try {
          return data().session.get(props.session.id)
        } catch {
          return undefined
        }
      }
      const step = () => {
        try {
          return lastAssistantWithUsage(data().session.message.list(props.session.id), info()?.revert?.messageID)
        } catch {
          return undefined
        }
      }
      const model = () => {
        const ref = info()?.model ?? step()?.model
        if (!ref) return undefined
        const meta = data().location?.model?.list?.(props.session.location)?.find((m: any) => m.providerID === ref.providerID && m.id === ref.id)
        return { name: meta?.name ?? ref.id, variant: ref.variant, limit: meta?.limit?.context as number | undefined }
      }
      const ctxUsed = () => {
        const t = step()?.tokens
        return t ? t.input + t.output + t.cache.read + t.cache.write : 0
      }
      const ctxPct = () => {
        const limit = model()?.limit
        return limit ? Math.min(100, Math.round((ctxUsed() / limit) * 100)) : undefined
      }
      try {
        void data().location?.model?.sync?.(props.session.location)
      } catch {}
      const pref = ctx.storage.store("btw-model", { schema: ModelPref, initial: { model: "", variant: "" }, from: "plugin.btw-notes.btw-model" })
      const modelKey = () => (pref.value as any)?.model ?? ""
      const chatModels = () => {
        try {
          return ((data().location?.model?.list?.(props.session.location) ?? []) as any[]).filter(
            (m) => m.enabled !== false && (!m.type || m.type === "chat"),
          )
        } catch {
          return []
        }
      }
      const picked = () => chatModels().find((m) => `${m.providerID}/${m.id}` === modelKey())
      const variantKey = () => ((pref.value as any)?.variant ?? "") as string
      const sessionModel = () => {
        const ref = info()?.model ?? step()?.model
        return ref ? chatModels().find((m) => m.providerID === ref.providerID && m.id === ref.id) : undefined
      }
      const current = () => picked() ?? sessionModel()
      const providerName = (id: string) => {
        try {
          const list = (data().location?.provider?.list?.(props.session.location) ?? []) as any[]
          return list.find((p) => p.id === id)?.name ?? id
        } catch {
          return id
        }
      }
      const pick = (m: string) => pref.set({ model: m, variant: "" })
      const modelMenu = () => {
        const byProvider = new Map<string, any[]>()
        for (const m of chatModels()) byProvider.set(m.providerID, [...(byProvider.get(m.providerID) ?? []), m])
        return [
          { label: sessionModel() ? `Session model (${sessionModel().name})` : "Session model", icon: modelKey() ? undefined : ("check" as const), onSelect: () => pick("") },
          ...[...byProvider].map(([id, models]) => ({
            type: "group" as const,
            label: providerName(id),
            items: models.map((m) => ({
              label: m.name as string,
              icon: current() && `${current().providerID}/${current().id}` === `${m.providerID}/${m.id}` ? ("check" as const) : undefined,
              onSelect: () => pick(`${m.providerID}/${m.id}`),
            })),
          })),
        ]
      }
      const variantOptions = () => [
        { value: "default", label: "Default effort" },
        ...(picked()?.variants ?? []).map((v: any) => ({ value: v.id as string, label: v.id as string })),
      ]
      const [panelOpen, setPanelOpen] = createSignal<"none" | "ctx" | "todo">("none")
      const showCtx = () => panelOpen() === "ctx"
      const toggle = (which: "ctx" | "todo") => setPanelOpen(panelOpen() === which ? "none" : which)
      const todoStore = createMemo(() => todoStoreFor(props.scope, props.session))
      const todos = (): readonly (typeof Todo.Type)[] => (todoStore().value as any)?.todos ?? []
      const [todoDraft, setTodoDraft] = createSignal("")
      const todoDone = () => todos().filter((t) => t.done).length
      const setTodos = (next: readonly (typeof Todo.Type)[]) => todoStore().set({ todos: next })
      const addTodo = () => {
        const text = todoDraft().trim()
        if (!text) return
        pushTodo(props.scope, props.session, text)
        setTodoDraft("")
      }
      const [sendingTodo, setSendingTodo] = createSignal<string | null>(null)
      const [sendDraft, setSendDraft] = createSignal("")
      const [sendBusy, setSendBusy] = createSignal(false)
      const openSend = (id: string) => {
        setSendDraft("")
        setSendingTodo(sendingTodo() === id ? null : id)
        requestAnimationFrame(() => (document.querySelector(".btwn-todo-send textarea") as HTMLTextAreaElement | null)?.focus())
      }
      // Queued like "Send to chat", so a running turn is never interrupted.
      const sendTodo = async (t: typeof Todo.Type) => {
        setSendBusy(true)
        try {
          await props.session.server.client.session.prompt({
            sessionID: props.session.id,
            text: [`Todo: ${t.text}`, sendDraft().trim()].filter(Boolean).join("\n\n"),
            delivery: "queue",
          })
          setSendingTodo(null)
          setSendDraft("")
          ctx.toast.show({ variant: "success", title: "Sent to agent" })
        } catch (e) {
          ctx.toast.show({ variant: "error", title: `Send failed: ${e instanceof Error ? e.message : String(e)}` })
        } finally {
          setSendBusy(false)
        }
      }
      const tick = (id: string) => setTodos(todos().map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
      const hide = () => ctx.stores.prefs.value.hideBtw
      const [query, setQuery] = createSignal("")
      const [sort, setSort] = createSignal<"oldest" | "newest">("oldest")
      const shown = () => {
        const q = query().trim().toLowerCase()
        const list = items().filter(
          (i) =>
            (!hide() || i.kind === "note") &&
            (!q || [i.text, i.answer, i.quote].some((t) => t.toLowerCase().includes(q))),
        )
        return sort() === "newest" ? [...list].reverse() : list
      }
      let listEl: HTMLDivElement | undefined
      const owner = {}
      // shortcut: a match split across two elements (e.g. bold text in an answer) is not marked; fine for plain notes
      const markMatches = () => {
        const q = query().trim().toLowerCase()
        const ranges: Range[] = []
        if (q && listEl) {
          const walker = document.createTreeWalker(listEl, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) =>
              n.parentElement?.closest(".btwn-acts,.btwn-badge") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
          })
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const text = n.nodeValue!.toLowerCase()
            for (let i = text.indexOf(q); i !== -1; i = text.indexOf(q, i + q.length)) {
              const r = document.createRange()
              r.setStart(n, i)
              r.setEnd(n, i + q.length)
              ranges.push(r)
            }
          }
        }
        matches.set(owner, ranges)
        paintMatches()
      }
      createEffect(() => {
        query()
        shown()
        queueMicrotask(markMatches)
      })
      onMount(() => {
        // Markdown answers fill in after mount, so re-mark when the list's text changes.
        const observer = new MutationObserver(markMatches)
        if (listEl) observer.observe(listEl, { childList: true, subtree: true, characterData: true })
        onCleanup(() => {
          observer.disconnect()
          matches.delete(owner)
          paintMatches()
        })
      })
      const reveal = (id: string) =>
        requestAnimationFrame(() => listEl?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" }))
      const append = (st: ReturnType<typeof store>, item: Item) => {
        st.set({ items: [...(st.value?.items ?? []), item] })
        reveal(item.id)
      }

      let taEl: HTMLTextAreaElement | undefined
      const edit = (next: string, start: number, end: number) => {
        setDraft(next)
        queueMicrotask(() => {
          if (!taEl) return
          taEl.value = next
          taEl.focus()
          taEl.setSelectionRange(start, end)
        })
      }
      const wrap = (before: string, after = before, placeholder = "text") => {
        const el = taEl
        if (!el) return
        const v = el.value, a = el.selectionStart, b = el.selectionEnd
        const sel = v.slice(a, b) || placeholder
        // Toggle off when the selection is already wrapped.
        if (v.slice(a - before.length, a) === before && v.slice(b, b + after.length) === after)
          return edit(v.slice(0, a - before.length) + v.slice(a, b) + v.slice(b + after.length), a - before.length, b - before.length)
        edit(v.slice(0, a) + before + sel + after + v.slice(b), a + before.length, a + before.length + sel.length)
      }
      const prefixLines = (prefix: string) => {
        const el = taEl
        if (!el) return
        const v = el.value
        const a = v.lastIndexOf("\n", el.selectionStart - 1) + 1
        const bi = v.indexOf("\n", el.selectionEnd)
        const b = bi === -1 ? v.length : bi
        const lines = v.slice(a, b).split("\n")
        const on = lines.every((l) => l.startsWith(prefix))
        const out = lines.map((l) => (on ? l.slice(prefix.length) : prefix + l)).join("\n")
        edit(v.slice(0, a) + out + v.slice(b), a, a + out.length)
      }
      const link = () => {
        const el = taEl
        if (!el) return
        const v = el.value, a = el.selectionStart, b = el.selectionEnd
        const label = v.slice(a, b) || "link"
        const text = `[${label}](url)`
        edit(v.slice(0, a) + text + v.slice(b), a + label.length + 3, a + label.length + 6)
      }
      const shortcuts: Record<string, () => void> = {
        b: () => wrap("**"),
        i: () => wrap("_"),
        e: () => wrap("`", "`", "code"),
        k: link,
      }
      const addNote = () => {
        const text = draft().trim()
        if (!text) return
        const asTodo = text.match(todoCommand)
        if (asTodo) {
          const todo = (asTodo[1] ?? "").trim()
          if (!todo) return void ctx.toast.show({ variant: "error", title: "Type the todo after /todo" })
          pushTodo(props.scope, props.session, todo)
          setDraft("")
          ctx.toast.show({ variant: "success", title: "Added to todos" })
          return
        }
        append(store(), { id: crypto.randomUUID(), kind: "note", text, answer: "", quote: pendingQuote(), time: Date.now() })
        setDraft("")
        setPendingQuote("")
      }

      const ask = async (q: string, quote = "", note = "") => {
        q = q.trim()
        if (!q) return
        const st = store()
        const session = props.session
        const id = crypto.randomUUID()
        const history = items()
        setPending((p) => [...p, { id, q }])
        reveal(id)
        try {
          const chosen = picked()
          const body = prompt(history, q, quote, note)
          const out = chosen
            ? await session.server.client.experimental.generate.text({
                prompt: `Conversation so far, for reference only:\n\n${transcript(data().session.message.list(session.id))}\n\n---\n\n${body}`,
                model: { providerID: chosen.providerID, id: chosen.id, ...(variantKey() ? { variant: variantKey() } : {}) },
              })
            : await session.server.client.session.generate({ sessionID: session.id, prompt: body })
          append(st, { id, kind: "btw", text: q, answer: out.text, quote, time: Date.now(), ...(chosen ? { model: chosen.name } : {}) })
        } catch (e) {
          ctx.toast.show({ variant: "error", title: `/btw failed: ${e instanceof Error ? e.message : String(e)}` })
        } finally {
          setPending((p) => p.filter((x) => x.id !== id))
        }
      }

      const quoted = (t: string) => "> " + t.replace(/\n/g, "\n> ")
      // Sent as a queued user message, so it never interrupts a running turn.
      const toChat = async (item: Item) => {
        const comment = draft().trim()
        const text =
          item.kind === "btw"
            ? [
                `From my side notes, a /btw answer${item.quote ? ` about:\n${quoted(item.quote)}` : ""}`,
                `Q: ${item.text}`,
                quoted(item.answer),
                comment,
              ]
            : [item.quote && `About this part of the conversation:\n${quoted(item.quote)}`, item.text, comment]
        try {
          await props.session.server.client.session.prompt({
            sessionID: props.session.id,
            text: text.filter(Boolean).join("\n\n"),
            delivery: "queue",
          })
          setDraft("")
          ctx.toast.show({ variant: "success", title: "Sent to chat" })
        } catch (e) {
          ctx.toast.show({ variant: "error", title: `Send failed: ${e instanceof Error ? e.message : String(e)}` })
        }
      }

      // The note is context; the question comes from the text box, else a dialog.
      const askAbout = async (item: Item) => {
        const q =
          draft().trim() ||
          (await ctx.dialogs.prompt({
            title: item.kind === "btw" ? "Follow-up /btw" : "Ask /btw about this note",
            description: item.kind === "btw" ? `Follow-up to: ${item.text}` : item.text,
            placeholder: "Your question",
            submit: "Ask",
          }))?.trim()
        if (!q) return
        setDraft("")
        void ask(
          q,
          item.quote,
          item.kind === "btw"
            ? `this earlier side answer (to "${item.text}"):\n${item.answer}`
            : `this note of mine:\n${item.text}`,
        )
      }

      const exportMd = async () => {
        const quote = (t: string) => "> " + t.replace(/\n/g, "\n> ")
        const body = shown()
          .map((i) =>
            [
              `### ${i.kind === "btw" ? `/btw ${i.text}` : "Note"} · ${new Date(i.time).toLocaleString()}`,
              i.quote && quote(i.quote),
              i.kind === "btw" ? i.answer : i.text,
            ]
              .filter(Boolean)
              .join("\n\n"),
          )
          .join("\n\n---\n\n")
        const name = `${props.scope}-notes-${new Date().toISOString().slice(0, 10)}.md`
        if (await ctx.system.save({ name, content: `# ${props.scope === "session" ? "Session" : "Project"} notes\n\n${body}\n` }))
          ctx.toast.show({ variant: "success", title: "Notes exported" })
      }

      const renameTab = async () => {
        const title = (
          await ctx.dialogs.prompt({
            title: `Rename ${props.scope} notes`,
            placeholder: DEFAULT_TITLE[props.scope],
            value: titleOf(props.scope, props.session),
            submit: "Rename",
          })
        )?.trim()
        if (title) setTitle(props.scope, props.session, title)
      }

      const wipe = async () => {
        const n = items().length
        if (!n) return
        const ok = await ctx.dialogs.confirm({
          title: `Delete all ${props.scope} notes?`,
          description: `This removes ${n === 1 ? "1 note" : `${n} notes and /btw answers`} from this tab. Todos are kept. This can't be undone.`,
          confirm: "Delete all",
          danger: true,
        })
        if (ok) store().set({ items: [] })
      }
      const remove = (id: string) => store().set({ items: items().filter((i) => i.id !== id) })
      const annotate = () => {
        if (lastSelection) setPendingQuote(lastSelection)
        else ctx.toast.show({ variant: "error", title: "Select some chat text first" })
      }
      const go = (quote: string) => {
        if (!jump(quote)) ctx.toast.show({ variant: "error", title: "Text not found in the loaded chat" })
      }

      return (
        <div class="btwn" data-btw-notes>
          <div class="btwn-bar">
            <div class="btwn-row1">
              <div class="btwn-search">
                <Search size={14} />
                <ui.TextInput class="btwn-grow" type="search" label="Search notes" placeholder="Search" value={query()} onInput={setQuery} />
                <Show when={query()}>
                  <button
                    class="btwn-clear"
                    aria-label="Clear search"
                    title="Clear search"
                    onClick={(e) => {
                      setQuery("")
                      ;(e.currentTarget.parentElement?.querySelector("input") as HTMLInputElement | null)?.focus()
                    }}
                  >
                    <X size={14} />
                  </button>
                </Show>
              </div>
              <div class="btwn-toggle">
                <span class="btwn-lbl btwn-togglelbl" onClick={() => ctx.stores.prefs.set({ hideBtw: !hide() })}>
                  <SquarePen size={15} />
                  <span>Notes only</span>
                </span>
                <ui.Switch
                  label="Notes only"
                  hideLabel
                  checked={hide()}
                  onChange={(v: boolean) => ctx.stores.prefs.set({ hideBtw: v })}
                />
              </div>
              <span class="btwn-vsep" aria-hidden="true" />
              <ui.Tooltip value={`Delete all ${props.scope} notes`}>
                <button
                  class="btwn-wipe"
                  aria-label={`Delete all ${props.scope} notes`}
                  disabled={!items().length}
                  onClick={() => void wipe()}
                >
                  <Trash2 size={15} />
                </button>
              </ui.Tooltip>
            </div>
            <div class="btwn-grid btwn-grid3 btwn-top">
              <div class="btwn-cell btwn-menu">
                <ui.Menu
                  trigger="button"
                  label={sort() === "newest" ? "Newest first" : "Oldest first"}
                  placement="bottom-start"
                  items={[
                    { label: "Oldest first", icon: sort() === "oldest" ? ("check" as const) : undefined, onSelect: () => setSort("oldest") },
                    { label: "Newest first", icon: sort() === "newest" ? ("check" as const) : undefined, onSelect: () => setSort("newest") },
                  ]}
                />
              </div>
              <div class="btwn-cell">
                <ui.Button size="small" onClick={() => void renameTab()}>
                  <Lbl icon={Pencil} text="Rename" />
                </ui.Button>
              </div>
              <div class="btwn-cell">
                <ui.Button size="small" disabled={!shown().length} onClick={() => void exportMd()}>
                  <Lbl icon={Download} text="Export" />
                </ui.Button>
              </div>
            </div>
          </div>
          <div class="btwn-ctxhead">
            <div class="btwn-chd" data-open={panelOpen() === "todo"}>
              <ui.Button size="small" variant="ghost-muted" onClick={() => toggle("todo")}>
                <span class="btwn-lbl">
                  <ChevronRight size={14} class="btwn-chev" />
                  <ListTodo size={14} />
                  Todo{todos().length ? ` ${todoDone()}/${todos().length}` : ""}
                </span>
              </ui.Button>
            </div>
            <div class="btwn-chd" data-open={panelOpen() === "ctx"}>
              <ui.Button size="small" variant="ghost-muted" onClick={() => toggle("ctx")}>
                <span class="btwn-lbl">
                  <ChevronRight size={14} class="btwn-chev" />
                  Note session context
                </span>
              </ui.Button>
            </div>
          </div>
          <Show when={panelOpen() === "todo"}>
            <div class="btwn-todos">
              <div class="btwn-todo-add">
                <ui.TextInput
                  class="btwn-grow"
                  label="New todo"
                  placeholder="Add a todo"
                  value={todoDraft()}
                  onInput={setTodoDraft}
                  onSubmit={addTodo}
                />
                <ui.Button size="small" variant="contrast" onClick={addTodo}>
                  <Lbl icon={Plus} text="Add" />
                </ui.Button>
              </div>
              <Show when={todos().length}>
                <div class="btwn-todo-foot">
                  <span>
                    {todoDone()} of {todos().length} done
                  </span>
                  <Show when={todoDone() > 0}>
                    <ui.Button size="small" variant="ghost-muted" onClick={() => setTodos(todos().filter((t) => !t.done))}>
                      Clear done
                    </ui.Button>
                  </Show>
                </div>
              </Show>
              <div class="btwn-todo-list">
              <Show when={todos().length} fallback={<div class="btwn-empty">Nothing to do</div>}>
                <For each={todos()}>
                  {(t) => (
                    <div class="btwn-todo" data-done={t.done} data-sending={sendingTodo() === t.id}>
                      <div class="btwn-todo-main">
                        <button class="btwn-tick" aria-label={t.done ? "Mark not done" : "Mark done"} onClick={() => tick(t.id)}>
                          {t.done ? <SquareCheck size={18} /> : <Square size={18} />}
                        </button>
                        <span class="btwn-todo-text">{t.text}</span>
                        <div class="btwn-todo-acts">
                          <ui.Tooltip value="Send to agent with prompt">
                            <ui.Button size="small" variant="ghost-muted" onClick={() => openSend(t.id)}>
                              <Lbl icon={SendHorizontal} text="Agent" />
                            </ui.Button>
                          </ui.Tooltip>
                          <button class="btwn-todo-x" aria-label="Delete todo" onClick={() => setTodos(todos().filter((x) => x.id !== t.id))}>
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                      <Show when={sendingTodo() === t.id}>
                        <div class="btwn-todo-send">
                          <textarea
                            aria-label="Prompt for the agent"
                            placeholder="Instructions for the agent (optional). Enter to send, Shift+Enter for a new line."
                            value={sendDraft()}
                            onInput={(e) => setSendDraft(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setSendingTodo(null)
                              else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                                e.preventDefault()
                                void sendTodo(t)
                              }
                            }}
                          />
                          <div class="btwn-todo-sendrow">
                            <ui.Button size="small" variant="ghost-muted" onClick={() => setSendingTodo(null)}>
                              Cancel
                            </ui.Button>
                            <ui.Button size="small" variant="contrast" busy={sendBusy()} onClick={() => void sendTodo(t)}>
                              <Lbl icon={SendHorizontal} text="Send" />
                            </ui.Button>
                          </div>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
              </div>
            </div>
          </Show>
          <Show when={showCtx()}>
          <div class="btwn-stats">
            <Show when={model()}>
              {(m) => (
                <span class="btwn-chip" title="Model">
                  <Cpu size={12} />
                  {m().name}
                  {m().variant ? ` · ${m().variant}` : ""}
                </span>
              )}
            </Show>
            <Show when={ctxUsed() > 0}>
              <span class="btwn-ctx" title={`Context window: ${ctxUsed().toLocaleString()} tokens${model()?.limit ? ` of ${model()!.limit!.toLocaleString()}` : ""}`}>
                <svg
                  class={`btwn-ring ${(ctxPct() ?? 0) >= 90 ? "hot" : (ctxPct() ?? 0) >= 70 ? "warn" : ""}`}
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                >
                  <circle class="bg" cx="10" cy="10" r="7.5" />
                  <circle
                    class="fg"
                    cx="10"
                    cy="10"
                    r="7.5"
                    stroke-dasharray={String(RING)}
                    stroke-dashoffset={String(RING * (1 - (ctxPct() ?? 0) / 100))}
                  />
                </svg>
                {fmtTokens(ctxUsed())}
                {ctxPct() !== undefined ? ` · ${ctxPct()}%` : ""}
              </span>
            </Show>
            <Show when={info()?.tokens}>
              {(t) => (
                <span
                  class="btwn-chip"
                  title={`Session totals: input ${t().input.toLocaleString()} · output ${t().output.toLocaleString()} · reasoning ${t().reasoning.toLocaleString()} · cache read ${t().cache.read.toLocaleString()} · cache write ${t().cache.write.toLocaleString()}`}
                >
                  <ArrowDown size={12} />
                  {fmtTokens(t().input + t().cache.read + t().cache.write)}
                  <ArrowUp size={12} />
                  {fmtTokens(t().output + t().reasoning)}
                </span>
              )}
            </Show>
            <Show when={info()}>
              <span class="btwn-chip" title="Session cost, including subagents">
                <Coins size={12} />
                {fmtCost((() => { try { return data().session.cost(props.session.id) } catch { return info()?.cost ?? 0 } })())}
              </span>
            </Show>
            <span class="btwn-chip" title="Notes and /btw questions in this tab">
              <SquarePen size={12} />
              {items().filter((i) => i.kind === "note").length === 1 ? "1 note" : `${items().filter((i) => i.kind === "note").length} notes`}
              <MessageCircleQuestion size={12} />
              {items().filter((i) => i.kind === "btw").length} /btw
            </span>
          </div>
          </Show>
          <div class="btwn-list" ref={listEl}>
            <Show when={shown().length || pending().length} fallback={<div class="btwn-empty">{query() ? "No matches" : "No notes yet"}</div>}>
              <For each={shown()}>
                {(item) => (
                  <div data-id={item.id} class={`btwn-row ${item.kind === "btw" ? "btwn-btw" : ""}`}>
                    <span class="btwn-badge" title={item.kind === "btw" ? (item.quote ? "Annotated /btw" : "/btw") : item.quote ? "Annotated note" : "Note"}>
                      <Show when={item.quote || item.kind === "note"}>
                        {item.quote ? <Quote size={13} /> : <SquarePen size={13} />}
                      </Show>
                      <Show when={item.kind === "btw"}>/btw</Show>
                    </span>
                    <Show when={item.quote}>
                      <div class="btwn-quote" title="Jump to this text in the chat" onClick={() => go(item.quote)}>
                        {item.quote}
                      </div>
                    </Show>
                    <Show
                      when={item.kind === "btw"}
                      fallback={<ui.Markdown class="btwn-text btwn-md" text={item.text} />}
                    >
                      <div class="btwn-q">/btw {item.text}{item.model ? <span class="btwn-via"> · {item.model}</span> : null}</div>
                      <ui.Markdown text={item.answer} />
                    </Show>
                    <div class="btwn-time" title={new Date(item.time).toLocaleString()}>
                      {fmtTime(item.time)}
                    </div>
                    <div class="btwn-acts">
                      <ui.Button onClick={() => void askAbout(item)}>
                        <Lbl icon={MessageCircleQuestion} text={item.kind === "btw" ? "Follow-up /btw" : "Ask /btw"} />
                      </ui.Button>
                      <ui.Button variant="contrast" onClick={() => void toChat(item)}>
                        <Lbl icon={SendHorizontal} text="Send to chat" />
                      </ui.Button>
                      <ui.Button class="btwn-del" variant="danger" onClick={() => remove(item.id)}>
                        <Lbl icon={Trash2} text="Delete" />
                      </ui.Button>
                    </div>
                  </div>
                )}
              </For>
              <Show when={!hide()}>
                <For each={pending()}>
                  {(p) => (
                    <div data-id={p.id} class="btwn-row btwn-btw">
                      <div class="btwn-q">/btw {p.q}</div>
                      <ui.Loader size="large" />
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </div>
          <div class="btwn-in">
            <div class="btwn-box">
              <Show when={pendingQuote()}>
                <div class="btwn-quote" onClick={() => setPendingQuote("")} title="Click to remove">
                  {pendingQuote()}
                </div>
              </Show>
              <div class="btwn-fmt" role="toolbar" aria-label="Formatting">
                <ui.Tooltip value="Bold" keys={["⌘", "B"]}>
                  <button aria-label="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap("**")}>
                    <Bold size={14} />
                  </button>
                </ui.Tooltip>
                <ui.Tooltip value="Italic" keys={["⌘", "I"]}>
                  <button aria-label="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap("_")}>
                    <Italic size={14} />
                  </button>
                </ui.Tooltip>
                <ui.Tooltip value="Strikethrough">
                  <button aria-label="Strikethrough" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap("~~")}>
                    <Strikethrough size={14} />
                  </button>
                </ui.Tooltip>
                <span class="btwn-fmt-sep" />
                <ui.Tooltip value="Code" keys={["⌘", "E"]}>
                  <button aria-label="Code" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap("`", "`", "code")}>
                    <Code size={14} />
                  </button>
                </ui.Tooltip>
                <ui.Tooltip value="Link" keys={["⌘", "K"]}>
                  <button aria-label="Link" onMouseDown={(e) => e.preventDefault()} onClick={link}>
                    <Link size={14} />
                  </button>
                </ui.Tooltip>
                <ui.Tooltip value="Bulleted list">
                  <button aria-label="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => prefixLines("- ")}>
                    <List size={14} />
                  </button>
                </ui.Tooltip>
              </div>
              <textarea
                ref={taEl}
                class="btwn-ta"
                aria-label="Note or /btw question"
                placeholder="Write a note in Markdown (Enter), /todo to add a todo, a /btw question, or a comment to send. Shift+Enter for a new line."
                value={draft()}
                onInput={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  const fmt = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && shortcuts[e.key.toLowerCase()]
                  if (fmt) {
                    e.preventDefault()
                    fmt()
                    return
                  }
                  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                    e.preventDefault()
                    addNote()
                  }
                }}
              />
              <div class="btwn-models btwn-menu">
                <ui.Menu
                  trigger="button"
                  label={current() ? `${providerName(current().providerID)} / ${current().name}` : "Session model"}
                  placement="top-end"
                  items={modelMenu()}
                />
                <Show when={picked()?.variants?.length}>
                  <ui.Menu
                    trigger="button"
                    label={variantKey() || "Default"}
                    placement="top-end"
                    items={variantOptions().map((o) => ({
                      label: o.label,
                      icon: (variantKey() || "default") === o.value ? ("check" as const) : undefined,
                      onSelect: () => pref.set({ model: modelKey(), variant: o.value === "default" ? "" : o.value }),
                    }))}
                  />
                </Show>
              </div>
            </div>
            <div class="btwn-grid btwn-grid3 btwn-bottom">
              <div class="btwn-cell">
                <ui.Button size="small" variant="contrast" onClick={addNote}>
                  <Lbl icon={Plus} text="Add note" />
                </ui.Button>
              </div>
              <div class="btwn-cell">
                <ui.Button
                  size="small"
                  onClick={() => {
                    const q = draft()
                    const quote = pendingQuote()
                    setDraft("")
                    setPendingQuote("")
                    void ask(q, quote)
                  }}
                >
                  <Lbl icon={MessageCircleQuestion} text="/btw" />
                </ui.Button>
              </div>
              <div class="btwn-cell">
                <ui.Button size="small" onClick={annotate}>
                  <Lbl icon={Quote} text="Annotate" />
                </ui.Button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    const tabCache = new Map<string, PanelTab>()
    const tabFor = (scope: "session" | "project", session: any): PanelTab => {
      const key = `${scope}\n${session.key}`
      let tab = tabCache.get(key)
      if (!tab) {
        tab = {
          id: scope,
          get title() {
            return titleOf(scope, session)
          },
          label: () => (
            <span class="btwn-lbl">
              <SquarePen size={14} />
              {titleOf(scope, session)}
            </span>
          ),
          closable: "compact",
          fallback: scope === "session",
        }
        tabCache.set(key, tab)
      }
      return tab
    }

    ctx.add(Style, css)
    ctx.add(Panel, {
      id: "notes",
      region: "side",
      list: (input) =>
        (["session", "project"] as const).filter((t) => input.open.includes(t)).map((t) => tabFor(t, input.session)),
      render: (props) => <Notes scope={props.tab.id as "session" | "project"} session={props.session} />,
    })

    const open = (tab: "session" | "project") => {
      const session = ctx.sessions.current()
      if (session) ctx.layout.open(`${ctx.id}:${tab}`, session)
    }
    ctx.add(Command, (): Command => ({ id: "open-session", title: "Notes: session notes", run: () => open("session") }))
    ctx.add(Command, (): Command => ({ id: "open-project", title: "Notes: project notes", run: () => open("project") }))
    ctx.add(Command, (): Command => ({
      id: "todo",
      title: "Notes: add a todo",
      description: "Adds the text after /todo to this session's todos",
      slash: { name: "todo", arguments: true },
      enabled: !!ctx.sessions.current(),
      run: (input) => {
        const session = ctx.sessions.current()
        const text = input?.trim()
        if (!session) return
        if (!text) {
          ctx.toast.show({ variant: "error", title: "Type the todo after /todo" })
          return
        }
        pushTodo("session", session, text)
        ctx.toast.show({ variant: "success", title: "Added to todos", description: text })
      },
    }))
    ctx.add(Command, (): Command => ({
      id: "annotate",
      title: "Notes: annotate selected chat text",
      bind: "mod+alt+n",
      run: () => {
        if (!lastSelection) {
          ctx.toast.show({ variant: "error", title: "Select some chat text first" })
          return
        }
        setPendingQuote(lastSelection)
        open("session")
      },
    }))
    for (const [tab, title] of [["session", "Session notes"], ["project", "Project notes"]] as const) {
      ctx.add(MenuItem, (): MenuItem => {
        const session = ctx.sessions.current()
        return {
          menu: "session.panel",
          id: tab,
          title,
          icon: "comment",
          opened: !!session && ctx.layout.state(`${ctx.id}:${tab}`, session) !== "closed",
          run: () => open(tab),
        }
      })
    }

    return () => document.removeEventListener("selectionchange", onSelect)
  },
})
