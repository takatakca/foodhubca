import { describe, expect, it } from 'vitest';
import { incidentStepText, orderNumber, plural, plurals } from '@/components/live/words';

describe('A1 wording helpers', () => {
  it('writes proper plurals in French and English, never "(s)"', () => {
    expect(plural('fr', 0, 'commande')).toBe('0 commande');
    expect(plural('fr', 1, 'commande')).toBe('1 commande');
    expect(plural('fr', 2, 'commande')).toBe('2 commandes');
    expect(plural('en', 0, 'order')).toBe('0 orders');
    expect(plural('en', 1, 'order')).toBe('1 order');
    expect(plural('fr', 3, 'planifiée')).toBe('3 planifiées');
    expect(plural('fr', 2, 'nouvel article', 'nouveaux articles')).toBe('2 nouveaux articles');
    expect(plurals(5, ['tablette'], ['tablet'])).toEqual(['5 tablettes', '5 tablets']);
    expect(plural('fr', 1234, 'commande').replace(/\s/g, ' ')).toBe('1 234 commandes');
  });

  it('shows a readable order number, without a trailing hyphen', () => {
    expect(orderNumber({ displayId: 'A1B2C', externalOrderId: 'x' })).toBe('A1B2C');
    expect(orderNumber({ displayId: '', externalOrderId: 'dd-demo-12' })).toBe('dd-demo-12');
    expect(orderNumber({ displayId: null, externalOrderId: 'dd-demo-1234567' })).toBe('dd-demo');
    expect(orderNumber({ externalOrderId: '6f1c2a9e-1111-2222-3333-444455556666' })).toBe('6f1c2a9e');
  });

  it('translates the incident timeline so the French screen shows no English', () => {
    expect(incidentStepText('fr', 'Aucun gérant de garde avec un cellulaire. / No manager on duty with a phone.')).toBe('Aucun gérant de garde avec un cellulaire.');
    expect(incidentStepText('en', 'Aucun gérant de garde avec un cellulaire. / No manager on duty with a phone.')).toBe('No manager on duty with a phone.');
    expect(incidentStepText('fr', 'Sent')).toBe('Envoyé');
    expect(incidentStepText('fr', 'Calling')).toBe('Appel lancé');
    const sms = incidentStepText('fr', 'SMS is not set up (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).');
    expect(sms).toContain('Réglages');
    expect(sms).not.toMatch(/TWILIO|SID/);
    expect(incidentStepText('en', 'Phone calls are not set up (Twilio + TWILIO_FROM).')).not.toContain('TWILIO_FROM');
    expect(incidentStepText('fr', 'Network error: fetch failed')).toBe('Erreur réseau : fetch failed');
    expect(incidentStepText('fr', 'Twilio HTTP 401: Authenticate')).toBe('Le service de textos et d’appels a répondu par une erreur (401).');
    expect(incidentStepText('fr', 'Chat webhook HTTP 500')).toContain('clavardage');
    expect(incidentStepText('fr', 'Something else')).toBe('Something else');
  });
});
