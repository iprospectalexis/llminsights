import React, { useMemo, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  Ticket,
  TicketStatus,
  STATUS_LABELS,
  KANBAN_COLUMNS,
} from '../../lib/tickets';
import { TicketCard } from './TicketCard';

interface Props {
  tickets: Ticket[];
  onCardClick: (id: string) => void;
  onStatusChange: (ticketId: string, nextStatus: TicketStatus) => void;
}

const COLUMN_ACCENT: Record<TicketStatus, string> = {
  backlog: 'border-t-gray-400',
  in_work: 'border-t-blue-500',
  done: 'border-t-green-500',
  archived: 'border-t-gray-300',
};

const Column: React.FC<{
  status: TicketStatus;
  tickets: Ticket[];
  onCardClick: (id: string) => void;
}> = ({ status, tickets, onCardClick }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${status}` });
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[260px] bg-gray-50 dark:bg-gray-900/40 rounded-2xl p-3 border-t-4 ${COLUMN_ACCENT[status]} ${
        isOver ? 'ring-2 ring-brand-primary/40' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {STATUS_LABELS[status]}
        </h3>
        <span className="text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-full px-2 py-0.5">
          {tickets.length}
        </span>
      </div>
      <SortableContext
        items={tickets.map(t => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-2 min-h-[80px]">
          {tickets.map(t => (
            <TicketCard key={t.id} ticket={t} onClick={onCardClick} />
          ))}
          {tickets.length === 0 && (
            <div className="text-xs text-gray-400 dark:text-gray-500 text-center py-6 italic">
              No tickets
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
};

export const TicketKanban: React.FC<Props> = ({ tickets, onCardClick, onStatusChange }) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const out: Record<TicketStatus, Ticket[]> = {
      backlog: [],
      in_work: [],
      done: [],
      archived: [],
    };
    for (const t of tickets) out[t.status]?.push(t);
    return out;
  }, [tickets]);

  const activeTicket = activeId ? tickets.find(t => t.id === activeId) || null : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const ticketId = String(active.id);
    const overId = String(over.id);

    let nextStatus: TicketStatus | null = null;
    if (overId.startsWith('col-')) {
      nextStatus = overId.slice(4) as TicketStatus;
    } else {
      // Dropped on another card → use that card's status
      const target = tickets.find(t => t.id === overId);
      if (target) nextStatus = target.status;
    }
    if (!nextStatus) return;
    const moved = tickets.find(t => t.id === ticketId);
    if (!moved || moved.status === nextStatus) return;
    onStatusChange(ticketId, nextStatus);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-2">
        {KANBAN_COLUMNS.map(col => (
          <Column
            key={col}
            status={col}
            tickets={grouped[col] || []}
            onCardClick={onCardClick}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTicket ? (
          <div className="rotate-2">
            <TicketCard ticket={activeTicket} onClick={() => undefined} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
