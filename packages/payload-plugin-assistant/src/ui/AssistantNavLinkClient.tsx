"use client";

import { Link, NavGroup, useConfig, usePathname } from "@payloadcms/ui";
import { formatAdminURL } from "payload/shared";
import React from "react";
import { VIEW_PATH } from "../constants";

/**
 * The sidebar entry, in Payload's own nav markup (a `NavGroup` like Collections and Globals).
 * Rendered only by the server `AssistantNavLink`, after `access` admitted the user.
 */
function AssistantNavLinkInner() {
  const pathname = usePathname() ?? "";
  const {
    config: {
      routes: { admin: adminRoute },
    },
  } = useConfig();
  const href = formatAdminURL({ adminRoute, path: VIEW_PATH });
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <NavGroup label="Assistant">
      <div className="nav__link-wrapper">
        <Link
          aria-current={active ? "page" : undefined}
          className={`nav__link${active ? " nav__link--selected" : ""}`}
          href={href}
          prefetch={false}
        >
          <span className="nav__link-label">Chat</span>
        </Link>
      </div>
    </NavGroup>
  );
}

/**
 * Payload mounts nav components on every admin page: a render error here must not take the whole
 * admin shell down with it. The link disappears instead.
 */
class NavLinkBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error("[assistant] nav link failed to render", error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function AssistantNavLinkClient() {
  return (
    <NavLinkBoundary>
      <AssistantNavLinkInner />
    </NavLinkBoundary>
  );
}
