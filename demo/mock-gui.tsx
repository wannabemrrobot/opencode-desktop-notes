// Minimal stand-in for the OpenCode Desktop plugin host, used only to preview the panel and render screenshots.
import { For, Show, createSignal, type JSX } from "solid-js"

export const Plugin = { define: <T,>(d: T) => d }
export const Store = { global: (schema: unknown, initial: unknown) => ({ schema, initial }) }
const reg = (name: string) => ({ __reg: name })
export const Panel = reg("Panel")
export const Command = reg("Command")
export const MenuItem = reg("MenuItem")
export const Style = reg("Style")
export type PanelTab = any

export const ui = {
  Button: (p: any) => (
    <button
      class={`ui-btn ${p.class ?? ""}`}
      data-variant={p.variant ?? "neutral"}
      data-size={p.size ?? "normal"}
      disabled={p.disabled}
      onClick={(e) => p.onClick?.(e)}
    >
      {p.children}
    </button>
  ),
  IconButton: (p: any) => <button class="ui-btn" onClick={p.onClick} aria-label={p.label} />,
  Tooltip: (p: any) => <span class="ui-tip" title={typeof p.value === "string" ? p.value : ""}>{p.children}</span>,
  Switch: (p: any) => (
    <button class="ui-switch" role="switch" aria-checked={p.checked} aria-label={p.label} onClick={() => p.onChange(!p.checked)}>
      <span />
    </button>
  ),
  TextInput: (p: any) => (
    <input
      class={`ui-input ${p.class ?? ""}`}
      type={p.type ?? "text"}
      placeholder={p.placeholder}
      aria-label={p.label}
      value={p.value}
      onInput={(e) => p.onInput(e.currentTarget.value)}
      onKeyDown={(e) => e.key === "Enter" && p.onSubmit?.(e.currentTarget.value)}
    />
  ),
  Menu: (p: any) => (
    <button class="ui-btn" data-variant="neutral" data-size="small">
      {p.label}
    </button>
  ),
  Select: (p: any) => <span>{p.value}</span>,
  Loader: () => <span class="ui-loader" />,
  Icon: () => <span />,
  Markdown: (p: { text: string }) => <div class="ui-md" innerHTML={md(p.text)} />,
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
const inline = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
function md(text: string) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) =>
      /^- /m.test(block)
        ? `<ul>${block
            .split("\n")
            .map((l) => `<li>${inline(l.replace(/^- /, ""))}</li>`)
            .join("")}</ul>`
        : `<p>${inline(block)}</p>`,
    )
    .join("")
}

export const _unused: JSX.Element | undefined = undefined
export { For, Show, createSignal }
