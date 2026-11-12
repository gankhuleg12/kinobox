import { env } from '../../../config/env.js';
import { AppError } from '../../../lib/errors.js';
import { settings } from '../../settings/settings.service.js';
import { wireProvider } from './wire.provider.js';
import { mockProvider } from './mock.provider.js';
import type { PaymentProvider } from './provider.js';

const registry: Record<string, PaymentProvider> = {
  wire: wireProvider,
  mock: mockProvider,
};

export function providerByName(name: string): PaymentProvider {
  if (name === 'mock' && env.isProd) throw AppError.forbidden('Mock провайдер production-д хориотой');
  const p = registry[name];
  if (!p) throw AppError.badRequest(`Тодорхойгүй төлбөрийн провайдер: ${name}`);
  return p;
}

export async function activeProvider(): Promise<PaymentProvider> {
  return providerByName(await settings.get('payment.provider'));
}

export type { PaymentProvider } from './provider.js';
