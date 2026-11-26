import { describe, expect, it } from 'vitest';
import { goLiveProgress, uberDirectStep } from '@/app/(console)/settings/go-live/steps';

const fr = (french: string) => french;
const en = (_french: string, english: string) => english;

describe('direct Uber readiness in the go-live checklist', () => {
  it('leaves an unverified provider route as an action item', () => {
    const step = uberDirectStep('Uber Eats', null, fr);
    expect(step).toMatchObject({ state: 'todo', href: '/stores/mapping', cta: 'Vérifier chez Uber' });
    expect(goLiveProgress([step])).toMatchObject({ complete: false, todo: 1 });
  });

  it('shows how many mappings have provider evidence and keeps partial setup open', () => {
    const step = uberDirectStep('Uber Eats', { confirmed: 1, mapped: 2 }, en);
    expect(step.state).toBe('todo');
    expect(step.body).toContain('1 of 2');
    expect(step.body).toContain('Check the remaining mappings with Uber.');
  });

  it('reports the saved configuration separately from kitchen receipt', () => {
    const step = uberDirectStep('Uber Eats', { confirmed: 2, mapped: 2 }, fr);
    expect(step.state).toBe('done');
    expect(step.body).toContain('2 liaison(s) sur 2');
    expect(step.body).toContain('Vérifiez la réception en cuisine avec une commande d’essai.');
  });
});
