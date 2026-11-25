"use client";

import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Kbd } from "@astryxdesign/core/Kbd";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { useEffect, useRef } from "react";
import { CloseGlyph, SearchGlyph } from "./icons";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

// Search field for the recipes index (canvas and grid).
// Shortcut: `/` (and Ctrl/Cmd+K) focuses the field; Ctrl+F / Cmd+F is intentionally never taken
// so the browser's native find-in-page stays untouched (D10). Escape clears and blurs.
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  clearLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  placeholder: string;
  clearLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;

      const isSlash =
        event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey;
      const isModK =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k";

      if (isSlash || isModK) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <VStack className="site-recipes-search" data-canvas-ui="true">
      <TextInput
        ref={inputRef}
        type="search"
        label={label}
        isLabelHidden
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        startIcon={<Icon icon={SearchGlyph} size="sm" color="secondary" />}
        enterKeyHint="search"
        autoComplete="off"
        size="lg"
        width="100%"
        containerClassName="site-recipes-search__field"
        controlClassName="site-recipes-search__input"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (value) onChange("");
            inputRef.current?.blur();
          }
        }}
      />
      <HStack className="site-recipes-search__end" align="center">
        {value ? (
          <IconButton
            label={clearLabel}
            icon={<Icon icon={CloseGlyph} size="sm" color="inherit" />}
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
          />
        ) : (
          <Kbd keys="/" className="site-recipes-search__kbd" />
        )}
      </HStack>
    </VStack>
  );
}
