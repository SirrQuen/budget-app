"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import {
  labelOf,
  sectionsInRegion,
  sizeOf,
  type DashboardCardSize,
  type DashboardRegion,
  type DashboardSectionId,
} from "@/lib/dashboardLayout";
import { useDashboardLayout } from "./DashboardLayoutProvider";
import { useReducedMotion } from "@/components/ui/useReducedMotion";
import { tick } from "@/lib/haptics";

// One region of the dashboard as a sortable list of cards. ORDER, not free
// placement: a card lands where it's dropped in the sequence, and a two-
// column grid just flows that sequence across. Each card is dragged by its
// grip only -- never the card -- so a finger scrolling the page, or tapping
// a figure to open its rows, can't move one. Touch needs a long press on
// the grip. The card menu (Move earlier / Move later / Hide) does everything a
// drag does, without dragging.
//
// Collision: the card under the pointer wins. Overlap alone picked the wrong
// card once sizes differed -- a wide card dragged onto a small one overlaps
// whatever is beside and below it more than the one it was dropped on. A
// keyboard drag has no pointer, so it falls back to overlap.
//
// The Safe to Spend hero isn't in here: it's pinned above, so there is
// nothing to drop above it.

type Item = { id: DashboardSectionId; node: React.ReactNode };

// Column spans per fixed card size (lib/dashboardLayout.ts): four columns on
// a desktop (xl, 1280px: below that four columns would squeeze a small tile
// under ~200px), two on a tablet, one on a phone. Written out in full so
// Tailwind sees every class.
const SPAN: Record<DashboardCardSize, string> = {
  small: "md:col-span-1 xl:col-span-1",
  wide: "md:col-span-2 xl:col-span-2",
  full: "md:col-span-2 xl:col-span-4",
};

const collision: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : rectIntersection(args);
};

export function DashboardSections({
  region,
  items,
}: {
  region: DashboardRegion;
  items: Item[];
}) {
  const { layout, reorder, step, hide } = useDashboardLayout();
  const reducedMotion = useReducedMotion();
  const dndId = useId();
  // Where the dragged card will land: the slot of the card it is over,
  // relative to the grid (docs/Motion-and-Delight.md, step 6). A dashed
  // gold outline, in every motion setting.
  const gridRef = useRef<HTMLDivElement>(null);
  const [landing, setLanding] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const present = new Map(items.map((item) => [item.id, item.node]));
  const hidden = new Set(layout.hidden);
  const visible = sectionsInRegion(layout.order, region).filter(
    (id) => present.has(id) && !hidden.has(id),
  );

  // Where focus goes once a change has rendered: the card's own menu after
  // a move; the "Show" button that appears in the footer after a hide.
  const refocus = useRef<string | null>(null);
  const signature = visible.join(",");
  useEffect(() => {
    if (refocus.current) {
      document.getElementById(refocus.current)?.focus();
      refocus.current = null;
    }
  }, [signature]);

  const sensors = useSensors(
    // Mouse: a few pixels of travel, so a click on the grip isn't a drag.
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // Touch: a long press on the grip. A swipe that starts there scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const position = (id: string | number | undefined) => {
    const at = visible.indexOf(id as DashboardSectionId);
    return at < 0 ? "" : `position ${at + 1} of ${visible.length}`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${labelOf(active.id as DashboardSectionId)}, ${position(active.id)}. Use the arrow keys to move it, space to drop, escape to cancel.`,
    onDragOver: ({ active, over }) =>
      over ? `${labelOf(active.id as DashboardSectionId)} is over ${position(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      `${labelOf(active.id as DashboardSectionId)} dropped${over ? ` at ${position(over.id)}` : ""}.`,
    onDragCancel: ({ active }) =>
      `Move cancelled. ${labelOf(active.id as DashboardSectionId)} is back at ${position(active.id)}.`,
  };

  function showLanding(over: DragOverEvent["over"]) {
    const grid = gridRef.current?.getBoundingClientRect();
    if (!over || !grid) {
      setLanding(null);
      return;
    }
    setLanding({
      x: over.rect.left - grid.left,
      y: over.rect.top - grid.top,
      width: over.rect.width,
      height: over.rect.height,
    });
  }

  function onDragStart() {
    tick();
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setLanding(null);
    tick();
    if (!over || active.id === over.id) {
      return;
    }
    const from = visible.indexOf(active.id as DashboardSectionId);
    const to = visible.indexOf(over.id as DashboardSectionId);
    if (from < 0 || to < 0) {
      return;
    }
    reorder(arrayMove(visible, from, to), active.id as DashboardSectionId);
  }

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={({ over }) => showLanding(over)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setLanding(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To pick up this card, press space or enter. Use the arrow keys to move it, space to drop it, escape to cancel. The card's menu moves it without dragging.",
        },
      }}
    >
      <SortableContext items={visible} strategy={rectSortingStrategy}>
        {/* Cards flow in saved order and wrap when the next one doesn't fit.
            Deliberately NOT grid-auto-flow: dense -- that would show cards in
            a different order from the saved one, and from the order a
            keyboard or screen reader walks them. A gap beside a small tile
            is the price; dragging fills it. items-start: a card is exactly
            its own tile, never stretched to its row. */}
        <div ref={gridRef} className="relative grid grid-cols-1 items-start gap-x-4 gap-y-6 md:grid-cols-2 xl:grid-cols-4">
          {landing ? (
            <div
              aria-hidden="true"
              className="drag-landing"
              style={{
                width: landing.width,
                height: landing.height,
                transform: `translate(${landing.x}px, ${landing.y}px)`,
              }}
            />
          ) : null}
          {visible.map((id, index) => (
            <SortableCard
              key={id}
              id={id}
              index={index}
              count={visible.length}
              reducedMotion={reducedMotion}
              onStep={(by) => {
                refocus.current = `dash-menu-${id}`;
                step(visible, id, by);
              }}
              onHide={() => {
                refocus.current = `dash-show-${id}`;
                hide(id);
              }}
            >
              {present.get(id)}
            </SortableCard>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableCard({
  id,
  index,
  count,
  reducedMotion,
  onStep,
  onHide,
  children,
}: {
  id: DashboardSectionId;
  index: number;
  count: number;
  reducedMotion: boolean;
  onStep: (by: -1 | 1) => void;
  onHide: () => void;
  children: React.ReactNode;
}) {
  // The other cards slide aside over 200ms on the shared curve.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, transition: reducedMotion ? null : { duration: 200, easing: "var(--ease-out)" } });

  const label = labelOf(id);

  return (
    <div
      ref={setNodeRef}
      // A place for a link to land (the What's new card's "Coming up").
      id={`dash-card-${id}`}
      style={{
        // Translate only: the sorting strategy also offers a scale for cards
        // of different sizes, which would squash a card's content mid-drag.
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        // The lift (120ms) and the settle (180ms, a slight overshoot) ride
        // beside dnd-kit's own transform transition on the scale and rotate
        // properties, which leave its transform alone.
        transition: reducedMotion
          ? undefined
          : [
              transition,
              isDragging
                ? "scale 120ms var(--ease-out), rotate 120ms var(--ease-out)"
                : "scale 180ms var(--ease-spring), rotate 180ms var(--ease-spring)",
            ]
              .filter(Boolean)
              .join(", "),
      }}
      // The lifted card is solid, not glass (docs/Backdrop.md, rule 4).
      data-lifted={isDragging ? "" : undefined}
      className={`card-lift group relative min-w-0 scroll-mt-6 ${SPAN[sizeOf(id)]} ${
        isDragging ? (reducedMotion ? "z-20 opacity-90" : "card-lift--on z-20") : ""
      }`}
    >
      <div
        className={`absolute right-3 top-0 z-10 flex -translate-y-1/2 items-center rounded-full border border-hairline bg-surface-raised p-0.5 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover:opacity-100 ${
          isDragging ? "opacity-100" : "opacity-0"
        }`}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag ${label}`}
          className="inline-flex size-9 cursor-grab touch-none items-center justify-center rounded-full text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action active:cursor-grabbing pointer-coarse:size-11"
        >
          <GripIcon />
        </button>
        <CardMenu id={id} label={label} index={index} count={count} onStep={onStep} onHide={onHide} />
      </div>
      {/* Alone in its own wrapper: a server-rendered element sitting beside
          the controls is treated as one entry of a list and asked for a key. */}
      <div className="contents">{children}</div>
    </div>
  );
}

function CardMenu({
  id,
  label,
  index,
  count,
  onStep,
  onHide,
}: {
  id: DashboardSectionId;
  label: string;
  index: number;
  count: number;
  onStep: (by: -1 | 1) => void;
  onHide: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    items.current.find((el) => el && el.getAttribute("aria-disabled") !== "true")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const enabled = () =>
    items.current.filter((el): el is HTMLButtonElement => !!el && el.getAttribute("aria-disabled") !== "true");

  function onMenuKeyDown(event: React.KeyboardEvent) {
    const list = enabled();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      document.getElementById(`dash-menu-${id}`)?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = (at + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
      list[next]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const itemClass =
    "flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-ink hover:bg-surface focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action aria-disabled:cursor-not-allowed aria-disabled:text-ink-muted aria-disabled:hover:bg-transparent";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        id={`dash-menu-${id}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${label} menu`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-9 items-center justify-center rounded-full text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action pointer-coarse:size-11"
      >
        <DotsIcon />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={`${label} actions`}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-30 mt-1 w-44 rounded-xl border border-hairline bg-surface-raised p-1 shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            ref={(el) => {
              items.current[0] = el;
            }}
            aria-disabled={index === 0}
            onClick={index === 0 ? undefined : choose(() => onStep(-1))}
            className={itemClass}
          >
            Move earlier
          </button>
          <button
            type="button"
            role="menuitem"
            ref={(el) => {
              items.current[1] = el;
            }}
            aria-disabled={index === count - 1}
            onClick={index === count - 1 ? undefined : choose(() => onStep(1))}
            className={itemClass}
          >
            Move later
          </button>
          <button
            type="button"
            role="menuitem"
            ref={(el) => {
              items.current[2] = el;
            }}
            onClick={choose(onHide)}
            className={itemClass}
          >
            Hide
          </button>
        </div>
      ) : null}
    </div>
  );
}

function GripIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      {[4, 8, 12].flatMap((y) => [5.5, 10.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" />))}
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      {[3.5, 8, 12.5].map((x) => (
        <circle key={x} cx={x} cy="8" r="1.3" />
      ))}
    </svg>
  );
}
