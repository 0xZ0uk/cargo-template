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

export const payloadUiStub = {
  useConfig: () => ({
    config: {
      routes: { api: "/api", admin: "/admin" },
      collections: [{ slug: "pages" }, { slug: "media" }],
      globals: [{ slug: "header" }],
    },
  }),
  usePathname: () => "/admin/assistant",
  useModal: () => ({ openModal: () => {}, closeModal: () => {}, modalState: {} }),
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
    ...rest
  }: AnyProps) => (
    <button
      className={["btn", buttonStyle && `btn--style-${buttonStyle}`, className].filter(Boolean).join(" ")}
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
  ConfirmationModal: ({ heading, body, onConfirm, confirmLabel = "Confirm", modalSlug }: AnyProps) => (
    <div data-slug={modalSlug} role="dialog">
      <h2>{heading}</h2>
      <div>{body}</div>
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
