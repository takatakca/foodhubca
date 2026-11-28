import type { FoodHubJob } from './types';

export const UBER_POLL_MISMATCH_REASON = 'Uber polled order details do not match the listed order and store';
export const UBER_REVIEW_PAGE_SIZE = 5;

export type UberReviewNotice = {
  id: string;
  createdAt: string;
  reason: 'order_store_mismatch';
  orderRef: string | null;
  storeRef: string | null;
};

export type UberReviewPage = { offset: number; hasMore: boolean; notices: UberReviewNotice[] };

export function isUberPollReviewNotice(job: FoodHubJob): boolean {
  return job.channel === 'uber_eats' && job.kind === 'webhook_unparsed'
    && job.request?.replayable === false && job.result?.reason === UBER_POLL_MISMATCH_REASON;
}
