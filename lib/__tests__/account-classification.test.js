/**
 * Header Doc
 * Purpose: Test helper klasifikasi jenis akun (pelanggan vs infrastruktur).
 * Caller: jest.
 * Deps: ../account-classification.
 */
'use strict';

const {
    ACCOUNT_TYPE,
    getAccountType,
    isInfrastructure,
    isBillableCustomer,
    partitionAccounts
} = require('../account-classification');

describe('account-classification', () => {
    test('getAccountType default ke pelanggan untuk nilai kosong/invalid', () => {
        expect(getAccountType(undefined)).toBe(ACCOUNT_TYPE.CUSTOMER);
        expect(getAccountType(null)).toBe(ACCOUNT_TYPE.CUSTOMER);
        expect(getAccountType({})).toBe(ACCOUNT_TYPE.CUSTOMER);
        expect(getAccountType({ account_type: null })).toBe(ACCOUNT_TYPE.CUSTOMER);
        expect(getAccountType({ account_type: '' })).toBe(ACCOUNT_TYPE.CUSTOMER);
        expect(getAccountType({ account_type: '   ' })).toBe(ACCOUNT_TYPE.CUSTOMER);
        expect(getAccountType({ account_type: 123 })).toBe(ACCOUNT_TYPE.CUSTOMER);
    });

    test('getAccountType normalisasi spasi & kapital', () => {
        expect(getAccountType({ account_type: 'INFRASTRUKTUR' })).toBe('infrastruktur');
        expect(getAccountType({ account_type: '  Infrastruktur  ' })).toBe('infrastruktur');
        expect(getAccountType({ account_type: 'Pelanggan' })).toBe('pelanggan');
    });

    test('isInfrastructure hanya true untuk nilai infrastruktur kanonik', () => {
        expect(isInfrastructure({ account_type: 'infrastruktur' })).toBe(true);
        expect(isInfrastructure({ account_type: 'INFRASTRUKTUR' })).toBe(true);
        expect(isInfrastructure({ account_type: 'pelanggan' })).toBe(false);
        expect(isInfrastructure({})).toBe(false);
        expect(isInfrastructure({ account_type: 'cctv' })).toBe(false); // bukan nilai kanonik
    });

    test('isBillableCustomer kebalikan dari isInfrastructure', () => {
        expect(isBillableCustomer({ account_type: 'pelanggan' })).toBe(true);
        expect(isBillableCustomer({})).toBe(true);
        expect(isBillableCustomer({ account_type: 'infrastruktur' })).toBe(false);
    });

    test('partitionAccounts memisahkan customers & infrastructure', () => {
        const users = [
            { id: 1, account_type: 'pelanggan' },
            { id: 2, account_type: 'infrastruktur' },
            { id: 3 }, // default pelanggan
            { id: 4, account_type: 'INFRASTRUKTUR' }
        ];
        const { customers, infrastructure } = partitionAccounts(users);
        expect(customers.map((u) => u.id)).toEqual([1, 3]);
        expect(infrastructure.map((u) => u.id)).toEqual([2, 4]);
    });

    test('partitionAccounts aman untuk input bukan array', () => {
        expect(partitionAccounts(null)).toEqual({ customers: [], infrastructure: [] });
        expect(partitionAccounts(undefined)).toEqual({ customers: [], infrastructure: [] });
    });
});
