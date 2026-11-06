/**
 * Minimal stand-ins for the `@payloadcms/ui` components the chat renders, for jsdom tests (the
 * real package imports CSS jsdom can't parse and needs the admin's providers). They keep what
 * tests assert on: real buttons, aria attributes, text, collapsed state. Same idea as
 * `packages/payload-seo-analyzer/src/__tests__/helpers/payloadUiStub.tsx`.
 */
import React from "react";

type AnyProps = Record<string, any> & { children?: React.ReactNode };

const aria = (props: AnyProps) => Object.fromEntries(Object.entries(props).filter(([k]) => k.startsWith("aria-")));
const Icon = () => <svg aria-hidden="true" />;

/**
 * What the edit-view hooks return (#69), set per test: the document, the form and the modals.
 * `calls` records what the components did with them.
 */
export const uiState = {
  documentInfo: { id: undefined as string | number | undefined, setData: (_doc: unknown) => {} },
  title: "Home",
  /** The edit depth: 0 in a page, 1 in a document drawer, 2 in one nested in it. */
  depth: 0,
  modified: false,
  reset: async (_data: unknown) => {},
  calls: { openModal: [] as string[], closeModal: [] as string[], toasts: [] as string[] },
};

export const payloadUiStub = {
  useConfig: () => ({
    config: {
      routes: { api: "/api", admin: "/admin" },
      collections: [{ slug: "pages" }, { slug: "media" }],
      globals: [{ slug: "header" }],
    },
  }),
  usePathname: () => "/admin/assistant",
  useModal: () => ({
    openModal: (slug: string) => uiState.calls.openModal.push(slug),
    closeModal: (slug: string) => uiState.calls.closeModal.push(slug),
    modalState: {},
  }),
  useDocumentInfo: () => uiState.documentInfo,
  useDocumentTitle: () => ({ title: uiState.title }),
  useEditDepth: () => uiState.depth,
  useForm: () => ({ reset: (data: unknown) => uiState.reset(data) }),
  useFormModified: () => uiState.modified,
  useLocale: () => ({ code: "en" }),
  toast: {
    success: (message: string) => uiState.calls.toasts.push(`success: ${message}`),
    error: (message: string) => uiState.calls.toasts.push(`error: ${message}`),
  },
  Drawer: ({ children, slug, title, headerActions = [] }: AnyProps) => (
    <div data-drawer={slug} role="dialog" aria-label={title}>
      {headerActions.map((action: { label: string; onClick: () => void }) => (
        <button key={action.label} onClick={action.onClick} type="button">
          {action.label}
        </button>
      ))}
      {children}
    </div>
  ),
  XIcon: Icon,
  Banner: ({ children, type = "default", className }: AnyProps) => (
    <div className={["banner", `banner--type-${type}`, className].filter(Boolean).join(" ")} role="status">
      {children}
    </div>
  ),
  Button: ({
    children,
    onClick,
    disabled,
    type = "button",
    buttonStyle,
    className,
    tooltip,
    icon,
    extraButtonProps,
    ...rest
  }: AnyProps) => (
    <button
      className={["btn", buttonStyle && `btn--style-${buttonStyle}`, className].filter(Boolean).join(" ")}
      data-testid={extraButtonProps?.["data-testid"]}
      disabled={disabled}
      onClick={onClick}
      title={tooltip}
      type={type}
      {...aria(rest)}
    >
      {icon}
      {children}
    </button>
  ),
  Pill: ({ children, pillStyle = "light" }: AnyProps) => (
    <span className={`pill pill--style-${pillStyle}`}>{children}</span>
  ),
  Collapsible: ({ children, header, initCollapsed, className }: AnyProps) => {
    const [collapsed, setCollapsed] = React.useState(Boolean(initCollapsed));
    return (
      <div className={["collapsible", className].filter(Boolean).join(" ")}>
        <button aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)} type="button">
          {header}
        </button>
        {!collapsed && <div className="collapsible__content">{children}</div>}
      </div>
    );
  },
  Link: ({ children, href, className, title, ...rest }: AnyProps) => (
    <a className={className} data-payload-link="" href={href} title={title} {...aria(rest)}>
      {children}
    </a>
  ),
  NavGroup: ({ children, label }: AnyProps) => (
    <div className="nav-group">
      <span>{label}</span>
      {children}
    </div>
  ),
  ConfirmationModal: ({ heading, body, onConfirm, onCancel, confirmLabel = "Confirm", cancelLabel = "Cancel", modalSlug }: AnyProps) => (
    <div data-slug={modalSlug} role="dialog">
      <h2>{heading}</h2>
      <div>{body}</div>
      <button onClick={() => onCancel?.()} type="button">
        {cancelLabel}
      </button>
      <button onClick={() => onConfirm?.()} type="button">
        {confirmLabel}
      </button>
    </div>
  ),
  ShimmerEffect: () => <div aria-hidden="true" className="shimmer-effect" />,
  EditIcon: Icon,
  PlusIcon: Icon,
  TrashIcon: Icon,
};
