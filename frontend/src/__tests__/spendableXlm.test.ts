import { spendableXlmStroops, BASE_RESERVE_STROOPS } from '../lib/stellarHorizon';

const XLM = 10_000_000n;

function account(balance: string, extra: Record<string, unknown> = {}) {
  return {
    balances: [{ asset_type: 'native', balance }],
    subentry_count: 0,
    ...extra,
  };
}

describe('spendableXlmStroops', () => {
  it('withholds the 1 XLM every account must retain', () => {
    // 100 XLM gross, no subentries: 2 required entries x 0.5 XLM = 1 XLM.
    expect(spendableXlmStroops(account('100.0000000'))).toBe(99n * XLM);
  });

  it('withholds 0.5 XLM more for each subentry, such as a USDC trustline', () => {
    const withTrustline = account('100.0000000', { subentry_count: 1 });
    expect(spendableXlmStroops(withTrustline)).toBe(98n * XLM + 5_000_000n);
  });

  it('subtracts XLM already committed as a selling liability', () => {
    const withOffer = {
      balances: [
        { asset_type: 'native', balance: '100.0000000', selling_liabilities: '10.0000000' },
      ],
      subentry_count: 0,
    };
    expect(spendableXlmStroops(withOffer)).toBe(89n * XLM);
  });

  it('accounts for sponsored and sponsoring entries in both directions', () => {
    const sponsoring = account('100.0000000', { num_sponsoring: 2 });
    expect(spendableXlmStroops(sponsoring)).toBe(98n * XLM);
    // Entries sponsored BY someone else are not this account's burden.
    const sponsored = account('100.0000000', { subentry_count: 2, num_sponsored: 2 });
    expect(spendableXlmStroops(sponsored)).toBe(99n * XLM);
  });

  it('reports zero rather than a negative when the balance is all reserve', () => {
    // 1 XLM gross is exactly the minimum — nothing is spendable, and the old
    // gross reading would have offered the whole 1 XLM up for escrow.
    expect(spendableXlmStroops(account('1.0000000'))).toBe(0n);
    expect(spendableXlmStroops(account('0.5000000'))).toBe(0n);
  });

  it('treats an account with no native balance entry as having nothing', () => {
    expect(spendableXlmStroops({ balances: [] })).toBe(0n);
    expect(spendableXlmStroops({})).toBe(0n);
  });

  it('uses 0.5 XLM as the base reserve', () => {
    expect(BASE_RESERVE_STROOPS).toBe(5_000_000n);
  });
});
