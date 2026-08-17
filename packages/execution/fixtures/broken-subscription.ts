export interface Subscription {
  readonly cancelledAt?: string;
  readonly id: string;
  readonly status: "active" | "cancelled";
}

/** Deliberately broken Phase 6 acceptance fixture: status is never changed to cancelled. */
export function cancelSubscription(subscription: Subscription, now: string): Subscription {
  return { ...subscription, cancelledAt: now };
}
