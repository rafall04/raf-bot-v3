/**
 * Header Doc
 * Purpose: Guardrail test untuk service agregasi rekap tunggakan pelanggan.
 * Caller: Jest test runner.
 * Deps: `../arrears.service`.
 * MainFuncs: Memverifikasi perhitungan outstanding, bucket, dan summary collection rate.
 * SideEffects: Tidak ada; repository dimock.
 */
"use strict";

describe("arrears service", () => {
    test("builds operational rows with unpaid period count and aging bucket", async () => {
        const repository = {
            listBillableCustomers: jest.fn(async () => ([
                {
                    id: 1,
                    name: "A",
                    phone_number: "081",
                    subscription: "Paket 150K",
                    subscription_price: 150000,
                    status: "aktif",
                    area: "Area 1"
                }
            ])),
            getLedgerEntriesUpToPeriod: jest.fn(async () => ({
                payments: [
                    { user_id: 1, amount_paid: 150000, amount_due: 150000, period_month: 3, period_year: 2026 },
                    { user_id: 1, amount_paid: 50000, amount_due: 150000, period_month: 4, period_year: 2026 }
                ],
                reversals: [
                    { user_id: 1, amount_reversed: 10000, period_month: 4, period_year: 2026 }
                ]
            }))
        };

        const { createArrearsService } = require("../arrears.service");
        const service = createArrearsService({ repository });
        const result = await service.getArrearsReadModel({ periodMonth: 4, periodYear: 2026 });

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toEqual(expect.objectContaining({
            user_id: 1,
            unpaid_period_count: 1,
            total_outstanding: 110000,
            current_period_outstanding: 110000,
            aging_bucket: "1_PERIODE",
            oldest_unpaid_period: "2026-04"
        }));
    });

    test("builds managerial summary totals and collection rates", async () => {
        const repository = {
            listBillableCustomers: jest.fn(async () => ([
                {
                    id: 1,
                    name: "A",
                    phone_number: "081",
                    subscription: "Paket 150K",
                    subscription_price: 150000,
                    status: "aktif",
                    area: "Area 1"
                },
                {
                    id: 2,
                    name: "B",
                    phone_number: "082",
                    subscription: "Paket 200K",
                    subscription_price: 200000,
                    status: "isolir",
                    area: "Area 2"
                }
            ])),
            getLedgerEntriesUpToPeriod: jest.fn(async () => ({
                payments: [
                    { user_id: 1, amount_paid: 150000, amount_due: 150000, period_month: 4, period_year: 2026 }
                ],
                reversals: []
            }))
        };

        const { createArrearsService } = require("../arrears.service");
        const service = createArrearsService({ repository });
        const result = await service.getArrearsReadModel({ periodMonth: 4, periodYear: 2026 });

        expect(result.summary.total_customers_in_arrears).toBe(1);
        expect(result.summary.total_outstanding).toBe(200000);
        expect(result.summary.current_period_outstanding).toBe(200000);
        expect(result.summary.collection_rate_by_customer).toBe(0.5);
        expect(result.summary.collection_rate_by_amount).toBeCloseTo(150000 / 350000, 5);
    });

    test("returns customer arrears detail ordered by period", async () => {
        const repository = {
            listBillableCustomers: jest.fn(async () => ([
                {
                    id: 1,
                    name: "A",
                    phone_number: "081",
                    subscription: "Paket 150K",
                    subscription_price: 150000,
                    status: "aktif",
                    area: "Area 1"
                }
            ])),
            getLedgerEntriesUpToPeriod: jest.fn(async () => ({
                payments: [
                    { user_id: 1, amount_paid: 50000, amount_due: 150000, period_month: 3, period_year: 2026 },
                    { user_id: 1, amount_paid: 150000, amount_due: 150000, period_month: 4, period_year: 2026 }
                ],
                reversals: []
            }))
        };

        const { createArrearsService } = require("../arrears.service");
        const service = createArrearsService({ repository });
        const detail = await service.getCustomerArrearsDetail({ userId: 1, periodMonth: 4, periodYear: 2026 });

        expect(detail.customer).toEqual(expect.objectContaining({
            user_id: 1,
            total_outstanding: 100000
        }));
        expect(detail.unpaid_periods).toEqual([
            expect.objectContaining({
                period: "2026-03",
                outstanding: 100000,
                status: "MENUNGGAK"
            })
        ]);
    });
});
