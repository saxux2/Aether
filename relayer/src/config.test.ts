/**
 * config.ts reads process.env at import time, so each case has to set the
 * environment and then re-import the module. Values set here are also what
 * dotenv sees: dotenv.config() never overwrites a key already present on
 * process.env, so an explicit '' below wins over whatever relayer/.env holds.
 */
const LIVE_KEYS = [
  'NODE_ENV',
  'STELLAR_NETWORK',
  'STELLAR_NETWORK_PASSPHRASE',
  'RELAYER_SECRET_KEY',
  'ORDER_BOOK_ADDRESS',
  'MATCHING_ENGINE_ADDRESS',
] as const;

const PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

function loadConfigWith(env: Partial<Record<(typeof LIVE_KEYS)[number], string>>) {
  jest.resetModules();
  for (const key of LIVE_KEYS) process.env[key] = env[key] ?? '';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./config') as typeof import('./config');
}

describe('assertDeploymentConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  const live = {
    NODE_ENV: 'production',
    STELLAR_NETWORK: 'mainnet',
    STELLAR_NETWORK_PASSPHRASE: PUBLIC_PASSPHRASE,
    RELAYER_SECRET_KEY: 'SBSECRETKEYPLACEHOLDER',
    ORDER_BOOK_ADDRESS: 'CORDERBOOK',
    MATCHING_ENGINE_ADDRESS: 'CMATCHINGENGINE',
  };

  it('is a no-op in local development even with nothing configured', () => {
    const { assertDeploymentConfig } = loadConfigWith({ NODE_ENV: 'development' });
    expect(() => assertDeploymentConfig()).not.toThrow();
  });

  it('passes when a live deployment has everything it needs', () => {
    const { assertDeploymentConfig } = loadConfigWith(live);
    expect(() => assertDeploymentConfig()).not.toThrow();
  });

  it.each([
    ['RELAYER_SECRET_KEY'],
    ['ORDER_BOOK_ADDRESS'],
    ['MATCHING_ENGINE_ADDRESS'],
  ] as const)('refuses to start on mainnet without %s', (missing) => {
    const { assertDeploymentConfig } = loadConfigWith({ ...live, [missing]: '' });
    expect(() => assertDeploymentConfig()).toThrow(missing);
  });

  it('names every missing var at once rather than one per restart', () => {
    const { assertDeploymentConfig } = loadConfigWith({
      ...live,
      RELAYER_SECRET_KEY: '',
      MATCHING_ENGINE_ADDRESS: '',
    });
    expect(() => assertDeploymentConfig()).toThrow(
      /RELAYER_SECRET_KEY, MATCHING_ENGINE_ADDRESS/
    );
  });

  it('refuses to start on mainnet still carrying the testnet passphrase', () => {
    const { assertDeploymentConfig } = loadConfigWith({
      ...live,
      STELLAR_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
    });
    expect(() => assertDeploymentConfig()).toThrow(/STELLAR_NETWORK_PASSPHRASE/);
  });

  it('triggers on NODE_ENV=production even off mainnet', () => {
    const { assertDeploymentConfig } = loadConfigWith({
      ...live,
      STELLAR_NETWORK: 'testnet',
      STELLAR_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
      RELAYER_SECRET_KEY: '',
    });
    expect(() => assertDeploymentConfig()).toThrow('RELAYER_SECRET_KEY');
  });
});
