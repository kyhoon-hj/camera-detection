from __future__ import annotations

import asyncio
import queue
import threading
from collections import deque

from suha_core.domain import EventEnvelope

from .store import EventStore


class EventBus:
    def __init__(self, buffer_size: int = 1000, store: EventStore | None = None) -> None:
        self.history: deque[EventEnvelope] = deque(maxlen=buffer_size)
        self.store = store
        self._subscribers: set[asyncio.Queue[EventEnvelope]] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._persistence_queue: queue.Queue[EventEnvelope] = queue.Queue(maxsize=buffer_size)
        self._persistence_stop = threading.Event()
        self._persistence_thread: threading.Thread | None = None
        if store is not None:
            self._persistence_thread = threading.Thread(
                target=self._persist,
                name="event-store",
                daemon=True,
            )
            self._persistence_thread.start()

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def publish(self, event: EventEnvelope) -> None:
        self.history.append(event)
        if self.store is not None:
            if self._persistence_queue.full():
                try:
                    self._persistence_queue.get_nowait()
                    self._persistence_queue.task_done()
                except queue.Empty:
                    pass
            self._persistence_queue.put_nowait(event)
        if self._loop and self._loop.is_running():
            for subscriber_queue in tuple(self._subscribers):
                self._loop.call_soon_threadsafe(self._offer, subscriber_queue, event)

    @staticmethod
    def _offer(queue: asyncio.Queue[EventEnvelope], event: EventEnvelope) -> None:
        if queue.full():
            queue.get_nowait()
        queue.put_nowait(event)

    def subscribe(self, size: int = 100) -> asyncio.Queue[EventEnvelope]:
        queue: asyncio.Queue[EventEnvelope] = asyncio.Queue(maxsize=size)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[EventEnvelope]) -> None:
        self._subscribers.discard(queue)

    def close(self) -> None:
        self._persistence_stop.set()
        if self._persistence_thread is not None:
            self._persistence_thread.join(timeout=3.0)

    def _persist(self) -> None:
        while not self._persistence_stop.is_set() or not self._persistence_queue.empty():
            try:
                event = self._persistence_queue.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                if self.store is not None:
                    self.store.append(event)
            finally:
                self._persistence_queue.task_done()
