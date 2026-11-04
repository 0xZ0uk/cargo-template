/**
 * Minimal stand-ins for the @payloadcms/ui components the plugin renders, for jsdom
 * tests that mock the package (the real one imports CSS jsdom cannot parse).
 *
 * Usage, merged with the hooks a test controls:
 *   vi.mock('@payloadcms/ui', async () => ({
 *     ...(await import('./helpers/payloadUiStub.js')).payloadUiStub,
 *     useConfig: () => undefined, // optional: the stub already provides a default
 *   }))
 *
 * Stubs keep the semantics tests assert on (real <button>, aria attributes, text) and
 * nothing else. Add a component here when a converted component starts using it.
 */
import React from 'react'

type AnyProps = Record<string, any> & { children?: React.ReactNode }

const passthrough = (tag: keyof React.JSX.IntrinsicElements, className: string) =>
  function Stub({ children, className: extra }: AnyProps) {
    return React.createElement(tag, { className: [className, extra].filter(Boolean).join(' ') }, children)
  }

const Icon = () => <svg aria-hidden="true" />

/**
 * A small modal registry behind `useModal`, so a test can open a dialog and close it again
 * (the real one is faceless-ui's ModalProvider, which needs the admin's providers). Call
 * `resetModalStub()` between tests.
 */
const openModals = new Set<string>()
const modalListeners = new Set<() => void>()
let modalSnapshot: Record<string, { isOpen: boolean }> = {}
const publishModals = () => {
  modalSnapshot = Object.fromEntries([...openModals].map((slug) => [slug, { isOpen: true }]))
  modalListeners.forEach((listener) => listener())
}
const modalApi = {
  openModal: (slug: string) => {
    openModals.add(slug)
    publishModals()
  },
  closeModal: (slug: string) => {
    openModals.delete(slug)
    publishModals()
  },
  toggleModal: (slug: string) => (openModals.has(slug) ? modalApi.closeModal(slug) : modalApi.openModal(slug)),
  isModalOpen: (slug: string) => openModals.has(slug),
}
/** The stub's modal registry, for tests that check what's left open after an unmount. */
export const modalApiForTests = modalApi

export const resetModalStub = () => {
  openModals.clear()
  publishModals()
}
const useModalStub = () => {
  const modalState = React.useSyncExternalStore(
    (listener) => {
      modalListeners.add(listener)
      return () => modalListeners.delete(listener)
    },
    () => modalSnapshot,
  )
  return { ...modalApi, modalState }
}

const DialogContext = React.createContext<{ slug: string } | null>(null)

/**
 * Default `useConfig()`: what the admin provides. A test that needs other values
 * (a custom `routes.api`, feature flags, no provider) overrides `useConfig` after the spread.
 */
export const stubConfig = {
  config: {
    routes: { api: '/api', admin: '/admin' },
    admin: { custom: { seoAnalyzer: { endpointBasePath: '/seo-plugin' } } },
  },
}

export const payloadUiStub = {
  useConfig: () => stubConfig,
  useDocumentInfo: () => ({}),
  Banner: ({ children, type = 'default', className }: AnyProps) => (
    <div className={['banner', `banner--type-${type}`, className].filter(Boolean).join(' ')}>{children}</div>
  ),
  Button: ({ children, onClick, disabled, type = 'button', buttonStyle, className, el, url, to, newTab, icon, tooltip, ...rest }: AnyProps) => {
    const cls = ['btn', buttonStyle && `btn--style-${buttonStyle}`, className].filter(Boolean).join(' ')
    const aria = Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('aria-')))
    if (el === 'anchor' || el === 'link' || url || to) {
      return (
        <a className={cls} href={url ?? to} rel={newTab ? 'noopener noreferrer' : undefined} target={newTab ? '_blank' : undefined} {...aria}>
          {children}
        </a>
      )
    }
    return (
      <button className={cls} disabled={disabled} onClick={onClick} title={typeof tooltip === 'string' ? tooltip : undefined} type={type} {...aria}>
        {children}
      </button>
    )
  },
  Pill: ({ children, pillStyle = 'light', className }: AnyProps) => (
    <span className={['pill', `pill--style-${pillStyle}`, className].filter(Boolean).join(' ')}>{children}</span>
  ),
  Spinner: ({ loadingText }: AnyProps) => <span role="status">{loadingText ?? 'Loading...'}</span>,
  Collapsible: ({ children, header, initCollapsed, className }: AnyProps) => {
    const [collapsed, setCollapsed] = React.useState(Boolean(initCollapsed))
    return (
      <div className={['collapsible', className].filter(Boolean).join(' ')}>
        <button aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)} type="button">
          {header}
        </button>
        {!collapsed && <div className="collapsible__content">{children}</div>}
      </div>
    )
  },
  Tabs: ({ tabs, value, onChange, className }: AnyProps) => (
    <div className={['tabs', className].filter(Boolean).join(' ')} role="tablist">
      {tabs.map((tab: AnyProps) => (
        <button aria-selected={tab.value === value} key={tab.value} onClick={() => onChange(tab.value)} role="tab" type="button">
          {tab.label}
        </button>
      ))}
    </div>
  ),
  Tooltip: ({ children, show }: AnyProps) => (show === false ? null : <span role="tooltip">{children}</span>),
  Gutter: passthrough('div', 'gutter'),
  NavGroup: ({ children, label }: AnyProps) => (
    <div className="nav-group">
      <span>{label}</span>
      {children}
    </div>
  ),
  Link: ({ children, href, className, ...rest }: AnyProps) => {
    const aria = Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('aria-')))
    return (
      <a className={className} href={href} {...aria}>
        {children}
      </a>
    )
  },
  Drawer: ({ children, title, slug }: AnyProps) => (
    <div className="drawer" data-slug={slug} role="dialog">
      {title ? <h2>{title}</h2> : null}
      {children}
    </div>
  ),
  DrawerToggler: ({ children, slug, className, ...rest }: AnyProps) => {
    const aria = Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('aria-')))
    return (
      <button className={className} data-slug={slug} type="button" {...aria}>
        {children}
      </button>
    )
  },
  Modal: ({ children, slug, className }: AnyProps) => (
    <div className={className} data-slug={slug} role="dialog">
      {children}
    </div>
  ),
  ConfirmationModal: ({ heading, body, onConfirm, confirmLabel = 'Confirm', cancelLabel = 'Cancel', modalSlug }: AnyProps) => (
    <div data-slug={modalSlug} role="dialog">
      <h2>{heading}</h2>
      <div>{body}</div>
      <button onClick={() => onConfirm?.()} type="button">
        {confirmLabel}
      </button>
      <button type="button">{cancelLabel}</button>
    </div>
  ),
  Popup: ({ children, button, render }: AnyProps) => (
    <div className="popup">
      {button}
      {typeof render === 'function' ? render({ close: () => {} }) : children}
    </div>
  ),
  PopupList: {
    ButtonGroup: passthrough('div', 'popup-button-list'),
    Button: ({ children, onClick, ...rest }: AnyProps) => {
      const aria = Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('aria-')))
      return (
        <button onClick={onClick} type="button" {...aria}>
          {children}
        </button>
      )
    },
    Divider: () => <hr />,
  },
  ShimmerEffect: () => <div aria-hidden="true" className="shimmer-effect" />,
  LoadingOverlay: ({ loadingText }: AnyProps) => <div role="status">{loadingText ?? 'Loading...'}</div>,
  CopyToClipboard: ({ value }: AnyProps) => (
    <button aria-label="Copy" data-value={value} type="button">
      Copy
    </button>
  ),
  Chip: passthrough('span', 'chip'),
  CheckIcon: Icon,
  ChevronIcon: Icon,
  EditIcon: Icon,
  ErrorIcon: Icon,
  InfoIcon: Icon,
  LinkIcon: Icon,
  NewTabIcon: Icon,
  PlusIcon: Icon,
  RefreshIcon: Icon,
  SearchIcon: Icon,
  SuccessIcon: Icon,
  TrashIcon: Icon,
  WarningIcon: Icon,
  WarningTriangleIcon: Icon,
  XIcon: Icon,
  CopyIcon: Icon,
  EyeIcon: Icon,
  MoreIcon: Icon,
  ArrowIcon: Icon,
  CalendarIcon: Icon,
  ClipboardIcon: Icon,
  ClockIcon: Icon,
  CircledXIcon: Icon,
  DocumentIcon: Icon,
  FilterIcon: Icon,
  GearIcon: Icon,
  SortDownIcon: Icon,
  SortUpIcon: Icon,
  ThreeDotsIcon: Icon,
  WriteIcon: Icon,
  useModal: useModalStub,
  // Payload's Dialog family: DialogModal is a Modal with a focus trap, a heading that takes
  // focus and an Escape that closes it (unless `closeOnEsc` is false). The stub keeps the
  // semantics a test can see: it only renders while open, and Escape and the header's close
  // button behave like the real ones.
  DialogModal: function DialogModalStub({ children, slug, closeOnEsc = true, focusTrapOptions }: AnyProps) {
    const { modalState, closeModal } = useModalStub()
    const isOpen = Boolean(modalState[slug]?.isOpen)
    const ref = React.useRef<HTMLDivElement>(null)
    React.useEffect(() => {
      if (!isOpen) return
      // Like focus-trap: remember the opener, hand focus back to it (or to what
      // `focusTrapOptions.setReturnFocus` picks) once the dialog closes.
      const opener = document.activeElement as HTMLElement | null
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        if (closeOnEsc) closeModal(slug)
        else event.stopImmediatePropagation()
      }
      document.addEventListener('keydown', onKeyDown, true)
      ref.current?.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6')?.focus()
      return () => {
        document.removeEventListener('keydown', onKeyDown, true)
        const target = focusTrapOptions?.setReturnFocus ? focusTrapOptions.setReturnFocus(opener) : opener
        if (target) (target as HTMLElement).focus()
      }
    }, [isOpen, closeOnEsc, closeModal, slug, focusTrapOptions])
    if (!isOpen) return null
    return (
      <DialogContext.Provider value={{ slug }}>
        <div aria-modal="true" ref={ref} role="dialog">
          {children}
        </div>
      </DialogContext.Provider>
    )
  },
  DialogHeader: function DialogHeaderStub({ title, showClose, onClose }: AnyProps) {
    const ctx = React.useContext(DialogContext)
    const { closeModal } = useModalStub()
    return (
      <div>
        {title ? <h4 tabIndex={-1}>{title}</h4> : null}
        {showClose ? (
          <button aria-label="Close" onClick={() => (onClose ? onClose({ modalSlug: ctx?.slug }) : closeModal(ctx!.slug))} type="button" />
        ) : null}
      </div>
    )
  },
  DialogBody: passthrough('div', 'dialog__body'),
  DialogFooter: passthrough('div', 'dialog__footer'),
  toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {}, warning: () => {} }),
  usePathname: () => '/admin',
}
