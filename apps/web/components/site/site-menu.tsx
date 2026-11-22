"use client";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useEffect, useRef, useState } from "react";
import type { SiteCopy } from "@/lib/site/copy";
import { HEADER_LINKS, href } from "@/lib/site/nav";
import { Brand } from "./brand";
import { CloseGlyph, MenuGlyph } from "./icons";

// The small-screen menu: a full-screen modal dialog. The browser keeps focus inside it and
// closes it on Escape; while it is open the page behind it does not scroll, and focus goes back
// to the menu button when it closes.
export function SiteMenu({ copy }: { copy: SiteCopy }) {
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
        icon={<Icon icon={MenuGlyph} size="sm" color="inherit" />}
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
              icon={<Icon icon={CloseGlyph} size="sm" color="inherit" />}
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
              <Link
                key={name}
                href={href(name)}
                color="inherit"
                className="site-menu__link"
                onClick={hide}
              >
                <Text
                  type="code"
                  color="secondary"
                  className="site-menu__index"
                >
                  {String(i + 1).padStart(2, "0")}
                </Text>
                <Text className="site-menu__label" color="inherit">
                  {copy.nav[name]}
                </Text>
              </Link>
            ))}
          </VStack>
          <VStack gap={2} className="site-menu__actions">
            <Button
              label={copy.nav.signIn}
              href={href("signIn")}
              variant="secondary"
              size="lg"
            />
            <Button
              label={copy.nav.start}
              href={href("start")}
              variant="primary"
              size="lg"
            />
          </VStack>
        </VStack>
      </dialog>
    </>
  );
}
