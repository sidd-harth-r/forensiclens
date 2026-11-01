import { FIXTURE_EVENTS } from "@/fixtures/events";
import { ForensicEvent } from "@/types/event";

export async function getEvents(caseId?: string): Promise<ForensicEvent[]> {
  if (caseId) {
    return Promise.resolve(FIXTURE_EVENTS.filter((e) => e.caseId === caseId));
  }
  return Promise.resolve([...FIXTURE_EVENTS]);
}

export async function getEventById(eventId: string): Promise<ForensicEvent | null> {
  const found = FIXTURE_EVENTS.find((e) => e.eventId === eventId);
  return Promise.resolve(found ? { ...found } : null);
}

