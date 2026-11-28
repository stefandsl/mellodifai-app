"use client";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { useEffect, useRef, useState } from "react";
import type { SiteCopy } from "@/lib/site/copy";
import { HEADER_LINKS, href } from "@/lib/site/nav";
import {
  SiteButtonLink,
  SiteIcon,
  SiteLink,
  SiteText,
} from "@/src/site-primitives";
import { Brand } from "./brand";
import { CloseGlyph, MenuGlyph } from "./icons";
import type { SiteHeaderPrimaryAction } from "./site-header";

// The small-screen menu: a full-screen modal dialog. The browser keeps focus inside it and
// closes it on Escape; while it is open the page behind it does not scroll, and focus goes back
// to the menu button when it closes.
export function SiteMenu({
  copy,
  primaryAction,
}: {
  copy: SiteCopy;
  primaryAction?: SiteHeaderPrimaryAction;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("site-menu-open", open);
    return () => root.classList.remove("site-menu-open");
  }, [open]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    const onClose = () => {
      setOpen(false);
      opener.current?.focus();
    };
    d.addEventListener("close", onClose);
    // Wider than the menu breakpoint: the menu has no place, so it closes.
    const wide = window.matchMedia("(min-width: 48em)");
    const onWide = () => {
      if (wide.matches && d.open) d.close();
    };
    wide.addEventListener("change", onWide);
    return () => {
      d.removeEventListener("close", onClose);
      wide.removeEventListener("change", onWide);
    };
  }, []);

  const show = () => {
    dialog.current?.showModal();
    setOpen(true);
  };
  const hide = () => dialog.current?.close();

  return (
    <>
      <Button
        ref={opener}
        label={copy.menu.open}
        isIconOnly
        icon={<SiteIcon icon={MenuGlyph} size="sm" color="inherit" />}
        variant="secondary"
        size="sm"
        className="site-menu__open"
        onClick={show}
        aria-haspopup="dialog"
        aria-expanded={open}
      />
      <dialog ref={dialog} className="site-menu" aria-label={copy.menu.label}>
        <VStack className="site-menu__panel" gap={8}>
          <HStack className="site-menu__bar" justify="between" align="center">
            <Brand label={copy.brandHome} />
            <Button
              label={copy.menu.close}
              isIconOnly
              icon={<SiteIcon icon={CloseGlyph} size="sm" color="inherit" />}
              variant="secondary"
              size="sm"
              onClick={hide}
            />
          </HStack>
          <VStack
            as="nav"
            aria-label={copy.menu.label}
            className="site-menu__list"
          >
            {HEADER_LINKS.map((name, i) => (
              <SiteLink
                key={name}
                href={href(name)}
                color="inherit"
                className="site-menu__link"
                onClick={hide}
              >
                <SiteText
                  type="code"
                  color="secondary"
                  className="site-menu__index"
                >
                  {String(i + 1).padStart(2, "0")}
                </SiteText>
                <SiteText className="site-menu__label" color="inherit">
                  {copy.nav[name]}
                </SiteText>
              </SiteLink>
            ))}
          </VStack>
          <VStack gap={2} className="site-menu__actions">
            <SiteButtonLink
              label={copy.nav.signIn}
              href={href("signIn")}
              variant="secondary"
              size="lg"
            />
            <SiteButtonLink
              label={primaryAction?.label ?? copy.nav.start}
              href={primaryAction?.href ?? href("start")}
              rel={primaryAction?.external ? "noopener noreferrer" : undefined}
              icon={primaryAction?.icon}
              variant="primary"
              size="lg"
              data-desktop-download-cta={
                primaryAction?.isDesktopDownload ? "true" : undefined
              }
              data-detected-platform={primaryAction?.platform}
              data-platform-status={primaryAction?.status}
            />
          </VStack>
        </VStack>
      </dialog>
    </>
  );
}
