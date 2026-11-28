import { getRepo, type Doc } from '../repo';
import type { Device } from './devices';

export const PRINT_LISTENER_OBSERVATIONS = 'device_print_listener';
const LOOKUP_BATCH_SIZE = 100;
const OPTIONAL_LOOKUP_TIMEOUT_MS = 2_000;

type Enrollment = Pick<Device, 'id' | 'locationCode' | 'enrolledAt'>;
type PrintListenerObservation = Omit<Enrollment, 'id'> & { observedAt: string };

/** This app report lives separately from the screen heartbeat and cannot change online status. */
export async function recordPrintListenerObservation(device: Enrollment): Promise<string> {
  const observedAt = new Date().toISOString();
  const data = { locationCode: device.locationCode, enrolledAt: device.enrolledAt, observedAt };
  await getRepo().putDocs(PRINT_LISTENER_OBSERVATIONS, [{ id: device.id, key: device.id, at: observedAt, data }]);
  return observedAt;
}

export async function listPrintListenerObservations(devices: Enrollment[]): Promise<Map<string, string>> {
  const scoped = new Map(devices.map((device) => [device.id, device]));
  const ids = [...scoped.keys()];
  if (!ids.length) return new Map();
  const repo = getRepo();
  const batches: Array<Promise<Doc<PrintListenerObservation>[]>> = [];
  for (let start = 0; start < ids.length; start += LOOKUP_BATCH_SIZE) {
    const keys = ids.slice(start, start + LOOKUP_BATCH_SIZE);
    batches.push(repo.listDocs<PrintListenerObservation>(PRINT_LISTENER_OBSERVATIONS, { keys, limit: keys.length }).catch(() => []));
  }

  // A slow optional read must not block the original screen status.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Doc<PrintListenerObservation>[][]>(resolve => {
    timeout = setTimeout(() => resolve([]), OPTIONAL_LOOKUP_TIMEOUT_MS);
  });
  const rows = (await Promise.race([Promise.all(batches), deadline]).finally(() => clearTimeout(timeout))).flat();
  const observed = new Map<string, string>();
  const now = Date.now();
  for (const { id, data } of rows) {
    const device = scoped.get(id);
    const observedAt = data?.observedAt;
    if (!device || typeof observedAt !== 'string' || data.locationCode !== device.locationCode || data.enrolledAt !== device.enrolledAt) continue;

    const at = Date.parse(observedAt);
    const enrolled = Date.parse(device.enrolledAt);
    if (!Number.isFinite(at) || !Number.isFinite(enrolled) || at < enrolled || at > now || new Date(at).toISOString() !== observedAt) continue;
    observed.set(id, observedAt);
  }
  return observed;
}
