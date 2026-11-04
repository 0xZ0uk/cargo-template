/**
 * The editor's own styles, injected once. Everything is prefixed `po-` and set
 * explicitly, so the host site's CSS (and its absence) doesn't matter.
 */
import { DOM_ATTR } from './dom.ts'
export const PO_Z = 2147483000

export const PO_CSS = `
.po-layer{position:fixed;inset:0;pointer-events:none;z-index:${PO_Z};font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a}
.po-layer *{box-sizing:border-box}
.po-outline{position:fixed;border:2px solid #4f7cff;border-radius:4px;pointer-events:none;transition:all .06s ease-out}
.po-outline.is-block{border-style:dashed;border-color:#4f7cff99}
.po-outline.is-item{border-color:#22a06b}
.po-chip{position:fixed;transform:translateY(-100%);background:#3b63e0;color:#fff;font-size:11px;font-weight:600;padding:2px 6px;border-radius:4px 4px 0 0;white-space:nowrap;pointer-events:none}
.po-chip.is-item{background:#167a45}
.po-bar{position:fixed;display:flex;gap:2px;padding:3px;background:#0f172a;border-radius:8px;box-shadow:0 6px 24px #0f172a40;pointer-events:auto}
.po-bar.is-item{background:#14532d}
.po-btn{all:unset;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:28px;height:28px;padding:0 8px;border-radius:6px;color:#fff;font:600 12px/1 system-ui,-apple-system,sans-serif;cursor:pointer;white-space:nowrap}
.po-btn:hover{background:#ffffff1f}
.po-btn:focus-visible{outline:2px solid #93c5fd;outline-offset:1px}
.po-btn[disabled]{opacity:.35;cursor:default;background:none}
.po-btn.is-danger:hover{background:#ef444455}
.po-add{position:fixed;transform:translate(-50%,-50%);pointer-events:auto}
.po-add .po-btn{background:#3b63e0;box-shadow:0 2px 10px #4f7cff66;height:24px;font-size:11px}
.po-add .po-btn:hover{background:#2f5bd9}
.po-add.is-item .po-btn{background:#167a45;box-shadow:0 2px 10px #167a4555}
.po-panel{position:fixed;width:320px;max-height:min(70vh,560px);overflow:auto;background:#fff;color:#0f172a;border-radius:12px;box-shadow:0 20px 60px #0f172a40,0 0 0 1px #0f172a14;pointer-events:auto;padding:14px}
.po-panel .po-h3{margin:0 0 10px;font:700 13px/1.2 system-ui,sans-serif}
.po-panel .po-h4,.po-blocks-group .po-h4{margin:14px 0 6px;font:600 11px/1.2 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#64748b}
.po-row{display:flex;flex-direction:column;gap:4px;margin:0 0 10px}
.po-row label{font-weight:600;font-size:12px}
.po-row small{color:#64748b;font-size:11px}
.po-input,.po-select{all:unset;box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font:13px system-ui,sans-serif;color:#0f172a}
.po-select{appearance:auto;-webkit-appearance:auto}
.po-input:focus,.po-select:focus{border-color:#4f7cff;box-shadow:0 0 0 3px #4f7cff33}
.po-check{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600}
.po-seg{display:flex;flex-wrap:wrap;gap:4px}
.po-seg button{all:unset;padding:5px 9px;border:1px solid #cbd5e1;border-radius:7px;font:12px system-ui,sans-serif;cursor:pointer;background:#fff}
.po-seg button[aria-pressed="true"]{background:#0f172a;color:#fff;border-color:#0f172a}
.po-modal-bg{position:fixed;inset:0;background:#0f172a66;pointer-events:auto;display:flex;align-items:center;justify-content:center;padding:24px}
.po-modal{width:min(880px,100%);max-height:85vh;display:flex;flex-direction:column;background:#fff;border-radius:14px;box-shadow:0 30px 80px #0f172a55;overflow:hidden}
.po-modal header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #e2e8f0}
.po-modal header .po-h3{margin:0;flex:1;font:700 14px system-ui,sans-serif}
.po-modal .po-body{padding:14px 16px;overflow:auto}
.po-modal .po-btn{color:#0f172a}
.po-modal .po-btn:hover{background:#f1f5f9}
.po-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.po-tile{all:unset;display:flex;flex-direction:column;gap:6px;cursor:pointer;border-radius:10px;padding:6px;border:2px solid transparent}
.po-tile:hover,.po-tile:focus-visible{border-color:#4f7cff;background:#f8fafc}
.po-tile img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;background:#f1f5f9}
.po-tile span{font-size:11px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.po-blocks{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.po-blocks.is-narrow{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.po-blocks-group:first-of-type .po-h4{margin-top:0}
.po-blocks-group.is-ungrouped{margin-top:14px;padding-top:14px;border-top:1px solid #e2e8f0}
.po-blocks-hint{margin:0 0 10px;font-size:12px;color:#475569}
.po-block-card{all:unset;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:8px;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;color:#0f172a;font:600 13px system-ui,sans-serif}
.po-block-card:hover,.po-block-card:focus-visible{border-color:#4f7cff;background:#f5f8ff}
.po-block-card:focus-visible{outline:2px solid #4f7cff;outline-offset:2px}
.po-block-card.is-previewing{border-color:#3b63e0;background:#eef2ff;box-shadow:inset 0 0 0 1px #3b63e0}
.po-block-card img,.po-block-thumb{display:block;width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:6px;background:#f1f5f9}
.po-block-thumb{display:flex;align-items:center;justify-content:center;color:#475569;font:700 22px system-ui,sans-serif}
.po-block-label{padding:0 2px 2px}
.po-btn svg{display:block}
.po-dock{position:fixed;left:50%;width:max-content;bottom:var(--po-dock-bottom,16px);transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:6px;background:#0f172a;color:#fff;border-radius:12px;box-shadow:0 12px 40px #0f172a55;pointer-events:auto;max-width:calc(100vw - 24px);flex-wrap:wrap}
.po-dock .po-status{padding:0 10px;font-size:12px;opacity:.85;white-space:nowrap}
.po-dock .po-status.is-bad{color:#fca5a5;opacity:1}
.po-dock .po-sep{width:1px;height:20px;background:#ffffff26;margin:0 4px}
.po-dock .po-primary{background:#3b63e0}
.po-dock .po-primary:hover{background:#2f5bd9}
.po-chip-locale{padding:2px 7px;border-radius:999px;background:#ffffff1f;font-size:11px;font-weight:700;text-transform:uppercase}
.po-notice{position:fixed;left:50%;width:max-content;bottom:calc(var(--po-dock-bottom,16px) + 56px);transform:translateX(-50%);max-width:min(560px,calc(100vw - 24px));padding:8px 12px;border-radius:10px;background:#fffbeb;color:#78350f;border:1px solid #fcd34d;font-size:12px;pointer-events:auto}
.po-doc-layer{position:absolute;top:0;left:0;width:0;height:0;overflow:visible;z-index:${PO_Z};pointer-events:none;font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif}
.po-inline{position:absolute;pointer-events:auto;outline:2px solid #4f7cff;outline-offset:2px;border-radius:2px;background:transparent;white-space:pre-wrap;word-break:break-word;caret-color:currentColor;cursor:text}
.po-inline:focus{outline-color:#4f7cff}
.po-rt{position:absolute;pointer-events:auto}
.po-rt-surface{outline:2px solid #4f7cff;outline-offset:6px;border-radius:2px;min-height:1.5em}
.po-rt-surface:focus{outline:2px solid #4f7cff}
.po-rt-toolbar{position:absolute;inset-inline-start:0;top:-48px;display:flex;gap:2px;padding:3px;background:#0f172a;border-radius:8px;box-shadow:0 6px 24px #0f172a40}
.po-rt-toolbar .po-btn[aria-pressed="true"]{background:#ffffff2e}
.po-pop{position:fixed;min-width:220px;max-width:340px;background:#fff;color:#0f172a;border-radius:10px;box-shadow:0 14px 40px #0f172a40,0 0 0 1px #0f172a14;pointer-events:auto;padding:10px}
.po-pop .po-row{margin-bottom:8px}
.po-pop-list{display:flex;flex-direction:column;gap:2px;max-height:260px;overflow:auto}
.po-pop-list button{all:unset;padding:7px 9px;border-radius:7px;cursor:pointer;font:13px system-ui,sans-serif}
.po-pop-list button:hover,.po-pop-list button:focus-visible,.po-pop-list button[aria-selected="true"]{background:#eef2ff}
.po-ghost{position:absolute;pointer-events:none;white-space:pre-wrap;word-break:break-word}
.po-docs{font-size:11px;padding:2px 7px;border-radius:999px;background:#ffffff1f}
.po-frame-bg{position:fixed;inset:0;background:#0f172acc;pointer-events:auto;display:flex;flex-direction:column;align-items:center;padding:56px 16px 16px}
.po-frame-bg iframe{background:#fff;border:0;border-radius:12px;box-shadow:0 30px 80px #0008;height:100%;max-width:100%}
.po-badge{padding:2px 8px;border-radius:999px;background:#f59e0b;color:#111;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.po-b{font-weight:700}.po-i{font-style:italic}.po-u{text-decoration:underline}
.po-opaque{display:inline-flex;align-items:center;gap:6px;margin:6px 0;padding:6px 10px;border:1px dashed #94a3b8;border-radius:8px;background:#f8fafc;color:#475569;font:12px system-ui,sans-serif;user-select:none}
html[data-onpage-editing] [data-onpage-field]{cursor:pointer}
[data-onpage-hidden="true"]{visibility:hidden!important}
html[data-onpage-editing] [data-onpage-changed]{outline:2px dashed #d97706!important;outline-offset:2px}
html[data-onpage-editing] [data-onpage-invalid]{outline:2px solid #dc2626!important;outline-offset:2px}
.po-preview{position:fixed;left:50%;width:max-content;bottom:var(--po-dock-bottom,16px);transform:translateX(-50%);display:flex;align-items:center;gap:6px;padding:6px;background:#0f172a;color:#fff;border-radius:12px;box-shadow:0 12px 40px #0f172a55;pointer-events:auto;max-width:calc(100vw - 24px);flex-wrap:wrap}
.po-preview .po-status{padding:0 8px;font-size:12px;opacity:.85}
.po-rel-item{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;background:#f1f5f9;font-size:12px;margin:0 0 4px}
.po-rel-item button{all:unset;cursor:pointer;margin-inline-start:auto;padding:0 4px;color:#64748b}

.po-dialog-head{display:flex;align-items:center;gap:8px;margin:0 0 10px}
.po-modal .po-dialog-head{margin:0;padding:14px 16px;border-bottom:1px solid #e2e8f0}
.po-dialog-head .po-h3{flex:1;margin:0;font:700 14px/1.2 system-ui,sans-serif}
.po-close{color:#0f172a;min-width:24px;height:24px}
.po-close:hover{background:#f1f5f9}
.po-bar-label{cursor:default;opacity:.8}
.po-muted{color:#64748b;margin:6px 0}
.po-error{color:#b91c1c;margin:6px 0}
.po-center{text-align:center;margin-top:12px}
.po-actions{display:flex;gap:6px}
.po-chip-lock{background:#fde68a;color:#422006;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;white-space:nowrap}
.po-drag{cursor:grab;touch-action:none}
.po-drag:active{cursor:grabbing}
.po-drop{position:fixed;background:#3b63e0;border-radius:2px;pointer-events:none;box-shadow:0 0 0 2px #fff}
.po-array-row{border:1px solid #e2e8f0;border-radius:6px;padding:8px;margin:0 0 8px}
.po-array-head{display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:12px;margin:0 0 6px}
.po-versions{list-style:none;margin:10px 0 0;padding:0}
.po-versions li{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #e2e8f0;font-size:12px}
.po-chip-live{background:#fecaca;color:#450a0a}
.po-textarea{min-height:64px;resize:vertical;width:100%;box-sizing:border-box}
.po-comments{list-style:none;margin:10px 0;padding:0}
.po-comments li{border-bottom:1px solid #e2e8f0;padding:8px 0;font-size:12px}
.po-comments li.is-resolved{opacity:.65}
.po-comments p{margin:4px 0;white-space:pre-wrap}
.po-comments blockquote{margin:4px 0;padding-inline-start:8px;border-inline-start:3px solid #cbd5e1;color:#334155}
.po-comment-head{display:flex;gap:4px;align-items:baseline}
.po-link{all:unset;color:#1d4ed8;text-decoration:underline;cursor:pointer;font-size:12px}
.po-review{margin-top:14px;border-top:1px solid #e2e8f0;padding-top:10px}
.po-quote{margin:0 0 10px;padding-inline-start:8px;border-inline-start:3px solid #cbd5e1;color:#334155;font-size:12px}
.po-assist-btn{position:fixed;pointer-events:auto;height:24px;min-width:24px;padding:0 4px;background:#0f172a;border-radius:6px;z-index:1}
.po-assist{position:fixed;pointer-events:auto;display:flex;flex-direction:column;gap:6px;padding:8px;background:#fff;color:#0f172a;border-radius:10px;box-shadow:0 12px 40px #0f172a40,0 0 0 1px #0f172a14;max-width:min(420px,calc(100vw - 16px))}
.po-assist .po-btn{color:#0f172a;background:#f1f5f9}
.po-assist small{color:#475569;font-size:11px}
.po-split{min-width:22px;padding:0 4px;margin-inline-start:-4px}
.po-schedule{margin-top:14px}
.po-alt{display:flex;flex-direction:column;gap:10px}
.po-alt img{max-height:160px;max-width:100%;align-self:flex-start;object-fit:contain;border-radius:4px}
.po-alt-line{display:flex;gap:6px}
.po-alt-line .po-input{flex:1}
.po-inline-row{flex-direction:row;align-items:center}
.po-search{width:240px}
.po-picker{cursor:pointer;display:flex;align-items:center}
.po-group{border:0;margin:0;padding:0}
.po-primary,.po-pop .po-primary,.po-panel .po-primary{background:#3b63e0;color:#fff}
.po-primary:hover{background:#2f5bd9}
.po-pop .po-btn,.po-panel .po-btn{color:#0f172a}
.po-pop .po-btn.po-primary,.po-panel .po-btn.po-primary,.po-modal .po-btn.po-primary{color:#fff}
.po-frame-close{all:unset;position:absolute;inset:0;cursor:pointer}
.po-frame-bg iframe{position:relative}
.po-input[aria-invalid="true"]{border-color:#dc2626}
html[data-onpage-editing] [data-onpage-focusable]:focus-visible{outline:2px solid #4f7cff;outline-offset:2px}
@media (prefers-reduced-motion:reduce){.po-outline{transition:none}}
`

let injected = false
export function injectStyles() {
  if (injected || typeof document === 'undefined') return
  injected = true
  const el = document.createElement('style')
  el.setAttribute(DOM_ATTR.styles, '')
  el.textContent = PO_CSS
  document.head.appendChild(el)
}
