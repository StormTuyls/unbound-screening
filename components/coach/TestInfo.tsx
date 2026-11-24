"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { bandText } from "@/lib/screening/bands";
import { unitLabel } from "@/lib/screening/units";

/**
 * Een info-knopje naast een testnaam, met uitleg bij aanwijzen of tikken.
 *
 * Een native popover en geen zwevende div: de browser regelt de bovenste laag,
 * Escape, en sluiten bij een tik ernaast. Dat laatste is wat een tablet in de
 * zaal nodig heeft, want daar bestaat aanwijzen niet. Met de muis opent hij al
 * bij aanwijzen; een klik houdt hem open in plaats van hem weer te sluiten.
 */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const el = tip.current;
    if (!el) return;
    // Onder de knop, of erboven als er onder geen plaats is; nooit buiten beeld.
    const place = () => {
      const b = button.current?.getBoundingClientRect();
      if (!b) return;
      const left = Math.min(
        Math.max(8, b.left + b.width / 2 - el.offsetWidth / 2),
        window.innerWidth - el.offsetWidth - 8,
      );
      const below = b.bottom + 6 + el.offsetHeight <= window.innerHeight;
      el.style.left = `${left}px`;
      el.style.top = `${below ? b.bottom + 6 : b.top - 6 - el.offsetHeight}px`;
    };
    // Een vaste positie loopt los van de knop zodra de pagina scrolt.
    const hide = () => el.hidePopover();
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") {
        place();
        window.addEventListener("scroll", hide, { capture: true, once: true });
      } else {
        window.removeEventListener("scroll", hide, { capture: true });
      }
    };
    el.addEventListener("toggle", onToggle);
    return () => {
      el.removeEventListener("toggle", onToggle);
      window.removeEventListener("scroll", hide, { capture: true });
    };
  }, []);

  const open = () => {
    window.clearTimeout(timer.current);
    if (!tip.current?.matches(":popover-open")) tip.current?.showPopover();
  };
  const close = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => tip.current?.hidePopover(), 150);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        popoverTargetAction="show"
        aria-label={label}
        onPointerEnter={(event) => event.pointerType === "mouse" && open()}
        onPointerLeave={(event) => event.pointerType === "mouse" && close()}
        className="-my-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full align-middle text-ink-muted transition-colors hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-600 active:scale-95"
      >
        <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.75" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 7.25v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
        </svg>
      </button>
      <div
        ref={tip}
        id={id}
        popover="auto"
        onPointerEnter={(event) => event.pointerType === "mouse" && open()}
        onPointerLeave={(event) => event.pointerType === "mouse" && close()}
        className="fixed inset-auto m-0 w-80 max-w-[calc(100vw-16px)] rounded-card border border-hairline bg-surface p-3.5 text-left text-xs leading-relaxed font-normal text-ink shadow-[0_8px_24px_rgba(26,29,33,0.14)]"
      >
        {children}
      </div>
    </>
  );
}

/**
 * Wat er over een test te zeggen valt: de uitleg van de praktijk, en daaronder
 * wat de data zelf weet. Die feiten staan er ook als er nog geen uitleg is.
 */
export function TestInfo({
  name,
  about,
  unit,
  direction,
  laterality,
  bands,
  protocolConfirmed,
}: {
  name: string;
  about: string | null;
  unit: string;
  direction: string;
  laterality: string;
  bands: ReadonlyArray<{ status: string; gte?: number; lt?: number }> | null;
  protocolConfirmed: boolean;
}) {
  const t = useTranslations("testInfo");
  const ts = useTranslations("screening");

  return (
    <InfoTip label={t("open", { test: name })}>
      <p className="font-semibold">{name}</p>
      <p className={`mt-1 ${about ? "" : "text-ink-muted"}`}>{about ?? t("noAbout")}</p>
      <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-hairline pt-2.5">
        <dt className="text-ink-muted">{t("measures")}</dt>
        <dd>
          {[
            unitLabel(unit, ts("handLengths")),
            t(`direction.${direction}` as "direction.neutral"),
            t(`laterality.${laterality}` as "laterality.either"),
          ].join(" · ")}
        </dd>
        <dt className="text-ink-muted">{t("bands")}</dt>
        <dd className="tabular-nums">{bands ? bandText(bands) : t("noBand")}</dd>
        {!protocolConfirmed && (
          <>
            <dt className="text-ink-muted">{t("protocol")}</dt>
            <dd>{t("protocolOpen")}</dd>
          </>
        )}
      </dl>
    </InfoTip>
  );
}
