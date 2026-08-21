import { resolveNetwork, isMainnet, networkPassphraseFor } from '../utils/network';
import { Networks } from '@stellar/stellar-sdk';

describe('resolveNetwork', () => {
  it.each(['mainnet', 'public', 'pubnet', 'publicnet', 'main'])(
    'treats %p as the live network',
    (value) => {
      expect(resolveNetwork(value)).toBe('mainnet');
      expect(isMainnet(value)).toBe(true);
      expect(networkPassphraseFor(value)).toBe(Networks.PUBLIC);
    }
  );

  it.each(['testnet', 'TESTNET', 'test'])('treats %p as testnet', (value) => {
    expect(networkPassphraseFor(value)).toBe(Networks.TESTNET);
  });

  it('is case- and whitespace-insensitive', () => {
    // The regression: `NEXT_PUBLIC_STELLAR_NETWORK=public` matched no
    // comparison against the literal 'mainnet', so a mainnet deployment
    // signed with the testnet passphrase.
    expect(resolveNetwork('  PUBLIC  ')).toBe('mainnet');
    expect(resolveNetwork('MainNet')).toBe('mainnet');
  });

  it('falls back to testnet for unset or unrecognized values', () => {
    expect(resolveNetwork(undefined)).toBe('testnet');
    expect(resolveNetwork('')).toBe('testnet');
    expect(resolveNetwork('futurenet')).toBe('testnet');
  });

  it('never returns undefined as a passphrase', () => {
    // NETWORKS[network] used to hand undefined straight to TransactionBuilder.
    for (const value of [undefined, '', 'nonsense', 'public', 'testnet']) {
      expect(typeof networkPassphraseFor(value)).toBe('string');
    }
  });
});
